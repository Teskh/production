from __future__ import annotations

import copy
import json
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.core.config import settings

DEFAULT_SETTINGS: dict[str, Any] = {
    "enabled": False,
    "interval_minutes": 1440,
    "retention_count": 14,
    "last_backup_at": None,
}

DEFAULT_METADATA: dict[str, Any] = {"items": {}}

VALID_DB_NAME = re.compile(r"^[A-Za-z0-9_]+$")
VALID_BACKUP_SUFFIXES = {".dump"}
LISTABLE_BACKUP_SUFFIXES = {".dump", ".sql"}


@dataclass(frozen=True)
class BackupPaths:
    root: Path
    settings_path: Path
    metadata_path: Path


def get_backup_paths() -> BackupPaths:
    root = Path(settings.backup_dir)
    root.mkdir(parents=True, exist_ok=True)
    return BackupPaths(
        root=root,
        settings_path=root / "backup_settings.json",
        metadata_path=root / "backup_metadata.json",
    )


def _load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return copy.deepcopy(default)
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return copy.deepcopy(default)
    if not isinstance(data, dict):
        return copy.deepcopy(default)
    merged = copy.deepcopy(default)
    merged.update(data)
    return merged


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)


def _sanitize_label(label: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]+", "-", label.strip())
    return safe.strip("-")


def _validate_db_name(name: str) -> None:
    if not VALID_DB_NAME.match(name):
        raise ValueError("Database name must contain only letters, numbers, or underscores.")


def _quote_identifier(name: str) -> str:
    return f'"{name}"'


def _pg_env(password: str | None) -> dict[str, str]:
    env = os.environ.copy()
    if password:
        env["PGPASSWORD"] = password
    return env


def _resolve_db_connection() -> tuple[str, str | None, str | None, int | None, str | None]:
    url = make_url(settings.database_url)
    if not url.database:
        raise ValueError("DATABASE_URL must include a database name.")
    return (
        url.database,
        url.username,
        url.host,
        url.port,
        url.password,
    )


def _admin_engine():
    url = make_url(settings.database_url)
    admin_url = url.set(database=settings.backup_admin_db)
    return create_engine(admin_url, isolation_level="AUTOCOMMIT")


def _terminate_connections(conn, db_names: list[str]) -> None:
    if not db_names:
        return
    conn.execute(
        text(
            "SELECT pg_terminate_backend(pid) "
            "FROM pg_stat_activity "
            "WHERE datname = ANY(:db_names) "
            "AND pid <> pg_backend_pid()"
        ),
        {"db_names": db_names},
    )


def _database_exists(conn, name: str) -> bool:
    result = conn.execute(
        text("SELECT 1 FROM pg_database WHERE datname = :name"),
        {"name": name},
    ).scalar_one_or_none()
    return result is not None


def _create_database(conn, name: str, owner: str | None) -> None:
    if owner:
        conn.execute(
            text(
                f"CREATE DATABASE {_quote_identifier(name)} "
                f"OWNER {_quote_identifier(owner)}"
            )
        )
    else:
        conn.execute(text(f"CREATE DATABASE {_quote_identifier(name)}"))


def _drop_database(conn, name: str) -> None:
    conn.execute(text(f"DROP DATABASE IF EXISTS {_quote_identifier(name)}"))


def _restore_db_name(base: str, timestamp: datetime) -> str:
    suffix = timestamp.strftime("%Y%m%d_%H%M%S")
    return f"{base}_restore_{suffix}"


def _local_now() -> datetime:
    return datetime.now().astimezone()


def _local_from_timestamp(timestamp: float) -> datetime:
    return datetime.fromtimestamp(timestamp).astimezone()


def load_backup_settings() -> dict[str, Any]:
    paths = get_backup_paths()
    data = _load_json(paths.settings_path, DEFAULT_SETTINGS)
    if not isinstance(data.get("enabled"), bool):
        data["enabled"] = DEFAULT_SETTINGS["enabled"]
    if not isinstance(data.get("interval_minutes"), int) or data["interval_minutes"] < 1:
        data["interval_minutes"] = DEFAULT_SETTINGS["interval_minutes"]
    if not isinstance(data.get("retention_count"), int) or data["retention_count"] < 1:
        data["retention_count"] = DEFAULT_SETTINGS["retention_count"]
    return data


