"""Advance panels that already satisfy all required tasks at their station.

Usage:
    python -m app.scripts.advance_panels_ready [--dry-run]

Options:
    --dry-run    Show what would be changed without making changes
"""

from __future__ import annotations

import argparse

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db.session import SessionLocal
from app.models.enums import (
    PanelUnitStatus,
    StationRole,
    TaskExceptionType,
    TaskScope,
    TaskStatus,
    WorkUnitStatus,
)
from app.models.house import PanelDefinition
from app.models.stations import Station
from app.models.tasks import TaskApplicability, TaskDefinition, TaskException, TaskInstance
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.services.task_applicability import resolve_task_station_sequence


def _load_panel_tasks(
    db: Session,
) -> tuple[list[TaskDefinition], dict[int, list[TaskApplicability]]]:
    task_defs = list(
        db.execute(
            select(TaskDefinition)
            .where(TaskDefinition.active == True)
            .where(TaskDefinition.scope == TaskScope.PANEL)
        ).scalars()
    )
    if not task_defs:
        return [], {}
    task_def_ids = [task.id for task in task_defs]
    applicability_rows = list(
        db.execute(
            select(TaskApplicability).where(TaskApplicability.task_definition_id.in_(task_def_ids))
        ).scalars()
    )
    applicability_map: dict[int, list[TaskApplicability]] = {}
    for row in applicability_rows:
        applicability_map.setdefault(row.task_definition_id, []).append(row)
    return task_defs, applicability_map


def _required_panel_task_ids(
    task_defs: list[TaskDefinition],
    applicability_map: dict[int, list[TaskApplicability]],
    station: Station,
    work_unit: WorkUnit,
    work_order: WorkOrder,
    panel_definition: PanelDefinition,
) -> set[int]:
    if not task_defs:
        return set()
    panel_task_order = panel_definition.applicable_task_ids
    required_ids: set[int] = set()
    for task in task_defs:
        if panel_task_order is not None and task.id not in panel_task_order:
            continue
        applies, station_sequence_order = resolve_task_station_sequence(
            task,
            applicability_map.get(task.id, []),
            work_order.house_type_id,
            work_order.sub_type_id,
            work_unit.module_number,
            panel_definition.id,
        )
        if not applies:
            continue
        if station_sequence_order is None:
            continue
        if station.sequence_order != station_sequence_order:
            continue
        required_ids.add(task.id)
    return required_ids


def _next_panel_station(
    panel_stations: list[Station],
    current_station: Station,
    task_defs: list[TaskDefinition],
    applicability_map: dict[int, list[TaskApplicability]],
    work_unit: WorkUnit,
    work_order: WorkOrder,
    panel_definition: PanelDefinition,
) -> Station | None:
    if current_station.sequence_order is None:
        return None
    for candidate in panel_stations:
        if candidate.sequence_order is None:
            continue
        if candidate.sequence_order <= current_station.sequence_order:
            continue
        candidate_required = _required_panel_task_ids(
            task_defs,
            applicability_map,
            candidate,
            work_unit,
            work_order,
            panel_definition,
        )
        if candidate_required:
            return candidate
    return None


