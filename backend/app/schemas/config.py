from pydantic import BaseModel, ConfigDict


class PauseReasonBase(BaseModel):
    name: str
    applicable_station_ids: list[int] | None = None
    active: bool = True


class PauseReasonCreate(PauseReasonBase):
    pass


class PauseReasonUpdate(BaseModel):
    name: str | None = None
    applicable_station_ids: list[int] | None = None
    active: bool | None = None


class PauseReasonRead(PauseReasonBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class CommentTemplateBase(BaseModel):
    text: str
    applicable_station_ids: list[int] | None = None
    active: bool = True


class CommentTemplateCreate(CommentTemplateBase):
    pass


class CommentTemplateUpdate(BaseModel):
    text: str | None = None
    applicable_station_ids: list[int] | None = None
    active: bool | None = None


class CommentTemplateRead(CommentTemplateBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
