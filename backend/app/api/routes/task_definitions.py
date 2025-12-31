from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.enums import RestrictionType
from app.models.tasks import TaskApplicability, TaskDefinition
from app.models.workers import Skill, TaskSkillRequirement, TaskWorkerRestriction, Worker
from app.schemas.tasks import (
    TaskAllowedWorkers,
    TaskDefinitionCreate,
    TaskDefinitionRead,
    TaskRegularCrew,
    TaskSpecialty,
    TaskStationSequence,
    TaskDefinitionUpdate,
)

router = APIRouter()


@router.get("/", response_model=list[TaskDefinitionRead])
def list_task_definitions(db: Session = Depends(get_db)) -> list[TaskDefinition]:
    return list(db.execute(select(TaskDefinition).order_by(TaskDefinition.name)).scalars())


@router.post("/", response_model=TaskDefinitionRead, status_code=status.HTTP_201_CREATED)
def create_task_definition(
    payload: TaskDefinitionCreate, db: Session = Depends(get_db)
) -> TaskDefinition:
    task = TaskDefinition(**payload.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.get("/{task_definition_id}", response_model=TaskDefinitionRead)
def get_task_definition(
    task_definition_id: int, db: Session = Depends(get_db)
) -> TaskDefinition:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    return task


@router.put("/{task_definition_id}", response_model=TaskDefinitionRead)
def update_task_definition(
    task_definition_id: int,
    payload: TaskDefinitionUpdate,
    db: Session = Depends(get_db),
) -> TaskDefinition:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, key, value)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_definition_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_definition(
    task_definition_id: int, db: Session = Depends(get_db)
) -> None:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    db.delete(task)
    db.commit()


def _default_applicability_query(task_definition_id: int):
    return (
        TaskApplicability.task_definition_id == task_definition_id,
        TaskApplicability.house_type_id.is_(None),
        TaskApplicability.sub_type_id.is_(None),
        TaskApplicability.module_number.is_(None),
        TaskApplicability.panel_definition_id.is_(None),
    )


@router.get(
    "/{task_definition_id}/station-sequence-order",
    response_model=TaskStationSequence,
)
def get_station_sequence_order(
    task_definition_id: int, db: Session = Depends(get_db)
) -> TaskStationSequence:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    row = (
        db.execute(
            select(TaskApplicability)
            .where(*_default_applicability_query(task_definition_id))
            .order_by(TaskApplicability.id)
        )
        .scalars()
        .first()
    )
    return TaskStationSequence(
        station_sequence_order=row.station_sequence_order if row else None
    )


@router.put(
    "/{task_definition_id}/station-sequence-order",
    response_model=TaskStationSequence,
)
def set_station_sequence_order(
    task_definition_id: int,
    payload: TaskStationSequence,
    db: Session = Depends(get_db),
) -> TaskStationSequence:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    default_rows = list(
        db.execute(
            select(TaskApplicability).where(*_default_applicability_query(task_definition_id))
        ).scalars()
    )
    if payload.station_sequence_order is None:
        if default_rows:
            for extra in default_rows[1:]:
                db.delete(extra)
            default_rows[0].station_sequence_order = None
            default_rows[0].applies = True
            db.commit()
            return TaskStationSequence(station_sequence_order=None)
        row = TaskApplicability(
            task_definition_id=task_definition_id,
            house_type_id=None,
            sub_type_id=None,
            module_number=None,
            panel_definition_id=None,
            applies=True,
            station_sequence_order=None,
        )
        db.add(row)
        db.commit()
        return TaskStationSequence(station_sequence_order=None)
    if default_rows:
        for extra in default_rows[1:]:
            db.delete(extra)
        default_rows[0].station_sequence_order = payload.station_sequence_order
        default_rows[0].applies = True
        db.commit()
        return TaskStationSequence(
            station_sequence_order=default_rows[0].station_sequence_order
        )
    row = TaskApplicability(
        task_definition_id=task_definition_id,
        house_type_id=None,
        sub_type_id=None,
        module_number=None,
        panel_definition_id=None,
        applies=True,
        station_sequence_order=payload.station_sequence_order,
    )
    db.add(row)
    db.commit()
    return TaskStationSequence(station_sequence_order=row.station_sequence_order)


