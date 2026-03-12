from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_db
from app.models.admin import AdminUser
from app.models.enums import TaskStatus
from app.models.house import HouseSubType, HouseType, PanelDefinition
from app.models.stations import Station
from app.models.tasks import TaskDefinition, TaskInstance, TaskParticipation
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.models.workers import Worker
from app.schemas.task_footage import (
    TaskFootageListResponse,
    TaskFootagePlaybackResponse,
    TaskFootageRow,
    TaskFootageSegmentSummary,
)
from app.services import task_footage as task_footage_service
from app.services.task_footage import RecorderIntegrationError

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
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _format_worker_name(worker: Worker) -> str:
    full_name = f"{worker.first_name} {worker.last_name}".strip()
    return full_name or f"Worker {worker.id}"


def _duration_minutes(started_at: datetime | None, completed_at: datetime | None) -> float | None:
    seconds = task_footage_service.duration_seconds(
        task_footage_service.as_utc(started_at),
        task_footage_service.as_utc(completed_at),
    )
    if seconds is None:
        return None
    return round(seconds / 60.0, 2)


def _task_query():
    return (
        select(
            TaskInstance,
            TaskDefinition,
            WorkUnit,
            WorkOrder,
            HouseType,
            HouseSubType,
            Station,
            PanelUnit,
            PanelDefinition,
        )
        .join(TaskDefinition, TaskInstance.task_definition_id == TaskDefinition.id)
        .join(WorkUnit, TaskInstance.work_unit_id == WorkUnit.id)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
        .outerjoin(HouseSubType, WorkOrder.sub_type_id == HouseSubType.id)
        .join(Station, TaskInstance.station_id == Station.id)
        .outerjoin(PanelUnit, TaskInstance.panel_unit_id == PanelUnit.id)
        .outerjoin(PanelDefinition, PanelUnit.panel_definition_id == PanelDefinition.id)
        .where(TaskInstance.status == TaskStatus.COMPLETED)
    )


def _task_count_query():
    return (
        select(func.count(TaskInstance.id))
        .select_from(TaskInstance)
        .join(TaskDefinition, TaskInstance.task_definition_id == TaskDefinition.id)
        .join(WorkUnit, TaskInstance.work_unit_id == WorkUnit.id)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
        .outerjoin(HouseSubType, WorkOrder.sub_type_id == HouseSubType.id)
        .join(Station, TaskInstance.station_id == Station.id)
        .outerjoin(PanelUnit, TaskInstance.panel_unit_id == PanelUnit.id)
        .outerjoin(PanelDefinition, PanelUnit.panel_definition_id == PanelDefinition.id)
        .where(TaskInstance.status == TaskStatus.COMPLETED)
    )


def _apply_filters(
    stmt,
    *,
    from_dt: datetime | None,
    to_dt: datetime | None,
    station_id: int | None,
    worker_id: int | None,
    task_instance_id: int | None = None,
):
    if from_dt is not None:
        stmt = stmt.where(TaskInstance.completed_at >= from_dt.replace(tzinfo=None))
    if to_dt is not None:
        stmt = stmt.where(TaskInstance.completed_at <= to_dt.replace(tzinfo=None))
    if station_id is not None:
        stmt = stmt.where(TaskInstance.station_id == station_id)
    if task_instance_id is not None:
        stmt = stmt.where(TaskInstance.id == task_instance_id)
    if worker_id is not None:
        participation_exists = (
            select(TaskParticipation.id)
            .where(TaskParticipation.task_instance_id == TaskInstance.id)
            .where(TaskParticipation.worker_id == worker_id)
        )
        stmt = stmt.where(exists(participation_exists))
    return stmt


def _load_worker_names(db: Session, instance_ids: list[int]) -> dict[int, str]:
    if not instance_ids:
        return {}
    rows = list(
        db.execute(
            select(TaskParticipation, Worker)
            .join(Worker, TaskParticipation.worker_id == Worker.id)
            .where(TaskParticipation.task_instance_id.in_(instance_ids))
        ).all()
    )
    worker_map: dict[int, list[str]] = {}
    for participation, worker in rows:
        worker_map.setdefault(participation.task_instance_id, []).append(
            _format_worker_name(worker)
        )
    return {
        instance_id: ", ".join(sorted(set(names)))
        for instance_id, names in worker_map.items()
    }


def _load_task_rows(
    *,
    db: Session,
    from_dt: datetime | None,
    to_dt: datetime | None,
    station_id: int | None,
    worker_id: int | None,
    limit: int,
    offset: int,
):
    count_stmt = _apply_filters(
        _task_count_query(),
        from_dt=from_dt,
        to_dt=to_dt,
        station_id=station_id,
        worker_id=worker_id,
    )
    total_count = int(db.execute(count_stmt).scalar_one())

    rows_stmt = _apply_filters(
        _task_query(),
        from_dt=from_dt,
        to_dt=to_dt,
        station_id=station_id,
        worker_id=worker_id,
    ).order_by(TaskInstance.completed_at.desc().nullslast(), TaskInstance.id.desc())
    rows = list(db.execute(rows_stmt.offset(offset).limit(limit)).all())
    worker_names = _load_worker_names(db, [row[0].id for row in rows])
    return total_count, rows, worker_names


def _load_single_task(task_instance_id: int, db: Session):
    stmt = _apply_filters(
        _task_query(),
        from_dt=None,
        to_dt=None,
        station_id=None,
        worker_id=None,
        task_instance_id=task_instance_id,
    )
    row = db.execute(stmt).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    worker_names = _load_worker_names(db, [task_instance_id])
    return row, worker_names.get(task_instance_id)


