from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import StationRole


class ShiftEstimateRead(BaseModel):
    date: date
    group_key: str
    station_role: StationRole
    station_id: int | None = None
    sequence_order: int | None = None
    assigned_count: int
    present_count: int
    estimated_start: datetime | None = None
    estimated_end: datetime | None = None
    last_exit: datetime | None = None
    shift_minutes: int | None = None
    status: str
    computed_at: datetime
    algorithm_version: int
    present_worker_ids: list[int] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class ShiftEstimateWorkerPresenceRead(BaseModel):
    date: date
    group_key: str
    worker_id: int
    station_role: StationRole
    station_id: int | None = None
    sequence_order: int | None = None
    is_assigned: bool
    is_present: bool
    first_entry: datetime | None = None
    last_exit: datetime | None = None
    attendance_status: str
    computed_at: datetime
    algorithm_version: int

    model_config = ConfigDict(from_attributes=True)


class ShiftEstimateDay(BaseModel):
    date: date
    status: str
    expected_count: int
    cached_count: int
    estimates: list[ShiftEstimateRead]
    worker_presence: list[ShiftEstimateWorkerPresenceRead] = Field(default_factory=list)


class ShiftEstimateCoverageDay(BaseModel):
    date: date
    status: str
    expected_count: int
    cached_count: int


class ShiftEstimateComputeRequest(BaseModel):
    from_date: date
    to_date: date


class ShiftEstimateComputeResponse(BaseModel):
    from_date: date
    to_date: date
    processed_days: int
    computed_count: int
    computed_worker_rows: int
    skipped_existing: int
    excluded_days: int
    worker_errors: int
