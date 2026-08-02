from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.deps import admin_page_access_allowed, require_admin_page, require_sysadmin


def admin(role: str) -> SimpleNamespace:
    return SimpleNamespace(role=role)


def permission(role: str, *, can_view: bool, can_edit: bool) -> SimpleNamespace:
    return SimpleNamespace(role=role, can_view=can_view, can_edit=can_edit)


class FakeResult:
    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = rows

    def scalars(self) -> list[SimpleNamespace]:
        return self.rows


class FakeDb:
    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = rows

    def execute(self, _statement: object) -> FakeResult:
        return FakeResult(self.rows)


class AdminPageAccessTests(unittest.TestCase):
    def test_unconfigured_page_preserves_default_open_behavior(self) -> None:
        self.assertTrue(admin_page_access_allowed(admin("Admin"), [], edit=True))

    def test_sysadmin_bypasses_page_permissions(self) -> None:
        rows = [permission("Admin", can_view=False, can_edit=False)]
        self.assertTrue(admin_page_access_allowed(admin("SysAdmin"), rows, edit=True))

    def test_configured_page_denies_unlisted_role(self) -> None:
        rows = [permission("Supervisor", can_view=True, can_edit=True)]
        self.assertFalse(admin_page_access_allowed(admin("Admin"), rows, edit=False))

    def test_read_only_role_can_view_but_not_edit(self) -> None:
        rows = [permission("Admin", can_view=True, can_edit=False)]
        self.assertTrue(admin_page_access_allowed(admin("Admin"), rows, edit=False))
        self.assertFalse(admin_page_access_allowed(admin("Admin"), rows, edit=True))

    def test_hidden_role_cannot_view_or_edit(self) -> None:
        rows = [permission("Admin", can_view=False, can_edit=True)]
        self.assertFalse(admin_page_access_allowed(admin("Admin"), rows, edit=False))
        self.assertFalse(admin_page_access_allowed(admin("Admin"), rows, edit=True))

    def test_dependency_returns_actor_when_access_is_allowed(self) -> None:
        actor = admin("Admin")
        rows = [permission("Admin", can_view=True, can_edit=True)]
        guard = require_admin_page("stations", edit=True)
        self.assertIs(guard(actor, FakeDb(rows)), actor)

    def test_dependency_rejects_disallowed_edit(self) -> None:
        rows = [permission("Admin", can_view=True, can_edit=False)]
        guard = require_admin_page("stations", edit=True)
        with self.assertRaises(HTTPException) as caught:
            guard(admin("Admin"), FakeDb(rows))
        self.assertEqual(caught.exception.status_code, 403)

    def test_sysadmin_dependency_rejects_other_admin_roles(self) -> None:
        actor = admin("SysAdmin")
        self.assertIs(require_sysadmin(actor), actor)
        with self.assertRaises(HTTPException) as caught:
            require_sysadmin(admin("Admin"))
        self.assertEqual(caught.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
