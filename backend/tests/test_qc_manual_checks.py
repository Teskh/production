from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.routes.qc_runtime import manual_check_options  # noqa: E402
from app.models.enums import TaskScope, WorkUnitStatus  # noqa: E402
from app.models.qc import QCCheckDefinition, QCCheckInstance  # noqa: E402
from app.models.work import WorkOrder, WorkUnit  # noqa: E402
from app.services.qc_runtime import manual_check_scope_for_status  # noqa: E402


class ScalarRows:
    def __init__(self, rows: list[object]):
        self.rows = rows

    def scalars(self) -> "ScalarRows":
        return self

    def __iter__(self):
        return iter(self.rows)


class ManualOptionsDb:
    def __init__(self):
        self.work_unit = SimpleNamespace(
            id=7,
            work_order_id=3,
            status=WorkUnitStatus.ASSEMBLY,
        )
        self.work_order = SimpleNamespace(
            id=3,
            house_type_id=2,
            sub_type_id=None,
        )
        self.definitions = [
            SimpleNamespace(id=11, name="Check disparado", guidance_text=None),
            SimpleNamespace(id=12, name="Plantilla manual", guidance_text="Revisar"),
        ]

    def get(self, model: type, row_id: int):
        if model is WorkUnit and row_id == self.work_unit.id:
            return self.work_unit
        if model is WorkOrder and row_id == self.work_order.id:
            return self.work_order
        return None

    def execute(self, statement: object) -> ScalarRows:
        sql = str(statement)
        if f"FROM {QCCheckDefinition.__tablename__}" in sql:
            # Model the old bug: a kind predicate would leave only the manual template.
            where_clause = sql.partition("WHERE")[2]
            if f"{QCCheckDefinition.__tablename__}.kind =" in where_clause:
                return ScalarRows([self.definitions[1]])
            return ScalarRows(self.definitions)
        if f"FROM {QCCheckInstance.__tablename__}" in sql:
            return ScalarRows([])
        return ScalarRows([])


class QCManualCheckScopeTests(unittest.TestCase):
    def test_panels_status_requires_panel_scope(self) -> None:
        self.assertEqual(
            manual_check_scope_for_status(WorkUnitStatus.PANELS),
            TaskScope.PANEL,
        )

    def test_later_production_statuses_require_module_scope(self) -> None:
        self.assertEqual(
            manual_check_scope_for_status(WorkUnitStatus.MAGAZINE),
            TaskScope.MODULE,
        )
        self.assertEqual(
            manual_check_scope_for_status(WorkUnitStatus.ASSEMBLY),
            TaskScope.MODULE,
        )

    def test_non_active_statuses_do_not_allow_manual_inspections(self) -> None:
        self.assertIsNone(manual_check_scope_for_status(WorkUnitStatus.PLANNED))
        self.assertIsNone(manual_check_scope_for_status(WorkUnitStatus.COMPLETED))

    def test_options_include_triggered_and_manual_definitions(self) -> None:
        options = manual_check_options(
            work_unit_id=7,
            panel_unit_id=None,
            admin=SimpleNamespace(role="QC"),
            db=ManualOptionsDb(),
        )

        self.assertEqual([option.id for option in options], [11, 12])


if __name__ == "__main__":
    unittest.main()
