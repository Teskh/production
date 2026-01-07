from typing import Any

from pydantic import BaseModel


class GeoVictoriaWorker(BaseModel):
    geovictoria_id: str | None = None
    identifier: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    position: str | None = None
    group: str | None = None
    enabled: bool | None = None


class GeoVictoriaWorkerSummary(BaseModel):
    geovictoria_id: str
    identifier: str
    first_name: str | None = None
    last_name: str | None = None


class GeoVictoriaAttendanceResponse(BaseModel):
    worker_id: int
    worker_first_name: str | None = None
    worker_last_name: str | None = None
    geovictoria_id: str
    geovictoria_identifier: str | None = None
    start_date: str
    end_date: str
    attendance: Any | None = None
    consolidated: Any | None = None
