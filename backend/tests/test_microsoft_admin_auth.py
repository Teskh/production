from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from starlette.requests import Request

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.routes import admin_auth
from app.models.admin import AdminSession, AdminUser
from app.services import microsoft_auth


def make_request(
    path: str,
    *,
    query: str = "",
    headers: list[tuple[bytes, bytes]] | None = None,
) -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "headers": headers or [(b"host", b"localhost:5173")],
            "server": ("localhost", 5173),
            "client": ("127.0.0.1", 50000),
        }
    )


def configured_settings() -> SimpleNamespace:
    return SimpleNamespace(
        microsoft_login_enabled=True,
        microsoft_tenant_id="tenant-id",
        microsoft_client_id="client-id",
        microsoft_client_secret="client-secret",
        microsoft_redirect_uri="http://localhost:5173/api/admin/microsoft/callback",
    )


class MicrosoftAuthHelperTests(unittest.TestCase):
    def test_authorize_url_uses_tenant_and_minimal_scopes(self) -> None:
        config = microsoft_auth.MicrosoftAuthConfig(
            tenant_id="tenant-id",
            client_id="client-id",
            client_secret="secret",
            redirect_uri="https://production.example/api/admin/microsoft/callback",
        )

        parsed = urlsplit(microsoft_auth.authorize_url(config, state="state-token"))
        query = parse_qs(parsed.query)

        self.assertEqual(
            parsed.path, "/tenant-id/oauth2/v2.0/authorize"
        )
        self.assertEqual(query["state"], ["state-token"])
        self.assertEqual(query["response_type"], ["code"])
        self.assertEqual(
            query["scope"], ["openid profile email User.Read"]
        )

    def test_return_path_rejects_external_redirects(self) -> None:
        self.assertEqual(admin_auth._normalize_return_path("https://evil.example"), "/admin")
        self.assertEqual(admin_auth._normalize_return_path("//evil.example/qc"), "/admin")
        self.assertEqual(admin_auth._normalize_return_path("/worker"), "/admin")
        self.assertEqual(admin_auth._normalize_return_path("/qc?tab=open"), "/qc?tab=open")

    def test_redirect_uri_honors_forwarded_origin(self) -> None:
        request = make_request(
            "/api/admin/microsoft/login",
            headers=[
                (b"host", b"backend:2340"),
                (b"x-forwarded-proto", b"https"),
                (b"x-forwarded-host", b"production.example"),
            ],
        )

        self.assertEqual(
            admin_auth._microsoft_redirect_uri(request),
            "https://production.example/api/admin/microsoft/callback",
        )


class MicrosoftAdminFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        AdminUser.__table__.create(self.engine)
        AdminSession.__table__.create(self.engine)

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_login_redirect_sets_state_and_preserves_destination(self) -> None:
        request = make_request("/api/admin/microsoft/login")
        with patch.object(admin_auth, "settings", configured_settings()):
            response = asyncio.run(admin_auth.microsoft_login(request, "/qc"))

        self.assertEqual(response.status_code, 303)
        self.assertIn("login.microsoftonline.com/tenant-id", response.headers["location"])
        cookies = response.headers.getlist("set-cookie")
        self.assertTrue(any(cookie.startswith("admin_ms_oauth_state=") for cookie in cookies))
        self.assertTrue(
            any(
                cookie.startswith("admin_ms_oauth_next=") and "/qc" in cookie
                for cookie in cookies
            )
        )

    def test_callback_matches_active_email_and_creates_existing_admin_session(self) -> None:
        with Session(self.engine) as db:
            db.add(
                AdminUser(
                    first_name="Ada",
                    last_name="Admin",
                    email="ada@example.com",
                    pin="1234",
                    role="QC",
                    active=True,
                )
            )
            db.commit()

            request = make_request(
                "/api/admin/microsoft/callback",
                query="code=auth-code&state=state-token",
                headers=[
                    (b"host", b"localhost:5173"),
                    (
                        b"cookie",
                        b"admin_ms_oauth_state=state-token; admin_ms_oauth_next=/qc",
                    ),
                ],
            )
            with (
                patch.object(admin_auth, "settings", configured_settings()),
                patch.object(
                    microsoft_auth,
                    "exchange_code_for_token",
                    AsyncMock(return_value="access-token"),
                ),
                patch.object(
                    microsoft_auth,
                    "fetch_user_email",
                    AsyncMock(return_value="ADA@EXAMPLE.COM"),
                ),
            ):
                response = asyncio.run(admin_auth.microsoft_callback(request, db))

            self.assertEqual(response.status_code, 303)
            self.assertEqual(response.headers["location"], "/qc")
            self.assertEqual(
                db.scalar(select(func.count()).select_from(AdminSession)), 1
            )
            self.assertTrue(
                any(
                    cookie.startswith("admin_session=")
                    for cookie in response.headers.getlist("set-cookie")
                )
            )

    def test_callback_rejects_inactive_admin_email(self) -> None:
        with Session(self.engine) as db:
            db.add(
                AdminUser(
                    first_name="Inactive",
                    last_name="Admin",
                    email="inactive@example.com",
                    pin="1234",
                    role="QC",
                    active=False,
                )
            )
            db.commit()

            request = make_request(
                "/api/admin/microsoft/callback",
                query="code=auth-code&state=state-token",
                headers=[
                    (b"host", b"localhost:5173"),
                    (
                        b"cookie",
                        b"admin_ms_oauth_state=state-token; admin_ms_oauth_next=/admin",
                    ),
                ],
            )
            with (
                patch.object(admin_auth, "settings", configured_settings()),
                patch.object(
                    microsoft_auth,
                    "exchange_code_for_token",
                    AsyncMock(return_value="access-token"),
                ),
                patch.object(
                    microsoft_auth,
                    "fetch_user_email",
                    AsyncMock(return_value="inactive@example.com"),
                ),
            ):
                response = asyncio.run(admin_auth.microsoft_callback(request, db))

            self.assertEqual(response.status_code, 303)
            self.assertIn("auth_error=", response.headers["location"])
            self.assertEqual(
                db.scalar(select(func.count()).select_from(AdminSession)), 0
            )


if __name__ == "__main__":
    unittest.main()
