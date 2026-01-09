from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def session_expiry(hours: int = 12) -> datetime:
    return utc_now() + timedelta(hours=hours)
