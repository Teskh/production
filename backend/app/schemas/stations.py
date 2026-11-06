from pydantic import BaseModel, ConfigDict

from app.models.enums import StationLineType, StationRole


class StationBase(BaseModel):
    name: str
    line_type: StationLineType | None = None
    sequence_order: int | None = None
    camera_feed_ip: str | None = None
    role: StationRole


class StationCreate(StationBase):
    pass


class StationUpdate(BaseModel):
    name: str | None = None
    line_type: StationLineType | None = None
    sequence_order: int | None = None
    camera_feed_ip: str | None = None
    role: StationRole | None = None


class StationRead(StationBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class StationChangeImpactRead(BaseModel):
    panels_at_station: int = 0
    modules_at_station: int = 0
    # Set when the change (or delete) is refused while panels/modules are at the station.
    blocking_message: str | None = None
    sequence_conflict_station: str | None = None
    routed_task_count: int = 0
    routed_task_names: list[str] = []
    missing_panel_start: bool = False
    # Spanish, human-readable warnings to confirm before saving.
    warnings: list[str] = []
