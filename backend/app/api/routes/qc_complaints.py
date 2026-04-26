from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin, get_current_supervisor, get_db
from app.core.config import BASE_DIR
from app.core.security import utc_now
from app.models.admin import AdminUser
from app.models.enums import (
    QCComplaintActorType,
    QCComplaintEventType,
    QCComplaintMediaRole,
    QCComplaintStatus,
    QCNotificationStatus,
    QCSeverityLevel,
)
from app.models.house import HouseType, PanelDefinition
from app.models.qc import (
    MediaAsset,
    QCQualityComplaint,
    QCQualityComplaintEvent,
    QCQualityComplaintMedia,
    QCQualityComplaintNotification,
    QCQualityComplaintSupervisor,
)
from app.models.stations import Station
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.models.workers import WorkerSupervisor
from app.schemas.qc_complaints import (
    QCComplaintClosureReview,
    QCComplaintCreate,
    QCComplaintDetail,
    QCComplaintEventCreate,
    QCComplaintEventRead,
    QCComplaintMediaRead,
    QCComplaintNotificationRead,
    QCComplaintSummary,
    QCComplaintSupervisorRead,
)

router = APIRouter()

MEDIA_GALLERY_DIR = BASE_DIR / "media_gallery"
QC_COMPLAINT_DIR = MEDIA_GALLERY_DIR / "qc_complaints"
QC_ROLE_VALUES = {"Calidad", "QC"}
MAX_QC_COMPLAINT_MEDIA_BYTES = 50 * 1024 * 1024
QC_COMPLAINT_MIME_PREFIXES = ("image/", "video/")


def _require_qc_admin(admin: AdminUser) -> AdminUser:
    if admin.role not in QC_ROLE_VALUES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="QC role required"
        )
    return admin


def _delete_media_file(storage_key: str) -> None:
    file_path = MEDIA_GALLERY_DIR / storage_key
    try:
        if file_path.exists():
            file_path.unlink()
    except OSError:
        return


def _store_upload(file: UploadFile, dest_path: Path) -> int:
    size_bytes = 0
    try:
        with dest_path.open("wb") as buffer:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                size_bytes += len(chunk)
                if size_bytes > MAX_QC_COMPLAINT_MEDIA_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="QC complaint media exceeds 50 MB limit",
                    )
                buffer.write(chunk)
    except HTTPException:
        _delete_media_file(dest_path.relative_to(MEDIA_GALLERY_DIR).as_posix())
        raise
    return size_bytes


def _validate_work_context(
    db: Session, work_unit_id: int, panel_unit_id: int | None, station_id: int | None
) -> None:
    work_unit = db.get(WorkUnit, work_unit_id)
    if not work_unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work unit not found")
    if panel_unit_id is not None:
        panel = db.get(PanelUnit, panel_unit_id)
        if not panel or panel.work_unit_id != work_unit_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Panel does not belong to the selected module",
            )
    if station_id is not None and not db.get(Station, station_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Station not found")


def _resolve_complaint_station_id(
    db: Session, work_unit_id: int, panel_unit_id: int | None, station_id: int | None
) -> int | None:
    if station_id is not None:
        return station_id
    if panel_unit_id is not None:
        panel = db.get(PanelUnit, panel_unit_id)
        if panel and panel.current_station_id is not None:
            return panel.current_station_id
    work_unit = db.get(WorkUnit, work_unit_id)
    return work_unit.current_station_id if work_unit else None


def _load_supervisors(db: Session, supervisor_ids: list[int]) -> list[WorkerSupervisor]:
    unique_ids = sorted(set(supervisor_ids))
    if not unique_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one supervisor is required",
        )
    supervisors = list(
        db.execute(
            select(WorkerSupervisor).where(WorkerSupervisor.id.in_(unique_ids))
        ).scalars()
    )
    if len(supervisors) != len(unique_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One or more supervisors were not found",
        )
    return supervisors


