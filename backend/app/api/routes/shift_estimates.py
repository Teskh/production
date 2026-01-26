from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
import re
import time as time_module
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routes.geovictoria import _post_geovictoria
from app.models.enums import StationRole
from app.models.shift_estimates import ShiftEstimate
from app.models.stations import Station
from app.models.workers import Worker
from app.schemas.shift_estimates import (
    ShiftEstimateComputeRequest,
    ShiftEstimateComputeResponse,
    ShiftEstimateCoverageDay,
    ShiftEstimateDay,
    ShiftEstimateRead,
)


SHIFT_START_HOUR = 8
SHIFT_START_MINUTE = 20
SHIFT_END_OFFSET_MINUTES = 30
ALGORITHM_VERSION = 1
SLEEP_SECONDS = 0.15
CHUNK_DAYS = 14
MAX_RANGE_DAYS = 365

DATE_KEYS = ["Fecha", "fecha", "Date", "date", "Dia", "dia", "Day", "day"]
ENTRY_KEYS = [
    "Entrada",
    "entrada",
    "Entry",
    "entry",
    "In",
    "ClockIn",
    "HoraEntrada",
    "Inicio",
    "Start",
]
EXIT_KEYS = [
    "Salida",
    "salida",
    "Exit",
    "exit",
    "Out",
    "ClockOut",
    "HoraSalida",
    "Fin",
    "End",
]

COMPACT_RE = re.compile(r"^\d{8}(\d{6})?$")

router = APIRouter()


@dataclass
class AttendanceDay:
    date: date
    entry: datetime | None
    exit: datetime | None


@dataclass
class AttendanceState:
    entry: datetime | None
    exit: datetime | None


@dataclass
class StationGroup:
    key: str
    role: StationRole
    station_ids: list[int]
    station_id: int | None
    sequence_order: int | None


def _today() -> date:
    return datetime.now().date()


def _yesterday() -> date:
    return _today() - timedelta(days=1)


def _build_shift_start(day: date) -> datetime:
    return datetime.combine(day, time(SHIFT_START_HOUR, SHIFT_START_MINUTE))


def _group_key_for_station(station: Station) -> str:
    if station.role == StationRole.ASSEMBLY and station.sequence_order is not None:
        return f"assembly:{station.sequence_order}"
    return f"station:{station.id}"


def _build_station_groups(stations: list[Station]) -> dict[str, StationGroup]:
    groups: dict[str, StationGroup] = {}
    for station in stations:
        key = _group_key_for_station(station)
        existing = groups.get(key)
        if existing:
            existing.station_ids.append(station.id)
            continue
        if station.role == StationRole.ASSEMBLY and station.sequence_order is not None:
            groups[key] = StationGroup(
                key=key,
                role=station.role,
                station_ids=[station.id],
                station_id=None,
                sequence_order=station.sequence_order,
            )
        else:
            groups[key] = StationGroup(
                key=key,
                role=station.role,
                station_ids=[station.id],
                station_id=station.id,
                sequence_order=station.sequence_order,
            )
    return groups


def _build_station_worker_map(workers: list[Worker]) -> dict[int, list[Worker]]:
    station_workers: dict[int, list[Worker]] = {}
    for worker in workers:
        assigned = worker.assigned_station_ids or []
        for station_id in assigned:
            bucket = station_workers.get(station_id)
            if bucket is None:
                bucket = []
                station_workers[station_id] = bucket
            bucket.append(worker)
    return station_workers


def _build_group_workers(
    groups: dict[str, StationGroup],
    station_workers: dict[int, list[Worker]],
) -> dict[str, list[Worker]]:
    group_workers: dict[str, list[Worker]] = {}
    for key, group in groups.items():
        collected: dict[int, Worker] = {}
        for station_id in group.station_ids:
            for worker in station_workers.get(station_id, []):
                collected[worker.id] = worker
        group_workers[key] = list(collected.values())
    return group_workers


def _parse_compact_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw or not COMPACT_RE.match(raw):
        return None
    year = int(raw[0:4])
    month = int(raw[4:6])
    day = int(raw[6:8])
    if len(raw) == 8:
        return datetime(year, month, day)
    hour = int(raw[8:10])
    minute = int(raw[10:12])
    second = int(raw[12:14])
    return datetime(year, month, day, hour, minute, second)


