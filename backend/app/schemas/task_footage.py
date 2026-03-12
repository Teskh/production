from datetime import datetime

from pydantic import BaseModel


class TaskFootageSegmentSummary(BaseModel):
    segment_id: int
    file_name: str | None = None
    started_at_utc: datetime | None = None
    ended_at_utc: datetime | None = None
    overlap_started_at_utc: datetime | None = None
    overlap_ended_at_utc: datetime | None = None


class TaskFootageRow(BaseModel):
    task_instance_id: int
    scope: str | None = None
    task_definition_id: int | None = None
    task_definition_name: str | None = None
    panel_definition_id: int | None = None
    panel_code: str | None = None
    project_name: str | None = None
    house_identifier: str | None = None
    house_type_name: str | None = None
    house_sub_type_name: str | None = None
    module_number: int | None = None
    station_id: int | None = None
    station_name: str | None = None
    worker_name: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_minutes: float | None = None
    notes: str | None = None
    camera_feed_ip: str | None = None
    footage_status: str
    footage_status_label: str
    requested_duration_seconds: float | None = None
    available_duration_seconds: float | None = None
    coverage_ratio: float | None = None
    segments_count: int = 0
    first_footage_at_utc: datetime | None = None
    last_footage_at_utc: datetime | None = None


class TaskFootageListResponse(BaseModel):
    total_count: int
    rows: list[TaskFootageRow]


class TaskFootagePlaybackResponse(BaseModel):
    task_instance_id: int
    footage_status: str
    footage_status_label: str
    playback_mode: str
    video_url: str | None = None
    playback_start_seconds: float | None = None
    playback_end_seconds: float | None = None
    requested_start_utc: datetime | None = None
    requested_end_utc: datetime | None = None
    available_start_utc: datetime | None = None
    available_end_utc: datetime | None = None
    requested_duration_seconds: float | None = None
    available_duration_seconds: float | None = None
    camera_feed_ip: str | None = None
    warning: str | None = None
    segments: list[TaskFootageSegmentSummary]
