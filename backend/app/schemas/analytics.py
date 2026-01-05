from datetime import datetime

from pydantic import BaseModel


class TaskAnalysisTaskBreakdown(BaseModel):
    task_definition_id: int | None = None
    task_name: str | None = None
    duration_minutes: float | None = None
    expected_minutes: float | None = None
    completed_at: datetime | None = None
    worker_name: str | None = None


class TaskAnalysisDataPoint(BaseModel):
    plan_id: int | None = None
    house_identifier: str | None = None
    module_number: int | None = None
    task_definition_id: int | None = None
    task_name: str | None = None
    duration_minutes: float | None = None
    expected_minutes: float | None = None
    completed_at: datetime | None = None
    worker_name: str | None = None
    task_breakdown: list[TaskAnalysisTaskBreakdown] | None = None


class TaskAnalysisStats(BaseModel):
    average_duration: float | None = None


class TaskAnalysisResponse(BaseModel):
    mode: str
    data_points: list[TaskAnalysisDataPoint]
    expected_reference_minutes: float | None = None
    stats: TaskAnalysisStats | None = None


class PanelLinearMetersStationStats(BaseModel):
    station_id: int
    station_name: str | None = None
    avg_time_minutes: float | None = None
    expected_avg_minutes: float | None = None
    avg_ratio: float | None = None
    lm_per_minute: float | None = None
    sample_count: int = 0


class PanelLinearMetersRow(BaseModel):
    panel_definition_id: int
    house_type_id: int
    house_type_name: str | None = None
    module_sequence_number: int | None = None
    panel_sequence_number: int | None = None
    panel_code: str | None = None
    panel_length_m: float | None = None
    stations: dict[str, PanelLinearMetersStationStats]


class PanelLinearMetersResponse(BaseModel):
    rows: list[PanelLinearMetersRow]
    total_panels: int


class PauseSummaryReason(BaseModel):
    reason: str
    total_duration_minutes: float
    occurrence_count: int


class PauseSummaryResponse(BaseModel):
    from_date: str | None = None
    to_date: str | None = None
    total_pause_minutes: float
    pause_reasons: list[PauseSummaryReason]
