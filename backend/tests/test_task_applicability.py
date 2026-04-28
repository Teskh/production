from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.models.enums import TaskScope
from app.models.tasks import TaskApplicability, TaskDefinition
from app.services.task_applicability import (
    order_tasks_by_panel_metadata,
    resolve_task_station_sequence,
)


def task(
    task_id: int,
    name: str,
    sequence: int | None = 1,
) -> TaskDefinition:
    return TaskDefinition(
        id=task_id,
        name=name,
        scope=TaskScope.PANEL,
        default_station_sequence=sequence,
        active=True,
    )


class TaskApplicabilityTests(unittest.TestCase):
    def test_panel_specific_false_override_suppresses_task(self) -> None:
        task_def = task(10, "Armado Panel", 1)
        row = TaskApplicability(
            id=1,
            task_definition_id=10,
            panel_definition_id=100,
            applies=False,
            station_sequence_order=1,
        )

        applies, station_sequence = resolve_task_station_sequence(
            task_def,
            [row],
            house_type_id=1,
            sub_type_id=None,
            module_number=1,
            panel_definition_id=100,
        )

        self.assertFalse(applies)
        self.assertIsNone(station_sequence)

    def test_panel_metadata_orders_without_filtering_runtime_applicability(self) -> None:
        armado = task(10, "Armado Panel", 1)
        revision = task(20, "Revision", 2)

        ordered = order_tasks_by_panel_metadata(
            [revision, armado],
            panel_task_order=[20],
        )

        self.assertEqual([item.id for item in ordered], [20, 10])

    def test_missing_override_defaults_to_task_station_sequence(self) -> None:
        task_def = task(10, "Armado Panel", 1)

        applies, station_sequence = resolve_task_station_sequence(
            task_def,
            [],
            house_type_id=1,
            sub_type_id=None,
            module_number=1,
            panel_definition_id=100,
        )

        self.assertTrue(applies)
        self.assertEqual(station_sequence, 1)


if __name__ == "__main__":
    unittest.main()
