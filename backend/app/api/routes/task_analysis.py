from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routes.shift_estimates import ALGORITHM_VERSION
from app.models.enums import StationRole, TaskScope, TaskStatus
from app.models.house import PanelDefinition
from app.models.stations import Station
from app.models.tasks import (
    TaskApplicability,
    TaskDefinition,
    TaskExpectedDuration,
    TaskInstance,
    TaskParticipation,
    TaskPause,
)
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.models.workers import Worker
from app.schemas.analytics import (
    TaskAnalysisDataPoint,
    TaskAnalysisTaskPause,
    TaskAnalysisResponse,
    TaskAnalysisStats,
    TaskAnalysisTaskBreakdown,
    TaskAnalysisTimelineSegment,
    TaskAnalysisWorkerOption,
)
from app.services.shift_masks import ShiftMaskResolver
from app.services.task_applicability import resolve_task_station_sequence

router = APIRouter()


def _parse_datetime(value: str | None, field: str) -> datetime | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    normalized = raw.replace(" ", "T")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {field} value",
        ) from exc


def _format_worker_name(worker: Worker) -> str:
    name = f"{worker.first_name} {worker.last_name}".strip()
    return name or f"Worker {worker.id}"


def _panel_task_order_key(task: TaskDefinition) -> tuple[int, str]:
    sequence = task.default_station_sequence
    safe_sequence = sequence if sequence is not None else 1_000_000
    return (safe_sequence, task.name.lower())


def _build_panel_expected_map(
    panel_definition: PanelDefinition, panel_tasks: list[TaskDefinition]
) -> dict[int, float]:
    durations = panel_definition.task_durations_json or []
    if not durations:
        return {}
    expected_map: dict[int, float] = {}
    if panel_definition.applicable_task_ids is not None:
        for index, task_id in enumerate(panel_definition.applicable_task_ids):
            if index >= len(durations):
                break
            value = durations[index]
            if value is None:
                continue
            expected_map[task_id] = float(value)
        return expected_map
    ordered_tasks = sorted(panel_tasks, key=_panel_task_order_key)
    for index, task in enumerate(ordered_tasks):
        if index >= len(durations):
            break
        value = durations[index]
        if value is None:
            continue
        expected_map[task.id] = float(value)
    return expected_map


