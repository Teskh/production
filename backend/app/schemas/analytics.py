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
