from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

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


class QCTriggerRead(QCTriggerBase):
    id: int
    current_sampling_rate: float | None = None

    model_config = ConfigDict(from_attributes=True)


class QCApplicabilityBase(BaseModel):
    check_definition_id: int
    house_type_id: int | None = None
    sub_type_id: int | None = None
    module_number: int | None = None
    panel_definition_id: int | None = None
    force_required: bool = False
    effective_from: date | None = None
    effective_to: date | None = None


class QCApplicabilityCreate(QCApplicabilityBase):
    pass


class QCApplicabilityUpdate(BaseModel):
    check_definition_id: int | None = None
    house_type_id: int | None = None
    sub_type_id: int | None = None
    module_number: int | None = None
    panel_definition_id: int | None = None
    force_required: bool | None = None
    effective_from: date | None = None
    effective_to: date | None = None


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
