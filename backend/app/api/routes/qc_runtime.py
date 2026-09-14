from __future__ import annotations

import shutil
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import String, case, cast, delete, exists, func, or_, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import (
    get_current_admin,
    get_current_worker,
    get_db,
)
from app.core.config import BASE_DIR
from app.core.security import utc_now
from app.models.admin import AdminDashboardPermission, AdminUser
from app.models.enums import (
    AdminRole,
    PanelUnitStatus,
    QCCheckOrigin,
    QCCheckStatus,
    QCExecutionOutcome,
    QCNotificationStatus,
    QCReworkStatus,
    StationRole,
    TaskScope,
    TaskStatus,
    WorkUnitStatus,
)
from app.models.house import HouseType, PanelDefinition
from app.models.qc import (
    MediaAsset,
    QCApplicability,
    QCCheckDefinition,
    QCCheckInstance,
    QCCheckMediaAsset,
    QCExecution,
    QCExecutionFailureMode,
    QCEvidenceUpload,
    QCFailureModeDefinition,
    QCEvidence,
    QCNotification,
    QCQualityComplaint,
    QCReworkTask,
)
from app.models.stations import Station
from app.models.tasks import (
    TaskApplicability,
    TaskDefinition,
    TaskInstance,
    TaskParticipation,
    TaskPause,
)
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.models.workers import Worker
from app.schemas.qc_runtime import (
    QCCheckInstanceDetail,
    QCCheckInstanceSummary,
    QCCheckMediaSummary,
    QCCheckDefinitionSummary,
    QCExecutionCreate,
    QCExecutionFailureModeRead,
    QCExecutionRead,
    QCFailureAnalysisResponse,
    QCReworkAttemptSummary,
    QCDashboardResponse,
    QCEvidenceUploadRead,
    QCEvidenceSummary,
    QCFailureModeSummary,
    QCLibraryWorkUnitDetail,
    QCLibraryWorkUnitSummary,
    QCManualCheckCreate,
    QCManualCheckOption,
    QCNotificationSummary,
    QCPlantModuleSummary,
    QCPlantPanelSummary,
    QCQualityMetricsResponse,
    QCTaskInstanceWithWorkersSummary,
    QCTaskParticipantSummary,
    QCReworkPauseRequest,
    QCReworkStartRequest,
    QCReworkTaskSummary,
)
from app.services.qc_runtime import (
    apply_failure_modes,
    create_notifications_for_task,
    enforce_no_active_tasks,
    manual_check_scope_for_status,
    resolve_qc_applicability,
    update_sampling_from_execution,
)
from app.services.qc_excel_report import build_qc_dashboard_excel_report
from app.services.qc_dashboard_metrics import (
    build_qc_metric_window,
    summarize_qc_failure_rows,
    summarize_qc_quality_rows,
)
from app.services.conditions import load_condition_context
from app.services.task_applicability import resolve_task_station_sequence

router = APIRouter()
MEDIA_GALLERY_DIR = BASE_DIR / "media_gallery"
QC_EVIDENCE_DIR = MEDIA_GALLERY_DIR / "qc_evidence"
QC_ROLE_VALUES = {"Calidad", "QC"}
# QC_DELETE_WINDOW = timedelta(hours=48)
MAX_QC_EVIDENCE_BYTES = 50 * 1024 * 1024
QC_EVIDENCE_MIME_PREFIXES = ("image/", "video/")
QC_EVIDENCE_UPLOAD_TTL = timedelta(hours=24)
QC_QUALITY_METRICS_DASHBOARD_ID = "qc-quality-compliance"
QC_FAILURE_ANALYSIS_DASHBOARD_ID = "qc-failure-analysis"


def _require_qc_admin(admin: AdminUser) -> AdminUser:
    if admin.role not in QC_ROLE_VALUES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="QC role required"
        )
    return admin


def _require_qc_or_admin(admin: AdminUser) -> AdminUser:
    allowed_roles = QC_ROLE_VALUES | {AdminRole.ADMIN.value, AdminRole.SYSADMIN.value}
    if admin.role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="QC or admin role required"
        )
    return admin


def _require_dashboard_access(db: Session, admin: AdminUser, dashboard_id: str) -> None:
    if admin.role == AdminRole.SYSADMIN.value:
        return
    configured_roles = list(
        db.execute(
            select(AdminDashboardPermission.role).where(
                AdminDashboardPermission.dashboard_id == dashboard_id
            )
        ).scalars()
    )
    if configured_roles and admin.role not in configured_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dashboard access denied",
        )


def _ensure_aware_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _enforce_check_within_delete_window(instance: QCCheckInstance) -> None:
    # Temporarily paused; restore this block when the 48h QC management window is re-enabled.
    _ = instance
    # opened_at = _ensure_aware_utc(instance.opened_at)
    # age = utc_now() - opened_at
    # if age > QC_DELETE_WINDOW:
    #     raise HTTPException(
    #         status_code=status.HTTP_409_CONFLICT,
    #         detail="QC checks can only be deleted within 48 hours of opening",
    #     )


def _delete_media_file(storage_key: str) -> None:
    file_path = MEDIA_GALLERY_DIR / storage_key
    try:
        if file_path.exists():
            file_path.unlink()
    except OSError:
        # DB cleanup is authoritative; stale files can be cleaned manually.
        return


def _store_qc_evidence_upload(file: UploadFile, dest_path: Path) -> int:
    size_bytes = 0
    try:
        with dest_path.open("wb") as buffer:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                size_bytes += len(chunk)
                if size_bytes > MAX_QC_EVIDENCE_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"QC evidence exceeds {MAX_QC_EVIDENCE_BYTES // (1024 * 1024)} MB limit",
                    )
                buffer.write(chunk)
    except HTTPException:
        _delete_media_file(dest_path.relative_to(MEDIA_GALLERY_DIR).as_posix())
        raise
    return size_bytes


def _evidence_upload_read(
    upload: QCEvidenceUpload,
    media: MediaAsset,
) -> QCEvidenceUploadRead:
    return QCEvidenceUploadRead(
        id=upload.id,
        client_upload_id=upload.client_upload_id,
        uri=f"/media_gallery/{media.storage_key}",
        mime_type=media.mime_type,
        size_bytes=media.size_bytes,
        created_at=upload.created_at,
    )


def _validate_staged_evidence_uploads(
    uploads: list[QCEvidenceUpload],
    requested_ids: list[int],
    *,
    check_instance_id: int,
    uploaded_by_user_id: int,
) -> None:
    if not requested_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debe subir al menos un registro antes de completar la revision",
        )
    if len(set(requested_ids)) != len(requested_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se puede usar el mismo registro mas de una vez",
        )
    if len(uploads) != len(requested_ids):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Uno o mas registros no estan disponibles o ya fueron utilizados",
        )
    for upload in uploads:
        if upload.check_instance_id != check_instance_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El registro pertenece a otra revision QC",
            )
        if upload.uploaded_by_user_id != uploaded_by_user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="El registro pertenece a otro usuario QC",
            )


def _delete_staged_evidence_uploads(
    db: Session,
    uploads: list[QCEvidenceUpload],
) -> None:
    if not uploads:
        return
    media_ids = [upload.media_asset_id for upload in uploads]
    media_rows = list(
        db.execute(
            select(MediaAsset.id, MediaAsset.storage_key).where(MediaAsset.id.in_(media_ids))
        )
    )
    db.execute(
        delete(QCEvidenceUpload).where(
            QCEvidenceUpload.id.in_([upload.id for upload in uploads])
        )
    )
    db.execute(delete(MediaAsset).where(MediaAsset.id.in_(media_ids)))
    for _, storage_key in media_rows:
        _delete_media_file(storage_key)


def _resolve_current_station(
    db: Session,
    work_unit_id: int | None,
    panel_unit_id: int | None,
) -> tuple[int | None, str | None]:
    station_id = None
    if panel_unit_id:
        panel = db.get(PanelUnit, panel_unit_id)
        station_id = panel.current_station_id if panel else None
    if station_id is None and work_unit_id:
        work_unit = db.get(WorkUnit, work_unit_id)
        station_id = work_unit.current_station_id if work_unit else None
    station_name = db.get(Station, station_id).name if station_id else None
    return station_id, station_name


def _module_has_later_applicable_station(
    db: Session,
    station: Station,
    work_unit: WorkUnit,
    work_order: WorkOrder,
) -> bool:
    if station.role != StationRole.ASSEMBLY or station.sequence_order is None:
        return False
    task_definitions = list(
        db.execute(
            select(TaskDefinition)
            .where(TaskDefinition.active == True)
            .where(TaskDefinition.archived_at.is_(None))
            .where(TaskDefinition.scope == TaskScope.MODULE)
            .where(TaskDefinition.is_rework == False)
        ).scalars()
    )
    if not task_definitions:
        return False
    task_def_ids = [task.id for task in task_definitions]
    applicability_rows = list(
        db.execute(
            select(TaskApplicability).where(TaskApplicability.task_definition_id.in_(task_def_ids))
        ).scalars()
    )
    applicability_map: dict[int, list[TaskApplicability]] = {}
    for row in applicability_rows:
        applicability_map.setdefault(row.task_definition_id, []).append(row)
    condition_ctx = load_condition_context(db, task_def_ids, [work_unit.id])
    unit_condition_value_ids = condition_ctx.values_for(work_unit.id)
    for task in task_definitions:
        applies, station_sequence_order = resolve_task_station_sequence(
            task,
            applicability_map.get(task.id, []),
            work_order.house_type_id,
            work_order.sub_type_id,
            work_unit.module_number,
            None,
            condition_requirements=condition_ctx.requirements_for(task.id),
            unit_condition_value_ids=unit_condition_value_ids,
        )
        if (
            applies
            and station_sequence_order is not None
            and station_sequence_order > station.sequence_order
        ):
            return True
    return False


