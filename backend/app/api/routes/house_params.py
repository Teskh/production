from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_db
from app.models.admin import AdminUser
from app.models.house import HouseParameter, HouseParameterValue, HouseType
from app.schemas.parameters import (
    HouseParameterCreate,
    HouseParameterRead,
    HouseParameterUpdate,
    HouseParameterValueCreate,
    HouseParameterValueRead,
    HouseParameterValueUpdate,
)

router = APIRouter()


@router.get("/", response_model=list[HouseParameterRead])
def list_house_parameters(db: Session = Depends(get_db)) -> list[HouseParameter]:
    return list(db.execute(select(HouseParameter).order_by(HouseParameter.name)).scalars())


@router.post("/", response_model=HouseParameterRead, status_code=status.HTTP_201_CREATED)
def create_house_parameter(
    payload: HouseParameterCreate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> HouseParameter:
    parameter = HouseParameter(**payload.model_dump())
    db.add(parameter)
    db.commit()
    db.refresh(parameter)
    return parameter


@router.get("/{parameter_id}", response_model=HouseParameterRead)
def get_house_parameter(parameter_id: int, db: Session = Depends(get_db)) -> HouseParameter:
    parameter = db.get(HouseParameter, parameter_id)
    if not parameter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="House parameter not found"
        )
    return parameter


@router.put("/{parameter_id}", response_model=HouseParameterRead)
def update_house_parameter(
    parameter_id: int,
    payload: HouseParameterUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> HouseParameter:
    parameter = db.get(HouseParameter, parameter_id)
    if not parameter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="House parameter not found"
        )
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(parameter, key, value)
    db.commit()
    db.refresh(parameter)
    return parameter


@router.delete("/{parameter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_house_parameter(
    parameter_id: int,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> None:
    parameter = db.get(HouseParameter, parameter_id)
    if not parameter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="House parameter not found"
        )
    db.delete(parameter)
    db.commit()


@router.get("/{parameter_id}/values", response_model=list[HouseParameterValueRead])
def list_house_parameter_values(
    parameter_id: int, db: Session = Depends(get_db)
) -> list[HouseParameterValue]:
    stmt = select(HouseParameterValue).where(HouseParameterValue.parameter_id == parameter_id)
    return list(db.execute(stmt.order_by(HouseParameterValue.id)).scalars())


@router.post(
    "/{parameter_id}/values",
    response_model=HouseParameterValueRead,
    status_code=status.HTTP_201_CREATED,
)
def create_house_parameter_value(
    parameter_id: int,
    payload: HouseParameterValueCreate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> HouseParameterValue:
    if parameter_id != payload.parameter_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Parameter id mismatch",
        )
    if not db.get(HouseParameter, payload.parameter_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House parameter not found"
        )
    if not db.get(HouseType, payload.house_type_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
        )
    value = HouseParameterValue(**payload.model_dump())
    db.add(value)
    db.commit()
    db.refresh(value)
    return value


@router.get("/values/{value_id}", response_model=HouseParameterValueRead)
def get_house_parameter_value(
    value_id: int, db: Session = Depends(get_db)
) -> HouseParameterValue:
    value = db.get(HouseParameterValue, value_id)
    if not value:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="House parameter value not found"
        )
    return value


@router.put("/values/{value_id}", response_model=HouseParameterValueRead)
def update_house_parameter_value(
    value_id: int,
    payload: HouseParameterValueUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> HouseParameterValue:
    value = db.get(HouseParameterValue, value_id)
    if not value:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="House parameter value not found"
        )
    updates = payload.model_dump(exclude_unset=True)
    if "parameter_id" in updates and not db.get(HouseParameter, updates["parameter_id"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House parameter not found"
        )
    if "house_type_id" in updates and not db.get(HouseType, updates["house_type_id"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
        )
    for key, val in updates.items():
        setattr(value, key, val)
    db.commit()
    db.refresh(value)
    return value


@router.delete("/values/{value_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_house_parameter_value(
    value_id: int,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> None:
    value = db.get(HouseParameterValue, value_id)
    if not value:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="House parameter value not found"
        )
    db.delete(value)
    db.commit()
