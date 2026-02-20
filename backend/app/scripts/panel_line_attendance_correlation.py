#!/usr/bin/env python3
"""Correlate cached attendance vs panel-line production (panels/day).

Production ground truth is calculated using station-panels-finished logic
for the station named in PRODUCTION_STATION_NAME (default: "Puente 1").
Attendance is read from cached shift_estimates rows (no recomputation).
"""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from math import sqrt
from pathlib import Path
from typing import Callable

from sqlalchemy import select
from sqlalchemy.exc import OperationalError

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.api.routes.shift_estimates import ALGORITHM_VERSION
from app.api.routes.station_panels_finished import get_station_panels_finished
from app.db.session import SessionLocal
from app.models.enums import StationRole
from app.models.shift_estimate_worker_presence import ShiftEstimateWorkerPresence
from app.models.shift_estimates import ShiftEstimate
from app.models.stations import Station


# =========================
# Hardcoded parameters
# =========================
FROM_DATE = "2025-09-05"
TO_DATE = "2025-12-17"

# Ground truth production station (panels/day).
PRODUCTION_STATION_NAME = "Puente 1"

# Stations to correlate individually vs production.
# Add/remove station names as needed.
STATIONS_TO_COMPARE = [
    "Puente 1",
]

# If True, only include days where ALL panel-station cache rows are present.
USE_ONLY_COMPLETE_CACHE_DAYS = False

# Ignore days where deduplicated total panel-line attendance is below this value.
MIN_TOTAL_LINE_ATTENDANCE = 5

# Output CSV with daily joined dataset.
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_CSV_PATH = OUTPUT_DIR / "panel_line_attendance_vs_production.csv"
OUTPUT_HTML_PATH = OUTPUT_DIR / "panel_line_attendance_vs_production.html"


@dataclass
class DayRow:
    day: date
    production_panels: int
    line_attendance: int | None
    station_attendance: dict[str, int | None]
    cache_rows: int
    cache_expected_rows: int
    cache_complete: bool


