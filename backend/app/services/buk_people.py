from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import re
import time
from typing import Any, Mapping

import httpx

from app.core.config import settings

PEOPLE_PER_PAGE = 100
AREAS_PER_PAGE = 100
MAX_PAGES = 50
PEOPLE_INCLUDE = (
    "department,sub_department,position,employment,contract,organizational_unit,"
    "company_area,team,current_job,current_employment"
)

_PEOPLE_CACHE: dict[str, object] = {"people": None, "expires_at": 0.0}
_COST_CENTER_NAMES_CACHE: dict[str, object] = {"mapping": None, "expires_at": 0.0}


@dataclass(frozen=True)
class BukPerson:
    identifier: str | None
    normalized_identifier: str | None
    full_name: str | None
    cost_center_code: str | None
    cost_center_name: str | None
    status: str | None
    active: bool | None


def _require_token() -> str:
    token = settings.buk_api_token
    if not token:
        raise RuntimeError("BUK token not configured in environment.")
    return token


def _arr_get(payload: Mapping[str, object], path: str) -> object | None:
    current: object | None = payload
    for segment in path.split("."):
        if not isinstance(current, Mapping) or segment not in current:
            return None
        current = current.get(segment)
    return current


def _first_non_empty(payload: Mapping[str, object], paths: list[str]) -> str | None:
    for path in paths:
        value = _arr_get(payload, path) if "." in path else payload.get(path)
        if value is None:
            continue
        if isinstance(value, str):
            text = value.strip()
            if text:
                return text
            continue
        if not isinstance(value, Mapping):
            text = str(value).strip()
            if text:
                return text
    return None


def normalize_person_identifier(value: object | None) -> str | None:
    if value is None:
        return None
    normalized = re.sub(r"[^0-9kK]", "", str(value)).upper()
    return normalized or None


def normalize_cost_center_code(value: object | None) -> str | None:
    if value is None:
        return None
    normalized = re.sub(r"\s+", " ", str(value)).strip().upper()
    return normalized or None


def normalize_display_text(value: object | None) -> str | None:
    if value is None:
        return None
    normalized = re.sub(r"\s+", " ", str(value)).strip()
    return normalized or None


def _extract_identifier(raw: Mapping[str, object]) -> str | None:
    return _first_non_empty(
        raw,
        [
            "rut",
            "identification",
            "id_number",
            "national_id",
            "document_number",
        ],
    )


def _extract_full_name(raw: Mapping[str, object]) -> str | None:
    full_name = _first_non_empty(raw, ["full_name"])
    if full_name:
        return full_name
    first_name = str(raw.get("first_name") or "").strip()
    last_name = str(raw.get("last_name") or "").strip()
    full_name = f"{first_name} {last_name}".strip()
    return full_name or None


def _extract_cost_center_code(raw: Mapping[str, object]) -> str | None:
    for path in [
        "current_job.cost_center",
        "current_employment.cost_center",
        "employment.cost_center",
        "cost_center",
        "centro_costo",
    ]:
        value = _arr_get(raw, path) if "." in path else raw.get(path)
        if value is None or value == "":
            continue
        if isinstance(value, Mapping):
            code = normalize_cost_center_code(value.get("code"))
            if code:
                return code
            name = normalize_cost_center_code(value.get("name"))
            if name:
                return name
            continue
        normalized = normalize_cost_center_code(value)
        if normalized:
            return normalized

    return _first_non_empty(
        raw,
        [
            "cost_center_name",
            "centro_costo_name",
            "cost_center_description",
            "centro_costo.descripcion",
            "centro_costo.description",
        ],
    )


def _extract_cost_center_name(raw: Mapping[str, object]) -> str | None:
    for path in [
        "current_job.cost_center",
        "current_employment.cost_center",
        "employment.cost_center",
        "cost_center",
        "centro_costo",
    ]:
        value = _arr_get(raw, path) if "." in path else raw.get(path)
        if not isinstance(value, Mapping):
            continue
        for key in ("name", "description", "label", "title"):
            text = normalize_display_text(value.get(key))
            if text:
                return text

    return _first_non_empty(
        raw,
        [
            "cost_center_name",
            "cost_center_description",
            "centro_costo_name",
            "centro_costo.description",
            "centro_costo.descripcion",
        ],
    )


def _normalize_person(raw: Mapping[str, object]) -> BukPerson:
    identifier = _extract_identifier(raw)
    status = _first_non_empty(raw, ["status", "employment_status", "state", "situation"])
    active_value = raw.get("active")
    active: bool | None
    if isinstance(active_value, bool):
        active = active_value
    elif isinstance(active_value, (int, float)):
        active = bool(active_value)
    elif isinstance(active_value, str):
        lowered = active_value.strip().lower()
        if lowered in {"true", "1", "yes", "y", "si", "s", "activo", "active"}:
            active = True
        elif lowered in {"false", "0", "no", "n", "inactivo", "inactive"}:
            active = False
        else:
            active = None
    else:
        active = None

    return BukPerson(
        identifier=identifier,
        normalized_identifier=normalize_person_identifier(identifier),
        full_name=_extract_full_name(raw),
        cost_center_code=normalize_cost_center_code(_extract_cost_center_code(raw)),
        cost_center_name=_extract_cost_center_name(raw),
        status=status,
        active=active,
    )


def _extract_people(payload: Any) -> list[Mapping[str, object]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, Mapping)]
    if not isinstance(payload, Mapping):
        return []
    for key in ("data", "people", "employees", "items"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, Mapping)]
    return []


def _build_client_headers(token: str) -> dict[str, str]:
    return {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "auth_token": token,
        "X-Api-Key": token,
        "User-Agent": "SCP/BUK-People",
    }


