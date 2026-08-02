from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.routes.panel_definitions import (
    _panel_usage,
    archive_panel_definition,
    delete_panel_definition,
    restore_panel_definition,
)
from app.api.routes.task_definitions import (
    _task_usage,
    archive_task_definition,
    delete_task_definition,
    restore_task_definition,
)
from app.models.house import PanelDefinition
from app.models.tasks import TaskDefinition


class FakeDb:
    def __init__(self, model: type, row: SimpleNamespace, scalar_values: list[int] | None = None):
        self.model = model
        self.row = row
        self.scalar_values = list(scalar_values or [])
        self.commit_count = 0
        self.refresh_count = 0

    def get(self, model: type, row_id: int) -> SimpleNamespace | None:
        if model is self.model and row_id == self.row.id:
            return self.row
        return None

    def scalar(self, _statement: object) -> int:
        return self.scalar_values.pop(0)

    def commit(self) -> None:
        self.commit_count += 1

    def refresh(self, _row: object) -> None:
        self.refresh_count += 1


class DefinitionArchivingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.admin = SimpleNamespace(id=73)

    def test_panel_usage_reports_task_and_qc_counts(self) -> None:
        panel = SimpleNamespace(id=9, archived_at=None, archived_by_user_id=None)
        db = FakeDb(PanelDefinition, panel, [12, 4])

        usage = _panel_usage(panel.id, db)  # type: ignore[arg-type]

        self.assertEqual(usage.task_instances, 12)
        self.assertEqual(usage.qc_checks, 4)

    def test_task_usage_reports_task_and_related_qc_counts(self) -> None:
        task = SimpleNamespace(id=5, archived_at=None, archived_by_user_id=None)
        db = FakeDb(TaskDefinition, task, [290, 7])

        usage = _task_usage(task.id, db)  # type: ignore[arg-type]

        self.assertEqual(usage.task_instances, 290)
        self.assertEqual(usage.qc_checks, 7)

    def test_legacy_panel_delete_archives_and_restore_reverses_it(self) -> None:
        panel = SimpleNamespace(id=9, archived_at=None, archived_by_user_id=None)
        db = FakeDb(PanelDefinition, panel)

        delete_panel_definition(panel.id, db, self.admin)  # type: ignore[arg-type]

        self.assertIsNotNone(panel.archived_at)
        self.assertEqual(panel.archived_by_user_id, self.admin.id)
        self.assertEqual(db.commit_count, 1)

        restore_panel_definition(panel.id, db, self.admin)  # type: ignore[arg-type]

        self.assertIsNone(panel.archived_at)
        self.assertIsNone(panel.archived_by_user_id)
        self.assertEqual(db.commit_count, 2)

    def test_legacy_task_delete_archives_without_deleting_dependencies(self) -> None:
        task = SimpleNamespace(id=5, archived_at=None, archived_by_user_id=None)
        db = FakeDb(TaskDefinition, task)

        delete_task_definition(task.id, db, self.admin)  # type: ignore[arg-type]

        self.assertIsNotNone(task.archived_at)
        self.assertEqual(task.archived_by_user_id, self.admin.id)
        self.assertEqual(db.commit_count, 1)

        restore_task_definition(task.id, db, self.admin)  # type: ignore[arg-type]

        self.assertIsNone(task.archived_at)
        self.assertIsNone(task.archived_by_user_id)
        self.assertEqual(db.commit_count, 2)

    def test_archive_endpoints_are_idempotent(self) -> None:
        panel = SimpleNamespace(id=9, archived_at=None, archived_by_user_id=None)
        panel_db = FakeDb(PanelDefinition, panel)
        archive_panel_definition(panel.id, panel_db, self.admin)  # type: ignore[arg-type]
        archive_panel_definition(panel.id, panel_db, self.admin)  # type: ignore[arg-type]
        self.assertEqual(panel_db.commit_count, 1)

        task = SimpleNamespace(id=5, archived_at=None, archived_by_user_id=None)
        task_db = FakeDb(TaskDefinition, task)
        archive_task_definition(task.id, task_db, self.admin)  # type: ignore[arg-type]
        archive_task_definition(task.id, task_db, self.admin)  # type: ignore[arg-type]
        self.assertEqual(task_db.commit_count, 1)


if __name__ == "__main__":
    unittest.main()
