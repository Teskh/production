from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

from app.models.enums import StationLineType, StationRole


class LineAttendanceStationOption(BaseModel):
    id: int
    name: str
    role: StationRole
    line_type: StationLineType | None = None
    sequence_order: int | None = None


class PanelStationAttendancePoint(BaseModel):
    station_id: int
    station_name: str
    attendance: int | None = None
    attendance_share: float | None = None


class PanelAttendanceThroughputDay(BaseModel):
    date: date
    production_panels: int
    line_attendance: int
    throughput_per_attended_worker: float | None = None
    cache_rows: int
    cache_expected_rows: int
    station_attendance: list[PanelStationAttendancePoint]


class PanelAttendanceThroughputResponse(BaseModel):
    mode: Literal["panel"] = "panel"
    requested_from_date: date
    requested_to_date: date
    effective_to_date: date
    production_station_id: int
    production_station_name: str
    compared_station_ids: list[int]
    min_total_line_attendance: int
    dropped_incomplete_days: int
    dropped_low_attendance_days: int
    available_stations: list[LineAttendanceStationOption]
    rows: list[PanelAttendanceThroughputDay]


class ModuleStationMetricPoint(BaseModel):
    station_id: int
    station_name: str
    line_type: StationLineType | None = None
    sequence_order: int
    attendance: int | None = None
    move_count: int
    avg_active_move_hours: float | None = None
    movements_per_workday: float | None = None


class ModuleAttendanceThroughputDay(BaseModel):
    date: date
    line_attendance: int
    line_avg_active_move_hours: float | None = None
    line_movements_per_workday: float | None = None
    throughput_per_attended_worker: float | None = None
    cache_rows: int
    cache_expected_rows: int
    station_metrics: list[ModuleStationMetricPoint]


class ModuleAttendanceThroughputResponse(BaseModel):
    mode: Literal["module"] = "module"
    requested_from_date: date
    requested_to_date: date
    effective_to_date: date
    line_type: StationLineType | None = None
    selected_station_ids: list[int]
    min_total_line_attendance: int
    min_moves_per_station_day: int
    workday_hours: float
    movement_history_lookback_days: int
    dropped_incomplete_days: int
    dropped_low_attendance_days: int
    dropped_no_movement_days: int
    available_stations: list[LineAttendanceStationOption]
    rows: list[ModuleAttendanceThroughputDay]


class ModuleMovementIntervalDetail(BaseModel):
    station_id: int
    station_name: str
    line_type: StationLineType | None = None
    sequence_order: int
    project_name: str | None = None
    house_identifier: str | None = None
    tramo_start_task_name: str
    tramo_start_task_started_at: datetime
    tramo_end_task_name: str
    tramo_end_task_started_at: datetime
    interval_start_at: datetime
    interval_end_at: datetime
    elapsed_minutes: float
    active_minutes: float


class ModuleMovementDayStationSummary(BaseModel):
    station_id: int
    station_name: str
    line_type: StationLineType | None = None
    sequence_order: int
    attendance: int | None = None
    move_count: int
    avg_active_move_hours: float | None = None
    movements_per_workday: float | None = None
    total_active_minutes: float
    qualifies_for_average: bool


class ModuleMovementDayDetailResponse(BaseModel):
    mode: Literal["module-detail"] = "module-detail"
    date: date
    line_type: StationLineType | None = None
    sequence_order: int | None = None
    station_id: int | None = None
    selected_station_ids: list[int]
    selected_sequence_orders: list[int]
    min_total_line_attendance: int
    min_moves_per_station_day: int
    workday_hours: float
    movement_history_lookback_days: int
    cache_rows: int
    cache_expected_rows: int
    cache_complete: bool
    line_attendance: int | None = None
    line_avg_active_move_hours: float | None = None
    line_movements_per_workday: float | None = None
    throughput_per_attended_worker: float | None = None
    station_summaries: list[ModuleMovementDayStationSummary]
    movement_intervals: list[ModuleMovementIntervalDetail]
