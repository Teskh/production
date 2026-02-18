from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_db
from app.models.admin import AdminUser
from app.models.enums import StationRole
from app.models.stations import Station
from app.schemas.stations import StationCreate, StationRead, StationUpdate

router = APIRouter()


@router.get("/", response_model=list[StationRead])
def list_stations(db: Session = Depends(get_db)) -> list[Station]:
    return list(db.execute(select(Station).order_by(Station.id)).scalars())


def _validate_station_payload(
    *,
    role: StationRole,
    line_type: str | None,
    sequence_order: int | None,
) -> None:
    if role == StationRole.ASSEMBLY:
        if line_type is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Assembly stations require a line type",
            )
    else:
        if line_type is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Line type is only allowed for assembly stations",
            )
    if role == StationRole.AUX:
        if sequence_order is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Aux stations must not have a sequence order",
            )
    else:
        if sequence_order is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sequence order is required for non-aux stations",
            )
        if sequence_order <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sequence order must be a positive number",
            )


def _normalize_camera_feed_ip(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


@router.post("/", response_model=StationRead, status_code=status.HTTP_201_CREATED)
def create_station(
    payload: StationCreate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> Station:
    payload.camera_feed_ip = _normalize_camera_feed_ip(payload.camera_feed_ip)
    _validate_station_payload(
        role=payload.role,
        line_type=payload.line_type.value if payload.line_type else None,
        sequence_order=payload.sequence_order,
    )
    station = Station(**payload.model_dump())
    db.add(station)
    db.commit()
    db.refresh(station)
    return station


@router.get("/{station_id}", response_model=StationRead)
def get_station(station_id: int, db: Session = Depends(get_db)) -> Station:
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    return station


@router.put("/{station_id}", response_model=StationRead)
def update_station(
    station_id: int,
    payload: StationUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> Station:
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    updates = payload.model_dump(exclude_unset=True)
    if "camera_feed_ip" in updates:
        updates["camera_feed_ip"] = _normalize_camera_feed_ip(updates["camera_feed_ip"])
    role = updates.get("role", station.role)
    line_type = updates.get("line_type", station.line_type)
    sequence_order = updates.get("sequence_order", station.sequence_order)
    _validate_station_payload(
        role=role,
        line_type=line_type.value if line_type else None,
        sequence_order=sequence_order,
    )
    for key, value in updates.items():
        setattr(station, key, value)
    db.commit()
    db.refresh(station)
    return station


@router.delete("/{station_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_station(
    station_id: int,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> None:
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    db.delete(station)
    db.commit()
