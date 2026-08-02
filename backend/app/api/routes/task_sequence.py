from __future__ import annotations

from collections import Counter
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routes.shift_estimates import ALGORITHM_VERSION
from app.api.routes.task_analysis import (
    _build_panel_expected_map,
    _duration_minutes,
    _mask_query_bounds,
    _parse_datetime,
    _resolve_module_expected,
)
from app.models.enums import StationRole, TaskScope, TaskStatus
from app.models.house import PanelDefinition
from app.models.stations import Station
from app.models.tasks import (
    TaskApplicability,
    TaskDefinition,
    TaskExpectedDuration,
    TaskInstance,
    TaskPause,
)
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.schemas.task_sequence import (
    TaskSequenceProjectOption,
    TaskSequenceResponse,
    TaskSequenceStat,
    TaskSequenceStationShare,
    TaskSequenceSummary,
    TaskSequenceTaskRow,
)
from app.services.conditions import load_condition_context
from app.services.shift_masks import ShiftMaskResolver
from app.services.task_applicability import resolve_task_station_sequence

router = APIRouter()


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 4)
    pos = (len(ordered) - 1) * q
    lower = int(pos)
    upper = min(lower + 1, len(ordered) - 1)
    frac = pos - lower
    return round(ordered[lower] * (1 - frac) + ordered[upper] * frac, 4)


def _stat(values: list[float]) -> TaskSequenceStat:
    if not values:
        return TaskSequenceStat()
    return TaskSequenceStat(
        mean=round(sum(values) / len(values), 4),
        median=_percentile(values, 0.5),
        p25=_percentile(values, 0.25),
        p75=_percentile(values, 0.75),
    )


@router.get("/projects", response_model=list[TaskSequenceProjectOption])
def list_task_sequence_projects(
    house_type_id: int = Query(...),
    db: Session = Depends(get_db),
) -> list[TaskSequenceProjectOption]:
    names = db.execute(
        select(WorkOrder.project_name)
        .where(WorkOrder.house_type_id == house_type_id)
        .distinct()
        .order_by(WorkOrder.project_name)
    ).scalars()
    return [
        TaskSequenceProjectOption(project_name=name)
        for name in names
        if name and name.strip()
    ]


