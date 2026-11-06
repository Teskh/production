from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_worker, get_current_worker_session, get_db
from app.core.security import utc_now
from app.models.enums import (
    PanelUnitStatus,
    RestrictionType,
    StationRole,
    TaskExceptionType,
    TaskScope,
    TaskStatus,
    WorkUnitStatus,
)
from app.models.stations import Station
from app.models.tasks import (
    TaskDefinition,
    TaskException,
    TaskInstance,
    TaskParticipation,
    TaskPause,
)
from app.models.house import PanelDefinition
from app.models.tasks import TaskApplicability
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.models.workers import TaskWorkerRestriction, Worker, WorkerSession
from app.schemas.tasks import (
    TaskInstanceRead,
    WorkerActiveTaskRead,
    WorkerFrequentTaskRead,
)
from app.schemas.worker_station import (
    TaskCompleteRequest,
    TaskJoinRequest,
    TaskLeaveRequest,
    TaskNoteRequest,
    TaskPauseRequest,
    TaskResumeRequest,
    TaskSkipRequest,
    TaskStartRequest,
    WorkerBusyCheckRequest,
    WorkerBusyCheckResponse,
)
from app.services.conditions import ConditionContext, load_condition_context
from app.services.panel_routing import advance_panel_if_satisfied
from app.services.task_applicability import resolve_task_station_sequence
from app.services.task_dependencies import (
    DependencyRules,
    dependency_ids_of,
    load_resolved_tasks,
)
from app.services.task_participation import (
    close_open_participations,
    close_open_pauses,
    leave_task,
    pause_instance,
)
from app.services.qc_runtime import open_qc_checks_for_task_completion
from app.services.task_station_adherence import capture_task_station_adherence_fact

router = APIRouter()


def _station_has_module_tasks(
    station: Station,
    task_definitions: list[TaskDefinition],
    applicability_map: dict[int, list[TaskApplicability]],
    work_order: WorkOrder,
    work_unit: WorkUnit,
    condition_ctx: ConditionContext,
) -> bool:
    if station.sequence_order is None:
        return False
    unit_condition_value_ids = condition_ctx.values_for(work_unit.id)
    for task in task_definitions:
        applies, station_sequence_order = resolve_task_station_sequence(
            task,
            applicability_map.get(task.id, []),
            work_order.house_type_id,
            work_order.sub_type_id,
            work_unit.module_number,
            None,
            condition_requirements=condition_ctx.requirements_for(task.id),
            unit_condition_value_ids=unit_condition_value_ids,
        )
        if applies and station_sequence_order == station.sequence_order:
            return True
    return False


def _next_applicable_module_station(
    db: Session, station: Station, work_unit: WorkUnit, work_order: WorkOrder
) -> Station | None:
    if station.sequence_order is None:
        return None
    task_definitions = list(
        db.execute(
            select(TaskDefinition)
            .where(TaskDefinition.active == True)
            .where(TaskDefinition.archived_at.is_(None))
            .where(TaskDefinition.scope == TaskScope.MODULE)
        ).scalars()
    )
    if not task_definitions:
        return None
    task_def_ids = [task.id for task in task_definitions]
    applicability_rows = list(
        db.execute(
            select(TaskApplicability).where(TaskApplicability.task_definition_id.in_(task_def_ids))
        ).scalars()
    )
    applicability_map: dict[int, list[TaskApplicability]] = {}
    for row in applicability_rows:
        applicability_map.setdefault(row.task_definition_id, []).append(row)
    condition_ctx = load_condition_context(db, task_def_ids, [work_unit.id])

    candidates = list(
        db.execute(
            select(Station)
            .where(Station.role == StationRole.ASSEMBLY)
            .where(Station.line_type == station.line_type)
            .where(Station.sequence_order > station.sequence_order)
            .order_by(Station.sequence_order)
        ).scalars()
    )
    for candidate in candidates:
        if _station_has_module_tasks(
            candidate, task_definitions, applicability_map, work_order, work_unit, condition_ctx
        ):
            return candidate
    return None


