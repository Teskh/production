from __future__ import annotations

import time
from typing import Any, Mapping

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from app.core.config import settings
from app.schemas.geovictoria import GeoVictoriaWorker

router = APIRouter()

_TOKEN_CACHE: dict[str, object] = {"token": None, "expires_at": 0.0}


def _require_credentials() -> tuple[str, str]:
    user = settings.geovictoria_api_user
    password = settings.geovictoria_api_password
    if not user or not password:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GeoVictoria credentials not configured",
        )
    return user, password


def _get_token() -> str:
    user, password = _require_credentials()
    now = time.time()
    token = _TOKEN_CACHE.get("token")
    expires_at = _TOKEN_CACHE.get("expires_at", 0.0)
    if isinstance(token, str) and isinstance(expires_at, (int, float)) and expires_at > now:
        return token
    try:
        resp = httpx.post(
            f"{settings.geovictoria_base_url}/Login",
            json={"User": user, "Password": password},
            timeout=30,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"GeoVictoria auth failed: {exc}",
        ) from exc
    payload = resp.json()
    token = payload.get("token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="GeoVictoria auth did not return a token",
        )
    _TOKEN_CACHE["token"] = token
    _TOKEN_CACHE["expires_at"] = now + settings.geovictoria_token_ttl_seconds
    return token


def _extract_users(payload: Any) -> list[Mapping[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("Data", "Users", "Lista"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def _extract_id(raw: Mapping[str, Any]) -> str | None:
    for key in ("Id", "ID", "UserId", "UserID"):
        value = raw.get(key)
        if value is not None:
            return str(value).strip() or None
    return None


def _normalize_user(raw: Mapping[str, Any]) -> GeoVictoriaWorker:
    name = str(raw.get("Name") or "").strip() or None
    last_name = str(raw.get("LastName") or raw.get("Lastname") or "").strip() or None
    identifier = str(raw.get("Identifier") or "").strip() or None
    email = str(raw.get("Email") or "").strip() or None
    position = str(raw.get("PositionDescription") or "").strip() or None
    group = str(raw.get("GroupDescription") or "").strip() or None
    enabled = raw.get("Enabled")
    if isinstance(enabled, str):
        enabled = enabled.lower() == "true"
    return GeoVictoriaWorker(
        geovictoria_id=_extract_id(raw),
        identifier=identifier,
        first_name=name,
        last_name=last_name,
        email=email,
        position=position,
        group=group,
        enabled=enabled if isinstance(enabled, bool) else None,
    )


def _fetch_users() -> list[GeoVictoriaWorker]:
    def _post_user_list(token: str) -> httpx.Response:
        return httpx.post(
            f"{settings.geovictoria_base_url}/User/List",
            headers={"Authorization": f"Bearer {token}"},
            json={},
            timeout=30,
        )

    token = _get_token()
    try:
        resp = _post_user_list(token)
        if resp.status_code in (401, 403):
            _TOKEN_CACHE["token"] = None
            _TOKEN_CACHE["expires_at"] = 0.0
            token = _get_token()
            resp = _post_user_list(token)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"GeoVictoria user list failed: {exc}",
        ) from exc
    raw_users = _extract_users(resp.json())
    return [_normalize_user(user) for user in raw_users]


@router.get("/workers", response_model=list[GeoVictoriaWorker])
def search_workers(
    query: str = Query(..., min_length=2),
    limit: int = Query(8, ge=1, le=25),
) -> list[GeoVictoriaWorker]:
    q = query.strip().lower()
    results: list[GeoVictoriaWorker] = []
    for user in _fetch_users():
        haystack = " ".join(
            filter(
                None,
                [
                    user.first_name,
                    user.last_name,
                    user.identifier,
                    user.email,
                ],
            )
        ).lower()
        if q in haystack:
            results.append(user)
        if len(results) >= limit:
            break
    return results


@router.get("/workers/{geovictoria_id}", response_model=GeoVictoriaWorker)
def get_worker(geovictoria_id: str) -> GeoVictoriaWorker:
    target = geovictoria_id.strip()
    for user in _fetch_users():
        if user.geovictoria_id == target:
            return user
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="GeoVictoria worker not found")