def _merge_intervals(
    intervals: list[tuple[datetime, datetime]]
) -> list[tuple[datetime, datetime]]:
    if not intervals:
        return []
    ordered = sorted(intervals, key=lambda item: item[0])
    merged: list[tuple[datetime, datetime]] = [ordered[0]]
    for start, end in ordered[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def _pause_intervals(
    pauses: list[TaskPause], completed_at: datetime | None
) -> list[tuple[datetime, datetime]]:
    if completed_at is None:
        return []
    intervals: list[tuple[datetime, datetime]] = []
    for pause in pauses:
        paused_at = pause.paused_at
        if paused_at is None:
            continue
        resumed_at = pause.resumed_at or completed_at
        if resumed_at < paused_at:
            continue
        intervals.append((paused_at, resumed_at))
    return intervals


def _active_intervals(
    instance: TaskInstance, pause_map: dict[int, list[TaskPause]]
) -> list[tuple[datetime, datetime]]:
    started_at = instance.started_at
    completed_at = instance.completed_at
    if not started_at or not completed_at or completed_at < started_at:
        return []
    if completed_at == started_at:
        return []

    clipped_pauses: list[tuple[datetime, datetime]] = []
    for paused_at, resumed_at in _pause_intervals(
        pause_map.get(instance.id, []), completed_at
    ):
        pause_start = max(paused_at, started_at)
        pause_end = min(resumed_at, completed_at)
        if pause_end <= pause_start:
            continue
        clipped_pauses.append((pause_start, pause_end))

    if not clipped_pauses:
        return [(started_at, completed_at)]

    active: list[tuple[datetime, datetime]] = []
    cursor = started_at
    for pause_start, pause_end in _merge_intervals(clipped_pauses):
        if pause_start > cursor:
            active.append((cursor, pause_start))
        if pause_end > cursor:
            cursor = pause_end
    if cursor < completed_at:
        active.append((cursor, completed_at))
    return active


def _intervals_total_minutes(intervals: list[tuple[datetime, datetime]]) -> float:
    if not intervals:
        return 0.0
    return sum((end - start).total_seconds() / 60 for start, end in intervals)


def _mask_intervals(
    station_id: int | None,
    station_role: StationRole | None,
    sequence_order: int | None,
    intervals: list[tuple[datetime, datetime]],
    shift_masks: ShiftMaskResolver,
) -> list[tuple[datetime, datetime]] | None:
    masked_segments: list[tuple[datetime, datetime]] = []
    for start_dt, end_dt in intervals:
        segments = shift_masks.masked_segments(
            station_id,
            start_dt,
            end_dt,
            sequence_order=sequence_order,
            station_role=station_role,
        )
        if segments is None:
            return None
        masked_segments.extend(segments)
    return _merge_intervals(masked_segments)


def _subtract_intervals(
    base_intervals: list[tuple[datetime, datetime]],
    covered_intervals: list[tuple[datetime, datetime]],
) -> list[tuple[datetime, datetime]]:
    if not base_intervals:
        return []
    if not covered_intervals:
        return _merge_intervals(base_intervals)

    base = _merge_intervals(base_intervals)
    covered = _merge_intervals(covered_intervals)
    result: list[tuple[datetime, datetime]] = []

    for base_start, base_end in base:
        cursor = base_start
        for covered_start, covered_end in covered:
            if covered_end <= cursor:
                continue
            if covered_start >= base_end:
                break
            overlap_start = max(cursor, covered_start)
            overlap_end = min(base_end, covered_end)
            if overlap_start > cursor:
                result.append((cursor, overlap_start))
            if overlap_end > cursor:
                cursor = overlap_end
            if cursor >= base_end:
                break
        if cursor < base_end:
            result.append((cursor, base_end))
    return result


def _build_task_timeline_segments(
    task_definition_id: int | None,
    task_name: str | None,
    active_intervals: list[tuple[datetime, datetime]],
    pause_intervals: list[tuple[datetime, datetime]],
    masked_active_intervals: list[tuple[datetime, datetime]] | None,
    masked_pause_intervals: list[tuple[datetime, datetime]] | None,
) -> list[TaskAnalysisTimelineSegment]:
    payload: list[TaskAnalysisTimelineSegment] = []

    def _append(
        segment_type: str,
        intervals: list[tuple[datetime, datetime]],
    ) -> None:
        for start_dt, end_dt in intervals:
            duration = (end_dt - start_dt).total_seconds() / 60
            if duration <= 0:
                continue
            payload.append(
                TaskAnalysisTimelineSegment(
                    segment_type=segment_type,
                    started_at=start_dt,
                    ended_at=end_dt,
                    duration_minutes=round(duration, 2),
                    task_definition_id=task_definition_id,
                    task_name=task_name,
                )
            )

    if masked_active_intervals is None:
        _append("active", active_intervals)
    else:
        _append("active", masked_active_intervals)
        _append("masked_active", _subtract_intervals(active_intervals, masked_active_intervals))

    if masked_pause_intervals is None:
        _append("paused", pause_intervals)
    else:
        _append("paused", masked_pause_intervals)
        _append("masked_paused", _subtract_intervals(pause_intervals, masked_pause_intervals))

    payload.sort(key=lambda segment: segment.started_at or datetime.min)
    return payload


def _masked_intervals_total_minutes(
    station_id: int | None,
    station_role: StationRole | None,
    sequence_order: int | None,
    intervals: list[tuple[datetime, datetime]],
    shift_masks: ShiftMaskResolver,
) -> float | None:
    masked_segments = _mask_intervals(
        station_id,
        station_role,
        sequence_order,
        intervals,
        shift_masks,
    )
    if masked_segments is None:
        return None
    return _intervals_total_minutes(masked_segments)


def _duration_minutes(
    instance: TaskInstance,
    pause_map: dict[int, list[TaskPause]],
    shift_masks: ShiftMaskResolver,
    station_role: StationRole | None,
    station_sequence_order: int | None,
) -> float | None:
    if not instance.started_at or not instance.completed_at:
        return None
    active_intervals = _active_intervals(instance, pause_map)
    raw_minutes = _intervals_total_minutes(active_intervals)
    masked_minutes = _masked_intervals_total_minutes(
        instance.station_id,
        station_role,
        station_sequence_order,
        active_intervals,
        shift_masks,
    )
    if masked_minutes is None:
        return round(max(raw_minutes, 0.0), 2)
    return round(max(masked_minutes, 0.0), 2)


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def _resolve_module_expected(
    duration_rows: list[TaskExpectedDuration],
    house_type_id: int | None,
    module_number: int | None,
) -> float | None:
    if not duration_rows:
        return None
    module_match = None
    house_match = None
    default_match = None
    for row in duration_rows:
        if row.panel_definition_id is not None:
            continue
        if row.sub_type_id is not None:
            continue
        if row.house_type_id is None and row.module_number is None:
            if default_match is None:
                default_match = row
            continue
        if (
            row.house_type_id == house_type_id
            and row.module_number == module_number
            and house_type_id is not None
            and module_number is not None
        ):
            module_match = row
            continue
        if (
            row.house_type_id == house_type_id
            and row.module_number is None
            and house_type_id is not None
        ):
            if house_match is None:
                house_match = row
    if module_match is not None:
        return float(module_match.expected_minutes)
    if house_match is not None:
        return float(house_match.expected_minutes)
    if default_match is not None:
        return float(default_match.expected_minutes)
    return None


def _build_task_pause_details(
    pauses: list[TaskPause],
    completed_at: datetime | None,
    station_id: int | None,
    station_role: StationRole | None,
    station_sequence_order: int | None,
    shift_masks: ShiftMaskResolver,
) -> tuple[float | None, list[TaskAnalysisTaskPause]]:
    if not pauses:
        return None, []

    pause_details: list[TaskAnalysisTaskPause] = []
    total_minutes = 0.0
    has_any_duration = False
    for pause in pauses:
        paused_at = pause.paused_at
        resumed_at = pause.resumed_at
        duration_minutes = None
        if paused_at:
            end_time = resumed_at or completed_at
            if end_time is not None and end_time >= paused_at:
                raw_minutes = (end_time - paused_at).total_seconds() / 60
                masked_minutes = shift_masks.masked_minutes(
                    station_id,
                    paused_at,
                    end_time,
                    sequence_order=station_sequence_order,
                    station_role=station_role,
                )
                duration_minutes = round(
                    raw_minutes if masked_minutes is None else masked_minutes,
                    2,
                )
                total_minutes += duration_minutes
                has_any_duration = True
        pause_details.append(
            TaskAnalysisTaskPause(
                paused_at=paused_at,
                resumed_at=resumed_at,
                duration_minutes=duration_minutes,
                reason=pause.reason_text,
            )
        )

    return (round(total_minutes, 2) if has_any_duration else None, pause_details)


def _mask_query_bounds(
    instances: list[TaskInstance],
    pause_map: dict[int, list[TaskPause]],
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

    for instance in instances:
        _push(instance.started_at)
        _push(instance.completed_at)
        for pause_start, pause_end in _pause_intervals(
            pause_map.get(instance.id, []), instance.completed_at
        ):
            _push(pause_start)
            _push(pause_end)

    if min_dt is None or max_dt is None:
        return None, None
    return min_dt.date(), max_dt.date()


@router.get("/workers", response_model=list[TaskAnalysisWorkerOption])
def list_task_analysis_workers(
    house_type_id: int = Query(...),
    scope: TaskScope = Query(TaskScope.PANEL),
    panel_definition_id: int | None = None,
    module_number: int | None = Query(None, ge=1),
    task_definition_id: int | None = None,
    station_id: int | None = None,
    include_cross_station: bool = Query(False),
    from_date: str | None = None,
    to_date: str | None = None,
    db: Session = Depends(get_db),
) -> list[TaskAnalysisWorkerOption]:
    if scope == TaskScope.AUX:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Task analysis supports panel or module scope only",
        )

    if scope == TaskScope.PANEL:
        if panel_definition_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="panel_definition_id is required for panel scope",
            )
        panel_definition = db.get(PanelDefinition, panel_definition_id)
        if not panel_definition:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Panel definition not found",
            )
        if panel_definition.house_type_id != house_type_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="House type does not match panel definition",
            )
    elif module_number is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="module_number is required for module scope",
        )

    from_dt = _parse_datetime(from_date, "from_date")
    to_dt = _parse_datetime(to_date, "to_date")

    if scope == TaskScope.PANEL:
        instance_stmt = (
            select(TaskInstance.id)
            .join(PanelUnit, TaskInstance.panel_unit_id == PanelUnit.id)
            .join(WorkUnit, PanelUnit.work_unit_id == WorkUnit.id)
            .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
            .where(TaskInstance.scope == TaskScope.PANEL)
            .where(TaskInstance.status == TaskStatus.COMPLETED)
            .where(TaskInstance.completed_at.is_not(None))
            .where(PanelUnit.panel_definition_id == panel_definition_id)
            .where(WorkOrder.house_type_id == house_type_id)
        )
    else:
        instance_stmt = (
            select(TaskInstance.id)
            .join(WorkUnit, TaskInstance.work_unit_id == WorkUnit.id)
            .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
            .where(TaskInstance.scope == TaskScope.MODULE)
            .where(TaskInstance.status == TaskStatus.COMPLETED)
            .where(TaskInstance.completed_at.is_not(None))
            .where(WorkOrder.house_type_id == house_type_id)
            .where(WorkUnit.module_number == module_number)
        )

    apply_station_filter = station_id is not None and not (
        include_cross_station and task_definition_id is not None
    )
    if apply_station_filter:
        if scope == TaskScope.MODULE:
            selected_station = db.get(Station, station_id)
            if selected_station and selected_station.sequence_order is not None:
                instance_stmt = (
                    instance_stmt.join(
                        Station, TaskInstance.station_id == Station.id
                    ).where(
                        Station.sequence_order == selected_station.sequence_order
                    )
                )
            else:
                instance_stmt = instance_stmt.where(TaskInstance.station_id == station_id)
        else:
            instance_stmt = instance_stmt.where(TaskInstance.station_id == station_id)
    if task_definition_id is not None:
        instance_stmt = instance_stmt.where(
            TaskInstance.task_definition_id == task_definition_id
        )
    if from_dt is not None:
        instance_stmt = instance_stmt.where(TaskInstance.completed_at >= from_dt)
    if to_dt is not None:
        instance_stmt = instance_stmt.where(TaskInstance.completed_at <= to_dt)

    instance_ids = list(db.execute(instance_stmt).scalars())
    if not instance_ids:
        return []

    workers = list(
        db.execute(
            select(Worker)
            .join(TaskParticipation, TaskParticipation.worker_id == Worker.id)
            .where(TaskParticipation.task_instance_id.in_(instance_ids))
            .distinct()
            .order_by(Worker.first_name, Worker.last_name, Worker.id)
        ).scalars()
    )
    return [
        TaskAnalysisWorkerOption(
            worker_id=worker.id,
            worker_name=_format_worker_name(worker),
        )
        for worker in workers
    ]


