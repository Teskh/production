from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import TaskScope, TaskStatus


class TaskDefinitionBase(BaseModel):
    name: str
    scope: TaskScope
    default_station_sequence: int | None = None
    active: bool = True
    skippable: bool = False
    concurrent_allowed: bool = False
    advance_trigger: bool = False
    is_rework: bool = False
    dependencies_json: list[int] | None = None


class TaskDefinitionCreate(TaskDefinitionBase):
    pass


class TaskDefinitionUpdate(BaseModel):
    name: str | None = None
    scope: TaskScope | None = None
    default_station_sequence: int | None = None
    active: bool | None = None
    skippable: bool | None = None
    concurrent_allowed: bool | None = None
    advance_trigger: bool | None = None
    is_rework: bool | None = None
    dependencies_json: list[int] | None = None


class TaskDefinitionRead(TaskDefinitionBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


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
    applies: bool = True
    station_sequence_order: int | None = None


class TaskApplicabilityCreate(TaskApplicabilityBase):
    pass


class TaskApplicabilityUpdate(BaseModel):
    task_definition_id: int | None = None
    house_type_id: int | None = None
    sub_type_id: int | None = None
    module_number: int | None = None
    panel_definition_id: int | None = None
    applies: bool | None = None
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


class TaskInstanceRead(BaseModel):
    id: int
    task_definition_id: int
    scope: TaskScope
    work_unit_id: int
    panel_unit_id: int | None = None
    station_id: int
    rework_task_id: int | None = None
    status: TaskStatus
    started_at: datetime | None = None
    completed_at: datetime | None = None
    notes: str | None = None

    model_config = ConfigDict(from_attributes=True)


class WorkerActiveTaskRead(BaseModel):
    task_instance_id: int
    station_id: int
    current_station_id: int | None = None
    work_unit_id: int
    panel_unit_id: int | None = None
    module_number: int | None = None
    panel_code: str | None = None
    status: TaskStatus
    started_at: datetime | None = None
