from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.tasks import TaskDefinition
from app.schemas.tasks import (
    TaskDefinitionCreate,
    TaskDefinitionRead,
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