def _work_context_rows(db: Session, complaint_ids: list[int]) -> dict[int, dict]:
    if not complaint_ids:
        return {}
    rows = db.execute(
        select(
            QCQualityComplaint.id,
            WorkUnit.module_number,
            WorkOrder.house_identifier,
            WorkOrder.project_name,
            HouseType.name.label("house_type_name"),
            Station.name.label("station_name"),
            PanelDefinition.panel_code,
        )
        .join(WorkUnit, QCQualityComplaint.work_unit_id == WorkUnit.id)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
        .outerjoin(Station, QCQualityComplaint.station_id == Station.id)
        .outerjoin(PanelUnit, QCQualityComplaint.panel_unit_id == PanelUnit.id)
        .outerjoin(PanelDefinition, PanelUnit.panel_definition_id == PanelDefinition.id)
        .where(QCQualityComplaint.id.in_(complaint_ids))
    ).all()
    return {
        row.id: {
            "module_number": row.module_number,
            "house_identifier": row.house_identifier,
            "project_name": row.project_name,
            "house_type_name": row.house_type_name,
            "station_name": row.station_name,
            "panel_code": row.panel_code,
        }
        for row in rows
    }


def _actor_names(db: Session, events: list[QCQualityComplaintEvent]) -> dict[int, str]:
    admin_ids = {event.actor_user_id for event in events if event.actor_user_id}
    supervisor_ids = {
        event.actor_supervisor_id for event in events if event.actor_supervisor_id
    }
    names: dict[int, str] = {}
    if admin_ids:
        for admin in db.execute(select(AdminUser).where(AdminUser.id.in_(admin_ids))).scalars():
            names[("admin", admin.id)] = f"{admin.first_name} {admin.last_name}"
    if supervisor_ids:
        for supervisor in db.execute(
            select(WorkerSupervisor).where(WorkerSupervisor.id.in_(supervisor_ids))
        ).scalars():
            names[("supervisor", supervisor.id)] = (
                f"{supervisor.first_name} {supervisor.last_name}"
            )
    return names


def _media_for_complaints(
    db: Session, complaint_ids: list[int]
) -> tuple[dict[int, list[QCComplaintMediaRead]], dict[int, list[QCComplaintMediaRead]]]:
    if not complaint_ids:
        return {}, {}
    rows = db.execute(
        select(QCQualityComplaintMedia, MediaAsset)
        .join(MediaAsset, QCQualityComplaintMedia.media_asset_id == MediaAsset.id)
        .where(QCQualityComplaintMedia.complaint_id.in_(complaint_ids))
        .order_by(QCQualityComplaintMedia.created_at)
    ).all()
    by_complaint: dict[int, list[QCComplaintMediaRead]] = {}
    by_event: dict[int, list[QCComplaintMediaRead]] = {}
    for media, asset in rows:
        item = QCComplaintMediaRead(
            id=media.id,
            event_id=media.event_id,
            media_asset_id=asset.id,
            role=media.role,
            uri=f"/media_gallery/{asset.storage_key}",
            mime_type=asset.mime_type,
            created_at=media.created_at,
        )
        by_complaint.setdefault(media.complaint_id, []).append(item)
        if media.event_id:
            by_event.setdefault(media.event_id, []).append(item)
    return by_complaint, by_event


