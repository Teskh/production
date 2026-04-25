from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_db
from app.models.admin import AdminDashboardPermission, AdminUser
from app.models.enums import AdminRole
from app.schemas.admin import (
    AdminDashboardPermissionRead,
    AdminDashboardPermissionUpdate,
)

router = APIRouter()


def _require_sysadmin(actor: AdminUser) -> None:
    if str(getattr(actor, "role", "")).strip() != AdminRole.SYSADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SysAdmin role required",
        )


def _normalize_roles(roles: list[str]) -> list[str]:
    normalized: list[str] = []
    for role in roles:
        value = str(role).strip()
        if not value or value in normalized:
            continue
        normalized.append(value)
    return normalized


@router.get("/dashboard-permissions", response_model=list[AdminDashboardPermissionRead])
def list_dashboard_permissions(
    _admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> list[AdminDashboardPermissionRead]:
    rows = (
        db.execute(
            select(AdminDashboardPermission).order_by(
                AdminDashboardPermission.dashboard_id,
                AdminDashboardPermission.role,
            )
        )
        .scalars()
        .all()
    )

    grouped: dict[str, list[str]] = {}
    for row in rows:
        grouped.setdefault(row.dashboard_id, []).append(row.role)

    return [
        AdminDashboardPermissionRead(dashboard_id=dashboard_id, roles=roles)
        for dashboard_id, roles in grouped.items()
    ]


@router.put(
    "/dashboard-permissions/{dashboard_id}",
    response_model=AdminDashboardPermissionRead,
)
def update_dashboard_permissions(
    dashboard_id: str,
    payload: AdminDashboardPermissionUpdate,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminDashboardPermissionRead:
    _require_sysadmin(admin)

    normalized_dashboard_id = dashboard_id.strip()
    if not normalized_dashboard_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="dashboard_id is required")

    roles = _normalize_roles(payload.roles)
    db.execute(
        delete(AdminDashboardPermission).where(
            AdminDashboardPermission.dashboard_id == normalized_dashboard_id
        )
    )
    db.add_all(
        [
            AdminDashboardPermission(dashboard_id=normalized_dashboard_id, role=role)
            for role in roles
        ]
    )
    db.commit()

    return AdminDashboardPermissionRead(dashboard_id=normalized_dashboard_id, roles=roles)
