import secrets
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import ADMIN_SESSION_COOKIE, get_current_admin, get_db, get_optional_admin
from app.core.config import settings
from app.core.security import hash_token, new_session_token, session_expiry, utc_now
from app.models.admin import AdminSession, AdminUser
from app.models.enums import AdminRole
from app.schemas.admin import AdminLoginRequest, AdminUserRead
from app.services.admin_bootstrap import SYSADMIN_FIRST_NAME, ensure_sysadmin_user
from app.services import company_access, microsoft_auth

router = APIRouter()
microsoft_router = APIRouter()

MICROSOFT_STATE_COOKIE = "admin_ms_oauth_state"
MICROSOFT_NEXT_COOKIE = "admin_ms_oauth_next"
MICROSOFT_PURPOSE_COOKIE = "admin_ms_oauth_purpose"
MICROSOFT_COOKIE_PATH = "/api/auth/microsoft"
MICROSOFT_STATE_MAX_AGE_SECONDS = 10 * 60
_MICROSOFT_RETURN_PREFIXES = ("/admin", "/qc", "/utility/protocols")
_MICROSOFT_PURPOSE_ADMIN = "admin"
_MICROSOFT_PURPOSE_COMPANY = "company"


def _normalize_return_path(value: str | None) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return "/admin"
    parsed = urlsplit(candidate)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith("/"):
        return "/admin"
    if not any(
        parsed.path == prefix or parsed.path.startswith(f"{prefix}/")
        for prefix in _MICROSOFT_RETURN_PREFIXES
    ):
        return "/admin"
    return urlunsplit(("", "", parsed.path, parsed.query, ""))


def _normalize_company_return_path(value: str | None) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return "/login"
    parsed = urlsplit(candidate)
    if (
        parsed.scheme
        or parsed.netloc
        or not parsed.path.startswith("/")
        or parsed.path.startswith("/api")
    ):
        return "/login"
    return urlunsplit(("", "", parsed.path, parsed.query, ""))


def _normalize_microsoft_purpose(value: str | None) -> str:
    return (
        _MICROSOFT_PURPOSE_COMPANY
        if (value or "").strip().lower() == _MICROSOFT_PURPOSE_COMPANY
        else _MICROSOFT_PURPOSE_ADMIN
    )


def _default_role_path(admin: AdminUser) -> str:
    normalized_role = admin.role.strip().casefold()
    if normalized_role == AdminRole.QC.value.casefold():
        return "/qc"
    if normalized_role == AdminRole.PREVENCIONISTA.value.casefold():
        return "/utility/protocols"
    return "/admin"


def _role_appropriate_return_path(admin: AdminUser, requested_path: str) -> str:
    default_path = _default_role_path(admin)
    parsed = urlsplit(requested_path)
    if parsed.path == default_path or parsed.path.startswith(f"{default_path}/"):
        return requested_path
    return default_path


def _microsoft_redirect_uri(request: Request) -> str:
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")
    scheme = (forwarded_proto or request.url.scheme).split(",", 1)[0].strip()
    host = (
        forwarded_host or request.headers.get("host") or request.url.netloc
    ).split(",", 1)[0].strip()
    origin = urlunsplit((scheme, host, "", "", ""))
    return f"{origin}/api/auth/microsoft/callback"


def _redirect_with_auth_error(message: str, return_path: str) -> RedirectResponse:
    parsed = urlsplit(_normalize_company_return_path(return_path))
    query = parse_qsl(parsed.query, keep_blank_values=True)
    query.append(("auth_error", message))
    url = urlunsplit(("", "", parsed.path, urlencode(query), ""))
    return RedirectResponse(url=url, status_code=status.HTTP_303_SEE_OTHER)


def _clear_microsoft_cookies(response: Response) -> None:
    response.delete_cookie(MICROSOFT_STATE_COOKIE, path=MICROSOFT_COOKIE_PATH)
    response.delete_cookie(MICROSOFT_NEXT_COOKIE, path=MICROSOFT_COOKIE_PATH)
    response.delete_cookie(MICROSOFT_PURPOSE_COOKIE, path=MICROSOFT_COOKIE_PATH)


