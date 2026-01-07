from __future__ import annotations

import time
from datetime import datetime, timedelta
from typing import Any, Mapping

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import settings
from app.models.workers import Worker
from app.schemas.geovictoria import (
    GeoVictoriaAttendanceResponse,
    GeoVictoriaWorker,
    GeoVictoriaWorkerSummary,
)

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


def _post_geovictoria(endpoint: str, payload: Mapping[str, Any]) -> Any:
    token = _get_token()
    url = f"{settings.geovictoria_base_url}/{endpoint.lstrip('/')}"
    try:
        resp = httpx.post(
            url,
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
            timeout=60,
        )
        if resp.status_code in (401, 403):
            _TOKEN_CACHE["token"] = None
            _TOKEN_CACHE["expires_at"] = 0.0
            token = _get_token()
            resp = httpx.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                json=payload,
                timeout=60,
            )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"GeoVictoria request failed: {exc}",
        ) from exc
    return resp.json()


def _parse_date_input(raw: str, *, end_of_day: bool) -> datetime:
    normalized = raw.strip().replace(" ", "T")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid date format",
        ) from exc
    if len(raw.strip()) == 10:
        if end_of_day:
            return dt.replace(hour=23, minute=59, second=59)
        return dt.replace(hour=0, minute=0, second=0)
    return dt


def _to_compact(dt_value: datetime) -> str:
    return dt_value.strftime("%Y%m%d%H%M%S")


def _resolve_range(
    *,
    start_date: str | None,
    end_date: str | None,
    days: int,
) -> tuple[datetime, datetime]:
    if start_date or end_date:
        if not start_date or not end_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="start_date and end_date must both be provided",
            )
        start_dt = _parse_date_input(start_date, end_of_day=False)
        end_dt = _parse_date_input(end_date, end_of_day=True)
        if end_dt < start_dt:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="end_date must be after start_date",
            )
        return start_dt, end_dt

    end_dt = datetime.now()
    start_dt = end_dt - timedelta(days=days)
    return start_dt, end_dt


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
        normalized = enabled.strip().lower()
        if normalized in {"true", "1", "yes", "y", "si", "s"}:
            enabled = True
        elif normalized in {"false", "0", "no", "n"}:
            enabled = False
        else:
            enabled = None
    elif isinstance(enabled, (int, float)):
        enabled = bool(enabled)
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


def _is_active(user: GeoVictoriaWorker) -> bool:
    if user.enabled is None:
        return True
    return user.enabled


def _summarize_user(user: GeoVictoriaWorker) -> GeoVictoriaWorkerSummary | None:
    if not user.geovictoria_id or not user.identifier:
        return None
    return GeoVictoriaWorkerSummary(
        geovictoria_id=user.geovictoria_id,
        identifier=user.identifier,
        first_name=user.first_name,
        last_name=user.last_name,
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


@router.get("/workers/active", response_model=list[GeoVictoriaWorkerSummary])
def list_active_workers() -> list[GeoVictoriaWorkerSummary]:
    active_users: list[GeoVictoriaWorkerSummary] = []
    for user in _fetch_users():
        if not _is_active(user):
            continue
        summary = _summarize_user(user)
        if summary:
            active_users.append(summary)
    return active_users


@router.get("/workers/{geovictoria_id}", response_model=GeoVictoriaWorker)
def get_worker(geovictoria_id: str) -> GeoVictoriaWorker:
    target = geovictoria_id.strip()
    for user in _fetch_users():
        if user.geovictoria_id == target:
            return user
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="GeoVictoria worker not found")


@router.get("/attendance", response_model=GeoVictoriaAttendanceResponse)
def get_attendance(
    worker_id: int = Query(..., ge=1),
    days: int = Query(30, ge=1, le=365),
    start_date: str | None = None,
    end_date: str | None = None,
    db: Session = Depends(get_db),
) -> GeoVictoriaAttendanceResponse:
    worker = db.get(Worker, worker_id)
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
    if not worker.geovictoria_identifier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Worker is not linked to a GeoVictoria identifier",
        )
    geovictoria_id = (worker.geovictoria_id or "").strip()
    geovictoria_identifier = worker.geovictoria_identifier.strip()
    if not geovictoria_identifier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Worker is not linked to a GeoVictoria identifier",
        )

    start_dt, end_dt = _resolve_range(
        start_date=start_date,
        end_date=end_date,
        days=days,
    )
    payload = {
        "StartDate": _to_compact(start_dt),
        "EndDate": _to_compact(end_dt),
        "UserIds": geovictoria_identifier,
    }
    consolidated_payload = {**payload, "IncludeAll": 0}

    attendance = _post_geovictoria("AttendanceBook", payload)
    consolidated = _post_geovictoria("Consolidated", consolidated_payload)

    return GeoVictoriaAttendanceResponse(
        worker_id=worker.id,
        worker_first_name=worker.first_name,
        worker_last_name=worker.last_name,
        geovictoria_id=geovictoria_id or geovictoria_identifier,
        geovictoria_identifier=geovictoria_identifier,
        start_date=start_dt.isoformat(),
        end_date=end_dt.isoformat(),
        attendance=attendance,
        consolidated=consolidated,
    )
