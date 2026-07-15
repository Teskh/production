from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.routes.worker_station import _group_work_unit_condition_rows


class WorkerStationConditionTests(unittest.TestCase):
    def test_groups_multiple_values_by_type_and_work_unit(self) -> None:
        grouped = _group_work_unit_condition_rows(
            [
                (5, 1, "Stories", 10, "1"),
                (5, 1, "Stories", 11, "2"),
                (5, 2, "Insulation", 20, "High"),
                (6, 1, "Stories", 11, "2"),
            ]
        )

        self.assertEqual(
            [condition.model_dump() for condition in grouped[5]],
            [
                {
                    "id": 1,
                    "name": "Stories",
                    "values": [
                        {"id": 10, "name": "1"},
                        {"id": 11, "name": "2"},
                    ],
                },
                {
                    "id": 2,
                    "name": "Insulation",
                    "values": [{"id": 20, "name": "High"}],
                },
            ],
        )
        self.assertEqual(
            [condition.model_dump() for condition in grouped[6]],
            [
                {
                    "id": 1,
                    "name": "Stories",
                    "values": [{"id": 11, "name": "2"}],
                }
            ],
        )

    def test_empty_rows_returns_empty_mapping(self) -> None:
        self.assertEqual(_group_work_unit_condition_rows([]), {})


if __name__ == "__main__":
    unittest.main()
