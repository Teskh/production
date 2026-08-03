from __future__ import annotations

import hashlib
import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import (
    SUPERVISOR_SESSION_COOKIE,
    get_current_admin,
    get_current_supervisor,
    get_current_supervisor_session,
    get_db,
    get_optional_admin,
    get_optional_supervisor,
)
from app.core.config import BASE_DIR, settings
from app.core.deployment import session_cookie_path
from app.core.security import hash_token, new_session_token, session_expiry, utc_now
from app.models.admin import AdminUser
from app.models.enums import AdminRole
from app.models.protocols import (
    SafetyProtocol,
    SafetyProtocolApplicability,
    SafetyProtocolDocument,
    SafetyProtocolSignature,
    SafetyProtocolVersion,
)
from app.models.workers import WorkerSupervisor, WorkerSupervisorSession
from app.schemas.protocols import (
    ProtocolSupervisorSessionLoginRequest,
    ProtocolSupervisorSessionRead,
    ProtocolSupervisorSignatureStatusRead,
    ProtocolSupervisorSummary,
    SafetyProtocolDetailRead,
    SafetyProtocolDiffEntryRead,
    SafetyProtocolDocumentRead,
    SafetyProtocolSignRequest,
    SafetyProtocolSignatureRead,
    SafetyProtocolSummaryRead,
    SafetyProtocolUpdate,
    SafetyProtocolVersionSummaryRead,
)
from app.services.protocols import (
    build_protocol_diff,
    extract_protocol_document_text,
    normalize_signature_name,
    normalized_protocol_document_name,
    resolve_protocol_content_type,
    safe_protocol_filename,
)

router = APIRouter()
MEDIA_GALLERY_DIR = BASE_DIR / "media_gallery"
MAX_PROTOCOL_FILE_BYTES = 50 * 1024 * 1024
PROTOCOL_MANAGER_ROLES = {
    AdminRole.SYSADMIN.value.casefold(),
    AdminRole.PREVENCIONISTA.value.casefold(),
}

MEDIA_GALLERY_DIR.mkdir(parents=True, exist_ok=True)


def _require_protocol_manager(admin: AdminUser) -> AdminUser:
    role = str(getattr(admin, "role", "")).strip().casefold()
    if role not in PROTOCOL_MANAGER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Prevencionista role required",
        )
    return admin


def _normalize_protocol_title(value: str) -> str:
    title = value.strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="title is required",
        )
    return title


def _parse_supervisor_ids(raw: str | None) -> list[int]:
    if raw is None or not raw.strip():
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid applicable_supervisor_ids payload",
        ) from exc
    if not isinstance(value, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="applicable_supervisor_ids must be an array",
        )
    normalized: list[int] = []
    for item in value:
        try:
            supervisor_id = int(item)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="applicable_supervisor_ids must contain integers",
            ) from exc
        if supervisor_id not in normalized:
            normalized.append(supervisor_id)
    return normalized


def _resolve_supervisors(
    db: Session, applicable_supervisor_ids: list[int]
) -> list[WorkerSupervisor]:
    if not applicable_supervisor_ids:
        return []
    supervisors = list(
        db.execute(
            select(WorkerSupervisor).where(
                WorkerSupervisor.id.in_(applicable_supervisor_ids)
            )
        ).scalars()
    )
    if len(supervisors) != len(applicable_supervisor_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One or more supervisors were not found",
        )
    supervisor_by_id = {supervisor.id: supervisor for supervisor in supervisors}
    return [supervisor_by_id[supervisor_id] for supervisor_id in applicable_supervisor_ids]


def _protocol_supervisor_summary(
    supervisor: WorkerSupervisor,
) -> ProtocolSupervisorSummary:
    return ProtocolSupervisorSummary.model_validate(supervisor)


def _version_summary(
    version: SafetyProtocolVersion | None, document_count: int = 0
) -> SafetyProtocolVersionSummaryRead | None:
    if version is None:
        return None
    return SafetyProtocolVersionSummaryRead(
        id=version.id,
        version_number=version.version_number,
        change_summary=version.change_summary,
        created_at=version.created_at,
        document_count=document_count,
    )


def _document_read(document: SafetyProtocolDocument) -> SafetyProtocolDocumentRead:
    payload = SafetyProtocolDocumentRead.model_validate(document)
    payload.preview_text = document.extracted_text
    return payload