def _parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    compact = _parse_compact_datetime(value)
    if compact:
        return compact
    raw = str(value).strip()
    if not raw:
        return None
    normalized = raw.replace(" ", "T")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _to_date_only(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    compact = _parse_compact_datetime(value)
    if compact:
        return compact.date()
    raw = str(value).strip()
    if not raw:
        return None
    if len(raw) >= 10 and raw[4] == "-" and raw[7] == "-":
        try:
            return datetime.fromisoformat(raw[:10]).date()
        except ValueError:
            return None
    parsed = _parse_datetime(raw)
    return parsed.date() if parsed else None


def _extract_list(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in (
        "Data",
        "data",
        "Records",
        "records",
        "Lista",
        "List",
        "Attendance",
        "attendance",
        "AttendanceBook",
        "attendanceBook",
    ):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def _pick_field(row: Any, keys: list[str]) -> Any | None:
    if not isinstance(row, dict):
        return None
    for key in keys:
        if key in row:
            value = row.get(key)
            if value is not None and str(value).strip():
                return value
    return None


def _normalize_attendance_book(attendance_raw: Any) -> list[AttendanceDay]:
    if not isinstance(attendance_raw, dict):
        return []
    users = attendance_raw.get("Users")
    if not isinstance(users, list) or not users:
        return []
    intervals = users[0].get("PlannedInterval") if isinstance(users[0], dict) else None
    if not isinstance(intervals, list) or not intervals:
        return []
    days: list[AttendanceDay] = []
    for interval in intervals:
        if not isinstance(interval, dict):
            continue
        date_value = _to_date_only(interval.get("Date"))
        if not date_value:
            continue
        punches = interval.get("Punches")
        punch_list = punches if isinstance(punches, list) else []
        normalized = [
            _parse_datetime(punch.get("Date"))
            for punch in punch_list
            if isinstance(punch, dict)
        ]
        normalized = [item for item in normalized if item]
        normalized.sort()
        entry = normalized[0] if normalized else None
        exit_time = normalized[-1] if normalized else None
        days.append(AttendanceDay(date=date_value, entry=entry, exit=exit_time))
    return days


def _normalize_attendance(attendance_raw: Any) -> list[AttendanceDay]:
    book_days = _normalize_attendance_book(attendance_raw)
    rows = _extract_list(attendance_raw)
    row_days: list[AttendanceDay] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        date_value = (
            _to_date_only(_pick_field(row, DATE_KEYS))
            or _to_date_only(_pick_field(row, ENTRY_KEYS))
            or _to_date_only(_pick_field(row, EXIT_KEYS))
        )
        entry = _parse_datetime(_pick_field(row, ENTRY_KEYS))
        exit_time = _parse_datetime(_pick_field(row, EXIT_KEYS))
        if date_value:
            row_days.append(AttendanceDay(date=date_value, entry=entry, exit=exit_time))
    if book_days:
        return book_days
    return row_days


def _build_attendance_map(attendance_raw: Any) -> dict[date, AttendanceState]:
    days = _normalize_attendance(attendance_raw)
    mapping: dict[date, AttendanceState] = {}
    for day in days:
        existing = mapping.get(day.date)
        entry = day.entry
        exit_time = day.exit
        if existing:
            if entry and (not existing.entry or entry < existing.entry):
                existing.entry = entry
            if exit_time and (not existing.exit or exit_time > existing.exit):
                existing.exit = exit_time
        else:
            mapping[day.date] = AttendanceState(entry=entry, exit=exit_time)
    return mapping


def _fetch_attendance_for_worker(
    worker: Worker,
    start_date: date,
    end_date: date,
) -> dict[date, AttendanceState]:
    if not worker.geovictoria_identifier:
        return {}
    identifier = worker.geovictoria_identifier.strip()
    if not identifier:
        return {}
    start_dt = datetime.combine(start_date, time(0, 0, 0))
    end_dt = datetime.combine(end_date, time(23, 59, 59))
    payload = {
        "StartDate": start_dt.strftime("%Y%m%d%H%M%S"),
        "EndDate": end_dt.strftime("%Y%m%d%H%M%S"),
        "UserIds": identifier,
    }
    attendance = _post_geovictoria("AttendanceBook", payload)
    return _build_attendance_map(attendance)


def _iter_dates(start: date, end: date) -> list[date]:
    days = (end - start).days
    return [start + timedelta(days=offset) for offset in range(days + 1)]


def _date_status(day: date, cached_count: int, expected_count: int) -> str:
    if day >= _today():
        return "excluded"
    if cached_count == 0:
        return "missing"
    if cached_count < expected_count:
        return "partial"
    return "complete"


def _fetch_existing_map(
    db: Session, start_date: date, end_date: date
) -> dict[date, set[str]]:
    existing_map: dict[date, set[str]] = {}
    rows = db.execute(
        select(ShiftEstimate.date, ShiftEstimate.group_key).where(
            ShiftEstimate.date >= start_date,
            ShiftEstimate.date <= end_date,
            ShiftEstimate.algorithm_version == ALGORITHM_VERSION,
        )
    ).all()
    for row_date, group_key in rows:
        bucket = existing_map.get(row_date)
        if bucket is None:
            bucket = set()
            existing_map[row_date] = bucket
        bucket.add(group_key)
    return existing_map


def _compute_range(
    db: Session,
    start_date: date,
    end_date: date,
) -> ShiftEstimateComputeResponse:
    if start_date > end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="from_date must be before to_date"
        )
    range_days = (end_date - start_date).days + 1
    if range_days > MAX_RANGE_DAYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Range cannot exceed {MAX_RANGE_DAYS} days",
        )

    final_end = min(end_date, _yesterday())
    if start_date > final_end:
        return ShiftEstimateComputeResponse(
            from_date=start_date,
            to_date=start_date,
            processed_days=0,
            computed_count=0,
            skipped_existing=0,
            excluded_days=range_days,
            worker_errors=0,
        )

    stations = list(db.execute(select(Station)).scalars())
    groups = _build_station_groups(stations)
    expected_keys = set(groups.keys())
    workers = list(db.execute(select(Worker).order_by(Worker.id)).scalars())
    active_workers = [worker for worker in workers if worker.active is not False]
    station_workers = _build_station_worker_map(active_workers)
    group_workers = _build_group_workers(groups, station_workers)

    computed_count = 0
    skipped_existing = 0
    worker_errors = 0
    processed_days = (final_end - start_date).days + 1

    chunk_start = start_date
    while chunk_start <= final_end:
        chunk_end = min(final_end, chunk_start + timedelta(days=CHUNK_DAYS - 1))
        chunk_dates = _iter_dates(chunk_start, chunk_end)
        existing_map = _fetch_existing_map(db, chunk_start, chunk_end)

        missing_by_date: dict[date, set[str]] = {}
        for day in chunk_dates:
            cached = existing_map.get(day, set())
            missing = expected_keys - cached
            if missing:
                missing_by_date[day] = missing
            skipped_existing += len(cached)

        if missing_by_date:
            needed_worker_ids: set[int] = set()
            for keys in missing_by_date.values():
                for key in keys:
                    for worker in group_workers.get(key, []):
                        needed_worker_ids.add(worker.id)

            attendance_by_worker: dict[int, dict[date, AttendanceState]] = {}
            for worker in active_workers:
                if worker.id not in needed_worker_ids:
                    continue
                if not worker.geovictoria_identifier:
                    attendance_by_worker[worker.id] = {}
                    continue
                try:
                    attendance_by_worker[worker.id] = _fetch_attendance_for_worker(
                        worker, chunk_start, chunk_end
                    )
                except HTTPException:
                    worker_errors += 1
                    attendance_by_worker[worker.id] = {}
                time_module.sleep(SLEEP_SECONDS)

            rows: list[dict[str, Any]] = []
            for day, missing_keys in missing_by_date.items():
                for key in missing_keys:
                    group = groups[key]
                    workers_for_group = group_workers.get(key, [])
                    assigned_count = len(workers_for_group)
                    present_count = 0
                    last_exit: datetime | None = None
                    for worker in workers_for_group:
                        state = attendance_by_worker.get(worker.id, {}).get(day)
                        if not state:
                            continue
                        if state.entry or state.exit:
                            present_count += 1
                        if state.exit and (last_exit is None or state.exit > last_exit):
                            last_exit = state.exit

                    estimated_start = _build_shift_start(day) if present_count > 0 else None
                    estimated_end = (
                        last_exit - timedelta(minutes=SHIFT_END_OFFSET_MINUTES)
                        if last_exit
                        else None
                    )
                    shift_minutes: int | None = None
                    status_value = "no-shift"
                    if present_count > 0 and not last_exit:
                        status_value = "open"
                    elif present_count > 0 and estimated_start and estimated_end:
                        diff = (estimated_end - estimated_start).total_seconds() / 60
                        if diff > 0:
                            shift_minutes = round(diff)
                            status_value = "estimated"
                        else:
                            status_value = "review"
                    elif present_count > 0:
                        status_value = "review"

                    rows.append(
                        {
                            "date": day,
                            "group_key": key,
                            "station_role": group.role,
                            "station_id": group.station_id,
                            "sequence_order": group.sequence_order,
                            "assigned_count": assigned_count,
                            "present_count": present_count,
                            "estimated_start": estimated_start,
                            "estimated_end": estimated_end,
                            "last_exit": last_exit,
                            "shift_minutes": shift_minutes,
                            "status": status_value,
                            "computed_at": datetime.utcnow(),
                            "algorithm_version": ALGORITHM_VERSION,
                        }
                    )
            if rows:
                stmt = insert(ShiftEstimate).values(rows)
                stmt = stmt.on_conflict_do_nothing(
                    index_elements=["date", "group_key", "algorithm_version"]
                )
                result = db.execute(stmt)
                db.commit()
                if result.rowcount:
                    computed_count += result.rowcount
        chunk_start = chunk_end + timedelta(days=1)

    excluded_days = (end_date - final_end).days if end_date > final_end else 0
    return ShiftEstimateComputeResponse(
        from_date=start_date,
        to_date=final_end,
        processed_days=processed_days,
        computed_count=computed_count,
        skipped_existing=skipped_existing,
        excluded_days=excluded_days,
        worker_errors=worker_errors,
    )


