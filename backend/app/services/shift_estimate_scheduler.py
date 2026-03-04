from __future__ import annotations

import copy
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.db.session import SessionLocal

DEFAULT_SETTINGS: dict[str, Any] = {
    "enabled": False,
    "run_hour": 23,
    "run_minute": 0,
    "last_run_at": None,
}


def _settings_path() -> Path:
    return Path(settings.shift_estimate_scheduler_settings_path)


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


def _local_now() -> datetime:
    return datetime.now().astimezone()


def parse_last_run_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=_local_now().tzinfo)
    return parsed


def load_settings() -> dict[str, Any]:
    data = _load_json(_settings_path(), DEFAULT_SETTINGS)
    if not isinstance(data.get("enabled"), bool):
        data["enabled"] = DEFAULT_SETTINGS["enabled"]
    run_hour = data.get("run_hour")
    if not isinstance(run_hour, int) or run_hour < 0 or run_hour > 23:
        data["run_hour"] = DEFAULT_SETTINGS["run_hour"]
    run_minute = data.get("run_minute")
    if not isinstance(run_minute, int) or run_minute < 0 or run_minute > 59:
        data["run_minute"] = DEFAULT_SETTINGS["run_minute"]
    return data


def save_settings(payload: dict[str, Any]) -> dict[str, Any]:
    data = copy.deepcopy(DEFAULT_SETTINGS)
    data.update(payload)
    _save_json(_settings_path(), data)
    return data


def update_settings(update: dict[str, Any]) -> dict[str, Any]:
    data = load_settings()
    for key, value in update.items():
        if value is not None:
            data[key] = value
    return save_settings(data)


def _last_scheduled_time(
    now: datetime, run_hour: int, run_minute: int
) -> datetime:
    scheduled = now.replace(
        hour=run_hour,
        minute=run_minute,
        second=0,
        microsecond=0,
    )
    if now < scheduled:
        return scheduled - timedelta(days=1)
    return scheduled


def due_target_date(
    settings_data: dict[str, Any], *, now: datetime | None = None
) -> date | None:
    if not settings_data.get("enabled"):
        return None
    run_hour = int(settings_data.get("run_hour") or 0)
    run_minute = int(settings_data.get("run_minute") or 0)
    now_value = now or _local_now()
    scheduled = _last_scheduled_time(now_value, run_hour, run_minute)
    last_run_at = parse_last_run_at(settings_data.get("last_run_at"))
    if last_run_at and last_run_at >= scheduled:
        return None
    return scheduled.date()


def run_compute_for_date(target_date: date) -> dict[str, Any]:
    from app.api.routes.shift_estimates import compute_shift_estimate_range

    db = SessionLocal()
    started_at = _local_now()
    try:
        result = compute_shift_estimate_range(
            db,
            target_date,
            target_date,
            include_today=True,
        )
    finally:
        db.close()
    data = load_settings()
    data["last_run_at"] = started_at.isoformat()
    data = save_settings(data)
    return {"result": result.model_dump(), "settings": data}
