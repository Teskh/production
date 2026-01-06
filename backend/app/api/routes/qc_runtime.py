from __future__ import annotations

import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_current_worker, get_db
from app.core.config import BASE_DIR
from app.core.security import utc_now
from app.models.admin import AdminUser
from app.models.enums import (
    QCCheckKind,
    QCCheckOrigin,
    QCCheckStatus,
    QCExecutionOutcome,
    QCNotificationStatus,
    QCReworkStatus,
    TaskScope,
    TaskStatus,
)
from app.models.house import HouseType
from app.models.qc import (
    MediaAsset,
    QCApplicability,
    QCCheckDefinition,
    QCCheckInstance,
    QCCheckMediaAsset,
    QCExecution,
    QCExecutionFailureMode,
    QCFailureModeDefinition,
    QCEvidence,
    QCNotification,
    QCReworkTask,
)
from app.models.stations import Station
from app.models.tasks import TaskDefinition, TaskInstance, TaskParticipation, TaskPause
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.schemas.qc_runtime import (
    QCCheckInstanceDetail,
    QCCheckInstanceSummary,
    QCCheckMediaSummary,
    QCCheckDefinitionSummary,
    QCExecutionCreate,
    QCExecutionFailureModeRead,
    QCExecutionRead,
    QCDashboardResponse,
    QCEvidenceSummary,
    QCFailureModeSummary,
    QCLibraryWorkUnitDetail,
    QCLibraryWorkUnitSummary,
    QCManualCheckCreate,
    QCNotificationSummary,
    QCReworkPauseRequest,
    QCReworkStartRequest,
    QCReworkTaskSummary,
)
from app.services.qc_runtime import (
    apply_failure_modes,
    create_notifications_for_task,
    enforce_no_active_tasks,
    resolve_qc_applicability,
    update_sampling_from_execution,
)

router = APIRouter()
MEDIA_GALLERY_DIR = BASE_DIR / "media_gallery"
QC_EVIDENCE_DIR = MEDIA_GALLERY_DIR / "qc_evidence"
QC_ROLE_VALUES = {"Calidad", "QC"}


def _require_qc_admin(admin: AdminUser) -> AdminUser:
    if admin.role not in QC_ROLE_VALUES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="QC role required"
        )
    return admin


def _build_check_summary(
    instance: QCCheckInstance,
    check_name: str | None,
    station_name: str | None,
    module_number: int,
    panel_code: str | None,
) -> QCCheckInstanceSummary:
    return QCCheckInstanceSummary(
        id=instance.id,
        check_definition_id=instance.check_definition_id,
        check_name=check_name,
        origin=instance.origin,
        scope=instance.scope,
        work_unit_id=instance.work_unit_id,
        panel_unit_id=instance.panel_unit_id,
        station_id=instance.station_id,
        station_name=station_name,
        module_number=module_number,
        panel_code=panel_code,
        status=instance.status,
        severity_level=instance.severity_level,
        opened_at=instance.opened_at,
    )


def _build_rework_summary(
    rework: QCReworkTask,
    work_unit_id: int,
    panel_unit_id: int | None,
    module_number: int,
    panel_code: str | None,
    station_id: int | None,
    station_name: str | None,
) -> QCReworkTaskSummary:
    return QCReworkTaskSummary(
        id=rework.id,
        check_instance_id=rework.check_instance_id,
        description=rework.description,
        status=rework.status,
        work_unit_id=work_unit_id,
        panel_unit_id=panel_unit_id,
        station_id=station_id,
        station_name=station_name,
        module_number=module_number,
        panel_code=panel_code,
        created_at=rework.created_at,
    )


