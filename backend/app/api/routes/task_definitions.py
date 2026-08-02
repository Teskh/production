from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin_page
from app.models.admin import AdminUser
from app.models.enums import RestrictionType
from app.models.qc import QCCheckInstance
from app.models.tasks import TaskApplicability, TaskDefinition, TaskInstance
from app.models.workers import Skill, TaskSkillRequirement, TaskWorkerRestriction, Worker
from app.schemas.tasks import (
    TaskAllowedWorkers,
    TaskDefinitionCreate,
    TaskDefinitionRead,
    TaskRegularCrew,
    TaskSpecialty,
    TaskDefinitionUpdate,
    TaskDefinitionUsageRead,
)

router = APIRouter()


def _get_task_definition(task_definition_id: int, db: Session) -> TaskDefinition:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    return task


def _task_usage(task_definition_id: int, db: Session) -> TaskDefinitionUsageRead:
    task_instances = db.scalar(
        select(func.count(TaskInstance.id)).where(
            TaskInstance.task_definition_id == task_definition_id
        )
    )
    qc_checks = db.scalar(
        select(func.count(QCCheckInstance.id))
        .join(
            TaskInstance,
            QCCheckInstance.related_task_instance_id == TaskInstance.id,
        )
        .where(TaskInstance.task_definition_id == task_definition_id)
    )
    return TaskDefinitionUsageRead(
        task_instances=int(task_instances or 0),
        qc_checks=int(qc_checks or 0),
    )


def _archive_task_definition(
    task: TaskDefinition, admin: AdminUser, db: Session
) -> TaskDefinition:
    if task.archived_at is None:
        task.archived_at = datetime.now(UTC).replace(tzinfo=None)
        task.archived_by_user_id = admin.id
        db.commit()
        db.refresh(task)
    return task


@router.get("", response_model=list[TaskDefinitionRead])
def list_task_definitions(
    include_archived: bool = False, db: Session = Depends(get_db)
) -> list[TaskDefinitionRead]:
    stmt = select(TaskDefinition).order_by(TaskDefinition.name)
    if not include_archived:
        stmt = stmt.where(TaskDefinition.archived_at.is_(None))
    tasks = list(db.execute(stmt).scalars())
    if not tasks:
        return []

    task_ids = [task.id for task in tasks]
    skill_rows = db.execute(
        select(
            TaskSkillRequirement.task_definition_id,
            TaskSkillRequirement.skill_id,
        )
        .where(TaskSkillRequirement.task_definition_id.in_(task_ids))
        .order_by(
            TaskSkillRequirement.task_definition_id,
            TaskSkillRequirement.skill_id,
        )
    ).all()
    skill_id_by_task_id: dict[int, int] = {}
    for task_definition_id, skill_id in skill_rows:
        skill_id_by_task_id.setdefault(task_definition_id, skill_id)

    return [
        TaskDefinitionRead.model_validate(task, from_attributes=True).model_copy(
            update={"skill_id": skill_id_by_task_id.get(task.id)}
        )
        for task in tasks
    ]


@router.post("", response_model=TaskDefinitionRead, status_code=status.HTTP_201_CREATED)
def create_task_definition(
    payload: TaskDefinitionCreate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
) -> TaskDefinition:
    task = TaskDefinition(**payload.model_dump())
    db.add(task)
    db.flush()
    db.add(
        TaskApplicability(
            task_definition_id=task.id,
            house_type_id=None,
            sub_type_id=None,
            module_number=None,
            panel_definition_id=None,
            applies=False,
            station_sequence_order=task.default_station_sequence,
        )
    )
    db.commit()
    db.refresh(task)
    return task


@router.get("/{task_definition_id}", response_model=TaskDefinitionRead)
def get_task_definition(
    task_definition_id: int, db: Session = Depends(get_db)
) -> TaskDefinition:
    return _get_task_definition(task_definition_id, db)


@router.get("/{task_definition_id}/usage", response_model=TaskDefinitionUsageRead)
def get_task_definition_usage(
    task_definition_id: int, db: Session = Depends(get_db)
) -> TaskDefinitionUsageRead:
    _get_task_definition(task_definition_id, db)
    return _task_usage(task_definition_id, db)


@router.put("/{task_definition_id}", response_model=TaskDefinitionRead)
def update_task_definition(
    task_definition_id: int,
    payload: TaskDefinitionUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
) -> TaskDefinition:
    task = _get_task_definition(task_definition_id, db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, key, value)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_definition_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_definition(
    task_definition_id: int,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
) -> None:
    task = _get_task_definition(task_definition_id, db)
    _archive_task_definition(task, admin, db)


@router.post("/{task_definition_id}/archive", response_model=TaskDefinitionRead)
def archive_task_definition(
    task_definition_id: int,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
) -> TaskDefinition:
    task = _get_task_definition(task_definition_id, db)
    return _archive_task_definition(task, admin, db)


@router.post("/{task_definition_id}/restore", response_model=TaskDefinitionRead)
def restore_task_definition(
    task_definition_id: int,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
) -> TaskDefinition:
    task = _get_task_definition(task_definition_id, db)
    if task.archived_at is not None:
        task.archived_at = None
        task.archived_by_user_id = None
        db.commit()
        db.refresh(task)
    return task


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
    _admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
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
    _admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
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
    _admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
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