def save_backup_settings(payload: dict[str, Any]) -> dict[str, Any]:
    paths = get_backup_paths()
    data = copy.deepcopy(DEFAULT_SETTINGS)
    data.update(payload)
    _save_json(paths.settings_path, data)
    return data


def update_backup_settings(update: dict[str, Any]) -> dict[str, Any]:
    data = load_backup_settings()
    for key, value in update.items():
        if value is not None:
            data[key] = value
    data = save_backup_settings(data)
    if "retention_count" in update:
        retention_count = int(data.get("retention_count") or 0)
        prune_backups(retention_count)
    return data


def load_backup_metadata() -> dict[str, Any]:
    paths = get_backup_paths()
    data = _load_json(paths.metadata_path, DEFAULT_METADATA)
    if not isinstance(data.get("items"), dict):
        data["items"] = {}
    return data


def save_backup_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    paths = get_backup_paths()
    data = copy.deepcopy(DEFAULT_METADATA)
    data.update(payload)
    _save_json(paths.metadata_path, data)
    return data


def list_backups() -> list[dict[str, Any]]:
    paths = get_backup_paths()
    metadata = load_backup_metadata()
    items = metadata.get("items", {})
    backups: list[dict[str, Any]] = []
    for path in paths.root.iterdir():
        if not path.is_file():
            continue
        if path.suffix not in LISTABLE_BACKUP_SUFFIXES:
            continue
        stats = path.stat()
        created_at = _local_from_timestamp(stats.st_mtime)
        info = items.get(path.name, {})
        backups.append(
            {
                "filename": path.name,
                "size_bytes": stats.st_size,
                "created_at": created_at,
                "label": info.get("label"),
            }
        )
    backups.sort(key=lambda item: item["created_at"], reverse=True)
    return backups


def prune_backups(retention_count: int) -> list[str]:
    if retention_count <= 0:
        return []
    backups = list_backups()
    if len(backups) <= retention_count:
        return []
    to_remove = backups[retention_count:]
    paths = get_backup_paths()
    metadata = load_backup_metadata()
    removed: list[str] = []
    for backup in to_remove:
        filename = backup["filename"]
        path = paths.root / filename
        if path.exists():
            path.unlink()
        metadata.get("items", {}).pop(filename, None)
        removed.append(filename)
    save_backup_metadata(metadata)
    return removed


def create_backup(label: str | None = None) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    db_name, username, host, port, password = _resolve_db_connection()
    timestamp = _local_now()
    safe_label = _sanitize_label(label) if label else ""
    label_part = f"_{safe_label}" if safe_label else ""
    filename = f"{db_name}_backup_{timestamp.strftime('%Y%m%d_%H%M%S')}{label_part}.dump"

    paths = get_backup_paths()
    output_path = paths.root / filename

    cmd = [
        settings.pg_dump_path,
        "--format=custom",
        "--file",
        str(output_path),
        "--no-owner",
        "--no-privileges",
    ]
    if host:
        cmd.extend(["--host", host])
    if port:
        cmd.extend(["--port", str(port)])
    if username:
        cmd.extend(["--username", username])
    cmd.append(db_name)

    result = subprocess.run(
        cmd,
        env=_pg_env(password),
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip() or "pg_dump failed"
        raise RuntimeError(stderr)

    metadata = load_backup_metadata()
    metadata.setdefault("items", {})[filename] = {
        "label": label.strip() if label else None,
    }
    save_backup_metadata(metadata)

    settings_data = load_backup_settings()
    settings_data["last_backup_at"] = timestamp.isoformat()
    settings_data = save_backup_settings(settings_data)

    retention_count = int(settings_data.get("retention_count") or 0)
    pruned = prune_backups(retention_count)

    stats = output_path.stat()
    backup_record = {
        "filename": filename,
        "size_bytes": stats.st_size,
        "created_at": _local_from_timestamp(stats.st_mtime),
        "label": label.strip() if label else None,
    }
    return backup_record, settings_data, pruned


def parse_last_backup_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=_local_now().tzinfo)
    return parsed