def fetch_buk_cost_center_names(*, force_refresh: bool = False) -> dict[str, str]:
    now = time.time()
    cached_mapping = _COST_CENTER_NAMES_CACHE.get("mapping")
    expires_at = _COST_CENTER_NAMES_CACHE.get("expires_at", 0.0)
    if (
        not force_refresh
        and isinstance(cached_mapping, dict)
        and isinstance(expires_at, (int, float))
        and expires_at > now
    ):
        return cached_mapping

    token = _require_token()
    base_url = settings.buk_base_url.rstrip("/")
    names_by_code: dict[str, set[str]] = defaultdict(set)

    with httpx.Client(
        timeout=httpx.Timeout(30.0, connect=10.0),
        headers=_build_client_headers(token),
    ) as client:
        for page in range(1, MAX_PAGES + 1):
            try:
                response = client.get(
                    f"{base_url}/api/v1/{settings.buk_country}/organization/areas",
                    params={
                        "status": "both",
                        "page": page,
                        "page_size": AREAS_PER_PAGE,
                    },
                )
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise RuntimeError(f"BUK area request failed: {exc}") from exc

            page_rows = _extract_people(response.json())
            if not page_rows:
                break

            for row in page_rows:
                cost_center_code = normalize_cost_center_code(row.get("cost_center"))
                cost_center_name = normalize_display_text(row.get("name"))
                if not cost_center_code or not cost_center_name:
                    continue
                names_by_code[cost_center_code].add(cost_center_name)

            if len(page_rows) < AREAS_PER_PAGE:
                break

    resolved_mapping = {
        code: " / ".join(sorted(names))
        for code, names in names_by_code.items()
        if names
    }
    _COST_CENTER_NAMES_CACHE["mapping"] = resolved_mapping
    _COST_CENTER_NAMES_CACHE["expires_at"] = now + settings.buk_people_cache_ttl_seconds
    return resolved_mapping


def _apply_cost_center_names(
    people: list[BukPerson],
    cost_center_names: dict[str, str],
) -> list[BukPerson]:
    if not cost_center_names:
        return people
    return [
        BukPerson(
            identifier=person.identifier,
            normalized_identifier=person.normalized_identifier,
            full_name=person.full_name,
            cost_center_code=person.cost_center_code,
            cost_center_name=person.cost_center_name
            or (
                cost_center_names.get(person.cost_center_code)
                if person.cost_center_code
                else None
            ),
            status=person.status,
            active=person.active,
        )
        for person in people
    ]


def _enrich_people_with_cost_center_names(
    people: list[BukPerson],
    *,
    force_refresh: bool = False,
) -> list[BukPerson]:
    try:
        cost_center_names = fetch_buk_cost_center_names(force_refresh=force_refresh)
    except RuntimeError:
        return people
    return _apply_cost_center_names(people, cost_center_names)


def fetch_buk_people(
    *,
    force_refresh: bool = False,
    include_cost_center_names: bool = True,
) -> list[BukPerson]:
    now = time.time()
    cached_people = _PEOPLE_CACHE.get("people")
    expires_at = _PEOPLE_CACHE.get("expires_at", 0.0)
    if (
        not force_refresh
        and isinstance(cached_people, list)
        and isinstance(expires_at, (int, float))
        and expires_at > now
    ):
        if include_cost_center_names:
            enriched_people = _enrich_people_with_cost_center_names(cached_people)
            if enriched_people is not cached_people:
                _PEOPLE_CACHE["people"] = enriched_people
            return enriched_people
        return cached_people

    token = _require_token()
    base_url = settings.buk_base_url.rstrip("/")
    people: list[BukPerson] = []
    request_mode: str | None = None

    with httpx.Client(
        timeout=httpx.Timeout(30.0, connect=10.0),
        headers=_build_client_headers(token),
    ) as client:
        include_supported = True
        for page in range(1, MAX_PAGES + 1):
            try:
                response: httpx.Response | None = None
                modes = [request_mode] if request_mode else ["people", "employees"]
                for mode in modes:
                    if mode == "people":
                        endpoint = f"{base_url}/api/v1/{settings.buk_country}/people"
                        params = {
                            "page": page,
                            "per_page": PEOPLE_PER_PAGE,
                        }
                        if include_supported:
                            params["include"] = PEOPLE_INCLUDE
                        response = client.get(endpoint, params=params)
                        if response.status_code == 404 and include_supported:
                            include_supported = False
                            response = client.get(
                                endpoint,
                                params={
                                    "page": page,
                                    "per_page": PEOPLE_PER_PAGE,
                                },
                            )
                    else:
                        endpoint = f"{base_url}/api/v1/{settings.buk_country}/employees"
                        response = client.get(
                            endpoint,
                            params={
                                "page": page,
                                "page_size": PEOPLE_PER_PAGE,
                            },
                        )

                    if response.status_code == 404 and request_mode is None:
                        continue

                    request_mode = mode
                    break

                if response is None:
                    raise RuntimeError("BUK people request failed: no valid endpoint found.")
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise RuntimeError(f"BUK people request failed: {exc}") from exc

            page_rows = _extract_people(response.json())
            if not page_rows:
                break
            people.extend(_normalize_person(row) for row in page_rows)
            if len(page_rows) < PEOPLE_PER_PAGE:
                break

    if include_cost_center_names:
        people = _enrich_people_with_cost_center_names(
            people,
            force_refresh=force_refresh,
        )

    _PEOPLE_CACHE["people"] = people
    _PEOPLE_CACHE["expires_at"] = now + settings.buk_people_cache_ttl_seconds
    return people


def build_buk_people_index(people: list[BukPerson]) -> dict[str, BukPerson]:
    index: dict[str, BukPerson] = {}
    for person in people:
        if not person.normalized_identifier:
            continue
        index.setdefault(person.normalized_identifier, person)
    return index
