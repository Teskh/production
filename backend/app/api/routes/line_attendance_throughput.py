from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routes.shift_estimates import ALGORITHM_VERSION
from app.api.routes.station_panels_finished import get_station_panels_finished
from app.models.enums import StationLineType, StationRole, TaskScope, TaskStatus
from app.models.shift_estimate_worker_presence import ShiftEstimateWorkerPresence
from app.models.shift_estimates import ShiftEstimate
from app.models.stations import Station
from app.models.tasks import TaskDefinition, TaskInstance
from app.models.work import WorkOrder, WorkUnit
from app.schemas.line_attendance_throughput import (
    LineAttendanceStationOption,
    ModuleAttendanceThroughputDay,
    ModuleAttendanceThroughputResponse,
    ModuleMovementDayDetailResponse,
    ModuleMovementDayStationSummary,
    ModuleMovementIntervalDetail,
    ModuleStationMetricPoint,
    PanelAttendanceThroughputDay,
    PanelAttendanceThroughputResponse,
    PanelStationAttendancePoint,
)

router = APIRouter()


def _today() -> date:
    return datetime.now().date()


def _yesterday() -> date:
    return _today() - timedelta(days=1)


def _iter_days(start: date, end: date) -> list[date]:
    if start > end:
        return []
    out: list[date] = []
    current = start
    while current <= end:
        out.append(current)
        current += timedelta(days=1)
    return out


def _cap_to_yesterday(from_date: date, to_date: date) -> date:
    if from_date > to_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="from_date must be before or equal to to_date",
        )
    return min(to_date, _yesterday())


def _movements_per_workday(
    avg_active_move_hours: float | None, workday_hours: float
) -> float | None:
    if avg_active_move_hours is None or avg_active_move_hours <= 0:
        return None
    return workday_hours / avg_active_move_hours


def _load_stations(
    db: Session, role: StationRole, line_type: StationLineType | None = None
) -> list[Station]:
    stmt = (
        select(Station)
        .where(Station.role == role)
        .order_by(Station.sequence_order, Station.id)
    )
    if line_type is not None:
        stmt = stmt.where(Station.line_type == line_type)
    return list(db.execute(stmt).scalars())


def _select_stations_by_ids(
    available_stations: list[Station],
    requested_ids: list[int] | None,
) -> list[Station]:
    if not requested_ids:
        return list(available_stations)

    station_by_id = {station.id: station for station in available_stations}
    ordered_unique_ids = list(dict.fromkeys(requested_ids))
    missing_ids = [station_id for station_id in ordered_unique_ids if station_id not in station_by_id]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown station ids for selected scope: {sorted(missing_ids)}",
        )
    return [station_by_id[station_id] for station_id in ordered_unique_ids]


def _panel_attendance_cache(
    db: Session,
    start: date,
    end: date,
) -> tuple[dict[date, dict[int, int]], dict[date, int], dict[date, int], dict[date, set[int]]]:
    present_workers_by_day_station: dict[date, dict[int, set[int]]] = defaultdict(
        lambda: defaultdict(set)
    )
    present_workers_by_day_line: dict[date, set[int]] = defaultdict(set)
    station_rows_by_day: dict[date, set[int]] = defaultdict(set)
    cache_rows_per_day: dict[date, int] = defaultdict(int)

    estimate_rows = list(
        db.execute(
            select(ShiftEstimate).where(
                ShiftEstimate.date >= start,
                ShiftEstimate.date <= end,
                ShiftEstimate.algorithm_version == ALGORITHM_VERSION,
                ShiftEstimate.station_role == StationRole.PANELS,
            )
        ).scalars()
    )
    worker_presence_rows = list(
        db.execute(
            select(ShiftEstimateWorkerPresence).where(
                ShiftEstimateWorkerPresence.date >= start,
                ShiftEstimateWorkerPresence.date <= end,
                ShiftEstimateWorkerPresence.algorithm_version == ALGORITHM_VERSION,
                ShiftEstimateWorkerPresence.station_role == StationRole.PANELS,
            )
        ).scalars()
    )

    for row in estimate_rows:
        if row.station_id is None:
            continue
        cache_rows_per_day[row.date] += 1

    for row in worker_presence_rows:
        if row.station_id is None:
            continue
        station_rows_by_day[row.date].add(row.station_id)
        if not row.is_present:
            continue
        present_workers_by_day_station[row.date][row.station_id].add(row.worker_id)
        present_workers_by_day_line[row.date].add(row.worker_id)

    station_counts_by_day: dict[date, dict[int, int]] = {}
    for day, station_map in present_workers_by_day_station.items():
        station_counts_by_day[day] = {
            station_id: len(worker_ids)
            for station_id, worker_ids in station_map.items()
        }

    line_counts_by_day = {
        day: len(worker_ids)
        for day, worker_ids in present_workers_by_day_line.items()
    }
    return (
        station_counts_by_day,
        line_counts_by_day,
        dict(cache_rows_per_day),
        dict(station_rows_by_day),
    )