@router.get("", response_model=ShiftEstimateDay)
def get_shift_estimates_for_day(
    date_value: date = Query(..., alias="date"),
    db: Session = Depends(get_db),
) -> ShiftEstimateDay:
    stations = list(db.execute(select(Station)).scalars())
    groups = _build_station_groups(stations)
    expected_count = len(groups)

    if date_value >= _today():
        return ShiftEstimateDay(
            date=date_value,
            status="excluded",
            expected_count=expected_count,
            cached_count=0,
            estimates=[],
        )

    estimates = list(
        db.execute(
            select(ShiftEstimate).where(
                ShiftEstimate.date == date_value,
                ShiftEstimate.algorithm_version == ALGORITHM_VERSION,
            )
        ).scalars()
    )
    cached_count = len(estimates)
    status_value = _date_status(date_value, cached_count, expected_count)
    return ShiftEstimateDay(
        date=date_value,
        status=status_value,
        expected_count=expected_count,
        cached_count=cached_count,
        estimates=[ShiftEstimateRead.model_validate(item) for item in estimates],
    )


@router.get("/coverage", response_model=list[ShiftEstimateCoverageDay])
def get_shift_estimate_coverage(
    from_date: date = Query(...),
    to_date: date = Query(...),
    db: Session = Depends(get_db),
) -> list[ShiftEstimateCoverageDay]:
    if from_date > to_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="from_date must be before to_date"
        )
    if (to_date - from_date).days + 1 > MAX_RANGE_DAYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Range cannot exceed {MAX_RANGE_DAYS} days",
        )

    stations = list(db.execute(select(Station)).scalars())
    groups = _build_station_groups(stations)
    expected_count = len(groups)

    existing_map = _fetch_existing_map(db, from_date, to_date)
    coverage: list[ShiftEstimateCoverageDay] = []
    for day in _iter_dates(from_date, to_date):
        cached_count = len(existing_map.get(day, set()))
        status_value = _date_status(day, cached_count, expected_count)
        coverage.append(
            ShiftEstimateCoverageDay(
                date=day,
                status=status_value,
                expected_count=expected_count,
                cached_count=cached_count,
            )
        )
    return coverage


@router.post("/compute", response_model=ShiftEstimateComputeResponse)
def compute_shift_estimates(
    payload: ShiftEstimateComputeRequest,
    db: Session = Depends(get_db),
) -> ShiftEstimateComputeResponse:
    return _compute_range(db, payload.from_date, payload.to_date)
