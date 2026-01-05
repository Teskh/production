from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.enums import StationRole, TaskScope, TaskStatus
from app.models.house import HouseType, PanelDefinition
from app.models.stations import Station
from app.models.tasks import (
    TaskDefinition,
    TaskExpectedDuration,
    TaskInstance,
    TaskPause,
)
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.schemas.analytics import (
    PanelLinearMetersResponse,
    PanelLinearMetersRow,
    PanelLinearMetersStationStats,
)

router = APIRouter()


def _parse_datetime(value: str | None, field: str, end_of_day: bool = False) -> datetime | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    normalized = raw.replace(" ", "T")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {field} value",
        ) from exc
    if end_of_day and len(raw) == 10:
        return dt.replace(hour=23, minute=59, second=59, microsecond=999999)
    return dt


def _panel_task_order_key(task: TaskDefinition) -> tuple[int, str]:
    sequence = task.default_station_sequence
    safe_sequence = sequence if sequence is not None else 1_000_000
    return (safe_sequence, task.name.lower())


def _build_panel_expected_map(
    panel_definition: PanelDefinition, panel_tasks: list[TaskDefinition]
) -> dict[int, float]:
    durations = panel_definition.task_durations_json or []
    if not durations:
        return {}
    expected_map: dict[int, float] = {}
    if panel_definition.applicable_task_ids is not None:
        for index, task_id in enumerate(panel_definition.applicable_task_ids):
            if index >= len(durations):
                break
            value = durations[index]
            if value is None:
                continue
            expected_map[task_id] = float(value)
        return expected_map
    ordered_tasks = sorted(panel_tasks, key=_panel_task_order_key)
    for index, task in enumerate(ordered_tasks):
        if index >= len(durations):
            break
        value = durations[index]
        if value is None:
            continue
        expected_map[task.id] = float(value)
    return expected_map


def _pause_minutes(pauses: list[TaskPause], completed_at: datetime) -> float:
    total = 0.0
    for pause in pauses:
        if not pause.paused_at:
            continue
        end_time = pause.resumed_at or completed_at
        if end_time is None:
            continue
        if end_time < pause.paused_at:
            continue
        total += (end_time - pause.paused_at).total_seconds() / 60
    return total


def _duration_minutes(instance: TaskInstance, pause_map: dict[int, list[TaskPause]]) -> float | None:
    if not instance.started_at or not instance.completed_at:
        return None
    base_minutes = (instance.completed_at - instance.started_at).total_seconds() / 60
    pause_minutes = _pause_minutes(pause_map.get(instance.id, []), instance.completed_at)
    return round(max(base_minutes - pause_minutes, 0.0), 2)


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