def _panel_production_by_day(
    db: Session,
    production_station_id: int,
    start: date,
    end: date,
) -> dict[date, int]:
    response = get_station_panels_finished(
        station_id=production_station_id,
        from_date=start.isoformat(),
        to_date=end.isoformat(),
        db=db,
    )
    by_day: dict[date, int] = defaultdict(int)
    for item in response.panels_passed_today_list or []:
        if item.satisfied_at is None:
            continue
        by_day[item.satisfied_at.date()] += 1
    return dict(by_day)


@dataclass
class _ModuleStationDayMetric:
    attendance: int | None
    move_count: int
    avg_active_move_hours: float | None


@dataclass
class _ModuleDayRow:
    day: date
    line_attendance: int | None
    line_avg_active_move_hours: float | None
    station_metrics: dict[int, _ModuleStationDayMetric]
    cache_rows: int
    cache_expected_rows: int
    cache_complete: bool


@dataclass
class _ModuleMovementInterval:
    station_id: int
    sequence_order: int
    project_name: str | None
    house_identifier: str | None
    tramo_start_task_name: str
    tramo_start_task_started_at: datetime
    tramo_end_task_name: str
    tramo_end_task_started_at: datetime
    interval_start_at: datetime
    interval_end_at: datetime
    elapsed_minutes: float
    active_minutes: float


@dataclass
class _ModulePreviousMove:
    completed_at: datetime
    task_definition_name: str
    started_at: datetime | None


def _assembly_attendance_cache(
    db: Session,
    attendance_start: date,
    end: date,
    sequence_orders: list[int],
) -> tuple[
    dict[date, dict[int, int]],
    dict[date, int],
    dict[date, int],
    dict[date, set[int]],
    dict[date, dict[int, tuple[datetime, datetime]]],
]:
    present_workers_by_day_sequence: dict[date, dict[int, set[int]]] = defaultdict(
        lambda: defaultdict(set)
    )
    present_workers_by_day_line: dict[date, set[int]] = defaultdict(set)
    cache_sequences_by_day: dict[date, set[int]] = defaultdict(set)
    available_sequences_by_day: dict[date, set[int]] = defaultdict(set)
    shift_masks_by_day_sequence: dict[date, dict[int, tuple[datetime, datetime]]] = defaultdict(
        dict
    )
    selected_sequences = set(sequence_orders)

    estimate_rows = list(
        db.execute(
            select(ShiftEstimate).where(
                ShiftEstimate.date >= attendance_start,
                ShiftEstimate.date <= end,
                ShiftEstimate.algorithm_version == ALGORITHM_VERSION,
                ShiftEstimate.station_role == StationRole.ASSEMBLY,
                ShiftEstimate.sequence_order.in_(sequence_orders),
            )
        ).scalars()
    )
    worker_presence_rows = list(
        db.execute(
            select(ShiftEstimateWorkerPresence).where(
                ShiftEstimateWorkerPresence.date >= attendance_start,
                ShiftEstimateWorkerPresence.date <= end,
                ShiftEstimateWorkerPresence.algorithm_version == ALGORITHM_VERSION,
                ShiftEstimateWorkerPresence.station_role == StationRole.ASSEMBLY,
                ShiftEstimateWorkerPresence.sequence_order.in_(sequence_orders),
            )
        ).scalars()
    )

    for row in estimate_rows:
        if row.sequence_order is None or row.sequence_order not in selected_sequences:
            continue
        cache_sequences_by_day[row.date].add(row.sequence_order)
        available_sequences_by_day[row.date].add(row.sequence_order)
        if (
            row.estimated_start is not None
            and row.estimated_end is not None
            and row.estimated_end > row.estimated_start
        ):
            shift_masks_by_day_sequence[row.date][row.sequence_order] = (
                row.estimated_start,
                row.estimated_end,
            )

    for row in worker_presence_rows:
        if row.sequence_order is None or row.sequence_order not in selected_sequences:
            continue
        available_sequences_by_day[row.date].add(row.sequence_order)
        if not row.is_present:
            continue
        present_workers_by_day_sequence[row.date][row.sequence_order].add(row.worker_id)
        present_workers_by_day_line[row.date].add(row.worker_id)

    sequence_counts_by_day: dict[date, dict[int, int]] = {}
    for day, sequence_map in present_workers_by_day_sequence.items():
        sequence_counts_by_day[day] = {
            sequence_order: len(worker_ids)
            for sequence_order, worker_ids in sequence_map.items()
        }

    line_counts_by_day = {
        day: len(worker_ids)
        for day, worker_ids in present_workers_by_day_line.items()
    }
    cache_rows_per_day = {
        day: len(sequence_set)
        for day, sequence_set in cache_sequences_by_day.items()
    }
    return (
        sequence_counts_by_day,
        line_counts_by_day,
        cache_rows_per_day,
        dict(available_sequences_by_day),
        {
            day: dict(mask_map)
            for day, mask_map in shift_masks_by_day_sequence.items()
        },
    )


