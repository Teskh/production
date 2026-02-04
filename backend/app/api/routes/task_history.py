from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.admin import PauseReason
from app.models.enums import TaskScope, TaskStatus
from app.models.house import HouseSubType, HouseType, PanelDefinition
from app.models.stations import Station
from app.models.tasks import (
    TaskDefinition,
    TaskExpectedDuration,
    TaskInstance,
    TaskParticipation,
    TaskPause,
)
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.models.workers import Worker
from app.schemas.analytics import PanelTaskHistoryPause, TaskHistoryRow

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


def _pause_minutes(pauses: list[TaskPause], completed_at: datetime) -> float:
    total = 0.0
    for pause in pauses:
        if not pause.paused_at:
            continue
        end_time = pause.resumed_at or completed_at
        if end_time is None:
            continue
        if end_time < pause.paused_at:
            continue
        total += (end_time - pause.paused_at).total_seconds() / 60
    return total


def _duration_minutes(instance: TaskInstance, pause_map: dict[int, list[TaskPause]]) -> float | None:
    if not instance.started_at or not instance.completed_at:
        return None
    base_minutes = (instance.completed_at - instance.started_at).total_seconds() / 60
    pause_minutes = _pause_minutes(pause_map.get(instance.id, []), instance.completed_at)
    return round(max(base_minutes - pause_minutes, 0.0), 2)


def _pause_duration_seconds(pause: TaskPause, completed_at: datetime | None) -> float | None:
    if not pause.paused_at:
        return None
    end_time = pause.resumed_at or completed_at
    if end_time is None:
        return None
    if end_time < pause.paused_at:
        return None
    return round((end_time - pause.paused_at).total_seconds(), 2)


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
        if row.house_type_id == house_type_id and row.module_number is None and house_type_id is not None:
            if house_match is None:
                house_match = row
    if module_match is not None:
        return float(module_match.expected_minutes)
    if house_match is not None:
        return float(house_match.expected_minutes)
    if default_match is not None:
        return float(default_match.expected_minutes)
    return None