@router.get("/", response_model=PanelLinearMetersResponse)
def get_panel_linear_meters(
    from_date: str | None = None,
    to_date: str | None = None,
    house_type_id: int | None = None,
    min_multiplier: float = Query(0.5, ge=0),
    max_multiplier: float = Query(2.0, ge=0),
    db: Session = Depends(get_db),
) -> PanelLinearMetersResponse:
    from_dt = _parse_datetime(from_date, "from_date")
    to_dt = _parse_datetime(to_date, "to_date", end_of_day=True)

    effective_min = min(min_multiplier, max_multiplier)
    effective_max = max(min_multiplier, max_multiplier)

    stmt = (
        select(
            TaskInstance,
            TaskDefinition,
            PanelUnit,
            PanelDefinition,
            WorkUnit,
            WorkOrder,
            HouseType,
            Station,
        )
        .join(TaskDefinition, TaskInstance.task_definition_id == TaskDefinition.id)
        .join(PanelUnit, TaskInstance.panel_unit_id == PanelUnit.id)
        .join(PanelDefinition, PanelUnit.panel_definition_id == PanelDefinition.id)
        .join(WorkUnit, PanelUnit.work_unit_id == WorkUnit.id)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
        .join(Station, TaskInstance.station_id == Station.id)
        .where(TaskInstance.scope == TaskScope.PANEL)
        .where(TaskInstance.status == TaskStatus.COMPLETED)
        .where(TaskInstance.completed_at.is_not(None))
        .where(Station.role == StationRole.PANELS)
    )

    if house_type_id is not None:
        stmt = stmt.where(WorkOrder.house_type_id == house_type_id)
    if from_dt is not None:
        stmt = stmt.where(TaskInstance.completed_at >= from_dt)
    if to_dt is not None:
        stmt = stmt.where(TaskInstance.completed_at <= to_dt)

    rows = list(db.execute(stmt).all())
    if not rows:
        return PanelLinearMetersResponse(rows=[], total_panels=0)

    instance_ids = [row[0].id for row in rows]
    pause_rows = list(
        db.execute(
            select(TaskPause).where(TaskPause.task_instance_id.in_(instance_ids))
        ).scalars()
    )
    pause_map: dict[int, list[TaskPause]] = {}
    for pause in pause_rows:
        pause_map.setdefault(pause.task_instance_id, []).append(pause)

    panel_tasks = list(
        db.execute(
            select(TaskDefinition)
            .where(TaskDefinition.scope == TaskScope.PANEL)
            .where(TaskDefinition.active == True)
        ).scalars()
    )

    panel_definitions: dict[int, PanelDefinition] = {}
    panel_row_base: dict[int, dict[str, Any]] = {}
    station_name_by_id: dict[int, str | None] = {}
    for _, _, panel_unit, panel_definition, _, work_order, house_type, station in rows:
        panel_definitions[panel_definition.id] = panel_definition
        if panel_definition.id not in panel_row_base:
            panel_row_base[panel_definition.id] = {
                "panel_definition_id": panel_definition.id,
                "house_type_id": work_order.house_type_id,
                "house_type_name": house_type.name,
                "module_sequence_number": panel_definition.module_sequence_number,
                "panel_sequence_number": panel_definition.panel_sequence_number,
                "panel_code": panel_definition.panel_code,
                "panel_length_m": float(panel_definition.panel_length_m)
                if panel_definition.panel_length_m is not None
                else None,
            }
        station_name_by_id[station.id] = station.name

    expected_maps: dict[int, dict[int, float]] = {}
    for panel_definition in panel_definitions.values():
        expected_maps[panel_definition.id] = _build_panel_expected_map(
            panel_definition, panel_tasks
        )

    duration_rows = list(
        db.execute(
            select(TaskExpectedDuration).where(
                TaskExpectedDuration.panel_definition_id.in_(panel_definitions.keys())
            )
        ).scalars()
    )
    for row in duration_rows:
        expected_maps.setdefault(row.panel_definition_id, {})[
            row.task_definition_id
        ] = float(row.expected_minutes)

    panel_station_totals: dict[int, dict[int, dict[int, dict[str, float]]]] = {}

    for instance, task_def, panel_unit, panel_definition, _, _, _, station in rows:
        duration = _duration_minutes(instance, pause_map)
        if duration is None:
            continue
        expected = expected_maps.get(panel_definition.id, {}).get(task_def.id)
        panel_station_totals.setdefault(panel_definition.id, {})
        panel_station_totals[panel_definition.id].setdefault(station.id, {})
        panel_station_totals[panel_definition.id][station.id].setdefault(
            panel_unit.id,
            {"duration": 0.0, "expected": 0.0, "expected_count": 0},
        )
        totals = panel_station_totals[panel_definition.id][station.id][panel_unit.id]
        totals["duration"] += duration
        if expected is not None:
            totals["expected"] += expected
            totals["expected_count"] += 1

    response_rows: list[PanelLinearMetersRow] = []
    included_panel_ids: set[int] = set()

    for panel_definition_id, station_map in panel_station_totals.items():
        base = panel_row_base[panel_definition_id]
        station_payload: dict[str, PanelLinearMetersStationStats] = {}
        for station_id, panel_units in station_map.items():
            samples: list[tuple[int, float, float | None, float | None]] = []
            for panel_unit_id, totals in panel_units.items():
                duration = totals["duration"]
                expected_total = (
                    totals["expected"] if totals["expected_count"] else None
                )
                ratio = None
                if expected_total and expected_total > 0:
                    ratio = duration / expected_total
                if ratio is not None:
                    if ratio < effective_min or ratio > effective_max:
                        continue
                samples.append((panel_unit_id, duration, expected_total, ratio))
            if not samples:
                continue
            for panel_unit_id, _, _, _ in samples:
                included_panel_ids.add(panel_unit_id)
            avg_time = _average([sample[1] for sample in samples])
            expected_avg = _average(
                [sample[2] for sample in samples if sample[2] is not None]
            )
            avg_ratio = _average(
                [sample[3] for sample in samples if sample[3] is not None]
            )
            panel_length = base.get("panel_length_m")
            lm_per_minute = None
            if avg_time is not None and panel_length:
                lm_per_minute = round(float(panel_length) / avg_time, 3)
            station_payload[str(station_id)] = PanelLinearMetersStationStats(
                station_id=station_id,
                station_name=station_name_by_id.get(station_id),
                avg_time_minutes=avg_time,
                expected_avg_minutes=expected_avg,
                avg_ratio=round(avg_ratio, 2) if avg_ratio is not None else None,
                lm_per_minute=lm_per_minute,
                sample_count=len(samples),
            )
        if not station_payload:
            continue
        response_rows.append(PanelLinearMetersRow(**base, stations=station_payload))

    response_rows.sort(
        key=lambda row: (
            row.house_type_name or "",
            row.module_sequence_number or 0,
            row.panel_sequence_number or 0,
            row.panel_code or "",
        )
    )

    return PanelLinearMetersResponse(rows=response_rows, total_panels=len(included_panel_ids))
