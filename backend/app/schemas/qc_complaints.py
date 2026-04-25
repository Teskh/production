from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import (
    QCComplaintActorType,
    QCComplaintEventType,
    QCComplaintMediaRole,
    QCComplaintStatus,
    QCNotificationStatus,
    QCSeverityLevel,
)


class QCComplaintSupervisorRead(BaseModel):
    id: int
    first_name: str
    last_name: str


class QCComplaintMediaRead(BaseModel):
    id: int
    event_id: int | None = None
    media_asset_id: int
    role: QCComplaintMediaRole
    uri: str
    mime_type: str
    created_at: datetime


class QCComplaintEventRead(BaseModel):
    id: int
    complaint_id: int
    actor_type: QCComplaintActorType
    actor_user_id: int | None = None
    actor_supervisor_id: int | None = None
    actor_name: str | None = None
    event_type: QCComplaintEventType
    message: str | None = None
    created_at: datetime
    media: list[QCComplaintMediaRead] = Field(default_factory=list)


class QCComplaintSummary(BaseModel):
    id: int
    work_unit_id: int
    panel_unit_id: int | None = None
    station_id: int | None = None
    station_name: str | None = None
    title: str
    description: str
    severity_level: QCSeverityLevel
    status: QCComplaintStatus
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
    closure_proposed_at: datetime | None = None
    closed_at: datetime | None = None
    module_number: int
    house_identifier: str | None = None
    project_name: str
    house_type_name: str
    panel_code: str | None = None
    supervisors: list[QCComplaintSupervisorRead] = Field(default_factory=list)
    media_count: int = 0
    event_count: int = 0
    latest_event_at: datetime | None = None


class QCComplaintDetail(QCComplaintSummary):
    events: list[QCComplaintEventRead]


class QCComplaintCreate(BaseModel):
    work_unit_id: int
    panel_unit_id: int | None = None
    station_id: int | None = None
    title: str
    description: str
    severity_level: QCSeverityLevel
    supervisor_ids: list[int] = Field(default_factory=list)


class QCComplaintEventCreate(BaseModel):
    message: str | None = None


class QCComplaintClosureReview(BaseModel):
    message: str | None = None


class QCComplaintNotificationRead(BaseModel):
    id: int
    complaint_id: int
    supervisor_id: int
    event_id: int | None = None
    status: QCNotificationStatus
    created_at: datetime
    seen_at: datetime | None = None
