from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.stations import Station
from app.schemas.stations import StationCreate, StationRead, StationUpdate

router = APIRouter()


@router.get("/", response_model=list[StationRead])
def list_stations(db: Session = Depends(get_db)) -> list[Station]:
    return list(db.execute(select(Station).order_by(Station.id)).scalars())


@router.post("/", response_model=StationRead, status_code=status.HTTP_201_CREATED)
def create_station(payload: StationCreate, db: Session = Depends(get_db)) -> Station:
    station = Station(**payload.model_dump())
    db.add(station)
    db.commit()
    db.refresh(station)
    return station


@router.get("/{station_id}", response_model=StationRead)
def get_station(station_id: str, db: Session = Depends(get_db)) -> Station:
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    return station


@router.put("/{station_id}", response_model=StationRead)
def update_station(
    station_id: str, payload: StationUpdate, db: Session = Depends(get_db)
) -> Station:
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(station, key, value)
    db.commit()
    db.refresh(station)
    return station


@router.delete("/{station_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_station(station_id: str, db: Session = Depends(get_db)) -> None:
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    db.delete(station)
    db.commit()
