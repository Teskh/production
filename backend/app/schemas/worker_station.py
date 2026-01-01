from datetime import datetime

from pydantic import BaseModel

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
    started_at: datetime | None = None
    completed_at: datetime | None = None
    notes: str | None = None


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
    recommended: bool = False


class StationSnapshot(BaseModel):
    station: StationRead
    work_items: list[StationWorkItem]
    pause_reasons: list[PauseReasonRead]
    comment_templates: list[CommentTemplateRead]


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
