from datetime import date, datetime

from pydantic import BaseModel, Field

from app.models.enums import (
    PanelUnitStatus,
    QCCheckOrigin,
    QCCheckStatus,
    QCExecutionOutcome,
    QCReworkStatus,
    QCSeverityLevel,
    TaskStatus,
    TaskScope,
    WorkUnitStatus,
)


class QCCheckInstanceSummary(BaseModel):
    id: int
    check_definition_id: int | None = None
    check_name: str | None = None
    ad_hoc_guidance: str | None = None
    origin: QCCheckOrigin
    scope: TaskScope
    work_unit_id: int
    panel_unit_id: int | None = None
    related_task_instance_id: int | None = None
    station_id: int | None = None
    station_name: str | None = None
    current_station_id: int | None = None
    current_station_name: str | None = None
    module_number: int
    project_name: str | None = None
    house_type_name: str | None = None
    house_identifier: str | None = None
    panel_code: str | None = None
    status: QCCheckStatus
    severity_level: QCSeverityLevel | None = None
    opened_by_user_id: int | None = None
    opened_at: datetime
    closed_at: datetime | None = None


class QCReworkTaskSummary(BaseModel):
    id: int
    check_instance_id: int
    description: str
    status: QCReworkStatus
    check_status: QCCheckStatus | None = None
    severity_level: QCSeverityLevel | None = None
    task_status: TaskStatus | None = None
    work_unit_id: int
    panel_unit_id: int | None = None
    station_id: int | None = None
    station_name: str | None = None
    current_station_id: int | None = None
    current_station_name: str | None = None
    module_number: int
    project_name: str | None = None
    house_type_name: str | None = None
    house_identifier: str | None = None
    panel_code: str | None = None
    created_at: datetime


class QCPlantPanelSummary(BaseModel):
    panel_unit_id: int
    panel_definition_id: int
    work_unit_id: int
    current_station_id: int
    current_station_name: str | None = None
    status: PanelUnitStatus
    module_number: int
    project_name: str | None = None
    house_type_name: str | None = None
    house_identifier: str | None = None
    panel_code: str | None = None


class QCPlantModuleSummary(BaseModel):
    work_unit_id: int
    current_station_id: int
    current_station_name: str | None = None
    status: WorkUnitStatus
    can_mark_completed: bool = False
    module_number: int
    project_name: str | None = None
    house_type_name: str | None = None
    house_identifier: str | None = None


class QCDashboardResponse(BaseModel):
    pending_checks: list[QCCheckInstanceSummary]
    rework_tasks: list[QCReworkTaskSummary]
    plant_panels: list[QCPlantPanelSummary] = Field(default_factory=list)
    plant_modules: list[QCPlantModuleSummary] = Field(default_factory=list)


class QCMetricRange(BaseModel):
    date_from: date
    date_to: date
    timezone: str


class QCMetricCheckSummary(BaseModel):
    total: int
    triggered: int
    not_performed: int
    open: int


class QCMetricObservationSummary(BaseModel):
    total: int
    open: int


class QCMetricModuleSummary(BaseModel):
    work_unit_id: int
    module_number: int
    project_name: str | None = None
    house_identifier: str | None = None
    house_type_name: str | None = None
    triggered_checks: int
    not_performed_checks: int
    open_checks: int
    open_observations: int


class QCQualityMetricsResponse(BaseModel):
    range: QCMetricRange
    checks: QCMetricCheckSummary
    observations: QCMetricObservationSummary
    affected_modules: int
    modules: list[QCMetricModuleSummary] = Field(default_factory=list)


class QCFailureAnalysisSummary(BaseModel):
    executions: int
    failures: int
    passes: int
    waived: int
    failure_rate: float
    affected_modules: int
    repeat_failure_checks: int
    open_reworks: int
    critical_checks: int


class QCFailureRankingItem(BaseModel):
    dimension_id: int | None = None
    name: str
    executions: int
    failures: int
    failure_rate: float


class QCFailureModeMetric(BaseModel):
    failure_mode_definition_id: int | None = None
    name: str
    occurrences: int


class QCFailureSeverityMetric(BaseModel):
    severity: str
    failures: int