def _signature_read(
    signature: SafetyProtocolSignature | None,
) -> SafetyProtocolSignatureRead | None:
    if signature is None:
        return None
    return SafetyProtocolSignatureRead.model_validate(signature)


def _count_pending_protocols(db: Session, supervisor_id: int) -> int:
    protocol_ids = list(
        db.execute(
            select(SafetyProtocolApplicability.protocol_id).where(
                SafetyProtocolApplicability.supervisor_id == supervisor_id
            )
        ).scalars()
    )
    if not protocol_ids:
        return 0

    latest_version_map = _load_latest_versions(db, protocol_ids)
    latest_version_ids = [version.id for version in latest_version_map.values()]
    if not latest_version_ids:
        return 0

    signed_version_ids = set(
        db.execute(
            select(SafetyProtocolSignature.protocol_version_id).where(
                SafetyProtocolSignature.supervisor_id == supervisor_id,
                SafetyProtocolSignature.protocol_version_id.in_(latest_version_ids),
            )
        ).scalars()
    )
    return sum(1 for version in latest_version_map.values() if version.id not in signed_version_ids)


def _load_latest_versions(
    db: Session, protocol_ids: list[int]
) -> dict[int, SafetyProtocolVersion]:
    if not protocol_ids:
        return {}

    latest_version_subquery = (
        select(
            SafetyProtocolVersion.protocol_id,
            func.max(SafetyProtocolVersion.version_number).label("version_number"),
        )
        .where(SafetyProtocolVersion.protocol_id.in_(protocol_ids))
        .group_by(SafetyProtocolVersion.protocol_id)
        .subquery()
    )

    versions = list(
        db.execute(
            select(SafetyProtocolVersion).join(
                latest_version_subquery,
                (
                    SafetyProtocolVersion.protocol_id
                    == latest_version_subquery.c.protocol_id
                )
                & (
                    SafetyProtocolVersion.version_number
                    == latest_version_subquery.c.version_number
                ),
            )
        ).scalars()
    )
    return {version.protocol_id: version for version in versions}


def _prepare_protocol_upload(
    file: UploadFile,
    *,
    protocol_id: int,
    version_number: int,
    protocol_version_id: int,
) -> tuple[SafetyProtocolDocument, Path]:
    original_filename = safe_protocol_filename(file.filename or "")
    mime_type = resolve_protocol_content_type(original_filename, file.content_type)
    if mime_type is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF and DOCX documents are supported",
        )

    storage_key = (
        f"protocols/{protocol_id}/v{version_number}/"
        f"{uuid4().hex}_{original_filename}"
    )
    destination_path = MEDIA_GALLERY_DIR / storage_key
    destination_path.parent.mkdir(parents=True, exist_ok=True)

    size_bytes = 0
    checksum = hashlib.sha256()
    try:
        with destination_path.open("wb") as buffer:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                size_bytes += len(chunk)
                if size_bytes > MAX_PROTOCOL_FILE_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=(
                            "Protocol document exceeds "
                            f"{MAX_PROTOCOL_FILE_BYTES // (1024 * 1024)} MB limit"
                        ),
                    )
                checksum.update(chunk)
                buffer.write(chunk)
    except HTTPException:
        if destination_path.exists():
            destination_path.unlink()
        raise

    extracted_text = extract_protocol_document_text(destination_path, mime_type)
    document = SafetyProtocolDocument(
        protocol_version_id=protocol_version_id,
        original_filename=original_filename,
        storage_key=storage_key,
        uri=f"/media_gallery/{storage_key}",
        mime_type=mime_type,
        size_bytes=size_bytes,
        checksum_sha256=checksum.hexdigest(),
        extracted_text=extracted_text,
        uploaded_at=utc_now(),
    )
    return document, destination_path


