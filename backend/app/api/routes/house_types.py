from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.house import HouseSubType, HouseType
from app.schemas.houses import (
    HouseSubTypeCreate,
    HouseSubTypeRead,
    HouseSubTypeUpdate,
    HouseTypeCreate,
    HouseTypeRead,
    HouseTypeUpdate,
)

router = APIRouter()


@router.get("/", response_model=list[HouseTypeRead])
def list_house_types(db: Session = Depends(get_db)) -> list[HouseType]:
    return list(db.execute(select(HouseType).order_by(HouseType.name)).scalars())


@router.post("/", response_model=HouseTypeRead, status_code=status.HTTP_201_CREATED)
def create_house_type(payload: HouseTypeCreate, db: Session = Depends(get_db)) -> HouseType:
    house_type = HouseType(**payload.model_dump())
    db.add(house_type)
    db.commit()
    db.refresh(house_type)
    return house_type


@router.get("/{house_type_id}", response_model=HouseTypeRead)
def get_house_type(house_type_id: int, db: Session = Depends(get_db)) -> HouseType:
    house_type = db.get(HouseType, house_type_id)
    if not house_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House type not found")
    return house_type


@router.put("/{house_type_id}", response_model=HouseTypeRead)
def update_house_type(
    house_type_id: int, payload: HouseTypeUpdate, db: Session = Depends(get_db)
) -> HouseType:
    house_type = db.get(HouseType, house_type_id)
    if not house_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House type not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(house_type, key, value)
    db.commit()
    db.refresh(house_type)
    return house_type


@router.delete("/{house_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_house_type(house_type_id: int, db: Session = Depends(get_db)) -> None:
    house_type = db.get(HouseType, house_type_id)
    if not house_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House type not found")
    db.delete(house_type)
    db.commit()


@router.get("/{house_type_id}/subtypes", response_model=list[HouseSubTypeRead])
def list_house_subtypes(
    house_type_id: int, db: Session = Depends(get_db)
) -> list[HouseSubType]:
    stmt = select(HouseSubType).where(HouseSubType.house_type_id == house_type_id)
    return list(db.execute(stmt.order_by(HouseSubType.name)).scalars())


@router.post(
    "/{house_type_id}/subtypes",
    response_model=HouseSubTypeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_house_subtype(
    house_type_id: int, payload: HouseSubTypeCreate, db: Session = Depends(get_db)
) -> HouseSubType:
    house_type = db.get(HouseType, house_type_id)
    if not house_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House type not found")
    subtype = HouseSubType(house_type_id=house_type_id, name=payload.name)
    db.add(subtype)
    db.commit()
    db.refresh(subtype)
    return subtype


@router.get("/subtypes/{sub_type_id}", response_model=HouseSubTypeRead)
def get_house_subtype(sub_type_id: int, db: Session = Depends(get_db)) -> HouseSubType:
    subtype = db.get(HouseSubType, sub_type_id)
    if not subtype:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House subtype not found")
    return subtype


@router.put("/subtypes/{sub_type_id}", response_model=HouseSubTypeRead)
def update_house_subtype(
    sub_type_id: int, payload: HouseSubTypeUpdate, db: Session = Depends(get_db)
) -> HouseSubType:
    subtype = db.get(HouseSubType, sub_type_id)
    if not subtype:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House subtype not found")
    updates = payload.model_dump(exclude_unset=True)
    if "house_type_id" in updates and not db.get(HouseType, updates["house_type_id"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
        )
    for key, value in updates.items():
        setattr(subtype, key, value)
    db.commit()
    db.refresh(subtype)
    return subtype


@router.delete("/subtypes/{sub_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_house_subtype(sub_type_id: int, db: Session = Depends(get_db)) -> None:
    subtype = db.get(HouseSubType, sub_type_id)
    if not subtype:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House subtype not found")
    db.delete(subtype)
    db.commit()
