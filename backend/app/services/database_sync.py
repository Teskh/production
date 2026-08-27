from __future__ import annotations

import os
import secrets
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.core.config import BASE_DIR, Settings, settings
from app.db.session import engine as application_engine
from app.services import backups as backup_service

SYNC_EXPORT_PATH = "/api/backups/sync-export"
SYNC_TOKEN_HEADER = "X-SCP-Database-Sync-Token"
_DUMP_MAGIC = b"PGDMP"
_SESSION_TABLES = (
    "admin_sessions",
    "company_access_sessions",
    "worker_sessions",
    "worker_supervisor_sessions",
)


class SyncConfigurationError(ValueError):
    pass


class SyncDownloadError(RuntimeError):
    pass


def _normalized_source_url(config: Settings = settings) -> str:
    source_url = config.database_sync_source_url.strip().rstrip("/")
    parsed = urlsplit(source_url)
    if (
        parsed.scheme.lower() != "https"
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise SyncConfigurationError(
            "DATABASE_SYNC_SOURCE_URL must be a plain HTTPS application URL."
        )
    return source_url


def database_sync_status(config: Settings = settings) -> dict[str, object]:
    source_url = config.database_sync_source_url.strip().rstrip("/")
    if not config.database_sync_pull_enabled:
        return {
            "available": False,
            "source_url": source_url,
            "reason": "Production database sync is disabled on this installation.",
        }
    if not config.database_sync_token or len(config.database_sync_token) < 32:
        return {
            "available": False,
            "source_url": source_url,
            "reason": "DATABASE_SYNC_TOKEN must be configured with at least 32 characters.",
        }
    try:
        source_url = _normalized_source_url(config)
    except SyncConfigurationError as exc:
        return {
            "available": False,
            "source_url": source_url,
            "reason": str(exc),
        }
    return {"available": True, "source_url": source_url, "reason": None}


def export_is_authorized(
    supplied_token: str | None,
    config: Settings = settings,
) -> bool:
    expected_token = config.database_sync_token
    return bool(
        config.database_sync_export_enabled
        and expected_token
        and len(expected_token) >= 32
        and supplied_token
        and secrets.compare_digest(supplied_token, expected_token)
    )


def export_url(config: Settings = settings) -> str:
    return f"{_normalized_source_url(config)}{SYNC_EXPORT_PATH}"


def remove_temporary_dump(path: Path) -> None:
    Path(path).unlink(missing_ok=True)


def create_export_dump(config: Settings = settings) -> Path:
    export_dir = Path(config.backup_dir) / ".sync_exports"
    filename = (
        f"production_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}_"
        f"{uuid.uuid4().hex[:8]}.dump"
    )
    return backup_service.create_database_dump(export_dir / filename)


def _download_production_dump(
    output_path: Path,
    config: Settings = settings,
) -> int:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    max_bytes = max(int(config.database_sync_max_bytes), 1)
    timeout_seconds = max(float(config.database_sync_timeout_seconds), 1.0)
    timeout = httpx.Timeout(timeout_seconds, connect=min(timeout_seconds, 30.0))

    try:
        with httpx.Client(
            timeout=timeout,
            follow_redirects=False,
            headers={SYNC_TOKEN_HEADER: config.database_sync_token or ""},
        ) as client:
            with client.stream("POST", export_url(config)) as response:
                if response.status_code != 200:
                    raise SyncDownloadError(
                        f"Production export returned HTTP {response.status_code}."
                    )
                content_length = response.headers.get("content-length")
                if content_length:
                    try:
                        declared_size = int(content_length)
                    except ValueError:
                        declared_size = 0
                    if declared_size > max_bytes:
                        raise SyncDownloadError(
                            "Production database dump exceeds DATABASE_SYNC_MAX_BYTES."
                        )

                downloaded = 0
                with output_path.open("xb") as handle:
                    for chunk in response.iter_bytes():
                        downloaded += len(chunk)
                        if downloaded > max_bytes:
                            raise SyncDownloadError(
                                "Production database dump exceeds DATABASE_SYNC_MAX_BYTES."
                            )
                        handle.write(chunk)
    except SyncDownloadError:
        output_path.unlink(missing_ok=True)
        raise
    except (httpx.HTTPError, OSError) as exc:
        output_path.unlink(missing_ok=True)
        raise SyncDownloadError(f"Could not download the production database: {exc}") from exc

    try:
        with output_path.open("rb") as handle:
            if handle.read(len(_DUMP_MAGIC)) != _DUMP_MAGIC:
                raise SyncDownloadError(
                    "Production returned a file that is not a PostgreSQL custom dump."
                )
    except Exception:
        output_path.unlink(missing_ok=True)
        raise
    return output_path.stat().st_size


def _database_url_for(name: str, config: Settings = settings) -> str:
    return make_url(config.database_url).set(database=name).render_as_string(
        hide_password=False
    )


def _run_local_migrations(name: str, config: Settings = settings) -> None:
    migration_env = os.environ.copy()
    migration_env["DATABASE_URL"] = _database_url_for(name, config)
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            str(BASE_DIR / "alembic.ini"),
            "upgrade",
            "head",
        ],
        cwd=BASE_DIR,
        env=migration_env,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = (result.stderr.strip() or result.stdout.strip() or "unknown error")[-2000:]
        raise RuntimeError(f"Local migrations failed on the restored database: {detail}")


def _sanitize_and_validate_database(
    name: str,
    config: Settings = settings,
) -> None:
    restored_engine = create_engine(_database_url_for(name, config), pool_pre_ping=True)
    try:
        with restored_engine.begin() as conn:
            for table_name in _SESSION_TABLES:
                conn.execute(text(f'DELETE FROM "{table_name}"'))

        with restored_engine.connect() as conn:
            admin_table = conn.execute(
                text("SELECT to_regclass('public.admin_users')")
            ).scalar_one_or_none()
            migration_row = conn.execute(
                text("SELECT version_num FROM alembic_version LIMIT 1")
            ).scalar_one_or_none()
        if admin_table is None or migration_row is None:
            raise RuntimeError(
                "Restored database validation failed after applying local migrations."
            )
    finally:
        restored_engine.dispose()


def _prepare_restored_database(name: str, config: Settings = settings) -> None:
    _run_local_migrations(name, config)
    _sanitize_and_validate_database(name, config)


def sync_from_production(config: Settings = settings) -> dict[str, object]:
    status_data = database_sync_status(config)
    if not status_data["available"]:
        raise SyncConfigurationError(str(status_data["reason"]))

    source_url = str(status_data["source_url"])
    download_dir = Path(config.backup_dir) / ".sync_downloads"
    download_path = download_dir / (
        f"production_sync_{datetime.now().strftime('%Y%m%d_%H%M%S')}_"
        f"{uuid.uuid4().hex[:8]}.dump"
    )

    downloaded_size = _download_production_dump(download_path, config)
    application_engine.dispose()
    try:
        result = backup_service.restore_dump_file(
            download_path,
            restored_from=source_url,
            force_disconnect=True,
            checkpoint_label="Pre-production sync checkpoint",
            prepare_database=lambda name: _prepare_restored_database(name, config),
        )
        result["source_url"] = source_url
        result["downloaded_size_bytes"] = downloaded_size
        return result
    finally:
        application_engine.dispose()
        remove_temporary_dump(download_path)