def parse_iso_date(value: str, field: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError(f"{field} must use YYYY-MM-DD format; got '{value}'") from exc


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


def pearson(x: list[float], y: list[float]) -> float | None:
    if len(x) != len(y) or len(x) < 2:
        return None
    x_mean = sum(x) / len(x)
    y_mean = sum(y) / len(y)
    x_dev = [val - x_mean for val in x]
    y_dev = [val - y_mean for val in y]
    num = sum(a * b for a, b in zip(x_dev, y_dev, strict=True))
    den_x = sum(a * a for a in x_dev)
    den_y = sum(b * b for b in y_dev)
    den = sqrt(den_x * den_y)
    if den == 0:
        return None
    return num / den


def linear_fit(x: list[float], y: list[float]) -> tuple[float, float] | None:
    """Least-squares fit for y = intercept + slope * x."""
    if len(x) != len(y) or len(x) < 2:
        return None
    x_mean = sum(x) / len(x)
    y_mean = sum(y) / len(y)
    den = sum((val - x_mean) ** 2 for val in x)
    if den == 0:
        return None
    num = sum((vx - x_mean) * (vy - y_mean) for vx, vy in zip(x, y, strict=True))
    slope = num / den
    intercept = y_mean - slope * x_mean
    return intercept, slope


def count_production_by_day(
    production_station_id: int,
    start: date,
    end: date,
) -> dict[date, int]:
    with SessionLocal() as session:
        response = get_station_panels_finished(
            station_id=production_station_id,
            from_date=start.isoformat(),
            to_date=end.isoformat(),
            db=session,
        )
    by_day: dict[date, int] = defaultdict(int)
    for item in response.panels_passed_today_list or []:
        if item.satisfied_at is None:
            continue
        by_day[item.satisfied_at.date()] += 1
    return dict(by_day)


def load_panel_stations() -> list[Station]:
    with SessionLocal() as session:
        return list(
            session.execute(
                select(Station)
                .where(Station.role == StationRole.PANELS)
                .order_by(Station.sequence_order, Station.id)
            ).scalars()
        )


def load_attendance_cache(
    start: date,
    end: date,
) -> tuple[dict[date, dict[int, int]], dict[date, int], dict[date, int], dict[date, set[int]]]:
    # Unique present workers by day/station and day/line; set-based to avoid double counting.
    present_workers_by_day_station: dict[date, dict[int, set[int]]] = defaultdict(
        lambda: defaultdict(set)
    )
    present_workers_by_day_line: dict[date, set[int]] = defaultdict(set)
    station_rows_by_day: dict[date, set[int]] = defaultdict(set)

    cache_rows_per_day: dict[date, int] = defaultdict(int)

    with SessionLocal() as session:
        estimate_rows = list(
            session.execute(
                select(ShiftEstimate).where(
                    ShiftEstimate.date >= start,
                    ShiftEstimate.date <= end,
                    ShiftEstimate.algorithm_version == ALGORITHM_VERSION,
                    ShiftEstimate.station_role == StationRole.PANELS,
                )
            ).scalars()
        )
        worker_presence_rows = list(
            session.execute(
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


def assemble_rows(
    days: list[date],
    production_by_day: dict[date, int],
    attendance_by_day_station: dict[date, dict[int, int]],
    line_attendance_by_day: dict[date, int],
    station_rows_by_day: dict[date, set[int]],
    cache_rows_per_day: dict[date, int],
    panel_station_ids: list[int],
    station_name_to_id: dict[str, int],
) -> list[DayRow]:
    expected_rows = len(panel_station_ids)
    rows: list[DayRow] = []

    for day in days:
        station_counts = attendance_by_day_station.get(day, {})
        station_rows = station_rows_by_day.get(day, set())
        cache_rows = cache_rows_per_day.get(day, 0)
        cache_complete = cache_rows == expected_rows

        line_attendance = (
            line_attendance_by_day.get(day, 0)
            if cache_complete or bool(station_rows)
            else None
        )

        per_station: dict[str, int | None] = {}
        for station_name, station_id in station_name_to_id.items():
            if cache_complete or station_id in station_rows:
                per_station[station_name] = station_counts.get(station_id, 0)
            else:
                per_station[station_name] = None

        rows.append(
            DayRow(
                day=day,
                production_panels=production_by_day.get(day, 0),
                line_attendance=line_attendance,
                station_attendance=per_station,
                cache_rows=cache_rows,
                cache_expected_rows=expected_rows,
                cache_complete=cache_complete,
            )
        )

    return rows


def correlation_for_metric(
    rows: list[DayRow],
    extractor: Callable[[DayRow], float | None],
) -> tuple[int, float | None, float | None, float | None]:
    x: list[float] = []
    y: list[float] = []
    for row in rows:
        metric = extractor(row)
        if metric is None:
            continue
        x.append(metric)
        y.append(float(row.production_panels))
    if len(x) < 2:
        return len(x), None, None, None
    r = pearson(x, y)
    fit = linear_fit(x, y)
    intercept = fit[0] if fit else None
    slope = fit[1] if fit else None
    return len(x), r, slope, intercept


def write_csv(rows: list[DayRow], station_names: list[str], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    station_headers = [f"attendance_{slugify(name)}" for name in station_names]
    station_share_headers = [f"attendance_share_{slugify(name)}" for name in station_names]
    fieldnames = [
        "date",
        "production_panels",
        "attendance_panel_line_total",
        "cache_rows",
        "cache_expected_rows",
        "cache_complete",
        *station_headers,
        *station_share_headers,
    ]
    with output_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            payload: dict[str, object] = {
                "date": row.day.isoformat(),
                "production_panels": row.production_panels,
                "attendance_panel_line_total": row.line_attendance,
                "cache_rows": row.cache_rows,
                "cache_expected_rows": row.cache_expected_rows,
                "cache_complete": row.cache_complete,
            }
            for station_name in station_names:
                station_count = row.station_attendance.get(station_name)
                payload[f"attendance_{slugify(station_name)}"] = station_count
                payload[f"attendance_share_{slugify(station_name)}"] = (
                    station_count / row.line_attendance
                    if station_count is not None and row.line_attendance not in (None, 0)
                    else None
                )
            writer.writerow(payload)


def write_html_report(rows: list[DayRow], station_names: list[str], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    chart_rows: list[dict[str, object]] = []
    for row in rows:
        stations_payload: dict[str, object] = {}
        for station_name in station_names:
            station_count = row.station_attendance.get(station_name)
            stations_payload[station_name] = {
                "count": station_count,
                "share": (
                    station_count / row.line_attendance
                    if station_count is not None and row.line_attendance not in (None, 0)
                    else None
                ),
            }

        chart_rows.append(
            {
                "date": row.day.isoformat(),
                "production_panels": row.production_panels,
                "panel_line_total": row.line_attendance,
                "stations": stations_payload,
            }
        )

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Panel Line Attendance vs Production</title>
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
    .controls {{
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }}
    select {{
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 13px;
      background: #fff;
    }}
    #timeseries {{
      width: 100%;
      min-height: 420px;
    }}
  </style>
</head>
<body>
  <div class="card">
    <h2>Panel Line Attendance vs Production</h2>
    <div class="meta">Interactive report generated by script.</div>
    <div class="meta">Rows: {len(rows)} | Date range: {rows[0].day.isoformat()} to {rows[-1].day.isoformat()}</div>
  </div>

  <div class="card">
    <h3>Time Series</h3>
    <div id="timeseries"></div>
  </div>

  <script>
    const rows = {json.dumps(chart_rows)};
    const stationNames = {json.dumps(station_names)};

    function renderTimeSeries() {{
      const x = rows.map((row) => row.date);
      const traces = [
        {{
          x,
          y: rows.map((row) => row.production_panels),
          name: "Production (panels/day)",
          mode: "lines+markers",
          line: {{ color: "#2563eb", width: 3 }},
          yaxis: "y1",
        }},
        {{
          x,
          y: rows.map((row) => row.panel_line_total),
          name: "Panel line attendance",
          mode: "lines+markers",
          line: {{ color: "#ea580c", width: 2 }},
          yaxis: "y2",
        }},
      ];

      stationNames.forEach((name) => {{
        traces.push({{
          x,
          y: rows.map((row) => row.stations[name] ? row.stations[name].count : null),
          name: `${{name}} attendance`,
          mode: "lines",
          line: {{ width: 1.5 }},
          yaxis: "y2",
          visible: "legendonly",
        }});
      }});

      Plotly.newPlot("timeseries", traces, {{
        margin: {{ t: 20, r: 70, l: 70, b: 50 }},
        xaxis: {{ title: "Date" }},
        yaxis: {{ title: "Production (panels/day)", side: "left", rangemode: "tozero" }},
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

    renderTimeSeries();
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

    try:
        panel_stations = load_panel_stations()
        panel_stations_by_name = {station.name: station for station in panel_stations}
        panel_station_ids = [station.id for station in panel_stations]
        if not panel_station_ids:
            raise RuntimeError("No panel stations found")

        if PRODUCTION_STATION_NAME not in panel_stations_by_name:
            known = ", ".join(sorted(panel_stations_by_name.keys()))
            raise RuntimeError(
                f"Production station '{PRODUCTION_STATION_NAME}' was not found. Known panel stations: {known}"
            )
        production_station_id = panel_stations_by_name[PRODUCTION_STATION_NAME].id

        missing_stations = [name for name in STATIONS_TO_COMPARE if name not in panel_stations_by_name]
        if missing_stations:
            known = ", ".join(sorted(panel_stations_by_name.keys()))
            raise RuntimeError(
                f"Stations not found in STATIONS_TO_COMPARE: {missing_stations}. "
                f"Known panel stations: {known}"
            )
        station_name_to_id = {
            name: panel_stations_by_name[name].id for name in STATIONS_TO_COMPARE
        }

        days = iter_days(start, end)
        production_by_day = count_production_by_day(production_station_id, start, end)
        (
            attendance_by_day_station,
            line_attendance_by_day,
            cache_rows_per_day,
            station_rows_by_day,
        ) = load_attendance_cache(start, end)

        all_rows = assemble_rows(
            days=days,
            production_by_day=production_by_day,
            attendance_by_day_station=attendance_by_day_station,
            line_attendance_by_day=line_attendance_by_day,
            station_rows_by_day=station_rows_by_day,
            cache_rows_per_day=cache_rows_per_day,
            panel_station_ids=panel_station_ids,
            station_name_to_id=station_name_to_id,
        )
        rows = [row for row in all_rows if row.cache_complete] if USE_ONLY_COMPLETE_CACHE_DAYS else all_rows
        rows = [
            row
            for row in rows
            if row.line_attendance is not None and row.line_attendance >= MIN_TOTAL_LINE_ATTENDANCE
        ]

        if not rows:
            print("No rows available for analysis after filters.")
            return 1

        write_csv(rows, STATIONS_TO_COMPARE, OUTPUT_CSV_PATH)
        write_html_report(rows, STATIONS_TO_COMPARE, OUTPUT_HTML_PATH)

        print("Attendance vs production analysis")
        print(f"Date range: {start.isoformat()} -> {end.isoformat()}")
        print(
            f"Production ground truth station: {PRODUCTION_STATION_NAME} (id={production_station_id})"
        )
        print(f"Rows analyzed: {len(rows)}")
        print(f"CSV: {OUTPUT_CSV_PATH}")
        print(f"HTML: {OUTPUT_HTML_PATH}")
        print(f"Min total attendance filter: >= {MIN_TOTAL_LINE_ATTENDANCE}")
        print("")
        print("Correlation summary (Y = production panels/day):")
        print("metric | n_days | pearson_r | slope | intercept")

        def fmt_metric(
            metric_name: str,
            result: tuple[int, float | None, float | None, float | None],
        ) -> str:
            n_days, corr, slope, intercept = result
            corr_text = f"{corr:.4f}" if corr is not None else "n/a"
            slope_text = f"{slope:.4f}" if slope is not None else "n/a"
            intercept_text = f"{intercept:.4f}" if intercept is not None else "n/a"
            return f"{metric_name} | {n_days} | {corr_text} | {slope_text} | {intercept_text}"

        print(
            fmt_metric(
                "panel_line_total (count)",
                correlation_for_metric(rows, lambda row: float(row.line_attendance) if row.line_attendance is not None else None),
            )
        )

        for station_name in STATIONS_TO_COMPARE:
            print(
                fmt_metric(
                    f"{station_name} (count)",
                    correlation_for_metric(
                        rows,
                        lambda row, key=station_name: (
                            float(row.station_attendance[key])
                            if row.station_attendance.get(key) is not None
                            else None
                        ),
                    ),
                )
            )
            print(
                fmt_metric(
                    f"{station_name} (share_of_line)",
                    correlation_for_metric(
                        rows,
                        lambda row, key=station_name: (
                            row.station_attendance[key] / row.line_attendance
                            if row.station_attendance.get(key) is not None
                            and row.line_attendance not in (None, 0)
                            else None
                        ),
                    ),
                )
            )

        incomplete_days = sum(1 for row in all_rows if not row.cache_complete)
        if incomplete_days > 0:
            print("")
            print(
                f"Note: {incomplete_days} day(s) in range had incomplete panel attendance cache rows."
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
