from datetime import datetime

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
    task_durations_json: list[float | None] | None = None


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
    task_durations_json: list[float | None] | None = None


class PanelDefinitionRead(PanelDefinitionBase):
    id: int
    archived_at: datetime | None = None
    archived_by_user_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


class PanelDefinitionUsageRead(BaseModel):
    task_instances: int
    qc_checks: int
