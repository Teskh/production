from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
import time as time_module

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, union_all
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routes.geovictoria import (
    _candidate_user_ids,
    _is_geovictoria_bad_request,
    _post_geovictoria,
    _post_with_candidates,
)
from app.api.routes.shift_estimates import ALGORITHM_VERSION, _build_attendance_map
from app.models.enums import (
    PanelUnitStatus,
    TaskExceptionType,
    TaskScope,
    TaskStatus,
    WorkUnitStatus,
)
from app.models.geovictoria_attendance_cache import GeoVictoriaAttendanceCache
from app.models.house import PanelDefinition
from app.models.shift_estimate_worker_presence import ShiftEstimateWorkerPresence
from app.models.tasks import TaskException, TaskInstance, TaskParticipation
from app.models.work import PanelUnit, WorkUnit
from app.models.workers import Worker, WorkerSupervisor
from app.schemas.line_attendance_throughput import (
    LineAttendanceThroughputAttendanceResponse,
    LineAttendanceThroughputCostCenterDay,
    LineAttendanceThroughputCostCenterPerson,
    LineAttendanceThroughputCostCenterSummary,
    LineAttendanceThroughputCoverage,
    LineAttendanceThroughputDay,
    LineAttendanceThroughputPersonShiftDay,
    LineAttendanceThroughputResponse,
    LineAttendanceThroughputSupervisorDay,
    LineAttendanceThroughputSupervisorOption,
    LineAttendanceThroughputSupervisorSummary,
    LineAttendanceThroughputWorkerAssignment,
    LineAttendanceThroughputWorkerDay,
)
from app.services.buk_people import (
    BukPerson,
    build_buk_people_index,
    fetch_buk_people,
    normalize_person_identifier,
)

router = APIRouter()

DEFAULT_RANGE_DAYS = 14
MAX_RANGE_DAYS = 93
ATTENDANCE_CACHE_TTL_SECONDS = 15 * 60
PERSISTED_ATTENDANCE_CACHE_TTL = timedelta(hours=24)
ATTENDANCE_BATCH_SIZE = 30
UNASSIGNED_BUCKET = "unassigned"
SUPERVISOR_BUCKET = "supervisor"
_ATTENDANCE_PRESENT_DATES_CACHE: dict[
    tuple[str, str, str, str], tuple[float, set[date]]
] = {}


@dataclass(frozen=True)
class CachedAttendanceDay:
    is_present: bool
    first_entry: datetime | None = None
    last_exit: datetime | None = None


def _parse_date_input(value: str | None, field: str) -> date | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {field} value",
        ) from exc


def _resolve_range(
    from_date: str | None,
    to_date: str | None,
) -> tuple[date, date]:
    parsed_from = _parse_date_input(from_date, "from_date")
    parsed_to = _parse_date_input(to_date, "to_date")

    if parsed_from is None and parsed_to is None:
        end_date = datetime.now().date() - timedelta(days=1)
        start_date = end_date - timedelta(days=DEFAULT_RANGE_DAYS - 1)
        return start_date, end_date

    if parsed_from is None or parsed_to is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="from_date and to_date must both be provided",
        )

    if parsed_from > parsed_to:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="from_date must be before to_date",
        )

    range_days = (parsed_to - parsed_from).days + 1
    if range_days > MAX_RANGE_DAYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Range cannot exceed {MAX_RANGE_DAYS} days",
        )
    return parsed_from, parsed_to


def _iter_dates(start_date: date, end_date: date) -> list[date]:
    span = (end_date - start_date).days
    return [start_date + timedelta(days=offset) for offset in range(span + 1)]