def _build_summaries(
    db: Session, complaints: list[QCQualityComplaint]
) -> list[QCComplaintSummary]:
    complaint_ids = [complaint.id for complaint in complaints]
    work_context = _work_context_rows(db, complaint_ids)
    by_complaint_media, _ = _media_for_complaints(db, complaint_ids)
    latest_rows = db.execute(
        select(
            QCQualityComplaintEvent.complaint_id,
            func.count(QCQualityComplaintEvent.id),
            func.max(QCQualityComplaintEvent.created_at),
        )
        .where(QCQualityComplaintEvent.complaint_id.in_(complaint_ids or [0]))
        .group_by(QCQualityComplaintEvent.complaint_id)
    ).all()
    event_stats = {row[0]: {"count": row[1], "latest": row[2]} for row in latest_rows}

    admin_ids = {complaint.created_by_user_id for complaint in complaints if complaint.created_by_user_id}
    admins = {
        admin.id: f"{admin.first_name} {admin.last_name}"
        for admin in db.execute(select(AdminUser).where(AdminUser.id.in_(admin_ids or {0}))).scalars()
    }
    summaries = []
    for complaint in complaints:
        context = work_context.get(complaint.id, {})
        supervisors = [
            QCComplaintSupervisorRead(
                id=link.supervisor_id,
                first_name=getattr(link, "first_name", ""),
                last_name=getattr(link, "last_name", ""),
            )
            for link in []
        ]
        supervisor_ids = [link.supervisor_id for link in complaint.supervisors]
        if supervisor_ids:
            supervisors = [
                QCComplaintSupervisorRead(
                    id=supervisor.id,
                    first_name=supervisor.first_name,
                    last_name=supervisor.last_name,
                )
                for supervisor in db.execute(
                    select(WorkerSupervisor)
                    .where(WorkerSupervisor.id.in_(supervisor_ids))
                    .order_by(WorkerSupervisor.last_name, WorkerSupervisor.first_name)
                ).scalars()
            ]
        stats = event_stats.get(complaint.id, {"count": 0, "latest": None})
        summaries.append(
            QCComplaintSummary(
                id=complaint.id,
                work_unit_id=complaint.work_unit_id,
                panel_unit_id=complaint.panel_unit_id,
                station_id=complaint.station_id,
                station_name=context.get("station_name"),
                title=complaint.title,
                description=complaint.description,
                severity_level=complaint.severity_level,
                status=complaint.status,
                created_by_user_id=complaint.created_by_user_id,
                created_by_name=admins.get(complaint.created_by_user_id or 0),
                created_at=complaint.created_at,
                updated_at=complaint.updated_at,
                closure_proposed_at=complaint.closure_proposed_at,
                closed_at=complaint.closed_at,
                module_number=context.get("module_number", 0),
                house_identifier=context.get("house_identifier"),
                project_name=context.get("project_name", ""),
                house_type_name=context.get("house_type_name", ""),
                panel_code=context.get("panel_code"),
                supervisors=supervisors,
                media_count=len(by_complaint_media.get(complaint.id, [])),
                event_count=stats["count"],
                latest_event_at=stats["latest"],
            )
        )
    return summaries


def _create_event(
    db: Session,
    complaint: QCQualityComplaint,
    *,
    actor_type: QCComplaintActorType,
    event_type: QCComplaintEventType,
    message: str | None,
    admin: AdminUser | None = None,
    supervisor: WorkerSupervisor | None = None,
) -> QCQualityComplaintEvent:
    now = utc_now()
    event = QCQualityComplaintEvent(
        complaint_id=complaint.id,
        actor_type=actor_type,
        actor_user_id=admin.id if admin else None,
        actor_supervisor_id=supervisor.id if supervisor else None,
        event_type=event_type,
        message=message.strip() if message and message.strip() else None,
        created_at=now,
    )
    complaint.updated_at = now
    db.add(event)
    db.flush()
    if actor_type == QCComplaintActorType.QC:
        for link in complaint.supervisors:
            db.add(
                QCQualityComplaintNotification(
                    complaint_id=complaint.id,
                    supervisor_id=link.supervisor_id,
                    event_id=event.id,
                    status=QCNotificationStatus.ACTIVE,
                    created_at=now,
                )
            )
    return event


def _load_supervisor_complaint(
    db: Session, complaint_id: int, supervisor: WorkerSupervisor
) -> QCQualityComplaint:
    complaint = db.execute(
        select(QCQualityComplaint)
        .join(QCQualityComplaintSupervisor)
        .options(selectinload(QCQualityComplaint.supervisors))
        .where(QCQualityComplaint.id == complaint_id)
        .where(QCQualityComplaintSupervisor.supervisor_id == supervisor.id)
    ).scalar_one_or_none()
    if not complaint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Complaint not found")
    return complaint