def _get_task_instance(instance_id: int, db: Session) -> TaskInstance:
    instance = db.get(TaskInstance, instance_id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task instance not found")
    return instance


def _has_active_nonconcurrent_task(
    db: Session, worker_id: int, exclude_instance_id: int | None = None
) -> bool:
    stmt = (
        select(TaskParticipation.task_instance_id)
        .join(TaskInstance, TaskParticipation.task_instance_id == TaskInstance.id)
        .join(TaskDefinition, TaskInstance.task_definition_id == TaskDefinition.id)
        .where(TaskParticipation.worker_id == worker_id)
        .where(TaskParticipation.left_at.is_(None))
        .where(TaskInstance.status == TaskStatus.IN_PROGRESS)
        .where(TaskDefinition.concurrent_allowed == False)
    )
    if exclude_instance_id is not None:
        stmt = stmt.where(TaskParticipation.task_instance_id != exclude_instance_id)
    return db.execute(stmt).first() is not None


def _allowed_worker_ids(db: Session, task_definition_id: int) -> set[int] | None:
    allowed_ids = set(
        db.execute(
            select(TaskWorkerRestriction.worker_id)
            .where(TaskWorkerRestriction.task_definition_id == task_definition_id)
            .where(TaskWorkerRestriction.restriction_type == RestrictionType.ALLOWED)
        ).scalars()
    )
    return allowed_ids if allowed_ids else None


def _auto_complete_open_module_tasks_for_work_unit(
    db: Session,
    work_unit_id: int,
    note: str,
) -> list[TaskInstance]:
    instances = list(
        db.execute(
            select(TaskInstance)
            .where(TaskInstance.work_unit_id == work_unit_id)
            .where(TaskInstance.panel_unit_id.is_(None))
            .where(TaskInstance.scope == TaskScope.MODULE)
            .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
        ).scalars()
    )
    if not instances:
        return []

    completed_at = utc_now()
    for instance in instances:
        instance.status = TaskStatus.COMPLETED
        instance.completed_at = completed_at
        if note:
            if instance.notes:
                instance.notes = f"{instance.notes}\n{note}"
            else:
                instance.notes = note

    instance_ids = [instance.id for instance in instances]
    participations = list(
        db.execute(
            select(TaskParticipation)
            .where(TaskParticipation.task_instance_id.in_(instance_ids))
            .where(TaskParticipation.left_at.is_(None))
        ).scalars()
    )
    for participation in participations:
        participation.left_at = completed_at

    open_pauses = list(
        db.execute(
            select(TaskPause)
            .where(TaskPause.task_instance_id.in_(instance_ids))
            .where(TaskPause.resumed_at.is_(None))
        ).scalars()
    )
    for pause in open_pauses:
        pause.resumed_at = completed_at

    return instances


def _dependencies_satisfied(
    db: Session,
    task_def: TaskDefinition,
    work_unit: WorkUnit,
    panel_unit_id: int | None,
    panel_definition_id: int | None,
    scope: TaskScope,
) -> bool:
    dependency_ids = dependency_ids_of(task_def.dependencies_json)
    if dependency_ids is None:
        return False
    if not dependency_ids:
        return True
    work_order = db.get(WorkOrder, work_unit.work_order_id)
    if not work_order:
        return False
    panel_task_ids: list[int] | None = None
    if scope == TaskScope.PANEL and panel_definition_id is not None:
        panel_definition = db.get(PanelDefinition, panel_definition_id)
        panel_task_ids = panel_definition.applicable_task_ids if panel_definition else None
    else:
        panel_unit_id = None
        panel_definition_id = None
    rules = DependencyRules.load(db, dependency_ids, [work_unit.id])
    resolved = load_resolved_tasks(db, work_unit.id, panel_unit_id)
    missing = rules.missing_dependency_ids(
        task_def,
        resolved,
        work_unit_id=work_unit.id,
        house_type_id=work_order.house_type_id,
        sub_type_id=work_order.sub_type_id,
        module_number=work_unit.module_number,
        panel_definition_id=panel_definition_id,
        panel_task_ids=panel_task_ids,
    )
    return missing == []


def _reject_rework_instance(instance: TaskInstance) -> None:
    if instance.rework_task_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Rework tasks must be handled through /api/qc/rework-tasks "
                f"(rework task {instance.rework_task_id})"
            ),
        )


