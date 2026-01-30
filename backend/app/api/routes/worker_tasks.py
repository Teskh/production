from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_worker, get_db
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
from app.models.workers import TaskWorkerRestriction, Worker
from app.schemas.tasks import TaskInstanceRead, WorkerActiveTaskRead
from app.schemas.worker_station import (
    TaskCompleteRequest,
    TaskJoinRequest,
    TaskNoteRequest,
    TaskPauseRequest,
    TaskResumeRequest,
    TaskSkipRequest,
    TaskStartRequest,
)
from app.services.task_applicability import resolve_task_station_sequence
from app.services.qc_runtime import open_qc_checks_for_task_completion

router = APIRouter()


def _required_panel_task_ids(
    db: Session,
    station: Station,
    work_unit: WorkUnit,
    work_order: WorkOrder,
    panel_definition: PanelDefinition,
) -> set[int]:
    task_defs = list(
        db.execute(
            select(TaskDefinition)
            .where(TaskDefinition.active == True)
            .where(TaskDefinition.scope == TaskScope.PANEL)
        ).scalars()
    )
    if not task_defs:
        return set()
    task_def_ids = [task.id for task in task_defs]
    applicability_rows = list(
        db.execute(
            select(TaskApplicability).where(TaskApplicability.task_definition_id.in_(task_def_ids))
        ).scalars()
    )
    applicability_map: dict[int, list[TaskApplicability]] = {}
    for row in applicability_rows:
        applicability_map.setdefault(row.task_definition_id, []).append(row)

    panel_task_order = panel_definition.applicable_task_ids
    required_ids: set[int] = set()
    for task in task_defs:
        if panel_task_order is not None and task.id not in panel_task_order:
            continue
        applies, station_sequence_order = resolve_task_station_sequence(
            task,
            applicability_map.get(task.id, []),
            work_order.house_type_id,
            work_order.sub_type_id,
            work_unit.module_number,
            panel_definition.id,
        )
        if not applies:
            continue
        if station_sequence_order is None:
            continue
        if station.sequence_order != station_sequence_order:
            continue
        required_ids.add(task.id)
    return required_ids


def _advance_panel_if_satisfied(
    db: Session,
    panel_unit: PanelUnit,
    station: Station,
) -> None:
    if station.role != StationRole.PANELS:
        return
    work_unit = db.get(WorkUnit, panel_unit.work_unit_id)
    if not work_unit:
        return
    work_order = db.get(WorkOrder, work_unit.work_order_id)
    if not work_order:
        return
    panel_def = db.get(PanelDefinition, panel_unit.panel_definition_id)
    if not panel_def:
        return

    required_ids = _required_panel_task_ids(db, station, work_unit, work_order, panel_def)
    if required_ids:
        completed_ids = set(
            db.execute(
                select(TaskInstance.task_definition_id)
                .where(TaskInstance.work_unit_id == work_unit.id)
                .where(TaskInstance.panel_unit_id == panel_unit.id)
                .where(TaskInstance.station_id == station.id)
                .where(TaskInstance.status.in_([TaskStatus.COMPLETED, TaskStatus.SKIPPED]))
                .where(TaskInstance.task_definition_id.in_(required_ids))
            ).scalars()
        )
        skipped_ids = set(
            db.execute(
                select(TaskException.task_definition_id)
                .where(TaskException.work_unit_id == work_unit.id)
                .where(TaskException.panel_unit_id == panel_unit.id)
                .where(TaskException.station_id == station.id)
                .where(TaskException.exception_type == TaskExceptionType.SKIP)
                .where(TaskException.task_definition_id.in_(required_ids))
            ).scalars()
        )
        satisfied_ids = completed_ids | skipped_ids
        should_advance = required_ids.issubset(satisfied_ids)
    else:
        should_advance = True

    if not should_advance:
        return

    next_station = None
    candidates = list(
        db.execute(
            select(Station)
            .where(Station.role == StationRole.PANELS)
            .where(Station.sequence_order > station.sequence_order)
            .order_by(Station.sequence_order)
        ).scalars()
    )
    for candidate in candidates:
        candidate_required = _required_panel_task_ids(
            db, candidate, work_unit, work_order, panel_def
        )
        if candidate_required:
            next_station = candidate
            break

    if next_station:
        panel_unit.current_station_id = next_station.id
        panel_unit.status = PanelUnitStatus.IN_PROGRESS
        if work_unit.status == WorkUnitStatus.PLANNED:
            work_unit.status = WorkUnitStatus.PANELS
    else:
        panel_unit.current_station_id = None
        panel_unit.status = PanelUnitStatus.COMPLETED
        if work_unit.status in (WorkUnitStatus.PLANNED, WorkUnitStatus.PANELS):
            work_unit.status = WorkUnitStatus.MAGAZINE