def _store_event_media(
    db: Session,
    complaint: QCQualityComplaint,
    event: QCQualityComplaintEvent,
    file: UploadFile,
) -> QCComplaintMediaRead:
    if complaint.status == QCComplaintStatus.CLOSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Complaint is closed")
    if not file.content_type or not file.content_type.startswith(QC_COMPLAINT_MIME_PREFIXES):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only image and video uploads are supported",
        )

    QC_COMPLAINT_DIR.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "").suffix or ""
    storage_key = f"qc_complaints/{uuid4().hex}{ext}"
    dest_path = MEDIA_GALLERY_DIR / storage_key
    size_bytes = _store_upload(file, dest_path)
    now = utc_now()
    asset = MediaAsset(
        storage_key=storage_key,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=size_bytes,
        width=None,
        height=None,
        watermark_text=None,
        created_at=now,
    )
    db.add(asset)
    db.flush()
    if event.event_type == QCComplaintEventType.CREATED:
        role = QCComplaintMediaRole.INITIAL
    elif event.event_type == QCComplaintEventType.CLOSURE_PROPOSED:
        role = QCComplaintMediaRole.CLOSURE_PROPOSAL
    elif event.event_type == QCComplaintEventType.CLOSURE_REJECTED:
        role = QCComplaintMediaRole.QC_REJECTION
    else:
        role = QCComplaintMediaRole.COMMENT
    media = QCQualityComplaintMedia(
        complaint_id=complaint.id,
        event_id=event.id,
        media_asset_id=asset.id,
        role=role,
        created_at=now,
    )
    complaint.updated_at = now
    db.add(media)
    db.commit()
    db.refresh(media)
    return QCComplaintMediaRead(
        id=media.id,
        event_id=event.id,
        media_asset_id=asset.id,
        role=media.role,
        uri=f"/media_gallery/{storage_key}",
        mime_type=asset.mime_type,
        created_at=media.created_at,
    )


@router.get("/complaints", response_model=list[QCComplaintSummary])
def list_complaints(
    status_filter: QCComplaintStatus | None = Query(None, alias="status"),
    work_unit_id: int | None = None,
    supervisor_id: int | None = None,
    severity_level: QCSeverityLevel | None = None,
    db: Session = Depends(get_db),
) -> list[QCComplaintSummary]:
    stmt = (
        select(QCQualityComplaint)
        .options(selectinload(QCQualityComplaint.supervisors))
        .order_by(QCQualityComplaint.updated_at.desc(), QCQualityComplaint.id.desc())
    )
    if status_filter is not None:
        stmt = stmt.where(QCQualityComplaint.status == status_filter)
    if work_unit_id is not None:
        stmt = stmt.where(QCQualityComplaint.work_unit_id == work_unit_id)
    if severity_level is not None:
        stmt = stmt.where(QCQualityComplaint.severity_level == severity_level)
    if supervisor_id is not None:
        stmt = stmt.join(QCQualityComplaintSupervisor).where(
            QCQualityComplaintSupervisor.supervisor_id == supervisor_id
        )
    complaints = list(db.execute(stmt).scalars().unique())
    return _build_summaries(db, complaints)


@router.get("/supervisor/complaints", response_model=list[QCComplaintSummary])
def list_current_supervisor_complaints(
    status_filter: QCComplaintStatus | None = Query(None, alias="status"),
    work_unit_id: int | None = None,
    db: Session = Depends(get_db),
    supervisor: WorkerSupervisor = Depends(get_current_supervisor),
) -> list[QCComplaintSummary]:
    stmt = (
        select(QCQualityComplaint)
        .join(QCQualityComplaintSupervisor)
        .options(selectinload(QCQualityComplaint.supervisors))
        .where(QCQualityComplaintSupervisor.supervisor_id == supervisor.id)
        .order_by(QCQualityComplaint.updated_at.desc(), QCQualityComplaint.id.desc())
    )
    if status_filter is not None:
        stmt = stmt.where(QCQualityComplaint.status == status_filter)
    if work_unit_id is not None:
        stmt = stmt.where(QCQualityComplaint.work_unit_id == work_unit_id)
    complaints = list(db.execute(stmt).scalars().unique())
    return _build_summaries(db, complaints)


