from pydantic import BaseModel

from app.schemas.workers import WorkerRead


class WorkerSessionLoginRequest(BaseModel):
    worker_id: int
    pin: str | None = None
    station_id: int | None = None


class WorkerSessionStationUpdate(BaseModel):
    station_id: int | None = None


class WorkerSessionRead(BaseModel):
    worker: WorkerRead
    station_id: int | None = None
    require_pin_change: bool = False
    idle_timeout_seconds: int | None = None
