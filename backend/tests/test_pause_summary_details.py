from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.routes import pause_summary


class _Result:
    def __init__(self, rows: list[tuple]) -> None:
        self._rows = rows

    def all(self) -> list[tuple]:
        return self._rows


class _Session:
    def __init__(self, rows: list[tuple]) -> None:
        self.rows = rows

    def execute(self, _statement: object) -> _Result:
        str(_statement)
        return _Result(self.rows)


class _ShiftMasks:
    def masked_minutes(
        self, _station_id: int, pause_start: datetime, _pause_end: datetime
    ) -> float:
        return 20.0 if pause_start.hour == 8 else 10.0


def _row(
    *,
    pause_id: int,
    reason_name: str | None,
    reason_text: str | None,
    paused_at: datetime,
) -> tuple:
    resumed_at = paused_at.replace(minute=paused_at.minute + 30)
    pause = SimpleNamespace(
        id=pause_id,
        paused_at=paused_at,
        resumed_at=resumed_at,
        reason_text=reason_text,
    )
    instance = SimpleNamespace(
        id=100 + pause_id,
        station_id=5,
        completed_at=resumed_at,
    )
    reason = SimpleNamespace(name=reason_name) if reason_name is not None else None
    task_definition = SimpleNamespace(id=21, name="Clavado de placa")
    station = SimpleNamespace(id=5, name="Mesa 2")
    work_order = SimpleNamespace(project_name="Proyecto Norte", house_identifier="Casa 12")
    work_unit = SimpleNamespace(module_number=3)
    panel_definition = SimpleNamespace(panel_code="P-07")
    return (
        pause,
        instance,
        reason,
        task_definition,
        station,
        work_order,
        work_unit,
        panel_definition,
    )


class PauseSummaryDetailsTests(unittest.TestCase):
    def test_details_return_only_selected_reason_with_task_context(self) -> None:
        rows = [
            _row(
                pause_id=1,
                reason_name="Espera de material",
                reason_text=None,
                paused_at=datetime(2026, 8, 18, 8, 0),
            ),
            _row(
                pause_id=2,
                reason_name="Ajuste de equipo",
                reason_text=None,
                paused_at=datetime(2026, 8, 18, 9, 0),
            ),
        ]

        with patch.object(
            pause_summary.ShiftMaskResolver, "load", return_value=_ShiftMasks()
        ):
            result = pause_summary.get_pause_summary_details(
                reason="Espera de material",
                from_date="2026-08-18",
                to_date="2026-08-18",
                house_type_id=4,
                station_id=5,
                db=_Session(rows),
            )

        self.assertEqual(result.reason, "Espera de material")
        self.assertEqual(result.station_id, 5)
        self.assertEqual(result.total_pause_minutes, 20.0)
        self.assertEqual(result.occurrence_count, 1)
        self.assertEqual(len(result.contributions), 1)
        contribution = result.contributions[0]
        self.assertEqual(contribution.task_name, "Clavado de placa")
        self.assertEqual(contribution.station_name, "Mesa 2")
        self.assertEqual(contribution.project_name, "Proyecto Norte")
        self.assertEqual(contribution.house_identifier, "Casa 12")
        self.assertEqual(contribution.module_number, 3)
        self.assertEqual(contribution.panel_code, "P-07")
        self.assertEqual(contribution.duration_minutes, 20.0)

    def test_details_support_free_text_pause_reason(self) -> None:
        rows = [
            _row(
                pause_id=3,
                reason_name=None,
                reason_text="Consulta técnica",
                paused_at=datetime(2026, 8, 18, 9, 0),
            )
        ]

        with patch.object(
            pause_summary.ShiftMaskResolver, "load", return_value=_ShiftMasks()
        ):
            result = pause_summary.get_pause_summary_details(
                reason="Consulta técnica",
                db=_Session(rows),
            )

        self.assertEqual(result.occurrence_count, 1)
        self.assertEqual(result.total_pause_minutes, 10.0)


if __name__ == "__main__":
    unittest.main()