def _build_detail(db: Session, complaint: QCQualityComplaint) -> QCComplaintDetail:
    summary = _build_summaries(db, [complaint])[0]
    events = list(
        db.execute(
            select(QCQualityComplaintEvent)
            .where(QCQualityComplaintEvent.complaint_id == complaint.id)
            .order_by(QCQualityComplaintEvent.created_at, QCQualityComplaintEvent.id)
        ).scalars()
    )
    _, media_by_event = _media_for_complaints(db, [complaint.id])
    names = _actor_names(db, events)
    event_reads = [
        QCComplaintEventRead(
            id=event.id,
            complaint_id=event.complaint_id,
            actor_type=event.actor_type,
            actor_user_id=event.actor_user_id,
            actor_supervisor_id=event.actor_supervisor_id,
            actor_name=names.get(("admin", event.actor_user_id))
            if event.actor_user_id
            else names.get(("supervisor", event.actor_supervisor_id))
            if event.actor_supervisor_id
            else None,
            event_type=event.event_type,
            message=event.message,
            created_at=event.created_at,
            media=media_by_event.get(event.id, []),
        )
        for event in events
    ]
    return QCComplaintDetail(**summary.model_dump(), events=event_reads)


@router.get("/supervisor/complaints/{complaint_id}", response_model=QCComplaintDetail)
def get_current_supervisor_complaint(
    complaint_id: int,
    db: Session = Depends(get_db),
    supervisor: WorkerSupervisor = Depends(get_current_supervisor),
) -> QCComplaintDetail:
    complaint = _load_supervisor_complaint(db, complaint_id, supervisor)
    return _build_detail(db, complaint)


@router.post("/supervisor/complaints/{complaint_id}/events", response_model=QCComplaintEventRead)
def add_supervisor_comment(
    complaint_id: int,
    payload: QCComplaintEventCreate,
    db: Session = Depends(get_db),
    supervisor: WorkerSupervisor = Depends(get_current_supervisor),
) -> QCComplaintEventRead:
    complaint = _load_supervisor_complaint(db, complaint_id, supervisor)
    if complaint.status == QCComplaintStatus.CLOSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Complaint is closed")
    if not payload.message or not payload.message.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required")
    event = _create_event(
        db,
        complaint,
        actor_type=QCComplaintActorType.SUPERVISOR,
        event_type=QCComplaintEventType.COMMENT,
        message=payload.message,
        supervisor=supervisor,
    )
    db.commit()
    return _build_detail(db, complaint).events[-1]


@router.post("/supervisor/complaints/{complaint_id}/propose-closure", response_model=QCComplaintEventRead)
def propose_supervisor_closure(
    complaint_id: int,
    payload: QCComplaintClosureReview,
    db: Session = Depends(get_db),
    supervisor: WorkerSupervisor = Depends(get_current_supervisor),
) -> QCComplaintEventRead:
    complaint = _load_supervisor_complaint(db, complaint_id, supervisor)
    if complaint.status == QCComplaintStatus.CLOSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Complaint is closed")
    now = utc_now()
    complaint.status = QCComplaintStatus.CLOSURE_PROPOSED
    complaint.closure_proposed_at = now
    event = _create_event(
        db,
        complaint,
        actor_type=QCComplaintActorType.SUPERVISOR,
        event_type=QCComplaintEventType.CLOSURE_PROPOSED,
        message=payload.message,
        supervisor=supervisor,
    )
    db.commit()
    return _build_detail(db, complaint).events[-1]


