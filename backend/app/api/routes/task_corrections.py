from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_db
from app.models.admin import AdminUser
from app.schemas.task_corrections import (
    TaskCorrectionApplyRequest,
    TaskCorrectionApplyResponse,
    TaskCorrectionPreview,
    TaskCorrectionPreviewListRequest,
    TaskCorrectionPreviewListResponse,
)
from app.services.task_corrections import (
    apply_task_correction,
    build_task_correction_preview,
    build_task_correction_previews,
)

router = APIRouter()


@router.get("/{task_instance_id}/preview", response_model=TaskCorrectionPreview)
def preview_task_correction(
    task_instance_id: int,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> TaskCorrectionPreview:
    return build_task_correction_preview(db, task_instance_id)


@router.post("/previews", response_model=TaskCorrectionPreviewListResponse)
def preview_task_corrections(
    payload: TaskCorrectionPreviewListRequest,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> TaskCorrectionPreviewListResponse:
    return build_task_correction_previews(db, payload.task_instance_ids)


@router.post("/{task_instance_id}/apply", response_model=TaskCorrectionApplyResponse)
def apply_task_correction_route(
    task_instance_id: int,
    payload: TaskCorrectionApplyRequest,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
) -> TaskCorrectionApplyResponse:
    return apply_task_correction(
        db,
        task_instance_id,
        admin,
        reason=payload.reason,
    )
