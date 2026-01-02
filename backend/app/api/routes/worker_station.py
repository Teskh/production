from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_worker, get_db
from app.models.admin import CommentTemplate, PauseReason
from app.models.enums import (
    PanelUnitStatus,
    StationRole,
    TaskExceptionType,
    TaskScope,
    TaskStatus,
    WorkUnitStatus,
)
from app.models.house import HouseSubType, HouseType, PanelDefinition
from app.models.stations import Station
from app.models.tasks import TaskApplicability, TaskDefinition, TaskException, TaskInstance
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.models.workers import Worker
from app.schemas.config import CommentTemplateRead, PauseReasonRead
from app.schemas.worker_station import StationSnapshot, StationTask, StationWorkItem
from app.services.task_applicability import resolve_task_station_sequence

router = APIRouter()


def _filter_pause_reasons(
    reasons: list[PauseReason], station_id: int
) -> list[PauseReasonRead]:
    eligible = []
    for reason in reasons:
        if reason.applicable_station_ids is None or station_id in reason.applicable_station_ids:
            eligible.append(PauseReasonRead.model_validate(reason))
    return eligible


def _filter_comment_templates(
    templates: list[CommentTemplate], station_id: int
) -> list[CommentTemplateRead]:
    eligible = []
    for template in templates:
        if template.applicable_station_ids is None or station_id in template.applicable_station_ids:
            eligible.append(CommentTemplateRead.model_validate(template))
    return eligible


def _build_task_lists(
    station: Station,
    task_definitions: list[TaskDefinition],
    applicability_map: dict[int, list[TaskApplicability]],
    instances: list[TaskInstance],
    exceptions: list[TaskException],
    house_type_id: int,
    sub_type_id: int | None,
    module_number: int,
    panel_definition_id: int | None,
    panel_task_order: list[int] | None,
) -> tuple[list[StationTask], list[StationTask]]:
    instance_map: dict[int, TaskInstance] = {}
    for instance in instances:
        existing = instance_map.get(instance.task_definition_id)
        if not existing or instance.id > existing.id:
            instance_map[instance.task_definition_id] = instance
    skipped_task_ids = {
        exc.task_definition_id
        for exc in exceptions
        if exc.exception_type == TaskExceptionType.SKIP
    }
    ordered_tasks = task_definitions
    if panel_task_order is not None:
        order_index = {task_id: idx for idx, task_id in enumerate(panel_task_order)}
        ordered_tasks = sorted(
            [task for task in task_definitions if task.id in order_index],
            key=lambda task: order_index[task.id],
        )
    else:
        ordered_tasks = sorted(task_definitions, key=lambda task: task.name.lower())

    station_tasks: list[StationTask] = []
    other_tasks: list[StationTask] = []

    for task in ordered_tasks:
        applies, station_sequence_order = resolve_task_station_sequence(
            task,
            applicability_map.get(task.id, []),
            house_type_id,
            sub_type_id,
            module_number,
            panel_definition_id,
        )
        if not applies:
            continue
        is_aux_station = station.role == StationRole.AUX
        is_station_task = (
            station_sequence_order is not None
            and station.sequence_order is not None
            and station_sequence_order == station.sequence_order
        )
        is_aux_station_task = is_aux_station and station_sequence_order is None
        if not is_station_task and not is_aux_station_task:
            if station_sequence_order is None:
                dest = other_tasks
            else:
                continue
        else:
            dest = station_tasks

        instance = instance_map.get(task.id)
        status_value = TaskStatus.NOT_STARTED
        started_at = None
        completed_at = None
        notes = None
        instance_id = None
        if instance:
            status_value = instance.status
            started_at = instance.started_at
            completed_at = instance.completed_at
            notes = instance.notes
            instance_id = instance.id
        if task.id in skipped_task_ids:
            status_value = TaskStatus.SKIPPED

        dest.append(
            StationTask(
                task_definition_id=task.id,
                task_instance_id=instance_id,
                name=task.name,
                scope=task.scope,
                station_sequence_order=station_sequence_order,
                status=status_value,
                skippable=task.skippable,
                concurrent_allowed=task.concurrent_allowed,
                advance_trigger=task.advance_trigger,
                started_at=started_at,
                completed_at=completed_at,
                notes=notes,
            )
        )

    return station_tasks, other_tasks


