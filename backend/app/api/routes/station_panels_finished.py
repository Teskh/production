from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.admin import PauseReason
from app.models.enums import StationRole, TaskExceptionType, TaskScope, TaskStatus
from app.models.house import HouseSubType, HouseType, PanelDefinition
from app.models.stations import Station
from app.models.tasks import (
    TaskDefinition,
    TaskExpectedDuration,
    TaskException,
    TaskInstance,
    TaskParticipation,
    TaskPause,
)
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.models.workers import Worker
from app.schemas.analytics import (
    PanelTaskHistoryPause,
    StationPanelsFinishedHouse,
    StationPanelsFinishedModule,
    StationPanelsFinishedPanel,
    StationPanelsFinishedPanelSummary,
    StationPanelsFinishedResponse,
    StationPanelsFinishedTask,
    StationPanelsFinishedWorkerEntry,
)

router = APIRouter()


def _parse_date_range(value: str | None) -> tuple[datetime | None, datetime | None]:
    if value is None:
        return None, None
    raw = value.strip()
    if not raw:
        return None, None
    normalized = raw.replace(" ", "T")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid date value",
        ) from exc
    if len(raw) == 10:
        start = dt.replace(hour=0, minute=0, second=0, microsecond=0)
        end = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
        return start, end
    return dt, dt


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


def _pause_duration_seconds(
    pause: TaskPause, completed_at: datetime | None
) -> float | None:
    if pause.paused_at is None:
        return None
    end_time = pause.resumed_at or completed_at
    if end_time is None:
        return None
    if end_time < pause.paused_at:
        return None
    return (end_time - pause.paused_at).total_seconds()


def _pause_minutes(pauses: list[TaskPause], completed_at: datetime | None) -> float:
    total = 0.0
    for pause in pauses:
        duration = _pause_duration_seconds(pause, completed_at)
        if duration is None:
            continue
        total += duration / 60
    return total


def _duration_minutes(
    instance: TaskInstance, pause_map: dict[int, list[TaskPause]]
) -> float | None:
    if not instance.started_at or not instance.completed_at:
        return None
    base_minutes = (instance.completed_at - instance.started_at).total_seconds() / 60
    pause_minutes = _pause_minutes(pause_map.get(instance.id, []), instance.completed_at)
    return max(base_minutes - pause_minutes, 0.0)


