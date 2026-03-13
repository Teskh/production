from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routes.shift_estimates import ALGORITHM_VERSION
from app.models.admin import PauseReason
from app.models.enums import StationRole, TaskScope
from app.models.stations import Station
from app.models.tasks import TaskInstance, TaskPause
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.schemas.analytics import PauseSummaryReason, PauseSummaryResponse
from app.services.shift_masks import ShiftMaskResolver

router = APIRouter()


def _parse_datetime(value: str | None, field: str, end_of_day: bool = False) -> datetime | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    normalized = raw.replace(" ", "T")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {field} value",
        ) from exc
    if end_of_day and len(raw) == 10:
        return dt.replace(hour=23, minute=59, second=59, microsecond=999999)
    return dt


def _pause_interval(
    pause: TaskPause, completed_at: datetime | None
) -> tuple[datetime, datetime] | None:
    if pause.paused_at is None:
        return None
    end_time = pause.resumed_at or completed_at
    if end_time is None:
        return None
    if end_time < pause.paused_at:
        return None
    return (pause.paused_at, end_time)


def _pause_duration_minutes(pause: TaskPause, completed_at: datetime | None) -> float | None:
    interval = _pause_interval(pause, completed_at)
    if interval is None:
        return None
    pause_start, pause_end = interval
    return (pause_end - pause_start).total_seconds() / 60


def _mask_query_bounds(
    rows: list[tuple[TaskPause, TaskInstance, PauseReason | None]],
) -> tuple[date | None, date | None]:
    min_dt: datetime | None = None
    max_dt: datetime | None = None

    def _push(value: datetime | None) -> None:
        nonlocal min_dt, max_dt
        if value is None:
            return
        if min_dt is None or value < min_dt:
            min_dt = value
        if max_dt is None or value > max_dt:
            max_dt = value

    for pause, instance, _reason in rows:
        interval = _pause_interval(pause, instance.completed_at)
        if interval is None:
            continue
        pause_start, pause_end = interval
        _push(pause_start)
        _push(pause_end)

    if min_dt is None or max_dt is None:
        return None, None
    return min_dt.date(), max_dt.date()


@router.get("", response_model=PauseSummaryResponse)
def get_pause_summary(
    from_date: str | None = None,
    to_date: str | None = None,
    house_type_id: int | None = None,
    station_id: int | None = None,
    db: Session = Depends(get_db),
) -> PauseSummaryResponse:
    from_dt = _parse_datetime(from_date, "from_date")
    to_dt = _parse_datetime(to_date, "to_date", end_of_day=True)

    stmt = (
        select(TaskPause, TaskInstance, PauseReason)
        .join(TaskInstance, TaskPause.task_instance_id == TaskInstance.id)
        .outerjoin(PauseReason, TaskPause.reason_id == PauseReason.id)
        .join(PanelUnit, TaskInstance.panel_unit_id == PanelUnit.id)
        .join(WorkUnit, PanelUnit.work_unit_id == WorkUnit.id)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(Station, TaskInstance.station_id == Station.id)
        .where(TaskInstance.scope == TaskScope.PANEL)
        .where(Station.role == StationRole.PANELS)
    )

    if house_type_id is not None:
        stmt = stmt.where(WorkOrder.house_type_id == house_type_id)
    if station_id is not None:
        stmt = stmt.where(TaskInstance.station_id == station_id)
    if from_dt is not None:
        stmt = stmt.where(TaskPause.paused_at >= from_dt)
    if to_dt is not None:
        stmt = stmt.where(TaskPause.paused_at <= to_dt)

    rows = list(db.execute(stmt).all())
    if not rows:
        return PauseSummaryResponse(
            from_date=from_date,
            to_date=to_date,
            total_pause_minutes=0.0,
            pause_reasons=[],
        )

    mask_start_date, mask_end_date = _mask_query_bounds(rows)
    shift_masks = ShiftMaskResolver.load(
        db,
        station_role=StationRole.PANELS,
        station_ids={
            instance.station_id
            for _pause, instance, _reason in rows
            if instance.station_id is not None
        },
        start_date=mask_start_date,
        end_date=mask_end_date,
        algorithm_version=ALGORITHM_VERSION,
    )

    totals_by_reason: dict[str, dict[str, float | int]] = {}
    total_minutes = 0.0

    for pause, instance, reason in rows:
        raw_duration = _pause_duration_minutes(pause, instance.completed_at)
        interval = _pause_interval(pause, instance.completed_at)
        if raw_duration is None or interval is None:
            continue
        pause_start, pause_end = interval
        masked_duration = shift_masks.masked_minutes(
            instance.station_id, pause_start, pause_end
        )
        duration = raw_duration if masked_duration is None else masked_duration
        if duration <= 0:
            continue

        label = None
        if reason and reason.name:
            label = reason.name
        if not label and pause.reason_text:
            label = pause.reason_text
        if not label:
            label = "Sin motivo"
        entry = totals_by_reason.setdefault(
            label, {"total_minutes": 0.0, "occurrence_count": 0}
        )
        entry["total_minutes"] = float(entry["total_minutes"]) + duration
        entry["occurrence_count"] = int(entry["occurrence_count"]) + 1
        total_minutes += duration

    pause_reasons = [
        PauseSummaryReason(
            reason=label,
            total_duration_minutes=round(float(values["total_minutes"]), 2),
            occurrence_count=int(values["occurrence_count"]),
        )
        for label, values in totals_by_reason.items()
    ]
    pause_reasons.sort(key=lambda item: item.total_duration_minutes, reverse=True)

    return PauseSummaryResponse(
        from_date=from_date,
        to_date=to_date,
        total_pause_minutes=round(total_minutes, 2),
        pause_reasons=pause_reasons,
    )