def _set_admin_session_cookie(
    response: Response, token: str, expires_at: datetime, *, secure: bool = False
) -> None:
    response.set_cookie(
        key=ADMIN_SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        secure=secure,
        max_age=int((expires_at - utc_now()).total_seconds()),
        path="/",
    )


def _create_admin_session(admin: AdminUser, db: Session) -> tuple[str, datetime]:
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
    return token, expires_at


def get_enabled_admin_by_email(db: Session, email: str) -> AdminUser | None:
    normalized = email.strip().lower()
    if not normalized:
        return None
    stmt = (
        select(AdminUser)
        .where(func.lower(AdminUser.email) == normalized)
        .where(AdminUser.active.is_(True))
    )
    return db.execute(stmt).scalar_one_or_none()


def _authenticate_admin_user(
    payload: AdminLoginRequest, db: Session, *, allow_inactive: bool = False
) -> AdminUser:
    normalized_first_name = payload.first_name.strip()
    normalized_last_name = payload.last_name.strip()
    normalized_pin = payload.pin.strip()

    admin: AdminUser | None = None
    if normalized_first_name.lower() == SYSADMIN_FIRST_NAME:
        if not settings.sys_admin_password:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Sysadmin password not configured",
            )
        if normalized_pin != settings.sys_admin_password:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )
        admin = ensure_sysadmin_user(db)
    else:
        stmt = (
            select(AdminUser)
            .where(AdminUser.first_name == normalized_first_name)
            .where(AdminUser.last_name == normalized_last_name)
            .where(AdminUser.pin == normalized_pin)
        )
        admin = db.execute(stmt).scalar_one_or_none()
        if not admin:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
            )

    if not allow_inactive and not getattr(admin, "active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin user inactive",
        )
    return admin


@router.post("/login", response_model=AdminUserRead)
def admin_login(
    payload: AdminLoginRequest, response: Response, db: Session = Depends(get_db)
) -> AdminUser:
    admin = _authenticate_admin_user(payload, db, allow_inactive=True)
    token, expires_at = _create_admin_session(admin, db)
    _set_admin_session_cookie(response, token, expires_at)
    return admin


@microsoft_router.get("/microsoft/login")
async def microsoft_login(
    request: Request,
    next_path: str | None = Query(default=None, alias="next"),
    purpose: str | None = None,
) -> RedirectResponse:
    normalized_purpose = _normalize_microsoft_purpose(purpose)
    return_path = (
        _normalize_company_return_path(next_path)
        if normalized_purpose == _MICROSOFT_PURPOSE_COMPANY
        else _normalize_return_path(next_path)
    )
    error_return_path = (
        "/login"
        if normalized_purpose == _MICROSOFT_PURPOSE_COMPANY
        else return_path
    )
    if not settings.microsoft_login_enabled:
        return _redirect_with_auth_error(
            "El ingreso con Microsoft esta deshabilitado.", error_return_path
        )

    config = microsoft_auth.build_config(
        settings, redirect_uri=_microsoft_redirect_uri(request)
    )
    if not config.is_configured:
        return _redirect_with_auth_error(
            "Microsoft no esta configurado. Contacta al administrador.",
            error_return_path,
        )

    state_token = secrets.token_urlsafe(32)
    response = RedirectResponse(
        url=microsoft_auth.authorize_url(config, state=state_token),
        status_code=status.HTTP_303_SEE_OTHER,
    )
    secure = urlsplit(config.redirect_uri).scheme.lower() == "https"
    response.set_cookie(
        key=MICROSOFT_STATE_COOKIE,
        value=state_token,
        httponly=True,
        samesite="lax",
        secure=secure,
        max_age=MICROSOFT_STATE_MAX_AGE_SECONDS,
        path=MICROSOFT_COOKIE_PATH,
    )
    response.set_cookie(
        key=MICROSOFT_NEXT_COOKIE,
        value=return_path,
        httponly=True,
        samesite="lax",
        secure=secure,
        max_age=MICROSOFT_STATE_MAX_AGE_SECONDS,
        path=MICROSOFT_COOKIE_PATH,
    )
    response.set_cookie(
        key=MICROSOFT_PURPOSE_COOKIE,
        value=normalized_purpose,
        httponly=True,
        samesite="lax",
        secure=secure,
        max_age=MICROSOFT_STATE_MAX_AGE_SECONDS,
        path=MICROSOFT_COOKIE_PATH,
    )
    return response


