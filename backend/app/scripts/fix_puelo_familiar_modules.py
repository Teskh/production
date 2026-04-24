"""Correct Nuevo Sol de Quillon houses 173-176 to Puelo Familiar.

Usage:
    uv run --directory backend python -m app.scripts.fix_puelo_familiar_modules --dry-run
    uv run --directory backend python -m app.scripts.fix_puelo_familiar_modules --apply
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.session import SessionLocal
from app.models.enums import PanelUnitStatus, WorkUnitStatus
from app.models.house import HouseType, PanelDefinition
from app.models.work import PanelUnit, WorkOrder, WorkUnit

TARGET_PROJECT = "Nuevo Sol de Quillon"
TARGET_HOUSE_TYPE = "Puelo Familiar"
MODULE_ORDER = (3, 2, 1)


@dataclass(frozen=True)
class HouseFixConfig:
    module_3_line: str
    module_3_status: WorkUnitStatus
    normalize_all_modules_to_planned: bool = False


HOUSE_FIXES: dict[str, HouseFixConfig] = {
    "173": HouseFixConfig(module_3_line="1", module_3_status=WorkUnitStatus.MAGAZINE),
    "174": HouseFixConfig(module_3_line="1", module_3_status=WorkUnitStatus.MAGAZINE),
    "175": HouseFixConfig(
        module_3_line="2",
        module_3_status=WorkUnitStatus.PLANNED,
        normalize_all_modules_to_planned=True,
    ),
    "176": HouseFixConfig(
        module_3_line="2",
        module_3_status=WorkUnitStatus.PLANNED,
        normalize_all_modules_to_planned=True,
    ),
}


def _load_target_house_type(session: Session) -> HouseType:
    house_type = session.execute(
        select(HouseType).where(HouseType.name == TARGET_HOUSE_TYPE)
    ).scalar_one_or_none()
    if house_type is None:
        raise RuntimeError(f"House type '{TARGET_HOUSE_TYPE}' was not found.")
    if house_type.number_of_modules != 3:
        raise RuntimeError(
            f"House type '{TARGET_HOUSE_TYPE}' expected 3 modules, found "
            f"{house_type.number_of_modules}."
        )
    return house_type


def _load_target_orders(session: Session) -> list[WorkOrder]:
    orders = list(
        session.execute(
            select(WorkOrder)
            .options(selectinload(WorkOrder.work_units))
            .where(WorkOrder.project_name == TARGET_PROJECT)
            .where(WorkOrder.house_identifier.in_(list(HOUSE_FIXES.keys())))
            .order_by(WorkOrder.house_identifier)
        ).scalars()
    )
    if len(orders) != len(HOUSE_FIXES):
        found = sorted(order.house_identifier or "" for order in orders)
        raise RuntimeError(
            f"Expected {len(HOUSE_FIXES)} target work orders, found {len(orders)}: {found}"
        )
    identifiers = [order.house_identifier for order in orders]
    if identifiers != sorted(HOUSE_FIXES.keys()):
        raise RuntimeError(f"Unexpected house identifiers resolved: {identifiers}")
    return orders


def _load_module_3_panel_definitions(
    session: Session, house_type_id: int
) -> list[PanelDefinition]:
    panel_definitions = list(
        session.execute(
            select(PanelDefinition)
            .where(PanelDefinition.house_type_id == house_type_id)
            .where(PanelDefinition.module_sequence_number == 3)
            .where(PanelDefinition.sub_type_id.is_(None))
            .order_by(
                PanelDefinition.panel_sequence_number.nulls_last(),
                PanelDefinition.panel_code,
                PanelDefinition.id,
            )
        ).scalars()
    )
    if not panel_definitions:
        raise RuntimeError(
            f"No module 3 panel definitions found for house type '{TARGET_HOUSE_TYPE}'."
        )
    return panel_definitions


def _work_units_by_module(order: WorkOrder) -> dict[int, WorkUnit]:
    units = {unit.module_number: unit for unit in order.work_units}
    if len(units) != len(order.work_units):
        raise RuntimeError(
            f"Work order {order.id} ({order.house_identifier}) has duplicate module rows."
        )
    unexpected = sorted(module for module in units if module not in MODULE_ORDER)
    if unexpected:
        raise RuntimeError(
            f"Work order {order.id} ({order.house_identifier}) has unexpected modules: {unexpected}"
        )
    return units


def _ensure_module_3(
    session: Session, order: WorkOrder, units_by_module: dict[int, WorkUnit]
) -> tuple[WorkUnit, bool]:
    existing = units_by_module.get(3)
    if existing is not None:
        return existing, False

    reference_unit = units_by_module.get(2) or units_by_module.get(1)
    if reference_unit is None:
        raise RuntimeError(
            f"Work order {order.id} ({order.house_identifier}) has no module 1/2 rows to copy from."
        )

    work_unit = WorkUnit(
        work_order_id=order.id,
        module_number=3,
        planned_sequence=0,
        planned_start_datetime=reference_unit.planned_start_datetime,
        planned_assembly_line=reference_unit.planned_assembly_line,
        status=WorkUnitStatus.PLANNED,
        current_station_id=None,
    )
    session.add(work_unit)
    session.flush()
    order.work_units.append(work_unit)
    units_by_module[3] = work_unit
    return work_unit, True


def _ensure_terminal_panel_units(
    session: Session,
    work_unit: WorkUnit,
    panel_definitions: list[PanelDefinition],
) -> list[str]:
    existing_units = list(
        session.execute(
            select(PanelUnit).where(PanelUnit.work_unit_id == work_unit.id)
        ).scalars()
    )
    by_definition: dict[int, PanelUnit] = {}
    for panel_unit in existing_units:
        previous = by_definition.get(panel_unit.panel_definition_id)
        if previous is not None:
            raise RuntimeError(
                f"Work unit {work_unit.id} has duplicate panel units for panel definition "
                f"{panel_unit.panel_definition_id}."
            )
        by_definition[panel_unit.panel_definition_id] = panel_unit

    expected_ids = {panel_definition.id for panel_definition in panel_definitions}
    unexpected = sorted(panel_id for panel_id in by_definition if panel_id not in expected_ids)
    if unexpected:
        raise RuntimeError(
            f"Work unit {work_unit.id} has unexpected panel units for definitions {unexpected}."
        )

    changes: list[str] = []
    for panel_definition in panel_definitions:
        panel_unit = by_definition.get(panel_definition.id)
        if panel_unit is None:
            panel_unit = PanelUnit(
                work_unit_id=work_unit.id,
                panel_definition_id=panel_definition.id,
                status=PanelUnitStatus.COMPLETED,
                current_station_id=None,
            )
            session.add(panel_unit)
            session.flush()
            changes.append(
                f"created panel {panel_definition.panel_code} as {PanelUnitStatus.COMPLETED.value}"
            )
            continue

        before = (panel_unit.status, panel_unit.current_station_id)
        panel_unit.status = PanelUnitStatus.COMPLETED
        panel_unit.current_station_id = None
        after = (panel_unit.status, panel_unit.current_station_id)
        if before != after:
            changes.append(
                f"updated panel {panel_definition.panel_code} "
                f"{before[0].value}/{before[1]} -> {after[0].value}/{after[1]}"
            )
    return changes


def _normalize_panels_to_planned(session: Session, work_unit: WorkUnit) -> list[str]:
    panel_units = list(
        session.execute(
            select(PanelUnit).where(PanelUnit.work_unit_id == work_unit.id)
        ).scalars()
    )
    changes: list[str] = []
    for panel_unit in panel_units:
        before = (panel_unit.status, panel_unit.current_station_id)
        panel_unit.status = PanelUnitStatus.PLANNED
        panel_unit.current_station_id = None
        after = (panel_unit.status, panel_unit.current_station_id)
        if before != after:
            changes.append(
                f"normalized panel_unit {panel_unit.id} "
                f"{before[0].value}/{before[1]} -> {after[0].value}/{after[1]}"
            )
    return changes


def _assign_sequences(
    session: Session, orders: list[WorkOrder], *, placeholder_unit_ids: set[int]
) -> list[str]:
    all_units = list(
        session.execute(
            select(WorkUnit).order_by(WorkUnit.planned_sequence.nulls_last(), WorkUnit.id)
        ).scalars()
    )
    ordered_existing_units = [
        unit for unit in all_units if unit.id not in placeholder_unit_ids
    ]
    target_order_ids = {order.id for order in orders}
    target_unit_ids = {unit.id for order in orders for unit in order.work_units}
    target_existing_unit_ids = target_unit_ids - placeholder_unit_ids

    first_index = next(
        (
            idx
            for idx, unit in enumerate(ordered_existing_units)
            if unit.id in target_existing_unit_ids
        ),
        None,
    )
    if first_index is None:
        raise RuntimeError("No target work units were found in the production queue.")

    first_sequence = ordered_existing_units[first_index].planned_sequence
    if first_sequence is None:
        first_sequence = first_index + 1

    replacement_by_order: dict[int, list[WorkUnit]] = {}
    for order in orders:
        units_by_module = _work_units_by_module(order)
        replacement_by_order[order.id] = [units_by_module[module] for module in MODULE_ORDER]

    tail_units = ordered_existing_units[first_index:]
    reordered_tail: list[WorkUnit] = []
    handled_orders: set[int] = set()
    for unit in tail_units:
        if unit.work_order_id not in target_order_ids:
            reordered_tail.append(unit)
            continue
        if unit.work_order_id in handled_orders:
            continue
        reordered_tail.extend(replacement_by_order[unit.work_order_id])
        handled_orders.add(unit.work_order_id)

    changes: list[str] = []
    for offset, work_unit in enumerate(reordered_tail):
        desired_sequence = first_sequence + offset
        if work_unit.planned_sequence != desired_sequence:
            changes.append(
                f"work_unit {work_unit.id} planned_sequence "
                f"{work_unit.planned_sequence} -> {desired_sequence}"
            )
            work_unit.planned_sequence = desired_sequence
    return changes


def _summarize_order(order: WorkOrder) -> str:
    units = sorted(order.work_units, key=lambda unit: unit.module_number, reverse=True)
    unit_summary = ", ".join(
        f"MD{unit.module_number}: seq={unit.planned_sequence}, "
        f"status={unit.status.value}, line={unit.planned_assembly_line or '-'}"
        for unit in units
    )
    return (
        f"{order.house_identifier} ({order.id}) type={order.house_type_id} "
        f"modules=[{unit_summary}]"
    )


def _apply_fix(session: Session, *, apply_changes: bool) -> None:
    house_type = _load_target_house_type(session)
    orders = _load_target_orders(session)
    module_3_panel_defs = _load_module_3_panel_definitions(session, house_type.id)
    created_module_ids: set[int] = set()

    print(f"Mode: {'APPLY' if apply_changes else 'DRY RUN'}")
    print(
        f"Target project: {TARGET_PROJECT}; target house type: {house_type.name} "
        f"(id={house_type.id})"
    )
    print("-" * 72)

    for order in orders:
        config = HOUSE_FIXES[order.house_identifier or ""]
        units_by_module = _work_units_by_module(order)
        module_3, created_module_3 = _ensure_module_3(session, order, units_by_module)
        if created_module_3:
            created_module_ids.add(module_3.id)

        print(f"House {order.house_identifier} / work_order {order.id}")
        if order.house_type_id != house_type.id:
            print(f"  house_type_id: {order.house_type_id} -> {house_type.id}")
            order.house_type_id = house_type.id
        else:
            print(f"  house_type_id already {house_type.id}")

        if created_module_3:
            print(f"  created missing MD3 work_unit {module_3.id}")
        else:
            print(f"  MD3 work_unit already exists as {module_3.id}")

        if module_3.planned_assembly_line != config.module_3_line:
            print(
                f"  MD3 line: {module_3.planned_assembly_line} -> {config.module_3_line}"
            )
            module_3.planned_assembly_line = config.module_3_line
        else:
            print(f"  MD3 line already {config.module_3_line}")

        if config.normalize_all_modules_to_planned:
            for module_number in MODULE_ORDER:
                work_unit = units_by_module[module_number]
                before = (work_unit.status, work_unit.current_station_id)
                work_unit.status = WorkUnitStatus.PLANNED
                work_unit.current_station_id = None
                after = (work_unit.status, work_unit.current_station_id)
                if before != after:
                    print(
                        f"  MD{module_number}: {before[0].value}/{before[1]} -> "
                        f"{after[0].value}/{after[1]}"
                    )
                panel_changes = _normalize_panels_to_planned(session, work_unit)
                for change in panel_changes:
                    print(f"  {change}")
        else:
            before = (module_3.status, module_3.current_station_id)
            module_3.status = config.module_3_status
            module_3.current_station_id = None
            after = (module_3.status, module_3.current_station_id)
            if before != after:
                print(
                    f"  MD3: {before[0].value}/{before[1]} -> "
                    f"{after[0].value}/{after[1]}"
                )
            panel_changes = _ensure_terminal_panel_units(
                session, module_3, module_3_panel_defs
            )
            for change in panel_changes:
                print(f"  {change}")

        print(f"  resulting state: {_summarize_order(order)}")
        print("-" * 72)

    sequence_changes = _assign_sequences(
        session, orders, placeholder_unit_ids=created_module_ids
    )
    if sequence_changes:
        print("Queue sequence adjustments:")
        preview_limit = 20
        for change in sequence_changes[:preview_limit]:
            print(f"  {change}")
        remaining = len(sequence_changes) - preview_limit
        if remaining > 0:
            print(f"  ... {remaining} more sequence changes")
    else:
        print("Queue sequence adjustments: no changes required")

    print("-" * 72)
    print("Final target state:")
    for order in orders:
        print(f"  {_summarize_order(order)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fix Nuevo Sol de Quillon houses 173-176 to Puelo Familiar."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Commit the correction. Default mode is dry-run.",
    )
    args = parser.parse_args()

    with SessionLocal() as session:
        _apply_fix(session, apply_changes=args.apply)
        if args.apply:
            session.commit()
            print("Committed changes.")
        else:
            session.rollback()
            print("Dry-run complete. Rolled back changes.")


if __name__ == "__main__":
    main()
