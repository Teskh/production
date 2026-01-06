from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_worker, get_db
from app.models.admin import CommentTemplate, PauseReason
from app.models.enums import (
    PanelUnitStatus,
    QCNotificationStatus,
    QCExecutionOutcome,
    QCReworkStatus,
    RestrictionType,
    StationRole,
    TaskExceptionType,
    TaskScope,
    TaskStatus,
    WorkUnitStatus,
)
from app.models.house import HouseSubType, HouseType, PanelDefinition
from app.models.qc import (
    MediaAsset,
    QCCheckDefinition,
    QCCheckInstance,
    QCExecution,
    QCExecutionFailureMode,
    QCFailureModeDefinition,
    QCEvidence,
    QCNotification,
    QCReworkTask,
)
from app.models.stations import Station
from app.models.tasks import (
    TaskApplicability,
    TaskDefinition,
    TaskException,
    TaskInstance,
    TaskParticipation,
)
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.models.workers import TaskSkillRequirement, TaskWorkerRestriction, Worker, WorkerSkill
from app.schemas.config import CommentTemplateRead, PauseReasonRead
from app.schemas.worker_station import (
    StationQCReworkTask,
    StationSnapshot,
    StationTask,
    StationWorkItem,
)
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


def _format_worker_name(first_name: str, last_name: str) -> str:
    parts = [first_name.strip(), last_name.strip()]
    return " ".join(part for part in parts if part)