def _build_check_summary(
    instance: QCCheckInstance,
    check_name: str | None,
    station_name: str | None,
    current_station_id: int | None,
    current_station_name: str | None,
    module_number: int,
    panel_code: str | None,
    project_name: str | None = None,
    house_type_name: str | None = None,
    house_identifier: str | None = None,
) -> QCCheckInstanceSummary:
    return QCCheckInstanceSummary(
        id=instance.id,
        check_definition_id=instance.check_definition_id,
        check_name=check_name,
        ad_hoc_guidance=instance.ad_hoc_guidance,
        origin=instance.origin,
        scope=instance.scope,
        work_unit_id=instance.work_unit_id,
        panel_unit_id=instance.panel_unit_id,
        related_task_instance_id=instance.related_task_instance_id,
        station_id=instance.station_id,
        station_name=station_name,
        current_station_id=current_station_id,
        current_station_name=current_station_name,
        module_number=module_number,
        project_name=project_name,
        house_type_name=house_type_name,
        house_identifier=house_identifier,
        panel_code=panel_code,
        status=instance.status,
        severity_level=instance.severity_level,
        opened_by_user_id=instance.opened_by_user_id,
        opened_at=instance.opened_at,
        closed_at=instance.closed_at,
    )


def _build_rework_summary(
    rework: QCReworkTask,
    work_unit_id: int,
    panel_unit_id: int | None,
    module_number: int,
    panel_code: str | None,
    station_id: int | None,
    station_name: str | None,
    current_station_id: int | None,
    current_station_name: str | None,
    check_status: QCCheckStatus | None = None,
    severity_level=None,
    task_status: TaskStatus | None = None,
    project_name: str | None = None,
    house_type_name: str | None = None,
    house_identifier: str | None = None,
) -> QCReworkTaskSummary:
    return QCReworkTaskSummary(
        id=rework.id,
        check_instance_id=rework.check_instance_id,
        description=rework.description,
        status=rework.status,
        check_status=check_status,
        severity_level=severity_level,
        task_status=task_status,
        work_unit_id=work_unit_id,
        panel_unit_id=panel_unit_id,
        station_id=station_id,
        station_name=station_name,
        current_station_id=current_station_id,
        current_station_name=current_station_name,
        module_number=module_number,
        project_name=project_name,
        house_type_name=house_type_name,
        house_identifier=house_identifier,
        panel_code=panel_code,
        created_at=rework.created_at,
    )


def _check_has_fail_with_rework(db: Session, check_instance_id: int) -> bool:
    has_fail_execution = (
        db.execute(
            select(QCExecution.id)
            .where(QCExecution.check_instance_id == check_instance_id)
            .where(QCExecution.outcome == QCExecutionOutcome.FAIL)
            .limit(1)
        )
        .scalars()
        .first()
        is not None
    )
    if not has_fail_execution:
        return False
    has_rework = (
        db.execute(
            select(QCReworkTask.id)
            .where(QCReworkTask.check_instance_id == check_instance_id)
            .limit(1)
        )
        .scalars()
        .first()
        is not None
    )
    return has_rework


def _delete_evidence_rows(db: Session, evidence_ids: list[int]) -> None:
    if not evidence_ids:
        return

    media_ids = list(
        db.execute(
            select(QCEvidence.media_asset_id).where(QCEvidence.id.in_(evidence_ids))
        ).scalars()
    )
    db.execute(delete(QCEvidence).where(QCEvidence.id.in_(evidence_ids)))

    unique_media_ids = sorted(set(media_ids))
    if not unique_media_ids:
        return

    orphan_media_rows = list(
        db.execute(
            select(MediaAsset.id, MediaAsset.storage_key)
            .where(MediaAsset.id.in_(unique_media_ids))
            .where(~exists().where(QCEvidence.media_asset_id == MediaAsset.id))
        )
    )
    orphan_media_ids = [media_id for media_id, _ in orphan_media_rows]
    if orphan_media_ids:
        db.execute(delete(MediaAsset).where(MediaAsset.id.in_(orphan_media_ids)))
    for _, storage_key in orphan_media_rows:
        _delete_media_file(storage_key)


def _delete_check_related_rows(db: Session, check_instance_id: int) -> None:
    staged_uploads = list(
        db.execute(
            select(QCEvidenceUpload).where(
                QCEvidenceUpload.check_instance_id == check_instance_id
            )
        ).scalars()
    )
    _delete_staged_evidence_uploads(db, staged_uploads)

    execution_ids = list(
        db.execute(
            select(QCExecution.id).where(QCExecution.check_instance_id == check_instance_id)
        ).scalars()
    )
    if execution_ids:
        evidence_ids = list(
            db.execute(
                select(QCEvidence.id).where(QCEvidence.execution_id.in_(execution_ids))
            ).scalars()
        )
        _delete_evidence_rows(db, evidence_ids)
        db.execute(
            delete(QCExecutionFailureMode).where(
                QCExecutionFailureMode.execution_id.in_(execution_ids)
            )
        )
        db.execute(delete(QCExecution).where(QCExecution.id.in_(execution_ids)))

    rework_ids = list(
        db.execute(
            select(QCReworkTask.id).where(QCReworkTask.check_instance_id == check_instance_id)
        ).scalars()
    )
    if rework_ids:
        task_instance_ids = list(
            db.execute(
                select(TaskInstance.id).where(TaskInstance.rework_task_id.in_(rework_ids))
            ).scalars()
        )
        if task_instance_ids:
            db.execute(
                delete(TaskParticipation).where(
                    TaskParticipation.task_instance_id.in_(task_instance_ids)
                )
            )
            db.execute(
                delete(TaskPause).where(TaskPause.task_instance_id.in_(task_instance_ids))
            )
            db.execute(delete(TaskInstance).where(TaskInstance.id.in_(task_instance_ids)))
        db.execute(delete(QCNotification).where(QCNotification.rework_task_id.in_(rework_ids)))
        db.execute(delete(QCReworkTask).where(QCReworkTask.id.in_(rework_ids)))

    db.execute(delete(QCCheckInstance).where(QCCheckInstance.id == check_instance_id))


