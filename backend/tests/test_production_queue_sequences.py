from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.routes.production_queue import _find_project_sequence_conflicts


class ProductionQueueSequenceTests(unittest.TestCase):
    def test_conflict_requires_same_project_and_sequence(self) -> None:
        conflicts = _find_project_sequence_conflicts(
            [
                (1, "Proyecto A", 10),
                (2, "Proyecto A", 10),
                (3, "Proyecto B", 10),
            ]
        )

        self.assertEqual(conflicts, {("Proyecto A", 10): [1, 2]})

    def test_same_sequence_in_different_projects_is_allowed(self) -> None:
        conflicts = _find_project_sequence_conflicts(
            [
                (1, "Proyecto A", 10),
                (2, "Proyecto B", 10),
            ]
        )

        self.assertEqual(conflicts, {})


if __name__ == "__main__":
    unittest.main()
