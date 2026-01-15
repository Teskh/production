"""Copy a house type and module-related configuration.

Usage:
    python -m app.scripts.copy_house_type --source-id 1 --new-name "New Type"
    python -m app.scripts.copy_house_type --source-name "Old Type" --new-name "New Type"

Options:
    --new-number-of-modules  Override number_of_modules on the new house type
    --dry-run                Build the copy then rollback instead of committing
"""

from __future__ import annotations

import argparse
import copy

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.db.session import SessionLocal
from app.models.house import HouseParameterValue, HouseSubType, HouseType, PanelDefinition
from app.models.tasks import TaskApplicability, TaskExpectedDuration


def _resolve_source(
    db: Session, source_id: int | None, source_name: str | None
) -> HouseType | None:
    stmt = select(HouseType).options(
        joinedload(HouseType.sub_types),
        joinedload(HouseType.panel_definitions),
        joinedload(HouseType.parameter_values),
    )
    if source_id is not None:
        stmt = stmt.where(HouseType.id == source_id)
    elif source_name is not None:
        stmt = stmt.where(HouseType.name == source_name)
    else:
        return None
    return db.execute(stmt).scalar_one_or_none()


def _map_optional_id(
    old_id: int | None,
    mapping: dict[int, int],
    label: str,
    row_id: int,
) -> int | None:
    if old_id is None:
        return None
    if old_id not in mapping:
        raise ValueError(
            f"{label} {row_id} references missing ID {old_id} in copy mapping."
        )
    return mapping[old_id]


def _map_house_type_id(
    old_id: int | None,
    source_id: int,
    new_id: int,
    label: str,
    row_id: int,
) -> int | None:
    if old_id is None:
        return None
    if old_id != source_id:
        raise ValueError(
            f"{label} {row_id} references house_type_id {old_id}, not source {source_id}."
        )
    return new_id


def _load_task_applicability(
    db: Session,
    source_id: int,
    sub_type_ids: list[int],
    panel_definition_ids: list[int],
) -> list[TaskApplicability]:
    clauses = [TaskApplicability.house_type_id == source_id]
    if sub_type_ids:
        clauses.append(TaskApplicability.sub_type_id.in_(sub_type_ids))
    if panel_definition_ids:
        clauses.append(TaskApplicability.panel_definition_id.in_(panel_definition_ids))
    stmt = select(TaskApplicability).where(or_(*clauses))
    return list(db.execute(stmt).scalars())


def _load_task_expected_durations(
    db: Session,
    source_id: int,
    sub_type_ids: list[int],
    panel_definition_ids: list[int],
) -> list[TaskExpectedDuration]:
    clauses = [TaskExpectedDuration.house_type_id == source_id]
    if sub_type_ids:
        clauses.append(TaskExpectedDuration.sub_type_id.in_(sub_type_ids))
    if panel_definition_ids:
        clauses.append(TaskExpectedDuration.panel_definition_id.in_(panel_definition_ids))
    stmt = select(TaskExpectedDuration).where(or_(*clauses))
    return list(db.execute(stmt).scalars())


