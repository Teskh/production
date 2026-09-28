from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin_page
from app.models.admin import AdminDashboardPermission, AdminUser
from app.models.enums import AdminRole
from app.services.project_costs import build_cost_data

router = APIRouter()


def require_cost_dashboard(
    admin: AdminUser = Depends(require_admin_page('dashboards')),
    db: Session = Depends(get_db),
):
    roles = list(db.scalars(select(AdminDashboardPermission.role).where(
        AdminDashboardPermission.dashboard_id == 'project-costs')))
    if str(admin.role).strip() != AdminRole.SYSADMIN.value and roles and str(admin.role).strip() not in roles:
        raise HTTPException(status_code=403, detail='Dashboard permission required')
    return admin


@router.get('', dependencies=[Depends(require_cost_dashboard)])
def get_project_costs(start: date | None = None, end: date | None = None,
                      db: Session = Depends(get_db)):
    try:
        return build_cost_data(db, start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
