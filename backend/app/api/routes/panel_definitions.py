from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin_page
from app.models.admin import AdminUser
from app.models.house import HouseSubType, HouseType, PanelDefinition
from app.models.qc import QCCheckInstance
from app.models.tasks import TaskInstance
from app.models.work import PanelUnit
from app.schemas.panels import (
    PanelDefinitionCreate,
    PanelDefinitionRead,
    PanelDefinitionUpdate,
    PanelDefinitionUsageRead,
)
from app.services.task_applicability import sync_panel_task_applicability

router = APIRouter()


def _get_panel_definition(panel_definition_id: int, db: Session) -> PanelDefinition:
    panel_definition = db.get(PanelDefinition, panel_definition_id)
    if not panel_definition:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Panel definition not found"
        )
    return panel_definition


def _panel_usage(panel_definition_id: int, db: Session) -> PanelDefinitionUsageRead:
    task_instances = db.scalar(
        select(func.count(TaskInstance.id))
        .join(PanelUnit, TaskInstance.panel_unit_id == PanelUnit.id)
        .where(PanelUnit.panel_definition_id == panel_definition_id)
    )
    qc_checks = db.scalar(
        select(func.count(QCCheckInstance.id))
        .join(PanelUnit, QCCheckInstance.panel_unit_id == PanelUnit.id)
        .where(PanelUnit.panel_definition_id == panel_definition_id)
    )
    return PanelDefinitionUsageRead(
        task_instances=int(task_instances or 0),
        qc_checks=int(qc_checks or 0),
    )


def _archive_panel_definition(
    panel_definition: PanelDefinition, admin: AdminUser, db: Session
) -> PanelDefinition:
    if panel_definition.archived_at is None:
        panel_definition.archived_at = datetime.now(UTC).replace(tzinfo=None)
        panel_definition.archived_by_user_id = admin.id
        db.commit()
        db.refresh(panel_definition)
    return panel_definition


@router.get("", response_model=list[PanelDefinitionRead])
def list_panel_definitions(
    include_archived: bool = False, db: Session = Depends(get_db)
) -> list[PanelDefinition]:
    stmt = select(PanelDefinition).order_by(PanelDefinition.id)
    if not include_archived:
        stmt = stmt.where(PanelDefinition.archived_at.is_(None))
    return list(db.execute(stmt).scalars())


@router.post("", response_model=PanelDefinitionRead, status_code=status.HTTP_201_CREATED)
def create_panel_definition(
    payload: PanelDefinitionCreate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("house-config", edit=True)),
) -> PanelDefinition:
    if not db.get(HouseType, payload.house_type_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
        )
    if payload.sub_type_id is not None:
        subtype = db.get(HouseSubType, payload.sub_type_id)
        if not subtype:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="House subtype not found"
            )
        if subtype.house_type_id != payload.house_type_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="House subtype does not belong to house type",
            )
    panel_definition = PanelDefinition(**payload.model_dump())
    db.add(panel_definition)
    db.flush()
    sync_panel_task_applicability(db, panel_definition)
    db.commit()
    db.refresh(panel_definition)
    return panel_definition


@router.get("/{panel_definition_id}", response_model=PanelDefinitionRead)
def get_panel_definition(
    panel_definition_id: int, db: Session = Depends(get_db)
) -> PanelDefinition:
    return _get_panel_definition(panel_definition_id, db)


@router.get(
    "/{panel_definition_id}/usage", response_model=PanelDefinitionUsageRead
)
def get_panel_definition_usage(
    panel_definition_id: int, db: Session = Depends(get_db)
) -> PanelDefinitionUsageRead:
    _get_panel_definition(panel_definition_id, db)
    return _panel_usage(panel_definition_id, db)


@router.put("/{panel_definition_id}", response_model=PanelDefinitionRead)
def update_panel_definition(
    panel_definition_id: int,
    payload: PanelDefinitionUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("house-config", edit=True)),
) -> PanelDefinition:
    panel_definition = _get_panel_definition(panel_definition_id, db)
    updates = payload.model_dump(exclude_unset=True)
    if "house_type_id" in updates and not db.get(HouseType, updates["house_type_id"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
        )
    if "sub_type_id" in updates and updates["sub_type_id"] is not None:
        subtype = db.get(HouseSubType, updates["sub_type_id"])
        if not subtype:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="House subtype not found"
            )
        target_house_type_id = updates.get(
            "house_type_id", panel_definition.house_type_id
        )
        if subtype.house_type_id != target_house_type_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="House subtype does not belong to house type",
            )
    for key, value in updates.items():
        setattr(panel_definition, key, value)
    if "applicable_task_ids" in updates:
        sync_panel_task_applicability(db, panel_definition)
    db.commit()
    db.refresh(panel_definition)
    return panel_definition


@router.delete("/{panel_definition_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_panel_definition(
    panel_definition_id: int,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_admin_page("house-config", edit=True)),
) -> None:
    panel_definition = _get_panel_definition(panel_definition_id, db)
    _archive_panel_definition(panel_definition, admin, db)


@router.post(
    "/{panel_definition_id}/archive", response_model=PanelDefinitionRead
)
def archive_panel_definition(
    panel_definition_id: int,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_admin_page("house-config", edit=True)),
) -> PanelDefinition:
    panel_definition = _get_panel_definition(panel_definition_id, db)
    return _archive_panel_definition(panel_definition, admin, db)


@router.post(
    "/{panel_definition_id}/restore", response_model=PanelDefinitionRead
)
def restore_panel_definition(
    panel_definition_id: int,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("house-config", edit=True)),
) -> PanelDefinition:
    panel_definition = _get_panel_definition(panel_definition_id, db)
    if panel_definition.archived_at is not None:
        panel_definition.archived_at = None
        panel_definition.archived_by_user_id = None
        db.commit()
        db.refresh(panel_definition)
    return panel_definition