@router.get("/", response_model=TaskAnalysisResponse)
def get_task_analysis(
    house_type_id: int = Query(...),
    scope: TaskScope = Query(TaskScope.PANEL),
    panel_definition_id: int | None = None,
    module_number: int | None = Query(None, ge=1),
    task_definition_id: int | None = None,
    station_id: int | None = None,
    include_cross_station: bool = Query(False),
    worker_id: int | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    db: Session = Depends(get_db),
) -> TaskAnalysisResponse:
    if scope == TaskScope.AUX:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Task analysis supports panel or module scope only",
        )

    panel_definition: PanelDefinition | None = None
    if scope == TaskScope.PANEL:
        if panel_definition_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="panel_definition_id is required for panel scope",
            )
        panel_definition = db.get(PanelDefinition, panel_definition_id)
        if not panel_definition:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Panel definition not found",
            )
        if panel_definition.house_type_id != house_type_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="House type does not match panel definition",
            )
    elif module_number is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="module_number is required for module scope",
        )

    from_dt = _parse_datetime(from_date, "from_date")
    to_dt = _parse_datetime(to_date, "to_date")
    selected_station = db.get(Station, station_id) if station_id is not None else None
    selected_station_sequence = selected_station.sequence_order if selected_station else None

    if scope == TaskScope.PANEL:
        stmt = (
            select(
                TaskInstance,
                TaskDefinition,
                PanelUnit,
                WorkUnit,
                WorkOrder,
            )
            .join(TaskDefinition, TaskInstance.task_definition_id == TaskDefinition.id)
            .join(PanelUnit, TaskInstance.panel_unit_id == PanelUnit.id)
            .join(WorkUnit, PanelUnit.work_unit_id == WorkUnit.id)
            .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
            .where(TaskInstance.scope == TaskScope.PANEL)
            .where(TaskInstance.status == TaskStatus.COMPLETED)
            .where(TaskInstance.completed_at.is_not(None))
            .where(PanelUnit.panel_definition_id == panel_definition_id)
            .where(WorkOrder.house_type_id == house_type_id)
        )
    else:
        stmt = (
            select(
                TaskInstance,
                TaskDefinition,
                WorkUnit,
                WorkOrder,
            )
            .join(TaskDefinition, TaskInstance.task_definition_id == TaskDefinition.id)
            .join(WorkUnit, TaskInstance.work_unit_id == WorkUnit.id)
            .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
            .where(TaskInstance.scope == TaskScope.MODULE)
            .where(TaskInstance.status == TaskStatus.COMPLETED)
            .where(TaskInstance.completed_at.is_not(None))
            .where(WorkOrder.house_type_id == house_type_id)
            .where(WorkUnit.module_number == module_number)
        )

    apply_station_filter = station_id is not None and not (
        include_cross_station and task_definition_id is not None
    )
    if apply_station_filter:
        if scope == TaskScope.MODULE:
            if selected_station and selected_station.sequence_order is not None:
                stmt = (
                    stmt.join(Station, TaskInstance.station_id == Station.id).where(
                        Station.sequence_order == selected_station.sequence_order
                    )
                )
            else:
                stmt = stmt.where(TaskInstance.station_id == station_id)
        else:
            stmt = stmt.where(TaskInstance.station_id == station_id)
    if task_definition_id is not None:
        stmt = stmt.where(TaskInstance.task_definition_id == task_definition_id)
    if worker_id is not None:
        participation_exists = (
            select(TaskParticipation.id)
            .where(TaskParticipation.task_instance_id == TaskInstance.id)
            .where(TaskParticipation.worker_id == worker_id)
        )
        stmt = stmt.where(exists(participation_exists))
    if from_dt is not None:
        stmt = stmt.where(TaskInstance.completed_at >= from_dt)
    if to_dt is not None:
        stmt = stmt.where(TaskInstance.completed_at <= to_dt)

    rows = list(db.execute(stmt.order_by(TaskInstance.completed_at)).all())
    if not rows:
        empty_mode = "task" if task_definition_id else (
            "panel" if scope == TaskScope.PANEL else "module"
        )
        return TaskAnalysisResponse(
            mode=empty_mode,
            data_points=[],
            expected_reference_minutes=None,
            strict_excluded_count=0,
            stats=TaskAnalysisStats(average_duration=None),
        )

    instance_ids = [row[0].id for row in rows]

    participation_rows = list(
        db.execute(
            select(TaskParticipation, Worker)
            .join(Worker, TaskParticipation.worker_id == Worker.id)
            .where(TaskParticipation.task_instance_id.in_(instance_ids))
        ).all()
    )
    worker_name_map: dict[int, list[str]] = {}
    for participation, worker in participation_rows:
        worker_name_map.setdefault(participation.task_instance_id, []).append(
            _format_worker_name(worker)
        )
    for instance_id, names in worker_name_map.items():
        unique_names = sorted(set(names))
        worker_name_map[instance_id] = unique_names

    pause_rows = list(
        db.execute(
            select(TaskPause).where(TaskPause.task_instance_id.in_(instance_ids))
        ).scalars()
    )
    pause_map: dict[int, list[TaskPause]] = {}
    for pause in pause_rows:
        pause_map.setdefault(pause.task_instance_id, []).append(pause)

    instances = [row[0] for row in rows]
    mask_start_date, mask_end_date = _mask_query_bounds(instances, pause_map)
    station_ids = {
        instance.station_id
        for instance in instances
        if instance.station_id is not None
    }
    station_role_by_id: dict[int, StationRole] = {}
    station_sequence_by_id: dict[int, int | None] = {}
    if station_ids:
        for station in db.execute(
            select(Station).where(Station.id.in_(station_ids))
        ).scalars():
            station_role_by_id[station.id] = station.role
            station_sequence_by_id[station.id] = station.sequence_order

    station_ids_by_role: dict[StationRole, set[int]] = {}
    sequence_orders_by_role: dict[StationRole, set[int]] = {}
    for station_id_value in station_ids:
        role = station_role_by_id.get(station_id_value)
        if role is None:
            continue
        station_ids_by_role.setdefault(role, set()).add(station_id_value)
        sequence_order = station_sequence_by_id.get(station_id_value)
        if sequence_order is not None:
            sequence_orders_by_role.setdefault(role, set()).add(sequence_order)

    combined_masks_by_station_day: dict[
        int, dict[date, tuple[datetime, datetime] | None]
    ] = {}
    combined_masks_by_sequence_day: dict[
        tuple[StationRole, int], dict[date, tuple[datetime, datetime] | None]
    ] = {}
    for role in set(station_ids_by_role.keys()) | set(sequence_orders_by_role.keys()):
        role_masks = ShiftMaskResolver.load(
            db,
            station_role=role,
            station_ids=station_ids_by_role.get(role, set()),
            sequence_orders=sequence_orders_by_role.get(role, set()),
            start_date=mask_start_date,
            end_date=mask_end_date,
            algorithm_version=ALGORITHM_VERSION,
        )
        combined_masks_by_station_day.update(role_masks.masks_by_station_day)
        combined_masks_by_sequence_day.update(role_masks.masks_by_sequence_day)
    shift_masks = ShiftMaskResolver(
        masks_by_station_day=combined_masks_by_station_day,
        masks_by_sequence_day=combined_masks_by_sequence_day,
    )

    scope_tasks: list[TaskDefinition] = []
    applicability_map: dict[int, list[TaskApplicability]] = {}
    if task_definition_id is None:
        scope_tasks = list(
            db.execute(
                select(TaskDefinition)
                .where(TaskDefinition.scope == scope)
                .where(TaskDefinition.active == True)
            ).scalars()
        )
        if scope_tasks:
            applicability_rows = list(
                db.execute(
                    select(TaskApplicability).where(
                        TaskApplicability.task_definition_id.in_([task.id for task in scope_tasks])
                    )
                ).scalars()
            )
            for row in applicability_rows:
                applicability_map.setdefault(row.task_definition_id, []).append(row)

    expected_map: dict[int, float] = {}
    module_duration_map: dict[int, list[TaskExpectedDuration]] = {}
    if scope == TaskScope.PANEL:
        if panel_definition is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Panel definition not resolved",
            )
        panel_tasks = scope_tasks if scope_tasks else list(
            db.execute(
                select(TaskDefinition)
                .where(TaskDefinition.scope == TaskScope.PANEL)
                .where(TaskDefinition.active == True)
            ).scalars()
        )
        expected_map = _build_panel_expected_map(panel_definition, panel_tasks)
        duration_rows = list(
            db.execute(
                select(TaskExpectedDuration).where(
                    TaskExpectedDuration.panel_definition_id == panel_definition_id
                )
            ).scalars()
        )
        for row in duration_rows:
            expected_map[row.task_definition_id] = float(row.expected_minutes)
    else:
        module_task_ids = (
            {task.id for task in scope_tasks}
            if task_definition_id is None and scope_tasks
            else {
                row[1].id
                for row in rows
                if isinstance(row[1], TaskDefinition)
            }
        )
        if module_task_ids:
            module_duration_rows = list(
                db.execute(
                    select(TaskExpectedDuration).where(
                        TaskExpectedDuration.task_definition_id.in_(module_task_ids)
                    )
                ).scalars()
            )
            for row in module_duration_rows:
                module_duration_map.setdefault(row.task_definition_id, []).append(row)

    task_entries: list[dict[str, object]] = []
    if scope == TaskScope.PANEL:
        for instance, task_def, panel_unit, work_unit, work_order in rows:
            station_role = station_role_by_id.get(instance.station_id)
            station_sequence_order = station_sequence_by_id.get(instance.station_id)
            duration = _duration_minutes(
                instance,
                pause_map,
                shift_masks,
                station_role,
                station_sequence_order,
            )
            if duration is None or duration <= 0:
                continue
            expected = expected_map.get(task_def.id)
            worker_names = worker_name_map.get(instance.id, [])
            worker_label = ", ".join(worker_names) if worker_names else None
            task_entries.append(
                {
                    "instance": instance,
                    "task_def": task_def,
                    "panel_unit": panel_unit,
                    "work_unit": work_unit,
                    "work_order": work_order,
                    "duration": duration,
                    "expected": expected,
                    "worker_label": worker_label,
                }
            )
    else:
        for instance, task_def, work_unit, work_order in rows:
            station_role = station_role_by_id.get(instance.station_id)
            station_sequence_order = station_sequence_by_id.get(instance.station_id)
            duration = _duration_minutes(
                instance,
                pause_map,
                shift_masks,
                station_role,
                station_sequence_order,
            )
            if duration is None or duration <= 0:
                continue
            expected = _resolve_module_expected(
                module_duration_map.get(task_def.id, []),
                work_order.house_type_id,
                work_unit.module_number,
            )
            worker_names = worker_name_map.get(instance.id, [])
            worker_label = ", ".join(worker_names) if worker_names else None
            task_entries.append(
                {
                    "instance": instance,
                    "task_def": task_def,
                    "work_unit": work_unit,
                    "work_order": work_order,
                    "duration": duration,
                    "expected": expected,
                    "worker_label": worker_label,
                }
            )

    if task_definition_id is None:
        if station_id is None or selected_station_sequence is None:
            return TaskAnalysisResponse(
                mode="panel" if scope == TaskScope.PANEL else "module",
                data_points=[],
                expected_reference_minutes=None,
                strict_excluded_count=0,
                stats=TaskAnalysisStats(average_duration=None),
            )

        grouped: dict[int, dict[str, object]] = {}
        for entry in task_entries:
            work_unit = entry["work_unit"]
            work_order = entry["work_order"]
            if not isinstance(work_unit, WorkUnit) or not isinstance(
                work_order, WorkOrder
            ):
                continue
            group_key: int
            if scope == TaskScope.PANEL:
                panel_unit = entry.get("panel_unit")
                if not isinstance(panel_unit, PanelUnit):
                    continue
                group_key = panel_unit.id
            else:
                group_key = work_unit.id
            group = grouped.get(group_key)
            if not group:
                house_identifier = (
                    work_order.house_identifier or f"WO-{work_order.id}"
                )
                group = {
                    "plan_id": work_unit.id,
                    "house_identifier": house_identifier,
                    "module_number": work_unit.module_number,
                    "completed_at": entry["instance"].completed_at,
                    "work_order": work_order,
                    "work_unit": work_unit,
                    "workers": set(),
                    "raw_active_intervals": [],
                    "masked_active_intervals": [],
                    "mask_fallback": False,
                    "executed_task_ids": set(),
                    "task_counts": {},
                    "breakdown": [],
                }
                grouped[group_key] = group

            duration = float(entry["duration"])
            completed_at = entry["instance"].completed_at
            if completed_at and group["completed_at"]:
                group["completed_at"] = max(
                    group["completed_at"], completed_at
                )
            elif completed_at:
                group["completed_at"] = completed_at

            worker_label = entry["worker_label"]
            if worker_label:
                group["workers"].update(
                    [name.strip() for name in worker_label.split(",") if name.strip()]
                )

            task_def = entry["task_def"]
            instance = entry["instance"]
            if not isinstance(instance, TaskInstance):
                continue
            group["executed_task_ids"].add(task_def.id)
            group["task_counts"][task_def.id] = int(group["task_counts"].get(task_def.id, 0)) + 1
            active_intervals = _active_intervals(instance, pause_map)
            group["raw_active_intervals"].extend(active_intervals)
            station_role = station_role_by_id.get(instance.station_id)
            station_sequence_order = station_sequence_by_id.get(instance.station_id)
            pause_intervals = _pause_intervals(
                pause_map.get(instance.id, []),
                instance.completed_at,
            )
            masked_active_intervals = _mask_intervals(
                instance.station_id,
                station_role,
                station_sequence_order,
                active_intervals,
                shift_masks,
            )
            if masked_active_intervals is None:
                group["mask_fallback"] = True
            else:
                group["masked_active_intervals"].extend(masked_active_intervals)
            masked_pause_intervals = _mask_intervals(
                instance.station_id,
                station_role,
                station_sequence_order,
                pause_intervals,
                shift_masks,
            )
            pause_minutes, pause_details = _build_task_pause_details(
                pause_map.get(instance.id, []),
                instance.completed_at,
                instance.station_id,
                station_role,
                station_sequence_order,
                shift_masks,
            )
            raw_duration = round(_intervals_total_minutes(active_intervals), 2)
            masked_out_minutes = round(max(raw_duration - duration, 0.0), 2)
            timeline_segments = _build_task_timeline_segments(
                task_def.id,
                task_def.name,
                active_intervals,
                pause_intervals,
                masked_active_intervals,
                masked_pause_intervals,
            )
            breakdown = TaskAnalysisTaskBreakdown(
                task_definition_id=task_def.id,
                task_name=task_def.name,
                duration_minutes=duration,
                raw_duration_minutes=raw_duration,
                masked_out_minutes=masked_out_minutes,
                expected_minutes=entry["expected"],
                started_at=instance.started_at,
                completed_at=completed_at,
                worker_name=worker_label,
                pause_minutes=pause_minutes,
                pauses=pause_details,
                timeline_segments=timeline_segments,
            )
            group["breakdown"].append(breakdown)

        panel_task_order_set = (
            set(panel_definition.applicable_task_ids or [])
            if scope == TaskScope.PANEL and panel_definition and panel_definition.applicable_task_ids is not None
            else None
        )
        required_expected_cache: dict[
            tuple[int, int | None, int, int | None], dict[int, float] | None
        ] = {}

        def resolve_required_expected_by_task(
            work_order: WorkOrder,
            work_unit: WorkUnit,
        ) -> dict[int, float] | None:
            context_key = (
                work_order.house_type_id,
                work_order.sub_type_id,
                work_unit.module_number,
                panel_definition_id if scope == TaskScope.PANEL else None,
            )
            if context_key in required_expected_cache:
                return required_expected_cache[context_key]
            if not scope_tasks:
                required_expected_cache[context_key] = None
                return None

            required_expected: dict[int, float] = {}
            for task in scope_tasks:
                if panel_task_order_set is not None and task.id not in panel_task_order_set:
                    continue
                applies, station_sequence = resolve_task_station_sequence(
                    task,
                    applicability_map.get(task.id, []),
                    work_order.house_type_id,
                    work_order.sub_type_id,
                    work_unit.module_number,
                    panel_definition_id if scope == TaskScope.PANEL else None,
                )
                if not applies or station_sequence is None or station_sequence != selected_station_sequence:
                    continue

                expected_minutes = (
                    expected_map.get(task.id)
                    if scope == TaskScope.PANEL
                    else _resolve_module_expected(
                        module_duration_map.get(task.id, []),
                        work_order.house_type_id,
                        work_unit.module_number,
                    )
                )
                if expected_minutes is None or expected_minutes <= 0:
                    required_expected_cache[context_key] = None
                    return None
                required_expected[task.id] = float(expected_minutes)

            if not required_expected:
                required_expected_cache[context_key] = None
                return None
            required_expected_cache[context_key] = required_expected
            return required_expected

        data_points: list[TaskAnalysisDataPoint] = []
        durations: list[float] = []
        expected_refs: list[float] = []
        strict_excluded_count = 0
        for group in grouped.values():
            work_order = group["work_order"]
            work_unit = group["work_unit"]
            if not isinstance(work_order, WorkOrder) or not isinstance(work_unit, WorkUnit):
                continue
            required_expected = resolve_required_expected_by_task(work_order, work_unit)
            if not required_expected:
                strict_excluded_count += 1
                continue
            required_task_ids = set(required_expected.keys())
            executed_task_ids = set(group["executed_task_ids"])
            if executed_task_ids != required_task_ids:
                strict_excluded_count += 1
                continue
            task_counts = group["task_counts"]
            if not isinstance(task_counts, dict):
                strict_excluded_count += 1
                continue
            if any(int(task_counts.get(task_id, 0)) != 1 for task_id in required_task_ids):
                strict_excluded_count += 1
                continue
            if any(task_id not in required_task_ids for task_id in task_counts.keys()):
                strict_excluded_count += 1
                continue

            raw_intervals = _merge_intervals(group["raw_active_intervals"])
            masked_intervals = _merge_intervals(group["masked_active_intervals"])
            merged_intervals = raw_intervals if group["mask_fallback"] else masked_intervals
            duration = round(_intervals_total_minutes(merged_intervals), 2)
            if duration <= 0:
                strict_excluded_count += 1
                continue
            durations.append(duration)
            expected_minutes = round(sum(required_expected.values()), 2)
            expected_refs.append(expected_minutes)
            worker_names = sorted(group["workers"])
            worker_label = ", ".join(worker_names) if worker_names else None
            breakdown = sorted(
                group["breakdown"],
                key=lambda item: item.completed_at or datetime.min,
            )
            data_points.append(
                TaskAnalysisDataPoint(
                    plan_id=group["plan_id"],
                    house_identifier=group["house_identifier"],
                    module_number=group["module_number"],
                    duration_minutes=duration,
                    expected_minutes=expected_minutes,
                    completed_at=group["completed_at"],
                    worker_name=worker_label,
                    task_breakdown=breakdown,
                )
            )

        return TaskAnalysisResponse(
            mode="panel" if scope == TaskScope.PANEL else "module",
            data_points=data_points,
            expected_reference_minutes=_average(expected_refs),
            strict_excluded_count=strict_excluded_count,
            stats=TaskAnalysisStats(average_duration=_average(durations)),
        )

    data_points = []
    durations = []
    expected_refs: list[float] = []
    for entry in task_entries:
        instance = entry["instance"]
        task_def = entry["task_def"]
        work_unit = entry["work_unit"]
        work_order = entry["work_order"]
        if not isinstance(instance, TaskInstance):
            continue
        if not isinstance(work_unit, WorkUnit) or not isinstance(
            work_order, WorkOrder
        ):
            continue
        house_identifier = work_order.house_identifier or f"WO-{work_order.id}"
        duration = float(entry["duration"])
        durations.append(duration)
        expected = entry["expected"]
        if expected is not None:
            expected_refs.append(float(expected))
        station_role = station_role_by_id.get(instance.station_id)
        station_sequence_order = station_sequence_by_id.get(instance.station_id)
        pauses = pause_map.get(instance.id, [])
        active_intervals = _active_intervals(instance, pause_map)
        pause_intervals = _pause_intervals(pauses, instance.completed_at)
        masked_active_intervals = _mask_intervals(
            instance.station_id,
            station_role,
            station_sequence_order,
            active_intervals,
            shift_masks,
        )
        masked_pause_intervals = _mask_intervals(
            instance.station_id,
            station_role,
            station_sequence_order,
            pause_intervals,
            shift_masks,
        )
        raw_duration = round(_intervals_total_minutes(active_intervals), 2)
        masked_out_minutes = round(max(raw_duration - duration, 0.0), 2)
        pause_minutes, pause_details = _build_task_pause_details(
            pauses,
            instance.completed_at,
            instance.station_id,
            station_role,
            station_sequence_order,
            shift_masks,
        )
        timeline_segments = _build_task_timeline_segments(
            task_def.id,
            task_def.name,
            active_intervals,
            pause_intervals,
            masked_active_intervals,
            masked_pause_intervals,
        )
        breakdown = TaskAnalysisTaskBreakdown(
            task_definition_id=task_def.id,
            task_name=task_def.name,
            duration_minutes=duration,
            raw_duration_minutes=raw_duration,
            masked_out_minutes=masked_out_minutes,
            expected_minutes=expected,
            started_at=instance.started_at,
            completed_at=instance.completed_at,
            worker_name=entry["worker_label"],
            pause_minutes=pause_minutes,
            pauses=pause_details,
            timeline_segments=timeline_segments,
        )
        data_points.append(
            TaskAnalysisDataPoint(
                plan_id=work_unit.id,
                house_identifier=house_identifier,
                module_number=work_unit.module_number,
                task_definition_id=task_def.id,
                task_name=task_def.name,
                duration_minutes=duration,
                expected_minutes=expected,
                completed_at=instance.completed_at,
                worker_name=entry["worker_label"],
                task_breakdown=[breakdown],
            )
        )

    return TaskAnalysisResponse(
        mode="task",
        data_points=data_points,
        expected_reference_minutes=_average(expected_refs),
        strict_excluded_count=0,
        stats=TaskAnalysisStats(average_duration=_average(durations)),
    )