def _station_has_module_tasks(
    station: Station,
    task_definitions: list[TaskDefinition],
    applicability_map: dict[int, list[TaskApplicability]],
    work_order: WorkOrder,
    work_unit: WorkUnit,
) -> bool:
    if station.sequence_order is None:
        return False
    for task in task_definitions:
        applies, station_sequence_order = resolve_task_station_sequence(
            task,
            applicability_map.get(task.id, []),
            work_order.house_type_id,
            work_order.sub_type_id,
            work_unit.module_number,
            None,
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
            candidate, task_definitions, applicability_map, work_order, work_unit
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
    work_unit_id: int,
    panel_unit_id: int | None,
    scope: TaskScope,
) -> bool:
    dependencies = task_def.dependencies_json
    if dependencies is None:
        return True
    if not isinstance(dependencies, list):
        return False
    if not dependencies:
        return True
    if scope == TaskScope.PANEL:
        if panel_unit_id is None:
            return False
        panel_clause = TaskInstance.panel_unit_id == panel_unit_id
    else:
        panel_clause = TaskInstance.panel_unit_id.is_(None)
    completed_ids = set(
        db.execute(
            select(TaskInstance.task_definition_id)
            .where(TaskInstance.work_unit_id == work_unit_id)
            .where(panel_clause)
            .where(TaskInstance.status == TaskStatus.COMPLETED)
        ).scalars()
    )
    return all(dependency_id in completed_ids for dependency_id in dependencies)


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
            select(WorkUnit).where(WorkUnit.id.in_(work_unit_ids))
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
    payloads: list[WorkerActiveTaskRead] = []
    for instance in instances:
        panel_unit = (
            panel_units.get(instance.panel_unit_id)
            if instance.panel_unit_id is not None
            else None
        )
        work_unit = work_units.get(instance.work_unit_id)
        current_station_id = panel_unit.current_station_id if panel_unit else None
        if current_station_id is None and work_unit:
            current_station_id = work_unit.current_station_id
        payloads.append(
            WorkerActiveTaskRead(
                task_instance_id=instance.id,
                station_id=instance.station_id,
                current_station_id=current_station_id,
                work_unit_id=instance.work_unit_id,
                panel_unit_id=instance.panel_unit_id,
                module_number=work_unit.module_number if work_unit else None,
                panel_code=(
                    panel_unit.panel_definition.panel_code
                    if panel_unit and panel_unit.panel_definition
                    else None
                ),
                status=instance.status,
                started_at=instance.started_at,
            )
        )
    return payloads