def _active_minutes_between_with_masks(
    start_dt: datetime,
    end_dt: datetime,
    sequence_order: int,
    shift_masks_by_day_sequence: dict[date, dict[int, tuple[datetime, datetime]]],
) -> float:
    if end_dt <= start_dt:
        return 0.0

    total_minutes = 0.0
    day_cursor = start_dt.date()
    end_day = end_dt.date()
    while day_cursor <= end_day:
        day_masks = shift_masks_by_day_sequence.get(day_cursor, {})
        mask = day_masks.get(sequence_order)
        if mask is not None:
            work_start, work_end = mask
            overlap_start = max(start_dt, work_start)
            overlap_end = min(end_dt, work_end)
            if overlap_end > overlap_start:
                total_minutes += (overlap_end - overlap_start).total_seconds() / 60.0
        day_cursor += timedelta(days=1)
    return total_minutes


def _module_move_intervals_with_details(
    db: Session,
    start: date,
    end: date,
    selected_station_ids: list[int],
    chain_station_ids: list[int],
    station_id_to_sequence: dict[int, int],
    first_sequence_order: int | None,
    shift_masks_by_day_sequence: dict[date, dict[int, tuple[datetime, datetime]]],
    first_station_entry_task_definition_id: int,
    movement_history_lookback_days: int,
) -> tuple[dict[date, dict[int, list[float]]], dict[date, list[_ModuleMovementInterval]]]:
    end_dt = datetime.combine(end, time(23, 59, 59, 999999))
    lookback_start_day = start - timedelta(days=movement_history_lookback_days)
    lookback_start_dt = datetime.combine(lookback_start_day, time(0, 0, 0))

    first_entry_rows = list(
        db.execute(
            select(
                TaskInstance.work_unit_id,
                TaskInstance.started_at,
            )
            .where(TaskInstance.scope == TaskScope.MODULE)
            .where(TaskInstance.panel_unit_id.is_(None))
            .where(TaskInstance.task_definition_id == first_station_entry_task_definition_id)
            .where(TaskInstance.started_at.is_not(None))
            .where(TaskInstance.started_at >= lookback_start_dt)
            .where(TaskInstance.started_at <= end_dt)
            .order_by(
                TaskInstance.work_unit_id,
                TaskInstance.started_at,
                TaskInstance.id,
            )
        ).all()
    )
    first_entry_task_name = db.execute(
        select(TaskDefinition.name).where(
            TaskDefinition.id == first_station_entry_task_definition_id
        )
    ).scalar_one_or_none()
    first_entry_task_label = first_entry_task_name or f"Task {first_station_entry_task_definition_id}"

    movement_rows = list(
        db.execute(
            select(
                TaskInstance.work_unit_id,
                TaskInstance.station_id,
                TaskInstance.completed_at,
                TaskInstance.started_at,
                TaskInstance.task_definition_id,
                TaskDefinition.name,
                WorkOrder.project_name,
                WorkOrder.house_identifier,
            )
            .join(TaskDefinition, TaskDefinition.id == TaskInstance.task_definition_id)
            .join(Station, Station.id == TaskInstance.station_id)
            .join(WorkUnit, WorkUnit.id == TaskInstance.work_unit_id)
            .join(WorkOrder, WorkOrder.id == WorkUnit.work_order_id)
            .where(TaskInstance.scope == TaskScope.MODULE)
            .where(TaskInstance.panel_unit_id.is_(None))
            .where(TaskInstance.status == TaskStatus.COMPLETED)
            .where(TaskInstance.completed_at.is_not(None))
            .where(TaskDefinition.advance_trigger == True)
            .where(Station.role == StationRole.ASSEMBLY)
            .where(TaskInstance.station_id.in_(chain_station_ids))
            .where(TaskInstance.completed_at >= lookback_start_dt)
            .where(TaskInstance.completed_at <= end_dt)
            .order_by(
                TaskInstance.work_unit_id,
                TaskInstance.completed_at,
                TaskInstance.id,
            )
        ).all()
    )

    first_entry_started_by_work_unit: dict[int, datetime] = {}
    for work_unit_id, started_at in first_entry_rows:
        if started_at is None:
            continue
        existing = first_entry_started_by_work_unit.get(work_unit_id)
        if existing is None or started_at < existing:
            first_entry_started_by_work_unit[work_unit_id] = started_at

    intervals_by_day_station: dict[date, dict[int, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    interval_details_by_day: dict[date, list[_ModuleMovementInterval]] = defaultdict(list)
    previous_move_by_work_unit: dict[int, _ModulePreviousMove] = {}
    selected_station_ids_set = set(selected_station_ids)

    for (
        work_unit_id,
        station_id,
        completed_at,
        started_at,
        task_definition_id,
        task_definition_name,
        project_name,
        house_identifier,
    ) in movement_rows:
        if completed_at is None or station_id is None:
            continue
        previous_move = previous_move_by_work_unit.get(work_unit_id)
        interval_start = previous_move.completed_at if previous_move is not None else None
        tramo_start_task_name = (
            previous_move.task_definition_name if previous_move is not None else None
        )
        tramo_start_task_started_at = (
            previous_move.started_at if previous_move is not None else None
        )

        if interval_start is None and first_sequence_order is not None:
            station_sequence = station_id_to_sequence.get(station_id)
            if station_sequence == first_sequence_order:
                fallback_started = first_entry_started_by_work_unit.get(work_unit_id)
                if fallback_started is not None and fallback_started <= completed_at:
                    interval_start = fallback_started
                    tramo_start_task_name = first_entry_task_label
                    tramo_start_task_started_at = fallback_started

        if interval_start is not None:
            day = completed_at.date()
            if start <= day <= end and station_id in selected_station_ids_set:
                sequence_order = station_id_to_sequence.get(station_id)
                if sequence_order is None:
                    previous_move_by_work_unit[work_unit_id] = _ModulePreviousMove(
                        completed_at=completed_at,
                        task_definition_name=(
                            task_definition_name or f"Task {task_definition_id}"
                        ),
                        started_at=started_at,
                    )
                    continue
                active_minutes = _active_minutes_between_with_masks(
                    interval_start,
                    completed_at,
                    sequence_order,
                    shift_masks_by_day_sequence,
                )
                current_task_name = task_definition_name or f"Task {task_definition_id}"
                intervals_by_day_station[day][station_id].append(active_minutes)
                interval_details_by_day[day].append(
                    _ModuleMovementInterval(
                        station_id=station_id,
                        sequence_order=sequence_order,
                        project_name=project_name,
                        house_identifier=house_identifier,
                        tramo_start_task_name=tramo_start_task_name or "Unknown",
                        tramo_start_task_started_at=(
                            tramo_start_task_started_at or interval_start
                        ),
                        tramo_end_task_name=current_task_name,
                        tramo_end_task_started_at=started_at or completed_at,
                        interval_start_at=interval_start,
                        interval_end_at=completed_at,
                        elapsed_minutes=(
                            (completed_at - interval_start).total_seconds() / 60.0
                        ),
                        active_minutes=active_minutes,
                    )
                )
        previous_move_by_work_unit[work_unit_id] = _ModulePreviousMove(
            completed_at=completed_at,
            task_definition_name=task_definition_name or f"Task {task_definition_id}",
            started_at=started_at,
        )

    return (
        {
            day: {station_id: values for station_id, values in station_map.items()}
            for day, station_map in intervals_by_day_station.items()
        },
        {day: list(details) for day, details in interval_details_by_day.items()},
    )


def _module_move_intervals_active_minutes(
    db: Session,
    start: date,
    end: date,
    selected_station_ids: list[int],
    chain_station_ids: list[int],
    station_id_to_sequence: dict[int, int],
    first_sequence_order: int | None,
    shift_masks_by_day_sequence: dict[date, dict[int, tuple[datetime, datetime]]],
    first_station_entry_task_definition_id: int,
    movement_history_lookback_days: int,
) -> dict[date, dict[int, list[float]]]:
    intervals_by_day_station, _ = _module_move_intervals_with_details(
        db=db,
        start=start,
        end=end,
        selected_station_ids=selected_station_ids,
        chain_station_ids=chain_station_ids,
        station_id_to_sequence=station_id_to_sequence,
        first_sequence_order=first_sequence_order,
        shift_masks_by_day_sequence=shift_masks_by_day_sequence,
        first_station_entry_task_definition_id=first_station_entry_task_definition_id,
        movement_history_lookback_days=movement_history_lookback_days,
    )
    return intervals_by_day_station


def _assemble_module_rows(
    days: list[date],
    attendance_by_day_sequence: dict[date, dict[int, int]],
    line_attendance_by_day: dict[date, int],
    sequence_rows_by_day: dict[date, set[int]],
    cache_rows_per_day: dict[date, int],
    move_intervals_by_day_station: dict[date, dict[int, list[float]]],
    selected_station_ids: list[int],
    station_id_to_sequence: dict[int, int],
    expected_rows: int,
    min_moves_per_station_day: int,
) -> list[_ModuleDayRow]:
    rows: list[_ModuleDayRow] = []

    for day in days:
        sequence_counts = attendance_by_day_sequence.get(day, {})
        sequence_rows = sequence_rows_by_day.get(day, set())
        cache_rows = cache_rows_per_day.get(day, 0)
        cache_complete = cache_rows == expected_rows
        line_attendance = (
            line_attendance_by_day.get(day, 0)
            if cache_complete or bool(sequence_rows)
            else None
        )

        station_metrics: dict[int, _ModuleStationDayMetric] = {}
        all_day_intervals: list[float] = []
        move_day_map = move_intervals_by_day_station.get(day, {})

        for station_id in selected_station_ids:
            sequence_order = station_id_to_sequence[station_id]
            attendance = (
                sequence_counts.get(sequence_order, 0)
                if cache_complete or sequence_order in sequence_rows
                else None
            )
            station_intervals = move_day_map.get(station_id, [])
            all_day_intervals.extend(station_intervals)
            avg_hours = (
                (sum(station_intervals) / len(station_intervals)) / 60.0
                if len(station_intervals) >= min_moves_per_station_day
                else None
            )
            station_metrics[station_id] = _ModuleStationDayMetric(
                attendance=attendance,
                move_count=len(station_intervals),
                avg_active_move_hours=avg_hours,
            )

        line_avg_active_move_hours = (
            (sum(all_day_intervals) / len(all_day_intervals)) / 60.0
            if all_day_intervals
            else None
        )
        rows.append(
            _ModuleDayRow(
                day=day,
                line_attendance=line_attendance,
                line_avg_active_move_hours=line_avg_active_move_hours,
                station_metrics=station_metrics,
                cache_rows=cache_rows,
                cache_expected_rows=expected_rows,
                cache_complete=cache_complete,
            )
        )
    return rows


@router.get("/panel", response_model=PanelAttendanceThroughputResponse)
def get_panel_attendance_throughput(
    from_date: date = Query(...),
    to_date: date = Query(...),
    production_station_id: int | None = Query(default=None),
    station_ids: list[int] | None = Query(default=None),
    min_total_line_attendance: int = Query(default=1, ge=0),
    db: Session = Depends(get_db),
) -> PanelAttendanceThroughputResponse:
    effective_to_date = _cap_to_yesterday(from_date, to_date)
    panel_stations = _load_stations(db, role=StationRole.PANELS)
    if not panel_stations:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No panel stations found",
        )

    panel_station_by_id = {station.id: station for station in panel_stations}
    if production_station_id is None:
        named = next((station for station in panel_stations if station.name == "Puente 1"), None)
        production_station = named or panel_stations[0]
    else:
        production_station = panel_station_by_id.get(production_station_id)
        if production_station is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid production_station_id for panel scope: {production_station_id}",
            )

    compared_stations = _select_stations_by_ids(panel_stations, station_ids)
    if not compared_stations:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No panel stations selected for comparison",
        )

    available_stations = [
        LineAttendanceStationOption(
            id=station.id,
            name=station.name,
            role=station.role,
            line_type=station.line_type,
            sequence_order=station.sequence_order,
        )
        for station in panel_stations
    ]

    if from_date > effective_to_date:
        return PanelAttendanceThroughputResponse(
            requested_from_date=from_date,
            requested_to_date=to_date,
            effective_to_date=effective_to_date,
            production_station_id=production_station.id,
            production_station_name=production_station.name,
            compared_station_ids=[station.id for station in compared_stations],
            min_total_line_attendance=min_total_line_attendance,
            dropped_incomplete_days=0,
            dropped_low_attendance_days=0,
            available_stations=available_stations,
            rows=[],
        )

    days = _iter_days(from_date, effective_to_date)
    production_by_day = _panel_production_by_day(
        db=db,
        production_station_id=production_station.id,
        start=from_date,
        end=effective_to_date,
    )
    (
        attendance_by_day_station,
        line_attendance_by_day,
        cache_rows_per_day,
        station_rows_by_day,
    ) = _panel_attendance_cache(db=db, start=from_date, end=effective_to_date)

    expected_rows = len(panel_stations)
    all_rows: list[PanelAttendanceThroughputDay] = []
    dropped_incomplete_days = 0
    dropped_low_attendance_days = 0

    for day in days:
        station_counts = attendance_by_day_station.get(day, {})
        station_rows = station_rows_by_day.get(day, set())
        cache_rows = cache_rows_per_day.get(day, 0)
        cache_complete = cache_rows == expected_rows
        if not cache_complete:
            dropped_incomplete_days += 1
            continue

        line_attendance = (
            line_attendance_by_day.get(day, 0)
            if cache_complete or bool(station_rows)
            else None
        )
        if line_attendance is None or line_attendance < min_total_line_attendance:
            dropped_low_attendance_days += 1
            continue

        station_attendance: list[PanelStationAttendancePoint] = []
        for station in compared_stations:
            station_count = (
                station_counts.get(station.id, 0)
                if cache_complete or station.id in station_rows
                else None
            )
            station_attendance.append(
                PanelStationAttendancePoint(
                    station_id=station.id,
                    station_name=station.name,
                    attendance=station_count,
                    attendance_share=(
                        station_count / line_attendance
                        if station_count is not None and line_attendance > 0
                        else None
                    ),
                )
            )

        production_panels = production_by_day.get(day, 0)
        all_rows.append(
            PanelAttendanceThroughputDay(
                date=day,
                production_panels=production_panels,
                line_attendance=line_attendance,
                throughput_per_attended_worker=(
                    production_panels / line_attendance if line_attendance > 0 else None
                ),
                cache_rows=cache_rows,
                cache_expected_rows=expected_rows,
                station_attendance=station_attendance,
            )
        )

    return PanelAttendanceThroughputResponse(
        requested_from_date=from_date,
        requested_to_date=to_date,
        effective_to_date=effective_to_date,
        production_station_id=production_station.id,
        production_station_name=production_station.name,
        compared_station_ids=[station.id for station in compared_stations],
        min_total_line_attendance=min_total_line_attendance,
        dropped_incomplete_days=dropped_incomplete_days,
        dropped_low_attendance_days=dropped_low_attendance_days,
        available_stations=available_stations,
        rows=all_rows,
    )


