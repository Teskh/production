from pydantic import BaseModel, ConfigDict

from app.models.enums import StationLineType, StationRole


class StationBase(BaseModel):
    name: str
    line_type: StationLineType | None = None
    sequence_order: int | None = None
    role: StationRole


class StationCreate(StationBase):
    pass


class StationUpdate(BaseModel):
    name: str | None = None
    line_type: StationLineType | None = None
    sequence_order: int | None = None
    role: StationRole | None = None


class StationRead(StationBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