@router.post("/start", response_model=TaskInstanceRead, status_code=status.HTTP_201_CREATED)
def start_task(
    payload: TaskStartRequest,
    db: Session = Depends(get_db),
    worker: Worker = Depends(get_current_worker),
) -> TaskInstance:
    task_def = db.get(TaskDefinition, payload.task_definition_id)
    if not task_def or not task_def.active:
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
    work_unit = db.get(WorkUnit, payload.work_unit_id)
    if not work_unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work unit not found")
    panel_unit_id = payload.panel_unit_id
    panel_definition_id = payload.panel_definition_id
    if payload.scope == TaskScope.PANEL:
        if panel_unit_id is not None:
            panel_unit = db.get(PanelUnit, panel_unit_id)
            if not panel_unit:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Panel unit not found")
            if panel_unit.work_unit_id != payload.work_unit_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Panel unit does not belong to work unit",
                )
            if panel_unit.status != PanelUnitStatus.PLANNED and panel_unit.current_station_id != payload.station_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Panel is already in progress at another station",
                )
            panel_definition_id = panel_unit.panel_definition_id
            if not _dependencies_satisfied(
                db,
                task_def,
                payload.work_unit_id,
                panel_unit_id,
                payload.scope,
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Task dependencies not satisfied",
                )
            if panel_unit.status == PanelUnitStatus.PLANNED:
                panel_unit.status = PanelUnitStatus.IN_PROGRESS
                panel_unit.current_station_id = payload.station_id
                if work_unit.status == WorkUnitStatus.PLANNED:
                    work_unit.status = WorkUnitStatus.PANELS
        else:
            if panel_definition_id is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Panel definition is required",
                )
            if not _dependencies_satisfied(
                db,
                task_def,
                payload.work_unit_id,
                None,
                payload.scope,
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Task dependencies not satisfied",
                )
            panel_unit = PanelUnit(
                work_unit_id=payload.work_unit_id,
                panel_definition_id=panel_definition_id,
                status=PanelUnitStatus.IN_PROGRESS,
                current_station_id=payload.station_id,
            )
            db.add(panel_unit)
            db.flush()
            panel_unit_id = panel_unit.id
            if work_unit.status == WorkUnitStatus.PLANNED:
                work_unit.status = WorkUnitStatus.PANELS
    else:
        panel_unit_id = None
        panel_definition_id = None
        if not _dependencies_satisfied(
            db,
            task_def,
            payload.work_unit_id,
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
    existing = db.execute(
        select(TaskInstance)
        .where(TaskInstance.task_definition_id == payload.task_definition_id)
        .where(TaskInstance.work_unit_id == payload.work_unit_id)
        .where(panel_clause)
        .where(TaskInstance.station_id == payload.station_id)
        .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
    ).scalar_one_or_none()
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
                select(TaskParticipation)
                .where(TaskParticipation.task_instance_id == existing.id)
                .where(TaskParticipation.worker_id == worker_id)
                .where(TaskParticipation.left_at.is_(None))
            ).scalar_one_or_none()
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
        select(TaskParticipation)
        .where(TaskParticipation.task_instance_id == instance.id)
        .where(TaskParticipation.worker_id == worker.id)
        .where(TaskParticipation.left_at.is_(None))
    ).scalar_one_or_none()
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
    if instance.status == TaskStatus.COMPLETED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task already completed")
    instance.status = TaskStatus.PAUSED
    db.add(
        TaskPause(
            task_instance_id=instance.id,
            reason_id=payload.reason_id,
            reason_text=payload.reason_text,
            paused_at=utc_now(),
        )
    )
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
    if instance.status == TaskStatus.COMPLETED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task already completed")
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
    pause = db.execute(
        select(TaskPause)
        .where(TaskPause.task_instance_id == instance.id)
        .where(TaskPause.resumed_at.is_(None))
        .order_by(TaskPause.paused_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if pause:
        pause.resumed_at = utc_now()
    db.commit()
    db.refresh(instance)
    return instance


@router.post("/complete", response_model=TaskInstanceRead)
def complete_task(
    payload: TaskCompleteRequest,
    db: Session = Depends(get_db),
    worker: Worker = Depends(get_current_worker),
) -> TaskInstance:
    instance = _get_task_instance(payload.task_instance_id, db)
    active_participation = db.execute(
        select(TaskParticipation)
        .where(TaskParticipation.task_instance_id == instance.id)
        .where(TaskParticipation.worker_id == worker.id)
        .where(TaskParticipation.left_at.is_(None))
    ).scalar_one_or_none()
    if not active_participation:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Worker is not participating in this task",
        )
    if instance.status == TaskStatus.COMPLETED:
        return instance
    instance.status = TaskStatus.COMPLETED
    instance.completed_at = utc_now()
    if payload.notes:
        if instance.notes:
            instance.notes = f"{instance.notes}\n{payload.notes}"
        else:
            instance.notes = payload.notes
    participations = list(
        db.execute(
            select(TaskParticipation)
            .where(TaskParticipation.task_instance_id == instance.id)
            .where(TaskParticipation.left_at.is_(None))
        ).scalars()
    )
    for participation in participations:
        participation.left_at = instance.completed_at
    open_pauses = list(
        db.execute(
            select(TaskPause)
            .where(TaskPause.task_instance_id == instance.id)
            .where(TaskPause.resumed_at.is_(None))
        ).scalars()
    )
    for pause in open_pauses:
        pause.resumed_at = instance.completed_at
    # Ensure the completion is visible to subsequent queries in this request.
    db.flush()
    if instance.scope == TaskScope.PANEL and instance.panel_unit_id is not None:
        panel_unit = db.get(PanelUnit, instance.panel_unit_id)
        station = db.get(Station, instance.station_id)
        if panel_unit and station:
            _advance_panel_if_satisfied(db, panel_unit, station)
    if instance.scope == TaskScope.MODULE and instance.panel_unit_id is None:
        task_def = db.get(TaskDefinition, instance.task_definition_id)
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
                else:
                    work_unit.current_station_id = None
                    work_unit.status = WorkUnitStatus.COMPLETED
                    panels = list(
                        db.execute(
                            select(PanelUnit).where(PanelUnit.work_unit_id == work_unit.id)
                        ).scalars()
                    )
                    for panel in panels:
                        panel.status = PanelUnitStatus.CONSUMED
                        panel.current_station_id = None
                    _auto_complete_open_module_tasks_for_work_unit(
                        db,
                        work_unit.id,
                        "término automatico por salida de módulo",
                    )

    if instance.status == TaskStatus.COMPLETED:
        open_qc_checks_for_task_completion(db, instance)

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

    instance = db.execute(
        select(TaskInstance)
        .where(TaskInstance.task_definition_id == payload.task_definition_id)
        .where(TaskInstance.work_unit_id == payload.work_unit_id)
        .where(TaskInstance.panel_unit_id == payload.panel_unit_id)
        .where(TaskInstance.station_id == payload.station_id)
        .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
    ).scalar_one_or_none()
    if instance:
        instance.status = TaskStatus.PAUSED
        db.add(
            TaskPause(
                task_instance_id=instance.id,
                reason_text=payload.reason_text or "Skipped override",
                paused_at=utc_now(),
            )
        )
    db.flush()
    station = db.get(Station, payload.station_id)
    if station:
        _advance_panel_if_satisfied(db, panel_unit, station)
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
