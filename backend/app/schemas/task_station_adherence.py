from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.models.enums import TaskScope


class TaskStationAdherenceSummary(BaseModel):
    total_rows: int
    kpi_rows: int
    matched_rows: int
    deviation_rows: int
    adherence_rate: float | None = None


class TaskStationAdherenceRow(BaseModel):
    task_instance_id: int
    completed_at: datetime
    task_definition_id: int
    task_name: str | None = None
    scope: TaskScope
    project_name: str | None = None
    house_identifier: str | None = None
    module_number: int | None = None
    panel_code: str | None = None
    actual_station_id: int
    actual_station_name: str | None = None
    completed_station_id: int | None = None
    completed_station_name: str | None = None
    planned_station_id: int | None = None
    planned_station_name: str | None = None
    planned_station_sequence: int | None = None
    resolution_code: str
    included_in_kpi: bool
    is_deviation: bool | None = None


class TaskStationAdherenceResponse(BaseModel):
    from_date: str | None = None
    to_date: str | None = None
    summary: TaskStationAdherenceSummary
    rows: list[TaskStationAdherenceRow]