def _find_existing_panel_unit(
    db: Session, work_unit_id: int, panel_definition_id: int
) -> PanelUnit | None:
    """Oldest panel unit already created for this module and panel definition."""
    return (
        db.execute(
            select(PanelUnit)
            .where(PanelUnit.work_unit_id == work_unit_id)
            .where(PanelUnit.panel_definition_id == panel_definition_id)
            .order_by(PanelUnit.id)
            .limit(1)
        )
        .scalars()
        .first()
    )


def _lock_work_unit(db: Session, work_unit_id: int) -> WorkUnit | None:
    """Serialize task starts on one module so concurrent tablets cannot duplicate rows."""
    return (
        db.execute(
            select(WorkUnit).where(WorkUnit.id == work_unit_id).with_for_update()
        )
        .scalars()
        .first()
    )


@router.get("/active", response_model=list[WorkerActiveTaskRead])
def list_active_tasks(
    worker: Worker = Depends(get_current_worker), db: Session = Depends(get_db)
) -> list[WorkerActiveTaskRead]:
    instances = list(
        db.execute(
            select(TaskInstance)
            .join(TaskParticipation, TaskParticipation.task_instance_id == TaskInstance.id)
            .where(TaskParticipation.worker_id == worker.id)
            .where(TaskParticipation.left_at.is_(None))
            .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
            .order_by(TaskInstance.started_at.desc(), TaskInstance.id.desc())
        ).scalars()
    )
    if not instances:
        return []
    work_unit_ids = {instance.work_unit_id for instance in instances}
    panel_unit_ids = {
        instance.panel_unit_id for instance in instances if instance.panel_unit_id is not None
    }
    work_units = {
        unit.id: unit
        for unit in db.execute(
            select(WorkUnit)
            .options(selectinload(WorkUnit.work_order))
            .where(WorkUnit.id.in_(work_unit_ids))
        ).scalars()
    }
    panel_units = {
        unit.id: unit
        for unit in db.execute(
            select(PanelUnit)
            .options(selectinload(PanelUnit.panel_definition))
            .where(PanelUnit.id.in_(panel_unit_ids))
        ).scalars()
    }
    task_definition_ids = {instance.task_definition_id for instance in instances}
    task_definitions = {
        task_def.id: task_def
        for task_def in db.execute(
            select(TaskDefinition).where(TaskDefinition.id.in_(task_definition_ids))
        ).scalars()
    }
    payloads: list[WorkerActiveTaskRead] = []
    for instance in instances:
        panel_unit = (
            panel_units.get(instance.panel_unit_id)
            if instance.panel_unit_id is not None
            else None
        )
        work_unit = work_units.get(instance.work_unit_id)
        task_def = task_definitions.get(instance.task_definition_id)
        current_station_id = panel_unit.current_station_id if panel_unit else None
        if current_station_id is None and work_unit:
            current_station_id = work_unit.current_station_id
        if instance.rework_task_id is not None:
            # Rework stays at the station where it was started, wherever the unit is now.
            current_station_id = instance.station_id
        work_order = work_unit.work_order if work_unit else None
        payloads.append(
            WorkerActiveTaskRead(
                task_instance_id=instance.id,
                task_definition_id=instance.task_definition_id,
                task_name=task_def.name if task_def else f"Tarea {instance.task_definition_id}",
                scope=instance.scope,
                concurrent_allowed=task_def.concurrent_allowed if task_def else False,
                advance_trigger=task_def.advance_trigger if task_def else False,
                station_id=instance.station_id,
                current_station_id=current_station_id,
                work_unit_id=instance.work_unit_id,
                panel_unit_id=instance.panel_unit_id,
                module_number=work_unit.module_number if work_unit else None,
                project_name=work_order.project_name if work_order else None,
                house_identifier=work_order.house_identifier if work_order else None,
                panel_code=(
                    panel_unit.panel_definition.panel_code
                    if panel_unit and panel_unit.panel_definition
                    else None
                ),
                rework_task_id=instance.rework_task_id,
                status=instance.status,
                started_at=instance.started_at,
                notes=instance.notes,
            )
        )
    return payloads


