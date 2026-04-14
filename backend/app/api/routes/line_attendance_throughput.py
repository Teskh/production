from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routes.geovictoria import _fetch_users, _is_active
from app.api.routes.shift_estimates import ALGORITHM_VERSION
from app.models.enums import TaskStatus
from app.models.shift_estimate_worker_presence import ShiftEstimateWorkerPresence
from app.models.tasks import TaskInstance, TaskParticipation
from app.models.workers import Worker, WorkerSupervisor
from app.schemas.line_attendance_throughput import (
    LineAttendanceThroughputCostCenterSummary,
    LineAttendanceThroughputCoverage,
    LineAttendanceThroughputDay,
    LineAttendanceThroughputResponse,
    LineAttendanceThroughputSupervisorDay,
    LineAttendanceThroughputSupervisorOption,
    LineAttendanceThroughputSupervisorSummary,
    LineAttendanceThroughputWorkerAssignment,
    LineAttendanceThroughputWorkerDay,
)
from app.services.buk_people import (
    BukPerson,
    build_buk_people_index,
    fetch_buk_people,
    normalize_person_identifier,
)

router = APIRouter()

DEFAULT_RANGE_DAYS = 14
MAX_RANGE_DAYS = 93
UNASSIGNED_BUCKET = "unassigned"
SUPERVISOR_BUCKET = "supervisor"


def _parse_date_input(value: str | None, field: str) -> date | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {field} value",
        ) from exc


def _resolve_range(
    from_date: str | None,
    to_date: str | None,
) -> tuple[date, date]:
    parsed_from = _parse_date_input(from_date, "from_date")
    parsed_to = _parse_date_input(to_date, "to_date")

    if parsed_from is None and parsed_to is None:
        end_date = datetime.now().date() - timedelta(days=1)
        start_date = end_date - timedelta(days=DEFAULT_RANGE_DAYS - 1)
        return start_date, end_date

    if parsed_from is None or parsed_to is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="from_date and to_date must both be provided",
        )

    if parsed_from > parsed_to:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="from_date must be before to_date",
        )

    range_days = (parsed_to - parsed_from).days + 1
    if range_days > MAX_RANGE_DAYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Range cannot exceed {MAX_RANGE_DAYS} days",
        )
    return parsed_from, parsed_to


def _iter_dates(start_date: date, end_date: date) -> list[date]:
    span = (end_date - start_date).days
    return [start_date + timedelta(days=offset) for offset in range(span + 1)]


