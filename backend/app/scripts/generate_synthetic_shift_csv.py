from __future__ import annotations

import csv
import itertools
import random
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.enums import StationRole, TaskScope, TaskStatus
from app.models.house import HouseType, PanelDefinition
from app.models.stations import Station
from app.models.tasks import TaskApplicability, TaskDefinition, TaskExpectedDuration
from app.models.workers import Worker
from app.services.task_applicability import resolve_task_station_sequence


RANDOM_SEED = 23
SHIFT_DATE = date.today()
SHIFT_START_HOUR = 8
SHIFT_START_MINUTE = 0
SHIFT_END_HOUR = 17
SHIFT_END_MINUTE = 0
SHIFT_OVERRUN_MINUTES = 10

HOUSES_PER_TYPE = 2
HOUSE_IDENTIFIER_PREFIX = "SYN"
PROJECT_NAME_PREFIX = "Synthetic"

DEFAULT_TASK_MINUTES = 20.0
TASK_DURATION_MIN_MULTIPLIER = 0.8
TASK_DURATION_MAX_MULTIPLIER = 1.25
PAUSE_CHANCE = 0.0
PAUSE_MIN_FRACTION = 0.2
PAUSE_MAX_FRACTION = 0.4

OUTPUT_DIR = Path(__file__).resolve().parent / "synthetic_exports"
OUTPUT_FILE = OUTPUT_DIR / "synthetic_task_timeline.csv"


@dataclass
class SyntheticWorkOrder:
    id: int
    project_name: str
    house_identifier: str
    house_type_id: int
    house_type_name: str
    sub_type_id: int | None = None


@dataclass
class SyntheticWorkUnit:
    id: int
    work_order_id: int
    module_number: int
    planned_sequence: int
    planned_assembly_line: str | None
    project_name: str
    house_identifier: str
    house_type_id: int
    house_type_name: str
    sub_type_id: int | None


@dataclass
class SyntheticPanelUnit:
    id: int
    work_unit_id: int
    panel_definition_id: int
    panel_code: str | None
    module_number: int
    project_name: str
    house_identifier: str
    house_type_id: int
    house_type_name: str
    sub_type_id: int | None


@dataclass
class StationState:
    next_available: datetime
    worker_cycle: itertools.cycle


def _worker_name(worker: Worker) -> str:
    name = f"{worker.first_name} {worker.last_name}".strip()
    return name or f"Worker {worker.id}"


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


def _matches_expected_row(
    row: TaskExpectedDuration,
    house_type_id: int,
    sub_type_id: int | None,
    module_number: int,
    panel_definition_id: int | None,
) -> bool:
    if row.panel_definition_id is not None and row.panel_definition_id != panel_definition_id:
        return False
    if row.house_type_id is not None and row.house_type_id != house_type_id:
        return False
    if row.sub_type_id is not None and row.sub_type_id != sub_type_id:
        return False
    if row.module_number is not None and row.module_number != module_number:
        return False
    return True


def _expected_row_rank(row: TaskExpectedDuration) -> tuple[int, int, int]:
    if row.panel_definition_id is not None:
        level = 0
    elif row.house_type_id is not None and row.module_number is not None:
        level = 1
    elif row.house_type_id is not None:
        level = 2
    else:
        level = 4
    subtype_rank = 0 if row.sub_type_id is not None else 1
    return (level, subtype_rank, row.id)


def _resolve_expected_minutes(
    rows: list[TaskExpectedDuration],
    house_type_id: int,
    sub_type_id: int | None,
    module_number: int,
    panel_definition_id: int | None,
) -> float | None:
    matches = [
        row
        for row in rows
        if _matches_expected_row(row, house_type_id, sub_type_id, module_number, panel_definition_id)
    ]
    if not matches:
        return None
    chosen = min(matches, key=_expected_row_rank)
    if chosen.expected_minutes is None:
        return None
    return float(chosen.expected_minutes)


