from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.admin import AdminUser
from app.models.enums import AdminRole

SYSADMIN_FIRST_NAME = "sysadmin"
SYSADMIN_LAST_NAME = "sysadmin"


def ensure_sysadmin_user(db: Session) -> AdminUser:
    admin = (
        db.execute(
            select(AdminUser)
            .where(AdminUser.first_name == SYSADMIN_FIRST_NAME)
            .where(AdminUser.last_name == SYSADMIN_LAST_NAME)
        )
        .scalars()
        .first()
    )
    if admin:
        return admin
    admin = AdminUser(
        first_name=SYSADMIN_FIRST_NAME,
        last_name=SYSADMIN_LAST_NAME,
        pin="",
        role=AdminRole.SYSADMIN.value,
        active=True,
    )
    db.add(admin)
    db.flush()
    db.refresh(admin)
    return admin
