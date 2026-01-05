from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.admin import PauseReason
from app.models.enums import StationRole, TaskScope
from app.models.stations import Station
from app.models.tasks import TaskInstance, TaskPause
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.schemas.analytics import PauseSummaryReason, PauseSummaryResponse

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


def _pause_duration_minutes(pause: TaskPause, completed_at: datetime | None) -> float | None:
    if pause.paused_at is None:
        return None
    end_time = pause.resumed_at or completed_at
    if end_time is None:
        return None
    if end_time < pause.paused_at:
        return None
    return (end_time - pause.paused_at).total_seconds() / 60


@router.get("/", response_model=PauseSummaryResponse)
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

    totals_by_reason: dict[str, dict[str, float | int]] = {}
    total_minutes = 0.0

    for pause, instance, reason in rows:
        duration = _pause_duration_minutes(pause, instance.completed_at)
        if duration is None:
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
