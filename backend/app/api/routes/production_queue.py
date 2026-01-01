from __future__ import annotations

from datetime import timedelta
import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.enums import WorkUnitStatus
from app.models.house import HouseSubType, HouseType
from app.models.work import WorkOrder, WorkUnit
from app.schemas.production_queue import (
    ProductionBatchCreate,
    ProductionQueueBulkDelete,
    ProductionQueueBulkUpdate,
    ProductionQueueItem,
    ProductionQueueReorder,
    ProductionQueueUpdate,
)

router = APIRouter()

_LINE_SEQUENCE = ("1", "2", "3")
_LINE_SET = set(_LINE_SEQUENCE)
_LINE_ALIASES = {"A": "1", "B": "2", "C": "3"}


def _coerce_line(line: str | None) -> str | None:
    if line is None:
        return None
    normalized = line.strip().upper()
    mapped = _LINE_ALIASES.get(normalized, normalized)
    if mapped in _LINE_SET:
        return mapped
    return None


def _normalize_line(line: str | None) -> str | None:
    if line is None:
        return None
    coerced = _coerce_line(line)
    if coerced is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assembly line must be 1, 2, or 3",
        )
    return coerced


def _split_identifier_base(base: str) -> tuple[str, int, int]:
    match = re.match(r"^(.*?)(\d+)$", base)
    if match:
        prefix, digits = match.groups()
        return prefix, int(digits), len(digits)
    prefix = base
    if not prefix.endswith(("-", "_")):
        prefix = f"{prefix}-"
    return prefix, 1, 2


def _generate_house_identifiers(base: str, quantity: int) -> list[str]:
    prefix, start, width = _split_identifier_base(base)
    return [
        f"{prefix}{str(start + offset).zfill(width)}" for offset in range(quantity)
    ]


def _queue_item_select() -> tuple:
    return (
        WorkUnit.id,
        WorkUnit.work_order_id,
        WorkUnit.planned_sequence,
        WorkOrder.project_name,
        WorkOrder.house_identifier,
        WorkUnit.module_number,
        WorkOrder.house_type_id,
        HouseType.name.label("house_type_name"),
        WorkOrder.sub_type_id,
        HouseSubType.name.label("sub_type_name"),
        WorkUnit.planned_start_datetime,
        WorkUnit.planned_assembly_line,
        WorkUnit.status,
    )


def _build_queue_items(rows: list[tuple]) -> list[ProductionQueueItem]:
    items = []
    for row in rows:
        (
            work_unit_id,
            work_order_id,
            planned_sequence,
            project_name,
            house_identifier,
            module_number,
            house_type_id,
            house_type_name,
            sub_type_id,
            sub_type_name,
            planned_start_datetime,
            planned_assembly_line,
            status_value,
        ) = row
        items.append(
            ProductionQueueItem(
                id=work_unit_id,
                work_order_id=work_order_id,
                planned_sequence=planned_sequence or 0,
                project_name=project_name,
                house_identifier=house_identifier or f"WO-{work_order_id}",
                module_number=module_number,
                house_type_id=house_type_id,
                house_type_name=house_type_name,
                sub_type_id=sub_type_id,
                sub_type_name=sub_type_name,
                planned_start_datetime=planned_start_datetime,
                planned_assembly_line=_coerce_line(planned_assembly_line),
                status=status_value,
            )
        )
    return items


def _fetch_queue_items(db: Session, include_completed: bool) -> list[ProductionQueueItem]:
    stmt = (
        select(*_queue_item_select())
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
        .outerjoin(HouseSubType, WorkOrder.sub_type_id == HouseSubType.id)
    )
    if not include_completed:
        stmt = stmt.where(WorkUnit.status != WorkUnitStatus.COMPLETED)
    stmt = stmt.order_by(WorkUnit.planned_sequence.nulls_last(), WorkUnit.id)
    rows = list(db.execute(stmt).all())
    return _build_queue_items(rows)


@router.get("/", response_model=list[ProductionQueueItem])
def list_queue(
    include_completed: bool = True, db: Session = Depends(get_db)
) -> list[ProductionQueueItem]:
    return _fetch_queue_items(db, include_completed)