def _prepare_uploaded_protocol_documents(
    files: list[UploadFile],
    *,
    protocol_id: int,
    version_number: int,
    protocol_version_id: int,
) -> tuple[list[SafetyProtocolDocument], list[Path]]:
    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one protocol document is required",
        )

    normalized_names: set[str] = set()
    documents: list[SafetyProtocolDocument] = []
    paths: list[Path] = []
    try:
        for file in files:
            candidate_name = safe_protocol_filename(file.filename or "")
            normalized_name = normalized_protocol_document_name(candidate_name)
            if normalized_name in normalized_names:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Duplicate document filenames are not allowed in the same version",
                )
            normalized_names.add(normalized_name)
            document, path = _prepare_protocol_upload(
                file,
                protocol_id=protocol_id,
                version_number=version_number,
                protocol_version_id=protocol_version_id,
            )
            documents.append(document)
            paths.append(path)
    except Exception:
        _delete_created_files(paths)
        raise
    return documents, paths


def _build_protocol_summary_rows(
    db: Session,
    protocols: list[SafetyProtocol],
    *,
    current_supervisor: WorkerSupervisor | None,
) -> list[SafetyProtocolSummaryRead]:
    if not protocols:
        return []

    protocol_ids = [protocol.id for protocol in protocols]
    latest_version_map = _load_latest_versions(db, protocol_ids)
    latest_version_ids = [version.id for version in latest_version_map.values()]

    document_counts = {
        protocol_version_id: count
        for protocol_version_id, count in db.execute(
            select(
                SafetyProtocolDocument.protocol_version_id,
                func.count(SafetyProtocolDocument.id),
            )
            .where(SafetyProtocolDocument.protocol_version_id.in_(latest_version_ids or [-1]))
            .group_by(SafetyProtocolDocument.protocol_version_id)
        ).all()
    }
    applicable_counts = {
        protocol_id: count
        for protocol_id, count in db.execute(
            select(
                SafetyProtocolApplicability.protocol_id,
                func.count(SafetyProtocolApplicability.id),
            )
            .where(SafetyProtocolApplicability.protocol_id.in_(protocol_ids))
            .group_by(SafetyProtocolApplicability.protocol_id)
        ).all()
    }

    applicable_protocol_ids: set[int] = set()
    signed_version_ids: set[int] = set()
    if current_supervisor is not None:
        applicable_protocol_ids = set(
            db.execute(
                select(SafetyProtocolApplicability.protocol_id).where(
                    SafetyProtocolApplicability.supervisor_id == current_supervisor.id,
                    SafetyProtocolApplicability.protocol_id.in_(protocol_ids),
                )
            ).scalars()
        )
        if latest_version_ids:
            signed_version_ids = set(
                db.execute(
                    select(SafetyProtocolSignature.protocol_version_id).where(
                        SafetyProtocolSignature.supervisor_id == current_supervisor.id,
                        SafetyProtocolSignature.protocol_version_id.in_(latest_version_ids),
                    )
                ).scalars()
            )

    summaries: list[SafetyProtocolSummaryRead] = []
    for protocol in protocols:
        latest_version = latest_version_map.get(protocol.id)
        document_count = (
            document_counts.get(latest_version.id, 0) if latest_version is not None else 0
        )
        is_applicable = protocol.id in applicable_protocol_ids
        has_signed = latest_version is not None and latest_version.id in signed_version_ids
        summaries.append(
            SafetyProtocolSummaryRead(
                id=protocol.id,
                title=protocol.title,
                description=protocol.description,
                active=protocol.active,
                latest_version=_version_summary(latest_version, document_count),
                applicable_supervisor_count=applicable_counts.get(protocol.id, 0),
                is_applicable_to_current_supervisor=is_applicable,
                has_signed_latest_version=has_signed,
                requires_signature=bool(is_applicable and latest_version and not has_signed),
            )
        )
    return summaries


