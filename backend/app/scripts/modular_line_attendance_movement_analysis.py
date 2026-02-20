#!/usr/bin/env python3
"""Correlate cached assembly attendance vs module movement active duration.

Movement timestamps are derived from completed MODULE-scope task instances whose
task definition has advance_trigger=True. For each work unit, we measure elapsed
active time between consecutive movement timestamps.

Active-time duration is computed by masking each interval against
ShiftEstimate.estimated_start / ShiftEstimate.estimated_end windows for the
corresponding assembly sequence order.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import OperationalError

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.api.routes.shift_estimates import ALGORITHM_VERSION
from app.db.session import SessionLocal
from app.models.enums import StationLineType, StationRole, TaskScope, TaskStatus
from app.models.shift_estimate_worker_presence import ShiftEstimateWorkerPresence
from app.models.shift_estimates import ShiftEstimate
from app.models.stations import Station
from app.models.tasks import TaskDefinition, TaskInstance


# =========================
# Hardcoded parameters
# =========================
FROM_DATE = "2026-01-19"
TO_DATE = "2026-02-18"

# Optional assembly line filter ("1", "2", "3"), or None for all lines.
ASSEMBLY_LINE_TYPE: str | None = None

# Stations to include by name. None means all assembly stations in selected line.
STATIONS_TO_COMPARE: list[str] | None = None

# If True, only include days where ALL selected assembly-station cache rows exist.
USE_ONLY_COMPLETE_CACHE_DAYS = False

# Ignore days where deduplicated total assembly-line attendance is below this value.
MIN_TOTAL_LINE_ATTENDANCE = 3

# Minimum movement intervals required to compute daily station average move time.
MIN_MOVES_PER_STATION_DAY = 1

# Throughput metric denominator basis. KPI is computed as:
# movements_per_workday = WORKDAY_HOURS / avg_active_move_hours
WORKDAY_HOURS = 8.0

# Fallback for first assembly station entry timestamp when no prior move event exists.
FIRST_STATION_ENTRY_TASK_ID = 27

# Optional lookback for movement events before FROM_DATE so first in-range intervals
# can find their previous movement. Set to None for unbounded history.
MOVEMENT_HISTORY_LOOKBACK_DAYS: int | None = 180

# Output files.
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_CSV_PATH = OUTPUT_DIR / "modular_line_attendance_vs_move_time.csv"
OUTPUT_HTML_PATH = OUTPUT_DIR / "modular_line_attendance_vs_move_time.html"


@dataclass
class StationDayMetric:
    attendance: int | None
    move_count: int
    avg_active_move_hours: float | None


@dataclass
class DayRow:
    day: date
    line_attendance: int | None
    line_avg_active_move_hours: float | None
    station_metrics: dict[str, StationDayMetric]
    cache_rows: int
    cache_expected_rows: int
    cache_complete: bool


def movements_per_workday(avg_active_move_hours: float | None) -> float | None:
    if avg_active_move_hours is None or avg_active_move_hours <= 0:
        return None
    return WORKDAY_HOURS / avg_active_move_hours


def parse_iso_date(value: str, field: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError(f"{field} must use YYYY-MM-DD format; got '{value}'") from exc


def parse_line_type(value: str | None) -> StationLineType | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        return StationLineType(raw)
    except ValueError as exc:
        raise ValueError(
            f"ASSEMBLY_LINE_TYPE must be one of {[m.value for m in StationLineType]} or None; got '{value}'"
        ) from exc


def iter_days(start: date, end: date) -> list[date]:
    current = start
    out: list[date] = []
    while current <= end:
        out.append(current)
        current += timedelta(days=1)
    return out


def slugify(value: str) -> str:
    lowered = value.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "_", lowered).strip("_")
    return slug or "station"


def active_minutes_between_with_masks(
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
                total_minutes += (overlap_end - overlap_start).total_seconds() / 60
        day_cursor += timedelta(days=1)

    return total_minutes


def load_assembly_stations(line_type: StationLineType | None) -> list[Station]:
    with SessionLocal() as session:
        stmt = (
            select(Station)
            .where(Station.role == StationRole.ASSEMBLY)
            .order_by(Station.sequence_order, Station.id)
        )
        if line_type is not None:
            stmt = stmt.where(Station.line_type == line_type)
        return list(session.execute(stmt).scalars())


def load_attendance_cache(
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

    with SessionLocal() as session:
        estimate_rows = list(
            session.execute(
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
            session.execute(
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


def load_move_intervals_active_minutes(
    start: date,
    end: date,
    selected_station_ids: list[int],
    chain_station_ids: list[int],
    station_id_to_sequence: dict[int, int],
    first_sequence_order: int | None,
    shift_masks_by_day_sequence: dict[date, dict[int, tuple[datetime, datetime]]],
) -> dict[date, dict[int, list[float]]]:
    end_dt = datetime.combine(end, time(23, 59, 59, 999999))
    lookback_start_dt: datetime | None = None
    if MOVEMENT_HISTORY_LOOKBACK_DAYS is not None:
        lookback_start_day = start - timedelta(days=MOVEMENT_HISTORY_LOOKBACK_DAYS)
        lookback_start_dt = datetime.combine(lookback_start_day, time(0, 0, 0))

    with SessionLocal() as session:
        first_entry_rows = list(
            session.execute(
                select(
                    TaskInstance.work_unit_id,
                    TaskInstance.started_at,
                )
                .where(TaskInstance.scope == TaskScope.MODULE)
                .where(TaskInstance.panel_unit_id.is_(None))
                .where(TaskInstance.task_definition_id == FIRST_STATION_ENTRY_TASK_ID)
                .where(TaskInstance.started_at.is_not(None))
                .where(TaskInstance.started_at <= end_dt)
                .order_by(
                    TaskInstance.work_unit_id,
                    TaskInstance.started_at,
                    TaskInstance.id,
                )
            ).all()
        )
        stmt = (
            select(
                TaskInstance.work_unit_id,
                TaskInstance.station_id,
                TaskInstance.completed_at,
                TaskInstance.id,
            )
            .join(TaskDefinition, TaskDefinition.id == TaskInstance.task_definition_id)
            .join(Station, Station.id == TaskInstance.station_id)
            .where(TaskInstance.scope == TaskScope.MODULE)
            .where(TaskInstance.panel_unit_id.is_(None))
            .where(TaskInstance.status == TaskStatus.COMPLETED)
            .where(TaskInstance.completed_at.is_not(None))
            .where(TaskDefinition.advance_trigger == True)
            .where(Station.role == StationRole.ASSEMBLY)
            .where(TaskInstance.station_id.in_(chain_station_ids))
            .where(TaskInstance.completed_at <= end_dt)
            .order_by(
                TaskInstance.work_unit_id,
                TaskInstance.completed_at,
                TaskInstance.id,
            )
        )
        if lookback_start_dt is not None:
            first_entry_rows = [
                row for row in first_entry_rows if row.started_at >= lookback_start_dt
            ]
            stmt = stmt.where(TaskInstance.completed_at >= lookback_start_dt)
        rows = list(session.execute(stmt).all())

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
    previous_move_by_work_unit: dict[int, datetime] = {}
    selected_station_ids_set = set(selected_station_ids)

    for work_unit_id, station_id, completed_at, _instance_id in rows:
        if completed_at is None or station_id is None:
            continue
        previous_move = previous_move_by_work_unit.get(work_unit_id)
        if previous_move is None and first_sequence_order is not None:
            station_sequence = station_id_to_sequence.get(station_id)
            if station_sequence == first_sequence_order:
                fallback_started = first_entry_started_by_work_unit.get(work_unit_id)
                if fallback_started is not None and fallback_started <= completed_at:
                    previous_move = fallback_started
        if previous_move is not None:
            day = completed_at.date()
            if start <= day <= end and station_id in selected_station_ids_set:
                sequence_order = station_id_to_sequence.get(station_id)
                if sequence_order is None:
                    previous_move_by_work_unit[work_unit_id] = completed_at
                    continue
                active_minutes = active_minutes_between_with_masks(
                    previous_move,
                    completed_at,
                    sequence_order,
                    shift_masks_by_day_sequence,
                )
                intervals_by_day_station[day][station_id].append(active_minutes)
        previous_move_by_work_unit[work_unit_id] = completed_at

    return {
        day: {station_id: values for station_id, values in station_map.items()}
        for day, station_map in intervals_by_day_station.items()
    }


def assemble_rows(
    days: list[date],
    attendance_by_day_sequence: dict[date, dict[int, int]],
    line_attendance_by_day: dict[date, int],
    sequence_rows_by_day: dict[date, set[int]],
    cache_rows_per_day: dict[date, int],
    move_intervals_by_day_station: dict[date, dict[int, list[float]]],
    station_key_to_id: dict[str, int],
    station_key_to_sequence: dict[str, int],
    expected_rows: int,
) -> list[DayRow]:
    rows: list[DayRow] = []

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

        station_metrics: dict[str, StationDayMetric] = {}
        all_day_intervals: list[float] = []
        move_day_map = move_intervals_by_day_station.get(day, {})

        for station_key, sequence_order in station_key_to_sequence.items():
            attendance = (
                sequence_counts.get(sequence_order, 0)
                if cache_complete or sequence_order in sequence_rows
                else None
            )
            station_id = station_key_to_id[station_key]
            station_intervals = move_day_map.get(station_id, [])
            all_day_intervals.extend(station_intervals)
            avg_hours = (
                (sum(station_intervals) / len(station_intervals)) / 60.0
                if len(station_intervals) >= MIN_MOVES_PER_STATION_DAY
                else None
            )
            station_metrics[station_key] = StationDayMetric(
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
            DayRow(
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


def write_csv(
    rows: list[DayRow],
    station_keys: list[str],
    station_key_to_label: dict[str, str],
    station_key_to_id: dict[str, int],
    output_path: Path,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "date",
        "station_key",
        "station_id",
        "station_name",
        "attendance_station",
        "attendance_line_total",
        "move_intervals_count",
        "movements_per_8h_station",
        "movements_per_8h_line",
        "avg_active_move_hours",
        "line_avg_active_move_hours",
        "cache_rows",
        "cache_expected_rows",
        "cache_complete",
    ]
    with output_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            for station_key in station_keys:
                metric = row.station_metrics[station_key]
                writer.writerow(
                    {
                        "date": row.day.isoformat(),
                        "station_key": station_key,
                        "station_id": station_key_to_id[station_key],
                        "station_name": station_key_to_label[station_key],
                        "attendance_station": metric.attendance,
                        "attendance_line_total": row.line_attendance,
                        "move_intervals_count": metric.move_count,
                        "movements_per_8h_station": movements_per_workday(
                            metric.avg_active_move_hours
                        ),
                        "movements_per_8h_line": movements_per_workday(
                            row.line_avg_active_move_hours
                        ),
                        "avg_active_move_hours": metric.avg_active_move_hours,
                        "line_avg_active_move_hours": row.line_avg_active_move_hours,
                        "cache_rows": row.cache_rows,
                        "cache_expected_rows": row.cache_expected_rows,
                        "cache_complete": row.cache_complete,
                    }
                )


def write_html_report(
    rows: list[DayRow],
    station_keys: list[str],
    station_key_to_label: dict[str, str],
    station_key_to_sequence: dict[str, int],
    output_path: Path,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    chart_rows: list[dict[str, object]] = []
    for row in rows:
        stations_payload: dict[str, object] = {}
        for station_key in station_keys:
            metric = row.station_metrics[station_key]
            stations_payload[station_key] = {
                "attendance": metric.attendance,
                "move_count": metric.move_count,
                "avg_move_hours": metric.avg_active_move_hours,
                "moves_per_8h": movements_per_workday(metric.avg_active_move_hours),
            }
        chart_rows.append(
            {
                "date": row.day.isoformat(),
                "line_attendance": row.line_attendance,
                "line_moves_per_8h": movements_per_workday(
                    row.line_avg_active_move_hours
                ),
                "stations": stations_payload,
            }
        )

    sequence_to_station_keys: dict[int, list[str]] = defaultdict(list)
    for station_key in station_keys:
        sequence_to_station_keys[station_key_to_sequence[station_key]].append(station_key)
    station_groups = []
    for sequence_order in sorted(sequence_to_station_keys.keys()):
        keys = sequence_to_station_keys[sequence_order]
        if len(keys) == 1:
            title = station_key_to_label[keys[0]]
        else:
            title = f"Sequence {sequence_order} (aggregate of {len(keys)} stations)"
        station_groups.append(
            {
                "sequence_order": sequence_order,
                "title": title,
                "station_keys": keys,
            }
        )

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Modular Attendance vs Move Throughput</title>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  <style>
    body {{
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      margin: 20px;
      color: #1f2937;
      background: #f9fafb;
    }}
    .card {{
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 16px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    }}
    .meta {{
      font-size: 13px;
      color: #6b7280;
      margin-top: 4px;
      margin-bottom: 12px;
    }}
    #overview {{
      width: 100%;
      min-height: 420px;
    }}
    [id^="chart_"] {{
      width: 100%;
      min-height: 360px;
    }}
    .details-wrap {{
      margin-top: 12px;
    }}
    .details-wrap > summary {{
      cursor: pointer;
      font-size: 13px;
      color: #374151;
      user-select: none;
      margin-bottom: 8px;
    }}
    .subcard {{
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 10px;
      margin-top: 10px;
      background: #fafafa;
    }}
    .subcard h4 {{
      margin: 0 0 8px 0;
      font-size: 14px;
      color: #374151;
    }}
  </style>
</head>
<body>
  <div class="card">
    <h2>Modular Line Attendance vs Movement Throughput</h2>
    <div class="meta">Movement active time is masked by shift_estimates estimated_start/estimated_end (by assembly sequence).</div>
    <div class="meta">Throughput metric: movements per 8h workday = 8 / avg active move hours (higher is better).</div>
    <div class="meta">Rows: {len(rows)} | Date range: {rows[0].day.isoformat()} to {rows[-1].day.isoformat()}</div>
  </div>

  <div class="card">
    <h3>Overall</h3>
    <div class="meta">Blue: movement throughput (movements per 8h) across all stations. Orange: total line attendance.</div>
    <div id="overview"></div>
  </div>

  <div id="stationsContainer"></div>

  <script>
    const rows = {json.dumps(chart_rows)};
    const stationLabels = {json.dumps(station_key_to_label)};
    const stationGroups = {json.dumps(station_groups)};

    function renderOverview() {{
      const x = rows.map((row) => row.date);
      const movesPer8h = rows.map((row) => row.line_moves_per_8h);
      const attendance = rows.map((row) => row.line_attendance);

      const traces = [
        {{
          x,
          y: movesPer8h,
          name: "Movements per 8h",
          mode: "lines+markers",
          line: {{ color: "#2563eb", width: 3 }},
          yaxis: "y1",
        }},
        {{
          x,
          y: attendance,
          name: "Line attendance",
          mode: "lines+markers",
          line: {{ color: "#ea580c", width: 2 }},
          yaxis: "y2",
        }},
      ];

      Plotly.newPlot("overview", traces, {{
        margin: {{ t: 20, r: 70, l: 70, b: 50 }},
        xaxis: {{ title: "Date" }},
        yaxis: {{ title: "Movements per 8h", side: "left", rangemode: "tozero" }},
        yaxis2: {{
          title: "Attendance (people)",
          overlaying: "y",
          side: "right",
          showgrid: false,
          rangemode: "tozero",
        }},
        legend: {{ orientation: "h" }},
      }}, {{ responsive: true }});
    }}

    function stationHasData(stationKey) {{
      return rows.some((row) => {{
        const station = row.stations[stationKey];
        return station && station.moves_per_8h !== null && station.moves_per_8h !== undefined;
      }});
    }}

    function aggregateGroupPoint(row, group) {{
      let weightedHours = 0;
      let totalMoves = 0;
      let attendance = null;
      for (const stationKey of group.station_keys) {{
        const station = row.stations[stationKey];
        if (!station) {{
          continue;
        }}
        if (attendance === null && station.attendance !== null && station.attendance !== undefined) {{
          attendance = station.attendance;
        }}
        const moveCount = station.move_count ?? 0;
        const avgMoveHours = station.avg_move_hours;
        if (avgMoveHours !== null && avgMoveHours !== undefined && moveCount > 0) {{
          weightedHours += avgMoveHours * moveCount;
          totalMoves += moveCount;
        }}
      }}
      return {{
        avgMoveHours: totalMoves > 0 ? (weightedHours / totalMoves) : null,
        attendance,
        moveCount: totalMoves,
        movesPer8h: (totalMoves > 0 && (weightedHours / totalMoves) > 0)
          ? ({WORKDAY_HOURS} / (weightedHours / totalMoves))
          : null,
      }};
    }}

    function groupHasData(group) {{
      return rows.some((row) => aggregateGroupPoint(row, group).moveCount > 0);
    }}

    function renderSequenceCards() {{
      const container = document.getElementById("stationsContainer");
      const withData = stationGroups.filter((group) => groupHasData(group));
      if (!withData.length) {{
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = '<div class="meta">No sequence charts with movement data for the selected range.</div>';
        container.appendChild(card);
        return [];
      }}
      for (const group of withData) {{
        const slug = `seq_${{group.sequence_order}}`;
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `<h3>${{group.title}}</h3><div id="chart_${{slug}}"></div>`;
        if (group.station_keys.length > 1) {{
          const details = document.createElement("details");
          details.className = "details-wrap";
          details.innerHTML = `<summary>Show individual stations (${{group.station_keys.length}})</summary><div id="details_${{slug}}"></div>`;
          const detailsBody = details.querySelector(`#details_${{slug}}`);
          for (const stationKey of group.station_keys) {{
            if (!stationHasData(stationKey)) {{
              continue;
            }}
            const stationCard = document.createElement("div");
            stationCard.className = "subcard";
            stationCard.innerHTML = `<h4>${{stationLabels[stationKey] ?? stationKey}}</h4><div id="chart_station_${{stationKey}}"></div>`;
            detailsBody.appendChild(stationCard);
          }}
          if (detailsBody.children.length > 0) {{
            card.appendChild(details);
          }}
        }}
        container.appendChild(card);
      }}
      return withData;
    }}

    function renderSequenceChart(group) {{
      const slug = `seq_${{group.sequence_order}}`;
      const targetId = `chart_${{slug}}`;
      const x = rows.map((row) => row.date);
      const points = rows.map((row) => aggregateGroupPoint(row, group));
      const movesPer8h = points.map((point) => point.movesPer8h);
      const attendance = points.map((point) => point.attendance);

      const traces = [
        {{
          x,
          y: movesPer8h,
          name: "Movements per 8h",
          mode: "lines+markers",
          line: {{ color: "#2563eb", width: 3 }},
          yaxis: "y1",
          hovertemplate: "Date: %{{x}}<br>Movements per 8h: %{{y:.2f}}<extra></extra>",
        }},
        {{
          x,
          y: attendance,
          name: "Sequence attendance",
          mode: "lines+markers",
          line: {{ color: "#ea580c", width: 2 }},
          yaxis: "y2",
          hovertemplate: "Date: %{{x}}<br>Attendance: %{{y}}<extra></extra>",
        }},
      ];

      Plotly.newPlot(targetId, traces, {{
        margin: {{ t: 20, r: 70, l: 70, b: 50 }},
        xaxis: {{ title: "Date" }},
        yaxis: {{ title: "Movements per 8h", side: "left", rangemode: "tozero" }},
        yaxis2: {{
          title: "Attendance (people)",
          overlaying: "y",
          side: "right",
          showgrid: false,
          rangemode: "tozero",
        }},
        legend: {{ orientation: "h" }},
      }}, {{ responsive: true }});
    }}

    function renderStationChart(stationKey) {{
      const targetId = `chart_station_${{stationKey}}`;
      const x = rows.map((row) => row.date);
      const movesPer8h = rows.map((row) => row.stations[stationKey]?.moves_per_8h ?? null);
      const attendance = rows.map((row) => row.stations[stationKey]?.attendance ?? null);

      const traces = [
        {{
          x,
          y: movesPer8h,
          name: "Movements per 8h",
          mode: "lines+markers",
          line: {{ color: "#2563eb", width: 3 }},
          yaxis: "y1",
          hovertemplate: "Date: %{{x}}<br>Movements per 8h: %{{y:.2f}}<extra></extra>",
        }},
        {{
          x,
          y: attendance,
          name: "Station attendance",
          mode: "lines+markers",
          line: {{ color: "#ea580c", width: 2 }},
          yaxis: "y2",
          hovertemplate: "Date: %{{x}}<br>Attendance: %{{y}}<extra></extra>",
        }},
      ];

      Plotly.newPlot(targetId, traces, {{
        margin: {{ t: 20, r: 70, l: 70, b: 50 }},
        xaxis: {{ title: "Date" }},
        yaxis: {{ title: "Movements per 8h", side: "left", rangemode: "tozero" }},
        yaxis2: {{
          title: "Attendance (people)",
          overlaying: "y",
          side: "right",
          showgrid: false,
          rangemode: "tozero",
        }},
        legend: {{ orientation: "h" }},
      }}, {{ responsive: true }});
    }}

    if (typeof Plotly === "undefined") {{
      const overviewEl = document.getElementById("overview");
      overviewEl.textContent = "Plotly failed to load, so charts could not be rendered.";
      const container = document.getElementById("stationsContainer");
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = '<div class="meta">Plotly failed to load, so charts could not be rendered.</div>';
      container.appendChild(card);
    }} else {{
      renderOverview();
      const groupsWithData = renderSequenceCards();
      groupsWithData.forEach((group) => renderSequenceChart(group));
      groupsWithData.forEach((group) => {{
        if (group.station_keys.length > 1) {{
          group.station_keys.forEach((stationKey) => {{
            if (stationHasData(stationKey)) {{
              renderStationChart(stationKey);
            }}
          }});
        }}
      }});
    }}
  </script>
</body>
</html>
"""
    output_path.write_text(html, encoding="utf-8")