@router.get("/module", response_model=ModuleAttendanceThroughputResponse)
def get_module_attendance_throughput(
    from_date: date = Query(...),
    to_date: date = Query(...),
    line_type: StationLineType | None = Query(default=None),
    station_ids: list[int] | None = Query(default=None),
    min_total_line_attendance: int = Query(default=1, ge=0),
    min_moves_per_station_day: int = Query(default=1, ge=1),
    workday_hours: float = Query(default=8.0, gt=0),
    first_station_entry_task_definition_id: int = Query(default=27, ge=1),
    movement_history_lookback_days: int = Query(default=180, ge=0),
    db: Session = Depends(get_db),
) -> ModuleAttendanceThroughputResponse:
    effective_to_date = _cap_to_yesterday(from_date, to_date)
    assembly_stations = _load_stations(db, role=StationRole.ASSEMBLY, line_type=line_type)
    if not assembly_stations:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No assembly stations found for selected filters",
        )

    selected_stations = _select_stations_by_ids(assembly_stations, station_ids)
    if not selected_stations:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No assembly stations selected",
        )

    no_sequence = [station.name for station in selected_stations if station.sequence_order is None]
    if no_sequence:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Selected stations missing sequence_order: {sorted(no_sequence)}",
        )

    available_stations = [
        LineAttendanceStationOption(
            id=station.id,
            name=station.name,
            role=station.role,
            line_type=station.line_type,
            sequence_order=station.sequence_order,
        )
        for station in assembly_stations
    ]

    if from_date > effective_to_date:
        return ModuleAttendanceThroughputResponse(
            requested_from_date=from_date,
            requested_to_date=to_date,
            effective_to_date=effective_to_date,
            line_type=line_type,
            selected_station_ids=[station.id for station in selected_stations],
            min_total_line_attendance=min_total_line_attendance,
            min_moves_per_station_day=min_moves_per_station_day,
            workday_hours=workday_hours,
            first_station_entry_task_definition_id=first_station_entry_task_definition_id,
            movement_history_lookback_days=movement_history_lookback_days,
            dropped_incomplete_days=0,
            dropped_low_attendance_days=0,
            dropped_no_movement_days=0,
            available_stations=available_stations,
            rows=[],
        )

    selected_station_ids = [station.id for station in selected_stations]
    selected_sequences = sorted(
        set(station.sequence_order for station in selected_stations if station.sequence_order is not None)
    )
    station_id_to_sequence = {
        station.id: station.sequence_order
        for station in assembly_stations
        if station.sequence_order is not None
    }
    chain_station_ids = sorted(station_id_to_sequence.keys())
    first_sequence_order = min(selected_sequences) if selected_sequences else None
    attendance_start = from_date - timedelta(days=movement_history_lookback_days)

    (
        attendance_by_day_sequence,
        line_attendance_by_day,
        cache_rows_per_day,
        sequence_rows_by_day,
        shift_masks_by_day_sequence,
    ) = _assembly_attendance_cache(
        db=db,
        attendance_start=attendance_start,
        end=effective_to_date,
        sequence_orders=selected_sequences,
    )
    move_intervals_by_day_station = _module_move_intervals_active_minutes(
        db=db,
        start=from_date,
        end=effective_to_date,
        selected_station_ids=selected_station_ids,
        chain_station_ids=chain_station_ids,
        station_id_to_sequence=station_id_to_sequence,
        first_sequence_order=first_sequence_order,
        shift_masks_by_day_sequence=shift_masks_by_day_sequence,
        first_station_entry_task_definition_id=first_station_entry_task_definition_id,
        movement_history_lookback_days=movement_history_lookback_days,
    )

    days = _iter_days(from_date, effective_to_date)
    all_rows = _assemble_module_rows(
        days=days,
        attendance_by_day_sequence=attendance_by_day_sequence,
        line_attendance_by_day=line_attendance_by_day,
        sequence_rows_by_day=sequence_rows_by_day,
        cache_rows_per_day=cache_rows_per_day,
        move_intervals_by_day_station=move_intervals_by_day_station,
        selected_station_ids=selected_station_ids,
        station_id_to_sequence=station_id_to_sequence,
        expected_rows=len(selected_sequences),
        min_moves_per_station_day=min_moves_per_station_day,
    )

    station_by_id = {station.id: station for station in selected_stations}
    rows: list[ModuleAttendanceThroughputDay] = []
    dropped_incomplete_days = 0
    dropped_low_attendance_days = 0
    dropped_no_movement_days = 0

    for row in all_rows:
        if not row.cache_complete:
            dropped_incomplete_days += 1
            continue
        if row.line_attendance is None or row.line_attendance < min_total_line_attendance:
            dropped_low_attendance_days += 1
            continue
        if not any(metric.move_count > 0 for metric in row.station_metrics.values()):
            dropped_no_movement_days += 1
            continue

        line_moves_per_workday = _movements_per_workday(
            row.line_avg_active_move_hours,
            workday_hours=workday_hours,
        )
        station_metrics: list[ModuleStationMetricPoint] = []
        for station_id in selected_station_ids:
            station = station_by_id[station_id]
            metric = row.station_metrics[station_id]
            station_metrics.append(
                ModuleStationMetricPoint(
                    station_id=station.id,
                    station_name=station.name,
                    line_type=station.line_type,
                    sequence_order=station.sequence_order or 0,
                    attendance=metric.attendance,
                    move_count=metric.move_count,
                    avg_active_move_hours=metric.avg_active_move_hours,
                    movements_per_workday=_movements_per_workday(
                        metric.avg_active_move_hours,
                        workday_hours=workday_hours,
                    ),
                )
            )

        rows.append(
            ModuleAttendanceThroughputDay(
                date=row.day,
                line_attendance=row.line_attendance,
                line_avg_active_move_hours=row.line_avg_active_move_hours,
                line_movements_per_workday=line_moves_per_workday,
                throughput_per_attended_worker=(
                    line_moves_per_workday / row.line_attendance
                    if line_moves_per_workday is not None and row.line_attendance > 0
                    else None
                ),
                cache_rows=row.cache_rows,
                cache_expected_rows=row.cache_expected_rows,
                station_metrics=station_metrics,
            )
        )

    return ModuleAttendanceThroughputResponse(
        requested_from_date=from_date,
        requested_to_date=to_date,
        effective_to_date=effective_to_date,
        line_type=line_type,
        selected_station_ids=selected_station_ids,
        min_total_line_attendance=min_total_line_attendance,
        min_moves_per_station_day=min_moves_per_station_day,
        workday_hours=workday_hours,
        first_station_entry_task_definition_id=first_station_entry_task_definition_id,
        movement_history_lookback_days=movement_history_lookback_days,
        dropped_incomplete_days=dropped_incomplete_days,
        dropped_low_attendance_days=dropped_low_attendance_days,
        dropped_no_movement_days=dropped_no_movement_days,
        available_stations=available_stations,
        rows=rows,
    )