def _build_protocol_detail(
    db: Session,
    protocol: SafetyProtocol,
    *,
    current_supervisor: WorkerSupervisor | None,
    current_admin: AdminUser | None,
) -> SafetyProtocolDetailRead:
    latest_version = db.execute(
        select(SafetyProtocolVersion)
        .where(SafetyProtocolVersion.protocol_id == protocol.id)
        .order_by(SafetyProtocolVersion.version_number.desc())
        .limit(1)
    ).scalar_one_or_none()

    latest_documents: list[SafetyProtocolDocument] = []
    latest_version_document_count = 0
    if latest_version is not None:
        latest_documents = list(
            db.execute(
                select(SafetyProtocolDocument)
                .where(SafetyProtocolDocument.protocol_version_id == latest_version.id)
                .order_by(SafetyProtocolDocument.original_filename)
            ).scalars()
        )
        latest_version_document_count = len(latest_documents)

    previous_version = db.execute(
        select(SafetyProtocolVersion)
        .where(SafetyProtocolVersion.protocol_id == protocol.id)
        .order_by(SafetyProtocolVersion.version_number.desc())
        .offset(1)
        .limit(1)
    ).scalar_one_or_none()

    previous_documents: list[SafetyProtocolDocument] = []
    if previous_version is not None:
        previous_documents = list(
            db.execute(
                select(SafetyProtocolDocument)
                .where(SafetyProtocolDocument.protocol_version_id == previous_version.id)
                .order_by(SafetyProtocolDocument.original_filename)
            ).scalars()
        )

    supervisors = list(
        db.execute(
            select(WorkerSupervisor)
            .join(
                SafetyProtocolApplicability,
                SafetyProtocolApplicability.supervisor_id == WorkerSupervisor.id,
            )
            .where(SafetyProtocolApplicability.protocol_id == protocol.id)
            .order_by(WorkerSupervisor.last_name, WorkerSupervisor.first_name)
        ).scalars()
    )
    applicable_supervisor_ids = {supervisor.id for supervisor in supervisors}

    current_signature = None
    has_signed = False
    is_applicable = False
    if current_supervisor is not None and latest_version is not None:
        is_applicable = current_supervisor.id in applicable_supervisor_ids
        current_signature = db.execute(
            select(SafetyProtocolSignature).where(
                SafetyProtocolSignature.protocol_version_id == latest_version.id,
                SafetyProtocolSignature.supervisor_id == current_supervisor.id,
            )
        ).scalar_one_or_none()
        has_signed = current_signature is not None

    latest_signed_supervisor_count = 0
    latest_signature_statuses: list[ProtocolSupervisorSignatureStatusRead] = []
    if latest_version is not None:
        latest_signed_supervisor_count = int(
            db.execute(
                select(func.count(SafetyProtocolSignature.id)).where(
                    SafetyProtocolSignature.protocol_version_id == latest_version.id
                )
            ).scalar_one()
            or 0
        )
        if current_admin is not None:
            signatures = list(
                db.execute(
                    select(SafetyProtocolSignature).where(
                        SafetyProtocolSignature.protocol_version_id == latest_version.id
                    )
                ).scalars()
            )
            signature_by_supervisor_id = {
                signature.supervisor_id: signature for signature in signatures
            }
            latest_signature_statuses = [
                ProtocolSupervisorSignatureStatusRead(
                    supervisor=_protocol_supervisor_summary(supervisor),
                    signed=supervisor.id in signature_by_supervisor_id,
                    signed_name=signature_by_supervisor_id.get(supervisor.id).signed_name
                    if supervisor.id in signature_by_supervisor_id
                    else None,
                    signed_at=signature_by_supervisor_id.get(supervisor.id).signed_at
                    if supervisor.id in signature_by_supervisor_id
                    else None,
                )
                for supervisor in supervisors
            ]

    diff_entries = build_protocol_diff(
        [
            (
                document.original_filename,
                document.extracted_text,
                document.checksum_sha256,
            )
            for document in previous_documents
        ],
        [
            (
                document.original_filename,
                document.extracted_text,
                document.checksum_sha256,
            )
            for document in latest_documents
        ],
    )

    return SafetyProtocolDetailRead(
        id=protocol.id,
        title=protocol.title,
        description=protocol.description,
        active=protocol.active,
        latest_version=_version_summary(latest_version, latest_version_document_count),
        applicable_supervisor_count=len(supervisors),
        is_applicable_to_current_supervisor=is_applicable,
        has_signed_latest_version=has_signed,
        requires_signature=bool(is_applicable and latest_version and not has_signed),
        applicable_supervisors=[
            _protocol_supervisor_summary(supervisor) for supervisor in supervisors
        ],
        latest_signature_statuses=latest_signature_statuses,
        latest_documents=[_document_read(document) for document in latest_documents],
        previous_version_number=previous_version.version_number if previous_version else None,
        diff_entries=[
            SafetyProtocolDiffEntryRead(
                kind=entry.kind,
                document_name=entry.document_name,
                added_lines=entry.added_lines,
                removed_lines=entry.removed_lines,
                diff_excerpt=entry.diff_excerpt,
            )
            for entry in diff_entries
        ],
        current_supervisor_signature=_signature_read(current_signature),
        latest_signed_supervisor_count=latest_signed_supervisor_count,
    )