def _copy_house_type(
    db: Session,
    source: HouseType,
    new_name: str,
    new_number_of_modules: int | None,
) -> dict[str, int]:
    new_house = HouseType(
        name=new_name,
        number_of_modules=new_number_of_modules or source.number_of_modules,
    )
    db.add(new_house)
    db.flush()

    sub_type_refs: list[tuple[int, HouseSubType]] = []
    for sub_type in source.sub_types:
        new_sub_type = HouseSubType(
            house_type_id=new_house.id,
            name=sub_type.name,
        )
        db.add(new_sub_type)
        sub_type_refs.append((sub_type.id, new_sub_type))
    db.flush()
    sub_type_map = {old_id: new_sub_type.id for old_id, new_sub_type in sub_type_refs}

    panel_refs: list[tuple[int, PanelDefinition]] = []
    for panel_def in source.panel_definitions:
        new_panel = PanelDefinition(
            house_type_id=new_house.id,
            module_sequence_number=panel_def.module_sequence_number,
            sub_type_id=_map_optional_id(
                panel_def.sub_type_id,
                sub_type_map,
                "PanelDefinition",
                panel_def.id,
            ),
            group=panel_def.group,
            panel_code=panel_def.panel_code,
            panel_area=panel_def.panel_area,
            panel_length_m=panel_def.panel_length_m,
            panel_sequence_number=panel_def.panel_sequence_number,
            applicable_task_ids=copy.deepcopy(panel_def.applicable_task_ids),
            task_durations_json=copy.deepcopy(panel_def.task_durations_json),
        )
        db.add(new_panel)
        panel_refs.append((panel_def.id, new_panel))
    db.flush()
    panel_map = {old_id: new_panel.id for old_id, new_panel in panel_refs}

    for param_value in source.parameter_values:
        db.add(
            HouseParameterValue(
                house_type_id=new_house.id,
                parameter_id=param_value.parameter_id,
                module_sequence_number=param_value.module_sequence_number,
                sub_type_id=_map_optional_id(
                    param_value.sub_type_id,
                    sub_type_map,
                    "HouseParameterValue",
                    param_value.id,
                ),
                value=param_value.value,
            )
        )

    task_applicability_rows = _load_task_applicability(
        db,
        source.id,
        list(sub_type_map.keys()),
        list(panel_map.keys()),
    )
    for row in task_applicability_rows:
        db.add(
            TaskApplicability(
                task_definition_id=row.task_definition_id,
                house_type_id=_map_house_type_id(
                    row.house_type_id,
                    source.id,
                    new_house.id,
                    "TaskApplicability",
                    row.id,
                ),
                sub_type_id=_map_optional_id(
                    row.sub_type_id,
                    sub_type_map,
                    "TaskApplicability",
                    row.id,
                ),
                module_number=row.module_number,
                panel_definition_id=_map_optional_id(
                    row.panel_definition_id,
                    panel_map,
                    "TaskApplicability",
                    row.id,
                ),
                applies=row.applies,
                station_sequence_order=row.station_sequence_order,
            )
        )

    task_expected_rows = _load_task_expected_durations(
        db,
        source.id,
        list(sub_type_map.keys()),
        list(panel_map.keys()),
    )
    for row in task_expected_rows:
        db.add(
            TaskExpectedDuration(
                task_definition_id=row.task_definition_id,
                house_type_id=_map_house_type_id(
                    row.house_type_id,
                    source.id,
                    new_house.id,
                    "TaskExpectedDuration",
                    row.id,
                ),
                sub_type_id=_map_optional_id(
                    row.sub_type_id,
                    sub_type_map,
                    "TaskExpectedDuration",
                    row.id,
                ),
                module_number=row.module_number,
                panel_definition_id=_map_optional_id(
                    row.panel_definition_id,
                    panel_map,
                    "TaskExpectedDuration",
                    row.id,
                ),
                expected_minutes=row.expected_minutes,
            )
        )

    return {
        "house_type_id": new_house.id,
        "sub_types": len(sub_type_map),
        "panel_definitions": len(panel_map),
        "parameter_values": len(source.parameter_values),
        "task_applicability": len(task_applicability_rows),
        "task_expected_durations": len(task_expected_rows),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Copy a house type with module-related configuration."
    )
    parser.add_argument("--source-id", type=int, help="HouseType ID to copy")
    parser.add_argument("--source-name", help="HouseType name to copy")
    parser.add_argument("--new-name", required=True, help="Name for the new house type")
    parser.add_argument(
        "--new-number-of-modules",
        type=int,
        help="Override number_of_modules for the new house type",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be created without committing changes",
    )
    args = parser.parse_args()

    if bool(args.source_id) == bool(args.source_name):
        raise SystemExit("Provide exactly one of --source-id or --source-name.")

    with SessionLocal() as session:
        source = _resolve_source(session, args.source_id, args.source_name)
        if not source:
            raise SystemExit("Source house type not found.")

        existing = session.execute(
            select(HouseType).where(HouseType.name == args.new_name)
        ).scalar_one_or_none()
        if existing:
            raise SystemExit(f"House type name already exists: {args.new_name}")

        result = _copy_house_type(
            session, source, args.new_name, args.new_number_of_modules
        )

        if args.dry_run:
            session.rollback()
        else:
            session.commit()

    mode = "DRY RUN" if args.dry_run else "LIVE"
    print(f"Mode: {mode}")
    print(f"New house type ID: {result['house_type_id']}")
    print(f"Subtypes copied: {result['sub_types']}")
    print(f"Panel definitions copied: {result['panel_definitions']}")
    print(f"Parameter values copied: {result['parameter_values']}")
    print(f"Task applicability rows copied: {result['task_applicability']}")
    print(f"Task expected durations copied: {result['task_expected_durations']}")


if __name__ == "__main__":
    main()
