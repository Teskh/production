"""Merge TH-XS module-2 panel history into canonical multiwalls.

This script fixes the historical TH-XS module 2 panel configuration so that:

- `MULTIWALL 1` absorbs `F-02`
- `MULTIWALL 2` absorbs `F-04`
- `MULTIWALL 3` absorbs `T-08` and `T-09`

It also normalizes panel definitions so future work uses the folder-truth
multiwall definitions instead of the mistaken split panel definitions.

The script is safe by default and only writes with `--apply`.

Usage:
    python -m app.scripts.merge_thxs_md2_multiwalls
    python -m app.scripts.merge_thxs_md2_multiwalls --apply
    python -m app.scripts.merge_thxs_md2_multiwalls --work-order-id 129 --work-order-id 320
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session, joinedload

from app.db.session import SessionLocal
from app.models.enums import PanelUnitStatus, TaskStatus
from app.models.house import HouseType, PanelDefinition
from app.models.qc import QCCheckInstance
from app.models.tasks import (
    TaskApplicability,
    TaskCorrectionLog,
    TaskDefinition,
    TaskException,
    TaskExpectedDuration,
    TaskInstance,
    TaskParticipation,
    TaskPause,
    TaskStationAdherenceFact,
)
from app.models.work import PanelUnit, WorkOrder, WorkUnit


TASK_STATUS_PRIORITY = {
    TaskStatus.NOT_STARTED: 0,
    TaskStatus.SKIPPED: 1,
    TaskStatus.PAUSED: 2,
    TaskStatus.IN_PROGRESS: 3,
    TaskStatus.COMPLETED: 4,
}

PANEL_STATUS_PRIORITY = {
    PanelUnitStatus.PLANNED: 0,
    PanelUnitStatus.CONSUMED: 1,
    PanelUnitStatus.IN_PROGRESS: 2,
    PanelUnitStatus.COMPLETED: 3,
}


@dataclass(frozen=True)
class BundleSpec:
    canonical_code: str
    definition_candidates: tuple[str, ...]
    panel_candidates: tuple[str, ...]
    canonical_group: str = "Multiwalls"
    aggregate_metrics: bool = False

    @property
    def all_codes(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys(self.definition_candidates + self.panel_candidates))


BUNDLES = (
    BundleSpec(
        canonical_code="MULTIWALL 1",
        definition_candidates=("MULTIWALL 1", "F-02"),
        panel_candidates=("MULTIWALL 1", "F-02"),
    ),
    BundleSpec(
        canonical_code="MULTIWALL 2",
        definition_candidates=("MULTIWALL 2", "Multiwall 2", "F-04"),
        panel_candidates=("MULTIWALL 2", "Multiwall 2", "F-04"),
    ),
    BundleSpec(
        canonical_code="MULTIWALL 3",
        definition_candidates=("MULTIWALL 3", "T-08", "T-09"),
        panel_candidates=("MULTIWALL 3", "T-08", "T-09"),
        aggregate_metrics=True,
    ),
)


def _serialize(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _serialize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_serialize(item) for item in value]
    return value


def _append_warning(report: dict[str, Any], message: str) -> None:
    report.setdefault("warnings", []).append(message)


def _distinct_non_null(values: list[Any]) -> list[Any]:
    seen: list[Any] = []
    for value in values:
        if value is None or value in seen:
            continue
        seen.append(value)
    return seen


def _pick_first_non_null(values: list[Any]) -> Any | None:
    for value in values:
        if value is not None:
            return value
    return None


def _merge_notes(rows: list[TaskInstance]) -> str | None:
    notes = []
    for row in rows:
        if row.notes:
            cleaned = row.notes.strip()
            if cleaned and cleaned not in notes:
                notes.append(cleaned)
    if not notes:
        return None
    return "\n\n".join(notes)


def _merge_task_status(rows: list[TaskInstance]) -> TaskStatus:
    if any(row.completed_at is not None for row in rows):
        return TaskStatus.COMPLETED
    return max(rows, key=lambda row: TASK_STATUS_PRIORITY[row.status]).status


def _merge_panel_status(rows: list[PanelUnit]) -> PanelUnitStatus:
    return max(rows, key=lambda row: PANEL_STATUS_PRIORITY[row.status]).status


def _merge_panel_metric(
    rows: list[PanelDefinition],
    attr_name: str,
    aggregate: bool,
) -> Decimal | None:
    values = [getattr(row, attr_name) for row in rows if getattr(row, attr_name) is not None]
    if not values:
        return None
    if aggregate:
        total = Decimal("0")
        for value in values:
            total += value
        return total
    return values[0]


def _merge_sequence(rows: list[PanelDefinition]) -> int | None:
    values = [row.panel_sequence_number for row in rows if row.panel_sequence_number is not None]
    return min(values) if values else None


def _pick_station_sequence(
    rows: list[TaskApplicability],
    report: dict[str, Any],
    label: str,
) -> int | None:
    values = _distinct_non_null([row.station_sequence_order for row in rows])
    if len(values) > 1:
        _append_warning(
            report,
            f"{label}: conflicting station_sequence_order values {values}; using minimum.",
        )
    return min(values) if values else None


def _pick_single_value(
    values: list[Any],
    report: dict[str, Any],
    label: str,
    fallback: Any | None = None,
) -> Any | None:
    distinct = _distinct_non_null(values)
    if not distinct:
        return fallback
    if len(distinct) > 1:
        _append_warning(report, f"{label}: conflicting values {distinct}; using {distinct[0]!r}.")
    return distinct[0]


def _pick_primary_definition(bundle: BundleSpec, definitions: list[PanelDefinition]) -> PanelDefinition | None:
    for code in bundle.definition_candidates:
        for definition in sorted(definitions, key=lambda row: row.id):
            if definition.panel_code == code:
                return definition
    return None


def _pick_anchor_panel_unit(bundle: BundleSpec, panel_units: list[PanelUnit]) -> PanelUnit | None:
    for code in bundle.panel_candidates:
        for panel_unit in sorted(panel_units, key=lambda row: row.id):
            if panel_unit.panel_definition.panel_code == code:
                return panel_unit
    return sorted(panel_units, key=lambda row: row.id)[0] if panel_units else None


def _pick_primary_task(anchor_panel_unit_id: int, rows: list[TaskInstance]) -> TaskInstance:
    anchor_rows = [row for row in rows if row.panel_unit_id == anchor_panel_unit_id]
    candidate_rows = anchor_rows or rows
    return sorted(candidate_rows, key=lambda row: row.id)[0]


def _pick_primary_adherence(rows: list[TaskStationAdherenceFact], survivor_task_id: int) -> TaskStationAdherenceFact:
    survivor_rows = [row for row in rows if row.task_instance_id == survivor_task_id]
    if survivor_rows:
        return sorted(survivor_rows, key=lambda row: row.id)[0]
    return sorted(
        rows,
        key=lambda row: (
            row.completed_at,
            row.captured_at,
            -row.id,
        ),
        reverse=True,
    )[0]


def _dedupe_task_participations(
    db: Session,
    task_ids: list[int],
    survivor_task_id: int,
    apply: bool,
) -> dict[str, int]:
    rows = list(
        db.execute(
            select(TaskParticipation)
            .where(TaskParticipation.task_instance_id.in_(task_ids))
            .order_by(TaskParticipation.id)
        ).scalars()
    )
    kept_keys: dict[tuple[int, Any, Any], TaskParticipation] = {}
    moved = 0
    deleted = 0

    for row in rows:
        key = (row.worker_id, row.joined_at, row.left_at)
        existing = kept_keys.get(key)
        if existing is None:
            kept_keys[key] = row
            if apply and row.task_instance_id != survivor_task_id:
                row.task_instance_id = survivor_task_id
                moved += 1
            continue
        if existing.task_instance_id != survivor_task_id and row.task_instance_id == survivor_task_id:
            kept_keys[key] = row
            existing = row
        if apply:
            db.delete(row)
        deleted += 1

    return {
        "total_rows": len(rows),
        "kept_rows": len(kept_keys),
        "moved_rows": moved,
        "deleted_exact_duplicates": deleted,
    }


def _dedupe_task_pauses(
    db: Session,
    task_ids: list[int],
    survivor_task_id: int,
    apply: bool,
) -> dict[str, int]:
    rows = list(
        db.execute(
            select(TaskPause)
            .where(TaskPause.task_instance_id.in_(task_ids))
            .order_by(TaskPause.id)
        ).scalars()
    )
    kept_keys: dict[tuple[Any, Any, Any, Any], TaskPause] = {}
    moved = 0
    deleted = 0

    for row in rows:
        key = (row.reason_id, row.reason_text, row.paused_at, row.resumed_at)
        existing = kept_keys.get(key)
        if existing is None:
            kept_keys[key] = row
            if apply and row.task_instance_id != survivor_task_id:
                row.task_instance_id = survivor_task_id
                moved += 1
            continue
        if existing.task_instance_id != survivor_task_id and row.task_instance_id == survivor_task_id:
            kept_keys[key] = row
            existing = row
        if apply:
            db.delete(row)
        deleted += 1

    return {
        "total_rows": len(rows),
        "kept_rows": len(kept_keys),
        "moved_rows": moved,
        "deleted_exact_duplicates": deleted,
    }


def _merge_adherence_rows(
    db: Session,
    task_rows: list[TaskInstance],
    survivor: TaskInstance,
    anchor_panel_unit_id: int,
    apply: bool,
    task_report: dict[str, Any],
) -> dict[str, int]:
    task_ids = [row.id for row in task_rows]
    rows = list(
        db.execute(
            select(TaskStationAdherenceFact)
            .where(TaskStationAdherenceFact.task_instance_id.in_(task_ids))
            .order_by(TaskStationAdherenceFact.id)
        ).scalars()
    )
    if not rows:
        return {
            "total_rows": 0,
            "kept_rows": 0,
            "deleted_rows": 0,
        }

    primary = _pick_primary_adherence(rows, survivor.id)
    resolution_codes = _distinct_non_null([row.resolution_code for row in rows])
    if len(resolution_codes) > 1:
        _append_warning(
            task_report,
            f"task {survivor.task_definition_id}: conflicting adherence resolution codes {resolution_codes}.",
        )

    if apply:
        primary.task_instance_id = survivor.id
        primary.completed_at = survivor.completed_at or max(row.completed_at for row in rows)
        primary.captured_at = max(row.captured_at for row in rows)
        primary.task_definition_id = survivor.task_definition_id
        primary.scope = survivor.scope
        primary.work_unit_id = survivor.work_unit_id
        primary.panel_unit_id = anchor_panel_unit_id
        primary.actual_station_id = _pick_single_value(
            [row.actual_station_id for row in rows],
            task_report,
            f"task {survivor.task_definition_id}: actual_station_id",
            fallback=primary.actual_station_id,
        )
        primary.completed_station_id = _pick_single_value(
            [row.completed_station_id for row in rows],
            task_report,
            f"task {survivor.task_definition_id}: completed_station_id",
            fallback=primary.completed_station_id,
        )
        primary.planned_station_sequence = _pick_single_value(
            [row.planned_station_sequence for row in rows],
            task_report,
            f"task {survivor.task_definition_id}: planned_station_sequence",
            fallback=primary.planned_station_sequence,
        )
        primary.planned_station_id = _pick_single_value(
            [row.planned_station_id for row in rows],
            task_report,
            f"task {survivor.task_definition_id}: planned_station_id",
            fallback=primary.planned_station_id,
        )
        primary.planned_line_type = _pick_single_value(
            [row.planned_line_type for row in rows],
            task_report,
            f"task {survivor.task_definition_id}: planned_line_type",
            fallback=primary.planned_line_type,
        )
        primary.resolution_code = resolution_codes[0]
        deviations = _distinct_non_null([row.is_deviation for row in rows])
        primary.is_deviation = True if True in deviations else (False if False in deviations else None)
        primary.included_in_kpi = any(row.included_in_kpi for row in rows)

        for row in rows:
            if row.id == primary.id:
                continue
            db.delete(row)

    return {
        "total_rows": len(rows),
        "kept_rows": 1,
        "deleted_rows": max(0, len(rows) - 1),
    }


def _repoint_task_qc_rows(
    db: Session,
    task_ids: list[int],
    survivor_task_id: int,
    involved_panel_unit_ids: list[int],
    anchor_panel_unit_id: int,
    apply: bool,
) -> int:
    rows = list(
        db.execute(
            select(QCCheckInstance)
            .where(QCCheckInstance.related_task_instance_id.in_(task_ids))
            .order_by(QCCheckInstance.id)
        ).scalars()
    )
    if apply:
        for row in rows:
            row.related_task_instance_id = survivor_task_id
            if row.panel_unit_id in involved_panel_unit_ids:
                row.panel_unit_id = anchor_panel_unit_id
    return len(rows)


def _repoint_task_correction_logs(
    db: Session,
    task_ids: list[int],
    survivor_task_id: int,
    involved_panel_unit_ids: list[int],
    anchor_panel_unit_id: int,
    apply: bool,
    has_task_correction_logs: bool,
) -> int:
    if not has_task_correction_logs:
        return 0
    rows = list(
        db.execute(
            select(TaskCorrectionLog)
            .where(TaskCorrectionLog.original_task_instance_id.in_(task_ids))
            .order_by(TaskCorrectionLog.id)
        ).scalars()
    )
    if apply:
        for row in rows:
            row.original_task_instance_id = survivor_task_id
            if row.panel_unit_id in involved_panel_unit_ids:
                row.panel_unit_id = anchor_panel_unit_id
    return len(rows)


def _merge_task_group(
    db: Session,
    task_rows: list[TaskInstance],
    anchor_panel_unit_id: int,
    involved_panel_unit_ids: list[int],
    task_name_by_id: dict[int, str],
    apply: bool,
    has_task_correction_logs: bool,
) -> dict[str, Any]:
    survivor = _pick_primary_task(anchor_panel_unit_id, task_rows)
    task_ids = [row.id for row in task_rows]
    started_values = [row.started_at for row in task_rows if row.started_at is not None]
    completed_values = [row.completed_at for row in task_rows if row.completed_at is not None]
    station_ids = _distinct_non_null([row.station_id for row in task_rows])
    rework_ids = _distinct_non_null([row.rework_task_id for row in task_rows])
    scopes = _distinct_non_null([row.scope for row in task_rows])
    task_report: dict[str, Any] = {
        "task_definition_id": survivor.task_definition_id,
        "task_name": task_name_by_id.get(survivor.task_definition_id, f"Task {survivor.task_definition_id}"),
        "source_task_ids": task_ids,
        "survivor_task_id": survivor.id,
        "merged_status": _merge_task_status(task_rows).value,
        "merged_started_at": min(started_values).isoformat() if started_values else None,
        "merged_completed_at": max(completed_values).isoformat() if completed_values else None,
    }

    if len(scopes) > 1:
        _append_warning(task_report, f"conflicting task scopes {scopes}; using {scopes[0]!r}.")
    if len(rework_ids) > 1:
        _append_warning(task_report, f"conflicting rework_task_id values {rework_ids}; using {rework_ids[0]!r}.")
    if len(station_ids) > 1:
        _append_warning(task_report, f"conflicting station_id values {station_ids}; using {station_ids[0]!r}.")

    if apply:
        survivor.panel_unit_id = anchor_panel_unit_id
        survivor.status = _merge_task_status(task_rows)
        survivor.started_at = min(started_values) if started_values else None
        survivor.completed_at = max(completed_values) if completed_values else None
        survivor.scope = scopes[0]
        survivor.station_id = station_ids[0]
        survivor.rework_task_id = rework_ids[0] if rework_ids else None
        survivor.notes = _merge_notes(task_rows)

    participation_report = _dedupe_task_participations(
        db,
        task_ids=task_ids,
        survivor_task_id=survivor.id,
        apply=apply,
    )
    pause_report = _dedupe_task_pauses(
        db,
        task_ids=task_ids,
        survivor_task_id=survivor.id,
        apply=apply,
    )
    adherence_report = _merge_adherence_rows(
        db,
        task_rows=task_rows,
        survivor=survivor,
        anchor_panel_unit_id=anchor_panel_unit_id,
        apply=apply,
        task_report=task_report,
    )
    qc_count = _repoint_task_qc_rows(
        db,
        task_ids=task_ids,
        survivor_task_id=survivor.id,
        involved_panel_unit_ids=involved_panel_unit_ids,
        anchor_panel_unit_id=anchor_panel_unit_id,
        apply=apply,
    )
    correction_log_count = _repoint_task_correction_logs(
        db,
        task_ids=task_ids,
        survivor_task_id=survivor.id,
        involved_panel_unit_ids=involved_panel_unit_ids,
        anchor_panel_unit_id=anchor_panel_unit_id,
        apply=apply,
        has_task_correction_logs=has_task_correction_logs,
    )

    if apply:
        # Flush child-row rewires before deleting merged-away task instances so
        # SQLAlchemy does not attempt the parent delete first during autoflush.
        db.flush()
        for row in task_rows:
            if row.id == survivor.id:
                continue
            db.delete(row)

    task_report["participations"] = participation_report
    task_report["pauses"] = pause_report
    task_report["adherence"] = adherence_report
    task_report["qc_rows_repointed"] = qc_count
    task_report["task_correction_logs_repointed"] = correction_log_count
    task_report["deleted_duplicate_task_rows"] = max(0, len(task_rows) - 1)
    return task_report


def _repoint_panel_level_rows(
    db: Session,
    source_panel_unit_ids: list[int],
    anchor_panel_unit_id: int,
    apply: bool,
    has_task_correction_logs: bool,
) -> dict[str, int]:
    result: dict[str, int] = {}

    task_rows = list(
        db.execute(
            select(TaskInstance).where(TaskInstance.panel_unit_id.in_(source_panel_unit_ids))
        ).scalars()
    )
    result["remaining_task_instances"] = len(task_rows)
    if apply:
        for row in task_rows:
            row.panel_unit_id = anchor_panel_unit_id

    adherence_rows = list(
        db.execute(
            select(TaskStationAdherenceFact).where(
                TaskStationAdherenceFact.panel_unit_id.in_(source_panel_unit_ids)
            )
        ).scalars()
    )
    result["task_station_adherence_facts"] = len(adherence_rows)
    if apply:
        for row in adherence_rows:
            row.panel_unit_id = anchor_panel_unit_id

    exception_rows = list(
        db.execute(
            select(TaskException).where(TaskException.panel_unit_id.in_(source_panel_unit_ids))
        ).scalars()
    )
    result["task_exceptions"] = len(exception_rows)
    if apply:
        for row in exception_rows:
            row.panel_unit_id = anchor_panel_unit_id

    qc_rows = list(
        db.execute(
            select(QCCheckInstance).where(QCCheckInstance.panel_unit_id.in_(source_panel_unit_ids))
        ).scalars()
    )
    result["qc_check_instances"] = len(qc_rows)
    if apply:
        for row in qc_rows:
            row.panel_unit_id = anchor_panel_unit_id

    correction_log_rows: list[TaskCorrectionLog] = []
    if has_task_correction_logs:
        correction_log_rows = list(
            db.execute(
                select(TaskCorrectionLog).where(
                    TaskCorrectionLog.panel_unit_id.in_(source_panel_unit_ids)
                )
            ).scalars()
        )
        if apply:
            for row in correction_log_rows:
                row.panel_unit_id = anchor_panel_unit_id
    result["task_correction_logs"] = len(correction_log_rows)
    return result


def _merge_definition_applicability(
    db: Session,
    definitions: list[PanelDefinition],
    target_definition: PanelDefinition,
    apply: bool,
    bundle_report: dict[str, Any],
) -> list[int]:
    rows = list(
        db.execute(
            select(TaskApplicability)
            .where(TaskApplicability.panel_definition_id.in_([row.id for row in definitions]))
            .order_by(TaskApplicability.id)
        ).scalars()
    )
    grouped: dict[tuple[int, int | None, int | None, int | None], list[TaskApplicability]] = defaultdict(list)
    for row in rows:
        key = (
            row.task_definition_id,
            row.house_type_id,
            row.sub_type_id,
            row.module_number,
        )
        grouped[key].append(row)

    merged_rows = 0
    deleted_rows = 0
    applicable_order: list[tuple[int | None, int]] = []

    for key, group in sorted(grouped.items(), key=lambda item: (item[0][3] or 0, item[0][0], item[0][2] or 0)):
        survivor = None
        for row in group:
            if row.panel_definition_id == target_definition.id:
                survivor = row
                break
        survivor = survivor or group[0]
        merged_applies = any(row.applies for row in group)
        merged_station_order = _pick_station_sequence(
            group,
            bundle_report,
            f"{target_definition.panel_code} task_definition_id {key[0]}",
        )
        if apply:
            survivor.panel_definition_id = target_definition.id
            survivor.applies = merged_applies
            survivor.station_sequence_order = merged_station_order
            for row in group:
                if row.id == survivor.id:
                    continue
                db.delete(row)
        merged_rows += 1
        deleted_rows += max(0, len(group) - 1)
        if merged_applies:
            applicable_order.append((merged_station_order, key[0]))

    bundle_report["task_applicability"] = {
        "source_rows": len(rows),
        "survivor_rows": merged_rows,
        "deleted_duplicate_rows": deleted_rows,
    }

    applicable_order.sort(key=lambda item: ((item[0] or 9999), item[1]))
    return [task_definition_id for _, task_definition_id in applicable_order]


def _merge_definition_expected_durations(
    db: Session,
    definitions: list[PanelDefinition],
    target_definition: PanelDefinition,
    apply: bool,
    bundle_report: dict[str, Any],
) -> None:
    rows = list(
        db.execute(
            select(TaskExpectedDuration)
            .where(TaskExpectedDuration.panel_definition_id.in_([row.id for row in definitions]))
            .order_by(TaskExpectedDuration.id)
        ).scalars()
    )
    grouped: dict[tuple[int, int | None, int | None, int | None], list[TaskExpectedDuration]] = defaultdict(list)
    for row in rows:
        key = (
            row.task_definition_id,
            row.house_type_id,
            row.sub_type_id,
            row.module_number,
        )
        grouped[key].append(row)

    merged_rows = 0
    deleted_rows = 0
    for key, group in sorted(grouped.items(), key=lambda item: (item[0][3] or 0, item[0][0], item[0][2] or 0)):
        survivor = None
        for row in group:
            if row.panel_definition_id == target_definition.id:
                survivor = row
                break
        survivor = survivor or group[0]
        merged_minutes = _pick_single_value(
            [row.expected_minutes for row in group],
            bundle_report,
            f"{target_definition.panel_code} task_definition_id {key[0]} expected_minutes",
            fallback=survivor.expected_minutes,
        )
        merged_headcount = _pick_single_value(
            [row.expected_headcount for row in group],
            bundle_report,
            f"{target_definition.panel_code} task_definition_id {key[0]} expected_headcount",
            fallback=survivor.expected_headcount,
        )
        if apply:
            survivor.panel_definition_id = target_definition.id
            survivor.expected_minutes = merged_minutes
            survivor.expected_headcount = merged_headcount
            for row in group:
                if row.id == survivor.id:
                    continue
                db.delete(row)
        merged_rows += 1
        deleted_rows += max(0, len(group) - 1)

    bundle_report["task_expected_durations"] = {
        "source_rows": len(rows),
        "survivor_rows": merged_rows,
        "deleted_duplicate_rows": deleted_rows,
    }


def _normalize_definition(
    target_definition: PanelDefinition,
    source_definitions: list[PanelDefinition],
    bundle: BundleSpec,
    applicable_task_ids: list[int],
    apply: bool,
) -> dict[str, Any]:
    merged_area = _merge_panel_metric(source_definitions, "panel_area", bundle.aggregate_metrics)
    merged_length = _merge_panel_metric(source_definitions, "panel_length_m", bundle.aggregate_metrics)
    merged_sequence = _merge_sequence(source_definitions) if bundle.aggregate_metrics else target_definition.panel_sequence_number

    before = {
        "definition_id": target_definition.id,
        "panel_code": target_definition.panel_code,
        "group": target_definition.group,
        "panel_area": target_definition.panel_area,
        "panel_length_m": target_definition.panel_length_m,
        "panel_sequence_number": target_definition.panel_sequence_number,
        "applicable_task_ids": target_definition.applicable_task_ids,
    }
    after = {
        "definition_id": target_definition.id,
        "panel_code": bundle.canonical_code,
        "group": bundle.canonical_group,
        "panel_area": merged_area if merged_area is not None else target_definition.panel_area,
        "panel_length_m": merged_length if merged_length is not None else target_definition.panel_length_m,
        "panel_sequence_number": merged_sequence,
        "applicable_task_ids": applicable_task_ids,
    }

    if apply:
        target_definition.panel_code = bundle.canonical_code
        target_definition.group = bundle.canonical_group
        if merged_area is not None:
            target_definition.panel_area = merged_area
        if merged_length is not None:
            target_definition.panel_length_m = merged_length
        if merged_sequence is not None:
            target_definition.panel_sequence_number = merged_sequence
        target_definition.applicable_task_ids = applicable_task_ids
        target_definition.task_durations_json = None

    return {
        "before": before,
        "after": after,
    }


def _load_house_type(db: Session, house_type_name: str) -> HouseType:
    house_type = db.execute(
        select(HouseType).where(HouseType.name == house_type_name)
    ).scalar_one_or_none()
    if house_type is None:
        raise ValueError(f"House type {house_type_name!r} was not found.")
    return house_type


def _load_bundle_definitions(
    db: Session,
    house_type_id: int,
    module_number: int,
) -> list[PanelDefinition]:
    all_codes = sorted({code for bundle in BUNDLES for code in bundle.all_codes})
    return list(
        db.execute(
            select(PanelDefinition)
            .where(PanelDefinition.house_type_id == house_type_id)
            .where(PanelDefinition.module_sequence_number == module_number)
            .where(PanelDefinition.panel_code.in_(all_codes))
            .order_by(PanelDefinition.id)
        ).scalars()
    )


def _load_target_work_units(
    db: Session,
    house_type_id: int,
    module_number: int,
    work_order_ids: list[int],
) -> list[WorkUnit]:
    all_codes = sorted({code for bundle in BUNDLES for code in bundle.all_codes})
    stmt = (
        select(WorkUnit)
        .options(
            joinedload(WorkUnit.work_order),
            joinedload(WorkUnit.panel_units).joinedload(PanelUnit.panel_definition),
        )
        .join(WorkUnit.work_order)
        .join(WorkUnit.panel_units)
        .join(PanelUnit.panel_definition)
        .where(WorkOrder.house_type_id == house_type_id)
        .where(WorkUnit.module_number == module_number)
        .where(PanelDefinition.panel_code.in_(all_codes))
    )
    if work_order_ids:
        stmt = stmt.where(WorkOrder.id.in_(work_order_ids))
    return list(db.execute(stmt.order_by(WorkOrder.id, WorkUnit.id)).unique().scalars())


def _discover_unhandled_fk_tables(db: Session) -> list[str]:
    handled = {
        ("panel_units", "task_instances"),
        ("panel_units", "task_station_adherence_facts"),
        ("panel_units", "task_exceptions"),
        ("panel_units", "qc_check_instances"),
        ("panel_units", "task_correction_logs"),
        ("task_instances", "task_participations"),
        ("task_instances", "task_pauses"),
        ("task_instances", "task_station_adherence_facts"),
        ("task_instances", "qc_check_instances"),
    }
    inspector = inspect(db.bind)
    warnings = []
    for table_name in inspector.get_table_names():
        for fk in inspector.get_foreign_keys(table_name):
            referred_table = fk.get("referred_table")
            if referred_table not in {"panel_units", "task_instances"}:
                continue
            pair = (referred_table, table_name)
            if pair in handled:
                continue
            warnings.append(
                f"Unhandled foreign key: {table_name}.{fk.get('constrained_columns')} -> {referred_table}"
            )
    return sorted(set(warnings))


def _process_bundle(
    db: Session,
    bundle: BundleSpec,
    house_type: HouseType,
    module_number: int,
    work_units: list[WorkUnit],
    task_name_by_id: dict[int, str],
    apply: bool,
    has_task_correction_logs: bool,
    definitions: list[PanelDefinition],
) -> dict[str, Any]:
    bundle_report: dict[str, Any] = {
        "bundle": bundle.canonical_code,
        "house_type": house_type.name,
        "module_number": module_number,
    }
    bundle_definitions = [row for row in definitions if row.panel_code in bundle.all_codes]
    target_definition = _pick_primary_definition(bundle, bundle_definitions)
    if target_definition is None:
        bundle_report["skipped"] = True
        _append_warning(
            bundle_report,
            f"No panel definition found for bundle {bundle.canonical_code}; nothing to merge.",
        )
        return bundle_report

    applicable_task_ids = _merge_definition_applicability(
        db=db,
        definitions=bundle_definitions,
        target_definition=target_definition,
        apply=apply,
        bundle_report=bundle_report,
    )
    _merge_definition_expected_durations(
        db=db,
        definitions=bundle_definitions,
        target_definition=target_definition,
        apply=apply,
        bundle_report=bundle_report,
    )
    bundle_report["definition"] = _normalize_definition(
        target_definition=target_definition,
        source_definitions=bundle_definitions,
        bundle=bundle,
        applicable_task_ids=applicable_task_ids,
        apply=apply,
    )

    bundle_report["work_units"] = []
    target_definition_id = target_definition.id

    for work_unit in work_units:
        matching_panel_units = [
            row
            for row in work_unit.panel_units
            if row.panel_definition.panel_code in bundle.all_codes
        ]
        if not matching_panel_units:
            continue

        anchor_panel_unit = _pick_anchor_panel_unit(bundle, matching_panel_units)
        if anchor_panel_unit is None:
            continue
        source_panel_units = [row for row in matching_panel_units if row.id != anchor_panel_unit.id]
        involved_panel_unit_ids = [row.id for row in matching_panel_units]
        source_panel_unit_ids = [row.id for row in source_panel_units]

        work_unit_report: dict[str, Any] = {
            "work_order_id": work_unit.work_order_id,
            "project_name": work_unit.work_order.project_name,
            "house_identifier": work_unit.work_order.house_identifier,
            "work_unit_id": work_unit.id,
            "anchor_panel_unit_id": anchor_panel_unit.id,
            "anchor_panel_code_before": anchor_panel_unit.panel_definition.panel_code,
            "target_definition_id": target_definition_id,
            "target_panel_code": bundle.canonical_code,
            "merged_panel_unit_ids": source_panel_unit_ids,
        }

        if apply:
            anchor_panel_unit.panel_definition_id = target_definition_id
            anchor_panel_unit.status = _merge_panel_status(matching_panel_units)
            if anchor_panel_unit.current_station_id is None:
                anchor_panel_unit.current_station_id = _pick_first_non_null(
                    [row.current_station_id for row in matching_panel_units]
                )

        task_rows = list(
            db.execute(
                select(TaskInstance)
                .where(TaskInstance.panel_unit_id.in_(involved_panel_unit_ids))
                .order_by(TaskInstance.task_definition_id, TaskInstance.id)
            ).scalars()
        )
        task_groups: dict[int, list[TaskInstance]] = defaultdict(list)
        for row in task_rows:
            task_groups[row.task_definition_id].append(row)

        work_unit_report["merged_tasks"] = []
        for _, rows in sorted(task_groups.items()):
            task_report = _merge_task_group(
                db=db,
                task_rows=rows,
                anchor_panel_unit_id=anchor_panel_unit.id,
                involved_panel_unit_ids=involved_panel_unit_ids,
                task_name_by_id=task_name_by_id,
                apply=apply,
                has_task_correction_logs=has_task_correction_logs,
            )
            work_unit_report["merged_tasks"].append(task_report)

        work_unit_report["panel_level_repoints"] = _repoint_panel_level_rows(
            db=db,
            source_panel_unit_ids=source_panel_unit_ids,
            anchor_panel_unit_id=anchor_panel_unit.id,
            apply=apply,
            has_task_correction_logs=has_task_correction_logs,
        )

        if apply:
            # Flush panel-level FK rewires before deleting merged-away panel units.
            db.flush()
            for row in source_panel_units:
                db.delete(row)

        bundle_report["work_units"].append(work_unit_report)

    remaining_source_definitions = [
        row for row in bundle_definitions if row.id != target_definition_id
    ]
    if not apply:
        bundle_report["definition_cleanup_candidates"] = [
            {
                "definition_id": row.id,
                "panel_code": row.panel_code,
            }
            for row in remaining_source_definitions
        ]
        bundle_report["deleted_definition_ids"] = []
        return bundle_report

    # Force pending rewires and child deletions through before checking whether
    # the obsolete panel definitions are now unreferenced.
    db.flush()

    deleted_definition_ids: list[int] = []
    for definition in remaining_source_definitions:
        remaining_panel_units = db.execute(
            select(PanelUnit.id).where(PanelUnit.panel_definition_id == definition.id)
        ).first()
        remaining_applicability = db.execute(
            select(TaskApplicability.id).where(TaskApplicability.panel_definition_id == definition.id)
        ).first()
        remaining_durations = db.execute(
            select(TaskExpectedDuration.id).where(TaskExpectedDuration.panel_definition_id == definition.id)
        ).first()
        if remaining_panel_units or remaining_applicability or remaining_durations:
            _append_warning(
                bundle_report,
                f"Panel definition {definition.id} ({definition.panel_code}) still has references and was not deleted.",
            )
            continue
        if apply:
            db.delete(definition)
        deleted_definition_ids.append(definition.id)
    bundle_report["deleted_definition_ids"] = deleted_definition_ids
    return bundle_report


def run_migration(
    db: Session,
    house_type_name: str,
    module_number: int,
    work_order_ids: list[int],
    apply: bool,
) -> dict[str, Any]:
    house_type = _load_house_type(db, house_type_name)
    work_units = _load_target_work_units(
        db=db,
        house_type_id=house_type.id,
        module_number=module_number,
        work_order_ids=work_order_ids,
    )
    task_name_by_id = {
        row.id: row.name
        for row in db.execute(select(TaskDefinition)).scalars()
    }

    report: dict[str, Any] = {
        "mode": "apply" if apply else "dry_run",
        "house_type": house_type.name,
        "house_type_id": house_type.id,
        "module_number": module_number,
        "work_order_filter": work_order_ids,
        "work_units_found": [
            {
                "work_order_id": row.work_order_id,
                "project_name": row.work_order.project_name,
                "house_identifier": row.work_order.house_identifier,
                "work_unit_id": row.id,
            }
            for row in work_units
        ],
        "warnings": [],
        "bundles": [],
    }

    unhandled_fk_warnings = _discover_unhandled_fk_tables(db)
    for warning in unhandled_fk_warnings:
        _append_warning(report, warning)

    has_task_correction_logs = inspect(db.bind).has_table("task_correction_logs")
    definitions = _load_bundle_definitions(
        db=db,
        house_type_id=house_type.id,
        module_number=module_number,
    )
    for bundle in BUNDLES:
        bundle_report = _process_bundle(
            db=db,
            bundle=bundle,
            house_type=house_type,
            module_number=module_number,
            work_units=work_units,
            task_name_by_id=task_name_by_id,
            apply=apply,
            has_task_correction_logs=has_task_correction_logs,
            definitions=definitions,
        )
        report["bundles"].append(bundle_report)

    return report


def _print_report(report: dict[str, Any]) -> None:
    print(f"Mode: {report['mode'].upper()}")
    print(
        f"House type: {report['house_type']} (id={report['house_type_id']}), "
        f"module {report['module_number']}"
    )
    if report["work_order_filter"]:
        print(f"Work order filter: {report['work_order_filter']}")
    print(f"Affected work units: {len(report['work_units_found'])}")
    for work_unit in report["work_units_found"]:
        print(
            "  - "
            f"WO {work_unit['work_order_id']} / work_unit {work_unit['work_unit_id']} "
            f"({work_unit['project_name']}, {work_unit['house_identifier']})"
        )

    print("-" * 72)
    for bundle in report["bundles"]:
        print(f"{bundle['bundle']}:")
        if bundle.get("skipped"):
            print("  skipped")
            continue
        definition = bundle["definition"]
        print(
            "  definition: "
            f"{definition['before']['panel_code']} -> {definition['after']['panel_code']} "
            f"(id={definition['after']['definition_id']})"
        )
        print(
            "  task_applicability: "
            f"{bundle['task_applicability']['source_rows']} rows -> "
            f"{bundle['task_applicability']['survivor_rows']} survivor rows"
        )
        print(
            "  task_expected_durations: "
            f"{bundle['task_expected_durations']['source_rows']} rows -> "
            f"{bundle['task_expected_durations']['survivor_rows']} survivor rows"
        )
        print(f"  work units: {len(bundle['work_units'])}")
        for work_unit in bundle["work_units"]:
            print(
                "    - "
                f"WO {work_unit['work_order_id']} / work_unit {work_unit['work_unit_id']}: "
                f"anchor panel_unit {work_unit['anchor_panel_unit_id']}, "
                f"merged {work_unit['merged_panel_unit_ids']}, "
                f"{len(work_unit['merged_tasks'])} merged tasks"
            )
        if bundle.get("definition_cleanup_candidates"):
            cleanup_ids = [row["definition_id"] for row in bundle["definition_cleanup_candidates"]]
            print(f"  definitions to delete on apply: {cleanup_ids}")
        if bundle.get("deleted_definition_ids"):
            print(f"  definitions deleted: {bundle['deleted_definition_ids']}")
        for warning in bundle.get("warnings", []):
            print(f"  warning: {warning}")

    if report["warnings"]:
        print("-" * 72)
        print("Warnings:")
        for warning in report["warnings"]:
            print(f"  - {warning}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Merge TH-XS module-2 panel history into canonical multiwalls."
    )
    parser.add_argument(
        "--house-type-name",
        default="TH-XS",
        help="House type name to migrate (default: TH-XS).",
    )
    parser.add_argument(
        "--module-number",
        type=int,
        default=2,
        help="Module number to migrate (default: 2).",
    )
    parser.add_argument(
        "--work-order-id",
        type=int,
        action="append",
        default=[],
        help="Restrict the migration to one or more work orders.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist changes. Without this flag the script only reports what it would do.",
    )
    parser.add_argument(
        "--report-file",
        type=Path,
        help="Optional JSON file path for the detailed audit report.",
    )
    args = parser.parse_args()

    with SessionLocal() as db:
        report = run_migration(
            db=db,
            house_type_name=args.house_type_name,
            module_number=args.module_number,
            work_order_ids=args.work_order_id,
            apply=args.apply,
        )
        _print_report(report)

        if args.report_file:
            args.report_file.parent.mkdir(parents=True, exist_ok=True)
            args.report_file.write_text(
                json.dumps(_serialize(report), indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            print(f"Report written to {args.report_file}")

        if args.apply:
            db.commit()
            print("Changes committed.")
        else:
            db.rollback()
            print("Dry run only. No changes were committed.")


if __name__ == "__main__":
    main()
