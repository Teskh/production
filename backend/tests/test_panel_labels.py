import sys
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from app.api.deps import get_current_worker, get_current_worker_session, get_db
from app.api.routes import labels
from app.models.enums import StationRole
from app.models.house import HouseSubType, HouseType, PanelDefinition
from app.models.work import WorkOrder, WorkUnit
from app.schemas.panel_labels import PanelLabelInput
from app.services import panel_labels


class PanelLabelsTests(unittest.TestCase):
    def setUp(self):
        self.panel = SimpleNamespace(id=210, house_type_id=17, sub_type_id=40,
            module_sequence_number=1, panel_code="C-09", group="Paneles de Cielo",
            panel_length_m=Decimal("8.03"), panel_area=Decimal("26.34"))
        self.records = {
            WorkUnit: SimpleNamespace(id=1207, work_order_id=517, module_number=1),
            PanelDefinition: self.panel,
            WorkOrder: SimpleNamespace(id=517, house_type_id=17, sub_type_id=40,
                project_name="PADRE HURTADO", house_identifier="PH #34"),
            HouseType: SimpleNamespace(name="THS"),
            HouseSubType: SimpleNamespace(name="A"),
        }
        self.db = MagicMock()
        self.db.get.side_effect = lambda cls, ident: self.records.get(cls)
        self.payload = PanelLabelInput(work_unit_id=1207, panel_definition_id=210,
            label_date=date(2026, 9, 10))

    def test_real_house_example_needs_no_input(self):
        preview = panel_labels.load_preview(self.db, self.payload)
        self.assertEqual(preview.data.model, "THS-A")
        self.assertEqual(preview.data.description, "C-09")
        self.assertEqual(preview.data.correlativo, "34")
        self.assertEqual(preview.data.area, "26.34")
        self.assertEqual(preview.data.module, 1)
        self.assertEqual(preview.data.process, "Paneles")
        self.assertEqual(preview.missing_fields, [])
        self.assertIn("catálogo", preview.sources["area"])
        self.assertIn("MD1", preview.svg)
        self.assertNotIn("M-01", preview.svg)

    def test_missing_or_invalid_area_requires_input(self):
        for area in (None, 0, -1):
            with self.subTest(area=area):
                self.panel.panel_area = area
                preview = panel_labels.load_preview(self.db, self.payload)
                self.assertIn("area", preview.missing_fields)
                with patch.object(panel_labels.label_printer, "send_zpl") as send:
                    with self.assertRaises(HTTPException):
                        panel_labels.print_label(preview, 1)
                    send.assert_not_called()

    def test_overrides_and_unknown_house_number(self):
        self.records[WorkOrder].house_identifier = "Prototipo"
        preview = panel_labels.load_preview(self.db, self.payload)
        self.assertIn("correlativo", preview.missing_fields)
        override = self.payload.model_copy(update={"area": Decimal("26.34"), "correlativo": "34"})
        preview = panel_labels.load_preview(self.db, override)
        self.assertEqual(preview.data.area, "26.34")
        self.assertEqual(preview.missing_fields, [])

    def test_multiwall_area_uses_catalogue_without_length(self):
        self.panel.group = "Multiwalls"
        self.panel.panel_length_m = None
        preview = panel_labels.load_preview(self.db, self.payload)
        self.assertEqual(preview.data.area, "26.34")
        self.assertEqual(preview.missing_fields, [])

    def test_area_overrides_must_be_valid_numbers(self):
        from pydantic import ValidationError
        for area in ("nan", "-1", "0", "abc", "1.234"):
            with self.subTest(area=area), self.assertRaises(ValidationError):
                PanelLabelInput(work_unit_id=1, panel_definition_id=1, area=area)

    def test_rejects_panel_from_another_module(self):
        self.panel.module_sequence_number = 2
        with self.assertRaises(HTTPException) as raised:
            panel_labels.load_preview(self.db, self.payload)
        self.assertEqual(raised.exception.status_code, 409)

    def test_layout_escapes_user_text_and_prints_all_fields(self):
        preview = panel_labels.load_preview(self.db, self.payload.model_copy(update={"description": "<script>^XZ~JA_"}))
        self.assertNotIn("<script>", preview.svg)
        zpl = panel_labels.build_zpl(preview.data, 2)
        self.assertEqual(zpl.count("^XZ"), 1)
        self.assertNotIn("~JA", zpl)
        self.assertIn("^PQ2,0,1,N", zpl)
        for _, _, _, value in panel_labels.layout(preview.data):
            self.assertIn("".join(f"_{byte:02X}" for byte in value.encode("utf-8")), zpl)
        self.assertNotIn("MUESTRA", zpl)


class WorkerLabelAccessTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(labels.router, prefix="/labels")
        self.db = MagicMock()
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(self.app)
        self.payload = {"work_unit_id": 1207, "panel_definition_id": 210}

    def test_unauthenticated_preview_and_print_are_rejected(self):
        for action in ("preview", "print"):
            response = self.client.post(f"/labels/worker/{action}", json=self.payload)
            self.assertEqual(response.status_code, 401)

    def test_other_station_cannot_preview_or_print(self):
        self.app.dependency_overrides[get_current_worker] = lambda: SimpleNamespace(id=1)
        self.app.dependency_overrides[get_current_worker_session] = lambda: SimpleNamespace(station_id=2)
        self.db.get.return_value = SimpleNamespace(name="Mesa 1", role=StationRole.PANELS)
        for action in ("preview", "print"):
            response = self.client.post(f"/labels/worker/{action}", json=self.payload)
            self.assertEqual(response.status_code, 403)

    def test_framing_rejects_panel_outside_snapshot(self):
        self.app.dependency_overrides[get_current_worker] = lambda: SimpleNamespace(id=1)
        self.app.dependency_overrides[get_current_worker_session] = lambda: SimpleNamespace(station_id=1)
        self.db.get.return_value = SimpleNamespace(id=1, name="Framing", role=StationRole.PANELS)
        with patch("app.api.routes.worker_station.station_snapshot", return_value=SimpleNamespace(work_items=[])):
            for action in ("preview", "print"):
                response = self.client.post(f"/labels/worker/{action}", json=self.payload)
                self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()