@router.get("/dashboard", response_model=QCDashboardResponse)
def qc_dashboard(
    db: Session = Depends(get_db),
) -> QCDashboardResponse:
    pending = list(
        db.execute(
            select(
                QCCheckInstance,
                QCCheckDefinition.name,
                Station.name,
                WorkUnit.module_number,
                WorkOrder.project_name,
                WorkOrder.house_identifier,
                HouseType.name,
                PanelUnit.panel_definition_id,
            )
            .join(QCCheckDefinition, QCCheckInstance.check_definition_id == QCCheckDefinition.id, isouter=True)
            .join(Station, QCCheckInstance.station_id == Station.id, isouter=True)
            .join(WorkUnit, QCCheckInstance.work_unit_id == WorkUnit.id)
            .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
            .join(HouseType, WorkOrder.house_type_id == HouseType.id)
            .join(PanelUnit, QCCheckInstance.panel_unit_id == PanelUnit.id, isouter=True)
            .where(QCCheckInstance.status == QCCheckStatus.OPEN)
            .where(WorkUnit.status != WorkUnitStatus.COMPLETED)
            .where(
                or_(
                    QCCheckInstance.scope != TaskScope.PANEL,
                    WorkUnit.status != WorkUnitStatus.ASSEMBLY,
                )
            )
            .where(
                ~exists().where(QCReworkTask.check_instance_id == QCCheckInstance.id)
            )
            .order_by(QCCheckInstance.opened_at.desc())
        )
    )

    pending_checks: list[QCCheckInstanceSummary] = []
    for (
        instance,
        check_name,
        station_name,
        module_number,
        project_name,
        house_identifier,
        house_type_name,
        panel_def_id,
    ) in pending:
        panel_code = None
        if panel_def_id is not None:
            panel = db.get(PanelUnit, instance.panel_unit_id) if instance.panel_unit_id else None
            if panel:
                panel_code = panel.panel_definition.panel_code
        if not check_name:
            check_name = instance.ad_hoc_title
        current_station_id, current_station_name = _resolve_current_station(
            db, instance.work_unit_id, instance.panel_unit_id
        )
        pending_checks.append(
            _build_check_summary(
                instance,
                check_name,
                station_name,
                current_station_id,
                current_station_name,
                module_number,
                panel_code,
                project_name,
                house_type_name,
                house_identifier,
            )
        )

    rework_rows = list(
        db.execute(
            select(
                QCReworkTask,
                QCCheckInstance,
                WorkUnit.module_number,
                WorkOrder.project_name,
                WorkOrder.house_identifier,
                HouseType.name,
                Station.id,
                Station.name,
                PanelUnit.id,
            )
            .join(QCCheckInstance, QCReworkTask.check_instance_id == QCCheckInstance.id)
            .join(WorkUnit, QCCheckInstance.work_unit_id == WorkUnit.id)
            .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
            .join(HouseType, WorkOrder.house_type_id == HouseType.id)
            .join(Station, QCCheckInstance.station_id == Station.id, isouter=True)
            .join(PanelUnit, QCCheckInstance.panel_unit_id == PanelUnit.id, isouter=True)
            .where(
                or_(
                    QCReworkTask.status.in_([QCReworkStatus.OPEN, QCReworkStatus.IN_PROGRESS]),
                    (QCReworkTask.status == QCReworkStatus.DONE)
                    & (QCCheckInstance.status == QCCheckStatus.OPEN),
                )
            )
            .order_by(QCReworkTask.created_at.desc())
        )
    )
    rework_tasks: list[QCReworkTaskSummary] = []
    for (
        rework,
        check_instance,
        module_number,
        project_name,
        house_identifier,
        house_type_name,
        station_id,
        station_name,
        panel_unit_ref,
    ) in rework_rows:
        panel_code = None
        if panel_unit_ref:
            panel = db.get(PanelUnit, panel_unit_ref)
            if panel:
                panel_code = panel.panel_definition.panel_code
        task_status = (
            db.execute(
                select(TaskInstance.status)
                .where(TaskInstance.rework_task_id == rework.id)
                .order_by(TaskInstance.started_at.desc().nullslast(), TaskInstance.id.desc())
                .limit(1)
            )
            .scalars()
            .first()
        )
        current_station_id, current_station_name = _resolve_current_station(
            db, check_instance.work_unit_id, check_instance.panel_unit_id
        )
        rework_tasks.append(
            _build_rework_summary(
                rework,
                check_instance.work_unit_id,
                check_instance.panel_unit_id,
                module_number,
                panel_code,
                station_id,
                station_name,
                current_station_id,
                current_station_name,
                check_instance.status,
                check_instance.severity_level,
                task_status,
                project_name,
                house_type_name,
                house_identifier,
            )
        )

    plant_panel_rows = list(
        db.execute(
            select(
                PanelUnit,
                PanelDefinition.panel_code,
                Station.name,
                WorkUnit.module_number,
                WorkOrder.project_name,
                WorkOrder.house_identifier,
                HouseType.name,
            )
            .join(PanelDefinition, PanelUnit.panel_definition_id == PanelDefinition.id)
            .join(Station, PanelUnit.current_station_id == Station.id)
            .join(WorkUnit, PanelUnit.work_unit_id == WorkUnit.id)
            .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
            .join(HouseType, WorkOrder.house_type_id == HouseType.id)
            .where(PanelUnit.current_station_id.is_not(None))
            .where(WorkUnit.status != WorkUnitStatus.COMPLETED)
            .order_by(Station.sequence_order, WorkUnit.planned_sequence, PanelDefinition.panel_code)
        )
    )
    plant_panels = [
        QCPlantPanelSummary(
            panel_unit_id=panel_unit.id,
            panel_definition_id=panel_unit.panel_definition_id,
            work_unit_id=panel_unit.work_unit_id,
            current_station_id=panel_unit.current_station_id,
            current_station_name=station_name,
            status=panel_unit.status,
            module_number=module_number,
            project_name=project_name,
            house_type_name=house_type_name,
            house_identifier=house_identifier,
            panel_code=panel_code,
        )
        for (
            panel_unit,
            panel_code,
            station_name,
            module_number,
            project_name,
            house_identifier,
            house_type_name,
        ) in plant_panel_rows
        if panel_unit.current_station_id is not None
    ]

    plant_module_rows = list(
        db.execute(
            select(
                WorkUnit,
                Station,
                WorkOrder,
                HouseType.name,
            )
            .join(Station, WorkUnit.current_station_id == Station.id)
            .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
            .join(HouseType, WorkOrder.house_type_id == HouseType.id)
            .where(WorkUnit.current_station_id.is_not(None))
            .where(WorkUnit.status != WorkUnitStatus.COMPLETED)
            .order_by(Station.sequence_order, WorkUnit.planned_sequence, WorkUnit.id)
        )
    )
    plant_modules = [
        QCPlantModuleSummary(
            work_unit_id=work_unit.id,
            current_station_id=work_unit.current_station_id,
            current_station_name=station.name,
            status=work_unit.status,
            can_mark_completed=(
                work_unit.status == WorkUnitStatus.ASSEMBLY
                and station.role == StationRole.ASSEMBLY
                and not _module_has_later_applicable_station(db, station, work_unit, work_order)
            ),
            module_number=work_unit.module_number,
            project_name=work_order.project_name,
            house_type_name=house_type_name,
            house_identifier=work_order.house_identifier,
        )
        for (
            work_unit,
            station,
            work_order,
            house_type_name,
        ) in plant_module_rows
        if work_unit.current_station_id is not None
    ]

    return QCDashboardResponse(
        pending_checks=pending_checks,
        rework_tasks=rework_tasks,
        plant_panels=plant_panels,
        plant_modules=plant_modules,
    )


@router.get("/dashboards/quality-compliance", response_model=QCQualityMetricsResponse)
def qc_quality_compliance_dashboard(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> QCQualityMetricsResponse:
    _require_dashboard_access(db, admin, QC_QUALITY_METRICS_DASHBOARD_ID)
    try:
        window = build_qc_metric_window(date_from, date_to)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El inicio del rango no puede ser posterior al fin.",
        ) from exc

    performed_exists = exists().where(
        QCExecution.check_instance_id == QCCheckInstance.id
    )
    check_rows = db.execute(
        select(
            QCCheckInstance.work_unit_id.label("work_unit_id"),
            WorkUnit.module_number.label("module_number"),
            WorkOrder.project_name.label("project_name"),
            WorkOrder.house_identifier.label("house_identifier"),
            HouseType.name.label("house_type_name"),
            QCCheckInstance.origin.label("origin"),
            QCCheckInstance.status.label("status"),
            performed_exists.label("performed"),
        )
        .join(WorkUnit, QCCheckInstance.work_unit_id == WorkUnit.id)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
        .where(QCCheckInstance.opened_at >= window.start_utc)
        .where(QCCheckInstance.opened_at < window.end_utc_exclusive)
    ).all()

    observation_rows = db.execute(
        select(
            QCQualityComplaint.work_unit_id.label("work_unit_id"),
            WorkUnit.module_number.label("module_number"),
            WorkOrder.project_name.label("project_name"),
            WorkOrder.house_identifier.label("house_identifier"),
            HouseType.name.label("house_type_name"),
            QCQualityComplaint.status.label("status"),
        )
        .join(WorkUnit, QCQualityComplaint.work_unit_id == WorkUnit.id)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
        .where(QCQualityComplaint.created_at >= window.start_utc)
        .where(QCQualityComplaint.created_at < window.end_utc_exclusive)
    ).all()

    return QCQualityMetricsResponse.model_validate(
        summarize_qc_quality_rows(check_rows, observation_rows, window)
    )


@router.get("/dashboards/failure-analysis", response_model=QCFailureAnalysisResponse)
def qc_failure_analysis_dashboard(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> QCFailureAnalysisResponse:
    _require_dashboard_access(db, admin, QC_FAILURE_ANALYSIS_DASHBOARD_ID)
    try:
        window = build_qc_metric_window(date_from, date_to)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El inicio del rango no puede ser posterior al fin.",
        ) from exc

    execution_rows = db.execute(
        select(
            QCExecution.id.label("execution_id"),
            QCExecution.check_instance_id.label("check_instance_id"),
            QCExecution.outcome.label("outcome"),
            QCExecution.performed_at.label("performed_at"),
            QCCheckInstance.work_unit_id.label("work_unit_id"),
            QCCheckInstance.severity_level.label("severity_level"),
            TaskDefinition.id.label("task_definition_id"),
            TaskDefinition.name.label("task_name"),
            Station.id.label("station_id"),
            Station.name.label("station_name"),
            QCCheckDefinition.id.label("check_definition_id"),
            func.coalesce(
                QCCheckDefinition.name,
                QCCheckInstance.ad_hoc_title,
                "Check manual",
            ).label("check_name"),
        )
        .select_from(QCExecution)
        .join(QCCheckInstance, QCExecution.check_instance_id == QCCheckInstance.id)
        .outerjoin(
            TaskInstance,
            QCCheckInstance.related_task_instance_id == TaskInstance.id,
        )
        .outerjoin(TaskDefinition, TaskInstance.task_definition_id == TaskDefinition.id)
        .outerjoin(Station, QCCheckInstance.station_id == Station.id)
        .outerjoin(
            QCCheckDefinition,
            QCCheckInstance.check_definition_id == QCCheckDefinition.id,
        )
        .where(QCExecution.performed_at >= window.start_utc)
        .where(QCExecution.performed_at < window.end_utc_exclusive)
    ).all()

    failure_mode_rows = db.execute(
        select(
            QCExecutionFailureMode.failure_mode_definition_id.label(
                "failure_mode_definition_id"
            ),
            QCFailureModeDefinition.name.label("failure_mode_name"),
            QCExecutionFailureMode.other_text.label("other_text"),
        )
        .select_from(QCExecutionFailureMode)
        .join(QCExecution, QCExecutionFailureMode.execution_id == QCExecution.id)
        .outerjoin(
            QCFailureModeDefinition,
            QCExecutionFailureMode.failure_mode_definition_id
            == QCFailureModeDefinition.id,
        )
        .where(QCExecution.outcome == QCExecutionOutcome.FAIL)
        .where(QCExecution.performed_at >= window.start_utc)
        .where(QCExecution.performed_at < window.end_utc_exclusive)
    ).all()

    failed_execution_in_range = (
        exists()
        .where(QCExecution.check_instance_id == QCReworkTask.check_instance_id)
        .where(QCExecution.outcome == QCExecutionOutcome.FAIL)
        .where(QCExecution.performed_at >= window.start_utc)
        .where(QCExecution.performed_at < window.end_utc_exclusive)
    )
    rework_rows = db.execute(
        select(QCReworkTask.id.label("rework_task_id"), QCReworkTask.status.label("status"))
        .where(failed_execution_in_range)
    ).all()

    return QCFailureAnalysisResponse.model_validate(
        summarize_qc_failure_rows(
            execution_rows,
            failure_mode_rows,
            rework_rows,
            window,
        )
    )


