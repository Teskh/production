from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.admin import PauseReason
from app.models.stations import Station
from app.schemas.config import PauseReasonCreate, PauseReasonRead, PauseReasonUpdate

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


@router.get("/", response_model=list[PauseReasonRead])
def list_pause_reasons(db: Session = Depends(get_db)) -> list[PauseReason]:
    return list(db.execute(select(PauseReason).order_by(PauseReason.name)).scalars())


@router.post("/", response_model=PauseReasonRead, status_code=status.HTTP_201_CREATED)
def create_pause_reason(
    payload: PauseReasonCreate, db: Session = Depends(get_db)
) -> PauseReason:
    _validate_station_ids(db, payload.applicable_station_ids)
    reason = PauseReason(**payload.model_dump())
    db.add(reason)
    db.commit()
    db.refresh(reason)
    return reason


@router.get("/{reason_id}", response_model=PauseReasonRead)
def get_pause_reason(reason_id: int, db: Session = Depends(get_db)) -> PauseReason:
    reason = db.get(PauseReason, reason_id)
    if not reason:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pause reason not found")
    return reason


@router.put("/{reason_id}", response_model=PauseReasonRead)
def update_pause_reason(
    reason_id: int, payload: PauseReasonUpdate, db: Session = Depends(get_db)
) -> PauseReason:
    reason = db.get(PauseReason, reason_id)
    if not reason:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pause reason not found")
    updates = payload.model_dump(exclude_unset=True)
    if "applicable_station_ids" in updates:
        _validate_station_ids(db, updates["applicable_station_ids"])
    for key, value in updates.items():
        setattr(reason, key, value)
    db.commit()
    db.refresh(reason)
    return reason


@router.delete("/{reason_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pause_reason(reason_id: int, db: Session = Depends(get_db)) -> None:
    reason = db.get(PauseReason, reason_id)
    if not reason:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pause reason not found")
    db.delete(reason)
    db.commit()
