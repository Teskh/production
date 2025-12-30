from collections.abc import Generator

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_token, utc_now
from app.db.session import SessionLocal
from app.models.admin import AdminSession, AdminUser

ADMIN_SESSION_COOKIE = "admin_session"


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
    return admin
