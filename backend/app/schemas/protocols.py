from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ProtocolSupervisorSummary(BaseModel):
    id: int
    first_name: str
    last_name: str
    geovictoria_identifier: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ProtocolSupervisorSignatureStatusRead(BaseModel):
    supervisor: ProtocolSupervisorSummary
    signed: bool
    signed_name: str | None = None
    signed_at: datetime | None = None


class ProtocolSupervisorSessionLoginRequest(BaseModel):
    supervisor_id: int
    pin: str


class ProtocolSupervisorSessionRead(BaseModel):
    supervisor: ProtocolSupervisorSummary
    pending_protocol_count: int


class SafetyProtocolSignatureRead(BaseModel):
    id: int
    protocol_version_id: int
    supervisor_id: int
    signed_name: str
    signed_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SafetyProtocolSignRequest(BaseModel):
    signed_name: str
    pin: str


class SafetyProtocolVersionSummaryRead(BaseModel):
    id: int
    version_number: int
    change_summary: str | None = None
    created_at: datetime
    document_count: int


class SafetyProtocolDocumentRead(BaseModel):
    id: int
    original_filename: str
    uri: str
    mime_type: str
    size_bytes: int
    uploaded_at: datetime
    preview_text: str | None = None

    model_config = ConfigDict(from_attributes=True)


class SafetyProtocolDiffEntryRead(BaseModel):
    kind: str
    document_name: str
    added_lines: int = 0
    removed_lines: int = 0
    diff_excerpt: str | None = None


class SafetyProtocolSummaryRead(BaseModel):
    id: int
    title: str
    description: str | None = None
    active: bool = True
    latest_version: SafetyProtocolVersionSummaryRead | None = None
    applicable_supervisor_count: int = 0
    is_applicable_to_current_supervisor: bool = False
    has_signed_latest_version: bool = False
    requires_signature: bool = False


class SafetyProtocolDetailRead(SafetyProtocolSummaryRead):
    applicable_supervisors: list[ProtocolSupervisorSummary] = []
    latest_signature_statuses: list[ProtocolSupervisorSignatureStatusRead] = []
    latest_documents: list[SafetyProtocolDocumentRead] = []
    previous_version_number: int | None = None
    diff_entries: list[SafetyProtocolDiffEntryRead] = []
    current_supervisor_signature: SafetyProtocolSignatureRead | None = None
    latest_signed_supervisor_count: int = 0


class SafetyProtocolUpdate(BaseModel):
    title: str
    description: str | None = None
    applicable_supervisor_ids: list[int] = []