def _build_station_workers(
    stations: list[Station], workers: list[Worker]
) -> dict[int, list[Worker]]:
    station_workers: dict[int, list[Worker]] = {station.id: [] for station in stations}
    for worker in workers:
        assigned = worker.assigned_station_ids or []
        for station_id in assigned:
            station_workers.setdefault(station_id, []).append(worker)
    for station in stations:
        if not station_workers.get(station.id):
            station_workers[station.id] = list(workers)
    return station_workers


def _pick_station(
    stations_by_sequence: dict[int, list[Station]], sequence_order: int | None
) -> Station | None:
    if sequence_order is None:
        return None
    candidates = stations_by_sequence.get(sequence_order)
    if not candidates:
        return None
    return candidates[0]


def _build_panel_task_plan(
    panel_tasks: list[TaskDefinition],
    applicability_map: dict[int, list[TaskApplicability]],
    panel_definition: PanelDefinition,
    work_unit: SyntheticWorkUnit,
    stations_by_sequence: dict[int, list[Station]],
) -> list[tuple[int, int, TaskDefinition, Station]]:
    panel_order = {}
    if panel_definition.applicable_task_ids is not None:
        panel_order = {
            task_id: index for index, task_id in enumerate(panel_definition.applicable_task_ids)
        }
    planned: list[tuple[int, int, TaskDefinition, Station]] = []
    for task in panel_tasks:
        if panel_order and task.id not in panel_order:
            continue
        applies, sequence = resolve_task_station_sequence(
            task,
            applicability_map.get(task.id, []),
            work_unit.house_type_id,
            work_unit.sub_type_id,
            work_unit.module_number,
            panel_definition.id,
        )
        if not applies or sequence is None:
            continue
        station = _pick_station(stations_by_sequence, sequence)
        if not station:
            continue
        order_index = panel_order.get(task.id, 1_000_000)
        planned.append((sequence, order_index, task, station))
    planned.sort(key=lambda item: (item[0], item[1], item[2].name.lower()))
    return planned


def _build_module_task_plan(
    module_tasks: list[TaskDefinition],
    applicability_map: dict[int, list[TaskApplicability]],
    work_unit: SyntheticWorkUnit,
    stations_by_line_sequence: dict[str, dict[int, list[Station]]],
) -> list[tuple[int, TaskDefinition, Station]]:
    planned: list[tuple[int, TaskDefinition, Station]] = []
    line_key = work_unit.planned_assembly_line
    line_stations = stations_by_line_sequence.get(line_key, {})
    if not line_stations and stations_by_line_sequence:
        line_stations = next(iter(stations_by_line_sequence.values()))
    for task in module_tasks:
        applies, sequence = resolve_task_station_sequence(
            task,
            applicability_map.get(task.id, []),
            work_unit.house_type_id,
            work_unit.sub_type_id,
            work_unit.module_number,
            None,
        )
        if not applies or sequence is None:
            continue
        station = _pick_station(line_stations, sequence)
        if not station:
            continue
        planned.append((sequence, task, station))
    planned.sort(key=lambda item: (item[0], item[1].name.lower()))
    return planned


def _duration_minutes(
    rng: random.Random,
    expected_minutes: float | None,
) -> float:
    base = expected_minutes or DEFAULT_TASK_MINUTES
    multiplier = rng.uniform(TASK_DURATION_MIN_MULTIPLIER, TASK_DURATION_MAX_MULTIPLIER)
    return max(1.0, round(base * multiplier, 2))


def _maybe_pause_minutes(rng: random.Random, duration_minutes: float) -> float:
    if PAUSE_CHANCE <= 0.0:
        return 0.0
    if rng.random() >= PAUSE_CHANCE:
        return 0.0
    fraction = rng.uniform(PAUSE_MIN_FRACTION, PAUSE_MAX_FRACTION)
    return round(max(duration_minutes * fraction, 1.0), 2)


