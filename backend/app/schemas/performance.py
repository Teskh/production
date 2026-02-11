from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class PerformanceEventInput(BaseModel):
    type: Literal["api_request", "page_load"]
    duration_ms: float = Field(ge=0, le=120000)
    page_path: str | None = Field(default=None, max_length=255)
    api_path: str | None = Field(default=None, max_length=255)
    method: str | None = Field(default=None, max_length=12)
    server_duration_ms: float | None = Field(default=None, ge=0, le=120000)
    status_code: int | None = Field(default=None, ge=100, le=599)
    ok: bool | None = None
    request_id: str | None = Field(default=None, max_length=64)
    device_id: str | None = Field(default=None, max_length=64)
    device_name: str | None = Field(default=None, max_length=120)
    app_version: str | None = Field(default=None, max_length=64)
    session_id: str | None = Field(default=None, max_length=64)
    sampled: bool | None = True
    recorded_at: datetime | None = None


class PerformanceIngestRequest(BaseModel):
    events: list[PerformanceEventInput] = Field(default_factory=list, max_length=200)


class PerformanceIngestResponse(BaseModel):
    accepted: int
    dropped: int


class PerformanceMetricRow(BaseModel):
    key: str
    count: int
    error_count: int
    avg_ms: float | None = None
    p50_ms: float | None = None
    p95_ms: float | None = None
    server_p50_ms: float | None = None
    server_p95_ms: float | None = None


class PerformanceDeviceRow(BaseModel):
    device_id: str
    device_name: str | None = None
    count: int
    p95_ms: float | None = None


class PerformanceSummaryResponse(BaseModel):
    from_utc: datetime
    to_utc: datetime
    total_events: int
    truncated: bool = False
    api_requests: list[PerformanceMetricRow]
    page_loads: list[PerformanceMetricRow]
    devices: list[PerformanceDeviceRow]
