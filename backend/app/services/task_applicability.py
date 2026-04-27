from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import TaskScope
from app.models.house import PanelDefinition
from app.models.tasks import TaskApplicability, TaskDefinition


def _is_default_scope(row: TaskApplicability) -> bool:
    return (
        row.house_type_id is None
        and row.sub_type_id is None
        and row.module_number is None
        and row.panel_definition_id is None
    )


def _matches_applicability(
    row: TaskApplicability,
    house_type_id: int,
    sub_type_id: int | None,
    module_number: int,
    panel_definition_id: int | None,
) -> bool:
    if row.panel_definition_id is not None and row.panel_definition_id != panel_definition_id:
        return False
    if row.house_type_id is not None and row.house_type_id != house_type_id:
        return False
    if row.sub_type_id is not None and row.sub_type_id != sub_type_id:
        return False
    if row.module_number is not None and row.module_number != module_number:
        return False
    return True


def _applicability_rank(row: TaskApplicability) -> tuple[int, int, int]:
    if row.panel_definition_id is not None:
        level = 0
    elif row.house_type_id is not None and row.module_number is not None:
        level = 1
    elif row.house_type_id is not None:
        level = 2
    else:
        level = 4
    subtype_rank = 0 if row.sub_type_id is not None else 1
    return (level, subtype_rank, row.id)


def _resolve_applicability(
    rows: list[TaskApplicability],
    house_type_id: int,
    sub_type_id: int | None,
    module_number: int,
    panel_definition_id: int | None,
) -> TaskApplicability | None:
    scoped_rows = [row for row in rows if not _is_default_scope(row)]
    matches = [
        row
        for row in scoped_rows
        if _matches_applicability(row, house_type_id, sub_type_id, module_number, panel_definition_id)
    ]
    if not matches:
        return None
    return min(matches, key=_applicability_rank)


def resolve_task_station_sequence(
    task: TaskDefinition,
    rows: list[TaskApplicability],
    house_type_id: int,
    sub_type_id: int | None,
    module_number: int,
    panel_definition_id: int | None,
) -> tuple[bool, int | None]:
    applicability = _resolve_applicability(
        rows,
        house_type_id,
        sub_type_id,
        module_number,
        panel_definition_id,
    )
    if not applicability:
        return True, task.default_station_sequence
    if not applicability.applies:
        return False, None
    return True, applicability.station_sequence_order


def resolve_task_applicability(
    rows: list[TaskApplicability],
    house_type_id: int,
    sub_type_id: int | None,
    module_number: int,
    panel_definition_id: int | None,
) -> TaskApplicability | None:
    return _resolve_applicability(
        rows,
        house_type_id,
        sub_type_id,
        module_number,
        panel_definition_id,
    )


def order_tasks_by_panel_metadata(
    task_definitions: list[TaskDefinition],
    panel_task_order: list[int] | None,
) -> list[TaskDefinition]:
    if panel_task_order is None:
        return sorted(task_definitions, key=lambda task: task.name.lower())
    order_index = {task_id: idx for idx, task_id in enumerate(panel_task_order)}
    return sorted(
        task_definitions,
        key=lambda task: (
            order_index.get(task.id, 1_000_000),
            task.default_station_sequence
            if task.default_station_sequence is not None
            else 1_000_000,
            task.name.lower(),
        ),
    )


def _panel_task_ids_from_metadata(
    panel_definition: PanelDefinition,
    panel_task_ids: list[int],
) -> set[int]:
    if panel_definition.applicable_task_ids is None:
        return set(panel_task_ids)
    known_ids = set(panel_task_ids)
    return {task_id for task_id in panel_definition.applicable_task_ids if task_id in known_ids}


def sync_panel_task_applicability(
    db: Session,
    panel_definition: PanelDefinition,
    *,
    delete_duplicate_rows: bool = True,
) -> dict[str, int]:
    panel_tasks = list(
        db.execute(
            select(TaskDefinition)
            .where(TaskDefinition.scope == TaskScope.PANEL)
            .where(TaskDefinition.active == True)
            .order_by(TaskDefinition.id)
        ).scalars()
    )
    if not panel_tasks:
        return {"created": 0, "updated": 0, "deleted_duplicates": 0}

    desired_ids = _panel_task_ids_from_metadata(
        panel_definition,
        [task.id for task in panel_tasks],
    )
    task_by_id = {task.id: task for task in panel_tasks}

    existing_rows = list(
        db.execute(
            select(TaskApplicability)
            .where(TaskApplicability.panel_definition_id == panel_definition.id)
            .where(TaskApplicability.task_definition_id.in_(list(task_by_id.keys())))
            .order_by(TaskApplicability.task_definition_id, TaskApplicability.id)
        ).scalars()
    )
    rows_by_task: dict[int, list[TaskApplicability]] = {}
    for row in existing_rows:
        rows_by_task.setdefault(row.task_definition_id, []).append(row)

    created = 0
    updated = 0
    deleted_duplicates = 0
    for task_id, task in task_by_id.items():
        desired_applies = task_id in desired_ids
        rows = rows_by_task.get(task_id, [])
        primary = rows[0] if rows else None
        if primary is None:
            db.add(
                TaskApplicability(
                    task_definition_id=task_id,
                    house_type_id=None,
                    sub_type_id=None,
                    module_number=None,
                    panel_definition_id=panel_definition.id,
                    applies=desired_applies,
                    station_sequence_order=task.default_station_sequence,
                )
            )
            created += 1
            continue

        if primary.applies != desired_applies:
            primary.applies = desired_applies
            updated += 1
        if (
            primary.station_sequence_order is None
            and task.default_station_sequence is not None
        ):
            primary.station_sequence_order = task.default_station_sequence
            updated += 1

        if delete_duplicate_rows:
            for duplicate in rows[1:]:
                db.delete(duplicate)
                deleted_duplicates += 1

    return {
        "created": created,
        "updated": updated,
        "deleted_duplicates": deleted_duplicates,
    }