@router.get("/", response_model=list[TaskHistoryRow])
def get_task_history(
    from_date: str | None = None,
    to_date: str | None = None,
    house_type_id: int | None = None,
    sub_type_id: int | None = None,
    station_id: int | None = None,
    worker_id: int | None = None,
    task_definition_id: int | None = None,
    panel_definition_id: int | None = None,
    scope: TaskScope | None = None,
    status: TaskStatus | None = None,
    sort_by: str = "started_at",
    sort_order: str = "desc",
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> list[TaskHistoryRow]:
    from_dt = _parse_datetime(from_date, "from_date")
    to_dt = _parse_datetime(to_date, "to_date", end_of_day=True)

    effective_status = status or TaskStatus.COMPLETED

    stmt = (
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
        .where(TaskInstance.status == effective_status)
    )

    if effective_status == TaskStatus.COMPLETED:
        stmt = stmt.where(TaskInstance.completed_at.is_not(None))

    if scope is not None:
        stmt = stmt.where(TaskInstance.scope == scope)
    if house_type_id is not None:
        stmt = stmt.where(WorkOrder.house_type_id == house_type_id)
    if sub_type_id is not None:
        stmt = stmt.where(WorkOrder.sub_type_id == sub_type_id)
    if station_id is not None:
        stmt = stmt.where(TaskInstance.station_id == station_id)
    if task_definition_id is not None:
        stmt = stmt.where(TaskInstance.task_definition_id == task_definition_id)
    if panel_definition_id is not None:
        stmt = stmt.where(PanelDefinition.id == panel_definition_id)
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

    sort_columns = {
        "started_at": TaskInstance.started_at,
        "completed_at": TaskInstance.completed_at,
        "task_definition_name": TaskDefinition.name,
        "panel_code": PanelDefinition.panel_code,
        "house_type_name": HouseType.name,
        "house_sub_type_name": HouseSubType.name,
        "house_identifier": WorkOrder.house_identifier,
        "module_number": WorkUnit.module_number,
        "station_name": Station.name,
        "scope": TaskInstance.scope,
    }
    order_column = sort_columns.get(sort_by, TaskInstance.started_at)
    if sort_order.lower() == "asc":
        stmt = stmt.order_by(order_column.asc().nullslast())
    else:
        stmt = stmt.order_by(order_column.desc().nullslast())

    rows = list(db.execute(stmt.offset(offset).limit(limit)).all())
    if not rows:
        return []

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
        worker_name_map[instance_id] = sorted(set(names))

    pause_rows = list(
        db.execute(
            select(TaskPause, PauseReason)
            .outerjoin(PauseReason, TaskPause.reason_id == PauseReason.id)
            .where(TaskPause.task_instance_id.in_(instance_ids))
        ).all()
    )
    pause_map: dict[int, list[tuple[TaskPause, str | None]]] = {}
    pause_instances: dict[int, list[TaskPause]] = {}
    for pause, reason in pause_rows:
        pause_map.setdefault(pause.task_instance_id, []).append(
            (pause, reason.name if reason else None)
        )
        pause_instances.setdefault(pause.task_instance_id, []).append(pause)

    panel_tasks = list(
        db.execute(
            select(TaskDefinition)
            .where(TaskDefinition.scope == TaskScope.PANEL)
            .where(TaskDefinition.active == True)
        ).scalars()
    )

    panel_definitions: dict[int, PanelDefinition] = {}
    module_task_ids: set[int] = set()
    for instance, _task_def, _work_unit, _work_order, _house_type, _house_sub_type, _station, _panel_unit, panel_def in rows:
        if instance.scope == TaskScope.PANEL and panel_def is not None:
            panel_definitions[panel_def.id] = panel_def
        elif instance.task_definition_id:
            module_task_ids.add(instance.task_definition_id)

    expected_maps: dict[int, dict[int, float]] = {}
    for panel_definition in panel_definitions.values():
        expected_maps[panel_definition.id] = _build_panel_expected_map(
            panel_definition, panel_tasks
        )

    if panel_definitions:
        duration_rows = list(
            db.execute(
                select(TaskExpectedDuration).where(
                    TaskExpectedDuration.panel_definition_id.in_(panel_definitions.keys())
                )
            ).scalars()
        )
        for row in duration_rows:
            expected_maps.setdefault(row.panel_definition_id, {})[
                row.task_definition_id
            ] = float(row.expected_minutes)

    module_duration_rows = list(
        db.execute(
            select(TaskExpectedDuration).where(
                TaskExpectedDuration.task_definition_id.in_(module_task_ids)
            )
        ).scalars()
    )
    module_duration_map: dict[int, list[TaskExpectedDuration]] = {}
    for row in module_duration_rows:
        module_duration_map.setdefault(row.task_definition_id, []).append(row)

    response_rows: list[TaskHistoryRow] = []
    for (
        instance,
        task_def,
        work_unit,
        work_order,
        house_type,
        house_sub_type,
        station,
        _panel_unit,
        panel_definition,
    ) in rows:
        duration = _duration_minutes(instance, pause_instances)
        expected: float | None = None
        if instance.scope == TaskScope.PANEL and panel_definition is not None:
            expected = expected_maps.get(panel_definition.id, {}).get(task_def.id)
        elif instance.task_definition_id:
            expected = _resolve_module_expected(
                module_duration_map.get(task_def.id, []),
                work_order.house_type_id,
                work_unit.module_number,
            )
        worker_names = worker_name_map.get(instance.id, [])
        worker_label = ", ".join(worker_names) if worker_names else None
        pauses_payload: list[PanelTaskHistoryPause] = []
        for pause, reason_name in pause_map.get(instance.id, []):
            reason_label = reason_name or pause.reason_text
            pauses_payload.append(
                PanelTaskHistoryPause(
                    paused_at=pause.paused_at,
                    resumed_at=pause.resumed_at,
                    duration_seconds=_pause_duration_seconds(
                        pause, instance.completed_at
                    ),
                    reason=reason_label,
                )
            )
        house_identifier = work_order.house_identifier or f"WO-{work_order.id}"
        response_rows.append(
            TaskHistoryRow(
                task_instance_id=instance.id,
                scope=instance.scope.value if instance.scope else None,
                task_definition_id=task_def.id,
                task_definition_name=task_def.name,
                panel_definition_id=panel_definition.id if panel_definition else None,
                panel_code=panel_definition.panel_code if panel_definition else None,
                house_type_id=work_order.house_type_id,
                house_type_name=house_type.name,
                house_sub_type_name=house_sub_type.name if house_sub_type else None,
                house_identifier=house_identifier,
                project_name=work_order.project_name,
                module_number=work_unit.module_number,
                station_id=station.id,
                station_name=station.name,
                worker_name=worker_label,
                started_at=instance.started_at,
                completed_at=instance.completed_at,
                duration_minutes=duration,
                expected_minutes=expected,
                notes=instance.notes,
                pauses=pauses_payload,
            )
        )

    return response_rows
