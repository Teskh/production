from pydantic import BaseModel, ConfigDict

from app.models.enums import RestrictionType


class WorkerBase(BaseModel):
    geovictoria_id: str | None = None
    geovictoria_identifier: str | None = None
    first_name: str
    last_name: str
    pin: str | None = None
    login_required: bool = True
    active: bool = True
    assigned_station_ids: list[int] | None = None
    supervisor_id: int | None = None


class WorkerCreate(WorkerBase):
    geovictoria_id: str
    geovictoria_identifier: str


class WorkerUpdate(BaseModel):
    geovictoria_id: str | None = None
    geovictoria_identifier: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    pin: str | None = None
    login_required: bool | None = None
    active: bool | None = None
    assigned_station_ids: list[int] | None = None
    supervisor_id: int | None = None


class WorkerRead(WorkerBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class WorkerSupervisorBase(BaseModel):
    geovictoria_id: str | None = None
    geovictoria_identifier: str | None = None
    first_name: str
    last_name: str
    pin: str | None = None


class WorkerSupervisorCreate(WorkerSupervisorBase):
    geovictoria_id: str
    geovictoria_identifier: str


class WorkerSupervisorUpdate(BaseModel):
    geovictoria_id: str | None = None
    geovictoria_identifier: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    pin: str | None = None


class WorkerSupervisorRead(WorkerSupervisorBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class SkillBase(BaseModel):
    name: str


class SkillCreate(SkillBase):
    pass


class SkillUpdate(BaseModel):
    name: str | None = None


class SkillRead(SkillBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class SkillAssignment(BaseModel):
    skill_ids: list[int]


class WorkerAssignment(BaseModel):
    worker_ids: list[int]


class WorkerSkillBase(BaseModel):
    worker_id: int
    skill_id: int


class WorkerSkillCreate(WorkerSkillBase):
    pass


class WorkerSkillRead(WorkerSkillBase):
    model_config = ConfigDict(from_attributes=True)


class TaskSkillRequirementBase(BaseModel):
    task_definition_id: int
    skill_id: int


class TaskSkillRequirementCreate(TaskSkillRequirementBase):
    pass


class TaskSkillRequirementRead(TaskSkillRequirementBase):
    model_config = ConfigDict(from_attributes=True)


class TaskWorkerRestrictionBase(BaseModel):
    task_definition_id: int
    worker_id: int
    restriction_type: RestrictionType


class TaskWorkerRestrictionCreate(TaskWorkerRestrictionBase):
    pass


class TaskWorkerRestrictionRead(TaskWorkerRestrictionBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
