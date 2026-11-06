from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.schemas.qc_runtime import (
    QCCheckInstanceSummary,
    QCDashboardResponse,
    QCReworkTaskSummary,
)
from app.models.enums import (
    QCCheckKind,
    QCCheckMediaType,
    QCSeverityLevel,
    QCTriggerEventType,
)


class QCCheckCategoryBase(BaseModel):
    name: str
    parent_id: int | None = None
    active: bool = True
    sort_order: int | None = None


class QCCheckCategoryCreate(QCCheckCategoryBase):
    pass


class QCCheckCategoryUpdate(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    active: bool | None = None
    sort_order: int | None = None


class QCCheckCategoryRead(QCCheckCategoryBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class QCCheckDefinitionBase(BaseModel):
    name: str
    active: bool = True
    guidance_text: str | None = None
    version: int = 1
    kind: QCCheckKind
    category_id: int | None = None


class QCCheckDefinitionCreate(QCCheckDefinitionBase):
    pass


class QCCheckDefinitionUpdate(BaseModel):
    name: str | None = None
    active: bool | None = None
    guidance_text: str | None = None
    version: int | None = None
    kind: QCCheckKind | None = None
    category_id: int | None = None
    archived_at: datetime | None = None


class QCCheckDefinitionRead(QCCheckDefinitionBase):
    id: int
    archived_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class QCTriggerBase(BaseModel):
    check_definition_id: int
    event_type: QCTriggerEventType
    params_json: dict | None = None
    sampling_rate: float = 1.0
    sampling_autotune: bool = False
    sampling_step: float = 0.2


class QCTriggerCreate(QCTriggerBase):
    pass


class QCTriggerUpdate(BaseModel):
    check_definition_id: int | None = None
    event_type: QCTriggerEventType | None = None
    params_json: dict | None = None
    sampling_rate: float | None = None
    sampling_autotune: bool | None = None
    sampling_step: float | None = None
    # Explicitly restart the adaptive rate (it is also restarted whenever the base
    # rate or the autotune switch changes).
    reset_current_sampling_rate: bool | None = None


class QCTriggerRead(QCTriggerBase):
    id: int
    current_sampling_rate: float | None = None

    model_config = ConfigDict(from_attributes=True)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def effective_sampling_rate(self) -> float:
        if self.sampling_autotune and self.current_sampling_rate is not None:
            return self.current_sampling_rate
        return self.sampling_rate


class QCApplicabilityBase(BaseModel):
    check_definition_id: int
    house_type_ids: list[int] = Field(default_factory=list)
    sub_type_ids: list[int] = Field(default_factory=list)
    panel_groups: list[str] = Field(default_factory=list)


class QCApplicabilityCreate(QCApplicabilityBase):
    pass


class QCApplicabilityUpdate(BaseModel):
    check_definition_id: int | None = None
    house_type_ids: list[int] | None = None
    sub_type_ids: list[int] | None = None
    panel_groups: list[str] | None = None


class QCApplicabilityRead(QCApplicabilityBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class QCFailureModeDefinitionBase(BaseModel):
    check_definition_id: int | None = None
    name: str
    description: str | None = None
    default_severity_level: QCSeverityLevel | None = None
    default_rework_description: str | None = None
    created_by_user_id: int | None = None


class QCFailureModeDefinitionCreate(QCFailureModeDefinitionBase):
    pass


class QCFailureModeDefinitionUpdate(BaseModel):
    check_definition_id: int | None = None
    name: str | None = None
    description: str | None = None
    default_severity_level: QCSeverityLevel | None = None
    default_rework_description: str | None = None
    created_by_user_id: int | None = None
    archived_at: datetime | None = None


class QCFailureModeDefinitionRead(QCFailureModeDefinitionBase):
    id: int
    archived_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class QCCheckMediaAssetBase(BaseModel):
    check_definition_id: int
    media_type: QCCheckMediaType
    uri: str
    created_at: datetime | None = None


class QCCheckMediaAssetRead(QCCheckMediaAssetBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# QC dashboard extensions (runtime summaries live in app.schemas.qc_runtime)
# ---------------------------------------------------------------------------


class QCDashboardCheckSummary(QCCheckInstanceSummary):
    # Panel check still open while its module already entered assembly.
    module_in_assembly: bool = False


class QCDashboardReworkSummary(QCReworkTaskSummary):
    # Panel rework whose panel already left the panel line.
    panel_off_line: bool = False


class QCTriggerTaskIssue(BaseModel):
    task_definition_id: int
    task_name: str | None = None
    reason: str  # "archived" | "inactive" | "missing"


class QCTriggerTaskWarning(BaseModel):
    check_definition_id: int
    check_name: str
    # True when no referenced task can complete anymore (the check never opens).
    blocked: bool = False
    tasks: list[QCTriggerTaskIssue] = Field(default_factory=list)


class QCDashboardResponseV2(QCDashboardResponse):
    pending_checks: list[QCDashboardCheckSummary]
    rework_tasks: list[QCDashboardReworkSummary]
    trigger_warnings: list[QCTriggerTaskWarning] = Field(default_factory=list)


class QCWorkUnitCompletionPreview(BaseModel):
    work_unit_id: int
    open_checks: int = 0
    open_reworks: int = 0
    open_tasks: int = 0


class QCWorkUnitCompletionRequest(BaseModel):
    # Close open checks and cancel open reworks as part of completing the module.
    resolve_open_items: bool = False


class QCWorkUnitCompletionResult(QCWorkUnitCompletionPreview):
    closed_checks: int = 0
    canceled_reworks: int = 0
    closed_tasks: int = 0


# ---------------------------------------------------------------------------
# QC complaints: supervisor reassignment and forced closure
# ---------------------------------------------------------------------------


class QCComplaintSupervisorsUpdate(BaseModel):
    supervisor_ids: list[int]
    message: str | None = None


class QCComplaintForceClose(BaseModel):
    message: str


class QCReworkCancelRequest(BaseModel):
    reason: str
