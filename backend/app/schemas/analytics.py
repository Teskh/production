from datetime import datetime

from pydantic import BaseModel


class TaskAnalysisTaskBreakdown(BaseModel):
    task_definition_id: int | None = None
    task_name: str | None = None
    duration_minutes: float | None = None
    expected_minutes: float | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    worker_name: str | None = None
    pause_minutes: float | None = None
    pauses: list["TaskAnalysisTaskPause"] | None = None


class TaskAnalysisTaskPause(BaseModel):
    paused_at: datetime | None = None
    resumed_at: datetime | None = None
    duration_minutes: float | None = None
    reason: str | None = None


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


class PanelTaskHistoryPause(BaseModel):
    paused_at: datetime | None = None
    resumed_at: datetime | None = None
    duration_seconds: float | None = None
    reason: str | None = None


class PanelTaskHistoryRow(BaseModel):
    task_instance_id: int
    task_definition_id: int | None = None
    task_definition_name: str | None = None
    panel_definition_id: int | None = None
    panel_code: str | None = None
    house_type_id: int | None = None
    house_type_name: str | None = None
    house_sub_type_name: str | None = None
    house_identifier: str | None = None
    module_number: int | None = None
    station_id: int | None = None
    station_name: str | None = None
    worker_name: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_minutes: float | None = None
    expected_minutes: float | None = None
    notes: str | None = None
    pauses: list[PanelTaskHistoryPause] | None = None


class TaskHistoryRow(BaseModel):
    task_instance_id: int
    scope: str | None = None
    task_definition_id: int | None = None
    task_definition_name: str | None = None
    panel_definition_id: int | None = None
    panel_code: str | None = None
    house_type_id: int | None = None
    house_type_name: str | None = None
    house_sub_type_name: str | None = None
    house_identifier: str | None = None
    project_name: str | None = None
    module_number: int | None = None
    station_id: int | None = None
    station_name: str | None = None
    worker_name: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_minutes: float | None = None
    expected_minutes: float | None = None
    notes: str | None = None
    pauses: list[PanelTaskHistoryPause] | None = None


class StationPanelsFinishedWorkerEntry(BaseModel):
    worker_id: int | None = None
    worker_name: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    notes: str | None = None
    pauses: list[PanelTaskHistoryPause] | None = None


class StationPanelsFinishedTask(BaseModel):
    task_definition_id: int | None = None
    task_name: str | None = None
    expected_minutes: float | None = None
    actual_minutes: float | None = None
    satisfied_at: datetime | None = None
    worker_entries: list[StationPanelsFinishedWorkerEntry] | None = None


class StationPanelsFinishedPanelSummary(BaseModel):
    plan_id: int | None = None
    panel_definition_id: int | None = None
    panel_code: str | None = None
    house_identifier: str | None = None
    module_number: int | None = None
    panel_area: float | None = None
    satisfied_at: datetime | None = None


class StationPanelsFinishedPanel(BaseModel):
    plan_id: int | None = None
    panel_definition_id: int | None = None
    panel_code: str | None = None
    panel_area: float | None = None
    available_at: datetime | None = None
    station_started_at: datetime | None = None
    station_finished_at: datetime | None = None
    finished_at: datetime | None = None
    expected_minutes: float | None = None
    actual_minutes: float | None = None
    paused_minutes: float | None = None
    pauses: list[PanelTaskHistoryPause] | None = None
    tasks: list[StationPanelsFinishedTask] | None = None
    house_identifier: str | None = None
    module_number: int | None = None
    project_name: str | None = None


class StationPanelsFinishedModule(BaseModel):
    module_number: int | None = None
    panels: list[StationPanelsFinishedPanel]


class StationPanelsFinishedHouse(BaseModel):
    house_identifier: str | None = None
    house_type_id: int | None = None
    house_type_name: str | None = None
    house_sub_type_name: str | None = None
    project_name: str | None = None
    modules: list[StationPanelsFinishedModule]


class StationPanelsFinishedResponse(BaseModel):
    total_panels_finished: int
    houses: list[StationPanelsFinishedHouse]
    panels_passed_today_count: int | None = None
    panels_passed_today_list: list[StationPanelsFinishedPanelSummary] | None = None
    panels_passed_today_area_sum: float | None = None
