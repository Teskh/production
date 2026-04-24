from datetime import date, datetime

from pydantic import BaseModel, Field


class LineAttendanceThroughputCoverage(BaseModel):
    geovictoria_available: bool = True
    geovictoria_active_users: int = 0
    geovictoria_active_users_matched_locally: int = 0
    geovictoria_active_users_unmatched_locally: int = 0
    buk_available: bool = False
    buk_people_indexed: int = 0
    buk_people_with_cost_center: int = 0
    active_local_workers: int = 0
    active_local_geo_linked_workers: int = 0
    active_local_geo_linked_workers_matched_in_geovictoria: int = 0
    active_local_geo_linked_workers_matched_in_buk: int = 0
    active_local_geo_linked_workers_with_supervisor: int = 0
    active_local_geo_linked_workers_without_supervisor: int = 0
    active_local_geo_linked_workers_resolved_by_ceco: int = 0
    active_local_geo_linked_workers_unresolved_after_fallback: int = 0
    local_supervisors: int = 0
    local_supervisors_matched_in_geovictoria: int = 0
    supervisor_cost_center_mappings: int = 0


class LineAttendanceThroughputDay(BaseModel):
    date: date
    eligible_local_worker_count: int
    eligible_supervised_worker_count: int
    present_worker_count: int
    present_supervised_worker_count: int
    present_unassigned_worker_count: int
    productive_worker_count: int
    productive_supervised_worker_count: int
    productive_unassigned_worker_count: int
    present_productive_overlap_count: int
    task_participation_count: int
    completed_task_count: int
    completed_panel_count: int
    finished_panel_count: int = 0
    finished_panel_area_m2: float = 0
    finished_panel_linear_meters: float = 0
    finished_module_count: int = 0


class LineAttendanceThroughputSupervisorSummary(BaseModel):
    bucket: str
    supervisor_id: int | None = None
    supervisor_name: str
    linked_worker_count: int
    present_worker_days: int
    productive_worker_days: int
    present_productive_overlap_days: int
    unique_present_worker_count: int
    unique_productive_worker_count: int
    task_participation_count: int
    panel_touch_count: int


class LineAttendanceThroughputSupervisorDay(BaseModel):
    date: date
    bucket: str
    supervisor_id: int | None = None
    supervisor_name: str
    linked_worker_count: int
    present_worker_count: int
    productive_worker_count: int
    present_productive_overlap_count: int
    task_participation_count: int
    panel_touch_count: int


class LineAttendanceThroughputSupervisorOption(BaseModel):
    id: int
    name: str


class LineAttendanceThroughputCostCenterSummary(BaseModel):
    cost_center_code: str
    cost_center_name: str | None = None
    buk_people_count: int = 0
    matched_local_worker_count: int = 0
    direct_supervisor_worker_count: int = 0
    fallback_candidate_worker_count: int = 0


class LineAttendanceThroughputCostCenterDay(BaseModel):
    date: date
    cost_center_code: str
    present_people_count: int = 0
    total_people_count: int = 0


class LineAttendanceThroughputCostCenterPerson(BaseModel):
    identifier: str
    person_name: str | None = None
    cost_center_code: str
    cost_center_name: str | None = None


class LineAttendanceThroughputPersonShiftDay(BaseModel):
    date: date
    identifier: str
    person_name: str | None = None
    cost_center_code: str
    cost_center_name: str | None = None
    present: bool = False
    first_entry: datetime | None = None
    last_exit: datetime | None = None


class LineAttendanceThroughputWorkerAssignment(BaseModel):
    worker_id: int
    worker_name: str
    geovictoria_identifier: str | None = None
    direct_supervisor_id: int | None = None
    buk_matched: bool = False
    buk_cost_center_code: str | None = None
    buk_cost_center_name: str | None = None


class LineAttendanceThroughputWorkerDay(BaseModel):
    date: date
    worker_id: int
    present: bool = False
    productive: bool = False
    task_participation_count: int = 0
    panel_touch_ids: list[int] = Field(default_factory=list)


class LineAttendanceThroughputAttendanceResponse(BaseModel):
    from_date: date
    to_date: date
    generated_at: datetime
    requested_cost_center_codes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    buk_cost_center_days: list[LineAttendanceThroughputCostCenterDay] = Field(
        default_factory=list
    )
    buk_people: list[LineAttendanceThroughputCostCenterPerson] = Field(default_factory=list)
    buk_person_shift_days: list[LineAttendanceThroughputPersonShiftDay] = Field(
        default_factory=list
    )


class LineAttendanceThroughputResponse(BaseModel):
    from_date: date
    to_date: date
    generated_at: datetime
    ceco_mapping_enabled: bool = False
    coverage: LineAttendanceThroughputCoverage
    warnings: list[str] = Field(default_factory=list)
    days: list[LineAttendanceThroughputDay] = Field(default_factory=list)
    supervisor_summaries: list[LineAttendanceThroughputSupervisorSummary] = Field(
        default_factory=list
    )
    supervisor_days: list[LineAttendanceThroughputSupervisorDay] = Field(
        default_factory=list
    )
    supervisors: list[LineAttendanceThroughputSupervisorOption] = Field(default_factory=list)
    buk_cost_centers: list[LineAttendanceThroughputCostCenterSummary] = Field(
        default_factory=list
    )
    buk_cost_center_days: list[LineAttendanceThroughputCostCenterDay] = Field(
        default_factory=list
    )
    worker_assignments: list[LineAttendanceThroughputWorkerAssignment] = Field(
        default_factory=list
    )
    worker_days: list[LineAttendanceThroughputWorkerDay] = Field(default_factory=list)