def is_backup_due(settings_data: dict[str, Any]) -> bool:
    if not settings_data.get("enabled"):
        return False
    interval_minutes = int(settings_data.get("interval_minutes") or 0)
    if interval_minutes <= 0:
        return False
    last_backup_at = parse_last_backup_at(settings_data.get("last_backup_at"))
    if last_backup_at is None:
        return True
    elapsed = _local_now() - last_backup_at
    return elapsed.total_seconds() >= interval_minutes * 60


def swap_databases(primary_db: str, secondary_db: str, force_disconnect: bool = False) -> None:
    _validate_db_name(primary_db)
    _validate_db_name(secondary_db)
    if primary_db == secondary_db:
        raise ValueError("Primary and secondary database names must be different.")

    engine = _admin_engine()
    timestamp = _local_now().strftime("%Y%m%d%H%M%S")
    temp_db = f"{primary_db}_swap_{timestamp}"

    try:
        with engine.connect() as conn:
            if force_disconnect:
                _terminate_connections(conn, [primary_db, secondary_db])
            conn.execute(
                text(
                    f"ALTER DATABASE {_quote_identifier(primary_db)} "
                    f"RENAME TO {_quote_identifier(temp_db)}"
                )
            )
            conn.execute(
                text(
                    f"ALTER DATABASE {_quote_identifier(secondary_db)} "
                    f"RENAME TO {_quote_identifier(primary_db)}"
                )
            )
            conn.execute(
                text(
                    f"ALTER DATABASE {_quote_identifier(temp_db)} "
                    f"RENAME TO {_quote_identifier(secondary_db)}"
                )
            )
    finally:
        engine.dispose()


def restore_backup(
    filename: str,
    *,
    force_disconnect: bool = True,
    checkpoint_label: str | None = None,
) -> dict[str, Any]:
    paths = get_backup_paths()
    backup_path = paths.root / filename
    if not backup_path.exists():
        raise ValueError("Backup file not found.")
    if backup_path.suffix not in VALID_BACKUP_SUFFIXES:
        raise ValueError("Only .dump backups are supported for restore.")

    primary_db, username, host, port, password = _resolve_db_connection()
    _validate_db_name(primary_db)
    timestamp = _local_now()
    restore_db = _restore_db_name(primary_db, timestamp)
    _validate_db_name(restore_db)

    label = checkpoint_label or f"Manual restore checkpoint for {filename}"
    checkpoint_backup, _, pruned = create_backup(label)

    engine = _admin_engine()
    created = False
    try:
        with engine.connect() as conn:
            if _database_exists(conn, restore_db):
                raise ValueError("Restore database name already exists.")
            _create_database(conn, restore_db, username)
            created = True
    finally:
        engine.dispose()

    cmd = [
        settings.pg_restore_path,
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        restore_db,
        str(backup_path),
    ]
    if host:
        cmd.extend(["--host", host])
    if port:
        cmd.extend(["--port", str(port)])
    if username:
        cmd.extend(["--username", username])

    result = subprocess.run(
        cmd,
        env=_pg_env(password),
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip() or "pg_restore failed"
        if created:
            cleanup_engine = _admin_engine()
            try:
                with cleanup_engine.connect() as conn:
                    _terminate_connections(conn, [restore_db])
                    _drop_database(conn, restore_db)
            finally:
                cleanup_engine.dispose()
        raise RuntimeError(stderr)

    swap_databases(primary_db, restore_db, force_disconnect=force_disconnect)
    return {
        "primary_db": primary_db,
        "archived_db": restore_db,
        "restored_from": filename,
        "checkpoint_backup": checkpoint_backup,
        "pruned": pruned,
    }