def _delete_created_files(paths: list[Path]) -> None:
    for path in paths:
        try:
            if path.exists():
                path.unlink()
        except OSError:
            continue


@router.get("/supervisors", response_model=list[ProtocolSupervisorSummary])
def list_protocol_supervisors(db: Session = Depends(get_db)) -> list[ProtocolSupervisorSummary]:
    supervisors = list(
        db.execute(
            select(WorkerSupervisor).order_by(
                WorkerSupervisor.last_name, WorkerSupervisor.first_name
            )
        ).scalars()
    )
    return [_protocol_supervisor_summary(supervisor) for supervisor in supervisors]


@router.post("/supervisor/login", response_model=ProtocolSupervisorSessionRead)
def protocol_supervisor_login(
    payload: ProtocolSupervisorSessionLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> ProtocolSupervisorSessionRead:
    supervisor = db.get(WorkerSupervisor, payload.supervisor_id)
    if not supervisor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Supervisor not found",
        )
    if not supervisor.pin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Supervisor PIN is not configured",
        )
    if supervisor.pin != payload.pin.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid PIN",
        )

    token = new_session_token()
    expires_at = session_expiry()
    session = WorkerSupervisorSession(
        supervisor_id=supervisor.id,
        token_hash=hash_token(token),
        created_at=utc_now(),
        expires_at=expires_at,
    )
    db.add(session)
    db.commit()
    response.set_cookie(
        key=SUPERVISOR_SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        secure=settings.session_cookie_secure,
        max_age=int((expires_at - utc_now()).total_seconds()),
        path=session_cookie_path(settings),
    )
    return ProtocolSupervisorSessionRead(
        supervisor=_protocol_supervisor_summary(supervisor),
        pending_protocol_count=_count_pending_protocols(db, supervisor.id),
    )


@router.post("/supervisor/logout", status_code=status.HTTP_204_NO_CONTENT)
def protocol_supervisor_logout(
    request: Request,
    response: Response,
    session: WorkerSupervisorSession = Depends(get_current_supervisor_session),
    db: Session = Depends(get_db),
) -> None:
    token = request.cookies.get(SUPERVISOR_SESSION_COOKIE)
    if token:
        session.revoked_at = utc_now()
        db.commit()
    response.delete_cookie(
        SUPERVISOR_SESSION_COOKIE, path=session_cookie_path(settings)
    )


@router.get("/supervisor/me", response_model=ProtocolSupervisorSessionRead)
def protocol_supervisor_me(
    supervisor: WorkerSupervisor = Depends(get_current_supervisor),
    db: Session = Depends(get_db),
) -> ProtocolSupervisorSessionRead:
    return ProtocolSupervisorSessionRead(
        supervisor=_protocol_supervisor_summary(supervisor),
        pending_protocol_count=_count_pending_protocols(db, supervisor.id),
    )


@router.get("/supervisor/session", response_model=ProtocolSupervisorSessionRead | None)
def protocol_supervisor_session_status(
    supervisor: WorkerSupervisor | None = Depends(get_optional_supervisor),
    db: Session = Depends(get_db),
) -> ProtocolSupervisorSessionRead | None:
    if supervisor is None:
        return None
    return ProtocolSupervisorSessionRead(
        supervisor=_protocol_supervisor_summary(supervisor),
        pending_protocol_count=_count_pending_protocols(db, supervisor.id),
    )


@router.get("", response_model=list[SafetyProtocolSummaryRead])
def list_protocols(
    applicable_only: bool = False,
    db: Session = Depends(get_db),
    current_supervisor: WorkerSupervisor | None = Depends(get_optional_supervisor),
) -> list[SafetyProtocolSummaryRead]:
    protocols = list(
        db.execute(
            select(SafetyProtocol)
            .where(SafetyProtocol.active.is_(True))
            .order_by(SafetyProtocol.title)
        ).scalars()
    )
    summaries = _build_protocol_summary_rows(
        db, protocols, current_supervisor=current_supervisor
    )
    if applicable_only and current_supervisor is not None:
        summaries = [
            summary for summary in summaries if summary.is_applicable_to_current_supervisor
        ]
    return summaries