def _completed_task_definition_ids(
    db: Session,
    work_unit_id: int,
    panel_unit_id: int | None,
    task_scope: TaskScope,
) -> set[int]:
    if task_scope == TaskScope.PANEL:
        if panel_unit_id is None:
            return set()
        panel_clause = TaskInstance.panel_unit_id == panel_unit_id
    else:
        panel_clause = TaskInstance.panel_unit_id.is_(None)
    return set(
        db.execute(
            select(TaskInstance.task_definition_id)
            .where(TaskInstance.work_unit_id == work_unit_id)
            .where(panel_clause)
            .where(TaskInstance.status == TaskStatus.COMPLETED)
        ).scalars()
    )


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
    completed_task_definition_ids: set[int],
    allowed_worker_map: dict[int, set[int]],
    allowed_worker_name_map: dict[int, list[str]],
    dependency_name_map: dict[int, str],
    worker_id: int,
    current_station_sequence_order: int | None,
) -> tuple[list[StationTask], list[StationTask], list[StationTask]]:
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
    backlog_tasks: list[StationTask] = []

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
        if is_station_task or is_aux_station_task:
            dest = station_tasks
        elif station_sequence_order is None:
            dest = other_tasks
        elif (
            current_station_sequence_order is not None
            and station_sequence_order < current_station_sequence_order
        ):
            dest = backlog_tasks
        else:
            continue

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
        if dest is backlog_tasks and (
            status_value == TaskStatus.COMPLETED or task.id in skipped_task_ids
        ):
            continue
        dependencies = task.dependencies_json
        missing_dependency_names: list[str] = []
        if dependencies is None:
            dependencies_satisfied = True
        elif not isinstance(dependencies, list):
            dependencies_satisfied = False
        elif not dependencies:
            dependencies_satisfied = True
        else:
            missing_dependency_ids = [
                dependency_id
                for dependency_id in dependencies
                if dependency_id not in completed_task_definition_ids
            ]
            dependencies_satisfied = len(missing_dependency_ids) == 0
            if missing_dependency_ids:
                missing_dependency_names = [
                    dependency_name_map.get(dependency_id, f"Tarea {dependency_id}")
                    for dependency_id in missing_dependency_ids
                ]
        allowed_worker_ids = allowed_worker_map.get(task.id)
        worker_allowed = (
            True
            if allowed_worker_ids is None
            else worker_id in allowed_worker_ids
        )
        allowed_worker_names = allowed_worker_name_map.get(task.id, [])

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
                dependencies_satisfied=dependencies_satisfied,
                dependencies_missing_names=missing_dependency_names,
                worker_allowed=worker_allowed,
                allowed_worker_names=allowed_worker_names,
                started_at=started_at,
                completed_at=completed_at,
                notes=notes,
                backlog=dest is backlog_tasks,
            )
        )

    return station_tasks, other_tasks, backlog_tasks


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
            .where(TaskDefinition.is_rework == False)
        ).scalars()
    )
    if station.role == StationRole.AUX and not task_definitions:
        task_scope = TaskScope.MODULE
        task_definitions = list(
            db.execute(
                select(TaskDefinition)
                .where(TaskDefinition.active == True)
                .where(TaskDefinition.scope == task_scope)
                .where(TaskDefinition.is_rework == False)
            ).scalars()
        )

    worker_skill_ids = set(
        db.execute(
            select(WorkerSkill.skill_id).where(WorkerSkill.worker_id == _worker.id)
        ).scalars()
    )
    if task_definitions:
        requirement_rows = list(
            db.execute(
                select(
                    TaskSkillRequirement.task_definition_id,
                    TaskSkillRequirement.skill_id,
                ).where(
                    TaskSkillRequirement.task_definition_id.in_(
                        [task.id for task in task_definitions]
                    )
                )
            ).all()
        )
        if requirement_rows:
            required_map: dict[int, set[int]] = {}
            for row in requirement_rows:
                required_map.setdefault(row.task_definition_id, set()).add(row.skill_id)
            task_definitions = [
                task
                for task in task_definitions
                if task.id not in required_map
                or required_map[task.id].intersection(worker_skill_ids)
            ]

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
    allowed_worker_map: dict[int, set[int]] = {}
    allowed_worker_name_map: dict[int, list[str]] = {}
    if task_definitions:
        allowed_rows = list(
            db.execute(
                select(
                    TaskWorkerRestriction.task_definition_id.label("task_definition_id"),
                    Worker.id.label("worker_id"),
                    Worker.first_name,
                    Worker.last_name,
                )
                .join(Worker, Worker.id == TaskWorkerRestriction.worker_id)
                .where(
                    TaskWorkerRestriction.task_definition_id.in_(
                        [task.id for task in task_definitions]
                    )
                )
                .where(TaskWorkerRestriction.restriction_type == RestrictionType.ALLOWED)
            ).all()
        )
        for row in allowed_rows:
            allowed_worker_map.setdefault(row.task_definition_id, set()).add(row.worker_id)
            name = _format_worker_name(row.first_name, row.last_name)
            if name:
                allowed_worker_name_map.setdefault(row.task_definition_id, [])
                if name not in allowed_worker_name_map[row.task_definition_id]:
                    allowed_worker_name_map[row.task_definition_id].append(name)
        for task_id in allowed_worker_name_map:
            allowed_worker_name_map[task_id].sort()

    dependency_ids: set[int] = set()
    for task in task_definitions:
        dependencies = task.dependencies_json
        if not isinstance(dependencies, list):
            continue
        for dependency_id in dependencies:
            if isinstance(dependency_id, int):
                dependency_ids.add(dependency_id)
    dependency_name_map: dict[int, str] = {}
    if dependency_ids:
        dependency_name_map = {
            row.id: row.name
            for row in db.execute(
                select(TaskDefinition.id, TaskDefinition.name).where(
                    TaskDefinition.id.in_(sorted(dependency_ids))
                )
            ).all()
        }

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
                ).scalars()
            )
            task_exceptions = list(
                db.execute(
                    select(TaskException)
                    .where(TaskException.work_unit_id == work_unit.id)
                    .where(TaskException.panel_unit_id == panel_unit.id)
                ).scalars()
            )
            completed_task_definition_ids = _completed_task_definition_ids(
                db, work_unit.id, panel_unit.id, TaskScope.PANEL
            )
            tasks, other_tasks, backlog_tasks = _build_task_lists(
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
                completed_task_definition_ids,
                allowed_worker_map,
                allowed_worker_name_map,
                dependency_name_map,
                _worker.id,
                station.sequence_order,
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
                    backlog_tasks=backlog_tasks,
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
                        completed_task_definition_ids = _completed_task_definition_ids(
                            db, work_unit.id, panel_unit_id, TaskScope.PANEL
                        )
                        tasks, other_tasks, backlog_tasks = _build_task_lists(
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
                            completed_task_definition_ids,
                            allowed_worker_map,
                            allowed_worker_name_map,
                            dependency_name_map,
                            _worker.id,
                            station.sequence_order,
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
                                    backlog_tasks=backlog_tasks,
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
                ).scalars()
            )
            task_exceptions = list(
                db.execute(
                    select(TaskException)
                    .where(TaskException.work_unit_id == work_unit.id)
                    .where(TaskException.panel_unit_id.is_(None))
                ).scalars()
            )
            completed_task_definition_ids = _completed_task_definition_ids(
                db, work_unit.id, None, task_scope
            )
            tasks, other_tasks, backlog_tasks = _build_task_lists(
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
                completed_task_definition_ids,
                allowed_worker_map,
                allowed_worker_name_map,
                dependency_name_map,
                _worker.id,
                station.sequence_order,
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
                    backlog_tasks=backlog_tasks,
                    recommended=False,
                )
            )

    work_items.sort(key=lambda item: (item.project_name, item.house_identifier, item.module_number))

    active_participation_ids = set(
        db.execute(
            select(TaskParticipation.task_instance_id)
            .join(TaskInstance, TaskParticipation.task_instance_id == TaskInstance.id)
            .where(TaskParticipation.worker_id == _worker.id)
            .where(TaskParticipation.left_at.is_(None))
            .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
        ).scalars()
    )
    active_nonconcurrent_ids = set(
        db.execute(
            select(TaskParticipation.task_instance_id)
            .join(TaskInstance, TaskParticipation.task_instance_id == TaskInstance.id)
            .join(TaskDefinition, TaskInstance.task_definition_id == TaskDefinition.id)
            .where(TaskParticipation.worker_id == _worker.id)
            .where(TaskParticipation.left_at.is_(None))
            .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
            .where(TaskDefinition.concurrent_allowed == False)
        ).scalars()
    )
    if active_participation_ids:
        for item in work_items:
            for task in item.tasks + item.other_tasks + item.backlog_tasks:
                if task.task_instance_id in active_participation_ids:
                    task.current_worker_participating = True

    work_unit_ids = {item.work_unit_id for item in work_items}
    panel_unit_ids = {item.panel_unit_id for item in work_items if item.panel_unit_id is not None}
    rework_rows = []
    if work_unit_ids:
        rework_rows = list(
            db.execute(
                select(QCReworkTask, QCCheckInstance, QCCheckDefinition, WorkUnit, PanelUnit)
                .join(QCCheckInstance, QCReworkTask.check_instance_id == QCCheckInstance.id)
                .join(QCCheckDefinition, QCCheckInstance.check_definition_id == QCCheckDefinition.id, isouter=True)
                .join(WorkUnit, QCCheckInstance.work_unit_id == WorkUnit.id)
                .join(PanelUnit, QCCheckInstance.panel_unit_id == PanelUnit.id, isouter=True)
                .where(QCReworkTask.status.in_([QCReworkStatus.OPEN, QCReworkStatus.IN_PROGRESS]))
                .where(QCCheckInstance.work_unit_id.in_(work_unit_ids))
                .where(
                    (QCCheckInstance.panel_unit_id.is_(None))
                    | (QCCheckInstance.panel_unit_id.in_(panel_unit_ids))
                )
                .order_by(QCReworkTask.created_at.desc())
            )
        )
    qc_rework_tasks = []
    for rework, check_instance, check_definition, rework_work_unit, panel_unit in rework_rows:
        panel_code = (
            panel_unit.panel_definition.panel_code
            if panel_unit and panel_unit.panel_definition
            else None
        )
        latest_fail = (
            db.execute(
                select(QCExecution)
                .where(QCExecution.check_instance_id == check_instance.id)
                .where(QCExecution.outcome == QCExecutionOutcome.FAIL)
                .order_by(QCExecution.performed_at.desc())
                .limit(1)
            )
            .scalars()
            .first()
        )
        failure_modes: list[str] = []
        evidence_uris: list[str] = []
        failure_notes = latest_fail.notes if latest_fail else None
        if latest_fail:
            mode_rows = list(
                db.execute(
                    select(QCExecutionFailureMode, QCFailureModeDefinition)
                    .join(
                        QCFailureModeDefinition,
                        QCExecutionFailureMode.failure_mode_definition_id == QCFailureModeDefinition.id,
                        isouter=True,
                    )
                    .where(QCExecutionFailureMode.execution_id == latest_fail.id)
                )
            )
            for mode, definition in mode_rows:
                label = definition.name if definition else "Otro"
                if mode.other_text:
                    label = f"{label}: {mode.other_text}"
                failure_modes.append(label)
            evidence_rows = list(
                db.execute(
                    select(QCEvidence, MediaAsset)
                    .join(MediaAsset, QCEvidence.media_asset_id == MediaAsset.id)
                    .where(QCEvidence.execution_id == latest_fail.id)
                )
            )
            for evidence, media in evidence_rows:
                evidence_uris.append(f"/media_gallery/{media.storage_key}")
        qc_rework_tasks.append(
            StationQCReworkTask(
                id=rework.id,
                check_instance_id=check_instance.id,
                check_name=check_definition.name if check_definition else check_instance.ad_hoc_title,
                description=rework.description,
                status=rework.status.value,
                work_unit_id=rework_work_unit.id,
                panel_unit_id=panel_unit.id if panel_unit else None,
                module_number=rework_work_unit.module_number,
                panel_code=panel_code,
                station_id=check_instance.station_id,
                created_at=rework.created_at,
                failure_notes=failure_notes,
                failure_modes=failure_modes,
                evidence_uris=evidence_uris,
            )
        )

    qc_notification_count = (
        db.execute(
            select(QCNotification.id)
            .where(QCNotification.worker_id == _worker.id)
            .where(QCNotification.status == QCNotificationStatus.ACTIVE)
        )
        .scalars()
        .all()
    )

    return StationSnapshot(
        station=station,
        work_items=work_items,
        pause_reasons=_filter_pause_reasons(pause_reasons, station.id),
        comment_templates=_filter_comment_templates(comment_templates, station.id),
        worker_active_nonconcurrent_task_instance_ids=sorted(active_nonconcurrent_ids),
        qc_rework_tasks=qc_rework_tasks,
        qc_notification_count=len(qc_notification_count),
    )