@router.post("/work-units/{work_unit_id}/complete", status_code=status.HTTP_204_NO_CONTENT)
def mark_work_unit_completed(
    work_unit_id: int,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> None:
    _require_qc_or_admin(admin)
    work_unit = db.get(WorkUnit, work_unit_id)
    if not work_unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work unit not found")
    if work_unit.status == WorkUnitStatus.COMPLETED:
        return
    work_unit.status = WorkUnitStatus.COMPLETED
    work_unit.current_station_id = None
    panels = list(
        db.execute(select(PanelUnit).where(PanelUnit.work_unit_id == work_unit.id)).scalars()
    )
    for panel in panels:
        panel.status = PanelUnitStatus.CONSUMED
        panel.current_station_id = None
    db.commit()


@router.get("/dashboard/export.xlsx")
def qc_dashboard_excel_report(
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> Response:
    _require_qc_admin(admin)
    try:
        content, filename = build_qc_dashboard_excel_report(db)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="La generacion Excel no esta disponible; falta openpyxl en el backend.",
        ) from exc
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.get("/check-instances/{check_instance_id}", response_model=QCCheckInstanceDetail)
def qc_check_instance_detail(
    check_instance_id: int,
    db: Session = Depends(get_db),
) -> QCCheckInstanceDetail:
    instance = db.get(QCCheckInstance, check_instance_id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC check not found")

    check_def = db.get(QCCheckDefinition, instance.check_definition_id) if instance.check_definition_id else None
    check_name = check_def.name if check_def else instance.ad_hoc_title
    station_name = db.get(Station, instance.station_id).name if instance.station_id else None
    module_number = db.get(WorkUnit, instance.work_unit_id).module_number
    panel_code = None
    if instance.panel_unit_id:
        panel = db.get(PanelUnit, instance.panel_unit_id)
        if panel:
            panel_code = panel.panel_definition.panel_code

    current_station_id, current_station_name = _resolve_current_station(
        db, instance.work_unit_id, instance.panel_unit_id
    )
    check_summary = _build_check_summary(
        instance,
        check_name,
        station_name,
        current_station_id,
        current_station_name,
        module_number,
        panel_code,
    )

    failure_modes = list(
        db.execute(
            select(QCFailureModeDefinition)
            .where(QCFailureModeDefinition.active == True)
            .where(
                (QCFailureModeDefinition.check_definition_id == instance.check_definition_id)
                | (QCFailureModeDefinition.check_definition_id.is_(None))
            )
            .order_by(QCFailureModeDefinition.name)
        ).scalars()
    )
    failure_mode_summaries = [
        QCFailureModeSummary(
            id=mode.id,
            check_definition_id=mode.check_definition_id,
            name=mode.name,
            description=mode.description,
            default_severity_level=mode.default_severity_level,
            default_rework_description=mode.default_rework_description,
        )
        for mode in failure_modes
    ]

    media_assets = []
    if instance.check_definition_id:
        media_assets = list(
            db.execute(
                select(QCCheckMediaAsset)
                .where(QCCheckMediaAsset.check_definition_id == instance.check_definition_id)
                .order_by(QCCheckMediaAsset.created_at.desc())
            ).scalars()
        )
    media_summaries = [
        QCCheckMediaSummary(
            id=media.id,
            media_type=media.media_type.value,
            uri=media.uri,
            created_at=media.created_at,
        )
        for media in media_assets
    ]

    trigger_task: QCTaskInstanceWithWorkersSummary | None = None
    if instance.related_task_instance_id:
        related = db.get(TaskInstance, instance.related_task_instance_id)
        if related:
            related_def = db.get(TaskDefinition, related.task_definition_id)
            related_station_name = (
                db.get(Station, related.station_id).name if related.station_id else None
            )
            participant_rows = list(
                db.execute(
                    select(TaskParticipation, Worker)
                    .join(Worker, TaskParticipation.worker_id == Worker.id)
                    .where(TaskParticipation.task_instance_id == related.id)
                    .order_by(TaskParticipation.joined_at)
                )
            )
            trigger_task = QCTaskInstanceWithWorkersSummary(
                task_instance_id=related.id,
                task_definition_id=related.task_definition_id,
                task_name=related_def.name if related_def else f"Tarea #{related.task_definition_id}",
                station_id=related.station_id,
                station_name=related_station_name,
                status=related.status,
                started_at=related.started_at,
                completed_at=related.completed_at,
                workers=[
                    QCTaskParticipantSummary(
                        worker_id=worker.id,
                        worker_name=f"{worker.first_name} {worker.last_name}",
                    )
                    for participation, worker in participant_rows
                ],
            )

    execution_rows = list(
        db.execute(
            select(QCExecution)
            .where(QCExecution.check_instance_id == instance.id)
            .order_by(QCExecution.performed_at.desc())
        ).scalars()
    )

    failure_mode_map: dict[int, str] = {
        mode.id: mode.name for mode in failure_modes
    }
    executions: list[QCExecutionRead] = []
    evidence: list[QCEvidenceSummary] = []
    rework_attempts: list[QCReworkAttemptSummary] = []
    for execution in execution_rows:
        mode_rows = list(
            db.execute(
                select(QCExecutionFailureMode)
                .where(QCExecutionFailureMode.execution_id == execution.id)
            ).scalars()
        )
        mode_summaries = [
            QCExecutionFailureModeRead(
                id=mode.id,
                failure_mode_definition_id=mode.failure_mode_definition_id,
                failure_mode_name=failure_mode_map.get(mode.failure_mode_definition_id or 0),
                other_text=mode.other_text,
                measurement_json=mode.measurement_json,
                notes=mode.notes,
            )
            for mode in mode_rows
        ]
        executions.append(
            QCExecutionRead(
                id=execution.id,
                check_instance_id=execution.check_instance_id,
                outcome=execution.outcome,
                notes=execution.notes,
                performed_by_user_id=execution.performed_by_user_id,
                performed_at=execution.performed_at,
                failure_modes=mode_summaries,
            )
        )
        evidence_rows = list(
            db.execute(
                select(QCEvidence, MediaAsset)
                .join(MediaAsset, QCEvidence.media_asset_id == MediaAsset.id)
                .where(QCEvidence.execution_id == execution.id)
            )
        )
        for evidence_row, media in evidence_rows:
            evidence.append(
                QCEvidenceSummary(
                    id=evidence_row.id,
                    execution_id=evidence_row.execution_id,
                    media_asset_id=media.id,
                    uri=f"/media_gallery/{media.storage_key}",
                    mime_type=media.mime_type,
                    captured_at=evidence_row.captured_at,
                )
            )

    rework_rows = list(
        db.execute(
            select(QCReworkTask)
            .where(QCReworkTask.check_instance_id == instance.id)
            .order_by(QCReworkTask.created_at.desc())
        ).scalars()
    )
    current_station_id, current_station_name = _resolve_current_station(
        db, instance.work_unit_id, instance.panel_unit_id
    )
    rework_summaries = [
        _build_rework_summary(
            rework,
            instance.work_unit_id,
            instance.panel_unit_id,
            module_number,
            panel_code,
            instance.station_id,
            station_name,
            current_station_id,
            current_station_name,
            instance.status,
            instance.severity_level,
            (
                db.execute(
                    select(TaskInstance.status)
                    .where(TaskInstance.rework_task_id == rework.id)
                    .order_by(TaskInstance.started_at.desc().nullslast(), TaskInstance.id.desc())
                    .limit(1)
                )
                .scalars()
                .first()
            ),
        )
        for rework in rework_rows
    ]

    for rework in rework_rows:
        task_rows = list(
            db.execute(
                select(TaskInstance)
                .where(TaskInstance.rework_task_id == rework.id)
                .order_by(TaskInstance.started_at.desc().nullslast(), TaskInstance.id.desc())
            ).scalars()
        )
        for task in task_rows:
            task_station_name = db.get(Station, task.station_id).name if task.station_id else None
            participant_rows = list(
                db.execute(
                    select(TaskParticipation, Worker)
                    .join(Worker, TaskParticipation.worker_id == Worker.id)
                    .where(TaskParticipation.task_instance_id == task.id)
                    .order_by(TaskParticipation.joined_at)
                )
            )
            rework_attempts.append(
                QCReworkAttemptSummary(
                    rework_task_id=rework.id,
                    task_instance_id=task.id,
                    station_id=task.station_id,
                    station_name=task_station_name,
                    status=task.status,
                    started_at=task.started_at,
                    completed_at=task.completed_at,
                    workers=[
                        QCTaskParticipantSummary(
                            worker_id=worker.id,
                            worker_name=f"{worker.first_name} {worker.last_name}",
                        )
                        for participation, worker in participant_rows
                    ],
                )
            )

    check_def_summary = (
        QCCheckDefinitionSummary(
            id=check_def.id,
            name=check_def.name,
            guidance_text=check_def.guidance_text,
            category_id=check_def.category_id,
        )
        if check_def
        else None
    )

    return QCCheckInstanceDetail(
        check_instance=check_summary,
        check_definition=check_def_summary,
        failure_modes=failure_mode_summaries,
        media_assets=media_summaries,
        executions=executions,
        rework_tasks=rework_summaries,
        rework_attempts=rework_attempts,
        evidence=evidence,
        trigger_task=trigger_task,
    )


@router.post("/check-instances/{check_instance_id}/execute", response_model=QCExecutionRead)
def execute_qc_check(
    check_instance_id: int,
    payload: QCExecutionCreate,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> QCExecutionRead:
    admin = _require_qc_admin(admin)
    instance = db.execute(
        select(QCCheckInstance)
        .where(QCCheckInstance.id == check_instance_id)
        .with_for_update()
    ).scalar_one_or_none()
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC check not found")
    open_rework = (
        db.execute(
            select(QCReworkTask)
            .where(QCReworkTask.check_instance_id == instance.id)
            .where(QCReworkTask.status.in_([QCReworkStatus.OPEN, QCReworkStatus.IN_PROGRESS]))
        )
        .scalars()
        .first()
    )
    if open_rework:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Rework is still open; complete it before reinspection",
        )
    if instance.status == QCCheckStatus.CLOSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="QC check already closed")

    if payload.outcome == QCExecutionOutcome.FAIL and payload.severity_level is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Severity is required on fail"
        )

    staged_uploads = list(
        db.execute(
            select(QCEvidenceUpload)
            .where(QCEvidenceUpload.id.in_(payload.evidence_upload_ids))
            .with_for_update()
        ).scalars()
    )
    _validate_staged_evidence_uploads(
        staged_uploads,
        payload.evidence_upload_ids,
        check_instance_id=instance.id,
        uploaded_by_user_id=admin.id,
    )

    now = utc_now()
    execution = QCExecution(
        check_instance_id=instance.id,
        outcome=payload.outcome,
        notes=payload.notes,
        measurement_json=payload.measurement_json,
        performed_by_user_id=admin.id,
        performed_at=now,
    )
    db.add(execution)
    db.flush()

    for upload in staged_uploads:
        db.add(
            QCEvidence(
                execution_id=execution.id,
                media_asset_id=upload.media_asset_id,
                captured_at=now,
            )
        )
    db.execute(
        delete(QCEvidenceUpload).where(
            QCEvidenceUpload.id.in_([upload.id for upload in staged_uploads])
        )
    )

    if payload.outcome == QCExecutionOutcome.FAIL:
        instance.severity_level = payload.severity_level
        apply_failure_modes(
            db,
            execution,
            payload.failure_mode_ids,
            payload.other_failure_text,
            payload.measurement_json,
            payload.failure_mode_notes,
        )
        rework_description = payload.rework_description
        if not rework_description and payload.failure_mode_ids:
            mode = db.get(QCFailureModeDefinition, payload.failure_mode_ids[0])
            if mode and mode.default_rework_description:
                rework_description = mode.default_rework_description
        if not rework_description:
            rework_description = "Re-trabajo requerido"
        rework = QCReworkTask(
            check_instance_id=instance.id,
            description=rework_description,
            status=QCReworkStatus.OPEN,
            created_at=now,
        )
        db.add(rework)
        # Ensure rework_task.id is available before creating notifications.
        db.flush()
        instance.status = QCCheckStatus.CLOSED
        instance.closed_at = now
        if instance.related_task_instance_id:
            create_notifications_for_task(db, rework, instance.related_task_instance_id)
    else:
        instance.status = QCCheckStatus.CLOSED
        instance.closed_at = now
        reworks = list(
            db.execute(
                select(QCReworkTask)
                .where(QCReworkTask.check_instance_id == instance.id)
                .where(QCReworkTask.status.in_([QCReworkStatus.OPEN, QCReworkStatus.IN_PROGRESS]))
            ).scalars()
        )
        for rework in reworks:
            rework.status = QCReworkStatus.DONE
            notifications = list(
                db.execute(
                    select(QCNotification)
                    .where(QCNotification.rework_task_id == rework.id)
                    .where(QCNotification.status == QCNotificationStatus.ACTIVE)
                ).scalars()
            )
            for notification in notifications:
                notification.status = QCNotificationStatus.DISMISSED
                notification.seen_at = now

    update_sampling_from_execution(db, instance, payload.outcome)
    db.commit()

    execution_read = QCExecutionRead(
        id=execution.id,
        check_instance_id=execution.check_instance_id,
        outcome=execution.outcome,
        notes=execution.notes,
        performed_by_user_id=execution.performed_by_user_id,
        performed_at=execution.performed_at,
        failure_modes=[],
    )
    return execution_read