@router.get("", response_model=TaskSequenceResponse)
def get_task_sequence(
    house_type_id: int = Query(...),
    scope: TaskScope = Query(TaskScope.PANEL),
    panel_definition_id: int | None = None,
    module_number: int | None = Query(None, ge=1),
    project_name: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    min_ratio: float | None = Query(0.1, ge=0),
    max_ratio: float | None = Query(2.5, gt=0),
    include_rework: bool = Query(False),
    rank_by: str = Query("start", pattern="^(start|completion)$"),
    db: Session = Depends(get_db),
) -> TaskSequenceResponse:
    if scope == TaskScope.AUX:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Task sequence supports panel or module scope only",
        )
    if min_ratio is not None and max_ratio is not None and min_ratio >= max_ratio:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="min_ratio must be lower than max_ratio",
        )

    panel_definition: PanelDefinition | None = None
    if scope == TaskScope.PANEL:
        if panel_definition_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="panel_definition_id is required for panel scope",
            )
        panel_definition = db.get(PanelDefinition, panel_definition_id)
        if not panel_definition:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Panel definition not found",
            )
        if panel_definition.house_type_id != house_type_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="House type does not match panel definition",
            )
    elif module_number is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="module_number is required for module scope",
        )

    from_dt = _parse_datetime(from_date, "from_date")
    to_dt = _parse_datetime(to_date, "to_date")

    if scope == TaskScope.PANEL:
        stmt = (
            select(TaskInstance, TaskDefinition, PanelUnit, WorkUnit, WorkOrder)
            .join(TaskDefinition, TaskInstance.task_definition_id == TaskDefinition.id)
            .join(PanelUnit, TaskInstance.panel_unit_id == PanelUnit.id)
            .join(WorkUnit, PanelUnit.work_unit_id == WorkUnit.id)
            .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
            .where(TaskInstance.scope == TaskScope.PANEL)
            .where(TaskInstance.status == TaskStatus.COMPLETED)
            .where(TaskInstance.completed_at.is_not(None))
            .where(PanelUnit.panel_definition_id == panel_definition_id)
            .where(WorkOrder.house_type_id == house_type_id)
        )
    else:
        stmt = (
            select(TaskInstance, TaskDefinition, WorkUnit, WorkOrder)
            .join(TaskDefinition, TaskInstance.task_definition_id == TaskDefinition.id)
            .join(WorkUnit, TaskInstance.work_unit_id == WorkUnit.id)
            .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
            .where(TaskInstance.scope == TaskScope.MODULE)
            .where(TaskInstance.status == TaskStatus.COMPLETED)
            .where(TaskInstance.completed_at.is_not(None))
            .where(WorkOrder.house_type_id == house_type_id)
            .where(WorkUnit.module_number == module_number)
        )
    if project_name:
        stmt = stmt.where(WorkOrder.project_name == project_name)
    if from_dt is not None:
        stmt = stmt.where(TaskInstance.completed_at >= from_dt)
    if to_dt is not None:
        stmt = stmt.where(TaskInstance.completed_at <= to_dt)

    rows = list(db.execute(stmt.order_by(TaskInstance.completed_at)).all())

    def _empty_response(summary: TaskSequenceSummary) -> TaskSequenceResponse:
        return TaskSequenceResponse(
            scope=scope.value,
            house_type_id=house_type_id,
            panel_definition_id=panel_definition_id,
            module_number=module_number,
            project_name=project_name,
            rank_by=rank_by,
            summary=summary,
            tasks=[],
        )

    if not rows:
        return _empty_response(
            TaskSequenceSummary(
                unit_count=0,
                units_with_order=0,
                instance_count=0,
                outlier_excluded_count=0,
                rework_excluded_count=0,
                missing_timestamp_count=0,
            )
        )

    instances = [row[0] for row in rows]
    instance_ids = [instance.id for instance in instances]

    pause_map: dict[int, list[TaskPause]] = {}
    for pause in db.execute(
        select(TaskPause).where(TaskPause.task_instance_id.in_(instance_ids))
    ).scalars():
        pause_map.setdefault(pause.task_instance_id, []).append(pause)

    mask_start_date, mask_end_date = _mask_query_bounds(instances, pause_map)
    station_ids = {
        instance.station_id
        for instance in instances
        if instance.station_id is not None
    }
    station_role_by_id: dict[int, StationRole] = {}
    station_sequence_by_id: dict[int, int | None] = {}
    station_name_by_id: dict[int, str] = {}
    if station_ids:
        for station in db.execute(
            select(Station).where(Station.id.in_(station_ids))
        ).scalars():
            station_role_by_id[station.id] = station.role
            station_sequence_by_id[station.id] = station.sequence_order
            station_name_by_id[station.id] = station.name

    station_ids_by_role: dict[StationRole, set[int]] = {}
    sequence_orders_by_role: dict[StationRole, set[int]] = {}
    for station_id_value in station_ids:
        role = station_role_by_id.get(station_id_value)
        if role is None:
            continue
        station_ids_by_role.setdefault(role, set()).add(station_id_value)
        sequence_order = station_sequence_by_id.get(station_id_value)
        if sequence_order is not None:
            sequence_orders_by_role.setdefault(role, set()).add(sequence_order)

    combined_masks_by_station_day: dict[
        int, dict[date, tuple[datetime, datetime] | None]
    ] = {}
    combined_masks_by_sequence_day: dict[
        tuple[StationRole, int], dict[date, tuple[datetime, datetime] | None]
    ] = {}
    for role in set(station_ids_by_role.keys()) | set(sequence_orders_by_role.keys()):
        role_masks = ShiftMaskResolver.load(
            db,
            station_role=role,
            station_ids=station_ids_by_role.get(role, set()),
            sequence_orders=sequence_orders_by_role.get(role, set()),
            start_date=mask_start_date,
            end_date=mask_end_date,
            algorithm_version=ALGORITHM_VERSION,
        )
        combined_masks_by_station_day.update(role_masks.masks_by_station_day)
        combined_masks_by_sequence_day.update(role_masks.masks_by_sequence_day)
    shift_masks = ShiftMaskResolver(
        masks_by_station_day=combined_masks_by_station_day,
        masks_by_sequence_day=combined_masks_by_sequence_day,
    )

    observed_task_ids = {row[1].id for row in rows}

    expected_map: dict[int, float] = {}
    module_duration_map: dict[int, list[TaskExpectedDuration]] = {}
    if scope == TaskScope.PANEL and panel_definition is not None:
        panel_tasks = list(
            db.execute(
                select(TaskDefinition)
                .where(TaskDefinition.scope == TaskScope.PANEL)
                .where(TaskDefinition.active == True)  # noqa: E712
                .where(TaskDefinition.archived_at.is_(None))
            ).scalars()
        )
        expected_map = _build_panel_expected_map(panel_definition, panel_tasks)
        for duration_row in db.execute(
            select(TaskExpectedDuration).where(
                TaskExpectedDuration.panel_definition_id == panel_definition_id
            )
        ).scalars():
            if duration_row.expected_minutes is None:
                continue
            expected_map[duration_row.task_definition_id] = float(
                duration_row.expected_minutes
            )
    else:
        for duration_row in db.execute(
            select(TaskExpectedDuration).where(
                TaskExpectedDuration.task_definition_id.in_(observed_task_ids)
            )
        ).scalars():
            module_duration_map.setdefault(
                duration_row.task_definition_id, []
            ).append(duration_row)

    applicability_map: dict[int, list[TaskApplicability]] = {}
    for applicability_row in db.execute(
        select(TaskApplicability).where(
            TaskApplicability.task_definition_id.in_(observed_task_ids)
        )
    ).scalars():
        applicability_map.setdefault(
            applicability_row.task_definition_id, []
        ).append(applicability_row)
    condition_ctx = load_condition_context(db, sorted(observed_task_ids), None)

    rework_excluded = 0
    missing_timestamps = 0
    outlier_excluded = 0
    outlier_by_task: Counter[int] = Counter()
    task_meta: dict[int, TaskDefinition] = {}
    units: dict[int, dict[str, object]] = {}

    for row in rows:
        if scope == TaskScope.PANEL:
            instance, task_def, panel_unit, work_unit, work_order = row
            unit_key = panel_unit.id
        else:
            instance, task_def, work_unit, work_order = row
            unit_key = work_unit.id

        if not include_rework and (
            task_def.is_rework or instance.rework_task_id is not None
        ):
            rework_excluded += 1
            continue
        started_at = instance.started_at
        completed_at = instance.completed_at
        if started_at is None or completed_at is None or completed_at < started_at:
            missing_timestamps += 1
            continue

        station_role = station_role_by_id.get(instance.station_id)
        station_sequence_order = station_sequence_by_id.get(instance.station_id)
        duration = _duration_minutes(
            instance, pause_map, shift_masks, station_role, station_sequence_order
        )
        if scope == TaskScope.PANEL:
            expected = expected_map.get(task_def.id)
        else:
            expected = _resolve_module_expected(
                module_duration_map.get(task_def.id, []),
                work_order.house_type_id,
                work_unit.module_number,
            )
        if (
            duration is not None
            and duration > 0
            and expected is not None
            and expected > 0
        ):
            ratio = duration / expected
            if (min_ratio is not None and ratio < min_ratio) or (
                max_ratio is not None and ratio > max_ratio
            ):
                outlier_excluded += 1
                outlier_by_task[task_def.id] += 1
                continue

        task_meta[task_def.id] = task_def
        unit = units.get(unit_key)
        if unit is None:
            unit = {
                "work_unit": work_unit,
                "work_order": work_order,
                "entries": {},
            }
            units[unit_key] = unit
        entries: dict[int, dict[str, object]] = unit["entries"]  # type: ignore[assignment]
        entry = entries.get(task_def.id)
        if entry is None:
            entry = {
                "task_id": task_def.id,
                "start": started_at,
                "end": completed_at,
                "duration": 0.0,
                "has_duration": False,
                "expected": expected,
                "stations": Counter(),
                "instances": 0,
            }
            entries[task_def.id] = entry
        entry["start"] = min(entry["start"], started_at)  # type: ignore[type-var]
        entry["end"] = max(entry["end"], completed_at)  # type: ignore[type-var]
        if duration is not None and duration > 0:
            entry["duration"] = float(entry["duration"]) + duration
            entry["has_duration"] = True
        if instance.station_id is not None:
            entry["stations"][instance.station_id] += 1  # type: ignore[index]
        entry["instances"] = int(entry["instances"]) + 1

    if not units:
        return _empty_response(
            TaskSequenceSummary(
                unit_count=0,
                units_with_order=0,
                instance_count=0,
                outlier_excluded_count=outlier_excluded,
                rework_excluded_count=rework_excluded,
                missing_timestamp_count=missing_timestamps,
            )
        )

    def _order_time(entry: dict[str, object]) -> datetime:
        return entry["start"] if rank_by == "start" else entry["end"]  # type: ignore[return-value]

    ranks_by_task: dict[int, list[float]] = {}
    start_fracs_by_task: dict[int, list[float]] = {}
    end_fracs_by_task: dict[int, list[float]] = {}
    durations_by_task: dict[int, list[float]] = {}
    expecteds_by_task: dict[int, list[float]] = {}
    overlaps_by_task: dict[int, list[float]] = {}
    stations_by_task: dict[int, Counter[int]] = {}
    unit_counts_by_task: Counter[int] = Counter()
    instance_counts_by_task: Counter[int] = Counter()
    planned_sequence_by_task: dict[int, Counter[int]] = {}
    # pair key: (low_task_id, high_task_id) -> [low_first_count, total]
    pair_stats: dict[tuple[int, int], list[float]] = {}
    planned_cache: dict[tuple[object, ...], dict[int, int | None]] = {}
    units_with_order = 0
    instance_count = 0

    for unit in units.values():
        entries = list(unit["entries"].values())  # type: ignore[union-attr]
        if not entries:
            continue
        work_unit: WorkUnit = unit["work_unit"]  # type: ignore[assignment]
        work_order: WorkOrder = unit["work_order"]  # type: ignore[assignment]
        n = len(entries)
        unit_start = min(e["start"] for e in entries)  # type: ignore[type-var]
        unit_end = max(e["end"] for e in entries)  # type: ignore[type-var]
        span_minutes = (unit_end - unit_start).total_seconds() / 60

        for entry in entries:
            task_id = int(entry["task_id"])  # type: ignore[arg-type]
            unit_counts_by_task[task_id] += 1
            instance_counts_by_task[task_id] += int(entry["instances"])  # type: ignore[arg-type]
            instance_count += int(entry["instances"])  # type: ignore[arg-type]
            stations_by_task.setdefault(task_id, Counter()).update(
                entry["stations"]  # type: ignore[arg-type]
            )
            if entry["has_duration"]:
                durations_by_task.setdefault(task_id, []).append(
                    round(float(entry["duration"]), 2)  # type: ignore[arg-type]
                )
            expected_value = entry["expected"]
            if expected_value is not None:
                expecteds_by_task.setdefault(task_id, []).append(
                    float(expected_value)  # type: ignore[arg-type]
                )
            if span_minutes > 0:
                start_frac = (
                    (entry["start"] - unit_start).total_seconds()  # type: ignore[operator]
                    / 60
                    / span_minutes
                )
                end_frac = (
                    (entry["end"] - unit_start).total_seconds()  # type: ignore[operator]
                    / 60
                    / span_minutes
                )
                start_fracs_by_task.setdefault(task_id, []).append(start_frac)
                end_fracs_by_task.setdefault(task_id, []).append(end_frac)

        if n >= 2:
            units_with_order += 1
            ordered = sorted(entries, key=lambda e: (_order_time(e), e["end"], e["task_id"]))  # type: ignore[arg-type]
            for index, entry in enumerate(ordered):
                task_id = int(entry["task_id"])  # type: ignore[arg-type]
                ranks_by_task.setdefault(task_id, []).append(index / (n - 1))
            for i in range(n):
                for j in range(i + 1, n):
                    a, b = entries[i], entries[j]
                    a_id = int(a["task_id"])  # type: ignore[arg-type]
                    b_id = int(b["task_id"])  # type: ignore[arg-type]
                    low_id, high_id = min(a_id, b_id), max(a_id, b_id)
                    low, high = (a, b) if a_id == low_id else (b, a)
                    stats = pair_stats.setdefault((low_id, high_id), [0.0, 0.0])
                    ta, tb = _order_time(low), _order_time(high)
                    if ta == tb:
                        stats[0] += 0.5
                    elif ta < tb:
                        stats[0] += 1.0
                    stats[1] += 1.0
            for entry in entries:
                overlapped = any(
                    other is not entry
                    and other["start"] < entry["end"]  # type: ignore[operator]
                    and other["end"] > entry["start"]  # type: ignore[operator]
                    for other in entries
                )
                overlaps_by_task.setdefault(int(entry["task_id"]), []).append(  # type: ignore[arg-type]
                    1.0 if overlapped else 0.0
                )

        unit_condition_value_ids = condition_ctx.values_for(work_unit.id)
        context_key = (
            work_order.house_type_id,
            work_order.sub_type_id,
            work_unit.module_number,
            panel_definition_id if scope == TaskScope.PANEL else None,
            frozenset(unit_condition_value_ids),
        )
        planned = planned_cache.get(context_key)
        if planned is None:
            planned = {}
            for task_id in observed_task_ids:
                task_def = task_meta.get(task_id)
                if task_def is None:
                    continue
                applies, station_sequence = resolve_task_station_sequence(
                    task_def,
                    applicability_map.get(task_id, []),
                    work_order.house_type_id,
                    work_order.sub_type_id,
                    work_unit.module_number,
                    panel_definition_id if scope == TaskScope.PANEL else None,
                    condition_requirements=condition_ctx.requirements_for(task_id),
                    unit_condition_value_ids=unit_condition_value_ids,
                )
                planned[task_id] = station_sequence if applies else None
            planned_cache[context_key] = planned
        for entry in entries:
            task_id = int(entry["task_id"])  # type: ignore[arg-type]
            planned_sequence = planned.get(task_id)
            if planned_sequence is not None:
                planned_sequence_by_task.setdefault(task_id, Counter())[
                    planned_sequence
                ] += 1

    def _build_station_shares(counter: Counter[int]) -> list[TaskSequenceStationShare]:
        total = sum(counter.values())
        if not total:
            return []
        if scope == TaskScope.MODULE:
            # Module stations sharing a sequence order are parallel lines of the
            # same position; report them as one station group.
            groups: dict[object, dict[str, object]] = {}
            for station_id, count in counter.items():
                sequence_order = station_sequence_by_id.get(station_id)
                role = station_role_by_id.get(station_id)
                key: object = (
                    ("sequence", role, sequence_order)
                    if sequence_order is not None
                    else ("station", station_id)
                )
                group = groups.setdefault(
                    key, {"ids": [], "count": 0, "sequence_order": sequence_order}
                )
                group["ids"].append(station_id)  # type: ignore[union-attr]
                group["count"] = int(group["count"]) + count  # type: ignore[arg-type]
            shares = []
            for group in groups.values():
                ids: list[int] = group["ids"]  # type: ignore[assignment]
                names = sorted(
                    {
                        station_name_by_id.get(station_id, f"Estacion {station_id}")
                        for station_id in ids
                    }
                )
                label = (
                    " / ".join(names)
                    if len(names) <= 3
                    else f"{names[0]} +{len(names) - 1}"
                )
                shares.append(
                    TaskSequenceStationShare(
                        station_id=min(ids),
                        station_name=label,
                        sequence_order=group["sequence_order"],  # type: ignore[arg-type]
                        count=int(group["count"]),  # type: ignore[arg-type]
                        share=round(int(group["count"]) / total, 4),  # type: ignore[arg-type]
                    )
                )
            shares.sort(key=lambda share: -share.count)
            return shares
        return [
            TaskSequenceStationShare(
                station_id=station_id,
                station_name=station_name_by_id.get(station_id),
                sequence_order=station_sequence_by_id.get(station_id),
                count=count,
                share=round(count / total, 4),
            )
            for station_id, count in counter.most_common()
        ]

    rank_stats_by_task = {
        task_id: _stat(values) for task_id, values in ranks_by_task.items()
    }
    start_stats_by_task = {
        task_id: _stat(values) for task_id, values in start_fracs_by_task.items()
    }

    def _consensus_key(task_id: int) -> tuple[float, float, str]:
        rank_stat = rank_stats_by_task.get(task_id)
        start_stat = start_stats_by_task.get(task_id)
        rank_value = (
            rank_stat.median
            if rank_stat and rank_stat.median is not None
            else 2.0
        )
        start_value = (
            start_stat.median
            if start_stat and start_stat.median is not None
            else 2.0
        )
        name = task_meta[task_id].name.lower() if task_id in task_meta else ""
        return (rank_value, start_value, name)

    consensus_order = sorted(unit_counts_by_task.keys(), key=_consensus_key)
    consensus_position = {
        task_id: index for index, task_id in enumerate(consensus_order)
    }

    agreement_by_task: dict[int, list[tuple[float, float]]] = {}
    for (low_id, high_id), (low_first, total) in pair_stats.items():
        if total <= 0:
            continue
        low_expected_first = consensus_position.get(low_id, 0) < consensus_position.get(
            high_id, 0
        )
        agreeing = low_first if low_expected_first else total - low_first
        agreement_by_task.setdefault(low_id, []).append((agreeing, total))
        agreement_by_task.setdefault(high_id, []).append((agreeing, total))

    task_rows: list[TaskSequenceTaskRow] = []
    for task_id in consensus_order:
        task_def = task_meta.get(task_id)
        if task_def is None:
            continue
        station_shares = _build_station_shares(stations_by_task.get(task_id, Counter()))
        agreement_values = agreement_by_task.get(task_id, [])
        agreeing_total = sum(agreeing for agreeing, _ in agreement_values)
        pair_total = sum(total for _, total in agreement_values)
        order_consistency = (
            round(agreeing_total / pair_total, 4) if pair_total > 0 else None
        )
        overlap_values = overlaps_by_task.get(task_id, [])
        concurrency_share = (
            round(sum(overlap_values) / len(overlap_values), 4)
            if overlap_values
            else None
        )
        planned_counter = planned_sequence_by_task.get(task_id)
        planned_station_sequence = (
            planned_counter.most_common(1)[0][0] if planned_counter else None
        )
        if scope == TaskScope.PANEL:
            expected_minutes = expected_map.get(task_id)
        else:
            expected_minutes = _percentile(
                expecteds_by_task.get(task_id, []), 0.5
            )
        task_rows.append(
            TaskSequenceTaskRow(
                task_definition_id=task_id,
                task_name=task_def.name,
                sample_count=unit_counts_by_task[task_id],
                instance_count=instance_counts_by_task[task_id],
                outlier_excluded_count=outlier_by_task.get(task_id, 0),
                rank=rank_stats_by_task.get(task_id, TaskSequenceStat()),
                start_fraction=start_stats_by_task.get(task_id, TaskSequenceStat()),
                end_fraction=_stat(end_fracs_by_task.get(task_id, [])),
                duration_minutes=_stat(durations_by_task.get(task_id, [])),
                expected_minutes=expected_minutes,
                order_consistency=order_consistency,
                concurrency_share=concurrency_share,
                planned_station_sequence=planned_station_sequence,
                dominant_station_name=(
                    station_shares[0].station_name if station_shares else None
                ),
                stations=station_shares,
            )
        )

    return TaskSequenceResponse(
        scope=scope.value,
        house_type_id=house_type_id,
        panel_definition_id=panel_definition_id,
        module_number=module_number,
        project_name=project_name,
        rank_by=rank_by,
        summary=TaskSequenceSummary(
            unit_count=len(units),
            units_with_order=units_with_order,
            instance_count=instance_count,
            outlier_excluded_count=outlier_excluded,
            rework_excluded_count=rework_excluded,
            missing_timestamp_count=missing_timestamps,
        ),
        tasks=task_rows,
    )
