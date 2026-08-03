from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.deployment import app_base_path, external_path, internal_path, session_cookie_path


class DeploymentPathTests(unittest.TestCase):
    def test_root_deployment_keeps_paths_unchanged(self) -> None:
        config = SimpleNamespace(app_base_path="")
        self.assertEqual(app_base_path(config), "")
        self.assertEqual(external_path("/api/workers?active=true", config), "/api/workers?active=true")
        self.assertEqual(session_cookie_path(config), "/")

    def test_subpath_deployment_prefixes_external_paths(self) -> None:
        config = SimpleNamespace(app_base_path="/produccion/")
        self.assertEqual(app_base_path(config), "/produccion")
        self.assertEqual(external_path("/", config), "/produccion/")
        self.assertEqual(
            external_path("/api/auth/microsoft/callback", config),
            "/produccion/api/auth/microsoft/callback",
        )
        self.assertEqual(session_cookie_path(config), "/produccion")

    def test_internal_path_strips_only_the_configured_base(self) -> None:
        config = SimpleNamespace(app_base_path="/produccion")
        self.assertEqual(internal_path("/produccion/qc?tab=open", config), "/qc?tab=open")
        self.assertEqual(internal_path("/gantt/qc", config), "/gantt/qc")
        self.assertEqual(
            internal_path("https://evil.example/produccion/qc", config),
            "https://evil.example/produccion/qc",
        )


if __name__ == "__main__":
    unittest.main()
