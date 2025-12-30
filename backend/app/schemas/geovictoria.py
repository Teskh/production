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
