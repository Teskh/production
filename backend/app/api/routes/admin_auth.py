from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import ADMIN_SESSION_COOKIE, get_current_admin, get_db
from app.core.security import hash_token, new_session_token, session_expiry, utc_now
from app.models.admin import AdminSession, AdminUser
from app.schemas.admin import AdminLoginRequest, AdminUserRead

router = APIRouter()


@router.post("/login", response_model=AdminUserRead)
def admin_login(
    payload: AdminLoginRequest, response: Response, db: Session = Depends(get_db)
) -> AdminUser:
    stmt = (
        select(AdminUser)
        .where(AdminUser.first_name == payload.first_name)
        .where(AdminUser.last_name == payload.last_name)
        .where(AdminUser.pin == payload.pin)
    )
    admin = db.execute(stmt).scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = new_session_token()
    expires_at = session_expiry()
    session = AdminSession(
        admin_user_id=admin.id,
        token_hash=hash_token(token),
        created_at=utc_now(),
        expires_at=expires_at,
    )
    db.add(session)
    db.commit()
    response.set_cookie(
        key=ADMIN_SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=int((expires_at - utc_now()).total_seconds()),
        path="/",
    )
    return admin


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def admin_logout(
    request: Request,
    response: Response,
    admin: AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> None:
    token = request.cookies.get(ADMIN_SESSION_COOKIE)
    if token:
        token_hash = hash_token(token)
        stmt = select(AdminSession).where(AdminSession.token_hash == token_hash)
        session = db.execute(stmt).scalar_one_or_none()
        if session and session.revoked_at is None:
            session.revoked_at = utc_now()
            db.commit()
    response.delete_cookie(ADMIN_SESSION_COOKIE, path="/")


@router.get("/me", response_model=AdminUserRead)
def admin_me(admin: AdminUser = Depends(get_current_admin)) -> AdminUser:
    return admin
