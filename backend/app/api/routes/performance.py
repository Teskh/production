from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_db
from app.models.admin import AdminUser
from app.models.performance import PerformanceEvent
from app.schemas.performance import (
    PerformanceDeviceRow,
    PerformanceEventInput,
    PerformanceIngestRequest,
    PerformanceIngestResponse,
    PerformanceMetricRow,
    PerformanceSummaryResponse,
)

router = APIRouter()

_MAX_QUERY_EVENTS = 50000


def _clean_text(value: str | None, max_len: int) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    return trimmed[:max_len]


def _normalize_datetime(value: datetime | None) -> datetime:
    if value is None:
        return datetime.utcnow()
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    if len(sorted_values) == 1:
        return round(sorted_values[0], 2)
    rank = (len(sorted_values) - 1) * p
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return round(sorted_values[lower], 2)
    weight = rank - lower
    interpolated = sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * weight
    return round(interpolated, 2)


def _as_float(value: object | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _build_metric_rows(
    events: list[PerformanceEvent],
    key_getter,
    limit: int,
) -> list[PerformanceMetricRow]:
    grouped: dict[str, list[PerformanceEvent]] = {}
    for event in events:
        key = key_getter(event)
        if not key:
            continue
        grouped.setdefault(key, []).append(event)

    rows: list[PerformanceMetricRow] = []
    for key, items in grouped.items():
        durations = [value for event in items if (value := _as_float(event.duration_ms)) is not None]
        if not durations:
            continue
        server_durations = [
            value
            for event in items
            if (value := _as_float(event.server_duration_ms)) is not None
        ]
        error_count = sum(
            1
            for event in items
            if event.ok is False or (event.status_code is not None and event.status_code >= 400)
        )
        avg_ms = round(sum(durations) / len(durations), 2)
        rows.append(
            PerformanceMetricRow(
                key=key,
                count=len(durations),
                error_count=error_count,
                avg_ms=avg_ms,
                p50_ms=_percentile(durations, 0.50),
                p95_ms=_percentile(durations, 0.95),
                server_p50_ms=_percentile(server_durations, 0.50),
                server_p95_ms=_percentile(server_durations, 0.95),
            )
        )
    rows.sort(key=lambda row: ((row.p95_ms or 0.0), row.count), reverse=True)
    return rows[:limit]


def _build_device_rows(events: list[PerformanceEvent], limit: int) -> list[PerformanceDeviceRow]:
    grouped: dict[str, list[PerformanceEvent]] = {}
    names: dict[str, str | None] = {}
    for event in events:
        device_id = _clean_text(event.device_id, 64) or "unknown"
        grouped.setdefault(device_id, []).append(event)
        if device_id not in names:
            names[device_id] = _clean_text(event.device_name, 120)

    rows: list[PerformanceDeviceRow] = []
    for device_id, items in grouped.items():
        durations = [value for event in items if (value := _as_float(event.duration_ms)) is not None]
        if not durations:
            continue
        rows.append(
            PerformanceDeviceRow(
                device_id=device_id,
                device_name=names.get(device_id),
                count=len(durations),
                p95_ms=_percentile(durations, 0.95),
            )
        )
    rows.sort(key=lambda row: (row.count, row.p95_ms or 0.0), reverse=True)
    return rows[:limit]


def _build_api_key(event: PerformanceEvent) -> str | None:
    api_path = _clean_text(event.api_path, 255)
    if not api_path:
        return None
    method = _clean_text(event.method, 12) or "GET"
    return f"{method.upper()} {api_path}"


def _build_page_key(event: PerformanceEvent) -> str | None:
    return _clean_text(event.page_path, 255)


def _event_from_input(event: PerformanceEventInput) -> PerformanceEvent | None:
    if not math.isfinite(event.duration_ms):
        return None
    server_duration_ms = event.server_duration_ms
    if server_duration_ms is not None and not math.isfinite(server_duration_ms):
        server_duration_ms = None
    return PerformanceEvent(
        created_at=_normalize_datetime(event.recorded_at),
        event_type=event.type,
        page_path=_clean_text(event.page_path, 255),
        api_path=_clean_text(event.api_path, 255),
        method=_clean_text(event.method, 12),
        duration_ms=round(event.duration_ms, 2),
        server_duration_ms=(
            round(server_duration_ms, 2) if server_duration_ms is not None else None
        ),
        status_code=event.status_code,
        ok=event.ok,
        request_id=_clean_text(event.request_id, 64),
        device_id=_clean_text(event.device_id, 64),
        device_name=_clean_text(event.device_name, 120),
        app_version=_clean_text(event.app_version, 64),
        session_id=_clean_text(event.session_id, 64),
        sampled=bool(event.sampled if event.sampled is not None else True),
    )


@router.post(
    "/events",
    response_model=PerformanceIngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def ingest_events(
    payload: PerformanceIngestRequest,
    db: Session = Depends(get_db),
) -> PerformanceIngestResponse:
    if not payload.events:
        return PerformanceIngestResponse(accepted=0, dropped=0)

    accepted = 0
    dropped = 0
    for event in payload.events[:200]:
        normalized = _event_from_input(event)
        if normalized is None:
            dropped += 1
            continue
        db.add(normalized)
        accepted += 1
    dropped += max(0, len(payload.events) - 200)
    if accepted:
        db.commit()
    return PerformanceIngestResponse(accepted=accepted, dropped=dropped)


@router.get("/summary", response_model=PerformanceSummaryResponse)
def get_summary(
    hours: int = Query(default=24, ge=1, le=24 * 30),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> PerformanceSummaryResponse:
    to_utc = datetime.utcnow()
    from_utc = to_utc - timedelta(hours=hours)
    events = list(
        db.execute(
            select(PerformanceEvent)
            .where(PerformanceEvent.created_at >= from_utc)
            .where(PerformanceEvent.created_at <= to_utc)
            .order_by(PerformanceEvent.created_at.desc())
            .limit(_MAX_QUERY_EVENTS + 1)
        ).scalars()
    )
    truncated = len(events) > _MAX_QUERY_EVENTS
    if truncated:
        events = events[:_MAX_QUERY_EVENTS]
    api_events = [event for event in events if event.event_type == "api_request"]
    page_events = [event for event in events if event.event_type == "page_load"]

    return PerformanceSummaryResponse(
        from_utc=from_utc,
        to_utc=to_utc,
        total_events=len(events),
        truncated=truncated,
        api_requests=_build_metric_rows(api_events, _build_api_key, limit),
        page_loads=_build_metric_rows(page_events, _build_page_key, limit),
        devices=_build_device_rows(events, limit),
    )
