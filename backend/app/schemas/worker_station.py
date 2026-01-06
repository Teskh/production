from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import TaskScope, TaskStatus
from app.schemas.config import CommentTemplateRead, PauseReasonRead
from app.schemas.stations import StationRead


class StationTask(BaseModel):
    task_definition_id: int
    task_instance_id: int | None = None
    name: str
    scope: TaskScope
    station_sequence_order: int | None = None
    status: TaskStatus
    skippable: bool
    concurrent_allowed: bool
    advance_trigger: bool
    dependencies_satisfied: bool = True
    dependencies_missing_names: list[str] = Field(default_factory=list)
    worker_allowed: bool = True
    allowed_worker_names: list[str] = Field(default_factory=list)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    notes: str | None = None
    current_worker_participating: bool = False
    backlog: bool = False


class StationWorkItem(BaseModel):
    id: str
    scope: TaskScope
    work_unit_id: int
    panel_unit_id: int | None = None
    panel_definition_id: int | None = None
    module_number: int
    project_name: str
    house_identifier: str
    house_type_name: str
    sub_type_name: str | None = None
    panel_code: str | None = None
    status: str
    tasks: list[StationTask]
    other_tasks: list[StationTask]
    backlog_tasks: list[StationTask] = Field(default_factory=list)
    recommended: bool = False


class StationQCReworkTask(BaseModel):
    id: int
    check_instance_id: int
    check_name: str | None = None
    description: str
    status: str
    work_unit_id: int
    panel_unit_id: int | None = None
    module_number: int
    panel_code: str | None = None
    station_id: int | None = None
    created_at: datetime
    failure_notes: str | None = None
    failure_modes: list[str] = Field(default_factory=list)
    evidence_uris: list[str] = Field(default_factory=list)


class StationSnapshot(BaseModel):
    station: StationRead
    work_items: list[StationWorkItem]
    pause_reasons: list[PauseReasonRead]
    comment_templates: list[CommentTemplateRead]
    worker_active_nonconcurrent_task_instance_ids: list[int] = Field(default_factory=list)
    qc_rework_tasks: list[StationQCReworkTask] = Field(default_factory=list)
    qc_notification_count: int = 0


class TaskStartRequest(BaseModel):
    task_definition_id: int
    scope: TaskScope
    work_unit_id: int
    panel_unit_id: int | None = None
    panel_definition_id: int | None = None
    station_id: int
    worker_ids: list[int] | None = None


class TaskPauseRequest(BaseModel):
    task_instance_id: int
    reason_id: int | None = None
    reason_text: str | None = None


class TaskJoinRequest(BaseModel):
    task_instance_id: int


class TaskResumeRequest(BaseModel):
    task_instance_id: int


class TaskCompleteRequest(BaseModel):
    task_instance_id: int
    notes: str | None = None


class TaskSkipRequest(BaseModel):
    task_definition_id: int
    scope: TaskScope
    work_unit_id: int
    panel_unit_id: int | None = None
    station_id: int
    reason_text: str | None = None


class TaskNoteRequest(BaseModel):
    task_instance_id: int
    notes: str
