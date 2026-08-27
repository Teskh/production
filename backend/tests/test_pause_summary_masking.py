from __future__ import annotations

import sys
import unittest
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.routes import pause_summary  # noqa: E402


class _Result:
    def __init__(self, rows: list[tuple]) -> None:
        self._rows = rows

    def all(self) -> list[tuple]:
        return self._rows


class _Session:
    def __init__(self, rows: list[tuple]) -> None:
        self.rows = rows

    def execute(self, statement: object) -> _Result:
        str(statement)
        return _Result(self.rows)


def _row(
    pause_start: datetime,
    pause_end: datetime,
    reason_name: str = "Espera de material",
) -> tuple:
    pause = SimpleNamespace(
        id=1,
        paused_at=pause_start,
        resumed_at=pause_end,
        reason_text=None,
    )
    instance = SimpleNamespace(
        id=101,
        station_id=5,
        completed_at=pause_end,
    )
    reason = SimpleNamespace(name=reason_name)
    task_definition = SimpleNamespace(id=21, name="Clavado de placa")
    station = SimpleNamespace(id=5, name="Puente 1")
    work_order = SimpleNamespace(
        project_name="Proyecto Norte", house_identifier="Casa 12"
    )
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


class PauseSummaryMaskingTests(unittest.TestCase):
    def test_report_end_clips_pause_before_shift_masking(self) -> None:
        row = _row(
            datetime(2026, 8, 21, 15, 37),
            datetime(2026, 8, 24, 8, 38),
        )
        shift_masks = pause_summary.ShiftMaskResolver(
            masks_by_station_day={
                5: {
                    date(2026, 8, 21): (
                        datetime(2026, 8, 21, 8, 20),
                        datetime(2026, 8, 21, 16, 2),
                    )
                }
            },
            masks_by_sequence_day={},
        )

        with patch.object(
            pause_summary.ShiftMaskResolver, "load", return_value=shift_masks
        ):
            result = pause_summary.get_pause_summary(
                from_date="2026-08-18",
                to_date="2026-08-21",
                db=_Session([row[:3]]),
            )

        self.assertEqual(result.total_pause_minutes, 25.0)
        self.assertEqual(len(result.pause_reasons), 1)
        self.assertEqual(result.pause_reasons[0].occurrence_count, 1)

    def test_pause_started_before_range_is_clipped_and_included(self) -> None:
        row = _row(
            datetime(2026, 8, 17, 16, 30),
            datetime(2026, 8, 18, 9, 0),
            reason_name="Ajuste de equipo",
        )
        shift_masks = pause_summary.ShiftMaskResolver(
            masks_by_station_day={},
            masks_by_sequence_day={},
        )

        with patch.object(
            pause_summary.ShiftMaskResolver, "load", return_value=shift_masks
        ):
            result = pause_summary.get_pause_summary_details(
                reason="Ajuste de equipo",
                from_date="2026-08-18",
                to_date="2026-08-18",
                db=_Session([row]),
            )

        self.assertEqual(result.total_pause_minutes, 40.0)
        self.assertEqual(result.occurrence_count, 1)
        contribution = result.contributions[0]
        self.assertEqual(contribution.paused_at, datetime(2026, 8, 18, 0, 0))
        self.assertEqual(contribution.resumed_at, datetime(2026, 8, 18, 9, 0))


if __name__ == "__main__":
    unittest.main()