@router.get("/{station_id}/snapshot", response_model=StationSnapshot)
def station_snapshot(
    station_id: int,
    db: Session = Depends(get_db),
    _worker: Worker = Depends(get_current_worker),
) -> StationSnapshot:
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")

    pause_reasons = list(
        db.execute(select(PauseReason).where(PauseReason.active == True)).scalars()
    )
    comment_templates = list(
        db.execute(select(CommentTemplate).where(CommentTemplate.active == True)).scalars()
    )

    task_scope = (
        TaskScope.PANEL
        if station.role == StationRole.PANELS
        else TaskScope.AUX
        if station.role == StationRole.AUX
        else TaskScope.MODULE
    )

    task_definitions = list(
        db.execute(
            select(TaskDefinition)
            .where(TaskDefinition.active == True)
            .where(TaskDefinition.scope == task_scope)
        ).scalars()
    )
    if station.role == StationRole.AUX and not task_definitions:
        task_scope = TaskScope.MODULE
        task_definitions = list(
            db.execute(
                select(TaskDefinition)
                .where(TaskDefinition.active == True)
                .where(TaskDefinition.scope == task_scope)
            ).scalars()
        )

    applicability_rows = list(
        db.execute(
            select(TaskApplicability).where(
                TaskApplicability.task_definition_id.in_([task.id for task in task_definitions])
            )
        ).scalars()
    )
    applicability_map: dict[int, list[TaskApplicability]] = {}
    for row in applicability_rows:
        applicability_map.setdefault(row.task_definition_id, []).append(row)

    work_items: list[StationWorkItem] = []

    if station.role == StationRole.PANELS:
        rows = list(
            db.execute(
                select(
                    PanelUnit,
                    WorkUnit,
                    WorkOrder,
                    HouseType,
                    HouseSubType,
                    PanelDefinition,
                )
                .join(WorkUnit, PanelUnit.work_unit_id == WorkUnit.id)
                .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
                .join(HouseType, WorkOrder.house_type_id == HouseType.id)
                .outerjoin(HouseSubType, WorkOrder.sub_type_id == HouseSubType.id)
                .join(PanelDefinition, PanelUnit.panel_definition_id == PanelDefinition.id)
                .where(PanelUnit.current_station_id == station.id)
                .where(PanelUnit.status == PanelUnitStatus.IN_PROGRESS)
            ).all()
        )
        for (
            panel_unit,
            work_unit,
            work_order,
            house_type,
            sub_type,
            panel_def,
        ) in rows:
            task_instances = list(
                db.execute(
                    select(TaskInstance)
                    .where(TaskInstance.work_unit_id == work_unit.id)
                    .where(TaskInstance.panel_unit_id == panel_unit.id)
                    .where(TaskInstance.station_id == station.id)
                ).scalars()
            )
            task_exceptions = list(
                db.execute(
                    select(TaskException)
                    .where(TaskException.work_unit_id == work_unit.id)
                    .where(TaskException.panel_unit_id == panel_unit.id)
                    .where(TaskException.station_id == station.id)
                ).scalars()
            )
            tasks, other_tasks = _build_task_lists(
                station,
                task_definitions,
                applicability_map,
                task_instances,
                task_exceptions,
                work_order.house_type_id,
                work_order.sub_type_id,
                work_unit.module_number,
                panel_unit.panel_definition_id,
                panel_def.applicable_task_ids,
            )
            work_items.append(
                StationWorkItem(
                    id=f"panel-{panel_unit.id}",
                    scope=TaskScope.PANEL,
                    work_unit_id=work_unit.id,
                    panel_unit_id=panel_unit.id,
                    panel_definition_id=panel_unit.panel_definition_id,
                    module_number=work_unit.module_number,
                    project_name=work_order.project_name,
                    house_identifier=work_order.house_identifier or f"WO-{work_order.id}",
                    house_type_name=house_type.name,
                    sub_type_name=sub_type.name if sub_type else None,
                    panel_code=panel_def.panel_code,
                    status=panel_unit.status.value,
                    tasks=tasks,
                    other_tasks=other_tasks,
                    recommended=False,
                )
            )
        if station.sequence_order == 1:
            planned_rows = list(
                db.execute(
                    select(WorkUnit, WorkOrder, HouseType, HouseSubType)
                    .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
                    .join(HouseType, WorkOrder.house_type_id == HouseType.id)
                    .outerjoin(HouseSubType, WorkOrder.sub_type_id == HouseSubType.id)
                    .where(WorkUnit.status.in_([WorkUnitStatus.PLANNED, WorkUnitStatus.PANELS]))
                ).all()
            )
            if planned_rows:
                work_unit_ids = [row[0].id for row in planned_rows]
                house_type_ids = {row[1].house_type_id for row in planned_rows}
                panel_units = list(
                    db.execute(
                        select(PanelUnit).where(PanelUnit.work_unit_id.in_(work_unit_ids))
                    ).scalars()
                )
                panel_unit_map: dict[tuple[int, int], PanelUnit] = {
                    (panel_unit.work_unit_id, panel_unit.panel_definition_id): panel_unit
                    for panel_unit in panel_units
                }
                panel_defs = list(
                    db.execute(
                        select(PanelDefinition).where(
                            PanelDefinition.house_type_id.in_(house_type_ids)
                        )
                    ).scalars()
                )
                panel_defs_by_house: dict[int, list[PanelDefinition]] = {}
                for panel_def in panel_defs:
                    panel_defs_by_house.setdefault(panel_def.house_type_id, []).append(panel_def)

                planned_items: list[tuple[tuple[int, int, str], StationWorkItem]] = []

                for work_unit, work_order, house_type, sub_type in planned_rows:
                    defs_for_house = panel_defs_by_house.get(work_order.house_type_id, [])
                    candidates = [
                        panel_def
                        for panel_def in defs_for_house
                        if panel_def.module_sequence_number == work_unit.module_number
                    ]
                    sub_type_id = work_order.sub_type_id
                    general = [
                        panel_def for panel_def in candidates if panel_def.sub_type_id is None
                    ]
                    if sub_type_id is not None:
                        specific = [
                            panel_def
                            for panel_def in candidates
                            if panel_def.sub_type_id == sub_type_id
                        ]
                        candidates = general + specific
                    else:
                        candidates = general
                    for panel_def in candidates:
                        panel_unit = panel_unit_map.get((work_unit.id, panel_def.id))
                        if panel_unit and panel_unit.status != PanelUnitStatus.PLANNED:
                            continue
                        panel_unit_id = panel_unit.id if panel_unit else None
                        status_value = (
                            panel_unit.status.value
                            if panel_unit
                            else PanelUnitStatus.PLANNED.value
                        )
                        tasks, other_tasks = _build_task_lists(
                            station,
                            task_definitions,
                            applicability_map,
                            [],
                            [],
                            work_order.house_type_id,
                            work_order.sub_type_id,
                            work_unit.module_number,
                            panel_def.id,
                            panel_def.applicable_task_ids,
                        )
                        sort_key = (
                            work_unit.planned_sequence,
                            panel_def.panel_sequence_number or 9999,
                            panel_def.panel_code or "",
                        )
                        planned_items.append(
                            (
                                sort_key,
                                StationWorkItem(
                                    id=(
                                        f"panel-{panel_unit_id}"
                                        if panel_unit_id is not None
                                        else f"planned-{work_unit.id}-{panel_def.id}"
                                    ),
                                    scope=TaskScope.PANEL,
                                    work_unit_id=work_unit.id,
                                    panel_unit_id=panel_unit_id,
                                    panel_definition_id=panel_def.id,
                                    module_number=work_unit.module_number,
                                    project_name=work_order.project_name,
                                    house_identifier=work_order.house_identifier
                                    or f"WO-{work_order.id}",
                                    house_type_name=house_type.name,
                                    sub_type_name=sub_type.name if sub_type else None,
                                    panel_code=panel_def.panel_code,
                                    status=status_value,
                                    tasks=tasks,
                                    other_tasks=other_tasks,
                                    recommended=False,
                                ),
                            )
                        )

                planned_items.sort(key=lambda item: item[0])
                if planned_items:
                    planned_items[0][1].recommended = True
                work_items.extend(item for _, item in planned_items)
    else:
        stmt = (
            select(WorkUnit, WorkOrder, HouseType, HouseSubType)
            .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
            .join(HouseType, WorkOrder.house_type_id == HouseType.id)
            .outerjoin(HouseSubType, WorkOrder.sub_type_id == HouseSubType.id)
        )
        if station.role == StationRole.MAGAZINE:
            stmt = stmt.where(WorkUnit.status == WorkUnitStatus.MAGAZINE)
        elif station.role == StationRole.ASSEMBLY:
            stmt = stmt.where(WorkUnit.status == WorkUnitStatus.ASSEMBLY).where(
                WorkUnit.current_station_id == station.id
            )
        else:
            stmt = stmt.where(WorkUnit.current_station_id == station.id)
        rows = list(db.execute(stmt).all())
        if station.role == StationRole.ASSEMBLY and station.sequence_order is not None:
            first_station = (
                db.execute(
                    select(Station)
                    .where(Station.role == StationRole.ASSEMBLY)
                    .where(Station.line_type == station.line_type)
                    .order_by(Station.sequence_order)
                    .limit(1)
                ).scalar_one_or_none()
            )
            if first_station and first_station.id == station.id:
                magazine_rows = list(
                    db.execute(
                        select(WorkUnit, WorkOrder, HouseType, HouseSubType)
                        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
                        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
                        .outerjoin(HouseSubType, WorkOrder.sub_type_id == HouseSubType.id)
                        .where(WorkUnit.status == WorkUnitStatus.MAGAZINE)
                    ).all()
                )
                existing_ids = {work_unit.id for work_unit, *_ in rows}
                for row in magazine_rows:
                    if row[0].id not in existing_ids:
                        rows.append(row)
        for work_unit, work_order, house_type, sub_type in rows:
            task_instances = list(
                db.execute(
                    select(TaskInstance)
                    .where(TaskInstance.work_unit_id == work_unit.id)
                    .where(TaskInstance.panel_unit_id.is_(None))
                    .where(TaskInstance.station_id == station.id)
                ).scalars()
            )
            task_exceptions = list(
                db.execute(
                    select(TaskException)
                    .where(TaskException.work_unit_id == work_unit.id)
                    .where(TaskException.panel_unit_id.is_(None))
                    .where(TaskException.station_id == station.id)
                ).scalars()
            )
            tasks, other_tasks = _build_task_lists(
                station,
                task_definitions,
                applicability_map,
                task_instances,
                task_exceptions,
                work_order.house_type_id,
                work_order.sub_type_id,
                work_unit.module_number,
                None,
                None,
            )
            work_items.append(
                StationWorkItem(
                    id=f"module-{work_unit.id}",
                    scope=task_scope,
                    work_unit_id=work_unit.id,
                    panel_unit_id=None,
                    panel_definition_id=None,
                    module_number=work_unit.module_number,
                    project_name=work_order.project_name,
                    house_identifier=work_order.house_identifier or f"WO-{work_order.id}",
                    house_type_name=house_type.name,
                    sub_type_name=sub_type.name if sub_type else None,
                    panel_code=None,
                    status=work_unit.status.value,
                    tasks=tasks,
                    other_tasks=other_tasks,
                    recommended=False,
                )
            )

    work_items.sort(key=lambda item: (item.project_name, item.house_identifier, item.module_number))

    return StationSnapshot(
        station=station,
        work_items=work_items,
        pause_reasons=_filter_pause_reasons(pause_reasons, station.id),
        comment_templates=_filter_comment_templates(comment_templates, station.id),
    )
