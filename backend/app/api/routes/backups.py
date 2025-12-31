from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.schemas.backups import (
    BackupCreateRequest,
    BackupCreateResponse,
    BackupRecord,
    BackupRestoreRequest,
    BackupRestoreResponse,
    BackupSettings,
    BackupSettingsUpdate,
)
from app.services import backups as backup_service

router = APIRouter()


@router.get("/", response_model=list[BackupRecord])
def list_backups() -> list[dict]:
    return backup_service.list_backups()


@router.post("/", response_model=BackupCreateResponse, status_code=status.HTTP_201_CREATED)
def create_backup(payload: BackupCreateRequest) -> BackupCreateResponse:
    try:
        backup, settings, pruned = backup_service.create_backup(payload.label)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return BackupCreateResponse(backup=backup, settings=settings, pruned=pruned)


@router.get("/settings", response_model=BackupSettings)
def get_settings() -> dict:
    return backup_service.load_backup_settings()


@router.put("/settings", response_model=BackupSettings)
def update_settings(payload: BackupSettingsUpdate) -> dict:
    update = payload.model_dump(exclude_unset=True)
    try:
        settings_data = backup_service.update_backup_settings(update)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return settings_data


@router.post("/restore", response_model=BackupRestoreResponse)
def restore_backup(payload: BackupRestoreRequest) -> BackupRestoreResponse:
    try:
        result = backup_service.restore_backup(
            payload.filename, force_disconnect=payload.force_disconnect
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return BackupRestoreResponse(**result)