def _normalize_identifier(value: object | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _format_supervisor_name(supervisor: WorkerSupervisor | None, supervisor_id: int | None) -> str:
    if supervisor is None:
        if supervisor_id is None:
            return "Sin supervisor"
        return f"Supervisor #{supervisor_id}"
    full_name = f"{supervisor.first_name} {supervisor.last_name}".strip()
    return full_name or f"Supervisor #{supervisor.id}"


def _summarize_upstream_detail(detail: object) -> str:
    text = " ".join(str(detail).split())
    if "429 Too Many Requests" in text:
        return "GeoVictoria devolvio 429 Too Many Requests."
    if "timed out" in text.lower():
        return "La consulta a GeoVictoria excedio el tiempo limite."
    return text


def _fetch_attendance_for_identifier(
    identifier: str,
    geovictoria_id: str | None,
    start_date: date,
    end_date: date,
) -> dict[date, object]:
    normalized_identifier = identifier.strip()
    if not normalized_identifier:
        return {}
    start_dt = datetime.combine(start_date, time(0, 0, 0))
    end_dt = datetime.combine(end_date, time(23, 59, 59))
    payload = {
        "StartDate": start_dt.strftime("%Y%m%d%H%M%S"),
        "EndDate": end_dt.strftime("%Y%m%d%H%M%S"),
        "UserIds": normalized_identifier,
    }
    candidates = _candidate_user_ids(normalized_identifier, (geovictoria_id or "").strip())
    if not candidates:
        return {}
    attendance_raw, _ = _post_with_candidates("AttendanceBook", payload, candidates)
    return _build_attendance_map(attendance_raw)


def _build_attendance_maps_by_identifier(
    attendance_raw: object,
) -> dict[str, dict[date, object]]:
    if not isinstance(attendance_raw, dict):
        return {}
    users = attendance_raw.get("Users")
    if not isinstance(users, list):
        return {}

    attendance_maps: dict[str, dict[date, object]] = {}
    for user in users:
        if not isinstance(user, dict):
            continue
        normalized_identifier = normalize_person_identifier(user.get("Identifier"))
        if not normalized_identifier:
            continue
        attendance_maps[normalized_identifier] = _build_attendance_map({"Users": [user]})
    return attendance_maps


def _fetch_attendance_for_identifier_batch(
    batch_entries: list[tuple[str, str, str | None]],
    start_date: date,
    end_date: date,
) -> tuple[dict[str, dict[date, object]], list[tuple[str, str, str | None]]]:
    normalized_identifiers: list[str] = []
    for _identifier_key, raw_identifier, _geovictoria_id in batch_entries:
        normalized_identifier = (
            normalize_person_identifier(raw_identifier) or raw_identifier.strip()
        )
        if normalized_identifier and normalized_identifier not in normalized_identifiers:
            normalized_identifiers.append(normalized_identifier)
    if not normalized_identifiers:
        return {}, list(batch_entries)

    start_dt = datetime.combine(start_date, time(0, 0, 0))
    end_dt = datetime.combine(end_date, time(23, 59, 59))
    payload = {
        "StartDate": start_dt.strftime("%Y%m%d%H%M%S"),
        "EndDate": end_dt.strftime("%Y%m%d%H%M%S"),
        "UserIds": ",".join(normalized_identifiers),
    }
    try:
        attendance_raw = _post_geovictoria("AttendanceBook", payload)
    except HTTPException as exc:
        if _is_geovictoria_bad_request(exc) and len(batch_entries) > 1:
            midpoint = len(batch_entries) // 2
            left_maps, left_unresolved = _fetch_attendance_for_identifier_batch(
                batch_entries[:midpoint],
                start_date,
                end_date,
            )
            right_maps, right_unresolved = _fetch_attendance_for_identifier_batch(
                batch_entries[midpoint:],
                start_date,
                end_date,
            )
            return (
                {**left_maps, **right_maps},
                [*left_unresolved, *right_unresolved],
            )
        raise

    attendance_maps = _build_attendance_maps_by_identifier(attendance_raw)
    unresolved_entries = [
        entry for entry in batch_entries if entry[0] not in attendance_maps
    ]
    return attendance_maps, unresolved_entries


def _present_dates_from_attendance_map(attendance_map: dict[date, object]) -> set[date]:
    return {
        day_key
        for day_key, state in attendance_map.items()
        if getattr(state, "entry", None) or getattr(state, "exit", None)
    }


def _chunked[T](items: list[T], size: int) -> list[list[T]]:
    if size <= 0:
        return [items]
    return [items[index : index + size] for index in range(0, len(items), size)]


def _attendance_cache_key(
    identifier: str,
    geovictoria_id: str | None,
    start_date: date,
    end_date: date,
) -> tuple[str, str, str, str]:
    return (
        normalize_person_identifier(identifier) or identifier.strip(),
        (geovictoria_id or "").strip(),
        start_date.isoformat(),
        end_date.isoformat(),
    )


def _get_cached_present_dates(
    identifier: str,
    geovictoria_id: str | None,
    start_date: date,
    end_date: date,
) -> set[date] | None:
    cache_key = _attendance_cache_key(identifier, geovictoria_id, start_date, end_date)
    cached = _ATTENDANCE_PRESENT_DATES_CACHE.get(cache_key)
    if not cached:
        return None
    expires_at, present_dates = cached
    if expires_at <= time_module.monotonic():
        _ATTENDANCE_PRESENT_DATES_CACHE.pop(cache_key, None)
        return None
    return set(present_dates)


def _set_cached_present_dates(
    identifier: str,
    geovictoria_id: str | None,
    start_date: date,
    end_date: date,
    present_dates: set[date],
) -> None:
    cache_key = _attendance_cache_key(identifier, geovictoria_id, start_date, end_date)
    _ATTENDANCE_PRESENT_DATES_CACHE[cache_key] = (
        time_module.monotonic() + ATTENDANCE_CACHE_TTL_SECONDS,
        set(present_dates),
    )


def _build_local_presence_dates_by_identifier(
    db: Session,
    start_date: date,
    end_date: date,
    workers: list[Worker],
) -> dict[str, set[date]]:
    eligible_worker_ids = [worker.id for worker in workers]
    if not eligible_worker_ids:
        return {}

    workers_by_id = {worker.id: worker for worker in workers}
    presence_rows = db.execute(
        select(ShiftEstimateWorkerPresence.date, ShiftEstimateWorkerPresence.worker_id)
        .where(ShiftEstimateWorkerPresence.date >= start_date)
        .where(ShiftEstimateWorkerPresence.date <= end_date)
        .where(ShiftEstimateWorkerPresence.algorithm_version == ALGORITHM_VERSION)
        .where(ShiftEstimateWorkerPresence.is_present.is_(True))
        .where(ShiftEstimateWorkerPresence.worker_id.in_(sorted(eligible_worker_ids)))
    ).all()

    local_presence_dates_by_identifier: dict[str, set[date]] = defaultdict(set)
    for row_date, worker_id in presence_rows:
        worker = workers_by_id.get(worker_id)
        if worker is None:
            continue
        for value in (worker.geovictoria_identifier, worker.geovictoria_id):
            normalized_identifier = normalize_person_identifier(value)
            if normalized_identifier:
                local_presence_dates_by_identifier[normalized_identifier].add(row_date)
    return local_presence_dates_by_identifier


def _build_workers_by_geo_identifier(workers: list[Worker]) -> dict[str, Worker]:
    workers_by_identifier: dict[str, Worker] = {}
    for worker in workers:
        for value in (worker.geovictoria_identifier, worker.geovictoria_id):
            normalized_identifier = normalize_person_identifier(value)
            if normalized_identifier and normalized_identifier not in workers_by_identifier:
                workers_by_identifier[normalized_identifier] = worker
    return workers_by_identifier


def _resolve_attendance_identifiers_for_person(
    person: BukPerson,
    workers_by_geo_identifier: dict[str, Worker],
) -> tuple[str, str | None]:
    identifier_key = person.normalized_identifier
    raw_identifier = _normalize_identifier(person.identifier) or identifier_key or ""
    geovictoria_id: str | None = None
    if not identifier_key:
        return raw_identifier, geovictoria_id

    matched_worker = workers_by_geo_identifier.get(identifier_key)
    if not matched_worker:
        return raw_identifier, geovictoria_id

    worker_identifier = _normalize_identifier(matched_worker.geovictoria_identifier)
    worker_geovictoria_id = _normalize_identifier(matched_worker.geovictoria_id)
    if worker_identifier:
        raw_identifier = worker_identifier
    if worker_geovictoria_id:
        geovictoria_id = worker_geovictoria_id
    return raw_identifier, geovictoria_id


def _load_persisted_attendance_cache(
    db: Session,
    normalized_identifiers: list[str],
    start_date: date,
    end_date: date,
) -> dict[str, dict[date, CachedAttendanceDay]]:
    if not normalized_identifiers:
        return {}

    cache_cutoff = datetime.utcnow() - PERSISTED_ATTENDANCE_CACHE_TTL
    rows = db.execute(
        select(
            GeoVictoriaAttendanceCache.normalized_identifier,
            GeoVictoriaAttendanceCache.attendance_date,
            GeoVictoriaAttendanceCache.is_present,
            GeoVictoriaAttendanceCache.first_entry,
            GeoVictoriaAttendanceCache.last_exit,
        )
        .where(
            GeoVictoriaAttendanceCache.normalized_identifier.in_(normalized_identifiers)
        )
        .where(GeoVictoriaAttendanceCache.attendance_date >= start_date)
        .where(GeoVictoriaAttendanceCache.attendance_date <= end_date)
        .where(GeoVictoriaAttendanceCache.fetched_at >= cache_cutoff)
    ).all()

    cache_by_identifier: dict[str, dict[date, CachedAttendanceDay]] = defaultdict(dict)
    for normalized_identifier, attendance_date, is_present, first_entry, last_exit in rows:
        cache_by_identifier[normalized_identifier][attendance_date] = CachedAttendanceDay(
            is_present=bool(is_present),
            first_entry=first_entry,
            last_exit=last_exit,
        )
    return cache_by_identifier


def _build_persisted_attendance_cache_rows(
    normalized_identifier: str,
    source_identifier: str,
    geovictoria_id: str | None,
    requested_days: list[date],
    attendance_map: dict[date, object],
) -> list[dict[str, object]]:
    fetched_at = datetime.utcnow()
    rows: list[dict[str, object]] = []
    for current_date in requested_days:
        state = attendance_map.get(current_date)
        entry = getattr(state, "entry", None)
        exit_time = getattr(state, "exit", None)
        rows.append(
            {
                "normalized_identifier": normalized_identifier,
                "attendance_date": current_date,
                "is_present": bool(entry or exit_time),
                "first_entry": entry,
                "last_exit": exit_time,
                "source_identifier": source_identifier,
                "geovictoria_id": geovictoria_id,
                "fetched_at": fetched_at,
            }
        )
    return rows


def _build_persisted_presence_cache_rows(
    normalized_identifier: str,
    source_identifier: str,
    geovictoria_id: str | None,
    requested_days: list[date],
    present_dates: set[date],
) -> list[dict[str, object]]:
    fetched_at = datetime.utcnow()
    return [
        {
            "normalized_identifier": normalized_identifier,
            "attendance_date": current_date,
            "is_present": current_date in present_dates,
            "first_entry": None,
            "last_exit": None,
            "source_identifier": source_identifier,
            "geovictoria_id": geovictoria_id,
            "fetched_at": fetched_at,
        }
        for current_date in requested_days
    ]


def _upsert_persisted_attendance_cache(
    db: Session,
    rows: list[dict[str, object]],
) -> None:
    if not rows:
        return

    stmt = insert(GeoVictoriaAttendanceCache).values(rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_geovictoria_attendance_cache_identifier_day",
        set_={
            "is_present": stmt.excluded.is_present,
            "first_entry": stmt.excluded.first_entry,
            "last_exit": stmt.excluded.last_exit,
            "source_identifier": stmt.excluded.source_identifier,
            "geovictoria_id": stmt.excluded.geovictoria_id,
            "fetched_at": stmt.excluded.fetched_at,
        },
    )
    db.execute(stmt)
    db.commit()


def _build_buk_cost_center_attendance_days(
    db: Session,
    start_date: date,
    end_date: date,
    requested_cost_center_codes: list[str],
) -> tuple[
    list[LineAttendanceThroughputCostCenterDay],
    list[LineAttendanceThroughputCostCenterPerson],
    list[LineAttendanceThroughputPersonShiftDay],
    list[str],
]:
    warnings: list[str] = []
    normalized_codes = sorted({code.strip() for code in requested_cost_center_codes if code.strip()})
    if not normalized_codes:
        return [], [], [], warnings

    buk_people_by_cost_center: dict[str, list[BukPerson]] = defaultdict(list)
    try:
        for person in fetch_buk_people(include_cost_center_names=True):
            if person.active is False:
                continue
            if (
                not person.cost_center_code
                or person.cost_center_code not in normalized_codes
                or not person.normalized_identifier
            ):
                continue
            buk_people_by_cost_center[person.cost_center_code].append(person)
    except RuntimeError:
        return [], [], [], ["buk_unavailable"]

    if not buk_people_by_cost_center:
        return (
            [
                LineAttendanceThroughputCostCenterDay(
                    date=current_date,
                    cost_center_code=cost_center_code,
                    present_people_count=0,
                    total_people_count=0,
                )
                for current_date in _iter_dates(start_date, end_date)
                for cost_center_code in normalized_codes
            ],
            [],
            [],
            warnings,
        )

    workers = list(db.execute(select(Worker).order_by(Worker.id)).scalars())
    active_workers = [worker for worker in workers if worker.active is not False]
    eligible_workers = [
        worker
        for worker in active_workers
        if _normalize_identifier(worker.geovictoria_identifier)
        or _normalize_identifier(worker.geovictoria_id)
    ]
    local_presence_dates_by_identifier = _build_local_presence_dates_by_identifier(
        db,
        start_date,
        end_date,
        eligible_workers,
    )
    workers_by_geo_identifier = _build_workers_by_geo_identifier(eligible_workers)

    people_by_identifier: dict[str, BukPerson] = {}
    for people in buk_people_by_cost_center.values():
        for person in people:
            identifier_key = person.normalized_identifier
            if identifier_key and identifier_key not in people_by_identifier:
                people_by_identifier[identifier_key] = person

    attendance_present_dates_by_identifier: dict[str, set[date]] = {}
    attendance_failure_count = 0
    attendance_failure_samples: list[str] = []
    invalid_identifier_count = 0
    fallback_local_identifier_count = 0
    invalid_identifier_fallback_count = 0
    geovictoria_unavailable_detail: str | None = None
    cache_rows_to_upsert: list[dict[str, object]] = []
    pending_batch_entries: list[tuple[str, str, str | None]] = []
    ordered_people = list(people_by_identifier.items())
    requested_days = _iter_dates(start_date, end_date)
    requested_day_count = len(requested_days)
    persisted_cache_by_identifier = _load_persisted_attendance_cache(
        db,
        [identifier_key for identifier_key, _person in ordered_people],
        start_date,
        end_date,
    )

    for identifier_key, person in ordered_people:
        raw_identifier, geovictoria_id = _resolve_attendance_identifiers_for_person(
            person,
            workers_by_geo_identifier,
        )
        cached_present_dates = _get_cached_present_dates(
            raw_identifier,
            geovictoria_id,
            start_date,
            end_date,
        )
        if cached_present_dates is not None:
            attendance_present_dates_by_identifier[identifier_key] = cached_present_dates
            continue

        persisted_cache = persisted_cache_by_identifier.get(identifier_key, {})
        if len(persisted_cache) == requested_day_count:
            present_dates = {
                current_date
                for current_date, cached_day in persisted_cache.items()
                if cached_day.is_present
            }
            attendance_present_dates_by_identifier[identifier_key] = present_dates
            _set_cached_present_dates(
                raw_identifier,
                geovictoria_id,
                start_date,
                end_date,
                present_dates,
            )
            continue

        pending_batch_entries.append((identifier_key, raw_identifier, geovictoria_id))

    for batch_entries in _chunked(pending_batch_entries, ATTENDANCE_BATCH_SIZE):
        unresolved_entries = batch_entries
        try:
            batch_maps_by_identifier, unresolved_entries = _fetch_attendance_for_identifier_batch(
                batch_entries,
                start_date,
                end_date,
            )
            for identifier_key, raw_identifier, geovictoria_id in batch_entries:
                attendance_map = batch_maps_by_identifier.get(identifier_key)
                if attendance_map is None:
                    continue
                present_dates = _present_dates_from_attendance_map(attendance_map)
                attendance_present_dates_by_identifier[identifier_key] = present_dates
                _set_cached_present_dates(
                    raw_identifier,
                    geovictoria_id,
                    start_date,
                    end_date,
                    present_dates,
                )
                cache_rows_to_upsert.extend(
                    _build_persisted_attendance_cache_rows(
                        identifier_key,
                        raw_identifier,
                        geovictoria_id,
                        requested_days,
                        attendance_map,
                    )
                )
        except HTTPException:
            unresolved_entries = batch_entries

        for identifier_key, raw_identifier, geovictoria_id in unresolved_entries:
            present_dates: set[date] = set()
            try:
                attendance_map = _fetch_attendance_for_identifier(
                    raw_identifier,
                    geovictoria_id,
                    start_date,
                    end_date,
                )
                present_dates = _present_dates_from_attendance_map(attendance_map)
                cache_rows_to_upsert.extend(
                    _build_persisted_attendance_cache_rows(
                        identifier_key,
                        raw_identifier,
                        geovictoria_id,
                        requested_days,
                        attendance_map,
                    )
                )
            except HTTPException as exc:
                is_bad_request = _is_geovictoria_bad_request(exc)
                if is_bad_request:
                    invalid_identifier_count += 1
                else:
                    attendance_failure_count += 1
                    if len(attendance_failure_samples) < 2:
                        attendance_failure_samples.append(
                            _summarize_upstream_detail(exc.detail)
                        )
                present_dates = set(local_presence_dates_by_identifier.get(identifier_key, set()))
                if present_dates:
                    if is_bad_request:
                        invalid_identifier_fallback_count += 1
                    else:
                        fallback_local_identifier_count += 1
                elif not is_bad_request:
                    geovictoria_unavailable_detail = _summarize_upstream_detail(exc.detail)
                if is_bad_request:
                    cache_rows_to_upsert.extend(
                        _build_persisted_presence_cache_rows(
                            identifier_key,
                            raw_identifier,
                            geovictoria_id,
                            requested_days,
                            present_dates,
                        )
                    )
            attendance_present_dates_by_identifier[identifier_key] = present_dates
            _set_cached_present_dates(
                raw_identifier,
                geovictoria_id,
                start_date,
                end_date,
                present_dates,
            )

    _upsert_persisted_attendance_cache(db, cache_rows_to_upsert)
    for row in cache_rows_to_upsert:
        normalized_identifier = row.get("normalized_identifier")
        attendance_date = row.get("attendance_date")
        if not isinstance(normalized_identifier, str) or not isinstance(attendance_date, date):
            continue
        persisted_cache_by_identifier[normalized_identifier][attendance_date] = CachedAttendanceDay(
            is_present=bool(row.get("is_present")),
            first_entry=(
                row.get("first_entry")
                if isinstance(row.get("first_entry"), datetime)
                else None
            ),
            last_exit=(
                row.get("last_exit")
                if isinstance(row.get("last_exit"), datetime)
                else None
            ),
        )

    if invalid_identifier_count > 0:
        fallback_text = (
            f"; se uso fallback local para {invalid_identifier_fallback_count} personas vinculadas"
            if invalid_identifier_fallback_count > 0
            else ""
        )
        warnings.append(
            "GeoVictoria omitio "
            f"{invalid_identifier_count} identificadores no aceptados{fallback_text}."
        )

    if attendance_failure_count > 0:
        sample = (
            f" Ejemplo: {attendance_failure_samples[0]}"
            if attendance_failure_samples
            else ""
        )
        if geovictoria_unavailable_detail:
            warnings.append(
                f"GeoVictoria attendance unavailable: {geovictoria_unavailable_detail}"
            )
        if fallback_local_identifier_count > 0:
            warnings.append(
                "GeoVictoria attendance partial: "
                f"{attendance_failure_count} consultas fallaron; "
                f"se uso fallback local para {fallback_local_identifier_count} personas vinculadas."
                f"{sample}"
            )
        else:
            warnings.append(
                "GeoVictoria attendance partial: "
                f"{attendance_failure_count} consultas fallaron.{sample}"
            )

    buk_present_people_by_day_cost_center: dict[date, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    for cost_center_code, people in buk_people_by_cost_center.items():
        for person in people:
            identifier_key = person.normalized_identifier
            if not identifier_key:
                continue
            for day_key in attendance_present_dates_by_identifier.get(identifier_key, set()):
                buk_present_people_by_day_cost_center[day_key][cost_center_code] += 1

    response_days = [
        LineAttendanceThroughputCostCenterDay(
            date=current_date,
            cost_center_code=cost_center_code,
            present_people_count=buk_present_people_by_day_cost_center.get(current_date, {}).get(
                cost_center_code,
                0,
            ),
            total_people_count=len(buk_people_by_cost_center.get(cost_center_code, [])),
        )
        for current_date in _iter_dates(start_date, end_date)
        for cost_center_code in normalized_codes
    ]
    response_people = [
        LineAttendanceThroughputCostCenterPerson(
            identifier=person.normalized_identifier,
            person_name=person.full_name,
            cost_center_code=cost_center_code,
            cost_center_name=person.cost_center_name,
        )
        for cost_center_code, people in buk_people_by_cost_center.items()
        for person in people
        if person.normalized_identifier
    ]

    response_shift_days: list[LineAttendanceThroughputPersonShiftDay] = []
    for cost_center_code, people in buk_people_by_cost_center.items():
        for person in people:
            identifier_key = person.normalized_identifier
            if not identifier_key:
                continue
            cached_days = persisted_cache_by_identifier.get(identifier_key, {})
            for current_date in requested_days:
                cached_day = cached_days.get(current_date)
                response_shift_days.append(
                    LineAttendanceThroughputPersonShiftDay(
                        date=current_date,
                        identifier=identifier_key,
                        person_name=person.full_name,
                        cost_center_code=cost_center_code,
                        cost_center_name=person.cost_center_name,
                        present=bool(cached_day and cached_day.is_present),
                        first_entry=cached_day.first_entry if cached_day else None,
                        last_exit=cached_day.last_exit if cached_day else None,
                    )
                )

    return response_days, response_people, response_shift_days, warnings


@router.get("/summary", response_model=LineAttendanceThroughputResponse)
def get_line_attendance_throughput_summary(
    from_date: str | None = None,
    to_date: str | None = None,
    db: Session = Depends(get_db),
) -> LineAttendanceThroughputResponse:
    start_date, end_date = _resolve_range(from_date, to_date)
    start_dt = datetime.combine(start_date, time.min)
    end_dt = datetime.combine(end_date, time.max)

    workers = list(db.execute(select(Worker).order_by(Worker.id)).scalars())
    supervisors = list(
        db.execute(
            select(WorkerSupervisor).order_by(
                WorkerSupervisor.last_name, WorkerSupervisor.first_name
            )
        ).scalars()
    )
    supervisors_by_id = {supervisor.id: supervisor for supervisor in supervisors}

    active_workers = [worker for worker in workers if worker.active is not False]
    eligible_workers = [
        worker
        for worker in active_workers
        if _normalize_identifier(worker.geovictoria_identifier)
        or _normalize_identifier(worker.geovictoria_id)
    ]
    eligible_worker_ids = {worker.id for worker in eligible_workers}
    eligible_supervised_worker_ids = {
        worker.id for worker in eligible_workers if worker.supervisor_id is not None
    }

    warnings: list[str] = []
    # This dashboard no longer depends on the full GeoVictoria roster.
    # Keep the summary route focused on local + BUK data so it stays fast and
    # avoids an extra upstream timeout-prone request.
    geovictoria_available = False
    geovictoria_active_users = 0
    geovictoria_active_users_matched_locally = 0
    geovictoria_active_users_unmatched_locally = 0
    active_local_geo_linked_workers_matched_in_geovictoria = 0
    local_supervisors_matched_in_geovictoria = 0
    buk_available = False
    buk_people_indexed = 0
    buk_people_with_cost_center = 0
    active_local_geo_linked_workers_matched_in_buk = 0
    active_local_geo_linked_workers_resolved_by_ceco = 0

    presence_rows: list[tuple[date, int]] = []
    if eligible_worker_ids:
        presence_rows = db.execute(
            select(ShiftEstimateWorkerPresence.date, ShiftEstimateWorkerPresence.worker_id)
            .where(ShiftEstimateWorkerPresence.date >= start_date)
            .where(ShiftEstimateWorkerPresence.date <= end_date)
            .where(ShiftEstimateWorkerPresence.algorithm_version == ALGORITHM_VERSION)
            .where(ShiftEstimateWorkerPresence.is_present.is_(True))
            .where(ShiftEstimateWorkerPresence.worker_id.in_(sorted(eligible_worker_ids)))
        ).all()

    buk_people_by_identifier: dict[str, BukPerson] = {}
    worker_cost_center_by_id: dict[int, str] = {}
    worker_cost_center_name_by_id: dict[int, str] = {}
    workers_matched_in_buk: set[int] = set()
    buk_people_by_cost_center: dict[str, list[BukPerson]] = defaultdict(list)
    try:
        buk_people = fetch_buk_people(include_cost_center_names=True)
        buk_people_by_identifier = build_buk_people_index(buk_people)
        buk_available = True
        buk_people_indexed = len(buk_people_by_identifier)
        buk_people_with_cost_center = sum(
            1 for person in buk_people if person.cost_center_code
        )
        for person in buk_people:
            if person.active is False:
                continue
            if not person.cost_center_code or not person.normalized_identifier:
                continue
            buk_people_by_cost_center[person.cost_center_code].append(person)
    except RuntimeError:
        warnings.append("buk_unavailable")

    worker_bucket_by_id: dict[int, int | None] = {}
    linked_worker_ids_by_bucket: dict[int | None, set[int]] = defaultdict(set)
    cost_center_worker_ids: dict[str, set[int]] = defaultdict(set)
    for worker in eligible_workers:
        direct_supervisor_id = worker.supervisor_id
        buk_person: BukPerson | None = None

        if buk_people_by_identifier:
            for value in (worker.geovictoria_identifier, worker.geovictoria_id):
                normalized_identifier = normalize_person_identifier(value)
                if not normalized_identifier:
                    continue
                buk_person = buk_people_by_identifier.get(normalized_identifier)
                if buk_person is None:
                    continue
                active_local_geo_linked_workers_matched_in_buk += 1
                workers_matched_in_buk.add(worker.id)
                if buk_person.cost_center_code:
                    worker_cost_center_by_id[worker.id] = buk_person.cost_center_code
                    if buk_person.cost_center_name:
                        worker_cost_center_name_by_id[worker.id] = buk_person.cost_center_name
                    cost_center_worker_ids[buk_person.cost_center_code].add(worker.id)
                break

        worker_bucket_by_id[worker.id] = direct_supervisor_id
        linked_worker_ids_by_bucket[direct_supervisor_id].add(worker.id)

    unresolved_worker_ids = {
        worker.id for worker in eligible_workers if worker_bucket_by_id.get(worker.id) is None
    }

    present_workers_by_day: dict[date, set[int]] = defaultdict(set)
    present_workers_by_day_bucket: dict[date, dict[int | None, set[int]]] = defaultdict(
        lambda: defaultdict(set)
    )
    productive_workers_by_day: dict[date, set[int]] = defaultdict(set)
    productive_workers_by_day_bucket: dict[date, dict[int | None, set[int]]] = defaultdict(
        lambda: defaultdict(set)
    )
    task_participations_by_day: dict[date, int] = defaultdict(int)
    task_participations_by_day_bucket: dict[date, dict[int | None, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    completed_tasks_by_day: dict[date, set[int]] = defaultdict(set)
    completed_panels_by_day: dict[date, set[int]] = defaultdict(set)
    finished_panels_by_day: dict[date, int] = defaultdict(int)
    finished_panel_area_by_day: dict[date, float] = defaultdict(float)
    finished_panel_linear_meters_by_day: dict[date, float] = defaultdict(float)
    finished_modules_by_day: dict[date, int] = defaultdict(int)
    panel_touches_by_day_bucket: dict[date, dict[int | None, set[int]]] = defaultdict(
        lambda: defaultdict(set)
    )
    task_participations_by_day_worker: dict[date, dict[int, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    panel_touches_by_day_worker: dict[date, dict[int, set[int]]] = defaultdict(
        lambda: defaultdict(set)
    )

    if eligible_worker_ids:
        for row_date, worker_id in presence_rows:
            present_workers_by_day[row_date].add(worker_id)
            bucket = worker_bucket_by_id.get(worker_id)
            present_workers_by_day_bucket[row_date][bucket].add(worker_id)

        participation_rows = db.execute(
            select(
                TaskParticipation.id,
                TaskParticipation.worker_id,
                TaskInstance.completed_at,
                TaskInstance.panel_unit_id,
            )
            .join(TaskInstance, TaskParticipation.task_instance_id == TaskInstance.id)
            .where(TaskInstance.status == TaskStatus.COMPLETED)
            .where(TaskInstance.completed_at.is_not(None))
            .where(TaskInstance.completed_at >= start_dt)
            .where(TaskInstance.completed_at <= end_dt)
            .where(TaskParticipation.worker_id.in_(sorted(eligible_worker_ids)))
        ).all()
        for participation_id, worker_id, completed_at, panel_unit_id in participation_rows:
            if completed_at is None:
                continue
            row_date = completed_at.date()
            productive_workers_by_day[row_date].add(worker_id)
            task_participations_by_day[row_date] += 1
            bucket = worker_bucket_by_id.get(worker_id)
            productive_workers_by_day_bucket[row_date][bucket].add(worker_id)
            task_participations_by_day_bucket[row_date][bucket] += 1
            task_participations_by_day_worker[row_date][worker_id] += 1
            if panel_unit_id is not None:
                panel_touches_by_day_bucket[row_date][bucket].add(panel_unit_id)
                panel_touches_by_day_worker[row_date][worker_id].add(panel_unit_id)

    completion_rows = db.execute(
        select(TaskInstance.id, TaskInstance.completed_at, TaskInstance.panel_unit_id)
        .where(TaskInstance.status == TaskStatus.COMPLETED)
        .where(TaskInstance.completed_at.is_not(None))
        .where(TaskInstance.completed_at >= start_dt)
        .where(TaskInstance.completed_at <= end_dt)
    ).all()
    for task_id, completed_at, panel_unit_id in completion_rows:
        if completed_at is None:
            continue
        row_date = completed_at.date()
        completed_tasks_by_day[row_date].add(task_id)
        if panel_unit_id is not None:
            completed_panels_by_day[row_date].add(panel_unit_id)

    panel_completion_events = union_all(
        select(
            TaskInstance.panel_unit_id.label("panel_unit_id"),
            TaskInstance.completed_at.label("finished_at"),
        )
        .where(TaskInstance.scope == TaskScope.PANEL)
        .where(TaskInstance.panel_unit_id.is_not(None))
        .where(TaskInstance.completed_at.is_not(None)),
        select(
            TaskException.panel_unit_id.label("panel_unit_id"),
            TaskException.created_at.label("finished_at"),
        )
        .where(TaskException.scope == TaskScope.PANEL)
        .where(TaskException.panel_unit_id.is_not(None))
        .where(TaskException.exception_type == TaskExceptionType.SKIP),
    ).subquery()
    finished_panel_subquery = (
        select(
            panel_completion_events.c.panel_unit_id,
            func.max(panel_completion_events.c.finished_at).label("finished_at"),
        )
        .group_by(panel_completion_events.c.panel_unit_id)
        .subquery()
    )
    finished_panel_rows = db.execute(
        select(
            finished_panel_subquery.c.finished_at,
            PanelDefinition.panel_area,
            PanelDefinition.panel_length_m,
        )
        .join(PanelUnit, PanelUnit.id == finished_panel_subquery.c.panel_unit_id)
        .join(PanelDefinition, PanelDefinition.id == PanelUnit.panel_definition_id)
        .where(
            PanelUnit.status.in_(
                [PanelUnitStatus.COMPLETED, PanelUnitStatus.CONSUMED]
            )
        )
        .where(finished_panel_subquery.c.finished_at >= start_dt)
        .where(finished_panel_subquery.c.finished_at <= end_dt)
    ).all()
    for finished_at, panel_area, panel_length_m in finished_panel_rows:
        if finished_at is None:
            continue
        row_date = finished_at.date()
        finished_panels_by_day[row_date] += 1
        finished_panel_area_by_day[row_date] += float(panel_area or 0)
        finished_panel_linear_meters_by_day[row_date] += float(panel_length_m or 0)

    module_completion_events = union_all(
        select(
            TaskInstance.work_unit_id.label("work_unit_id"),
            TaskInstance.completed_at.label("finished_at"),
        )
        .where(TaskInstance.scope == TaskScope.MODULE)
        .where(TaskInstance.completed_at.is_not(None)),
        select(
            TaskException.work_unit_id.label("work_unit_id"),
            TaskException.created_at.label("finished_at"),
        )
        .where(TaskException.scope == TaskScope.MODULE)
        .where(TaskException.exception_type == TaskExceptionType.SKIP),
    ).subquery()
    finished_module_subquery = (
        select(
            module_completion_events.c.work_unit_id,
            func.max(module_completion_events.c.finished_at).label("finished_at"),
        )
        .group_by(module_completion_events.c.work_unit_id)
        .subquery()
    )
    finished_module_rows = db.execute(
        select(finished_module_subquery.c.finished_at)
        .join(WorkUnit, WorkUnit.id == finished_module_subquery.c.work_unit_id)
        .where(WorkUnit.status == WorkUnitStatus.COMPLETED)
        .where(finished_module_subquery.c.finished_at >= start_dt)
        .where(finished_module_subquery.c.finished_at <= end_dt)
    ).all()
    for (finished_at,) in finished_module_rows:
        if finished_at is None:
            continue
        finished_modules_by_day[finished_at.date()] += 1

    ordered_bucket_ids = [supervisor.id for supervisor in supervisors]
    has_unassigned_bucket = (
        bool(linked_worker_ids_by_bucket.get(None))
        or any(None in buckets for buckets in present_workers_by_day_bucket.values())
        or any(None in buckets for buckets in productive_workers_by_day_bucket.values())
        or any(None in buckets for buckets in task_participations_by_day_bucket.values())
    )
    if has_unassigned_bucket:
        ordered_bucket_ids.append(None)

    coverage = LineAttendanceThroughputCoverage(
        geovictoria_available=geovictoria_available,
        geovictoria_active_users=geovictoria_active_users,
        geovictoria_active_users_matched_locally=geovictoria_active_users_matched_locally,
        geovictoria_active_users_unmatched_locally=geovictoria_active_users_unmatched_locally,
        buk_available=buk_available,
        buk_people_indexed=buk_people_indexed,
        buk_people_with_cost_center=buk_people_with_cost_center,
        active_local_workers=len(active_workers),
        active_local_geo_linked_workers=len(eligible_workers),
        active_local_geo_linked_workers_matched_in_geovictoria=active_local_geo_linked_workers_matched_in_geovictoria,
        active_local_geo_linked_workers_matched_in_buk=active_local_geo_linked_workers_matched_in_buk,
        active_local_geo_linked_workers_with_supervisor=len(eligible_supervised_worker_ids),
        active_local_geo_linked_workers_without_supervisor=max(
            len(eligible_workers) - len(eligible_supervised_worker_ids),
            0,
        ),
        active_local_geo_linked_workers_resolved_by_ceco=active_local_geo_linked_workers_resolved_by_ceco,
        active_local_geo_linked_workers_unresolved_after_fallback=len(unresolved_worker_ids),
        local_supervisors=len(supervisors),
        local_supervisors_matched_in_geovictoria=local_supervisors_matched_in_geovictoria,
        supervisor_cost_center_mappings=0,
    )

    response_days: list[LineAttendanceThroughputDay] = []
    response_supervisor_days: list[LineAttendanceThroughputSupervisorDay] = []
    response_worker_days: list[LineAttendanceThroughputWorkerDay] = []
    ordered_dates = _iter_dates(start_date, end_date)
    for current_date in ordered_dates:
        present_workers = present_workers_by_day.get(current_date, set())
        productive_workers = productive_workers_by_day.get(current_date, set())
        supervised_present_workers = {
            worker_id
            for worker_id in present_workers
            if worker_bucket_by_id.get(worker_id) is not None
        }
        supervised_productive_workers = {
            worker_id
            for worker_id in productive_workers
            if worker_bucket_by_id.get(worker_id) is not None
        }

        response_days.append(
            LineAttendanceThroughputDay(
                date=current_date,
                eligible_local_worker_count=len(eligible_workers),
                eligible_supervised_worker_count=len(eligible_supervised_worker_ids),
                present_worker_count=len(present_workers),
                present_supervised_worker_count=len(supervised_present_workers),
                present_unassigned_worker_count=max(
                    len(present_workers) - len(supervised_present_workers),
                    0,
                ),
                productive_worker_count=len(productive_workers),
                productive_supervised_worker_count=len(supervised_productive_workers),
                productive_unassigned_worker_count=max(
                    len(productive_workers) - len(supervised_productive_workers),
                    0,
                ),
                present_productive_overlap_count=len(present_workers & productive_workers),
                task_participation_count=task_participations_by_day.get(current_date, 0),
                completed_task_count=len(completed_tasks_by_day.get(current_date, set())),
                completed_panel_count=len(completed_panels_by_day.get(current_date, set())),
                finished_panel_count=finished_panels_by_day.get(current_date, 0),
                finished_panel_area_m2=round(
                    finished_panel_area_by_day.get(current_date, 0.0), 2
                ),
                finished_panel_linear_meters=round(
                    finished_panel_linear_meters_by_day.get(current_date, 0.0), 2
                ),
                finished_module_count=finished_modules_by_day.get(current_date, 0),
            )
        )

        for worker in eligible_workers:
            response_worker_days.append(
                LineAttendanceThroughputWorkerDay(
                    date=current_date,
                    worker_id=worker.id,
                    present=worker.id in present_workers,
                    productive=worker.id in productive_workers,
                    task_participation_count=task_participations_by_day_worker.get(
                        current_date, {}
                    ).get(worker.id, 0),
                    panel_touch_ids=sorted(
                        panel_touches_by_day_worker.get(current_date, {}).get(worker.id, set())
                    ),
                )
            )

        for bucket_id in ordered_bucket_ids:
            supervisor = supervisors_by_id.get(bucket_id) if bucket_id is not None else None
            response_supervisor_days.append(
                LineAttendanceThroughputSupervisorDay(
                    date=current_date,
                    bucket=SUPERVISOR_BUCKET if bucket_id is not None else UNASSIGNED_BUCKET,
                    supervisor_id=bucket_id,
                    supervisor_name=_format_supervisor_name(supervisor, bucket_id),
                    linked_worker_count=len(linked_worker_ids_by_bucket.get(bucket_id, set())),
                    present_worker_count=len(
                        present_workers_by_day_bucket.get(current_date, {}).get(bucket_id, set())
                    ),
                    productive_worker_count=len(
                        productive_workers_by_day_bucket.get(current_date, {}).get(bucket_id, set())
                    ),
                    present_productive_overlap_count=len(
                        present_workers_by_day_bucket.get(current_date, {}).get(bucket_id, set())
                        & productive_workers_by_day_bucket.get(current_date, {}).get(bucket_id, set())
                    ),
                    task_participation_count=task_participations_by_day_bucket.get(
                        current_date, {}
                    ).get(bucket_id, 0),
                    panel_touch_count=len(
                        panel_touches_by_day_bucket.get(current_date, {}).get(bucket_id, set())
                    ),
                )
            )

    response_supervisor_summaries: list[LineAttendanceThroughputSupervisorSummary] = []
    for bucket_id in ordered_bucket_ids:
        supervisor = supervisors_by_id.get(bucket_id) if bucket_id is not None else None
        unique_present_workers: set[int] = set()
        unique_productive_workers: set[int] = set()
        present_worker_days = 0
        productive_worker_days = 0
        overlap_worker_days = 0
        task_participation_count = 0
        panel_touch_ids: set[int] = set()

        for current_date in ordered_dates:
            present_workers = present_workers_by_day_bucket.get(current_date, {}).get(
                bucket_id, set()
            )
            productive_workers = productive_workers_by_day_bucket.get(current_date, {}).get(
                bucket_id, set()
            )
            unique_present_workers.update(present_workers)
            unique_productive_workers.update(productive_workers)
            present_worker_days += len(present_workers)
            productive_worker_days += len(productive_workers)
            overlap_worker_days += len(present_workers & productive_workers)
            task_participation_count += task_participations_by_day_bucket.get(
                current_date, {}
            ).get(bucket_id, 0)
            panel_touch_ids.update(
                panel_touches_by_day_bucket.get(current_date, {}).get(bucket_id, set())
            )

        response_supervisor_summaries.append(
            LineAttendanceThroughputSupervisorSummary(
                bucket=SUPERVISOR_BUCKET if bucket_id is not None else UNASSIGNED_BUCKET,
                supervisor_id=bucket_id,
                supervisor_name=_format_supervisor_name(supervisor, bucket_id),
                linked_worker_count=len(linked_worker_ids_by_bucket.get(bucket_id, set())),
                present_worker_days=present_worker_days,
                productive_worker_days=productive_worker_days,
                present_productive_overlap_days=overlap_worker_days,
                unique_present_worker_count=len(unique_present_workers),
                unique_productive_worker_count=len(unique_productive_workers),
                task_participation_count=task_participation_count,
                panel_touch_count=len(panel_touch_ids),
            )
        )

    response_supervisor_summaries.sort(
        key=lambda item: (
            item.bucket == UNASSIGNED_BUCKET,
            -item.productive_worker_days,
            item.supervisor_name.lower(),
        )
    )

    response_supervisors = [
        LineAttendanceThroughputSupervisorOption(
            id=supervisor.id,
            name=_format_supervisor_name(supervisor, supervisor.id),
        )
        for supervisor in supervisors
    ]
    response_buk_cost_center_days: list[LineAttendanceThroughputCostCenterDay] = []
    all_cost_center_codes = sorted(
        set(cost_center_worker_ids.keys()) | set(buk_people_by_cost_center.keys())
    )
    response_buk_cost_centers = [
        LineAttendanceThroughputCostCenterSummary(
            cost_center_code=cost_center_code,
            cost_center_name=(
                next(
                    (
                        worker_cost_center_name_by_id[worker_id]
                        for worker_id in sorted(worker_ids)
                        if worker_id in worker_cost_center_name_by_id
                    ),
                    None,
                )
                or next(
                    (
                        person.cost_center_name
                        for person in buk_people_by_cost_center.get(cost_center_code, [])
                        if person.cost_center_name
                    ),
                    None,
                )
            ),
            buk_people_count=len(buk_people_by_cost_center.get(cost_center_code, [])),
            matched_local_worker_count=len(worker_ids),
            direct_supervisor_worker_count=sum(
                1
                for worker_id in worker_ids
                if worker_bucket_by_id.get(worker_id) is not None
            ),
            fallback_candidate_worker_count=sum(
                1
                for worker_id in worker_ids
                if worker_bucket_by_id.get(worker_id) is None
            ),
        )
        for cost_center_code in all_cost_center_codes
        for worker_ids in [cost_center_worker_ids.get(cost_center_code, set())]
    ]
    response_worker_assignments = [
        LineAttendanceThroughputWorkerAssignment(
            worker_id=worker.id,
            worker_name=(
                f"{worker.first_name} {worker.last_name}".strip()
                or f"Trabajador #{worker.id}"
            ),
            geovictoria_identifier=_normalize_identifier(
                worker.geovictoria_identifier or worker.geovictoria_id
            ),
            direct_supervisor_id=worker.supervisor_id,
            buk_matched=worker.id in workers_matched_in_buk,
            buk_cost_center_code=worker_cost_center_by_id.get(worker.id),
            buk_cost_center_name=worker_cost_center_name_by_id.get(worker.id),
        )
        for worker in eligible_workers
    ]

    return LineAttendanceThroughputResponse(
        from_date=start_date,
        to_date=end_date,
        generated_at=datetime.utcnow(),
        ceco_mapping_enabled=False,
        coverage=coverage,
        warnings=warnings,
        days=response_days,
        supervisor_summaries=response_supervisor_summaries,
        supervisor_days=response_supervisor_days,
        supervisors=response_supervisors,
        buk_cost_centers=response_buk_cost_centers,
        buk_cost_center_days=response_buk_cost_center_days,
        worker_assignments=response_worker_assignments,
        worker_days=response_worker_days,
    )


@router.get("/attendance", response_model=LineAttendanceThroughputAttendanceResponse)
def get_line_attendance_throughput_attendance(
    from_date: str | None = None,
    to_date: str | None = None,
    cost_center_code: list[str] = Query(default=[]),
    db: Session = Depends(get_db),
) -> LineAttendanceThroughputAttendanceResponse:
    start_date, end_date = _resolve_range(from_date, to_date)
    normalized_codes = sorted({code.strip() for code in cost_center_code if code.strip()})
    response_days, response_people, response_shift_days, warnings = (
        _build_buk_cost_center_attendance_days(
            db,
            start_date,
            end_date,
            normalized_codes,
        )
    )
    return LineAttendanceThroughputAttendanceResponse(
        from_date=start_date,
        to_date=end_date,
        generated_at=datetime.utcnow(),
        requested_cost_center_codes=normalized_codes,
        warnings=warnings,
        buk_cost_center_days=response_days,
        buk_people=response_people,
        buk_person_shift_days=response_shift_days,
    )