def main() -> int:
    start = parse_iso_date(FROM_DATE, "FROM_DATE")
    end = parse_iso_date(TO_DATE, "TO_DATE")
    if start > end:
        raise ValueError("FROM_DATE must be <= TO_DATE")

    line_type = parse_line_type(ASSEMBLY_LINE_TYPE)

    try:
        assembly_stations = load_assembly_stations(line_type)
        if not assembly_stations:
            raise RuntimeError("No assembly stations found for selected filters.")

        if STATIONS_TO_COMPARE is None:
            selected_stations = list(assembly_stations)
        else:
            known_names = {station.name for station in assembly_stations}
            missing = [name for name in STATIONS_TO_COMPARE if name not in known_names]
            if missing:
                known = ", ".join(sorted(known_names))
                raise RuntimeError(
                    f"Stations not found in STATIONS_TO_COMPARE: {missing}. Known assembly stations: {known}"
                )
            selected_names = set(STATIONS_TO_COMPARE)
            selected_stations = [
                station for station in assembly_stations if station.name in selected_names
            ]

        if not selected_stations:
            raise RuntimeError("No stations selected for analysis.")

        name_counts = Counter(station.name for station in selected_stations)
        station_keys: list[str] = []
        station_key_to_label: dict[str, str] = {}
        station_key_to_id: dict[str, int] = {}
        station_key_to_sequence: dict[str, int] = {}

        for station in selected_stations:
            sequence_order = station.sequence_order
            if sequence_order is None:
                raise RuntimeError(
                    f"Station '{station.name}' has no sequence_order; cannot align with assembly shift_estimate groups."
                )
            station_key = str(station.id)
            line_label = (
                f"Line {station.line_type.value}"
                if station.line_type is not None
                else f"Station {station.id}"
            )
            label = (
                f"{station.name} ({line_label})"
                if name_counts[station.name] > 1
                else station.name
            )
            station_keys.append(station_key)
            station_key_to_label[station_key] = label
            station_key_to_id[station_key] = station.id
            station_key_to_sequence[station_key] = sequence_order

        selected_station_ids = [station.id for station in selected_stations]
        selected_sequences = sorted(set(station_key_to_sequence.values()))
        first_sequence_order = min(selected_sequences) if selected_sequences else None
        station_id_to_sequence = {
            station.id: station.sequence_order
            for station in assembly_stations
            if station.sequence_order is not None
        }
        chain_station_ids = sorted(station_id_to_sequence.keys())
        attendance_start = (
            start - timedelta(days=MOVEMENT_HISTORY_LOOKBACK_DAYS)
            if MOVEMENT_HISTORY_LOOKBACK_DAYS is not None
            else start
        )

        days = iter_days(start, end)
        (
            attendance_by_day_sequence,
            line_attendance_by_day,
            cache_rows_per_day,
            sequence_rows_by_day,
            shift_masks_by_day_sequence,
        ) = load_attendance_cache(attendance_start, end, selected_sequences)
        move_intervals_by_day_station = load_move_intervals_active_minutes(
            start=start,
            end=end,
            selected_station_ids=selected_station_ids,
            chain_station_ids=chain_station_ids,
            station_id_to_sequence=station_id_to_sequence,
            first_sequence_order=first_sequence_order,
            shift_masks_by_day_sequence=shift_masks_by_day_sequence,
        )

        all_rows = assemble_rows(
            days=days,
            attendance_by_day_sequence=attendance_by_day_sequence,
            line_attendance_by_day=line_attendance_by_day,
            sequence_rows_by_day=sequence_rows_by_day,
            cache_rows_per_day=cache_rows_per_day,
            move_intervals_by_day_station=move_intervals_by_day_station,
            station_key_to_id=station_key_to_id,
            station_key_to_sequence=station_key_to_sequence,
            expected_rows=len(selected_sequences),
        )

        rows_after_cache = (
            [row for row in all_rows if row.cache_complete]
            if USE_ONLY_COMPLETE_CACHE_DAYS
            else all_rows
        )
        rows_after_attendance = [
            row
            for row in rows_after_cache
            if row.line_attendance is not None and row.line_attendance >= MIN_TOTAL_LINE_ATTENDANCE
        ]
        rows_after_movement = [
            row
            for row in rows_after_attendance
            if any(metric.move_count > 0 for metric in row.station_metrics.values())
        ]
        rows = rows_after_movement

        if not rows:
            print("No rows available for analysis after filters.")
            days_with_any_cache = sum(1 for row in all_rows if row.cache_rows > 0)
            days_with_attendance = sum(1 for row in all_rows if row.line_attendance is not None)
            days_with_moves = sum(
                1
                for row in all_rows
                if any(metric.move_count > 0 for metric in row.station_metrics.values())
            )
            print(f"Days in range: {len(all_rows)}")
            print(f"Days with assembly cache rows: {days_with_any_cache}")
            print(f"Days with line attendance resolved: {days_with_attendance}")
            print(f"Rows after cache-complete filter: {len(rows_after_cache)}")
            print(f"Rows after min attendance filter: {len(rows_after_attendance)}")
            print(f"Rows after movement filter (>0 intervals): {len(rows)}")
            print(f"Days with >=1 movement interval: {days_with_moves}")
            print(
                f"Selected stations: {len(station_keys)} | unique assembly sequences: {len(selected_sequences)}"
            )
            print(
                "Active-time mask source: shift_estimates.estimated_start/estimated_end (by sequence_order)."
            )
            return 1

        stations_with_data = [
            key
            for key in station_keys
            if any(row.station_metrics[key].move_count > 0 for row in rows)
        ]
        if not stations_with_data:
            print("No rows available for graphing after station-level movement filter.")
            return 1

        write_csv(
            rows,
            station_keys,
            station_key_to_label,
            station_key_to_id,
            OUTPUT_CSV_PATH,
        )
        write_html_report(
            rows,
            stations_with_data,
            station_key_to_label,
            station_key_to_sequence,
            OUTPUT_HTML_PATH,
        )

        print("Modular attendance vs movement throughput analysis")
        print(f"Date range: {start.isoformat()} -> {end.isoformat()}")
        print(
            f"Assembly line filter: {line_type.value if line_type is not None else 'ALL'}"
        )
        print(
            "Stations analyzed: "
            + ", ".join(station_key_to_label[key] for key in station_keys)
        )
        print(
            "Stations graphed: "
            + ", ".join(station_key_to_label[key] for key in stations_with_data)
        )
        print(f"Rows analyzed: {len(rows)}")
        print(f"CSV: {OUTPUT_CSV_PATH}")
        print(f"HTML: {OUTPUT_HTML_PATH}")
        print(f"Min total attendance filter: >= {MIN_TOTAL_LINE_ATTENDANCE}")
        print(
            f"Throughput metric: movements per 8h = {WORKDAY_HOURS} / avg_active_move_hours"
        )
        print("Active-time mask source: shift_estimates.estimated_start/estimated_end")
        print(
            f"First-station entry fallback: task_definition_id={FIRST_STATION_ENTRY_TASK_ID} started_at"
        )
        if len(selected_sequences) < len(station_keys):
            print(
                "Note: assembly attendance cache is grouped by sequence_order; stations sharing a sequence reuse the same attendance/mask."
            )

        incomplete_days = sum(1 for row in all_rows if not row.cache_complete)
        if incomplete_days > 0:
            print("")
            print(
                f"Note: {incomplete_days} day(s) in range had incomplete assembly attendance cache rows."
            )
            if USE_ONLY_COMPLETE_CACHE_DAYS:
                print("They were excluded due to USE_ONLY_COMPLETE_CACHE_DAYS=True.")

        return 0
    except OperationalError:
        print(
            "Database connection failed. Check DATABASE_URL/.env and ensure Postgres is running."
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
