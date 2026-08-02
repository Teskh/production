from __future__ import annotations

from pydantic import BaseModel


class TaskSequenceStationShare(BaseModel):
    station_id: int
    station_name: str | None = None
    sequence_order: int | None = None
    count: int
    share: float


class TaskSequenceStat(BaseModel):
    mean: float | None = None
    median: float | None = None
    p25: float | None = None
    p75: float | None = None


class TaskSequenceTaskRow(BaseModel):
    task_definition_id: int
    task_name: str
    sample_count: int
    instance_count: int
    outlier_excluded_count: int
    rank: TaskSequenceStat
    start_fraction: TaskSequenceStat
    end_fraction: TaskSequenceStat
    duration_minutes: TaskSequenceStat
    expected_minutes: float | None = None
    order_consistency: float | None = None
    concurrency_share: float | None = None
    planned_station_sequence: int | None = None
    dominant_station_name: str | None = None
    stations: list[TaskSequenceStationShare]


class TaskSequenceSummary(BaseModel):
    unit_count: int
    units_with_order: int
    instance_count: int
    outlier_excluded_count: int
    rework_excluded_count: int
    missing_timestamp_count: int


class TaskSequenceResponse(BaseModel):
    scope: str
    house_type_id: int
    panel_definition_id: int | None = None
    module_number: int | None = None
    project_name: str | None = None
    rank_by: str
    summary: TaskSequenceSummary
    tasks: list[TaskSequenceTaskRow]


class TaskSequenceProjectOption(BaseModel):
    project_name: str