@router.get("/frequent", response_model=list[WorkerFrequentTaskRead])
def list_frequent_tasks(
    worker: Worker = Depends(get_current_worker), db: Session = Depends(get_db)
) -> list[WorkerFrequentTaskRead]:
    cutoff = utc_now() - timedelta(days=7)
    completion_count = func.count(distinct(TaskInstance.id))
    rows = db.execute(
        select(
            TaskInstance.task_definition_id,
            completion_count.label("completion_count"),
        )
        .join(TaskParticipation, TaskParticipation.task_instance_id == TaskInstance.id)
        .where(TaskParticipation.worker_id == worker.id)
        .where(TaskInstance.status == TaskStatus.COMPLETED)
        .where(TaskInstance.completed_at.is_not(None))
        .where(TaskInstance.completed_at >= cutoff)
        .group_by(TaskInstance.task_definition_id)
        .having(completion_count >= 3)
        .order_by(completion_count.desc(), TaskInstance.task_definition_id.asc())
    ).all()
    return [
        WorkerFrequentTaskRead(
            task_definition_id=row.task_definition_id,
            completions=row.completion_count,
        )
        for row in rows
    ]


@router.post("/busy-workers", response_model=WorkerBusyCheckResponse)
def list_busy_workers(
    payload: WorkerBusyCheckRequest,
    db: Session = Depends(get_db),
    _worker: Worker = Depends(get_current_worker),
) -> WorkerBusyCheckResponse:
    worker_ids = [worker_id for worker_id in payload.worker_ids if worker_id is not None]
    if not worker_ids:
        return WorkerBusyCheckResponse(worker_ids=[])
    stmt = (
        select(TaskParticipation.worker_id)
        .join(TaskInstance, TaskParticipation.task_instance_id == TaskInstance.id)
        .join(TaskDefinition, TaskInstance.task_definition_id == TaskDefinition.id)
        .where(TaskParticipation.worker_id.in_(worker_ids))
        .where(TaskParticipation.left_at.is_(None))
        .where(TaskInstance.status == TaskStatus.IN_PROGRESS)
        .where(TaskDefinition.concurrent_allowed == False)
    )
    if payload.exclude_task_instance_id is not None:
        stmt = stmt.where(TaskInstance.id != payload.exclude_task_instance_id)
    busy_ids = sorted(set(db.execute(stmt).scalars().all()))
    return WorkerBusyCheckResponse(worker_ids=busy_ids)