def _manual_check_target(
    db: Session,
    work_unit_id: int,
    panel_unit_id: int | None,
    *,
    for_update: bool = False,
) -> tuple[WorkUnit, WorkOrder, TaskScope, str | None]:
    work_unit = (
        db.execute(
            select(WorkUnit)
            .where(WorkUnit.id == work_unit_id)
            .with_for_update()
        )
        .scalars()
        .one_or_none()
        if for_update
        else db.get(WorkUnit, work_unit_id)
    )
    if not work_unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work unit not found")

    scope = manual_check_scope_for_status(work_unit.status)
    if scope is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Las inspecciones manuales requieren un módulo actualmente en producción",
        )

    panel_group = None
    if scope == TaskScope.PANEL:
        if panel_unit_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Debe seleccionar un panel mientras el módulo está en Paneles",
            )
        panel = db.get(PanelUnit, panel_unit_id)
        if not panel or panel.work_unit_id != work_unit_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Panel unit not found")
        panel_group = panel.panel_definition.group
    elif panel_unit_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se puede seleccionar un panel mientras el módulo está en Paneles",
        )

    work_order = db.get(WorkOrder, work_unit.work_order_id)
    if not work_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    return work_unit, work_order, scope, panel_group


def _applicability_rows(db: Session, check_definition_id: int) -> list[QCApplicability]:
    return list(
        db.execute(
            select(QCApplicability)
            .options(
                selectinload(QCApplicability.house_type_links),
                selectinload(QCApplicability.sub_type_links),
                selectinload(QCApplicability.panel_group_links),
            )
            .where(QCApplicability.check_definition_id == check_definition_id)
        ).scalars()
    )


@router.get("/manual-check-options", response_model=list[QCManualCheckOption])
def manual_check_options(
    work_unit_id: int,
    panel_unit_id: int | None = None,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> list[QCManualCheckOption]:
    _require_qc_admin(admin)
    _work_unit, work_order, scope, panel_group = _manual_check_target(
        db, work_unit_id, panel_unit_id
    )
    definitions = list(
        db.execute(
            select(QCCheckDefinition)
            .where(QCCheckDefinition.active.is_(True))
            .where(QCCheckDefinition.archived_at.is_(None))
            .order_by(QCCheckDefinition.name, QCCheckDefinition.id)
        ).scalars()
    )
    if not definitions:
        return []

    applicability_by_definition: dict[int, list[QCApplicability]] = {}
    applicability_rows = list(
        db.execute(
            select(QCApplicability)
            .options(
                selectinload(QCApplicability.house_type_links),
                selectinload(QCApplicability.sub_type_links),
                selectinload(QCApplicability.panel_group_links),
            )
            .where(
                QCApplicability.check_definition_id.in_(
                    definition.id for definition in definitions
                )
            )
        ).scalars()
    )
    for applicability in applicability_rows:
        applicability_by_definition.setdefault(applicability.check_definition_id, []).append(
            applicability
        )

    target_open_definition_ids = set(
        db.execute(
            select(QCCheckInstance.check_definition_id)
            .where(QCCheckInstance.work_unit_id == work_unit_id)
            .where(QCCheckInstance.panel_unit_id == panel_unit_id)
            .where(QCCheckInstance.scope == scope)
            .where(QCCheckInstance.status == QCCheckStatus.OPEN)
            .where(QCCheckInstance.check_definition_id.isnot(None))
        ).scalars()
    )

    options: list[QCManualCheckOption] = []
    for definition in definitions:
        if not resolve_qc_applicability(
            applicability_by_definition.get(definition.id, []),
            work_order.house_type_id,
            work_order.sub_type_id,
            panel_group,
        ):
            continue
        options.append(
            QCManualCheckOption(
                id=definition.id,
                name=definition.name,
                guidance_text=definition.guidance_text,
                has_open_instance=definition.id in target_open_definition_ids,
            )
        )
    return options


@router.post("/check-instances/manual", response_model=QCCheckInstanceSummary, status_code=status.HTTP_201_CREATED)
def create_manual_check(
    payload: QCManualCheckCreate,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> QCCheckInstanceSummary:
    admin = _require_qc_admin(admin)
    work_unit, work_order, expected_scope, panel_group = _manual_check_target(
        db, payload.work_unit_id, payload.panel_unit_id, for_update=True
    )
    if payload.scope != expected_scope:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El alcance de la inspección no coincide con el estado actual del módulo",
        )
    check_def = None
    if payload.check_definition_id:
        check_def = db.get(QCCheckDefinition, payload.check_definition_id)
        if not check_def:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC check definition not found")
        if not check_def.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="QC check definition is inactive",
            )
        if check_def.archived_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="QC check definition is archived",
            )
    if not payload.ad_hoc_title and not check_def:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Manual check title required")

    if check_def:
        applicability = _applicability_rows(db, check_def.id)
        applies = resolve_qc_applicability(
            applicability,
            work_order.house_type_id,
            work_order.sub_type_id,
            panel_group,
        )
        if not applies:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Check does not apply")
        existing_open = (
            db.execute(
                select(QCCheckInstance.id)
                .where(QCCheckInstance.check_definition_id == check_def.id)
                .where(QCCheckInstance.work_unit_id == payload.work_unit_id)
                .where(QCCheckInstance.panel_unit_id == payload.panel_unit_id)
                .where(QCCheckInstance.scope == expected_scope)
                .where(QCCheckInstance.status == QCCheckStatus.OPEN)
                .limit(1)
            )
            .scalars()
            .first()
        )
        if existing_open is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Esta inspección ya está abierta para el objetivo seleccionado",
            )

    current_station_id, current_station_name = _resolve_current_station(
        db, payload.work_unit_id, payload.panel_unit_id
    )
    station_id = current_station_id

    instance = QCCheckInstance(
        check_definition_id=check_def.id if check_def else None,
        origin=QCCheckOrigin.MANUAL,
        ad_hoc_title=payload.ad_hoc_title,
        ad_hoc_guidance=payload.ad_hoc_guidance,
        scope=payload.scope,
        work_unit_id=payload.work_unit_id,
        panel_unit_id=payload.panel_unit_id,
        related_task_instance_id=None,
        station_id=station_id,
        status=QCCheckStatus.OPEN,
        opened_by_user_id=admin.id,
        opened_at=utc_now(),
    )
    db.add(instance)
    db.commit()
    db.refresh(instance)

    station_name = current_station_name
    panel_code = None
    if payload.panel_unit_id:
        panel = db.get(PanelUnit, payload.panel_unit_id)
        panel_code = panel.panel_definition.panel_code if panel else None

    return _build_check_summary(
        instance,
        check_def.name if check_def else payload.ad_hoc_title,
        station_name,
        current_station_id,
        current_station_name,
        work_unit.module_number,
        panel_code,
    )


