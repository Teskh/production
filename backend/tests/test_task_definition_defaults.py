from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.routes.task_definitions import create_task_definition
from app.models.enums import TaskScope
from app.models.tasks import TaskApplicability, TaskDefinition
from app.schemas.tasks import TaskDefinitionCreate


class _FakeSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.committed = False

    def add(self, row: object) -> None:
        self.added.append(row)

    def flush(self) -> None:
        task = self.added[0]
        assert isinstance(task, TaskDefinition)
        task.id = 42

    def commit(self) -> None:
        self.committed = True

    def refresh(self, _row: object) -> None:
        pass


class TaskDefinitionDefaultTests(unittest.TestCase):
    def test_new_task_gets_global_not_applicable_rule(self) -> None:
        db = _FakeSession()
        payload = TaskDefinitionCreate(name="New task", scope=TaskScope.PANEL)

        task = create_task_definition(payload, db, object())

        self.assertEqual(task.id, 42)
        self.assertTrue(db.committed)
        self.assertEqual(len(db.added), 2)
        default_rule = db.added[1]
        self.assertIsInstance(default_rule, TaskApplicability)
        assert isinstance(default_rule, TaskApplicability)
        self.assertEqual(default_rule.task_definition_id, 42)
        self.assertFalse(default_rule.applies)
        self.assertIsNone(default_rule.house_type_id)
        self.assertIsNone(default_rule.module_number)
        self.assertIsNone(default_rule.panel_definition_id)


if __name__ == "__main__":
    unittest.main()