@router.post("/start", response_model=TaskInstanceRead, status_code=status.HTTP_201_CREATED)
def start_task(
    payload: TaskStartRequest,
    db: Session = Depends(get_db),
    worker: Worker = Depends(get_current_worker),
) -> TaskInstance:
    task_def = db.get(TaskDefinition, payload.task_definition_id)
    if not task_def or not task_def.active or task_def.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found")
    if task_def.is_rework:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rework tasks are handled separately")
    if task_def.scope != payload.scope:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task scope mismatch")
    worker_ids = payload.worker_ids or [worker.id]
    unique_worker_ids = sorted(set(worker_ids))
    allowed_worker_ids = _allowed_worker_ids(db, task_def.id)
    if allowed_worker_ids is not None:
        if any(worker_id not in allowed_worker_ids for worker_id in unique_worker_ids):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="One or more workers are not allowed for this task",
            )
    station = db.get(Station, payload.station_id)
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    work_unit = _lock_work_unit(db, payload.work_unit_id)
    if not work_unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work unit not found")
    panel_unit_id = payload.panel_unit_id
    panel_definition_id = payload.panel_definition_id
    if payload.scope == TaskScope.PANEL:
        panel_unit: PanelUnit | None = None
        if panel_unit_id is not None:
            panel_unit = db.get(PanelUnit, panel_unit_id)
            if not panel_unit:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Panel unit not found")
            if panel_unit.work_unit_id != payload.work_unit_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Panel unit does not belong to work unit",
                )
        else:
            if panel_definition_id is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Panel definition is required",
                )
            # A stale tablet can still show the panel as "planned" after another tablet
            # created its unit; reuse that unit instead of creating a duplicate panel.
            panel_unit = _find_existing_panel_unit(db, payload.work_unit_id, panel_definition_id)
            if panel_unit is None:
                panel_definition = db.get(PanelDefinition, panel_definition_id)
                if not panel_definition or panel_definition.archived_at is not None:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Panel definition not found",
                    )
        if panel_unit is not None:
            if (
                panel_unit.status != PanelUnitStatus.PLANNED
                and panel_unit.current_station_id != payload.station_id
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Panel is already finished"
                        if panel_unit.status
                        in (PanelUnitStatus.COMPLETED, PanelUnitStatus.CONSUMED)
                        else "Panel is already in progress at another station"
                    ),
                )
            panel_unit_id = panel_unit.id
            panel_definition_id = panel_unit.panel_definition_id
        if not _dependencies_satisfied(
            db,
            task_def,
            work_unit,
            panel_unit_id,
            panel_definition_id,
            payload.scope,
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Task dependencies not satisfied",
            )
        if panel_unit is None:
            panel_unit = PanelUnit(
                work_unit_id=payload.work_unit_id,
                panel_definition_id=panel_definition_id,
                status=PanelUnitStatus.IN_PROGRESS,
                current_station_id=payload.station_id,
            )
            db.add(panel_unit)
            db.flush()
            panel_unit_id = panel_unit.id
        elif panel_unit.status == PanelUnitStatus.PLANNED:
            panel_unit.status = PanelUnitStatus.IN_PROGRESS
            panel_unit.current_station_id = payload.station_id
        if work_unit.status == WorkUnitStatus.PLANNED:
            work_unit.status = WorkUnitStatus.PANELS
    else:
        panel_unit_id = None
        panel_definition_id = None
        if not _dependencies_satisfied(
            db,
            task_def,
            work_unit,
            None,
            None,
            payload.scope,
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Task dependencies not satisfied",
            )
        if task_def.scope == TaskScope.MODULE and station.role == StationRole.ASSEMBLY:
            if work_unit.status != WorkUnitStatus.ASSEMBLY:
                first_station = (
                    db.execute(
                        select(Station)
                        .where(Station.role == StationRole.ASSEMBLY)
                        .where(Station.line_type == station.line_type)
                        .order_by(Station.sequence_order)
                        .limit(1)
                    ).scalar_one_or_none()
                )
                if work_unit.planned_assembly_line is None and station.line_type:
                    work_unit.planned_assembly_line = station.line_type
                work_unit.status = WorkUnitStatus.ASSEMBLY
                work_unit.current_station_id = (
                    first_station.id if first_station else station.id
                )

    panel_clause = (
        TaskInstance.panel_unit_id.is_(None)
        if panel_unit_id is None
        else TaskInstance.panel_unit_id == panel_unit_id
    )
    # Join the open instance rather than opening a second one for the same work.
    existing = (
        db.execute(
            select(TaskInstance)
            .where(TaskInstance.task_definition_id == payload.task_definition_id)
            .where(TaskInstance.work_unit_id == payload.work_unit_id)
            .where(panel_clause)
            .where(TaskInstance.station_id == payload.station_id)
            .where(TaskInstance.rework_task_id.is_(None))
            .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
            .order_by(TaskInstance.id)
            .limit(1)
        )
        .scalars()
        .first()
    )
    if existing:
        if not task_def.concurrent_allowed:
            for worker_id in unique_worker_ids:
                if _has_active_nonconcurrent_task(db, worker_id, exclude_instance_id=existing.id):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="One or more workers already have an active task",
                    )
        if unique_worker_ids:
            existing_workers = list(
                db.execute(select(Worker.id).where(Worker.id.in_(unique_worker_ids))).scalars()
            )
            if len(existing_workers) != len(unique_worker_ids):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="One or more workers not found",
                )
        for worker_id in unique_worker_ids:
            participation = db.execute(
                select(TaskParticipation.id)
                .where(TaskParticipation.task_instance_id == existing.id)
                .where(TaskParticipation.worker_id == worker_id)
                .where(TaskParticipation.left_at.is_(None))
                .limit(1)
            ).first()
            if participation:
                continue
            db.add(
                TaskParticipation(
                    task_instance_id=existing.id,
                    worker_id=worker_id,
                    joined_at=utc_now(),
                )
            )
        db.commit()
        db.refresh(existing)
        return existing

    if not task_def.concurrent_allowed:
        for worker_id in unique_worker_ids:
            if _has_active_nonconcurrent_task(db, worker_id):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="One or more workers already have an active task",
                )

    instance = TaskInstance(
        task_definition_id=payload.task_definition_id,
        scope=payload.scope,
        work_unit_id=payload.work_unit_id,
        panel_unit_id=panel_unit_id,
        station_id=payload.station_id,
        status=TaskStatus.IN_PROGRESS,
        started_at=utc_now(),
    )
    db.add(instance)
    db.flush()

    if unique_worker_ids:
        existing_workers = list(
            db.execute(select(Worker.id).where(Worker.id.in_(unique_worker_ids))).scalars()
        )
        if len(existing_workers) != len(unique_worker_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more workers not found",
            )
    for worker_id in unique_worker_ids:
        db.add(
            TaskParticipation(
                task_instance_id=instance.id,
                worker_id=worker_id,
                joined_at=utc_now(),
            )
        )
    db.commit()
    db.refresh(instance)
    return instance