@router.delete("/check-instances/{check_instance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_check_instance(
    check_instance_id: int,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> None:
    _require_qc_admin(admin)
    instance = db.get(QCCheckInstance, check_instance_id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC check not found")

    _enforce_check_within_delete_window(instance)
    if _check_has_fail_with_rework(db, instance.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete failed QC checks that have rework tasks",
        )

    _delete_check_related_rows(db, instance.id)
    db.commit()


@router.post(
    "/check-instances/{check_instance_id}/evidence-uploads",
    response_model=QCEvidenceUploadRead,
)
def stage_execution_evidence(
    check_instance_id: int,
    client_upload_id: str = Form(...),
    file: UploadFile = File(...),
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> QCEvidenceUploadRead:
    admin = _require_qc_admin(admin)
    instance = db.get(QCCheckInstance, check_instance_id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC check not found")
    if instance.status == QCCheckStatus.CLOSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="QC check already closed")

    stale_uploads = list(
        db.execute(
            select(QCEvidenceUpload).where(
                QCEvidenceUpload.created_at < utc_now() - QC_EVIDENCE_UPLOAD_TTL
            )
        ).scalars()
    )
    if stale_uploads:
        _delete_staged_evidence_uploads(db, stale_uploads)
        db.commit()

    normalized_upload_id = client_upload_id.strip()
    if len(normalized_upload_id) < 8 or len(normalized_upload_id) > 64:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Identificador de carga invalido",
        )

    existing = db.execute(
        select(QCEvidenceUpload, MediaAsset)
        .join(MediaAsset, QCEvidenceUpload.media_asset_id == MediaAsset.id)
        .where(QCEvidenceUpload.client_upload_id == normalized_upload_id)
    ).first()
    if existing:
        existing_upload, existing_media = existing
        if (
            existing_upload.check_instance_id != check_instance_id
            or existing_upload.uploaded_by_user_id != admin.id
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El identificador de carga ya esta en uso",
            )
        return _evidence_upload_read(existing_upload, existing_media)

    if not file.content_type or not file.content_type.startswith(QC_EVIDENCE_MIME_PREFIXES):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se admiten fotos y videos como registro",
        )

    QC_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "").suffix or ""
    storage_key = f"qc_evidence/{uuid4().hex}{ext}"
    dest_path = MEDIA_GALLERY_DIR / storage_key
    size_bytes = _store_qc_evidence_upload(file, dest_path)
    created_at = utc_now()

    media = MediaAsset(
        storage_key=storage_key,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=size_bytes,
        width=None,
        height=None,
        watermark_text=None,
        created_at=created_at,
    )
    upload = QCEvidenceUpload(
        check_instance_id=check_instance_id,
        media_asset_id=0,
        uploaded_by_user_id=admin.id,
        client_upload_id=normalized_upload_id,
        created_at=created_at,
    )
    try:
        db.add(media)
        db.flush()
        upload.media_asset_id = media.id
        db.add(upload)
        db.commit()
        db.refresh(upload)
    except IntegrityError as exc:
        db.rollback()
        _delete_media_file(storage_key)
        existing = db.execute(
            select(QCEvidenceUpload, MediaAsset)
            .join(MediaAsset, QCEvidenceUpload.media_asset_id == MediaAsset.id)
            .where(QCEvidenceUpload.client_upload_id == normalized_upload_id)
        ).first()
        if existing:
            existing_upload, existing_media = existing
            if (
                existing_upload.check_instance_id == check_instance_id
                and existing_upload.uploaded_by_user_id == admin.id
            ):
                return _evidence_upload_read(existing_upload, existing_media)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El identificador de carga ya esta en uso",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        _delete_media_file(storage_key)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo preparar el registro QC",
        ) from exc

    return _evidence_upload_read(upload, media)


@router.delete(
    "/evidence-uploads/{upload_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_staged_execution_evidence(
    upload_id: int,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> None:
    admin = _require_qc_admin(admin)
    upload = db.get(QCEvidenceUpload, upload_id)
    if not upload:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se encontro el registro QC preparado",
        )
    if upload.uploaded_by_user_id != admin.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El registro pertenece a otro usuario QC",
        )
    _delete_staged_evidence_uploads(db, [upload])
    db.commit()


@router.post("/executions/{execution_id}/evidence", response_model=QCEvidenceSummary)
def upload_execution_evidence(
    execution_id: int,
    file: UploadFile = File(...),
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> QCEvidenceSummary:
    _require_qc_admin(admin)
    execution = db.get(QCExecution, execution_id)
    if not execution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Execution not found")
    if not file.content_type or not file.content_type.startswith(QC_EVIDENCE_MIME_PREFIXES):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only image and video evidence uploads are supported",
        )

    QC_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "").suffix or ""
    storage_key = f"qc_evidence/{uuid4().hex}{ext}"
    dest_path = MEDIA_GALLERY_DIR / storage_key

    size_bytes = _store_qc_evidence_upload(file, dest_path)

    media = MediaAsset(
        storage_key=storage_key,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=size_bytes,
        width=None,
        height=None,
        watermark_text=None,
        created_at=utc_now(),
    )
    db.add(media)
    db.flush()

    evidence = QCEvidence(
        execution_id=execution.id,
        media_asset_id=media.id,
        captured_at=utc_now(),
    )
    db.add(evidence)
    db.commit()
    db.refresh(evidence)

    return QCEvidenceSummary(
        id=evidence.id,
        execution_id=evidence.execution_id,
        media_asset_id=media.id,
        uri=f"/media_gallery/{storage_key}",
        mime_type=media.mime_type,
        captured_at=evidence.captured_at,
    )