@microsoft_router.get("/microsoft/callback")
async def microsoft_callback(
    request: Request,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    purpose = _normalize_microsoft_purpose(
        request.cookies.get(MICROSOFT_PURPOSE_COOKIE)
    )
    return_path = (
        _normalize_company_return_path(request.cookies.get(MICROSOFT_NEXT_COOKIE))
        if purpose == _MICROSOFT_PURPOSE_COMPANY
        else _normalize_return_path(request.cookies.get(MICROSOFT_NEXT_COOKIE))
    )
    error_return_path = "/login" if purpose == _MICROSOFT_PURPOSE_COMPANY else return_path
    expected_state = request.cookies.get(MICROSOFT_STATE_COOKIE)
    received_state = request.query_params.get("state")

    if (
        not expected_state
        or not received_state
        or not secrets.compare_digest(expected_state, received_state)
    ):
        response = _redirect_with_auth_error(
            "No se pudo validar la respuesta de Microsoft. Intenta nuevamente.",
            error_return_path,
        )
        _clear_microsoft_cookies(response)
        return response

    microsoft_error = request.query_params.get("error")
    if microsoft_error:
        detail = request.query_params.get("error_description") or microsoft_error
        response = _redirect_with_auth_error(
            f"Microsoft devolvio un error: {detail}", error_return_path
        )
        _clear_microsoft_cookies(response)
        return response

    code = (request.query_params.get("code") or "").strip()
    if not code:
        response = _redirect_with_auth_error(
            "Microsoft no devolvio un codigo de autorizacion.", error_return_path
        )
        _clear_microsoft_cookies(response)
        return response

    config = microsoft_auth.build_config(
        settings, redirect_uri=_microsoft_redirect_uri(request)
    )
    if not settings.microsoft_login_enabled or not config.is_configured:
        response = _redirect_with_auth_error(
            "Microsoft no esta configurado. Contacta al administrador.",
            error_return_path,
        )
        _clear_microsoft_cookies(response)
        return response

    if not company_access.storage_is_ready(db):
        response = _redirect_with_auth_error(
            "El acceso con Microsoft requiere una actualizacion pendiente del servidor.",
            error_return_path,
        )
        _clear_microsoft_cookies(response)
        return response

    try:
        access_token = await microsoft_auth.exchange_code_for_token(config, code=code)
        email = await microsoft_auth.fetch_user_email(access_token)
    except microsoft_auth.MicrosoftAuthError as exc:
        response = _redirect_with_auth_error(str(exc), error_return_path)
        _clear_microsoft_cookies(response)
        return response

    admin = get_enabled_admin_by_email(db, email)
    company_token, company_expires_at = company_access.create_company_access_session(
        email, db
    )
    secure = urlsplit(config.redirect_uri).scheme.lower() == "https"
    if admin is None:
        response = RedirectResponse(
            url="/login", status_code=status.HTTP_303_SEE_OTHER
        )
        company_access.set_company_access_cookie(
            response,
            company_token,
            company_expires_at,
            secure=secure,
        )
        _clear_microsoft_cookies(response)
        return response

    token, expires_at = _create_admin_session(admin, db)
    destination = (
        _role_appropriate_return_path(admin, return_path)
        if purpose == _MICROSOFT_PURPOSE_COMPANY
        else return_path
    )
    response = RedirectResponse(
        url=destination, status_code=status.HTTP_303_SEE_OTHER
    )
    _set_admin_session_cookie(
        response,
        token,
        expires_at,
        secure=secure,
    )
    company_access.set_company_access_cookie(
        response,
        company_token,
        company_expires_at,
        secure=secure,
    )
    _clear_microsoft_cookies(response)
    return response


@router.post("/verify", response_model=AdminUserRead)
def admin_verify(
    payload: AdminLoginRequest, db: Session = Depends(get_db)
) -> AdminUser:
    return _authenticate_admin_user(payload, db)


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


@router.get("/session", response_model=AdminUserRead | None)
def admin_session_status(
    admin: AdminUser | None = Depends(get_optional_admin),
) -> AdminUser | None:
    return admin