@router.post("", response_model=SafetyProtocolDetailRead, status_code=status.HTTP_201_CREATED)
def create_protocol(
    title: str = Form(...),
    description: str | None = Form(None),
    applicable_supervisor_ids: str | None = Form("[]"),
    change_summary: str | None = Form(None),
    files: list[UploadFile] = File(...),
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> SafetyProtocolDetailRead:
    _require_protocol_manager(admin)
    normalized_title = _normalize_protocol_title(title)
    supervisor_ids = _parse_supervisor_ids(applicable_supervisor_ids)
    supervisors = _resolve_supervisors(db, supervisor_ids)

    created_paths: list[Path] = []
    try:
        protocol = SafetyProtocol(
            title=normalized_title,
            description=(description or "").strip() or None,
            active=True,
            created_by_user_id=admin.id,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.add(protocol)
        db.flush()

        version = SafetyProtocolVersion(
            protocol_id=protocol.id,
            version_number=1,
            change_summary=(change_summary or "").strip() or None,
            created_by_user_id=admin.id,
            created_at=utc_now(),
        )
        db.add(version)
        db.flush()

        documents, created_paths = _prepare_uploaded_protocol_documents(
            files,
            protocol_id=protocol.id,
            version_number=version.version_number,
            protocol_version_id=version.id,
        )
        db.add_all(documents)
        db.add_all(
            [
                SafetyProtocolApplicability(
                    protocol_id=protocol.id,
                    supervisor_id=supervisor.id,
                )
                for supervisor in supervisors
            ]
        )
        db.commit()
        db.refresh(protocol)
    except Exception:
        db.rollback()
        _delete_created_files(created_paths)
        raise

    return _build_protocol_detail(db, protocol, current_supervisor=None, current_admin=admin)


@router.get("/{protocol_id}", response_model=SafetyProtocolDetailRead)
def get_protocol_detail(
    protocol_id: int,
    db: Session = Depends(get_db),
    current_supervisor: WorkerSupervisor | None = Depends(get_optional_supervisor),
    current_admin: AdminUser | None = Depends(get_optional_admin),
) -> SafetyProtocolDetailRead:
    protocol = db.get(SafetyProtocol, protocol_id)
    if not protocol or not protocol.active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Protocol not found",
        )
    return _build_protocol_detail(
        db, protocol, current_supervisor=current_supervisor, current_admin=current_admin
    )


@router.put("/{protocol_id}", response_model=SafetyProtocolDetailRead)
def update_protocol(
    protocol_id: int,
    payload: SafetyProtocolUpdate,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> SafetyProtocolDetailRead:
    _require_protocol_manager(admin)
    protocol = db.get(SafetyProtocol, protocol_id)
    if not protocol or not protocol.active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Protocol not found",
        )

    protocol.title = _normalize_protocol_title(payload.title)
    protocol.description = (payload.description or "").strip() or None
    protocol.updated_at = utc_now()
    supervisors = _resolve_supervisors(db, payload.applicable_supervisor_ids)
    db.execute(
        delete(SafetyProtocolApplicability).where(
            SafetyProtocolApplicability.protocol_id == protocol.id
        )
    )
    db.add_all(
        [
            SafetyProtocolApplicability(
                protocol_id=protocol.id,
                supervisor_id=supervisor.id,
            )
            for supervisor in supervisors
        ]
    )
    db.commit()
    db.refresh(protocol)
    return _build_protocol_detail(db, protocol, current_supervisor=None, current_admin=admin)


@router.post(
    "/{protocol_id}/versions",
    response_model=SafetyProtocolDetailRead,
    status_code=status.HTTP_201_CREATED,
)
def create_protocol_version(
    protocol_id: int,
    change_summary: str | None = Form(None),
    files: list[UploadFile] = File(...),
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> SafetyProtocolDetailRead:
    _require_protocol_manager(admin)
    protocol = db.get(SafetyProtocol, protocol_id)
    if not protocol or not protocol.active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Protocol not found",
        )

    latest_version = db.execute(
        select(SafetyProtocolVersion)
        .where(SafetyProtocolVersion.protocol_id == protocol.id)
        .order_by(SafetyProtocolVersion.version_number.desc())
        .limit(1)
    ).scalar_one_or_none()
    if latest_version is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Protocol does not have an initial version",
        )

    latest_documents = list(
        db.execute(
            select(SafetyProtocolDocument).where(
                SafetyProtocolDocument.protocol_version_id == latest_version.id
            )
        ).scalars()
    )

    created_paths: list[Path] = []
    try:
        version = SafetyProtocolVersion(
            protocol_id=protocol.id,
            version_number=latest_version.version_number + 1,
            change_summary=(change_summary or "").strip() or None,
            created_by_user_id=admin.id,
            created_at=utc_now(),
        )
        db.add(version)
        db.flush()

        uploaded_documents, created_paths = _prepare_uploaded_protocol_documents(
            files,
            protocol_id=protocol.id,
            version_number=version.version_number,
            protocol_version_id=version.id,
        )
        uploaded_by_name = {
            normalized_protocol_document_name(document.original_filename): document
            for document in uploaded_documents
        }

        merged_documents = list(uploaded_documents)
        for existing in latest_documents:
            if (
                normalized_protocol_document_name(existing.original_filename)
                in uploaded_by_name
            ):
                continue
            merged_documents.append(
                SafetyProtocolDocument(
                    protocol_version_id=version.id,
                    original_filename=existing.original_filename,
                    storage_key=existing.storage_key,
                    uri=existing.uri,
                    mime_type=existing.mime_type,
                    size_bytes=existing.size_bytes,
                    checksum_sha256=existing.checksum_sha256,
                    extracted_text=existing.extracted_text,
                    uploaded_at=existing.uploaded_at,
                )
            )

        db.add_all(merged_documents)
        protocol.updated_at = utc_now()
        db.commit()
        db.refresh(protocol)
    except Exception:
        db.rollback()
        _delete_created_files(created_paths)
        raise

    return _build_protocol_detail(db, protocol, current_supervisor=None, current_admin=admin)


