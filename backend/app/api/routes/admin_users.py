from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_db
from app.models.admin import AdminUser
from app.models.enums import AdminRole
from app.schemas.admin import AdminUserCreate, AdminUserRead, AdminUserUpdate
from app.services.admin_bootstrap import SYSADMIN_FIRST_NAME, SYSADMIN_LAST_NAME

router = APIRouter()


def _is_protected_sysadmin(target: AdminUser) -> bool:
    return (
        target.first_name.strip().lower() == SYSADMIN_FIRST_NAME
        and target.last_name.strip().lower() == SYSADMIN_LAST_NAME
    )


def _require_sysadmin(actor: AdminUser) -> None:
    if str(getattr(actor, "role", "")).strip() != AdminRole.SYSADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SysAdmin role required",
        )


@router.get("/users", response_model=list[AdminUserRead])
def list_admin_users(
    _admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> list[AdminUser]:
    return list(
        db.execute(select(AdminUser).order_by(AdminUser.last_name, AdminUser.first_name))
        .scalars()
        .all()
    )


@router.get("/roles", response_model=list[str])
def list_admin_roles(
    _admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> list[str]:
    known = [role.value for role in AdminRole]
    rows = db.execute(select(func.distinct(AdminUser.role))).scalars().all()
    dynamic = [row for row in rows if row]
    merged: list[str] = []
    for role in known + dynamic:
        normalized = str(role).strip()
        if not normalized:
            continue
        if normalized not in merged:
            merged.append(normalized)
    return merged


@router.post("/users", response_model=AdminUserRead, status_code=status.HTTP_201_CREATED)
def create_admin_user(
    payload: AdminUserCreate,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminUser:
    _require_sysadmin(admin)

    first_name = payload.first_name.strip()
    last_name = payload.last_name.strip()
    if not first_name or not last_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="first_name and last_name are required",
        )
    pin = payload.pin.strip()
    if not pin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="pin is required")

    user = AdminUser(
        first_name=first_name,
        last_name=last_name,
        pin=pin,
        role=payload.role.strip() or AdminRole.ADMIN.value,
        active=payload.active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}", response_model=AdminUserRead)
def update_admin_user(
    user_id: int,
    payload: AdminUserUpdate,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminUser:
    _require_sysadmin(admin)

    user = db.get(AdminUser, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin user not found")
    if _is_protected_sysadmin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Protected sysadmin user cannot be modified",
        )

    if payload.first_name is not None:
        first_name = payload.first_name.strip()
        if not first_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="first_name is required"
            )
        user.first_name = first_name
    if payload.last_name is not None:
        last_name = payload.last_name.strip()
        if not last_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="last_name is required"
            )
        user.last_name = last_name
    if payload.pin is not None:
        pin = payload.pin.strip()
        if not pin:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="pin is required")
        user.pin = pin
    if payload.role is not None:
        role = payload.role.strip()
        if not role:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="role is required")
        user.role = role
    if payload.active is not None:
        user.active = payload.active

    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_user(
    user_id: int,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> None:
    _require_sysadmin(admin)

    user = db.get(AdminUser, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin user not found")
    if _is_protected_sysadmin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Protected sysadmin user cannot be deleted",
        )
    db.delete(user)
    db.commit()