def _panel_is_ready(
    db: Session,
    panel_unit: PanelUnit,
    station: Station,
    task_defs: list[TaskDefinition],
    applicability_map: dict[int, list[TaskApplicability]],
    work_unit: WorkUnit,
    work_order: WorkOrder,
    panel_definition: PanelDefinition,
) -> tuple[bool, set[int], set[int]]:
    required_ids = _required_panel_task_ids(
        task_defs, applicability_map, station, work_unit, work_order, panel_definition
    )
    if not required_ids:
        return True, required_ids, set()

    completed_ids = set(
        db.execute(
            select(TaskInstance.task_definition_id)
            .where(TaskInstance.work_unit_id == work_unit.id)
            .where(TaskInstance.panel_unit_id == panel_unit.id)
            .where(TaskInstance.station_id == station.id)
            .where(TaskInstance.status.in_([TaskStatus.COMPLETED, TaskStatus.SKIPPED]))
            .where(TaskInstance.task_definition_id.in_(required_ids))
        ).scalars()
    )
    skipped_ids = set(
        db.execute(
            select(TaskException.task_definition_id)
            .where(TaskException.work_unit_id == work_unit.id)
            .where(TaskException.panel_unit_id == panel_unit.id)
            .where(TaskException.station_id == station.id)
            .where(TaskException.exception_type == TaskExceptionType.SKIP)
            .where(TaskException.task_definition_id.in_(required_ids))
        ).scalars()
    )
    satisfied_ids = completed_ids | skipped_ids
    should_advance = required_ids.issubset(satisfied_ids)
    return should_advance, required_ids, satisfied_ids


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Advance panels that already satisfy all applicable tasks at their station."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without making changes",
    )
    args = parser.parse_args()

    with SessionLocal() as session:
        task_defs, applicability_map = _load_panel_tasks(session)
        stations = list(session.execute(select(Station)).scalars())
        station_map = {station.id: station for station in stations}
        panel_stations = sorted(
            [station for station in stations if station.role == StationRole.PANELS],
            key=lambda station: station.sequence_order or 0,
        )

        panels = list(
            session.execute(
                select(PanelUnit)
                .options(
                    joinedload(PanelUnit.work_unit).joinedload(WorkUnit.work_order),
                    joinedload(PanelUnit.panel_definition),
                )
                .where(PanelUnit.current_station_id.is_not(None))
                .where(
                    PanelUnit.status.notin_(
                        [PanelUnitStatus.COMPLETED, PanelUnitStatus.CONSUMED]
                    )
                )
            ).scalars()
        )

        print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
        print(f"Scanning {len(panels)} panel units with current stations.")
        print("-" * 60)

        eligible = 0
        advanced = 0
        completed = 0
        skipped = 0

        for panel in panels:
            station = station_map.get(panel.current_station_id)
            if not station:
                skipped += 1
                print(f"PanelUnit {panel.id}: missing station {panel.current_station_id}.")
                continue
            if station.role != StationRole.PANELS:
                skipped += 1
                continue
            work_unit = panel.work_unit
            panel_def = panel.panel_definition
            work_order = work_unit.work_order if work_unit else None
            if not work_unit or not work_order or not panel_def:
                skipped += 1
                print(f"PanelUnit {panel.id}: missing related data.")
                continue

            ready, required_ids, satisfied_ids = _panel_is_ready(
                session,
                panel,
                station,
                task_defs,
                applicability_map,
                work_unit,
                work_order,
                panel_def,
            )
            if not ready:
                continue

            eligible += 1
            next_station = _next_panel_station(
                panel_stations,
                station,
                task_defs,
                applicability_map,
                work_unit,
                work_order,
                panel_def,
            )
            work_unit_status_change = None
            if next_station:
                if work_unit.status == WorkUnitStatus.PLANNED:
                    work_unit_status_change = (work_unit.status, WorkUnitStatus.PANELS)
                action = (
                    f"advance to station {next_station.id} ({next_station.name})"
                )
            else:
                if work_unit.status in (WorkUnitStatus.PLANNED, WorkUnitStatus.PANELS):
                    work_unit_status_change = (work_unit.status, WorkUnitStatus.MAGAZINE)
                action = "complete panel"

            reason = f"required {len(required_ids)}; satisfied {len(satisfied_ids)}"
            prefix = "[DRY RUN] " if args.dry_run else ""
            print(f"{prefix}PanelUnit {panel.id}: {action} ({reason}).")
            if work_unit_status_change:
                before, after = work_unit_status_change
                print(f"{prefix}  WorkUnit {work_unit.id}: {before} -> {after}.")

            if next_station:
                advanced += 1
                if args.dry_run:
                    continue
                panel.current_station_id = next_station.id
                panel.status = PanelUnitStatus.IN_PROGRESS
                if work_unit_status_change:
                    work_unit.status = work_unit_status_change[1]
            else:
                completed += 1
                if args.dry_run:
                    continue
                panel.current_station_id = None
                panel.status = PanelUnitStatus.COMPLETED
                if work_unit_status_change:
                    work_unit.status = work_unit_status_change[1]

        if not args.dry_run:
            session.commit()

        print("-" * 60)
        advance_label = "to advance" if args.dry_run else "advanced"
        complete_label = "to complete" if args.dry_run else "completed"
        print(
            "Summary: "
            f"{eligible} eligible, {advanced} {advance_label}, {completed} {complete_label}, "
            f"{skipped} skipped."
        )
        if args.dry_run:
            print("Dry run only. Re-run without --dry-run to apply.")


if __name__ == "__main__":
    main()