@router.post("/join", response_model=TaskInstanceRead)
def join_task(
    payload: TaskJoinRequest,
    db: Session = Depends(get_db),
    worker: Worker = Depends(get_current_worker),
) -> TaskInstance:
    instance = _get_task_instance(payload.task_instance_id, db)
    if instance.status == TaskStatus.COMPLETED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task already completed")
    if instance.status == TaskStatus.SKIPPED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task was skipped")
    task_def = db.get(TaskDefinition, instance.task_definition_id)
    if not task_def:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found")
    allowed_worker_ids = _allowed_worker_ids(db, task_def.id)
    if allowed_worker_ids is not None and worker.id not in allowed_worker_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Worker is not allowed for this task",
        )
    if not task_def.concurrent_allowed and _has_active_nonconcurrent_task(
        db, worker.id, exclude_instance_id=instance.id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Worker already has an active task",
        )
    existing = db.execute(
        select(TaskParticipation.id)
        .where(TaskParticipation.task_instance_id == instance.id)
        .where(TaskParticipation.worker_id == worker.id)
        .where(TaskParticipation.left_at.is_(None))
        .limit(1)
    ).first()
    if existing:
        return instance
    db.add(
        TaskParticipation(
            task_instance_id=instance.id,
            worker_id=worker.id,
            joined_at=utc_now(),
        )
    )
    db.commit()
    db.refresh(instance)
    return instance


@router.post("/pause", response_model=TaskInstanceRead)
def pause_task(
    payload: TaskPauseRequest,
    db: Session = Depends(get_db),
    worker: Worker = Depends(get_current_worker),
) -> TaskInstance:
    instance = _get_task_instance(payload.task_instance_id, db)
    _reject_rework_instance(instance)
    if instance.status == TaskStatus.COMPLETED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task already completed")
    if instance.status == TaskStatus.SKIPPED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task was skipped")
    # Pausing an already paused task (double tap, stale tablet) keeps the original pause.
    if pause_instance(
        db,
        instance,
        reason_id=payload.reason_id,
        reason_text=payload.reason_text,
    ):
        db.commit()
        db.refresh(instance)
    return instance