@router.get("/{task_definition_id}/specialty", response_model=TaskSpecialty)
def get_task_specialty(
    task_definition_id: int, db: Session = Depends(get_db)
) -> TaskSpecialty:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    skill_id = (
        db.execute(
            select(TaskSkillRequirement.skill_id)
            .where(TaskSkillRequirement.task_definition_id == task_definition_id)
            .order_by(TaskSkillRequirement.skill_id)
        )
        .scalars()
        .first()
    )
    return TaskSpecialty(skill_id=skill_id)


@router.put("/{task_definition_id}/specialty", response_model=TaskSpecialty)
def set_task_specialty(
    task_definition_id: int,
    payload: TaskSpecialty,
    db: Session = Depends(get_db),
) -> TaskSpecialty:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    if payload.skill_id is not None and not db.get(Skill, payload.skill_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Skill not found"
        )
    db.query(TaskSkillRequirement).filter(
        TaskSkillRequirement.task_definition_id == task_definition_id
    ).delete()
    if payload.skill_id is not None:
        db.add(
            TaskSkillRequirement(
                task_definition_id=task_definition_id, skill_id=payload.skill_id
            )
        )
    db.commit()
    return TaskSpecialty(skill_id=payload.skill_id)


def _list_task_worker_ids(
    task_definition_id: int, db: Session, restriction_type: RestrictionType
) -> list[int]:
    return list(
        db.execute(
            select(TaskWorkerRestriction.worker_id)
            .where(
                TaskWorkerRestriction.task_definition_id == task_definition_id,
                TaskWorkerRestriction.restriction_type == restriction_type,
            )
            .order_by(TaskWorkerRestriction.worker_id)
        ).scalars()
    )


def _set_task_worker_ids(
    task_definition_id: int,
    worker_ids: list[int],
    db: Session,
    restriction_type: RestrictionType,
) -> list[int]:
    unique_ids = sorted(set(worker_ids))
    if unique_ids:
        workers = list(
            db.execute(select(Worker.id).where(Worker.id.in_(unique_ids))).scalars()
        )
        if len(workers) != len(unique_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more workers not found",
            )
    db.query(TaskWorkerRestriction).filter(
        TaskWorkerRestriction.task_definition_id == task_definition_id,
        TaskWorkerRestriction.restriction_type == restriction_type,
    ).delete()
    for worker_id in unique_ids:
        db.add(
            TaskWorkerRestriction(
                task_definition_id=task_definition_id,
                worker_id=worker_id,
                restriction_type=restriction_type,
            )
        )
    db.commit()
    return unique_ids


@router.get("/{task_definition_id}/allowed-workers", response_model=TaskAllowedWorkers)
def list_allowed_workers(
    task_definition_id: int, db: Session = Depends(get_db)
) -> TaskAllowedWorkers:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    worker_ids = _list_task_worker_ids(task_definition_id, db, RestrictionType.ALLOWED)
    return TaskAllowedWorkers(worker_ids=worker_ids if worker_ids else None)


@router.put("/{task_definition_id}/allowed-workers", response_model=TaskAllowedWorkers)
def set_allowed_workers(
    task_definition_id: int,
    payload: TaskAllowedWorkers,
    db: Session = Depends(get_db),
) -> TaskAllowedWorkers:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    worker_ids = payload.worker_ids or []
    if not worker_ids:
        db.query(TaskWorkerRestriction).filter(
            TaskWorkerRestriction.task_definition_id == task_definition_id,
            TaskWorkerRestriction.restriction_type == RestrictionType.ALLOWED,
        ).delete()
        db.commit()
        return TaskAllowedWorkers(worker_ids=None)
    updated = _set_task_worker_ids(
        task_definition_id, worker_ids, db, RestrictionType.ALLOWED
    )
    return TaskAllowedWorkers(worker_ids=updated)


@router.get("/{task_definition_id}/regular-crew", response_model=TaskRegularCrew)
def list_regular_crew(
    task_definition_id: int, db: Session = Depends(get_db)
) -> TaskRegularCrew:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    worker_ids = _list_task_worker_ids(
        task_definition_id, db, RestrictionType.REGULAR_CREW
    )
    return TaskRegularCrew(worker_ids=worker_ids)


@router.put("/{task_definition_id}/regular-crew", response_model=TaskRegularCrew)
def set_regular_crew(
    task_definition_id: int,
    payload: TaskRegularCrew,
    db: Session = Depends(get_db),
) -> TaskRegularCrew:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    worker_ids = payload.worker_ids or []
    updated = _set_task_worker_ids(
        task_definition_id, worker_ids, db, RestrictionType.REGULAR_CREW
    )
    return TaskRegularCrew(worker_ids=updated)
