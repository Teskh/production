from collections.abc import Generator
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_token, utc_now
from app.db.session import SessionLocal
from app.models.admin import AdminSession, AdminUser
from app.models.workers import (
    Worker,
    WorkerSession,
    WorkerSupervisor,
    WorkerSupervisorSession,
)

ADMIN_SESSION_COOKIE = "admin_session"
WORKER_SESSION_COOKIE = "worker_session"
SUPERVISOR_SESSION_COOKIE = "protocol_supervisor_session"


def _ensure_aware(dt: datetime) -> datetime:
    """Convert naive datetime to UTC-aware. Assumes naive datetimes are UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_admin(
    request: Request, db: Session = Depends(get_db)
) -> AdminUser:
    token = request.cookies.get(ADMIN_SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    token_hash = hash_token(token)
    stmt = select(AdminSession).where(AdminSession.token_hash == token_hash)
    session = db.execute(stmt).scalar_one_or_none()
    if not session or session.revoked_at is not None or _ensure_aware(session.expires_at) <= utc_now():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    admin = db.get(AdminUser, session.admin_user_id)
    if not admin:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin user not found")
    if not getattr(admin, "active", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin user inactive")
    return admin


def get_optional_admin(
    request: Request, db: Session = Depends(get_db)
) -> AdminUser | None:
    token = request.cookies.get(ADMIN_SESSION_COOKIE)
    if not token:
        return None
    token_hash = hash_token(token)
    stmt = select(AdminSession).where(AdminSession.token_hash == token_hash)
    session = db.execute(stmt).scalar_one_or_none()
    if not session or session.revoked_at is not None or _ensure_aware(session.expires_at) <= utc_now():
        return None
    admin = db.get(AdminUser, session.admin_user_id)
    if not admin or not getattr(admin, "active", True):
        return None
    return admin


def _get_worker_session(token: str, db: Session) -> WorkerSession:
    token_hash = hash_token(token)
    stmt = select(WorkerSession).where(WorkerSession.token_hash == token_hash)
    session = db.execute(stmt).scalar_one_or_none()
    if not session or session.revoked_at is not None or _ensure_aware(session.expires_at) <= utc_now():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    return session


def get_current_worker_session(
    request: Request, db: Session = Depends(get_db)
) -> WorkerSession:
    token = request.cookies.get(WORKER_SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _get_worker_session(token, db)


def _get_supervisor_session(token: str, db: Session) -> WorkerSupervisorSession:
    token_hash = hash_token(token)
    stmt = select(WorkerSupervisorSession).where(
        WorkerSupervisorSession.token_hash == token_hash
    )
    session = db.execute(stmt).scalar_one_or_none()
    if not session or session.revoked_at is not None or _ensure_aware(session.expires_at) <= utc_now():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    return session


def get_current_worker(
    request: Request, db: Session = Depends(get_db)
) -> Worker:
    token = request.cookies.get(WORKER_SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    session = _get_worker_session(token, db)
    worker = db.get(Worker, session.worker_id)
    if not worker:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Worker not found")
    if not worker.active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker inactive")
    return worker


def get_optional_worker(
    request: Request, db: Session = Depends(get_db)
) -> Worker | None:
    token = request.cookies.get(WORKER_SESSION_COOKIE)
    if not token:
        return None
    try:
        session = _get_worker_session(token, db)
    except HTTPException:
        return None
    worker = db.get(Worker, session.worker_id)
    if not worker or not worker.active:
        return None
    return worker


def get_current_supervisor_session(
    request: Request, db: Session = Depends(get_db)
) -> WorkerSupervisorSession:
    token = request.cookies.get(SUPERVISOR_SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _get_supervisor_session(token, db)


def get_current_supervisor(
    request: Request, db: Session = Depends(get_db)
) -> WorkerSupervisor:
    token = request.cookies.get(SUPERVISOR_SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    session = _get_supervisor_session(token, db)
    supervisor = db.get(WorkerSupervisor, session.supervisor_id)
    if not supervisor:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Supervisor not found"
        )
    return supervisor


def get_optional_supervisor(
    request: Request, db: Session = Depends(get_db)
) -> WorkerSupervisor | None:
    token = request.cookies.get(SUPERVISOR_SESSION_COOKIE)
    if not token:
        return None
    try:
        session = _get_supervisor_session(token, db)
    except HTTPException:
        return None
    supervisor = db.get(WorkerSupervisor, session.supervisor_id)
    if not supervisor:
        return None
    return supervisor