@router.get("/", response_model=StationPanelsFinishedResponse)
def get_station_panels_finished(
    station_id: int,
    date: str | None = None,
    house_type_id: int | None = None,
    sub_type_id: int | None = None,
    db: Session = Depends(get_db),
) -> StationPanelsFinishedResponse:
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")

    start_dt, end_dt = _parse_date_range(date)

    stmt = (
        select(
            TaskInstance,
            TaskDefinition,
            PanelUnit,
            PanelDefinition,
            WorkUnit,
            WorkOrder,
            HouseType,
            HouseSubType,
        )
        .join(TaskDefinition, TaskInstance.task_definition_id == TaskDefinition.id)
        .join(PanelUnit, TaskInstance.panel_unit_id == PanelUnit.id)
        .join(PanelDefinition, PanelUnit.panel_definition_id == PanelDefinition.id)
        .join(WorkUnit, PanelUnit.work_unit_id == WorkUnit.id)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
        .outerjoin(HouseSubType, WorkOrder.sub_type_id == HouseSubType.id)
        .where(TaskInstance.scope == TaskScope.PANEL)
        .where(TaskInstance.status == TaskStatus.COMPLETED)
        .where(TaskInstance.station_id == station_id)
        .where(TaskInstance.completed_at.is_not(None))
    )

    if start_dt is not None:
        stmt = stmt.where(TaskInstance.completed_at >= start_dt)
    if end_dt is not None:
        stmt = stmt.where(TaskInstance.completed_at <= end_dt)
    if house_type_id is not None:
        stmt = stmt.where(WorkOrder.house_type_id == house_type_id)
    if sub_type_id is not None:
        stmt = stmt.where(WorkOrder.sub_type_id == sub_type_id)

    task_rows = list(db.execute(stmt).all())

    exception_stmt = (
        select(
            TaskException,
            TaskDefinition,
            PanelUnit,
            PanelDefinition,
            WorkUnit,
            WorkOrder,
            HouseType,
            HouseSubType,
        )
        .join(TaskDefinition, TaskException.task_definition_id == TaskDefinition.id)
        .join(PanelUnit, TaskException.panel_unit_id == PanelUnit.id)
        .join(PanelDefinition, PanelUnit.panel_definition_id == PanelDefinition.id)
        .join(WorkUnit, PanelUnit.work_unit_id == WorkUnit.id)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
        .outerjoin(HouseSubType, WorkOrder.sub_type_id == HouseSubType.id)
        .where(TaskException.scope == TaskScope.PANEL)
        .where(TaskException.exception_type == TaskExceptionType.SKIP)
        .where(TaskException.station_id == station_id)
    )
    if start_dt is not None:
        exception_stmt = exception_stmt.where(TaskException.created_at >= start_dt)
    if end_dt is not None:
        exception_stmt = exception_stmt.where(TaskException.created_at <= end_dt)
    if house_type_id is not None:
        exception_stmt = exception_stmt.where(WorkOrder.house_type_id == house_type_id)
    if sub_type_id is not None:
        exception_stmt = exception_stmt.where(WorkOrder.sub_type_id == sub_type_id)

    exception_rows = list(db.execute(exception_stmt).all())

    if not task_rows and not exception_rows:
        return StationPanelsFinishedResponse(
            total_panels_finished=0,
            houses=[],
            panels_passed_today_count=0,
            panels_passed_today_list=[],
            panels_passed_today_area_sum=0.0,
        )

    panel_tasks = list(
        db.execute(select(TaskDefinition).where(TaskDefinition.scope == TaskScope.PANEL)).scalars()
    )
    panel_definitions: dict[int, PanelDefinition] = {}
    task_definitions: dict[int, TaskDefinition] = {}

    for row in task_rows:
        _, task_def, _, panel_def, _, _, _, _ = row
        panel_definitions[panel_def.id] = panel_def
        task_definitions[task_def.id] = task_def
    for row in exception_rows:
        _, task_def, _, panel_def, _, _, _, _ = row
        panel_definitions[panel_def.id] = panel_def
        task_definitions[task_def.id] = task_def

    expected_maps: dict[int, dict[int, float]] = {}
    for panel_definition in panel_definitions.values():
        expected_maps[panel_definition.id] = _build_panel_expected_map(
            panel_definition, panel_tasks
        )

    if panel_definitions:
        overrides = list(
            db.execute(
                select(TaskExpectedDuration).where(
                    TaskExpectedDuration.panel_definition_id.in_(panel_definitions.keys())
                )
            ).scalars()
        )
        for row in overrides:
            expected_maps.setdefault(row.panel_definition_id, {})[
                row.task_definition_id
            ] = float(row.expected_minutes)

    instance_ids = [row[0].id for row in task_rows]
    participation_rows = list(
        db.execute(
            select(TaskParticipation, Worker)
            .join(Worker, TaskParticipation.worker_id == Worker.id)
            .where(TaskParticipation.task_instance_id.in_(instance_ids))
        ).all()
    )
    worker_map: dict[int, list[Worker]] = {}
    for participation, worker in participation_rows:
        worker_map.setdefault(participation.task_instance_id, []).append(worker)

    pause_rows = list(
        db.execute(
            select(TaskPause, PauseReason)
            .outerjoin(PauseReason, TaskPause.reason_id == PauseReason.id)
            .where(TaskPause.task_instance_id.in_(instance_ids))
        ).all()
    )
    pause_map: dict[int, list[TaskPause]] = {}
    pause_reason_map: dict[int, list[tuple[TaskPause, str | None]]] = {}
    for pause, reason in pause_rows:
        pause_map.setdefault(pause.task_instance_id, []).append(pause)
        pause_reason_map.setdefault(pause.task_instance_id, []).append(
            (pause, reason.name if reason else pause.reason_text)
        )

    panel_builds: dict[int, dict[str, object]] = {}

    def get_panel_build(
        panel_unit: PanelUnit,
        panel_definition: PanelDefinition,
        work_unit: WorkUnit,
        work_order: WorkOrder,
        house_type: HouseType,
        house_sub_type: HouseSubType | None,
    ) -> dict[str, object]:
        build = panel_builds.get(panel_unit.id)
        if build:
            return build
        build = {
            "panel_unit": panel_unit,
            "panel_definition": panel_definition,
            "work_unit": work_unit,
            "work_order": work_order,
            "house_type": house_type,
            "house_sub_type": house_sub_type,
            "tasks": {},
        }
        panel_builds[panel_unit.id] = build
        return build

    def merge_task(panel_build: dict[str, object], task_id: int, data: dict[str, object]) -> None:
        tasks: dict[int, dict[str, object]] = panel_build["tasks"]  # type: ignore[assignment]
        existing = tasks.get(task_id)
        if not existing:
            tasks[task_id] = data
            return
        existing_source = existing.get("source")
        incoming_source = data.get("source")
        if existing_source == "instance" and incoming_source != "instance":
            return
        if existing_source != "instance" and incoming_source == "instance":
            tasks[task_id] = data
            return
        existing_time = existing.get("satisfied_at")
        incoming_time = data.get("satisfied_at")
        if existing_time is None:
            tasks[task_id] = data
            return
        if incoming_time is None:
            return
        if incoming_time > existing_time:
            tasks[task_id] = data

    for instance, task_def, panel_unit, panel_def, work_unit, work_order, house_type, house_sub_type in task_rows:
        panel_build = get_panel_build(
            panel_unit, panel_def, work_unit, work_order, house_type, house_sub_type
        )
        expected = expected_maps.get(panel_def.id, {}).get(task_def.id)
        pauses = pause_map.get(instance.id, [])
        pause_entries: list[PanelTaskHistoryPause] = []
        for pause, reason in pause_reason_map.get(instance.id, []):
            pause_entries.append(
                PanelTaskHistoryPause(
                    paused_at=pause.paused_at,
                    resumed_at=pause.resumed_at,
                    duration_seconds=_pause_duration_seconds(
                        pause, instance.completed_at
                    ),
                    reason=reason,
                )
            )
        pause_minutes = _pause_minutes(pauses, instance.completed_at)
        duration_minutes = _duration_minutes(instance, pause_map)

        worker_entries: list[StationPanelsFinishedWorkerEntry] = []
        for worker in worker_map.get(instance.id, []):
            worker_entries.append(
                StationPanelsFinishedWorkerEntry(
                    worker_id=worker.id,
                    worker_name=_format_worker_name(worker),
                    started_at=instance.started_at,
                    completed_at=instance.completed_at,
                )
            )
        if instance.notes or pause_entries:
            worker_entries.insert(
                0,
                StationPanelsFinishedWorkerEntry(
                    worker_id=None,
                    worker_name=None,
                    started_at=instance.started_at,
                    completed_at=instance.completed_at,
                    notes=instance.notes,
                    pauses=pause_entries,
                ),
            )
        if not worker_entries:
            worker_entries.append(
                StationPanelsFinishedWorkerEntry(
                    worker_id=None,
                    worker_name=None,
                    started_at=instance.started_at,
                    completed_at=instance.completed_at,
                )
            )

        merge_task(
            panel_build,
            task_def.id,
            {
                "task_def": task_def,
                "expected_minutes": expected,
                "actual_minutes": duration_minutes,
                "satisfied_at": instance.completed_at,
                "started_at": instance.started_at,
                "worker_entries": worker_entries,
                "pause_entries": pause_entries,
                "paused_minutes": pause_minutes,
                "source": "instance",
            },
        )

    for exception, task_def, panel_unit, panel_def, work_unit, work_order, house_type, house_sub_type in exception_rows:
        panel_build = get_panel_build(
            panel_unit, panel_def, work_unit, work_order, house_type, house_sub_type
        )
        expected = expected_maps.get(panel_def.id, {}).get(task_def.id)
        merge_task(
            panel_build,
            task_def.id,
            {
                "task_def": task_def,
                "expected_minutes": expected,
                "actual_minutes": None,
                "satisfied_at": exception.created_at,
                "started_at": None,
                "worker_entries": [],
                "pause_entries": [],
                "paused_minutes": 0.0,
                "source": "skip",
            },
        )

    available_map: dict[int, datetime] = {}
    if station.role == StationRole.PANELS and station.sequence_order is not None:
        panel_unit_ids = list(panel_builds.keys())
        if panel_unit_ids:
            prev_stmt = (
                select(TaskInstance.panel_unit_id, func.max(TaskInstance.completed_at))
                .join(Station, TaskInstance.station_id == Station.id)
                .where(TaskInstance.panel_unit_id.in_(panel_unit_ids))
                .where(TaskInstance.completed_at.is_not(None))
                .where(Station.role == StationRole.PANELS)
                .where(Station.sequence_order < station.sequence_order)
                .group_by(TaskInstance.panel_unit_id)
            )
            for panel_unit_id, completed_at in db.execute(prev_stmt).all():
                if completed_at:
                    available_map[int(panel_unit_id)] = completed_at

    houses_map: dict[int, dict[str, object]] = {}
    panels_summary: list[StationPanelsFinishedPanelSummary] = []

    for panel_unit_id, build in panel_builds.items():
        panel_definition: PanelDefinition = build["panel_definition"]  # type: ignore[assignment]
        work_unit: WorkUnit = build["work_unit"]  # type: ignore[assignment]
        work_order: WorkOrder = build["work_order"]  # type: ignore[assignment]
        house_type: HouseType = build["house_type"]  # type: ignore[assignment]
        house_sub_type: HouseSubType | None = build.get("house_sub_type")  # type: ignore[assignment]
        tasks: dict[int, dict[str, object]] = build["tasks"]  # type: ignore[assignment]

        task_list = list(tasks.values())
        if panel_definition.applicable_task_ids:
            order_index = {
                task_id: idx for idx, task_id in enumerate(panel_definition.applicable_task_ids)
            }
            task_list.sort(
                key=lambda item: (
                    order_index.get(
                        item["task_def"].id, 1_000_000  # type: ignore[index]
                    ),
                    item["task_def"].name.lower(),  # type: ignore[index]
                )
            )
        else:
            task_list.sort(key=lambda item: _panel_task_order_key(item["task_def"]))  # type: ignore[arg-type]

        expected_total = sum(
            float(item["expected_minutes"])
            for item in task_list
            if item.get("expected_minutes") is not None
        )
        actual_total = sum(
            float(item["actual_minutes"])
            for item in task_list
            if item.get("actual_minutes") is not None
        )
        paused_total = sum(
            float(item.get("paused_minutes", 0.0)) for item in task_list
        )

        started_at_candidates = [
            item.get("started_at") for item in task_list if item.get("started_at") is not None
        ]
        satisfied_candidates = [
            item.get("satisfied_at")
            for item in task_list
            if item.get("satisfied_at") is not None
        ]
        station_started_at = (
            min(started_at_candidates) if started_at_candidates else None
        )
        if station_started_at is None and satisfied_candidates:
            station_started_at = min(satisfied_candidates)
        station_finished_at = (
            max(satisfied_candidates) if satisfied_candidates else None
        )

        pause_entries = [
            pause
            for item in task_list
            for pause in (item.get("pause_entries") or [])
        ]

        panel_tasks = [
            StationPanelsFinishedTask(
                task_definition_id=item["task_def"].id,  # type: ignore[index]
                task_name=item["task_def"].name,  # type: ignore[index]
                expected_minutes=item.get("expected_minutes"),
                actual_minutes=item.get("actual_minutes"),
                satisfied_at=item.get("satisfied_at"),
                worker_entries=item.get("worker_entries") or [],
            )
            for item in task_list
        ]

        panel_area = float(panel_definition.panel_area) if panel_definition.panel_area is not None else None
        house_identifier = work_order.house_identifier or f"WO-{work_order.id}"

        panel_payload = StationPanelsFinishedPanel(
            plan_id=work_unit.id,
            panel_definition_id=panel_definition.id,
            panel_code=panel_definition.panel_code,
            panel_area=panel_area,
            available_at=available_map.get(panel_unit_id),
            station_started_at=station_started_at,
            station_finished_at=station_finished_at,
            finished_at=station_finished_at,
            expected_minutes=round(expected_total, 2) if expected_total else None,
            actual_minutes=round(actual_total, 2) if actual_total else None,
            paused_minutes=round(paused_total, 2) if paused_total else None,
            pauses=pause_entries,
            tasks=panel_tasks,
            house_identifier=house_identifier,
            module_number=work_unit.module_number,
            project_name=work_order.project_name,
        )

        summary_payload = StationPanelsFinishedPanelSummary(
            plan_id=work_unit.id,
            panel_definition_id=panel_definition.id,
            panel_code=panel_definition.panel_code,
            house_identifier=house_identifier,
            module_number=work_unit.module_number,
            panel_area=panel_area,
            satisfied_at=station_finished_at,
        )
        panels_summary.append(summary_payload)

        house_key = work_order.id
        house_entry = houses_map.get(house_key)
        if not house_entry:
            house_entry = {
                "house_identifier": house_identifier,
                "house_type_id": work_order.house_type_id,
                "house_type_name": house_type.name,
                "house_sub_type_name": house_sub_type.name if house_sub_type else None,
                "project_name": work_order.project_name,
                "modules": {},
            }
            houses_map[house_key] = house_entry

        modules: dict[int, dict[str, object]] = house_entry["modules"]  # type: ignore[assignment]
        module_entry = modules.get(work_unit.module_number)
        if not module_entry:
            module_entry = {
                "module_number": work_unit.module_number,
                "panels": [],
            }
            modules[work_unit.module_number] = module_entry
        module_entry["panels"].append(panel_payload)  # type: ignore[index]

    houses: list[StationPanelsFinishedHouse] = []
    for house_entry in houses_map.values():
        modules = [
            StationPanelsFinishedModule(
                module_number=module_entry["module_number"],
                panels=sorted(
                    module_entry["panels"],
                    key=lambda panel: (
                        panel.panel_definition_id or 0,
                        panel.panel_code or "",
                    ),
                ),
            )
            for module_entry in sorted(
                house_entry["modules"].values(),
                key=lambda entry: entry["module_number"],
            )
        ]
        houses.append(
            StationPanelsFinishedHouse(
                house_identifier=house_entry["house_identifier"],
                house_type_id=house_entry["house_type_id"],
                house_type_name=house_entry["house_type_name"],
                house_sub_type_name=house_entry["house_sub_type_name"],
                project_name=house_entry["project_name"],
                modules=modules,
            )
        )

    panels_summary = [summary for summary in panels_summary if summary.satisfied_at]
    panels_summary.sort(
        key=lambda panel: (
            panel.satisfied_at,
            panel.panel_code or "",
        )
    )

    total_panels = len(panel_builds)
    area_total = sum(
        float(summary.panel_area or 0) for summary in panels_summary
    )

    return StationPanelsFinishedResponse(
        total_panels_finished=total_panels,
        houses=houses,
        panels_passed_today_count=len(panels_summary),
        panels_passed_today_list=panels_summary,
        panels_passed_today_area_sum=round(area_total, 2),
    )