@router.post("/batches", response_model=list[ProductionQueueItem], status_code=status.HTTP_201_CREATED)
def create_batch(
    payload: ProductionBatchCreate, db: Session = Depends(get_db)
) -> list[ProductionQueueItem]:
    project_name = payload.project_name.strip()
    if not project_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Project name is required"
        )
    if payload.quantity < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Quantity must be at least 1",
        )
    base_identifier = payload.house_identifier_base.strip()
    if not base_identifier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="House identifier base is required",
        )

    house_type = db.get(HouseType, payload.house_type_id)
    if not house_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House type not found")

    subtype = None
    if payload.sub_type_id is not None:
        subtype = db.get(HouseSubType, payload.sub_type_id)
        if not subtype or subtype.house_type_id != house_type.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="House subtype does not belong to selected house type",
            )

    house_identifiers = _generate_house_identifiers(base_identifier, payload.quantity)
    existing_identifiers = list(
        db.execute(
            select(WorkOrder.house_identifier).where(
                WorkOrder.project_name == project_name,
                WorkOrder.house_identifier.in_(house_identifiers),
            )
        ).scalars()
    )
    if existing_identifiers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="House identifier already exists in this project",
        )

    planned_sequence = (
        db.execute(select(func.max(WorkUnit.planned_sequence))).scalar() or 0
    ) + 1
    planned_start = payload.planned_start_datetime
    normalized_line = _normalize_line(payload.planned_assembly_line)
    next_line_index = 0
    if normalized_line is None:
        last_line = db.execute(
            select(WorkUnit.planned_assembly_line)
            .where(WorkUnit.planned_assembly_line.isnot(None))
            .order_by(WorkUnit.planned_sequence.desc().nulls_last(), WorkUnit.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        coerced_line = _coerce_line(last_line)
        if coerced_line in _LINE_SET:
            next_line_index = (_LINE_SEQUENCE.index(coerced_line) + 1) % len(_LINE_SEQUENCE)

    created_work_unit_ids: list[int] = []
    for index, house_identifier in enumerate(house_identifiers):
        house_sequence_start = planned_sequence
        house_line = normalized_line or _LINE_SEQUENCE[
            (next_line_index + index) % len(_LINE_SEQUENCE)
        ]
        work_order = WorkOrder(
            project_name=project_name,
            house_identifier=house_identifier,
            house_type_id=house_type.id,
            sub_type_id=subtype.id if subtype else None,
            planned_sequence=house_sequence_start,
            planned_assembly_line=house_line,
        )
        db.add(work_order)
        db.flush()

        for module_number in range(house_type.number_of_modules, 0, -1):
            work_unit = WorkUnit(
                work_order_id=work_order.id,
                module_number=module_number,
                planned_sequence=planned_sequence,
                planned_start_datetime=planned_start,
                planned_assembly_line=house_line,
                status=WorkUnitStatus.PLANNED,
            )
            db.add(work_unit)
            db.flush()
            created_work_unit_ids.append(work_unit.id)
            planned_sequence += 1
            if planned_start is not None:
                planned_start = planned_start + timedelta(hours=1)

    db.commit()
    if not created_work_unit_ids:
        return []
    stmt = (
        select(*_queue_item_select())
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
        .outerjoin(HouseSubType, WorkOrder.sub_type_id == HouseSubType.id)
        .where(WorkUnit.id.in_(created_work_unit_ids))
        .order_by(WorkUnit.planned_sequence)
    )
    rows = list(db.execute(stmt).all())
    return _build_queue_items(rows)


@router.put("/reorder", response_model=list[ProductionQueueItem])
def reorder_queue(
    payload: ProductionQueueReorder, db: Session = Depends(get_db)
) -> list[ProductionQueueItem]:
    ordered_ids = payload.ordered_ids
    if not ordered_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No queue items provided"
        )
    unique_ids = list(dict.fromkeys(ordered_ids))
    units = list(
        db.execute(select(WorkUnit).where(WorkUnit.id.in_(unique_ids))).scalars()
    )
    id_to_unit = {unit.id: unit for unit in units}
    missing = [unit_id for unit_id in unique_ids if unit_id not in id_to_unit]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Queue item not found"
        )

    existing_units = list(
        db.execute(
            select(WorkUnit)
            .order_by(WorkUnit.planned_sequence.nulls_last(), WorkUnit.id)
        ).scalars()
    )
    remaining_units = [unit for unit in existing_units if unit.id not in id_to_unit]
    ordered_units = [id_to_unit[unit_id] for unit_id in unique_ids] + remaining_units

    for index, unit in enumerate(ordered_units, start=1):
        unit.planned_sequence = index

    order_min_sequences = list(
        db.execute(
            select(WorkUnit.work_order_id, func.min(WorkUnit.planned_sequence))
            .group_by(WorkUnit.work_order_id)
        ).all()
    )
    for work_order_id, min_sequence in order_min_sequences:
        work_order = db.get(WorkOrder, work_order_id)
        if work_order:
            work_order.planned_sequence = min_sequence

    db.commit()
    return _fetch_queue_items(db, include_completed=True)


