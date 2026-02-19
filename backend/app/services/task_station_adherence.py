from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.models.enums import StationRole, TaskScope, TaskStatus
from app.models.stations import Station
from app.models.tasks import (
    TaskApplicability,
    TaskDefinition,
    TaskInstance,
    TaskStationAdherenceFact,
)
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.services.task_applicability import resolve_task_station_sequence


def _candidate_station_ids(
    db: Session,
    *,
    scope: TaskScope,
    planned_sequence: int,
    planned_line_type: str | None,
) -> tuple[list[int], str]:
    if scope == TaskScope.PANEL:
        ids = list(
            db.execute(
                select(Station.id)
                .where(Station.role == StationRole.PANELS)
                .where(Station.sequence_order == planned_sequence)
                .order_by(Station.id)
            ).scalars()
        )
        return ids, "panel_station"

    if scope == TaskScope.MODULE:
        if planned_line_type:
            ids = list(
                db.execute(
                    select(Station.id)
                    .where(Station.role == StationRole.ASSEMBLY)
                    .where(Station.line_type == planned_line_type)
                    .where(Station.sequence_order == planned_sequence)
                    .order_by(Station.id)
                ).scalars()
            )
            return ids, "module_station_with_line"

        ids = list(
            db.execute(
                select(Station.id)
                .where(Station.role != StationRole.AUX)
                .where(Station.sequence_order == planned_sequence)
                .order_by(Station.id)
            ).scalars()
        )
        return ids, "module_station_no_line"

    ids = list(
        db.execute(
            select(Station.id)
            .where(Station.role == StationRole.AUX)
            .where(Station.sequence_order == planned_sequence)
            .order_by(Station.id)
        ).scalars()
    )
    return ids, "aux_station"


def _resolve_planned_station_id(
    db: Session,
    *,
    scope: TaskScope,
    planned_sequence: int,
    planned_line_type: str | None,
) -> tuple[int | None, str]:
    station_ids, mode = _candidate_station_ids(
        db,
        scope=scope,
        planned_sequence=planned_sequence,
        planned_line_type=planned_line_type,
    )
    if not station_ids:
        return None, "planned_station_missing"
    if len(station_ids) > 1:
        if mode == "module_station_no_line":
            return None, "planned_station_ambiguous_no_line"
        return None, "planned_station_ambiguous"
    return station_ids[0], "planned_station_resolved"


def _build_fact(
    *,
    instance: TaskInstance,
    completed_station_id: int,
    planned_sequence: int | None,
    planned_station_id: int | None,
    planned_line_type: str | None,
    resolution_code: str,
    included_in_kpi: bool,
    is_deviation: bool | None,
) -> TaskStationAdherenceFact:
    return TaskStationAdherenceFact(
        task_instance_id=instance.id,
        captured_at=utc_now(),
        completed_at=instance.completed_at,
        task_definition_id=instance.task_definition_id,
        scope=instance.scope,
        work_unit_id=instance.work_unit_id,
        panel_unit_id=instance.panel_unit_id,
        actual_station_id=instance.station_id,
        completed_station_id=completed_station_id,
        planned_station_sequence=planned_sequence,
        planned_station_id=planned_station_id,
        planned_line_type=planned_line_type,
        resolution_code=resolution_code,
        included_in_kpi=included_in_kpi,
        is_deviation=is_deviation,
    )


def capture_task_station_adherence_fact(
    db: Session,
    instance: TaskInstance,
    *,
    task_def: TaskDefinition | None = None,
    completed_station_id: int,
) -> None:
    if instance.status != TaskStatus.COMPLETED or instance.completed_at is None:
        return

    already_captured = db.execute(
        select(TaskStationAdherenceFact.id).where(
            TaskStationAdherenceFact.task_instance_id == instance.id
        )
    ).scalar_one_or_none()
    if already_captured is not None:
        return

    task_definition = task_def or db.get(TaskDefinition, instance.task_definition_id)
    if not task_definition:
        return

    if task_definition.is_rework or instance.rework_task_id is not None:
        return

    work_unit = db.get(WorkUnit, instance.work_unit_id)
    work_order = db.get(WorkOrder, work_unit.work_order_id) if work_unit else None
    panel_definition_id: int | None = None
    if instance.panel_unit_id is not None:
        panel_unit = db.get(PanelUnit, instance.panel_unit_id)
        if panel_unit:
            panel_definition_id = panel_unit.panel_definition_id

    if not work_unit or not work_order:
        db.add(
            _build_fact(
                instance=instance,
                completed_station_id=completed_station_id,
                planned_sequence=None,
                planned_station_id=None,
                planned_line_type=None,
                resolution_code="context_missing",
                included_in_kpi=False,
                is_deviation=None,
            )
        )
        return

    applicability_rows = list(
        db.execute(
            select(TaskApplicability).where(
                TaskApplicability.task_definition_id == task_definition.id
            )
        ).scalars()
    )
    applies, planned_sequence = resolve_task_station_sequence(
        task_definition,
        applicability_rows,
        work_order.house_type_id,
        work_order.sub_type_id,
        work_unit.module_number,
        panel_definition_id,
    )

    planned_line_type = (
        str(work_unit.planned_assembly_line)
        if instance.scope == TaskScope.MODULE and work_unit.planned_assembly_line
        else None
    )

    if not applies:
        db.add(
            _build_fact(
                instance=instance,
                completed_station_id=completed_station_id,
                planned_sequence=planned_sequence,
                planned_station_id=None,
                planned_line_type=planned_line_type,
                resolution_code="not_applicable",
                included_in_kpi=False,
                is_deviation=None,
            )
        )
        return

    if planned_sequence is None:
        db.add(
            _build_fact(
                instance=instance,
                completed_station_id=completed_station_id,
                planned_sequence=None,
                planned_station_id=None,
                planned_line_type=planned_line_type,
                resolution_code="unscheduled",
                included_in_kpi=False,
                is_deviation=None,
            )
        )
        return

    planned_station_id, resolve_code = _resolve_planned_station_id(
        db,
        scope=instance.scope,
        planned_sequence=planned_sequence,
        planned_line_type=planned_line_type,
    )
    if planned_station_id is None:
        db.add(
            _build_fact(
                instance=instance,
                completed_station_id=completed_station_id,
                planned_sequence=planned_sequence,
                planned_station_id=None,
                planned_line_type=planned_line_type,
                resolution_code=resolve_code,
                included_in_kpi=False,
                is_deviation=None,
            )
        )
        return

    is_deviation = planned_station_id != completed_station_id
    db.add(
        _build_fact(
            instance=instance,
            completed_station_id=completed_station_id,
            planned_sequence=planned_sequence,
            planned_station_id=planned_station_id,
            planned_line_type=planned_line_type,
            resolution_code="deviation" if is_deviation else "matched",
            included_in_kpi=True,
            is_deviation=is_deviation,
        )
    )
