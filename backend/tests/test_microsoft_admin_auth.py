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
from app.models.admin import AdminSession, AdminUser, CompanyAccessSession
from app.services import company_access, microsoft_auth


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


def configured_settings(*, app_base_path: str = "") -> SimpleNamespace:
    return SimpleNamespace(
        microsoft_login_enabled=True,
        microsoft_tenant_id="tenant-id",
        microsoft_client_id="client-id",
        microsoft_client_secret="client-secret",
        microsoft_redirect_uri="http://localhost:5173/api/auth/microsoft/callback",
        company_access_session_hours=12,
        app_base_path=app_base_path,
        session_cookie_secure=bool(app_base_path),
    )


class MicrosoftAuthHelperTests(unittest.TestCase):
    def test_authorize_url_uses_tenant_and_minimal_scopes(self) -> None:
        config = microsoft_auth.MicrosoftAuthConfig(
            tenant_id="tenant-id",
            client_id="client-id",
            client_secret="secret",
            redirect_uri="https://production.example/api/auth/microsoft/callback",
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
            "/api/auth/microsoft/login",
            headers=[
                (b"host", b"backend:2340"),
                (b"x-forwarded-proto", b"https"),
                (b"x-forwarded-host", b"production.example"),
            ],
        )

        with patch.object(admin_auth, "settings", configured_settings()):
            self.assertEqual(
                admin_auth._microsoft_redirect_uri(request),
                "https://production.example/api/auth/microsoft/callback",
            )

    def test_redirect_uri_and_return_path_support_subpath_deployment(self) -> None:
        request = make_request(
            "/api/auth/microsoft/login",
            headers=[
                (b"host", b"backend:2340"),
                (b"x-forwarded-proto", b"https"),
                (b"x-forwarded-host", b"production.example"),
            ],
        )
        with patch.object(
            admin_auth, "settings", configured_settings(app_base_path="/produccion")
        ):
            self.assertEqual(
                admin_auth._microsoft_redirect_uri(request),
                "https://production.example/produccion/api/auth/microsoft/callback",
            )
            self.assertEqual(
                admin_auth._normalize_return_path("/produccion/qc?tab=open"),
                "/qc?tab=open",
            )

    def test_company_entry_uses_role_appropriate_defaults(self) -> None:
        self.assertEqual(
            admin_auth._default_role_path(SimpleNamespace(role="QC")), "/qc"
        )
        self.assertEqual(
            admin_auth._default_role_path(SimpleNamespace(role="Prevencionista")),
            "/utility/protocols",
        )
        self.assertEqual(
            admin_auth._default_role_path(SimpleNamespace(role="Admin")), "/admin"
        )


class MicrosoftAdminFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        AdminUser.__table__.create(self.engine)
        AdminSession.__table__.create(self.engine)
        CompanyAccessSession.__table__.create(self.engine)

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_login_redirect_sets_state_and_preserves_destination(self) -> None:
        request = make_request("/api/auth/microsoft/login")
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

    def test_company_login_preserves_worker_destination_and_purpose(self) -> None:
        request = make_request("/api/auth/microsoft/login")
        with patch.object(admin_auth, "settings", configured_settings()):
            response = asyncio.run(
                admin_auth.microsoft_login(
                    request, "/worker/stationWorkspace", "company"
                )
            )

        cookies = response.headers.getlist("set-cookie")
        self.assertTrue(
            any(
                cookie.startswith("admin_ms_oauth_next=")
                and "/worker/stationWorkspace" in cookie
                for cookie in cookies
            )
        )
        self.assertTrue(
            any(
                cookie.startswith("admin_ms_oauth_purpose=company")
                for cookie in cookies
            )
        )

    def test_callback_does_not_redeem_code_before_company_storage_is_ready(self) -> None:
        with Session(self.engine) as db:
            request = make_request(
                "/api/auth/microsoft/callback",
                query="code=auth-code&state=state-token",
                headers=[
                    (b"host", b"localhost:5173"),
                    (
                        b"cookie",
                        b"admin_ms_oauth_state=state-token; "
                        b"admin_ms_oauth_next=/admin",
                    ),
                ],
            )
            exchange = AsyncMock(return_value="access-token")
            with (
                patch.object(admin_auth, "settings", configured_settings()),
                patch.object(company_access, "storage_is_ready", return_value=False),
                patch.object(microsoft_auth, "exchange_code_for_token", exchange),
            ):
                response = asyncio.run(admin_auth.microsoft_callback(request, db))

            self.assertEqual(response.status_code, 303)
            self.assertIn("auth_error=", response.headers["location"])
            exchange.assert_not_awaited()

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
                "/api/auth/microsoft/callback",
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
            self.assertEqual(
                db.scalar(select(func.count()).select_from(CompanyAccessSession)), 1
            )
            self.assertTrue(
                any(
                    cookie.startswith("admin_session=")
                    for cookie in response.headers.getlist("set-cookie")
                )
            )

    def test_callback_gives_company_access_only_to_inactive_admin_email(self) -> None:
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
                "/api/auth/microsoft/callback",
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
            self.assertEqual(response.headers["location"], "/login")
            self.assertEqual(
                db.scalar(select(func.count()).select_from(AdminSession)), 0
            )
            self.assertEqual(
                db.scalar(select(func.count()).select_from(CompanyAccessSession)), 1
            )
            self.assertTrue(
                any(
                    cookie.startswith("company_access_session=")
                    for cookie in response.headers.getlist("set-cookie")
                )
            )

    def test_company_gate_redirects_registered_qc_user_to_qc(self) -> None:
        with Session(self.engine) as db:
            db.add(
                AdminUser(
                    first_name="Quinn",
                    last_name="Quality",
                    email="quinn@example.com",
                    pin="1234",
                    role="QC",
                    active=True,
                )
            )
            db.commit()

            request = make_request(
                "/api/auth/microsoft/callback",
                query="code=auth-code&state=state-token",
                headers=[
                    (b"host", b"localhost:5173"),
                    (
                        b"cookie",
                        b"admin_ms_oauth_state=state-token; "
                        b"admin_ms_oauth_next=/login; "
                        b"admin_ms_oauth_purpose=company",
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
                    AsyncMock(return_value="quinn@example.com"),
                ),
            ):
                response = asyncio.run(admin_auth.microsoft_callback(request, db))

            self.assertEqual(response.headers["location"], "/qc")
            self.assertEqual(
                db.scalar(select(func.count()).select_from(AdminSession)), 1
            )
            self.assertEqual(
                db.scalar(select(func.count()).select_from(CompanyAccessSession)), 1
            )

    def test_company_gate_allows_unregistered_company_email_into_login_only(self) -> None:
        with Session(self.engine) as db:
            request = make_request(
                "/api/auth/microsoft/callback",
                query="code=auth-code&state=state-token",
                headers=[
                    (b"host", b"localhost:5173"),
                    (
                        b"cookie",
                        b"admin_ms_oauth_state=state-token; "
                        b"admin_ms_oauth_next=/; "
                        b"admin_ms_oauth_purpose=company",
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
                    AsyncMock(return_value="employee@example.com"),
                ),
            ):
                response = asyncio.run(admin_auth.microsoft_callback(request, db))

            self.assertEqual(response.headers["location"], "/login")
            self.assertEqual(
                db.scalar(select(func.count()).select_from(AdminSession)), 0
            )
            self.assertEqual(
                db.scalar(select(func.count()).select_from(CompanyAccessSession)), 1
            )


if __name__ == "__main__":
    unittest.main()