def _normalize_identifier(value: object | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _format_supervisor_name(supervisor: WorkerSupervisor | None, supervisor_id: int | None) -> str:
    if supervisor is None:
        if supervisor_id is None:
            return "Sin supervisor"
        return f"Supervisor #{supervisor_id}"
    full_name = f"{supervisor.first_name} {supervisor.last_name}".strip()
    return full_name or f"Supervisor #{supervisor.id}"


@router.get("/summary", response_model=LineAttendanceThroughputResponse)
def get_line_attendance_throughput_summary(
    from_date: str | None = None,
    to_date: str | None = None,
    db: Session = Depends(get_db),
) -> LineAttendanceThroughputResponse:
    start_date, end_date = _resolve_range(from_date, to_date)
    start_dt = datetime.combine(start_date, time.min)
    end_dt = datetime.combine(end_date, time.max)

    workers = list(db.execute(select(Worker).order_by(Worker.id)).scalars())
    supervisors = list(
        db.execute(
            select(WorkerSupervisor).order_by(
                WorkerSupervisor.last_name, WorkerSupervisor.first_name
            )
        ).scalars()
    )
    supervisors_by_id = {supervisor.id: supervisor for supervisor in supervisors}

    active_workers = [worker for worker in workers if worker.active is not False]
    eligible_workers = [
        worker
        for worker in active_workers
        if _normalize_identifier(worker.geovictoria_identifier)
        or _normalize_identifier(worker.geovictoria_id)
    ]
    eligible_worker_ids = {worker.id for worker in eligible_workers}
    eligible_supervised_worker_ids = {
        worker.id for worker in eligible_workers if worker.supervisor_id is not None
    }

    warnings = ["geovictoria_roster_unfiltered"]
    geovictoria_available = True
    geovictoria_active_users = 0
    geovictoria_active_users_matched_locally = 0
    geovictoria_active_users_unmatched_locally = 0
    active_local_geo_linked_workers_matched_in_geovictoria = 0
    local_supervisors_matched_in_geovictoria = 0
    buk_available = False
    buk_people_indexed = 0
    buk_people_with_cost_center = 0
    active_local_geo_linked_workers_matched_in_buk = 0
    active_local_geo_linked_workers_resolved_by_ceco = 0

    worker_geo_lookup: dict[str, int] = {}
    for worker in eligible_workers:
        for value in (worker.geovictoria_id, worker.geovictoria_identifier):
            normalized = _normalize_identifier(value)
            if normalized:
                worker_geo_lookup[normalized] = worker.id

    supervisor_geo_lookup: dict[str, int] = {}
    for supervisor in supervisors:
        for value in (supervisor.geovictoria_id, supervisor.geovictoria_identifier):
            normalized = _normalize_identifier(value)
            if normalized:
                supervisor_geo_lookup[normalized] = supervisor.id

    matched_worker_ids: set[int] = set()
    matched_supervisor_ids: set[int] = set()
    try:
        matched_geo_user_count = 0
        for user in _fetch_users():
            if not _is_active(user):
                continue
            geovictoria_active_users += 1
            match_found = False
            for value in (user.geovictoria_id, user.identifier):
                normalized = _normalize_identifier(value)
                if not normalized:
                    continue
                worker_id = worker_geo_lookup.get(normalized)
                if worker_id is not None:
                    matched_worker_ids.add(worker_id)
                    match_found = True
                supervisor_id = supervisor_geo_lookup.get(normalized)
                if supervisor_id is not None:
                    matched_supervisor_ids.add(supervisor_id)
                    match_found = True
            if match_found:
                matched_geo_user_count += 1

        geovictoria_active_users_matched_locally = matched_geo_user_count
        geovictoria_active_users_unmatched_locally = max(
            geovictoria_active_users - matched_geo_user_count,
            0,
        )
        active_local_geo_linked_workers_matched_in_geovictoria = len(matched_worker_ids)
        local_supervisors_matched_in_geovictoria = len(matched_supervisor_ids)
    except HTTPException:
        geovictoria_available = False
        warnings.append("geovictoria_roster_unavailable")

    buk_people_by_identifier: dict[str, BukPerson] = {}
    worker_cost_center_by_id: dict[int, str] = {}
    worker_cost_center_name_by_id: dict[int, str] = {}
    workers_matched_in_buk: set[int] = set()
    try:
        buk_people = fetch_buk_people()
        buk_people_by_identifier = build_buk_people_index(buk_people)
        buk_available = True
        buk_people_indexed = len(buk_people_by_identifier)
        buk_people_with_cost_center = sum(
            1 for person in buk_people if person.cost_center_code
        )
    except RuntimeError:
        warnings.append("buk_unavailable")

    worker_bucket_by_id: dict[int, int | None] = {}
    linked_worker_ids_by_bucket: dict[int | None, set[int]] = defaultdict(set)
    cost_center_worker_ids: dict[str, set[int]] = defaultdict(set)
    for worker in eligible_workers:
        direct_supervisor_id = worker.supervisor_id
        buk_person: BukPerson | None = None

        if buk_people_by_identifier:
            for value in (worker.geovictoria_identifier, worker.geovictoria_id):
                normalized_identifier = normalize_person_identifier(value)
                if not normalized_identifier:
                    continue
                buk_person = buk_people_by_identifier.get(normalized_identifier)
                if buk_person is None:
                    continue
                active_local_geo_linked_workers_matched_in_buk += 1
                workers_matched_in_buk.add(worker.id)
                if buk_person.cost_center_code:
                    worker_cost_center_by_id[worker.id] = buk_person.cost_center_code
                    if buk_person.cost_center_name:
                        worker_cost_center_name_by_id[worker.id] = buk_person.cost_center_name
                    cost_center_worker_ids[buk_person.cost_center_code].add(worker.id)
                break

        worker_bucket_by_id[worker.id] = direct_supervisor_id
        linked_worker_ids_by_bucket[direct_supervisor_id].add(worker.id)

    unresolved_worker_ids = {
        worker.id for worker in eligible_workers if worker_bucket_by_id.get(worker.id) is None
    }

    present_workers_by_day: dict[date, set[int]] = defaultdict(set)
    present_workers_by_day_bucket: dict[date, dict[int | None, set[int]]] = defaultdict(
        lambda: defaultdict(set)
    )
    productive_workers_by_day: dict[date, set[int]] = defaultdict(set)
    productive_workers_by_day_bucket: dict[date, dict[int | None, set[int]]] = defaultdict(
        lambda: defaultdict(set)
    )
    task_participations_by_day: dict[date, int] = defaultdict(int)
    task_participations_by_day_bucket: dict[date, dict[int | None, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    completed_tasks_by_day: dict[date, set[int]] = defaultdict(set)
    completed_panels_by_day: dict[date, set[int]] = defaultdict(set)
    panel_touches_by_day_bucket: dict[date, dict[int | None, set[int]]] = defaultdict(
        lambda: defaultdict(set)
    )
    task_participations_by_day_worker: dict[date, dict[int, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    panel_touches_by_day_worker: dict[date, dict[int, set[int]]] = defaultdict(
        lambda: defaultdict(set)
    )

    if eligible_worker_ids:
        presence_rows = db.execute(
            select(ShiftEstimateWorkerPresence.date, ShiftEstimateWorkerPresence.worker_id)
            .where(ShiftEstimateWorkerPresence.date >= start_date)
            .where(ShiftEstimateWorkerPresence.date <= end_date)
            .where(ShiftEstimateWorkerPresence.algorithm_version == ALGORITHM_VERSION)
            .where(ShiftEstimateWorkerPresence.is_present.is_(True))
            .where(ShiftEstimateWorkerPresence.worker_id.in_(sorted(eligible_worker_ids)))
        ).all()
        for row_date, worker_id in presence_rows:
            present_workers_by_day[row_date].add(worker_id)
            bucket = worker_bucket_by_id.get(worker_id)
            present_workers_by_day_bucket[row_date][bucket].add(worker_id)

        participation_rows = db.execute(
            select(
                TaskParticipation.id,
                TaskParticipation.worker_id,
                TaskInstance.completed_at,
                TaskInstance.panel_unit_id,
            )
            .join(TaskInstance, TaskParticipation.task_instance_id == TaskInstance.id)
            .where(TaskInstance.status == TaskStatus.COMPLETED)
            .where(TaskInstance.completed_at.is_not(None))
            .where(TaskInstance.completed_at >= start_dt)
            .where(TaskInstance.completed_at <= end_dt)
            .where(TaskParticipation.worker_id.in_(sorted(eligible_worker_ids)))
        ).all()
        for participation_id, worker_id, completed_at, panel_unit_id in participation_rows:
            if completed_at is None:
                continue
            row_date = completed_at.date()
            productive_workers_by_day[row_date].add(worker_id)
            task_participations_by_day[row_date] += 1
            bucket = worker_bucket_by_id.get(worker_id)
            productive_workers_by_day_bucket[row_date][bucket].add(worker_id)
            task_participations_by_day_bucket[row_date][bucket] += 1
            task_participations_by_day_worker[row_date][worker_id] += 1
            if panel_unit_id is not None:
                panel_touches_by_day_bucket[row_date][bucket].add(panel_unit_id)
                panel_touches_by_day_worker[row_date][worker_id].add(panel_unit_id)

    completion_rows = db.execute(
        select(TaskInstance.id, TaskInstance.completed_at, TaskInstance.panel_unit_id)
        .where(TaskInstance.status == TaskStatus.COMPLETED)
        .where(TaskInstance.completed_at.is_not(None))
        .where(TaskInstance.completed_at >= start_dt)
        .where(TaskInstance.completed_at <= end_dt)
    ).all()
    for task_id, completed_at, panel_unit_id in completion_rows:
        if completed_at is None:
            continue
        row_date = completed_at.date()
        completed_tasks_by_day[row_date].add(task_id)
        if panel_unit_id is not None:
            completed_panels_by_day[row_date].add(panel_unit_id)

    ordered_bucket_ids = [supervisor.id for supervisor in supervisors]
    has_unassigned_bucket = (
        bool(linked_worker_ids_by_bucket.get(None))
        or any(None in buckets for buckets in present_workers_by_day_bucket.values())
        or any(None in buckets for buckets in productive_workers_by_day_bucket.values())
        or any(None in buckets for buckets in task_participations_by_day_bucket.values())
    )
    if has_unassigned_bucket:
        ordered_bucket_ids.append(None)

    coverage = LineAttendanceThroughputCoverage(
        geovictoria_available=geovictoria_available,
        geovictoria_active_users=geovictoria_active_users,
        geovictoria_active_users_matched_locally=geovictoria_active_users_matched_locally,
        geovictoria_active_users_unmatched_locally=geovictoria_active_users_unmatched_locally,
        buk_available=buk_available,
        buk_people_indexed=buk_people_indexed,
        buk_people_with_cost_center=buk_people_with_cost_center,
        active_local_workers=len(active_workers),
        active_local_geo_linked_workers=len(eligible_workers),
        active_local_geo_linked_workers_matched_in_geovictoria=active_local_geo_linked_workers_matched_in_geovictoria,
        active_local_geo_linked_workers_matched_in_buk=active_local_geo_linked_workers_matched_in_buk,
        active_local_geo_linked_workers_with_supervisor=len(eligible_supervised_worker_ids),
        active_local_geo_linked_workers_without_supervisor=max(
            len(eligible_workers) - len(eligible_supervised_worker_ids),
            0,
        ),
        active_local_geo_linked_workers_resolved_by_ceco=active_local_geo_linked_workers_resolved_by_ceco,
        active_local_geo_linked_workers_unresolved_after_fallback=len(unresolved_worker_ids),
        local_supervisors=len(supervisors),
        local_supervisors_matched_in_geovictoria=local_supervisors_matched_in_geovictoria,
        supervisor_cost_center_mappings=0,
    )

    response_days: list[LineAttendanceThroughputDay] = []
    response_supervisor_days: list[LineAttendanceThroughputSupervisorDay] = []
    response_worker_days: list[LineAttendanceThroughputWorkerDay] = []
    ordered_dates = _iter_dates(start_date, end_date)
    for current_date in ordered_dates:
        present_workers = present_workers_by_day.get(current_date, set())
        productive_workers = productive_workers_by_day.get(current_date, set())
        supervised_present_workers = {
            worker_id
            for worker_id in present_workers
            if worker_bucket_by_id.get(worker_id) is not None
        }
        supervised_productive_workers = {
            worker_id
            for worker_id in productive_workers
            if worker_bucket_by_id.get(worker_id) is not None
        }

        response_days.append(
            LineAttendanceThroughputDay(
                date=current_date,
                eligible_local_worker_count=len(eligible_workers),
                eligible_supervised_worker_count=len(eligible_supervised_worker_ids),
                present_worker_count=len(present_workers),
                present_supervised_worker_count=len(supervised_present_workers),
                present_unassigned_worker_count=max(
                    len(present_workers) - len(supervised_present_workers),
                    0,
                ),
                productive_worker_count=len(productive_workers),
                productive_supervised_worker_count=len(supervised_productive_workers),
                productive_unassigned_worker_count=max(
                    len(productive_workers) - len(supervised_productive_workers),
                    0,
                ),
                present_productive_overlap_count=len(present_workers & productive_workers),
                task_participation_count=task_participations_by_day.get(current_date, 0),
                completed_task_count=len(completed_tasks_by_day.get(current_date, set())),
                completed_panel_count=len(completed_panels_by_day.get(current_date, set())),
                )
            )

        for worker in eligible_workers:
            response_worker_days.append(
                LineAttendanceThroughputWorkerDay(
                    date=current_date,
                    worker_id=worker.id,
                    present=worker.id in present_workers,
                    productive=worker.id in productive_workers,
                    task_participation_count=task_participations_by_day_worker.get(
                        current_date, {}
                    ).get(worker.id, 0),
                    panel_touch_ids=sorted(
                        panel_touches_by_day_worker.get(current_date, {}).get(worker.id, set())
                    ),
                )
            )

        for bucket_id in ordered_bucket_ids:
            supervisor = supervisors_by_id.get(bucket_id) if bucket_id is not None else None
            response_supervisor_days.append(
                LineAttendanceThroughputSupervisorDay(
                    date=current_date,
                    bucket=SUPERVISOR_BUCKET if bucket_id is not None else UNASSIGNED_BUCKET,
                    supervisor_id=bucket_id,
                    supervisor_name=_format_supervisor_name(supervisor, bucket_id),
                    linked_worker_count=len(linked_worker_ids_by_bucket.get(bucket_id, set())),
                    present_worker_count=len(
                        present_workers_by_day_bucket.get(current_date, {}).get(bucket_id, set())
                    ),
                    productive_worker_count=len(
                        productive_workers_by_day_bucket.get(current_date, {}).get(bucket_id, set())
                    ),
                    present_productive_overlap_count=len(
                        present_workers_by_day_bucket.get(current_date, {}).get(bucket_id, set())
                        & productive_workers_by_day_bucket.get(current_date, {}).get(bucket_id, set())
                    ),
                    task_participation_count=task_participations_by_day_bucket.get(
                        current_date, {}
                    ).get(bucket_id, 0),
                    panel_touch_count=len(
                        panel_touches_by_day_bucket.get(current_date, {}).get(bucket_id, set())
                    ),
                )
            )

    response_supervisor_summaries: list[LineAttendanceThroughputSupervisorSummary] = []
    for bucket_id in ordered_bucket_ids:
        supervisor = supervisors_by_id.get(bucket_id) if bucket_id is not None else None
        unique_present_workers: set[int] = set()
        unique_productive_workers: set[int] = set()
        present_worker_days = 0
        productive_worker_days = 0
        overlap_worker_days = 0
        task_participation_count = 0
        panel_touch_ids: set[int] = set()

        for current_date in ordered_dates:
            present_workers = present_workers_by_day_bucket.get(current_date, {}).get(
                bucket_id, set()
            )
            productive_workers = productive_workers_by_day_bucket.get(current_date, {}).get(
                bucket_id, set()
            )
            unique_present_workers.update(present_workers)
            unique_productive_workers.update(productive_workers)
            present_worker_days += len(present_workers)
            productive_worker_days += len(productive_workers)
            overlap_worker_days += len(present_workers & productive_workers)
            task_participation_count += task_participations_by_day_bucket.get(
                current_date, {}
            ).get(bucket_id, 0)
            panel_touch_ids.update(
                panel_touches_by_day_bucket.get(current_date, {}).get(bucket_id, set())
            )

        response_supervisor_summaries.append(
            LineAttendanceThroughputSupervisorSummary(
                bucket=SUPERVISOR_BUCKET if bucket_id is not None else UNASSIGNED_BUCKET,
                supervisor_id=bucket_id,
                supervisor_name=_format_supervisor_name(supervisor, bucket_id),
                linked_worker_count=len(linked_worker_ids_by_bucket.get(bucket_id, set())),
                present_worker_days=present_worker_days,
                productive_worker_days=productive_worker_days,
                present_productive_overlap_days=overlap_worker_days,
                unique_present_worker_count=len(unique_present_workers),
                unique_productive_worker_count=len(unique_productive_workers),
                task_participation_count=task_participation_count,
                panel_touch_count=len(panel_touch_ids),
            )
        )

    response_supervisor_summaries.sort(
        key=lambda item: (
            item.bucket == UNASSIGNED_BUCKET,
            -item.productive_worker_days,
            item.supervisor_name.lower(),
        )
    )

    response_supervisors = [
        LineAttendanceThroughputSupervisorOption(
            id=supervisor.id,
            name=_format_supervisor_name(supervisor, supervisor.id),
        )
        for supervisor in supervisors
    ]
    response_buk_cost_centers = [
        LineAttendanceThroughputCostCenterSummary(
            cost_center_code=cost_center_code,
            cost_center_name=next(
                (
                    worker_cost_center_name_by_id[worker_id]
                    for worker_id in sorted(worker_ids)
                    if worker_id in worker_cost_center_name_by_id
                ),
                None,
            ),
            matched_local_worker_count=len(worker_ids),
            direct_supervisor_worker_count=sum(
                1
                for worker_id in worker_ids
                if worker_bucket_by_id.get(worker_id) is not None
            ),
            fallback_candidate_worker_count=sum(
                1
                for worker_id in worker_ids
                if worker_bucket_by_id.get(worker_id) is None
            ),
        )
        for cost_center_code, worker_ids in sorted(cost_center_worker_ids.items())
    ]
    response_worker_assignments = [
        LineAttendanceThroughputWorkerAssignment(
            worker_id=worker.id,
            worker_name=(
                f"{worker.first_name} {worker.last_name}".strip()
                or f"Trabajador #{worker.id}"
            ),
            geovictoria_identifier=_normalize_identifier(
                worker.geovictoria_identifier or worker.geovictoria_id
            ),
            direct_supervisor_id=worker.supervisor_id,
            buk_matched=worker.id in workers_matched_in_buk,
            buk_cost_center_code=worker_cost_center_by_id.get(worker.id),
            buk_cost_center_name=worker_cost_center_name_by_id.get(worker.id),
        )
        for worker in eligible_workers
    ]

    return LineAttendanceThroughputResponse(
        from_date=start_date,
        to_date=end_date,
        generated_at=datetime.utcnow(),
        ceco_mapping_enabled=False,
        coverage=coverage,
        warnings=warnings,
        days=response_days,
        supervisor_summaries=response_supervisor_summaries,
        supervisor_days=response_supervisor_days,
        supervisors=response_supervisors,
        buk_cost_centers=response_buk_cost_centers,
        worker_assignments=response_worker_assignments,
        worker_days=response_worker_days,
    )
