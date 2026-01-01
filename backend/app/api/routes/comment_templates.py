from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.admin import CommentTemplate
from app.models.stations import Station
from app.schemas.config import (
    CommentTemplateCreate,
    CommentTemplateRead,
    CommentTemplateUpdate,
)

router = APIRouter()


def _validate_station_ids(
    db: Session,
    station_ids: list[int] | None,
) -> None:
    if station_ids is None:
        return
    if not station_ids:
        return
    stations = list(db.execute(select(Station.id).where(Station.id.in_(station_ids))).scalars())
    if len(stations) != len(set(station_ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One or more stations not found",
        )


@router.get("/", response_model=list[CommentTemplateRead])
def list_comment_templates(db: Session = Depends(get_db)) -> list[CommentTemplate]:
    return list(db.execute(select(CommentTemplate).order_by(CommentTemplate.text)).scalars())


@router.post("/", response_model=CommentTemplateRead, status_code=status.HTTP_201_CREATED)
def create_comment_template(
    payload: CommentTemplateCreate, db: Session = Depends(get_db)
) -> CommentTemplate:
    _validate_station_ids(db, payload.applicable_station_ids)
    template = CommentTemplate(**payload.model_dump())
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@router.get("/{template_id}", response_model=CommentTemplateRead)
def get_comment_template(
    template_id: int, db: Session = Depends(get_db)
) -> CommentTemplate:
    template = db.get(CommentTemplate, template_id)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Comment template not found"
        )
    return template


@router.put("/{template_id}", response_model=CommentTemplateRead)
def update_comment_template(
    template_id: int, payload: CommentTemplateUpdate, db: Session = Depends(get_db)
) -> CommentTemplate:
    template = db.get(CommentTemplate, template_id)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Comment template not found"
        )
    updates = payload.model_dump(exclude_unset=True)
    if "applicable_station_ids" in updates:
        _validate_station_ids(db, updates["applicable_station_ids"])
    for key, value in updates.items():
        setattr(template, key, value)
    db.commit()
    db.refresh(template)
    return template


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment_template(template_id: int, db: Session = Depends(get_db)) -> None:
    template = db.get(CommentTemplate, template_id)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Comment template not found"
        )
    db.delete(template)
    db.commit()