@router.post(
    "/supervisor/complaints/{complaint_id}/events/{event_id}/media",
    response_model=QCComplaintMediaRead,
)
def upload_supervisor_event_media(
    complaint_id: int,
    event_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    supervisor: WorkerSupervisor = Depends(get_current_supervisor),
) -> QCComplaintMediaRead:
    complaint = _load_supervisor_complaint(db, complaint_id, supervisor)
    event = db.get(QCQualityComplaintEvent, event_id)
    if (
        not event
        or event.complaint_id != complaint_id
        or event.actor_type != QCComplaintActorType.SUPERVISOR
        or event.actor_supervisor_id != supervisor.id
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Complaint event not found")
    return _store_event_media(db, complaint, event, file)


@router.post("/complaints", response_model=QCComplaintDetail, status_code=status.HTTP_201_CREATED)
def create_complaint(
    payload: QCComplaintCreate,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
) -> QCComplaintDetail:
    _require_qc_admin(admin)
    title = payload.title.strip()
    description = payload.description.strip()
    if not title or not description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Title and description are required",
        )
    _validate_work_context(db, payload.work_unit_id, payload.panel_unit_id, payload.station_id)
    supervisors = _load_supervisors(db, payload.supervisor_ids)
    station_id = _resolve_complaint_station_id(
        db, payload.work_unit_id, payload.panel_unit_id, payload.station_id
    )
    now = utc_now()
    complaint = QCQualityComplaint(
        work_unit_id=payload.work_unit_id,
        panel_unit_id=payload.panel_unit_id,
        station_id=station_id,
        title=title,
        description=description,
        severity_level=payload.severity_level,
        status=QCComplaintStatus.OPEN,
        created_by_user_id=admin.id,
        created_at=now,
        updated_at=now,
    )
    db.add(complaint)
    db.flush()
    for supervisor in supervisors:
        db.add(
            QCQualityComplaintSupervisor(
                complaint_id=complaint.id,
                supervisor_id=supervisor.id,
            )
        )
    db.flush()
    db.refresh(complaint, attribute_names=["supervisors"])
    _create_event(
        db,
        complaint,
        actor_type=QCComplaintActorType.QC,
        event_type=QCComplaintEventType.CREATED,
        message=description,
        admin=admin,
    )
    db.commit()
    return get_complaint(complaint.id, db)


@router.get("/complaints/{complaint_id}", response_model=QCComplaintDetail)
def get_complaint(
    complaint_id: int,
    db: Session = Depends(get_db),
) -> QCComplaintDetail:
    complaint = db.execute(
        select(QCQualityComplaint)
        .options(selectinload(QCQualityComplaint.supervisors))
        .where(QCQualityComplaint.id == complaint_id)
    ).scalar_one_or_none()
    if not complaint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Complaint not found")
    return _build_detail(db, complaint)


@router.post("/complaints/{complaint_id}/events", response_model=QCComplaintEventRead)
def add_qc_comment(
    complaint_id: int,
    payload: QCComplaintEventCreate,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
) -> QCComplaintEventRead:
    _require_qc_admin(admin)
    complaint = db.execute(
        select(QCQualityComplaint)
        .options(selectinload(QCQualityComplaint.supervisors))
        .where(QCQualityComplaint.id == complaint_id)
    ).scalar_one_or_none()
    if not complaint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Complaint not found")
    if complaint.status == QCComplaintStatus.CLOSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Complaint is closed")
    if not payload.message or not payload.message.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required")
    event = _create_event(
        db,
        complaint,
        actor_type=QCComplaintActorType.QC,
        event_type=QCComplaintEventType.COMMENT,
        message=payload.message,
        admin=admin,
    )
    db.commit()
    return get_complaint(complaint_id, db).events[-1]


@router.post("/complaints/{complaint_id}/events/{event_id}/media", response_model=QCComplaintMediaRead)
def upload_event_media(
    complaint_id: int,
    event_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
) -> QCComplaintMediaRead:
    _require_qc_admin(admin)
    event = db.get(QCQualityComplaintEvent, event_id)
    if not event or event.complaint_id != complaint_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Complaint event not found")
    complaint = db.get(QCQualityComplaint, complaint_id)
    if not complaint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Complaint not found")
    return _store_event_media(db, complaint, event, file)


