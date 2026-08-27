"""Network trust and Microsoft-verified company access sessions."""

from __future__ import annotations

from datetime import datetime, timezone
from ipaddress import IPv4Address, IPv6Address, ip_address, ip_network
from urllib.parse import urlsplit

from fastapi import Request, Response
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.core.config import Settings, settings
from app.core.deployment import session_cookie_path
from app.core.security import hash_token, new_session_token, session_expiry, utc_now
from app.models.admin import CompanyAccessSession


COMPANY_ACCESS_COOKIE = "company_access_session"
_LOCAL_DEV_HOSTS = {"localhost", "127.0.0.1", "::1"}
_LOCAL_DEV_PORTS = {None, 2340, 5173, 5174}

IPAddress = IPv4Address | IPv6Address


def _networks(raw: str) -> tuple:
    networks = []
    for value in raw.split(","):
        candidate = value.strip()
        if candidate:
            try:
                networks.append(ip_network(candidate, strict=False))
            except ValueError:
                # Invalid entries never expand trust; valid entries still apply.
                continue
    return tuple(networks)


def _address(value: str | None) -> IPAddress | None:
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    if candidate.startswith("[") and "]" in candidate:
        candidate = candidate[1 : candidate.index("]")]
    elif candidate.count(":") == 1 and "." in candidate:
        candidate = candidate.rsplit(":", 1)[0]
    try:
        return ip_address(candidate)
    except ValueError:
        return None


def _in_networks(address: IPAddress, networks: tuple) -> bool:
    return any(
        address.version == network.version and address in network
        for network in networks
    )


def effective_client_address(
    request: Request,
    config: Settings = settings,
) -> IPAddress | None:
    """Resolve the client IP while trusting forwarding data only from known proxies."""
    peer = _address(request.client.host if request.client else None)
    if peer is None:
        return None

    trusted_proxies = _networks(config.trusted_proxy_cidrs)
    if not _in_networks(peer, trusted_proxies):
        return peer

    client_ip_header = str(
        getattr(config, "trusted_client_ip_header", "x-forwarded-for")
        or "x-forwarded-for"
    ).strip().lower()
    forwarded = [
        address
        for address in (
            _address(value)
            for value in request.headers.get(client_ip_header, "").split(",")
        )
        if address is not None
    ]
    chain = [*forwarded, peer]
    while len(chain) > 1 and _in_networks(chain[-1], trusted_proxies):
        chain.pop()
    return chain[-1]


def _is_local_dev_request(request: Request, client: IPAddress) -> bool:
    if not client.is_loopback:
        return False
    parsed = urlsplit(f"//{request.headers.get('host', '')}")
    try:
        port = parsed.port
    except ValueError:
        return False
    return (parsed.hostname or "").lower() in _LOCAL_DEV_HOSTS and port in _LOCAL_DEV_PORTS


def is_local_development_request(
    request: Request,
    config: Settings = settings,
) -> bool:
    """Return whether a proxy-aware request really originated on loopback."""
    client = effective_client_address(request, config)
    return bool(client is not None and _is_local_dev_request(request, client))


def is_trusted_network_request(
    request: Request,
    config: Settings = settings,
) -> bool:
    client = effective_client_address(request, config)
    if client is None:
        return False
    if _is_local_dev_request(request, client):
        return True
    return _in_networks(client, _networks(config.trusted_lan_cidrs))


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def create_company_access_session(
    email: str,
    db: Session,
    config: Settings = settings,
) -> tuple[str, datetime]:
    token = new_session_token()
    expires_at = session_expiry(hours=max(config.company_access_session_hours, 1))
    db.add(
        CompanyAccessSession(
            email=email.strip().lower(),
            token_hash=hash_token(token),
            created_at=utc_now(),
            expires_at=expires_at,
        )
    )
    db.commit()
    return token, expires_at


def storage_is_ready(db: Session) -> bool:
    bind = db.get_bind()
    return bool(bind and inspect(bind).has_table(CompanyAccessSession.__tablename__))


def has_valid_company_access(token: str | None, db: Session) -> bool:
    if not token:
        return False
    session = db.execute(
        select(CompanyAccessSession).where(
            CompanyAccessSession.token_hash == hash_token(token)
        )
    ).scalar_one_or_none()
    return bool(
        session
        and session.revoked_at is None
        and _ensure_aware(session.expires_at) > utc_now()
    )


def set_company_access_cookie(
    response: Response,
    token: str,
    expires_at: datetime,
    *,
    secure: bool,
) -> None:
    response.set_cookie(
        key=COMPANY_ACCESS_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        secure=secure,
        max_age=max(int((_ensure_aware(expires_at) - utc_now()).total_seconds()), 0),
        path=session_cookie_path(settings),
    )
