from pydantic import BaseModel, ConfigDict


class PanelDefinitionBase(BaseModel):
    house_type_id: int
    module_sequence_number: int
    sub_type_id: int | None = None
    group: str
    panel_code: str
    panel_area: float | None = None
    panel_length_m: float | None = None
    panel_sequence_number: int | None = None
    applicable_task_ids: list[int] | None = None
    task_durations_json: list[float] | None = None


class PanelDefinitionCreate(PanelDefinitionBase):
    pass


class PanelDefinitionUpdate(BaseModel):
    house_type_id: int | None = None
    module_sequence_number: int | None = None
    sub_type_id: int | None = None
    group: str | None = None
    panel_code: str | None = None
    panel_area: float | None = None
    panel_length_m: float | None = None
    panel_sequence_number: int | None = None
    applicable_task_ids: list[int] | None = None
    task_durations_json: list[float] | None = None


class PanelDefinitionRead(PanelDefinitionBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
