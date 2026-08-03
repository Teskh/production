from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.responses import PlainTextResponse
from starlette.requests import Request

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.models.admin import CompanyAccessSession
from app.services import company_access
from app import main


def network_settings() -> SimpleNamespace:
    return SimpleNamespace(
        trusted_lan_cidrs="10.0.10.0/23",
        trusted_proxy_cidrs="127.0.0.0/8,::1/128",
        company_access_session_hours=12,
    )


def make_request(
    client: str,
    *,
    host: str = "exampleurl.com",
    forwarded_for: str | None = None,
    forwarded_header: str = "x-forwarded-for",
    path: str = "/login",
    method: str = "GET",
) -> Request:
    headers = [(b"host", host.encode())]
    if forwarded_for:
        headers.append((forwarded_header.encode(), forwarded_for.encode()))
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": method,
            "scheme": "https",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": headers,
            "server": ("exampleurl.com", 443),
            "client": (client, 50000),
        }
    )


class CompanyAccessNetworkTests(unittest.TestCase):
    def test_production_23_trusts_both_ten_and_eleven_ranges(self) -> None:
        config = network_settings()
        self.assertTrue(
            company_access.is_trusted_network_request(
                make_request("10.0.10.25"), config
            )
        )
        self.assertTrue(
            company_access.is_trusted_network_request(
                make_request("10.0.11.250"), config
            )
        )
        self.assertFalse(
            company_access.is_trusted_network_request(
                make_request("10.0.12.1"), config
            )
        )

    def test_localhost_5173_is_always_development_trusted(self) -> None:
        self.assertTrue(
            company_access.is_trusted_network_request(
                make_request("127.0.0.1", host="localhost:5173"),
                network_settings(),
            )
        )

    def test_proxy_uses_forwarded_lan_client(self) -> None:
        request = make_request(
            "127.0.0.1",
            forwarded_for="10.0.11.42",
        )
        self.assertTrue(
            company_access.is_trusted_network_request(request, network_settings())
        )

    def test_proxy_can_use_a_private_internal_client_header(self) -> None:
        config = network_settings()
        config.trusted_client_ip_header = "x-iis-client-ip"
        request = make_request(
            "127.0.0.1",
            forwarded_for="203.0.113.25",
            forwarded_header="x-iis-client-ip",
        )
        self.assertFalse(company_access.is_trusted_network_request(request, config))

    def test_public_client_through_local_proxy_is_not_treated_as_localhost(self) -> None:
        request = make_request(
            "127.0.0.1",
            forwarded_for="203.0.113.25",
        )
        self.assertFalse(
            company_access.is_trusted_network_request(request, network_settings())
        )

    def test_untrusted_peer_cannot_spoof_forwarded_lan_ip(self) -> None:
        request = make_request(
            "203.0.113.25",
            forwarded_for="10.0.10.42",
        )
        self.assertFalse(
            company_access.is_trusted_network_request(request, network_settings())
        )


class CompanyAccessSessionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        CompanyAccessSession.__table__.create(self.engine)

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_created_session_validates_by_cookie_token(self) -> None:
        with Session(self.engine) as db:
            token, _ = company_access.create_company_access_session(
                "Employee@Example.com", db, network_settings()
            )
            self.assertTrue(company_access.has_valid_company_access(token, db))
            self.assertFalse(company_access.has_valid_company_access("wrong", db))


class CompanyAccessMiddlewareTests(unittest.TestCase):
    def test_localhost_reaches_application_without_company_session(self) -> None:
        call_next = AsyncMock(return_value=PlainTextResponse("ok"))
        response = asyncio.run(
            main.enforce_company_access(
                make_request("127.0.0.1", host="localhost:5173"),
                call_next,
            )
        )
        self.assertEqual(response.status_code, 200)
        call_next.assert_awaited_once()

    def test_external_page_redirects_to_company_microsoft_login(self) -> None:
        session_context = MagicMock()
        session_context.__enter__.return_value = MagicMock()
        session_context.__exit__.return_value = False
        with (
            patch.object(main, "SessionLocal", return_value=session_context),
            patch.object(company_access, "has_valid_company_access", return_value=False),
        ):
            response = asyncio.run(
                main.enforce_company_access(
                    make_request("203.0.113.25"),
                    AsyncMock(return_value=PlainTextResponse("unexpected")),
                )
            )

        self.assertEqual(response.status_code, 303)
        self.assertIn("/api/auth/microsoft/login?", response.headers["location"])
        self.assertIn("purpose=company", response.headers["location"])

    def test_external_api_returns_login_url_without_redirecting_fetch(self) -> None:
        session_context = MagicMock()
        session_context.__enter__.return_value = MagicMock()
        session_context.__exit__.return_value = False
        with (
            patch.object(main, "SessionLocal", return_value=session_context),
            patch.object(company_access, "has_valid_company_access", return_value=False),
        ):
            response = asyncio.run(
                main.enforce_company_access(
                    make_request("203.0.113.25", path="/api/workers"),
                    AsyncMock(return_value=PlainTextResponse("unexpected")),
                )
            )

        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
