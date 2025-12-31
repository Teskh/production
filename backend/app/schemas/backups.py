from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class BackupRecord(BaseModel):
    filename: str
    size_bytes: int
    created_at: datetime
    label: str | None = None


class BackupSettings(BaseModel):
    enabled: bool = False
    interval_minutes: int = Field(ge=1)
    retention_count: int = Field(ge=1)
    last_backup_at: datetime | None = None


class BackupSettingsUpdate(BaseModel):
    enabled: bool | None = None
    interval_minutes: int | None = Field(default=None, ge=1)
    retention_count: int | None = Field(default=None, ge=1)


class BackupCreateRequest(BaseModel):
    label: str | None = None


class BackupCreateResponse(BaseModel):
    backup: BackupRecord
    settings: BackupSettings
    pruned: list[str] = []


class BackupRestoreRequest(BaseModel):
    filename: str
    force_disconnect: bool = True


class BackupRestoreResponse(BaseModel):
    primary_db: str
    archived_db: str
    restored_from: str
    checkpoint_backup: BackupRecord
    pruned: list[str] = []
