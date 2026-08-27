from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.api.deps import get_current_admin, require_admin_page, require_sysadmin
from app.core.config import settings
from app.db.session import SessionLocal
from app.models.admin import AdminUser
from app.schemas.backups import (
    BackupCreateRequest,
    BackupCreateResponse,
    BackupRecord,
    BackupRestoreRequest,
    BackupRestoreResponse,
    BackupSettings,
    BackupSettingsUpdate,
    DatabaseSyncResponse,
    DatabaseSyncStatus,
)
from app.services import backups as backup_service
from app.services import company_access
from app.services import database_sync as database_sync_service

router = APIRouter()


def _require_local_sysadmin(request: Request) -> None:
    if not company_access.is_local_development_request(request):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    with SessionLocal() as db:
        admin = get_current_admin(request, db)
        require_sysadmin(admin)


@router.get("/sync-status", response_model=DatabaseSyncStatus)
def get_database_sync_status(request: Request) -> DatabaseSyncStatus:
    _require_local_sysadmin(request)
    return DatabaseSyncStatus(**database_sync_service.database_sync_status())


@router.post("/sync", response_model=DatabaseSyncResponse)
def sync_database_from_production(request: Request) -> DatabaseSyncResponse:
    _require_local_sysadmin(request)
    try:
        result = database_sync_service.sync_from_production()
    except database_sync_service.SyncConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except database_sync_service.SyncDownloadError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    return DatabaseSyncResponse(**result)


@router.post("/sync-export", response_class=FileResponse)
def export_database_for_sync(
    sync_token: Annotated[
        str | None,
        Header(alias=database_sync_service.SYNC_TOKEN_HEADER),
    ] = None,
) -> FileResponse:
    if (
        not settings.database_sync_export_enabled
        or not settings.database_sync_token
        or len(settings.database_sync_token) < 32
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    if not database_sync_service.export_is_authorized(sync_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid database sync token.",
        )
    try:
        dump_path = database_sync_service.create_export_dump()
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    return FileResponse(
        path=dump_path,
        media_type="application/octet-stream",
        filename="production_database.dump",
        background=BackgroundTask(
            database_sync_service.remove_temporary_dump,
            dump_path,
        ),
    )

@router.get("", response_model=list[BackupRecord])
def list_backups(
    _admin: AdminUser = Depends(require_admin_page("backups")),
) -> list[dict]:
    return backup_service.list_backups()


@router.post("", response_model=BackupCreateResponse, status_code=status.HTTP_201_CREATED)
def create_backup(
    payload: BackupCreateRequest,
    _admin: AdminUser = Depends(require_admin_page("backups", edit=True)),
) -> BackupCreateResponse:
    try:
        backup, settings, pruned = backup_service.create_backup(payload.label)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return BackupCreateResponse(backup=backup, settings=settings, pruned=pruned)


@router.get("/settings", response_model=BackupSettings)
def get_settings(
    _admin: AdminUser = Depends(require_admin_page("backups")),
) -> dict:
    return backup_service.load_backup_settings()


@router.put("/settings", response_model=BackupSettings)
def update_settings(
    payload: BackupSettingsUpdate,
    _admin: AdminUser = Depends(require_admin_page("backups", edit=True)),
) -> dict:
    update = payload.model_dump(exclude_unset=True)
    try:
        settings_data = backup_service.update_backup_settings(update)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return settings_data


@router.post("/restore", response_model=BackupRestoreResponse)
def restore_backup(
    payload: BackupRestoreRequest,
    _admin: AdminUser = Depends(require_admin_page("backups", edit=True)),
) -> BackupRestoreResponse:
    try:
        result = backup_service.restore_backup(
            payload.filename, force_disconnect=payload.force_disconnect
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return BackupRestoreResponse(**result)