@router.get("/dashboard", response_model=QCDashboardResponse)
def qc_dashboard(
    _admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> QCDashboardResponse:
    _require_qc_admin(_admin)
    pending = list(
        db.execute(
            select(
                QCCheckInstance,
                QCCheckDefinition.name,
                Station.name,
                WorkUnit.module_number,
                PanelUnit.panel_definition_id,
            )
            .join(QCCheckDefinition, QCCheckInstance.check_definition_id == QCCheckDefinition.id, isouter=True)
            .join(Station, QCCheckInstance.station_id == Station.id, isouter=True)
            .join(WorkUnit, QCCheckInstance.work_unit_id == WorkUnit.id)
            .join(PanelUnit, QCCheckInstance.panel_unit_id == PanelUnit.id, isouter=True)
            .where(QCCheckInstance.status == QCCheckStatus.OPEN)
            .order_by(QCCheckInstance.opened_at.desc())
        )
    )

    pending_checks: list[QCCheckInstanceSummary] = []
    for instance, check_name, station_name, module_number, panel_def_id in pending:
        panel_code = None
        if panel_def_id is not None:
            panel = db.get(PanelUnit, instance.panel_unit_id) if instance.panel_unit_id else None
            if panel:
                panel_code = panel.panel_definition.panel_code
        if not check_name:
            check_name = instance.ad_hoc_title
        pending_checks.append(
            _build_check_summary(instance, check_name, station_name, module_number, panel_code)
        )

    rework_rows = list(
        db.execute(
            select(
                QCReworkTask,
                QCCheckInstance.work_unit_id,
                QCCheckInstance.panel_unit_id,
                WorkUnit.module_number,
                Station.id,
                Station.name,
                PanelUnit.id,
            )
            .join(QCCheckInstance, QCReworkTask.check_instance_id == QCCheckInstance.id)
            .join(WorkUnit, QCCheckInstance.work_unit_id == WorkUnit.id)
            .join(Station, QCCheckInstance.station_id == Station.id, isouter=True)
            .join(PanelUnit, QCCheckInstance.panel_unit_id == PanelUnit.id, isouter=True)
            .where(QCReworkTask.status.in_([QCReworkStatus.OPEN, QCReworkStatus.IN_PROGRESS]))
            .order_by(QCReworkTask.created_at.desc())
        )
    )
    rework_tasks: list[QCReworkTaskSummary] = []
    for rework, work_unit_id, panel_unit_id, module_number, station_id, station_name, panel_unit_ref in rework_rows:
        panel_code = None
        if panel_unit_ref:
            panel = db.get(PanelUnit, panel_unit_ref)
            if panel:
                panel_code = panel.panel_definition.panel_code
        rework_tasks.append(
            _build_rework_summary(
                rework,
                work_unit_id,
                panel_unit_id,
                module_number,
                panel_code,
                station_id,
                station_name,
            )
        )

    return QCDashboardResponse(pending_checks=pending_checks, rework_tasks=rework_tasks)


@router.get("/check-instances/{check_instance_id}", response_model=QCCheckInstanceDetail)
def qc_check_instance_detail(
    check_instance_id: int,
    _admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> QCCheckInstanceDetail:
    _require_qc_admin(_admin)
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

    check_summary = _build_check_summary(instance, check_name, station_name, module_number, panel_code)

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
                    media_asset_id=media.id,
                    uri=f"/media_gallery/{media.storage_key}",
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
    rework_summaries = [
        _build_rework_summary(
            rework,
            instance.work_unit_id,
            instance.panel_unit_id,
            module_number,
            panel_code,
            instance.station_id,
            station_name,
        )
        for rework in rework_rows
    ]

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
        evidence=evidence,
    )


@router.post("/check-instances/{check_instance_id}/execute", response_model=QCExecutionRead)
def execute_qc_check(
    check_instance_id: int,
    payload: QCExecutionCreate,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> QCExecutionRead:
    admin = _require_qc_admin(admin)
    instance = db.get(QCCheckInstance, check_instance_id)
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
            rework_description = "Rework required"
        rework = QCReworkTask(
            check_instance_id=instance.id,
            description=rework_description,
            status=QCReworkStatus.OPEN,
            created_at=now,
        )
        db.add(rework)
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
        outcome=execution.outcome,
        notes=execution.notes,
        performed_by_user_id=execution.performed_by_user_id,
        performed_at=execution.performed_at,
        failure_modes=[],
    )
    return execution_read


@router.post("/check-instances/manual", response_model=QCCheckInstanceSummary, status_code=status.HTTP_201_CREATED)
def create_manual_check(
    payload: QCManualCheckCreate,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> QCCheckInstanceSummary:
    work_unit = db.get(WorkUnit, payload.work_unit_id)
    if not work_unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work unit not found")
    if payload.scope == TaskScope.PANEL and payload.panel_unit_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Panel unit required for panel checks")
    if payload.scope != TaskScope.PANEL and payload.panel_unit_id is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Panel unit only allowed for panel checks")
    if payload.panel_unit_id:
        panel = db.get(PanelUnit, payload.panel_unit_id)
        if not panel or panel.work_unit_id != payload.work_unit_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Panel unit not found")
    check_def = None
    if payload.check_definition_id:
        check_def = db.get(QCCheckDefinition, payload.check_definition_id)
        if not check_def:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC check definition not found")
        if check_def.kind != QCCheckKind.MANUAL_TEMPLATE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Check definition is not a manual template",
            )
    if not payload.ad_hoc_title and not check_def:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Manual check title required")

    work_order = db.get(WorkOrder, work_unit.work_order_id)
    if not work_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")

    panel_def_id = None
    if payload.panel_unit_id:
        panel = db.get(PanelUnit, payload.panel_unit_id)
        panel_def_id = panel.panel_definition_id if panel else None

    if check_def:
        applicability = list(
            db.execute(
                select(QCApplicability).where(QCApplicability.check_definition_id == check_def.id)
            ).scalars()
        )
        applies, _force_required = resolve_qc_applicability(
            applicability,
            work_order.house_type_id,
            work_order.sub_type_id,
            work_unit.module_number,
            panel_def_id,
            on_date=utc_now().date(),
        )
        if not applies:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Check does not apply")

    instance = QCCheckInstance(
        check_definition_id=check_def.id if check_def else None,
        origin=QCCheckOrigin.MANUAL,
        ad_hoc_title=payload.ad_hoc_title,
        ad_hoc_guidance=payload.ad_hoc_guidance,
        scope=payload.scope,
        work_unit_id=payload.work_unit_id,
        panel_unit_id=payload.panel_unit_id,
        related_task_instance_id=None,
        station_id=payload.station_id,
        status=QCCheckStatus.OPEN,
        opened_by_user_id=admin.id,
        opened_at=utc_now(),
    )
    db.add(instance)
    db.commit()
    db.refresh(instance)

    station_name = db.get(Station, payload.station_id).name if payload.station_id else None
    panel_code = None
    if payload.panel_unit_id:
        panel = db.get(PanelUnit, payload.panel_unit_id)
        panel_code = panel.panel_definition.panel_code if panel else None

    return _build_check_summary(
        instance,
        check_def.name if check_def else payload.ad_hoc_title,
        station_name,
        work_unit.module_number,
        panel_code,
    )


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

    QC_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "").suffix or ""
    storage_key = f"qc_evidence/{uuid4().hex}{ext}"
    dest_path = MEDIA_GALLERY_DIR / storage_key

    with dest_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    media = MediaAsset(
        storage_key=storage_key,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=dest_path.stat().st_size,
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
        media_asset_id=media.id,
        uri=f"/media_gallery/{storage_key}",
        captured_at=evidence.captured_at,
    )


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
        )
        .scalars()
        .first()
    )
    if task:
        return task
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
    _admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> list[QCLibraryWorkUnitSummary]:
    work_rows = list(
        db.execute(
            select(WorkUnit, WorkOrder, HouseType)
            .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
            .join(HouseType, WorkOrder.house_type_id == HouseType.id)
            .order_by(WorkUnit.planned_sequence)
        )
    )

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
    _admin: AdminUser = Depends(get_current_admin),
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
        check_summaries.append(
            _build_check_summary(
                instance,
                check_def.name if check_def else instance.ad_hoc_title,
                station_name,
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
                        media_asset_id=media.id,
                        uri=f"/media_gallery/{media.storage_key}",
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
        rework_summaries.append(
            _build_rework_summary(
                rework,
                check_instance.work_unit_id if check_instance else work_unit.id,
                check_instance.panel_unit_id if check_instance else None,
                work_unit.module_number,
                panel_code,
                check_instance.station_id if check_instance else None,
                station_name,
            )
        )

    return QCLibraryWorkUnitDetail(
        work_unit_id=work_unit.id,
        module_number=work_unit.module_number,
        house_type_name=house_type.name if house_type else "",
        status=work_unit.status.value,
        checks=check_summaries,
        executions=executions,
        rework_tasks=rework_summaries,
        evidence=evidence,
    )


__all__ = ["router"]
