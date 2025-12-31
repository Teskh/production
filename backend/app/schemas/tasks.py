from pydantic import BaseModel, ConfigDict

from app.models.enums import TaskScope


class TaskDefinitionBase(BaseModel):
    name: str
    scope: TaskScope
    active: bool = True
    skippable: bool = False
    concurrent_allowed: bool = False
    advance_trigger: bool = False
    dependencies_json: list[int] | None = None


class TaskDefinitionCreate(TaskDefinitionBase):
    pass


class TaskDefinitionUpdate(BaseModel):
    name: str | None = None
    scope: TaskScope | None = None
    active: bool | None = None
    skippable: bool | None = None
    concurrent_allowed: bool | None = None
    advance_trigger: bool | None = None
    dependencies_json: list[int] | None = None


class TaskDefinitionRead(TaskDefinitionBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class TaskStationSequence(BaseModel):
    station_sequence_order: int | None = None


class TaskSpecialty(BaseModel):
    skill_id: int | None = None


class TaskAllowedWorkers(BaseModel):
    worker_ids: list[int] | None = None


class TaskRegularCrew(BaseModel):
    worker_ids: list[int] | None = None


class TaskApplicabilityBase(BaseModel):
    task_definition_id: int
    house_type_id: int | None = None
    sub_type_id: int | None = None
    module_number: int | None = None
    panel_definition_id: int | None = None
    station_sequence_order: int | None = None


class TaskApplicabilityCreate(TaskApplicabilityBase):
    pass


class TaskApplicabilityUpdate(BaseModel):
    task_definition_id: int | None = None
    house_type_id: int | None = None
    sub_type_id: int | None = None
    module_number: int | None = None
    panel_definition_id: int | None = None
    station_sequence_order: int | None = None


class TaskApplicabilityRead(TaskApplicabilityBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class TaskExpectedDurationBase(BaseModel):
    task_definition_id: int
    house_type_id: int | None = None
    sub_type_id: int | None = None
    module_number: int | None = None
    panel_definition_id: int | None = None
    expected_minutes: float


class TaskExpectedDurationCreate(TaskExpectedDurationBase):
    pass


class TaskExpectedDurationUpdate(BaseModel):
    task_definition_id: int | None = None
    house_type_id: int | None = None
    sub_type_id: int | None = None
    module_number: int | None = None
    panel_definition_id: int | None = None
    expected_minutes: float | None = None


class TaskExpectedDurationRead(TaskExpectedDurationBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
