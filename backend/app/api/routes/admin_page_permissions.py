from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_db
from app.models.admin import AdminPagePermission, AdminUser
from app.models.enums import AdminRole
from app.schemas.admin import (
    AdminPagePermissionRead,
    AdminPagePermissionRole,
    AdminPagePermissionUpdate,
)

router = APIRouter()


def _require_sysadmin(actor: AdminUser) -> None:
    if str(getattr(actor, "role", "")).strip() != AdminRole.SYSADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SysAdmin role required",
        )


def _normalize_permissions(
    permissions: list[AdminPagePermissionRole],
) -> list[AdminPagePermissionRole]:
    normalized: list[AdminPagePermissionRole] = []
    seen: set[str] = set()
    for permission in permissions:
        role = permission.role.strip()
        if not role or role in seen:
            continue
        seen.add(role)
        can_edit = bool(permission.can_edit and permission.can_view)
        normalized.append(
            AdminPagePermissionRole(
                role=role,
                can_view=bool(permission.can_view),
                can_edit=can_edit,
            )
        )
    return normalized


@router.get("/page-permissions", response_model=list[AdminPagePermissionRead])
def list_page_permissions(
    _admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> list[AdminPagePermissionRead]:
    rows = (
        db.execute(
            select(AdminPagePermission).order_by(
                AdminPagePermission.page_id,
                AdminPagePermission.role,
            )
        )
        .scalars()
        .all()
    )

    grouped: dict[str, list[AdminPagePermissionRole]] = {}
    for row in rows:
        grouped.setdefault(row.page_id, []).append(
            AdminPagePermissionRole(
                role=row.role,
                can_view=row.can_view,
                can_edit=row.can_edit,
            )
        )

    return [
        AdminPagePermissionRead(page_id=page_id, permissions=permissions)
        for page_id, permissions in grouped.items()
    ]


@router.put("/page-permissions/{page_id}", response_model=AdminPagePermissionRead)
def update_page_permissions(
    page_id: str,
    payload: AdminPagePermissionUpdate,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminPagePermissionRead:
    _require_sysadmin(admin)

    normalized_page_id = page_id.strip()
    if not normalized_page_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="page_id is required")

    permissions = _normalize_permissions(payload.permissions)
    db.execute(
        delete(AdminPagePermission).where(AdminPagePermission.page_id == normalized_page_id)
    )
    db.add_all(
        [
            AdminPagePermission(
                page_id=normalized_page_id,
                role=permission.role,
                can_view=permission.can_view,
                can_edit=permission.can_edit,
            )
            for permission in permissions
        ]
    )
    db.commit()

    return AdminPagePermissionRead(page_id=normalized_page_id, permissions=permissions)
