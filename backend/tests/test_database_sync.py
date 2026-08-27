from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from starlette.requests import Request

from app.core.config import Settings
from app.services import backups, company_access, database_sync


def _request(
    *,
    host: str = "localhost:5173",
    client: str = "127.0.0.1",
    forwarded_for: str | None = None,
) -> Request:
    headers = [(b"host", host.encode("ascii"))]
    if forwarded_for is not None:
        headers.append((b"x-forwarded-for", forwarded_for.encode("ascii")))
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/api/backups/sync-status",
            "raw_path": b"/api/backups/sync-status",
            "query_string": b"",
            "headers": headers,
            "client": (client, 12345),
            "server": ("127.0.0.1", 2340),
        }
    )


def _config(temp_dir: Path, **overrides) -> Settings:
    values = {
        "backup_dir": temp_dir,
        "database_url": "postgresql+psycopg2://postgres:postgres@localhost:5432/scp",
        "database_sync_pull_enabled": True,
        "database_sync_export_enabled": True,
        "database_sync_source_url": "https://aplicacionph.dyndns.org/produccion",
        "database_sync_token": "s" * 48,
        "database_sync_timeout_seconds": 30,
        "database_sync_max_bytes": 1024,
    }
    values.update(overrides)
    return Settings(**values)


class LocalDevelopmentRequestTests(unittest.TestCase):
    def test_loopback_forwarded_by_trusted_dev_proxy_is_local(self) -> None:
        request = _request(forwarded_for="127.0.0.1")

        self.assertTrue(company_access.is_local_development_request(request))

    def test_forwarded_loopback_from_untrusted_peer_is_not_local(self) -> None:
        request = _request(
            client="10.0.10.25",
            forwarded_for="127.0.0.1",
        )

        self.assertFalse(company_access.is_local_development_request(request))


class DatabaseSyncConfigurationTests(unittest.TestCase):
    def test_status_requires_explicit_pull_opt_in_and_strong_token(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            disabled = _config(
                Path(temp_dir),
                database_sync_pull_enabled=False,
            )
            weak_token = _config(
                Path(temp_dir),
                database_sync_token="short",
            )

            self.assertFalse(database_sync.database_sync_status(disabled)["available"])
            self.assertFalse(database_sync.database_sync_status(weak_token)["available"])

    def test_export_url_preserves_application_base_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = _config(Path(temp_dir))

            self.assertEqual(
                database_sync.export_url(config),
                "https://aplicacionph.dyndns.org/produccion/api/backups/sync-export",
            )

    def test_export_authorization_requires_flag_and_exact_token(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = _config(Path(temp_dir))
            disabled = _config(
                Path(temp_dir),
                database_sync_export_enabled=False,
            )

            self.assertTrue(
                database_sync.export_is_authorized("s" * 48, config)
            )
            self.assertFalse(database_sync.export_is_authorized("x" * 48, config))
            self.assertFalse(
                database_sync.export_is_authorized("s" * 48, disabled)
            )


class DatabaseSyncDownloadTests(unittest.TestCase):
    def test_download_streams_valid_custom_dump_with_token(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = _config(Path(temp_dir))
            output_path = Path(temp_dir) / "download.dump"

            def handler(request: httpx.Request) -> httpx.Response:
                self.assertEqual(
                    request.headers[database_sync.SYNC_TOKEN_HEADER],
                    "s" * 48,
                )
                return httpx.Response(200, content=b"PGDMP-test-dump")

            transport = httpx.MockTransport(handler)

            real_client = httpx.Client
            def client_factory(**kwargs):
                return real_client(transport=transport, **kwargs)

            with patch.object(
                database_sync.httpx,
                "Client",
                side_effect=client_factory,
            ):
                size = database_sync._download_production_dump(output_path, config)

            self.assertEqual(size, len(b"PGDMP-test-dump"))
            self.assertEqual(output_path.read_bytes(), b"PGDMP-test-dump")

    def test_invalid_download_is_removed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = _config(Path(temp_dir))
            output_path = Path(temp_dir) / "download.dump"
            transport = httpx.MockTransport(
                lambda _request: httpx.Response(200, content=b"not-a-dump")
            )

            real_client = httpx.Client
            def client_factory(**kwargs):
                return real_client(transport=transport, **kwargs)

            with patch.object(
                database_sync.httpx,
                "Client",
                side_effect=client_factory,
            ):
                with self.assertRaises(database_sync.SyncDownloadError):
                    database_sync._download_production_dump(output_path, config)

            self.assertFalse(output_path.exists())


class DatabaseSyncOrchestrationTests(unittest.TestCase):
    def test_sync_restores_download_and_removes_temporary_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = _config(Path(temp_dir))
            restore_result = {
                "primary_db": "scp",
                "archived_db": "scp_restore_20260101_010101",
                "restored_from": config.database_sync_source_url,
                "checkpoint_backup": {
                    "filename": "checkpoint.dump",
                    "size_bytes": 10,
                    "created_at": "2026-01-01T01:01:01",
                    "label": "checkpoint",
                },
                "pruned": [],
            }

            def download(path: Path, _config: Settings) -> int:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"PGDMP-test")
                return len(b"PGDMP-test")

            with (
                patch.object(
                    database_sync,
                    "_download_production_dump",
                    side_effect=download,
                ),
                patch.object(
                    database_sync.backup_service,
                    "restore_dump_file",
                    return_value=restore_result.copy(),
                ) as restore_mock,
                patch.object(database_sync.application_engine, "dispose") as dispose_mock,
            ):
                result = database_sync.sync_from_production(config)

            self.assertEqual(result["downloaded_size_bytes"], len(b"PGDMP-test"))
            self.assertEqual(result["source_url"], config.database_sync_source_url)
            self.assertGreaterEqual(dispose_mock.call_count, 2)
            restored_path = restore_mock.call_args.args[0]
            self.assertFalse(restored_path.exists())

    def test_checkpoint_creation_can_defer_retention_pruning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = _config(Path(temp_dir))

            def fake_dump(path: Path) -> Path:
                path.write_bytes(b"PGDMP-test")
                return path

            with (
                patch.object(backups, "settings", config),
                patch.object(backups, "_run_pg_dump", side_effect=fake_dump),
                patch.object(backups, "prune_backups") as prune_mock,
            ):
                record, _settings, pruned = backups.create_backup(
                    "checkpoint",
                    prune=False,
                )

            self.assertTrue(record["filename"].endswith("_checkpoint.dump"))
            self.assertEqual(pruned, [])
            prune_mock.assert_not_called()

    def test_manual_restore_rejects_path_traversal(self) -> None:
        with self.assertRaisesRegex(ValueError, "Invalid backup filename"):
            backups.restore_backup("../outside.dump")


if __name__ == "__main__":
    unittest.main()
