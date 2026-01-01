from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_worker, get_db
from app.core.security import utc_now
from app.models.enums import TaskExceptionType, TaskScope, TaskStatus
from app.models.stations import Station
from app.models.tasks import (
    TaskDefinition,
    TaskException,
    TaskInstance,
    TaskParticipation,
    TaskPause,
)
from app.models.enums import PanelUnitStatus, WorkUnitStatus
from app.models.work import PanelUnit, WorkUnit
from app.models.workers import Worker
from app.schemas.tasks import TaskInstanceRead
from app.schemas.worker_station import (
    TaskCompleteRequest,
    TaskNoteRequest,
    TaskPauseRequest,
    TaskResumeRequest,
    TaskSkipRequest,
    TaskStartRequest,
)

router = APIRouter()


def _get_task_instance(instance_id: int, db: Session) -> TaskInstance:
    instance = db.get(TaskInstance, instance_id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task instance not found")
    return instance


@router.post("/start", response_model=TaskInstanceRead, status_code=status.HTTP_201_CREATED)
def start_task(
    payload: TaskStartRequest,
    db: Session = Depends(get_db),
    worker: Worker = Depends(get_current_worker),
) -> TaskInstance:
    task_def = db.get(TaskDefinition, payload.task_definition_id)
    if not task_def or not task_def.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found")
    if task_def.scope != payload.scope:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task scope mismatch")
    if not db.get(Station, payload.station_id):
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

    existing = db.execute(
        select(TaskInstance)
        .where(TaskInstance.task_definition_id == payload.task_definition_id)
        .where(TaskInstance.work_unit_id == payload.work_unit_id)
        .where(TaskInstance.panel_unit_id.is_(panel_unit_id))
        .where(TaskInstance.station_id == payload.station_id)
        .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Task already active")

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

    worker_ids = payload.worker_ids or [worker.id]
    unique_worker_ids = sorted(set(worker_ids))
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
