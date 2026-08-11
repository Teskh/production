from __future__ import annotations

import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.models.enums import TaskScope, WorkUnitStatus  # noqa: E402
from app.services.qc_runtime import manual_check_scope_for_status  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