def _apply_queue_updates(
    work_units: list[WorkUnit],
    payload: ProductionQueueUpdate | ProductionQueueBulkUpdate,
    db: Session,
) -> None:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return

    if "planned_assembly_line" in updates:
        line_value = _normalize_line(updates["planned_assembly_line"])
        order_ids = {unit.work_order_id for unit in work_units}
        related_units = list(
            db.execute(
                select(WorkUnit).where(WorkUnit.work_order_id.in_(order_ids))
            ).scalars()
        )
        if any(unit.status == WorkUnitStatus.COMPLETED for unit in related_units):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change line for completed items",
            )
        for unit in related_units:
            unit.planned_assembly_line = line_value
        for order_id in order_ids:
            order = db.get(WorkOrder, order_id)
            if order:
                order.planned_assembly_line = line_value

    if "planned_start_datetime" in updates:
        for unit in work_units:
            unit.planned_start_datetime = updates["planned_start_datetime"]

    if "status" in updates and updates["status"] is not None:
        for unit in work_units:
            unit.status = updates["status"]

    if "sub_type_id" in updates:
        new_subtype_id = updates["sub_type_id"]
        subtype = None
        if new_subtype_id is not None:
            subtype = db.get(HouseSubType, new_subtype_id)
            if not subtype:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="House subtype not found",
                )
        order_ids = {unit.work_order_id for unit in work_units}
        for order_id in order_ids:
            order = db.get(WorkOrder, order_id)
            if not order:
                continue
            if subtype and subtype.house_type_id != order.house_type_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="House subtype does not belong to selected house type",
                )
            order.sub_type_id = subtype.id if subtype else None


@router.patch("/items/{work_unit_id}", response_model=ProductionQueueItem)
def update_queue_item(
    work_unit_id: int, payload: ProductionQueueUpdate, db: Session = Depends(get_db)
) -> ProductionQueueItem:
    unit = db.get(WorkUnit, work_unit_id)
    if not unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Queue item not found")
    _apply_queue_updates([unit], payload, db)
    db.commit()
    items = _fetch_queue_items(db, include_completed=True)
    updated = next((item for item in items if item.id == work_unit_id), None)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Queue item not found")
    return updated


@router.patch("/items", response_model=list[ProductionQueueItem])
def bulk_update_queue(
    payload: ProductionQueueBulkUpdate, db: Session = Depends(get_db)
) -> list[ProductionQueueItem]:
    if not payload.work_unit_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No queue items provided"
        )
    units = list(
        db.execute(select(WorkUnit).where(WorkUnit.id.in_(payload.work_unit_ids))).scalars()
    )
    if len(units) != len(set(payload.work_unit_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Queue item not found")
    _apply_queue_updates(units, payload, db)
    db.commit()
    stmt = (
        select(*_queue_item_select())
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
        .outerjoin(HouseSubType, WorkOrder.sub_type_id == HouseSubType.id)
        .where(WorkUnit.id.in_(payload.work_unit_ids))
    )
    rows = list(db.execute(stmt).all())
    return _build_queue_items(rows)


@router.delete("/items/{work_unit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_queue_item(work_unit_id: int, db: Session = Depends(get_db)) -> None:
    unit = db.get(WorkUnit, work_unit_id)
    if not unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Queue item not found")
    work_order_id = unit.work_order_id
    db.delete(unit)
    db.flush()
    remaining = db.execute(
        select(func.count()).select_from(WorkUnit).where(WorkUnit.work_order_id == work_order_id)
    ).scalar_one()
    if remaining == 0:
        order = db.get(WorkOrder, work_order_id)
        if order:
            db.delete(order)
    db.commit()


@router.post("/items/bulk-delete", status_code=status.HTTP_204_NO_CONTENT)
def bulk_delete_queue_items(
    payload: ProductionQueueBulkDelete, db: Session = Depends(get_db)
) -> None:
    if not payload.work_unit_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No queue items provided"
        )
    units = list(
        db.execute(select(WorkUnit).where(WorkUnit.id.in_(payload.work_unit_ids))).scalars()
    )
    if len(units) != len(set(payload.work_unit_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Queue item not found")

    work_order_ids = {unit.work_order_id for unit in units}
    for unit in units:
        db.delete(unit)
    db.flush()

    for order_id in work_order_ids:
        remaining = db.execute(
            select(func.count()).select_from(WorkUnit).where(WorkUnit.work_order_id == order_id)
        ).scalar_one()
        if remaining == 0:
            order = db.get(WorkOrder, order_id)
            if order:
                db.delete(order)
    db.commit()
