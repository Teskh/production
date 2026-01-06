from collections.abc import Generator

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_token, utc_now
from app.db.session import SessionLocal
from app.models.admin import AdminSession, AdminUser
from app.models.workers import Worker, WorkerSession

ADMIN_SESSION_COOKIE = "admin_session"
WORKER_SESSION_COOKIE = "worker_session"


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
    if not session or session.revoked_at is not None or session.expires_at <= utc_now():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    admin = db.get(AdminUser, session.admin_user_id)
    if not admin:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin user not found")
    if not getattr(admin, "active", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin user inactive")
    return admin


def _get_worker_session(token: str, db: Session) -> WorkerSession:
    token_hash = hash_token(token)
    stmt = select(WorkerSession).where(WorkerSession.token_hash == token_hash)
    session = db.execute(stmt).scalar_one_or_none()
    if not session or session.revoked_at is not None or session.expires_at <= utc_now():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    return session


def get_current_worker_session(
    request: Request, db: Session = Depends(get_db)
) -> WorkerSession:
    token = request.cookies.get(WORKER_SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _get_worker_session(token, db)


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
