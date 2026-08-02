from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services import label_printer


class LabelPrinterServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.settings_path = Path(self.temporary_directory.name) / "labels.json"
        self.settings_patch = patch.object(
            label_printer,
            "settings",
            SimpleNamespace(
                label_printer_settings_path=self.settings_path,
                zebra_printer_host="",
                zebra_printer_port=9100,
                zebra_printer_timeout_seconds=0.5,
            ),
        )
        self.settings_patch.start()
        self.production = {
            "work_unit_id": 81,
            "production_number": "PROD-1042",
            "project_name": "Parque Norte",
            "module_number": 3,
            "panel_name": "P-07",
            "scope": "panel",
            "source": "active_task",
            "activity_at": datetime(2026, 7, 16, 9, 15, tzinfo=timezone.utc),
        }

    def tearDown(self) -> None:
        self.settings_patch.stop()
        self.temporary_directory.cleanup()

    def test_missing_settings_file_returns_production_defaults(self) -> None:
        loaded = label_printer.load_settings()

        self.assertIn("production_number", loaded["selected_fields"])
        self.assertIn("panel_name", loaded["selected_fields"])
        self.assertEqual(loaded["copies"], 1)

    def test_settings_are_persisted_and_deduplicated(self) -> None:
        saved = label_printer.save_settings(
            {
                "selected_fields": [
                    "production_number",
                    "production_number",
                    "panel_name",
                ],
                "copies": 2,
            }
        )

        self.assertEqual(
            saved["selected_fields"], ["production_number", "panel_name"]
        )
        self.assertEqual(label_printer.load_settings(), saved)

    def test_zpl_contains_selected_production_fields_in_landscape(self) -> None:
        zpl = label_printer.build_test_zpl(
            {
                "selected_fields": ["production_number", "module_number"],
                "copies": 2,
            },
            self.production,
        )

        self.assertIn("^PW799", zpl)
        self.assertIn("^LL1618", zpl)
        self.assertIn("^A0R", zpl)
        self.assertIn("PROD-1042", zpl)
        self.assertIn("M-03", zpl)
        self.assertNotIn("Parque Norte", zpl)
        self.assertNotIn("P-07", zpl)
        self.assertIn("^PQ2,0,1,N", zpl)

    def test_zpl_includes_panel_only_when_record_is_a_panel(self) -> None:
        settings = {"selected_fields": ["panel_name"], "copies": 1}

        panel_zpl = label_printer.build_test_zpl(settings, self.production)
        module_zpl = label_printer.build_test_zpl(
            settings,
            {**self.production, "panel_name": None, "scope": "module"},
        )

        self.assertIn("P-07", panel_zpl)
        self.assertNotIn("^FDPANEL^FS", module_zpl)

    def test_task_context_maps_house_identifier_and_panel_code(self) -> None:
        task = SimpleNamespace(
            started_at=datetime(2026, 7, 16, 9, 15, tzinfo=timezone.utc),
            completed_at=None,
        )
        work_unit = SimpleNamespace(id=81, module_number=3)
        work_order = SimpleNamespace(
            id=42,
            house_identifier="PROD-1042",
            project_name="Parque Norte",
        )
        panel_definition = SimpleNamespace(panel_code="P-07")

        mapped = label_printer._production_data_from_task_row(
            (task, work_unit, work_order, panel_definition),
            source="active_task",
        )

        self.assertEqual(mapped["production_number"], "PROD-1042")
        self.assertEqual(mapped["project_name"], "Parque Norte")
        self.assertEqual(mapped["module_number"], 3)
        self.assertEqual(mapped["panel_name"], "P-07")
        self.assertEqual(mapped["scope"], "panel")

    def test_status_explains_when_printer_host_is_missing(self) -> None:
        status = label_printer.get_status()

        self.assertFalse(status["configured"])
        self.assertFalse(status["connected"])
        self.assertEqual(status["state"], "not_configured")
        self.assertEqual(status["profile"]["dpi"], 203)

    def test_send_rejects_missing_printer_host_before_network_access(self) -> None:
        with self.assertRaises(label_printer.PrinterNotConfiguredError):
            label_printer.send_test_label(
                label_printer.load_settings(), self.production
            )

    def test_send_writes_generated_zpl_to_configured_printer(self) -> None:
        label_printer.settings.zebra_printer_host = "192.0.2.25"
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.__exit__.return_value = False

        with patch.object(
            label_printer.socket,
            "create_connection",
            return_value=connection,
        ) as create_connection:
            result = label_printer.send_test_label(
                label_printer.load_settings(), self.production
            )

        create_connection.assert_called_once_with(("192.0.2.25", 9100), timeout=0.5)
        sent_payload = connection.sendall.call_args.args[0]
        self.assertTrue(sent_payload.startswith(b"^XA"))
        self.assertTrue(sent_payload.endswith(b"^XZ"))
        self.assertTrue(result["sent"])


if __name__ == "__main__":
    unittest.main()
