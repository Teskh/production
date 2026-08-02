from __future__ import annotations

import sys
import unittest
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.models.enums import (  # noqa: E402
    QCCheckOrigin,
    QCCheckStatus,
    QCComplaintStatus,
    QCExecutionOutcome,
    QCReworkStatus,
    QCSeverityLevel,
)
from app.services.qc_dashboard_metrics import (  # noqa: E402
    build_qc_metric_window,
    summarize_qc_failure_rows,
    summarize_qc_quality_rows,
)


def row(work_unit_id: int, **values):
    return SimpleNamespace(
        work_unit_id=work_unit_id,
        module_number=work_unit_id,
        project_name="Proyecto",
        house_identifier=f"V-{work_unit_id}",
        house_type_name="Tipo A",
        **values,
    )


class QCDashboardMetricsTests(unittest.TestCase):
    def test_window_uses_chile_local_dates_and_an_exclusive_end(self) -> None:
        window = build_qc_metric_window(date(2026, 1, 5), date(2026, 1, 9))

        self.assertEqual(window.start_utc, datetime(2026, 1, 5, 3, 0))
        self.assertEqual(window.end_utc_exclusive, datetime(2026, 1, 10, 3, 0))

    def test_window_rejects_an_inverted_range(self) -> None:
        with self.assertRaises(ValueError):
            build_qc_metric_window(date(2026, 1, 10), date(2026, 1, 9))

    def test_summary_separates_unperformed_and_currently_open_cases(self) -> None:
        window = build_qc_metric_window(date(2026, 1, 5), date(2026, 1, 9))
        check_rows = [
            row(
                1,
                origin=QCCheckOrigin.TRIGGERED,
                status=QCCheckStatus.OPEN,
                performed=False,
            ),
            row(
                1,
                origin=QCCheckOrigin.TRIGGERED,
                status=QCCheckStatus.CLOSED,
                performed=True,
            ),
            row(
                1,
                origin=QCCheckOrigin.MANUAL,
                status=QCCheckStatus.OPEN,
                performed=False,
            ),
        ]
        observation_rows = [
            row(1, status=QCComplaintStatus.CLOSURE_PROPOSED),
            row(2, status=QCComplaintStatus.CLOSED),
        ]

        result = summarize_qc_quality_rows(check_rows, observation_rows, window)

        self.assertEqual(
            result["checks"],
            {"total": 3, "triggered": 2, "not_performed": 1, "open": 2},
        )
        self.assertEqual(result["observations"], {"total": 2, "open": 1})
        self.assertEqual(result["affected_modules"], 1)
        self.assertEqual(result["modules"][0]["not_performed_checks"], 1)
        self.assertEqual(result["modules"][0]["open_checks"], 2)
        self.assertEqual(result["modules"][0]["open_observations"], 1)

    def test_failure_summary_builds_absolute_and_relative_rankings(self) -> None:
        window = build_qc_metric_window(date(2026, 1, 5), date(2026, 1, 9))
        execution_rows = [
            SimpleNamespace(
                check_instance_id=10,
                work_unit_id=1,
                outcome=QCExecutionOutcome.FAIL,
                performed_at=datetime(2026, 1, 5, 15, 0),
                severity_level=QCSeverityLevel.CRITICA,
                task_definition_id=1,
                task_name="Armar panel",
                station_id=1,
                station_name="Estructura",
                check_definition_id=1,
                check_name="Escuadra",
            ),
            SimpleNamespace(
                check_instance_id=11,
                work_unit_id=1,
                outcome=QCExecutionOutcome.PASS,
                performed_at=datetime(2026, 1, 5, 16, 0),
                severity_level=None,
                task_definition_id=1,
                task_name="Armar panel",
                station_id=1,
                station_name="Estructura",
                check_definition_id=1,
                check_name="Escuadra",
            ),
            SimpleNamespace(
                check_instance_id=20,
                work_unit_id=2,
                outcome=QCExecutionOutcome.FAIL,
                performed_at=datetime(2026, 1, 6, 14, 0),
                severity_level=QCSeverityLevel.MEDIA,
                task_definition_id=2,
                task_name="Cerrar panel",
                station_id=2,
                station_name="Terminaciones",
                check_definition_id=2,
                check_name="Fijaciones",
            ),
            SimpleNamespace(
                check_instance_id=20,
                work_unit_id=2,
                outcome=QCExecutionOutcome.FAIL,
                performed_at=datetime(2026, 1, 7, 14, 0),
                severity_level=QCSeverityLevel.BAJA,
                task_definition_id=2,
                task_name="Cerrar panel",
                station_id=2,
                station_name="Terminaciones",
                check_definition_id=2,
                check_name="Fijaciones",
            ),
            SimpleNamespace(
                check_instance_id=30,
                work_unit_id=3,
                outcome=QCExecutionOutcome.WAIVE,
                performed_at=datetime(2026, 1, 7, 18, 0),
                severity_level=None,
                task_definition_id=None,
                task_name=None,
                station_id=2,
                station_name="Terminaciones",
                check_definition_id=None,
                check_name="Check manual",
            ),
        ]
        failure_mode_rows = [
            SimpleNamespace(
                failure_mode_definition_id=1,
                failure_mode_name="Fisura",
                other_text=None,
            ),
            SimpleNamespace(
                failure_mode_definition_id=1,
                failure_mode_name="Fisura",
                other_text=None,
            ),
            SimpleNamespace(
                failure_mode_definition_id=None,
                failure_mode_name=None,
                other_text="Desalineado",
            ),
        ]
        rework_rows = [
            SimpleNamespace(status=QCReworkStatus.OPEN),
            SimpleNamespace(status=QCReworkStatus.DONE),
        ]

        result = summarize_qc_failure_rows(
            execution_rows,
            failure_mode_rows,
            rework_rows,
            window,
        )

        self.assertEqual(result["summary"]["executions"], 5)
        self.assertEqual(result["summary"]["failures"], 3)
        self.assertEqual(result["summary"]["failure_rate"], 0.6)
        self.assertEqual(result["summary"]["affected_modules"], 2)
        self.assertEqual(result["summary"]["repeat_failure_checks"], 1)
        self.assertEqual(result["summary"]["open_reworks"], 1)
        self.assertEqual(result["summary"]["critical_checks"], 1)
        self.assertEqual(result["tasks"][0]["name"], "Cerrar panel")
        self.assertEqual(result["tasks"][0]["failure_rate"], 1.0)
        self.assertEqual(result["stations"][0]["name"], "Terminaciones")
        self.assertEqual(result["stations"][0]["failure_rate"], 2 / 3)
        self.assertEqual(result["failure_modes"][0]["name"], "Fisura")
        self.assertEqual(result["failure_modes"][0]["occurrences"], 2)
        self.assertEqual([item["failures"] for item in result["daily"]], [1, 1, 1, 0, 0])


if __name__ == "__main__":
    unittest.main()