@router.get("/module/day-detail", response_model=ModuleMovementDayDetailResponse)
def get_module_movement_day_detail(
    day: date = Query(...),
    line_type: StationLineType | None = Query(default=None),
    sequence_order: int | None = Query(default=None, ge=0),
    station_id: int | None = Query(default=None, ge=1),
    min_total_line_attendance: int = Query(default=1, ge=0),
    min_moves_per_station_day: int = Query(default=1, ge=1),
    workday_hours: float = Query(default=8.0, gt=0),
    first_station_entry_task_definition_id: int = Query(default=27, ge=1),
    movement_history_lookback_days: int = Query(default=180, ge=0),
    db: Session = Depends(get_db),
) -> ModuleMovementDayDetailResponse:
    if day > _yesterday():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="day must be yesterday or earlier",
        )
    if station_id is not None and sequence_order is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use either station_id or sequence_order, not both",
        )

    assembly_stations = _load_stations(db, role=StationRole.ASSEMBLY, line_type=line_type)
    if not assembly_stations:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No assembly stations found for selected filters",
        )

    station_by_id = {station.id: station for station in assembly_stations}
    if station_id is not None:
        picked = station_by_id.get(station_id)
        if picked is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"station_id {station_id} is not valid for selected filters",
            )
        selected_stations = [picked]
    elif sequence_order is not None:
        selected_stations = [
            station for station in assembly_stations if station.sequence_order == sequence_order
        ]
        if not selected_stations:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No assembly stations found for sequence_order={sequence_order}",
            )
    else:
        selected_stations = list(assembly_stations)

    no_sequence = [station.name for station in selected_stations if station.sequence_order is None]
    if no_sequence:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Selected stations missing sequence_order: {sorted(no_sequence)}",
        )

    selected_station_ids = [station.id for station in selected_stations]
    selected_sequences = sorted(
        set(station.sequence_order for station in selected_stations if station.sequence_order is not None)
    )
    station_id_to_sequence = {
        station.id: station.sequence_order
        for station in assembly_stations
        if station.sequence_order is not None
    }
    chain_station_ids = sorted(station_id_to_sequence.keys())
    first_sequence_order = min(selected_sequences) if selected_sequences else None

    attendance_start = day - timedelta(days=movement_history_lookback_days)
    (
        attendance_by_day_sequence,
        line_attendance_by_day,
        cache_rows_per_day,
        sequence_rows_by_day,
        shift_masks_by_day_sequence,
    ) = _assembly_attendance_cache(
        db=db,
        attendance_start=attendance_start,
        end=day,
        sequence_orders=selected_sequences,
    )
    move_intervals_by_day_station, interval_details_by_day = _module_move_intervals_with_details(
        db=db,
        start=day,
        end=day,
        selected_station_ids=selected_station_ids,
        chain_station_ids=chain_station_ids,
        station_id_to_sequence=station_id_to_sequence,
        first_sequence_order=first_sequence_order,
        shift_masks_by_day_sequence=shift_masks_by_day_sequence,
        first_station_entry_task_definition_id=first_station_entry_task_definition_id,
        movement_history_lookback_days=movement_history_lookback_days,
    )

    day_rows = _assemble_module_rows(
        days=[day],
        attendance_by_day_sequence=attendance_by_day_sequence,
        line_attendance_by_day=line_attendance_by_day,
        sequence_rows_by_day=sequence_rows_by_day,
        cache_rows_per_day=cache_rows_per_day,
        move_intervals_by_day_station=move_intervals_by_day_station,
        selected_station_ids=selected_station_ids,
        station_id_to_sequence=station_id_to_sequence,
        expected_rows=len(selected_sequences),
        min_moves_per_station_day=min_moves_per_station_day,
    )
    row = day_rows[0]

    line_movements_per_workday = _movements_per_workday(
        row.line_avg_active_move_hours,
        workday_hours=workday_hours,
    )
    throughput_per_attended_worker = (
        line_movements_per_workday / row.line_attendance
        if line_movements_per_workday is not None
        and row.line_attendance is not None
        and row.line_attendance > 0
        and row.line_attendance >= min_total_line_attendance
        else None
    )

    station_summaries: list[ModuleMovementDayStationSummary] = []
    move_day_map = move_intervals_by_day_station.get(day, {})
    for station in selected_stations:
        metric = row.station_metrics[station.id]
        station_summaries.append(
            ModuleMovementDayStationSummary(
                station_id=station.id,
                station_name=station.name,
                line_type=station.line_type,
                sequence_order=station.sequence_order or 0,
                attendance=metric.attendance,
                move_count=metric.move_count,
                avg_active_move_hours=metric.avg_active_move_hours,
                movements_per_workday=_movements_per_workday(
                    metric.avg_active_move_hours,
                    workday_hours=workday_hours,
                ),
                total_active_minutes=sum(move_day_map.get(station.id, [])),
                qualifies_for_average=metric.move_count >= min_moves_per_station_day,
            )
        )

    movement_intervals = [
        ModuleMovementIntervalDetail(
            station_id=interval.station_id,
            station_name=station_by_id[interval.station_id].name,
            line_type=station_by_id[interval.station_id].line_type,
            sequence_order=interval.sequence_order,
            project_name=interval.project_name,
            house_identifier=interval.house_identifier,
            tramo_start_task_name=interval.tramo_start_task_name,
            tramo_start_task_started_at=interval.tramo_start_task_started_at,
            tramo_end_task_name=interval.tramo_end_task_name,
            tramo_end_task_started_at=interval.tramo_end_task_started_at,
            interval_start_at=interval.interval_start_at,
            interval_end_at=interval.interval_end_at,
            elapsed_minutes=interval.elapsed_minutes,
            active_minutes=interval.active_minutes,
        )
        for interval in sorted(
            interval_details_by_day.get(day, []),
            key=lambda item: item.interval_end_at,
        )
    ]

    return ModuleMovementDayDetailResponse(
        date=day,
        line_type=line_type,
        sequence_order=sequence_order,
        station_id=station_id,
        selected_station_ids=selected_station_ids,
        selected_sequence_orders=selected_sequences,
        min_total_line_attendance=min_total_line_attendance,
        min_moves_per_station_day=min_moves_per_station_day,
        workday_hours=workday_hours,
        first_station_entry_task_definition_id=first_station_entry_task_definition_id,
        movement_history_lookback_days=movement_history_lookback_days,
        cache_rows=row.cache_rows,
        cache_expected_rows=row.cache_expected_rows,
        cache_complete=row.cache_complete,
        line_attendance=row.line_attendance,
        line_avg_active_move_hours=row.line_avg_active_move_hours,
        line_movements_per_workday=line_movements_per_workday,
        throughput_per_attended_worker=throughput_per_attended_worker,
        station_summaries=station_summaries,
        movement_intervals=movement_intervals,
    )