class QCDailyFailureMetric(BaseModel):
    date: date
    executions: int
    failures: int
    failure_rate: float


class QCFailureAnalysisResponse(BaseModel):
    range: QCMetricRange
    summary: QCFailureAnalysisSummary
    tasks: list[QCFailureRankingItem] = Field(default_factory=list)
    stations: list[QCFailureRankingItem] = Field(default_factory=list)
    checks: list[QCFailureRankingItem] = Field(default_factory=list)
    failure_modes: list[QCFailureModeMetric] = Field(default_factory=list)
    severities: list[QCFailureSeverityMetric] = Field(default_factory=list)
    daily: list[QCDailyFailureMetric] = Field(default_factory=list)


class QCExecutionFailureModeRead(BaseModel):
    id: int
    failure_mode_definition_id: int | None = None
    failure_mode_name: str | None = None
    other_text: str | None = None
    measurement_json: dict | None = None
    notes: str | None = None


class QCExecutionRead(BaseModel):
    id: int
    check_instance_id: int
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
    execution_id: int
    media_asset_id: int
    uri: str
    mime_type: str | None = None
    captured_at: datetime


class QCEvidenceUploadRead(BaseModel):
    id: int
    client_upload_id: str
    uri: str
    mime_type: str
    size_bytes: int
    created_at: datetime


class QCTaskParticipantSummary(BaseModel):
    worker_id: int
    worker_name: str


class QCTaskInstanceWithWorkersSummary(BaseModel):
    task_instance_id: int
    task_definition_id: int
    task_name: str
    station_id: int | None = None
    station_name: str | None = None
    status: TaskStatus
    started_at: datetime | None = None
    completed_at: datetime | None = None
    workers: list[QCTaskParticipantSummary] = Field(default_factory=list)


class QCReworkAttemptSummary(BaseModel):
    rework_task_id: int
    task_instance_id: int
    station_id: int | None = None
    station_name: str | None = None
    status: TaskStatus
    started_at: datetime | None = None
    completed_at: datetime | None = None
    workers: list[QCTaskParticipantSummary] = Field(default_factory=list)


class QCCheckInstanceDetail(BaseModel):
    check_instance: QCCheckInstanceSummary
    check_definition: QCCheckDefinitionSummary | None = None
    failure_modes: list[QCFailureModeSummary]
    media_assets: list[QCCheckMediaSummary]
    executions: list[QCExecutionRead]
    rework_tasks: list[QCReworkTaskSummary]
    rework_attempts: list[QCReworkAttemptSummary] = Field(default_factory=list)
    evidence: list[QCEvidenceSummary]
    trigger_task: QCTaskInstanceWithWorkersSummary | None = None


class QCExecutionCreate(BaseModel):
    outcome: QCExecutionOutcome
    notes: str | None = None
    severity_level: QCSeverityLevel | None = None
    failure_mode_ids: list[int] = Field(default_factory=list)
    other_failure_text: str | None = None
    measurement_json: dict | None = None
    failure_mode_notes: str | None = None
    rework_description: str | None = None
    evidence_upload_ids: list[int] = Field(default_factory=list)


class QCManualCheckCreate(BaseModel):
    check_definition_id: int | None = None
    ad_hoc_title: str | None = None
    ad_hoc_guidance: str | None = None
    scope: TaskScope
    work_unit_id: int
    panel_unit_id: int | None = None
    station_id: int | None = None


class QCManualCheckOption(BaseModel):
    id: int
    name: str
    guidance_text: str | None = None
    has_open_instance: bool = False


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
    house_identifier: str | None = None
    project_name: str
    house_type_name: str
    status: str
    open_checks: int
    open_rework: int
    last_outcome: QCExecutionOutcome | None = None
    last_outcome_at: datetime | None = None


class QCLibraryWorkUnitDetail(BaseModel):
    work_unit_id: int
    module_number: int
    house_identifier: str | None = None
    project_name: str
    house_type_name: str
    status: str
    checks: list[QCCheckInstanceSummary]
    executions: list[QCExecutionRead]
    rework_tasks: list[QCReworkTaskSummary]
    evidence: list[QCEvidenceSummary]
