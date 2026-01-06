from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_db
from app.models.admin import AdminUser
from app.models.house import HouseSubType, HouseType, PanelDefinition
from app.schemas.panels import (
    PanelDefinitionCreate,
    PanelDefinitionRead,
    PanelDefinitionUpdate,
)

router = APIRouter()


@router.get("/", response_model=list[PanelDefinitionRead])
def list_panel_definitions(db: Session = Depends(get_db)) -> list[PanelDefinition]:
    return list(db.execute(select(PanelDefinition).order_by(PanelDefinition.id)).scalars())


@router.post("/", response_model=PanelDefinitionRead, status_code=status.HTTP_201_CREATED)
def create_panel_definition(
    payload: PanelDefinitionCreate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
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
    db.commit()
    db.refresh(panel_definition)
    return panel_definition


@router.get("/{panel_definition_id}", response_model=PanelDefinitionRead)
def get_panel_definition(
    panel_definition_id: int, db: Session = Depends(get_db)
) -> PanelDefinition:
    panel_definition = db.get(PanelDefinition, panel_definition_id)
    if not panel_definition:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Panel definition not found"
        )
    return panel_definition


@router.put("/{panel_definition_id}", response_model=PanelDefinitionRead)
def update_panel_definition(
    panel_definition_id: int,
    payload: PanelDefinitionUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> PanelDefinition:
    panel_definition = db.get(PanelDefinition, panel_definition_id)
    if not panel_definition:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Panel definition not found"
        )
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
    db.commit()
    db.refresh(panel_definition)
    return panel_definition


@router.delete("/{panel_definition_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_panel_definition(
    panel_definition_id: int,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> None:
    panel_definition = db.get(PanelDefinition, panel_definition_id)
    if not panel_definition:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Panel definition not found"
        )
    db.delete(panel_definition)
    db.commit()
