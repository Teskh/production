from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.enums import TaskScope, TaskStatus
from app.models.house import PanelDefinition
from app.models.tasks import (
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
    TaskAnalysisResponse,
    TaskAnalysisStats,
    TaskAnalysisTaskBreakdown,
)

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


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


@router.get("/", response_model=TaskAnalysisResponse)
def get_task_analysis(
    house_type_id: int = Query(...),
    panel_definition_id: int = Query(...),
    task_definition_id: int | None = None,
    station_id: int | None = None,
    worker_id: int | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    db: Session = Depends(get_db),
) -> TaskAnalysisResponse:
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

    from_dt = _parse_datetime(from_date, "from_date")
    to_dt = _parse_datetime(to_date, "to_date")

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

    if station_id is not None:
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
        return TaskAnalysisResponse(
            mode="task" if task_definition_id else "panel",
            data_points=[],
            expected_reference_minutes=None,
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

    panel_tasks = list(
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

    task_entries: list[dict[str, object]] = []
    for instance, task_def, panel_unit, work_unit, work_order in rows:
        duration = _duration_minutes(instance, pause_map)
        if duration is None:
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

    if task_definition_id is None:
        grouped: dict[int, dict[str, object]] = {}
        for entry in task_entries:
            panel_unit = entry["panel_unit"]
            if not isinstance(panel_unit, PanelUnit):
                continue
            panel_unit_id = panel_unit.id
            group = grouped.get(panel_unit_id)
            if not group:
                work_unit = entry["work_unit"]
                work_order = entry["work_order"]
                if not isinstance(work_unit, WorkUnit) or not isinstance(
                    work_order, WorkOrder
                ):
                    continue
                house_identifier = (
                    work_order.house_identifier or f"WO-{work_order.id}"
                )
                group = {
                    "plan_id": work_unit.id,
                    "house_identifier": house_identifier,
                    "module_number": work_unit.module_number,
                    "duration": 0.0,
                    "expected_values": [],
                    "missing_expected": False,
                    "completed_at": entry["instance"].completed_at,
                    "workers": set(),
                    "breakdown": [],
                }
                grouped[panel_unit_id] = group

            duration = float(entry["duration"])
            group["duration"] = float(group["duration"]) + duration
            expected = entry["expected"]
            if expected is None:
                group["missing_expected"] = True
            else:
                group["expected_values"].append(float(expected))
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
            breakdown = TaskAnalysisTaskBreakdown(
                task_definition_id=task_def.id,
                task_name=task_def.name,
                duration_minutes=duration,
                expected_minutes=entry["expected"],
                completed_at=completed_at,
                worker_name=worker_label,
            )
            group["breakdown"].append(breakdown)

        data_points: list[TaskAnalysisDataPoint] = []
        durations: list[float] = []
        expected_refs: list[float] = []
        for group in grouped.values():
            duration = round(float(group["duration"]), 2)
            durations.append(duration)
            expected_minutes = None
            if not group["missing_expected"] and group["expected_values"]:
                expected_minutes = round(sum(group["expected_values"]), 2)
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
            mode="panel",
            data_points=data_points,
            expected_reference_minutes=_average(expected_refs),
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
            )
        )

    return TaskAnalysisResponse(
        mode="task",
        data_points=data_points,
        expected_reference_minutes=_average(expected_refs),
        stats=TaskAnalysisStats(average_duration=_average(durations)),
    )
