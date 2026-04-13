from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import TaskScope, TaskStatus


class TaskCorrectionTargetSummary(BaseModel):
    task_instance_id: int
    task_definition_id: int
    task_name: str
    scope: TaskScope
    status: TaskStatus
    work_unit_id: int
    panel_unit_id: int | None = None
    station_id: int
    started_at: datetime | None = None
    completed_at: datetime | None = None


class TaskCorrectionDeleteCounts(BaseModel):
    participations: int = 0
    pauses: int = 0
    adherence_facts: int = 0
    qc_checks: int = 0
    qc_executions: int = 0
    qc_rework_tasks: int = 0
    qc_notifications: int = 0


class TaskCorrectionPreview(BaseModel):
    task: TaskCorrectionTargetSummary
    eligible: bool
    correction_kind: str | None = None
    rollback_applied: bool = False
    blocked_reason: str | None = None
    warnings: list[str] = Field(default_factory=list)
    state_changes: list[str] = Field(default_factory=list)
    delete_counts: TaskCorrectionDeleteCounts = Field(
        default_factory=TaskCorrectionDeleteCounts
    )
    correction_window_minutes: int


class TaskCorrectionApplyRequest(BaseModel):
    reason: str | None = None


class TaskCorrectionApplyResponse(BaseModel):
    correction_id: int
    preview: TaskCorrectionPreview


class TaskCorrectionPreviewListRequest(BaseModel):
    task_instance_ids: list[int] = Field(default_factory=list)


class TaskCorrectionPreviewListResponse(BaseModel):
    previews: list[TaskCorrectionPreview] = Field(default_factory=list)


class TaskCorrectionLogRead(BaseModel):
    id: int
    original_task_instance_id: int
    task_definition_id: int
    task_name_snapshot: str
    scope: TaskScope
    status_snapshot: TaskStatus
    work_unit_id: int
    panel_unit_id: int | None = None
    station_id: int
    corrected_by_user_id: int
    correction_kind: str
    rollback_applied: bool
    reason: str | None = None
    details_json: dict | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
