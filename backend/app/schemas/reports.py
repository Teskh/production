from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class StationReportPoint(BaseModel):
    key: str
    productive_ratio: float | None = None
    expected_ratio: float | None = None


class WorkerReportMetric(BaseModel):
    label: str
    productive_ratio: float | None = None
    expected_ratio: float | None = None
    days_with_data: int = Field(default=0, ge=0)
    days_total: int = Field(default=0, ge=0)


class StationReportSection(BaseModel):
    key: str | None = None
    label: str
    workers_total: int = Field(default=0, ge=0)
    workers_with_data: int = Field(default=0, ge=0)
    average_productive: float | None = None
    average_expected: float | None = None
    rows: list[StationReportPoint] = Field(default_factory=list)
    workers: list[WorkerReportMetric] = Field(default_factory=list)


class StationAssistancePdfRequest(BaseModel):
    report_days: int = Field(ge=1, le=365)
    from_date: str
    to_date: str
    include_workers: bool = False
    generated_at: datetime | None = None
    global_productive: float | None = None
    global_expected: float | None = None
    total_workers: int = Field(default=0, ge=0)
    stations: list[StationReportSection] = Field(default_factory=list)