@router.post("/resume", response_model=TaskInstanceRead)
def resume_task(
    payload: TaskResumeRequest,
    db: Session = Depends(get_db),
    worker: Worker = Depends(get_current_worker),
) -> TaskInstance:
    instance = _get_task_instance(payload.task_instance_id, db)
    _reject_rework_instance(instance)
    if instance.status == TaskStatus.COMPLETED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task already completed")
    if instance.status == TaskStatus.SKIPPED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task was skipped")
    task_def = db.get(TaskDefinition, instance.task_definition_id)
    if task_def:
        allowed_worker_ids = _allowed_worker_ids(db, task_def.id)
        if allowed_worker_ids is not None and worker.id not in allowed_worker_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Worker is not allowed for this task",
            )
    if task_def and not task_def.concurrent_allowed and _has_active_nonconcurrent_task(
        db, worker.id, exclude_instance_id=instance.id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Worker already has an active task",
        )
    instance.status = TaskStatus.IN_PROGRESS
    # Close every open pause, not only the newest, so stacked pauses stop counting.
    close_open_pauses(db, instance.id, utc_now())
    db.commit()
    db.refresh(instance)
    return instance


@router.post("/complete", response_model=TaskInstanceRead)
def complete_task(
    payload: TaskCompleteRequest,
    db: Session = Depends(get_db),
    worker: Worker = Depends(get_current_worker),
    session: WorkerSession = Depends(get_current_worker_session),
) -> TaskInstance:
    instance = _get_task_instance(payload.task_instance_id, db)
    _reject_rework_instance(instance)
    completion_station_id = session.station_id
    if completion_station_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Worker session station is not set",
        )
    if not db.get(Station, completion_station_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    task_def = db.get(TaskDefinition, instance.task_definition_id)
    active_participation = db.execute(
        select(TaskParticipation.id)
        .where(TaskParticipation.task_instance_id == instance.id)
        .where(TaskParticipation.worker_id == worker.id)
        .where(TaskParticipation.left_at.is_(None))
        .limit(1)
    ).first()
    if not active_participation:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Worker is not participating in this task",
        )
    if instance.status == TaskStatus.COMPLETED:
        return instance
    if instance.status == TaskStatus.SKIPPED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task was skipped")
    instance.status = TaskStatus.COMPLETED
    instance.completed_at = utc_now()
    if payload.notes:
        if instance.notes:
            instance.notes = f"{instance.notes}\n{payload.notes}"
        else:
            instance.notes = payload.notes
    close_open_participations(db, instance.id, instance.completed_at)
    close_open_pauses(db, instance.id, instance.completed_at)
    # Ensure the completion is visible to subsequent queries in this request.
    db.flush()
    auto_completed_instances: list[TaskInstance] = []
    if instance.scope == TaskScope.PANEL and instance.panel_unit_id is not None:
        panel_unit = db.get(PanelUnit, instance.panel_unit_id)
        station = db.get(Station, instance.station_id)
        if panel_unit and station:
            advance_panel_if_satisfied(db, panel_unit, station)
    if instance.scope == TaskScope.MODULE and instance.panel_unit_id is None:
        station = db.get(Station, instance.station_id)
        if (
            task_def
            and task_def.advance_trigger
            and station
            and station.role == StationRole.ASSEMBLY
        ):
            work_unit = db.get(WorkUnit, instance.work_unit_id)
            work_order = (
                db.get(WorkOrder, work_unit.work_order_id) if work_unit else None
            )
            if work_unit and work_order:
                next_station = _next_applicable_module_station(
                    db, station, work_unit, work_order
                )
                if next_station:
                    work_unit.current_station_id = next_station.id
                    if work_unit.status != WorkUnitStatus.ASSEMBLY:
                        work_unit.status = WorkUnitStatus.ASSEMBLY

    if instance.status == TaskStatus.COMPLETED:
        open_qc_checks_for_task_completion(db, instance)
        capture_task_station_adherence_fact(
            db,
            instance,
            task_def=task_def,
            completed_station_id=completion_station_id,
        )
    for auto_instance in auto_completed_instances:
        auto_task_def = (
            task_def
            if auto_instance.task_definition_id == instance.task_definition_id
            else db.get(TaskDefinition, auto_instance.task_definition_id)
        )
        capture_task_station_adherence_fact(
            db,
            auto_instance,
            task_def=auto_task_def,
            completed_station_id=completion_station_id,
        )

    db.commit()
    db.refresh(instance)
    return instance