@router.post("/complaints/{complaint_id}/accept-closure", response_model=QCComplaintDetail)
def accept_closure(
    complaint_id: int,
    payload: QCComplaintClosureReview,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
) -> QCComplaintDetail:
    _require_qc_admin(admin)
    complaint = db.execute(
        select(QCQualityComplaint)
        .options(selectinload(QCQualityComplaint.supervisors))
        .where(QCQualityComplaint.id == complaint_id)
    ).scalar_one_or_none()
    if not complaint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Complaint not found")
    if complaint.status != QCComplaintStatus.CLOSURE_PROPOSED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Complaint does not have a pending closure proposal",
        )
    now = utc_now()
    complaint.status = QCComplaintStatus.CLOSED
    complaint.closed_at = now
    complaint.updated_at = now
    _create_event(
        db,
        complaint,
        actor_type=QCComplaintActorType.QC,
        event_type=QCComplaintEventType.CLOSURE_ACCEPTED,
        message=payload.message,
        admin=admin,
    )
    db.commit()
    return get_complaint(complaint_id, db)


@router.post("/complaints/{complaint_id}/reject-closure", response_model=QCComplaintDetail)
def reject_closure(
    complaint_id: int,
    payload: QCComplaintClosureReview,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
) -> QCComplaintDetail:
    _require_qc_admin(admin)
    complaint = db.execute(
        select(QCQualityComplaint)
        .options(selectinload(QCQualityComplaint.supervisors))
        .where(QCQualityComplaint.id == complaint_id)
    ).scalar_one_or_none()
    if not complaint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Complaint not found")
    if complaint.status != QCComplaintStatus.CLOSURE_PROPOSED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Complaint does not have a pending closure proposal",
        )
    complaint.status = QCComplaintStatus.OPEN
    complaint.closure_proposed_at = None
    _create_event(
        db,
        complaint,
        actor_type=QCComplaintActorType.QC,
        event_type=QCComplaintEventType.CLOSURE_REJECTED,
        message=payload.message,
        admin=admin,
    )
    db.commit()
    return get_complaint(complaint_id, db)


@router.delete("/complaints/{complaint_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_complaint(
    complaint_id: int,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
) -> Response:
    _require_qc_admin(admin)
    complaint = db.get(QCQualityComplaint, complaint_id)
    if not complaint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Complaint not found")
    if complaint.status == QCComplaintStatus.CLOSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Closed complaints cannot be canceled")
    media_rows = list(
        db.execute(
            select(QCQualityComplaintMedia, MediaAsset)
            .join(MediaAsset, QCQualityComplaintMedia.media_asset_id == MediaAsset.id)
            .where(QCQualityComplaintMedia.complaint_id == complaint_id)
        ).all()
    )
    media_asset_ids = [asset.id for _, asset in media_rows]
    storage_keys = [asset.storage_key for _, asset in media_rows]
    db.delete(complaint)
    if media_asset_ids:
        db.execute(delete(MediaAsset).where(MediaAsset.id.in_(media_asset_ids)))
    db.commit()
    for storage_key in storage_keys:
        _delete_media_file(storage_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/supervisor/complaint-notifications", response_model=list[QCComplaintNotificationRead])
def list_supervisor_notifications(
    db: Session = Depends(get_db),
    supervisor: WorkerSupervisor = Depends(get_current_supervisor),
) -> list[QCComplaintNotificationRead]:
    rows = list(
        db.execute(
            select(QCQualityComplaintNotification)
            .where(QCQualityComplaintNotification.supervisor_id == supervisor.id)
            .order_by(QCQualityComplaintNotification.created_at.desc())
        ).scalars()
    )
    return [QCComplaintNotificationRead.model_validate(row, from_attributes=True) for row in rows]