@router.delete("/evidence/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_execution_evidence(
    evidence_id: int,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> None:
    _require_qc_admin(admin)
    evidence = db.get(QCEvidence, evidence_id)
    if not evidence:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC evidence not found")

    execution = db.get(QCExecution, evidence.execution_id)
    if not execution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC execution not found")

    instance = db.get(QCCheckInstance, execution.check_instance_id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC check not found")

    _enforce_check_within_delete_window(instance)
    _delete_evidence_rows(db, [evidence.id])
    db.commit()


@router.get("/notifications", response_model=list[QCNotificationSummary])
def list_worker_notifications(
    worker=Depends(get_current_worker),
    db: Session = Depends(get_db),
) -> list[QCNotificationSummary]:
    rows = list(
        db.execute(
            select(QCNotification, QCReworkTask, QCCheckInstance, Station, WorkUnit, PanelUnit)
            .join(QCReworkTask, QCNotification.rework_task_id == QCReworkTask.id)
            .join(QCCheckInstance, QCReworkTask.check_instance_id == QCCheckInstance.id)
            .join(WorkUnit, QCCheckInstance.work_unit_id == WorkUnit.id)
            .join(Station, QCCheckInstance.station_id == Station.id, isouter=True)
            .join(PanelUnit, QCCheckInstance.panel_unit_id == PanelUnit.id, isouter=True)
            .where(QCNotification.worker_id == worker.id)
            .where(QCNotification.status == QCNotificationStatus.ACTIVE)
            .order_by(QCNotification.created_at.desc())
        )
    )
    notifications: list[QCNotificationSummary] = []
    for notification, rework, check_instance, station, work_unit, panel_unit in rows:
        panel_code = panel_unit.panel_definition.panel_code if panel_unit else None
        station_name = station.name if station else None
        notifications.append(
            QCNotificationSummary(
                id=notification.id,
                worker_id=notification.worker_id,
                rework_task_id=rework.id,
                status=notification.status.value,
                created_at=notification.created_at,
                seen_at=notification.seen_at,
                module_number=work_unit.module_number,
                panel_code=panel_code,
                station_name=station_name,
                description=rework.description,
            )
        )
    return notifications


@router.post("/notifications/{notification_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
def dismiss_notification(
    notification_id: int,
    worker=Depends(get_current_worker),
    db: Session = Depends(get_db),
) -> None:
    notification = db.get(QCNotification, notification_id)
    if not notification or notification.worker_id != worker.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    notification.status = QCNotificationStatus.DISMISSED
    notification.seen_at = utc_now()
    db.commit()


def _get_or_create_rework_task_definition(db: Session, scope: TaskScope) -> TaskDefinition:
    name = "QC Rework (Panel)" if scope == TaskScope.PANEL else "QC Rework (Module)"
    task = (
        db.execute(
            select(TaskDefinition)
            .where(TaskDefinition.is_rework == True)
            .where(TaskDefinition.scope == scope)
            .where(TaskDefinition.archived_at.is_(None))
        )
        .scalars()
        .first()
    )
    if task:
        return task
    _ensure_task_definition_sequence(db)
    task = TaskDefinition(
        name=name,
        scope=scope,
        default_station_sequence=None,
        active=True,
        skippable=False,
        concurrent_allowed=False,
        advance_trigger=False,
        is_rework=True,
        dependencies_json=None,
    )
    db.add(task)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = (
            db.execute(
                select(TaskDefinition)
                .where(TaskDefinition.is_rework == True)
                .where(TaskDefinition.scope == scope)
                .where(TaskDefinition.archived_at.is_(None))
            )
            .scalars()
            .first()
        )
        if existing:
            return existing
        _ensure_task_definition_sequence(db)
        task = TaskDefinition(
            name=name,
            scope=scope,
            default_station_sequence=None,
            active=True,
            skippable=False,
            concurrent_allowed=False,
            advance_trigger=False,
            is_rework=True,
            dependencies_json=None,
        )
        db.add(task)
        db.flush()
    db.refresh(task)
    return task


def _ensure_task_definition_sequence(db: Session) -> None:
    try:
        max_id = db.execute(select(func.max(TaskDefinition.id))).scalar() or 0
        db.execute(
            text(
                "SELECT setval(pg_get_serial_sequence('task_definitions', 'id'), :value)"
            ),
            {"value": max_id},
        )
    except Exception:
        # Non-Postgres or sequence mismatch can be ignored.
        return


def _active_rework_instance(db: Session, rework_task_id: int) -> TaskInstance | None:
    return (
        db.execute(
            select(TaskInstance)
            .where(TaskInstance.rework_task_id == rework_task_id)
            .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
            .order_by(TaskInstance.started_at.desc().nullslast(), TaskInstance.id.desc())
        )
        .scalars()
        .first()
    )


def _ensure_participations(
    db: Session, instance: TaskInstance, worker_ids: list[int]
) -> None:
    existing_ids = set(
        db.execute(
            select(TaskParticipation.worker_id)
            .where(TaskParticipation.task_instance_id == instance.id)
            .where(TaskParticipation.left_at.is_(None))
        ).scalars()
    )
    now = utc_now()
    for worker_id in worker_ids:
        if worker_id in existing_ids:
            continue
        db.add(
            TaskParticipation(
                task_instance_id=instance.id,
                worker_id=worker_id,
                joined_at=now,
            )
        )


@router.post("/rework-tasks/{rework_task_id}/start")
def start_rework_task(
    rework_task_id: int,
    payload: QCReworkStartRequest,
    worker=Depends(get_current_worker),
    db: Session = Depends(get_db),
) -> None:
    rework = db.get(QCReworkTask, rework_task_id)
    if not rework:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rework task not found")
    if rework.status in (QCReworkStatus.DONE, QCReworkStatus.CANCELED):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Rework task already closed")

    worker_ids = payload.worker_ids or [worker.id]
    if worker.id not in worker_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker must join rework")
    unique_worker_ids = sorted(set(worker_ids))

    check_instance = db.get(QCCheckInstance, rework.check_instance_id)
    if not check_instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC check not found")

    station_id = payload.station_id or check_instance.station_id
    if station_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Station is required")

    scope = check_instance.scope
    task_def = _get_or_create_rework_task_definition(db, scope)
    instance = _active_rework_instance(db, rework.id)
    if enforce_no_active_tasks(
        db, unique_worker_ids, exclude_instance_id=instance.id if instance else None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="One or more workers already have an active task",
        )
    now = utc_now()
    if instance:
        if instance.status == TaskStatus.PAUSED:
            instance.status = TaskStatus.IN_PROGRESS
            pause = (
                db.execute(
                    select(TaskPause)
                    .where(TaskPause.task_instance_id == instance.id)
                    .where(TaskPause.resumed_at.is_(None))
                    .order_by(TaskPause.paused_at.desc())
                    .limit(1)
                )
                .scalar_one_or_none()
            )
            if pause:
                pause.resumed_at = now
        _ensure_participations(db, instance, unique_worker_ids)
    else:
        instance = TaskInstance(
            task_definition_id=task_def.id,
            scope=scope,
            work_unit_id=check_instance.work_unit_id,
            panel_unit_id=check_instance.panel_unit_id,
            station_id=station_id,
            rework_task_id=rework.id,
            status=TaskStatus.IN_PROGRESS,
            started_at=now,
            completed_at=None,
            notes=None,
        )
        db.add(instance)
        db.flush()
        _ensure_participations(db, instance, unique_worker_ids)

    if rework.status == QCReworkStatus.OPEN:
        rework.status = QCReworkStatus.IN_PROGRESS

    db.commit()


@router.post("/rework-tasks/{rework_task_id}/pause", status_code=status.HTTP_204_NO_CONTENT)
def pause_rework_task(
    rework_task_id: int,
    payload: QCReworkPauseRequest,
    worker=Depends(get_current_worker),
    db: Session = Depends(get_db),
) -> None:
    instance = _active_rework_instance(db, rework_task_id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active rework not found")
    participation = (
        db.execute(
            select(TaskParticipation)
            .where(TaskParticipation.task_instance_id == instance.id)
            .where(TaskParticipation.worker_id == worker.id)
            .where(TaskParticipation.left_at.is_(None))
        )
        .scalars()
        .first()
    )
    if not participation:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker not participating")
    if instance.status == TaskStatus.COMPLETED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rework already completed")

    instance.status = TaskStatus.PAUSED
    db.add(
        TaskPause(
            task_instance_id=instance.id,
            reason_id=payload.reason_id,
            reason_text=payload.reason_text,
            paused_at=utc_now(),
        )
    )
    db.commit()


@router.post("/rework-tasks/{rework_task_id}/resume", status_code=status.HTTP_204_NO_CONTENT)
def resume_rework_task(
    rework_task_id: int,
    worker=Depends(get_current_worker),
    db: Session = Depends(get_db),
) -> None:
    instance = _active_rework_instance(db, rework_task_id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active rework not found")
    participation = (
        db.execute(
            select(TaskParticipation)
            .where(TaskParticipation.task_instance_id == instance.id)
            .where(TaskParticipation.worker_id == worker.id)
            .where(TaskParticipation.left_at.is_(None))
        )
        .scalars()
        .first()
    )
    if not participation:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker not participating")

    if enforce_no_active_tasks(db, [worker.id], exclude_instance_id=instance.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Worker already has another active task",
        )
    if instance.status == TaskStatus.COMPLETED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rework already completed")
    if instance.status == TaskStatus.IN_PROGRESS:
        return

    instance.status = TaskStatus.IN_PROGRESS
    pause = (
        db.execute(
            select(TaskPause)
            .where(TaskPause.task_instance_id == instance.id)
            .where(TaskPause.resumed_at.is_(None))
            .order_by(TaskPause.paused_at.desc())
            .limit(1)
        )
        .scalar_one_or_none()
    )
    if pause:
        pause.resumed_at = utc_now()
    db.commit()


@router.post("/rework-tasks/{rework_task_id}/complete", status_code=status.HTTP_204_NO_CONTENT)
def complete_rework_task(
    rework_task_id: int,
    worker=Depends(get_current_worker),
    db: Session = Depends(get_db),
) -> None:
    instance = _active_rework_instance(db, rework_task_id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active rework not found")
    participation = (
        db.execute(
            select(TaskParticipation)
            .where(TaskParticipation.task_instance_id == instance.id)
            .where(TaskParticipation.worker_id == worker.id)
            .where(TaskParticipation.left_at.is_(None))
        )
        .scalars()
        .first()
    )
    if not participation:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker not participating")
    if instance.status == TaskStatus.COMPLETED:
        return

    now = utc_now()
    instance.status = TaskStatus.COMPLETED
    instance.completed_at = now
    participations = list(
        db.execute(
            select(TaskParticipation)
            .where(TaskParticipation.task_instance_id == instance.id)
            .where(TaskParticipation.left_at.is_(None))
        ).scalars()
    )
    for participation in participations:
        participation.left_at = now
    open_pauses = list(
        db.execute(
            select(TaskPause)
            .where(TaskPause.task_instance_id == instance.id)
            .where(TaskPause.resumed_at.is_(None))
        ).scalars()
    )
    for pause in open_pauses:
        pause.resumed_at = now

    rework = db.get(QCReworkTask, rework_task_id)
    if rework:
        rework.status = QCReworkStatus.DONE
        check_instance = db.get(QCCheckInstance, rework.check_instance_id)
        if check_instance:
            check_instance.status = QCCheckStatus.OPEN
            check_instance.closed_at = None
        notifications = list(
            db.execute(
                select(QCNotification)
                .where(QCNotification.rework_task_id == rework.id)
                .where(QCNotification.status == QCNotificationStatus.ACTIVE)
            ).scalars()
        )
        for notification in notifications:
            notification.status = QCNotificationStatus.DISMISSED
            notification.seen_at = now

    db.commit()


@router.post("/rework-tasks/{rework_task_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
def cancel_rework_task(
    rework_task_id: int,
    _admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> None:
    rework = db.get(QCReworkTask, rework_task_id)
    if not rework:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rework task not found")
    if rework.status in (QCReworkStatus.DONE, QCReworkStatus.CANCELED):
        return
    rework.status = QCReworkStatus.CANCELED
    db.commit()


@router.get("/library/work-units", response_model=list[QCLibraryWorkUnitSummary])
def list_library_work_units(
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    include_planned: bool = Query(default=True),
    sort: str = Query(default="planned_sequence"),
    q: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[QCLibraryWorkUnitSummary]:
    stmt = (
        select(WorkUnit, WorkOrder, HouseType)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
    )
    if not include_planned:
        stmt = stmt.where(WorkUnit.status != WorkUnitStatus.PLANNED)
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                WorkOrder.house_identifier.ilike(pattern),
                WorkOrder.project_name.ilike(pattern),
                HouseType.name.ilike(pattern),
                cast(WorkUnit.module_number, String).ilike(pattern),
            )
        )
    if sort == "newest":
        last_exec_ts = (
            select(func.max(QCExecution.performed_at))
            .join(QCCheckInstance, QCExecution.check_instance_id == QCCheckInstance.id)
            .where(QCCheckInstance.work_unit_id == WorkUnit.id)
            .correlate(WorkUnit)
            .scalar_subquery()
        )
        activity_ts = func.coalesce(last_exec_ts, WorkUnit.planned_start_datetime)
        stmt = stmt.order_by(
            case((activity_ts.is_(None), 1), else_=0),
            activity_ts.desc(),
            WorkUnit.id.desc(),
        )
    else:
        stmt = stmt.order_by(WorkUnit.planned_sequence)
    if offset:
        stmt = stmt.offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)

    work_rows = list(db.execute(stmt))

    summaries: list[QCLibraryWorkUnitSummary] = []
    for work_unit, work_order, house_type in work_rows:
        open_checks = db.execute(
            select(QCCheckInstance.id)
            .where(QCCheckInstance.work_unit_id == work_unit.id)
            .where(QCCheckInstance.status == QCCheckStatus.OPEN)
        ).scalars().all()
        open_rework = db.execute(
            select(QCReworkTask.id)
            .join(QCCheckInstance, QCReworkTask.check_instance_id == QCCheckInstance.id)
            .where(QCCheckInstance.work_unit_id == work_unit.id)
            .where(QCReworkTask.status.in_([QCReworkStatus.OPEN, QCReworkStatus.IN_PROGRESS]))
        ).scalars().all()
        last_exec = (
            db.execute(
                select(QCExecution)
                .join(QCCheckInstance, QCExecution.check_instance_id == QCCheckInstance.id)
                .where(QCCheckInstance.work_unit_id == work_unit.id)
                .order_by(QCExecution.performed_at.desc())
                .limit(1)
            )
            .scalars()
            .first()
        )
        summaries.append(
            QCLibraryWorkUnitSummary(
                work_unit_id=work_unit.id,
                module_number=work_unit.module_number,
                house_identifier=work_order.house_identifier if work_order else None,
                project_name=work_order.project_name,
                house_type_name=house_type.name,
                status=work_unit.status.value,
                open_checks=len(open_checks),
                open_rework=len(open_rework),
                last_outcome=last_exec.outcome if last_exec else None,
                last_outcome_at=last_exec.performed_at if last_exec else None,
            )
        )
    return summaries


@router.get("/library/work-units/{work_unit_id}", response_model=QCLibraryWorkUnitDetail)
def library_work_unit_detail(
    work_unit_id: int,
    db: Session = Depends(get_db),
) -> QCLibraryWorkUnitDetail:
    work_unit = db.get(WorkUnit, work_unit_id)
    if not work_unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work unit not found")
    work_order = db.get(WorkOrder, work_unit.work_order_id)
    house_type = db.get(HouseType, work_order.house_type_id)

    check_instances = list(
        db.execute(
            select(QCCheckInstance)
            .where(QCCheckInstance.work_unit_id == work_unit.id)
            .order_by(QCCheckInstance.opened_at.desc())
        ).scalars()
    )
    check_summaries = []
    for instance in check_instances:
        check_def = db.get(QCCheckDefinition, instance.check_definition_id) if instance.check_definition_id else None
        station_name = db.get(Station, instance.station_id).name if instance.station_id else None
        panel_code = None
        if instance.panel_unit_id:
            panel = db.get(PanelUnit, instance.panel_unit_id)
            panel_code = panel.panel_definition.panel_code if panel else None
        current_station_id, current_station_name = _resolve_current_station(
            db, instance.work_unit_id, instance.panel_unit_id
        )
        check_summaries.append(
            _build_check_summary(
                instance,
                check_def.name if check_def else instance.ad_hoc_title,
                station_name,
                current_station_id,
                current_station_name,
                work_unit.module_number,
                panel_code,
            )
        )

    executions: list[QCExecutionRead] = []
    evidence: list[QCEvidenceSummary] = []
    for instance in check_instances:
        exec_rows = list(
            db.execute(
                select(QCExecution)
                .where(QCExecution.check_instance_id == instance.id)
                .order_by(QCExecution.performed_at.desc())
            ).scalars()
        )
        for execution in exec_rows:
            executions.append(
                QCExecutionRead(
                    id=execution.id,
                    check_instance_id=execution.check_instance_id,
                    outcome=execution.outcome,
                    notes=execution.notes,
                    performed_by_user_id=execution.performed_by_user_id,
                    performed_at=execution.performed_at,
                    failure_modes=[],
                )
            )
            evidence_rows = list(
                db.execute(
                    select(QCEvidence, MediaAsset)
                    .join(MediaAsset, QCEvidence.media_asset_id == MediaAsset.id)
                    .where(QCEvidence.execution_id == execution.id)
                )
            )
            for evidence_row, media in evidence_rows:
                evidence.append(
                    QCEvidenceSummary(
                        id=evidence_row.id,
                        execution_id=evidence_row.execution_id,
                        media_asset_id=media.id,
                        uri=f"/media_gallery/{media.storage_key}",
                        mime_type=media.mime_type,
                        captured_at=evidence_row.captured_at,
                    )
                )

    reworks = list(
        db.execute(
            select(QCReworkTask)
            .join(QCCheckInstance, QCReworkTask.check_instance_id == QCCheckInstance.id)
            .where(QCCheckInstance.work_unit_id == work_unit.id)
            .order_by(QCReworkTask.created_at.desc())
        ).scalars()
    )
    rework_summaries = []
    for rework in reworks:
        check_instance = db.get(QCCheckInstance, rework.check_instance_id)
        station_name = db.get(Station, check_instance.station_id).name if check_instance and check_instance.station_id else None
        panel_code = None
        if check_instance and check_instance.panel_unit_id:
            panel = db.get(PanelUnit, check_instance.panel_unit_id)
            panel_code = panel.panel_definition.panel_code if panel else None
        current_station_id, current_station_name = _resolve_current_station(
            db,
            check_instance.work_unit_id if check_instance else work_unit.id,
            check_instance.panel_unit_id if check_instance else None,
        )
        rework_summaries.append(
            _build_rework_summary(
                rework,
                check_instance.work_unit_id if check_instance else work_unit.id,
                check_instance.panel_unit_id if check_instance else None,
                work_unit.module_number,
                panel_code,
                check_instance.station_id if check_instance else None,
                station_name,
                current_station_id,
                current_station_name,
                check_instance.status if check_instance else None,
                check_instance.severity_level if check_instance else None,
                (
                    db.execute(
                        select(TaskInstance.status)
                        .where(TaskInstance.rework_task_id == rework.id)
                        .order_by(TaskInstance.started_at.desc().nullslast(), TaskInstance.id.desc())
                        .limit(1)
                    )
                    .scalars()
                    .first()
                ),
            )
        )

    return QCLibraryWorkUnitDetail(
        work_unit_id=work_unit.id,
        module_number=work_unit.module_number,
        house_identifier=work_order.house_identifier if work_order else None,
        project_name=work_order.project_name if work_order else "",
        house_type_name=house_type.name if house_type else "",
        status=work_unit.status.value,
        checks=check_summaries,
        executions=executions,
        rework_tasks=rework_summaries,
        evidence=evidence,
    )


__all__ = ["router"]