def _close_instance_as_skipped(db: Session, instance: TaskInstance, at: datetime) -> None:
    instance.status = TaskStatus.SKIPPED
    instance.completed_at = at
    close_open_participations(db, instance.id, at)
    close_open_pauses(db, instance.id, at)


@router.post("/leave", response_model=TaskInstanceRead)
def leave_task_route(
    payload: TaskLeaveRequest,
    db: Session = Depends(get_db),
    worker: Worker = Depends(get_current_worker),
) -> TaskInstance:
    """Remove the current worker from the crew; the task pauses if nobody is left."""
    instance = _get_task_instance(payload.task_instance_id, db)
    if instance.status not in (TaskStatus.IN_PROGRESS, TaskStatus.PAUSED):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task is not open")
    result = leave_task(db, instance, worker.id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Worker is not participating in this task",
        )
    db.commit()
    db.refresh(instance)
    return instance


@router.post("/skip", status_code=status.HTTP_204_NO_CONTENT)
def skip_task(
    payload: TaskSkipRequest,
    db: Session = Depends(get_db),
    worker: Worker = Depends(get_current_worker),
) -> None:
    task_def = db.get(TaskDefinition, payload.task_definition_id)
    if not task_def:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found")
    if task_def.scope != payload.scope:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task scope mismatch")
    if not task_def.skippable:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task is not skippable")
    if payload.scope != TaskScope.PANEL:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only panel tasks can be skipped")
    if not db.get(WorkUnit, payload.work_unit_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work unit not found")
    if payload.panel_unit_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Panel unit not found")
    panel_unit = db.get(PanelUnit, payload.panel_unit_id)
    if not panel_unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Panel unit not found")
    if panel_unit.work_unit_id != payload.work_unit_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Panel unit does not belong to work unit",
        )
    if not db.get(Station, payload.station_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")

    db.add(
        TaskException(
            task_definition_id=payload.task_definition_id,
            scope=payload.scope,
            work_unit_id=payload.work_unit_id,
            panel_unit_id=payload.panel_unit_id,
            station_id=payload.station_id,
            exception_type=TaskExceptionType.SKIP,
            reason_text=payload.reason_text,
            created_by_worker_id=worker.id,
            created_at=utc_now(),
        )
    )

    # An open instance of the skipped task is closed as skipped: nobody keeps working on
    # it, and its crew is free for other tasks.
    skipped_at = utc_now()
    open_instances = list(
        db.execute(
            select(TaskInstance)
            .where(TaskInstance.task_definition_id == payload.task_definition_id)
            .where(TaskInstance.work_unit_id == payload.work_unit_id)
            .where(TaskInstance.panel_unit_id == payload.panel_unit_id)
            .where(TaskInstance.station_id == payload.station_id)
            .where(TaskInstance.rework_task_id.is_(None))
            .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
        ).scalars()
    )
    for instance in open_instances:
        _close_instance_as_skipped(db, instance, skipped_at)
    db.flush()
    station = db.get(Station, payload.station_id)
    if station:
        advance_panel_if_satisfied(db, panel_unit, station)
    db.commit()


@router.post("/notes", response_model=TaskInstanceRead)
def add_note(
    payload: TaskNoteRequest,
    db: Session = Depends(get_db),
    worker: Worker = Depends(get_current_worker),
) -> TaskInstance:
    instance = _get_task_instance(payload.task_instance_id, db)
    if instance.notes:
        instance.notes = f"{instance.notes}\n{payload.notes}"
    else:
        instance.notes = payload.notes
    db.commit()
    db.refresh(instance)
    return instance