@router.get("/tasks", response_model=TaskFootageListResponse)
def list_task_footage(
    from_date: str | None = None,
    to_date: str | None = None,
    station_id: int | None = None,
    worker_id: int | None = None,
    limit: int = Query(100, ge=1, le=250),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> TaskFootageListResponse:
    from_dt = _parse_datetime(from_date, "from_date")
    to_dt = _parse_datetime(to_date, "to_date", end_of_day=True)
    total_count, rows, worker_names = _load_task_rows(
        db=db,
        from_dt=from_dt,
        to_dt=to_dt,
        station_id=station_id,
        worker_id=worker_id,
        limit=limit,
        offset=offset,
    )

    payload_rows: list[TaskFootageRow] = []
    for (
        instance,
        task_definition,
        work_unit,
        work_order,
        house_type,
        house_sub_type,
        station,
        _panel_unit,
        panel_definition,
    ) in rows:
        started_at_utc = task_footage_service.as_utc(instance.started_at)
        completed_at_utc = task_footage_service.as_utc(instance.completed_at)
        try:
            coverage = task_footage_service.resolve_task_footage(
                camera_ip=station.camera_feed_ip,
                started_at=started_at_utc,
                completed_at=completed_at_utc,
            )
        except RecorderIntegrationError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from exc

        payload_rows.append(
            TaskFootageRow(
                task_instance_id=instance.id,
                scope=instance.scope.value if instance.scope else None,
                task_definition_id=task_definition.id,
                task_definition_name=task_definition.name,
                panel_definition_id=panel_definition.id if panel_definition else None,
                panel_code=panel_definition.panel_code if panel_definition else None,
                project_name=work_order.project_name,
                house_identifier=work_order.house_identifier or f"WO-{work_order.id}",
                house_type_name=house_type.name,
                house_sub_type_name=house_sub_type.name if house_sub_type else None,
                module_number=work_unit.module_number,
                station_id=station.id,
                station_name=station.name,
                worker_name=worker_names.get(instance.id),
                started_at=started_at_utc,
                completed_at=completed_at_utc,
                duration_minutes=_duration_minutes(instance.started_at, instance.completed_at),
                notes=instance.notes,
                camera_feed_ip=station.camera_feed_ip,
                footage_status=coverage.status,
                footage_status_label=coverage.status_label,
                requested_duration_seconds=coverage.requested_duration_seconds,
                available_duration_seconds=coverage.available_duration_seconds,
                coverage_ratio=coverage.coverage_ratio,
                segments_count=len(coverage.segments),
                first_footage_at_utc=coverage.available_start_utc,
                last_footage_at_utc=coverage.available_end_utc,
            )
        )

    return TaskFootageListResponse(total_count=total_count, rows=payload_rows)


@router.get("/tasks/{task_instance_id}/playback", response_model=TaskFootagePlaybackResponse)
def get_task_playback(
    task_instance_id: int,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> TaskFootagePlaybackResponse:
    (
        instance,
        _task_definition,
        _work_unit,
        _work_order,
        _house_type,
        _house_sub_type,
        station,
        _panel_unit,
        _panel_definition,
    ), _worker_name = _load_single_task(task_instance_id, db)

    try:
        playback = task_footage_service.build_playback_plan(
            task_instance_id=task_instance_id,
            camera_ip=station.camera_feed_ip,
            started_at=task_footage_service.as_utc(instance.started_at),
            completed_at=task_footage_service.as_utc(instance.completed_at),
        )
    except RecorderIntegrationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    segments = [
        TaskFootageSegmentSummary(
            segment_id=interval.segment.segment_id,
            file_name=interval.segment.file_name,
            started_at_utc=interval.segment.start_utc,
            ended_at_utc=interval.segment.end_utc,
            overlap_started_at_utc=interval.start_utc,
            overlap_ended_at_utc=interval.end_utc,
        )
        for interval in playback.coverage.intervals
    ]

    video_url = None
    if playback.file_path is not None:
        video_url = f"/api/task-footage/tasks/{task_instance_id}/video"

    return TaskFootagePlaybackResponse(
        task_instance_id=task_instance_id,
        footage_status=playback.coverage.status,
        footage_status_label=playback.coverage.status_label,
        playback_mode=playback.mode,
        video_url=video_url,
        playback_start_seconds=playback.playback_start_seconds,
        playback_end_seconds=playback.playback_end_seconds,
        requested_start_utc=playback.coverage.requested_start_utc,
        requested_end_utc=playback.coverage.requested_end_utc,
        available_start_utc=playback.coverage.available_start_utc,
        available_end_utc=playback.coverage.available_end_utc,
        requested_duration_seconds=playback.coverage.requested_duration_seconds,
        available_duration_seconds=playback.coverage.available_duration_seconds,
        camera_feed_ip=playback.coverage.camera_ip,
        warning=playback.coverage.warning,
        segments=segments,
    )


@router.get("/tasks/{task_instance_id}/video")
def stream_task_video(
    task_instance_id: int,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> FileResponse:
    (
        instance,
        _task_definition,
        _work_unit,
        _work_order,
        _house_type,
        _house_sub_type,
        station,
        _panel_unit,
        _panel_definition,
    ), _worker_name = _load_single_task(task_instance_id, db)

    try:
        playback = task_footage_service.build_playback_plan(
            task_instance_id=task_instance_id,
            camera_ip=station.camera_feed_ip,
            started_at=task_footage_service.as_utc(instance.started_at),
            completed_at=task_footage_service.as_utc(instance.completed_at),
        )
    except RecorderIntegrationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    if playback.file_path is None or not playback.file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No playable footage available for this task",
        )

    filename = playback.file_path.name
    if playback.mode == "generated":
        filename = f"task_{task_instance_id}_footage.mp4"
    return FileResponse(playback.file_path, media_type="video/mp4", filename=filename)