@router.post(
    "/{protocol_id}/sign",
    response_model=SafetyProtocolSignatureRead,
    status_code=status.HTTP_201_CREATED,
)
def sign_protocol(
    protocol_id: int,
    payload: SafetyProtocolSignRequest,
    supervisor: WorkerSupervisor = Depends(get_current_supervisor),
    db: Session = Depends(get_db),
) -> SafetyProtocolSignatureRead:
    protocol = db.get(SafetyProtocol, protocol_id)
    if not protocol or not protocol.active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Protocol not found",
        )

    latest_version = db.execute(
        select(SafetyProtocolVersion)
        .where(SafetyProtocolVersion.protocol_id == protocol.id)
        .order_by(SafetyProtocolVersion.version_number.desc())
        .limit(1)
    ).scalar_one_or_none()
    if latest_version is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Protocol does not have a published version",
        )

    applicable = db.execute(
        select(SafetyProtocolApplicability.id).where(
            SafetyProtocolApplicability.protocol_id == protocol.id,
            SafetyProtocolApplicability.supervisor_id == supervisor.id,
        )
    ).scalar_one_or_none()
    if applicable is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Protocol is not assigned to this supervisor",
        )

    existing_signature = db.execute(
        select(SafetyProtocolSignature).where(
            SafetyProtocolSignature.protocol_version_id == latest_version.id,
            SafetyProtocolSignature.supervisor_id == supervisor.id,
        )
    ).scalar_one_or_none()
    if existing_signature is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Latest version is already signed",
        )

    if not supervisor.pin or supervisor.pin != payload.pin.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid supervisor PIN",
        )

    signed_name = payload.signed_name.strip()
    if not signed_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="signed_name is required",
        )
    expected_name = f"{supervisor.first_name} {supervisor.last_name}".strip()
    if normalize_signature_name(signed_name) != normalize_signature_name(expected_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Signed name must match the supervisor name",
        )

    signature = SafetyProtocolSignature(
        protocol_id=protocol.id,
        protocol_version_id=latest_version.id,
        supervisor_id=supervisor.id,
        signed_name=signed_name,
        signed_at=utc_now(),
    )
    db.add(signature)
    db.commit()
    db.refresh(signature)
    return SafetyProtocolSignatureRead.model_validate(signature)
