from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import (
    QCCheckOrigin,
    QCCheckStatus,
    QCExecutionOutcome,
    QCReworkStatus,
    QCSeverityLevel,
    TaskScope,
)


class QCCheckInstanceSummary(BaseModel):
    id: int
    check_definition_id: int | None = None
    check_name: str | None = None
    origin: QCCheckOrigin
    scope: TaskScope
    work_unit_id: int
    panel_unit_id: int | None = None
    station_id: int | None = None
    station_name: str | None = None
    module_number: int
    panel_code: str | None = None
    status: QCCheckStatus
    severity_level: QCSeverityLevel | None = None
    opened_at: datetime


class QCReworkTaskSummary(BaseModel):
    id: int
    check_instance_id: int
    description: str
    status: QCReworkStatus
    work_unit_id: int
    panel_unit_id: int | None = None
    station_id: int | None = None
    station_name: str | None = None
    module_number: int
    panel_code: str | None = None
    created_at: datetime


class QCDashboardResponse(BaseModel):
    pending_checks: list[QCCheckInstanceSummary]
    rework_tasks: list[QCReworkTaskSummary]


class QCExecutionFailureModeRead(BaseModel):
    id: int
    failure_mode_definition_id: int | None = None
    failure_mode_name: str | None = None
    other_text: str | None = None
    measurement_json: dict | None = None
    notes: str | None = None


class QCExecutionRead(BaseModel):
    id: int
    outcome: QCExecutionOutcome
    notes: str | None = None
    performed_by_user_id: int
    performed_at: datetime
    failure_modes: list[QCExecutionFailureModeRead] = Field(default_factory=list)


class QCCheckDefinitionSummary(BaseModel):
    id: int
    name: str
    guidance_text: str | None = None
    category_id: int | None = None


class QCFailureModeSummary(BaseModel):
    id: int
    check_definition_id: int | None = None
    name: str
    description: str | None = None
    default_severity_level: QCSeverityLevel | None = None
    default_rework_description: str | None = None


class QCCheckMediaSummary(BaseModel):
    id: int
    media_type: str
    uri: str
    created_at: datetime | None = None


class QCEvidenceSummary(BaseModel):
    id: int
    media_asset_id: int
    uri: str
    captured_at: datetime


class QCCheckInstanceDetail(BaseModel):
    check_instance: QCCheckInstanceSummary
    check_definition: QCCheckDefinitionSummary | None = None
    failure_modes: list[QCFailureModeSummary]
    media_assets: list[QCCheckMediaSummary]
    executions: list[QCExecutionRead]
    rework_tasks: list[QCReworkTaskSummary]
    evidence: list[QCEvidenceSummary]


class QCExecutionCreate(BaseModel):
    outcome: QCExecutionOutcome
    notes: str | None = None
    severity_level: QCSeverityLevel | None = None
    failure_mode_ids: list[int] = Field(default_factory=list)
    other_failure_text: str | None = None
    measurement_json: dict | None = None
    failure_mode_notes: str | None = None
    rework_description: str | None = None


class QCManualCheckCreate(BaseModel):
    check_definition_id: int | None = None
    ad_hoc_title: str | None = None
    ad_hoc_guidance: str | None = None
    scope: TaskScope
    work_unit_id: int
    panel_unit_id: int | None = None
    station_id: int | None = None


class QCReworkStartRequest(BaseModel):
    worker_ids: list[int] | None = None
    station_id: int | None = None


class QCReworkPauseRequest(BaseModel):
    reason_id: int | None = None
    reason_text: str | None = None


class QCNotificationSummary(BaseModel):
    id: int
    worker_id: int
    rework_task_id: int
    status: str
    created_at: datetime
    seen_at: datetime | None = None
    module_number: int
    panel_code: str | None = None
    station_name: str | None = None
    description: str


class QCLibraryWorkUnitSummary(BaseModel):
    work_unit_id: int
    module_number: int
    house_type_name: str
    status: str
    open_checks: int
    open_rework: int
    last_outcome: QCExecutionOutcome | None = None
    last_outcome_at: datetime | None = None


class QCLibraryWorkUnitDetail(BaseModel):
    work_unit_id: int
    module_number: int
    house_type_name: str
    status: str
    checks: list[QCCheckInstanceSummary]
    executions: list[QCExecutionRead]
    rework_tasks: list[QCReworkTaskSummary]
    evidence: list[QCEvidenceSummary]
