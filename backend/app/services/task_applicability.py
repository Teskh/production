from __future__ import annotations

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