def main() -> None:
    rng = random.Random(RANDOM_SEED)
    shift_start = datetime.combine(
        SHIFT_DATE, time(SHIFT_START_HOUR, SHIFT_START_MINUTE)
    )
    shift_end = datetime.combine(
        SHIFT_DATE, time(SHIFT_END_HOUR, SHIFT_END_MINUTE)
    )
    shift_end_limit = shift_end + timedelta(minutes=SHIFT_OVERRUN_MINUTES)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    db = SessionLocal()
    try:
        workers = list(db.execute(select(Worker).where(Worker.active == True)).scalars())
        stations = list(db.execute(select(Station)).scalars())
        task_definitions = list(
            db.execute(select(TaskDefinition).where(TaskDefinition.active == True)).scalars()
        )
        house_types = list(db.execute(select(HouseType)).scalars())
        panel_definitions = list(db.execute(select(PanelDefinition)).scalars())
        applicability_rows = list(db.execute(select(TaskApplicability)).scalars())
        expected_rows = list(db.execute(select(TaskExpectedDuration)).scalars())
    finally:
        db.close()

    if not workers:
        print("No workers found. Seed workers before running this script.")
        return
    if not stations:
        print("No stations found. Seed stations before running this script.")
        return
    if not task_definitions:
        print("No task definitions found. Seed tasks before running this script.")
        return
    if not house_types:
        print("No house types found. Seed house types before running this script.")
        return

    panel_tasks = [task for task in task_definitions if task.scope == TaskScope.PANEL]
    module_tasks = [task for task in task_definitions if task.scope == TaskScope.MODULE]

    applicability_map: dict[int, list[TaskApplicability]] = {}
    for row in applicability_rows:
        applicability_map.setdefault(row.task_definition_id, []).append(row)
    expected_map: dict[int, list[TaskExpectedDuration]] = {}
    for row in expected_rows:
        expected_map.setdefault(row.task_definition_id, []).append(row)

    stations_by_role_sequence: dict[StationRole, dict[int, list[Station]]] = {}
    stations_by_line_sequence: dict[str, dict[int, list[Station]]] = {}
    for station in sorted(stations, key=lambda value: value.id):
        if station.sequence_order is not None:
            stations_by_role_sequence.setdefault(station.role, {}).setdefault(
                station.sequence_order, []
            ).append(station)
        if station.role == StationRole.ASSEMBLY and station.line_type and station.sequence_order:
            line_key = station.line_type.value
            stations_by_line_sequence.setdefault(line_key, {}).setdefault(
                station.sequence_order, []
            ).append(station)

    station_workers = _build_station_workers(stations, workers)
    station_states: dict[int, StationState] = {}
    for station in stations:
        worker_list = station_workers.get(station.id) or workers
        station_states[station.id] = StationState(
            next_available=shift_start,
            worker_cycle=itertools.cycle(worker_list),
        )

    house_types_by_id = {house_type.id: house_type for house_type in house_types}
    panel_defs_by_id = {panel_def.id: panel_def for panel_def in panel_definitions}

    panel_defs_by_house_module: dict[tuple[int, int], list[PanelDefinition]] = {}
    for panel_def in panel_definitions:
        key = (panel_def.house_type_id, panel_def.module_sequence_number)
        panel_defs_by_house_module.setdefault(key, []).append(panel_def)
    for defs in panel_defs_by_house_module.values():
        defs.sort(key=lambda panel: (panel.panel_sequence_number or 0, panel.id))

    available_lines = sorted(stations_by_line_sequence.keys())

    work_orders: list[SyntheticWorkOrder] = []
    work_units: list[SyntheticWorkUnit] = []
    panel_units: list[SyntheticPanelUnit] = []
    work_order_id = 900_000
    work_unit_id = 1_000_000
    panel_unit_id = 1_100_000
    planned_sequence = 1
    line_index = 0

    for house_type in house_types:
        for index in range(1, HOUSES_PER_TYPE + 1):
            identifier = f"{HOUSE_IDENTIFIER_PREFIX}-{house_type.id}-{index:02d}"
            project_name = f"{PROJECT_NAME_PREFIX}-{house_type.id}"
            work_orders.append(
                SyntheticWorkOrder(
                    id=work_order_id,
                    project_name=project_name,
                    house_identifier=identifier,
                    house_type_id=house_type.id,
                    house_type_name=house_type.name,
                )
            )
            for module_number in range(1, house_type.number_of_modules + 1):
                planned_line = None
                if available_lines:
                    planned_line = available_lines[line_index % len(available_lines)]
                    line_index += 1
                work_units.append(
                    SyntheticWorkUnit(
                        id=work_unit_id,
                        work_order_id=work_order_id,
                        module_number=module_number,
                        planned_sequence=planned_sequence,
                        planned_assembly_line=planned_line,
                        project_name=project_name,
                        house_identifier=identifier,
                        house_type_id=house_type.id,
                        house_type_name=house_type.name,
                        sub_type_id=None,
                    )
                )
                planned_sequence += 1
                panel_defs = panel_defs_by_house_module.get(
                    (house_type.id, module_number),
                    [],
                )
                for panel_def in panel_defs:
                    panel_units.append(
                        SyntheticPanelUnit(
                            id=panel_unit_id,
                            work_unit_id=work_unit_id,
                            panel_definition_id=panel_def.id,
                            panel_code=panel_def.panel_code,
                            module_number=module_number,
                            project_name=project_name,
                            house_identifier=identifier,
                            house_type_id=house_type.id,
                            house_type_name=house_type.name,
                            sub_type_id=None,
                        )
                    )
                    panel_unit_id += 1
                work_unit_id += 1
            work_order_id += 1

    work_units_by_id = {unit.id: unit for unit in work_units}
    panel_units_by_work_unit: dict[int, list[SyntheticPanelUnit]] = {}
    for panel_unit in panel_units:
        panel_units_by_work_unit.setdefault(panel_unit.work_unit_id, []).append(panel_unit)
    for units in panel_units_by_work_unit.values():
        units.sort(key=lambda unit: unit.id)

    panel_units_sorted = sorted(
        panel_units,
        key=lambda unit: (
            work_units_by_id[unit.work_unit_id].planned_sequence,
            unit.id,
        ),
    )

    panel_expected_cache: dict[int, dict[int, float]] = {}
    work_unit_ready_time: dict[int, datetime] = {}

    timeline_rows: list[dict[str, str | int | float | None]] = []
    task_instance_id = 1

    for panel_unit in panel_units_sorted:
        work_unit = work_units_by_id[panel_unit.work_unit_id]
        panel_def = panel_defs_by_id.get(panel_unit.panel_definition_id)
        if not panel_def:
            continue
        planned_tasks = _build_panel_task_plan(
            panel_tasks,
            applicability_map,
            panel_def,
            work_unit,
            stations_by_role_sequence.get(StationRole.PANELS, {}),
        )
        if not planned_tasks:
            continue
        if panel_def.id not in panel_expected_cache:
            panel_expected_cache[panel_def.id] = _build_panel_expected_map(
                panel_def, panel_tasks
            )
        panel_expected = panel_expected_cache[panel_def.id]
        panel_ready_time = shift_start
        for _, _, task_def, station in planned_tasks:
            station_state = station_states.get(station.id)
            if not station_state:
                continue
            start_time = max(panel_ready_time, station_state.next_available)
            if start_time >= shift_end_limit:
                break
            expected_minutes = panel_expected.get(task_def.id)
            if expected_minutes is None:
                expected_minutes = _resolve_expected_minutes(
                    expected_map.get(task_def.id, []),
                    work_unit.house_type_id,
                    work_unit.sub_type_id,
                    work_unit.module_number,
                    panel_def.id,
                )
            duration_minutes = _duration_minutes(rng, expected_minutes)
            pause_minutes = _maybe_pause_minutes(rng, duration_minutes)
            total_minutes = duration_minutes + pause_minutes
            completed_at = start_time + timedelta(minutes=total_minutes)
            if completed_at > shift_end_limit and start_time >= shift_end:
                break
            worker = next(station_state.worker_cycle)
            timeline_rows.append(
                {
                    "task_instance_id": task_instance_id,
                    "task_definition_id": task_def.id,
                    "task_name": task_def.name,
                    "task_scope": task_def.scope.value,
                    "task_status": TaskStatus.COMPLETED.value,
                    "station_id": station.id,
                    "station_name": station.name,
                    "worker_id": worker.id,
                    "worker_name": _worker_name(worker),
                    "work_order_id": work_unit.work_order_id,
                    "project_name": work_unit.project_name,
                    "house_identifier": work_unit.house_identifier,
                    "house_type_id": work_unit.house_type_id,
                    "house_type_name": work_unit.house_type_name,
                    "module_number": work_unit.module_number,
                    "work_unit_id": work_unit.id,
                    "panel_unit_id": panel_unit.id,
                    "panel_definition_id": panel_def.id,
                    "panel_code": panel_def.panel_code,
                    "started_at": start_time.isoformat(sep=" "),
                    "completed_at": completed_at.isoformat(sep=" "),
                    "expected_minutes": expected_minutes,
                    "duration_minutes": duration_minutes,
                    "pause_minutes": pause_minutes,
                }
            )
            task_instance_id += 1
            panel_ready_time = completed_at
            station_state.next_available = completed_at
        work_unit_ready_time[work_unit.id] = max(
            work_unit_ready_time.get(work_unit.id, shift_start), panel_ready_time
        )

    work_units_sorted = sorted(work_units, key=lambda unit: unit.planned_sequence)
    for work_unit in work_units_sorted:
        planned_tasks = _build_module_task_plan(
            module_tasks,
            applicability_map,
            work_unit,
            stations_by_line_sequence,
        )
        if not planned_tasks:
            continue
        module_ready_time = work_unit_ready_time.get(work_unit.id, shift_start)
        for _, task_def, station in planned_tasks:
            station_state = station_states.get(station.id)
            if not station_state:
                continue
            start_time = max(module_ready_time, station_state.next_available)
            if start_time >= shift_end_limit:
                break
            expected_minutes = _resolve_expected_minutes(
                expected_map.get(task_def.id, []),
                work_unit.house_type_id,
                work_unit.sub_type_id,
                work_unit.module_number,
                None,
            )
            duration_minutes = _duration_minutes(rng, expected_minutes)
            pause_minutes = _maybe_pause_minutes(rng, duration_minutes)
            total_minutes = duration_minutes + pause_minutes
            completed_at = start_time + timedelta(minutes=total_minutes)
            if completed_at > shift_end_limit and start_time >= shift_end:
                break
            worker = next(station_state.worker_cycle)
            timeline_rows.append(
                {
                    "task_instance_id": task_instance_id,
                    "task_definition_id": task_def.id,
                    "task_name": task_def.name,
                    "task_scope": task_def.scope.value,
                    "task_status": TaskStatus.COMPLETED.value,
                    "station_id": station.id,
                    "station_name": station.name,
                    "worker_id": worker.id,
                    "worker_name": _worker_name(worker),
                    "work_order_id": work_unit.work_order_id,
                    "project_name": work_unit.project_name,
                    "house_identifier": work_unit.house_identifier,
                    "house_type_id": work_unit.house_type_id,
                    "house_type_name": work_unit.house_type_name,
                    "module_number": work_unit.module_number,
                    "work_unit_id": work_unit.id,
                    "panel_unit_id": None,
                    "panel_definition_id": None,
                    "panel_code": None,
                    "started_at": start_time.isoformat(sep=" "),
                    "completed_at": completed_at.isoformat(sep=" "),
                    "expected_minutes": expected_minutes,
                    "duration_minutes": duration_minutes,
                    "pause_minutes": pause_minutes,
                }
            )
            task_instance_id += 1
            module_ready_time = completed_at
            station_state.next_available = completed_at

    if not timeline_rows:
        print("No tasks were scheduled. Check task applicability and station setup.")
        return

    fieldnames = [
        "task_instance_id",
        "task_definition_id",
        "task_name",
        "task_scope",
        "task_status",
        "station_id",
        "station_name",
        "worker_id",
        "worker_name",
        "work_order_id",
        "project_name",
        "house_identifier",
        "house_type_id",
        "house_type_name",
        "module_number",
        "work_unit_id",
        "panel_unit_id",
        "panel_definition_id",
        "panel_code",
        "started_at",
        "completed_at",
        "expected_minutes",
        "duration_minutes",
        "pause_minutes",
    ]

    with OUTPUT_FILE.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(timeline_rows)

    print(f"Wrote {len(timeline_rows)} rows to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
