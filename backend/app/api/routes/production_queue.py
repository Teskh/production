from __future__ import annotations

from datetime import timedelta
import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.enums import PanelUnitStatus, TaskExceptionType, TaskScope, TaskStatus, WorkUnitStatus
from app.models.house import HouseSubType, HouseType, PanelDefinition
from app.models.stations import Station
from app.models.tasks import TaskApplicability, TaskDefinition, TaskException, TaskInstance
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.schemas.production_queue import (
    ProductionBatchCreate,
    ProductionQueueBulkDelete,
    ProductionQueueBulkUpdate,
    ProductionQueueItem,
    ProductionQueueModuleStatus,
    ProductionQueueReorder,
    ProductionQueueUpdate,
)
from app.services.task_applicability import resolve_task_station_sequence

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


def _order_task_definitions(
    task_definitions: list[TaskDefinition],
    panel_task_order: list[int] | None,
) -> list[TaskDefinition]:
    if panel_task_order is None:
        return sorted(task_definitions, key=lambda task: task.name.lower())
    order_index = {task_id: idx for idx, task_id in enumerate(panel_task_order)}
    ordered = [task for task in task_definitions if task.id in order_index]
    ordered.sort(key=lambda task: order_index[task.id])
    return ordered


def _pending_panel_tasks(
    station: Station,
    task_definitions: list[TaskDefinition],
    applicability_map: dict[int, list[TaskApplicability]],
    instances: list[TaskInstance],
    exceptions: list[TaskException],
    house_type_id: int,
    sub_type_id: int | None,
    module_number: int,
    panel_definition_id: int,
    panel_task_order: list[int] | None,
) -> list[dict[str, object]]:
    instance_map: dict[int, TaskInstance] = {}
    for instance in instances:
        existing = instance_map.get(instance.task_definition_id)
        if not existing or instance.id > existing.id:
            instance_map[instance.task_definition_id] = instance
    skipped_task_ids = {
        exc.task_definition_id
        for exc in exceptions
        if exc.exception_type == TaskExceptionType.SKIP
    }
    ordered_tasks = _order_task_definitions(task_definitions, panel_task_order)
    pending: list[dict[str, object]] = []
    for task in ordered_tasks:
        applies, station_sequence = resolve_task_station_sequence(
            task,
            applicability_map.get(task.id, []),
            house_type_id,
            sub_type_id,
            module_number,
            panel_definition_id,
        )
        if not applies:
            continue
        if (
            station_sequence is None
            or station.sequence_order is None
            or station_sequence != station.sequence_order
        ):
            continue
        status_value = TaskStatus.NOT_STARTED
        instance = instance_map.get(task.id)
        if instance:
            status_value = instance.status
        if task.id in skipped_task_ids:
            status_value = TaskStatus.SKIPPED
        if status_value in (TaskStatus.COMPLETED, TaskStatus.SKIPPED):
            continue
        pending.append(
            {
                "task_definition_id": task.id,
                "name": task.name,
                "status": status_value,
            }
        )
    return pending


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


@router.get("/items/{work_unit_id}/status", response_model=ProductionQueueModuleStatus)
def module_status(
    work_unit_id: int, db: Session = Depends(get_db)
) -> ProductionQueueModuleStatus:
    row = db.execute(
        select(WorkUnit, WorkOrder, HouseType, HouseSubType)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .join(HouseType, WorkOrder.house_type_id == HouseType.id)
        .outerjoin(HouseSubType, WorkOrder.sub_type_id == HouseSubType.id)
        .where(WorkUnit.id == work_unit_id)
    ).one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work unit not found")

    work_unit, work_order, house_type, sub_type = row
    house_identifier = work_order.house_identifier or f"WO-{work_order.id}"

    module_station = None
    if work_unit.current_station_id is not None:
        module_station = db.get(Station, work_unit.current_station_id)

    panel_definitions = list(
        db.execute(
            select(PanelDefinition)
            .where(PanelDefinition.house_type_id == work_order.house_type_id)
            .where(PanelDefinition.module_sequence_number == work_unit.module_number)
        ).scalars()
    )
    general = [panel_def for panel_def in panel_definitions if panel_def.sub_type_id is None]
    if work_order.sub_type_id is not None:
        specific = [
            panel_def
            for panel_def in panel_definitions
            if panel_def.sub_type_id == work_order.sub_type_id
        ]
        panel_definitions = general + specific
    else:
        panel_definitions = general

    panel_definitions.sort(
        key=lambda panel_def: (
            panel_def.panel_sequence_number or 9999,
            panel_def.panel_code or "",
        )
    )

    panel_units = list(
        db.execute(select(PanelUnit).where(PanelUnit.work_unit_id == work_unit.id)).scalars()
    )
    panel_unit_map = {panel_unit.panel_definition_id: panel_unit for panel_unit in panel_units}
    panel_unit_ids = [panel_unit.id for panel_unit in panel_units]

    station_ids = {
        panel_unit.current_station_id
        for panel_unit in panel_units
        if panel_unit.current_station_id is not None
    }
    stations = (
        list(db.execute(select(Station).where(Station.id.in_(station_ids))).scalars())
        if station_ids
        else []
    )
    station_map = {station.id: station for station in stations}

    task_definitions = []
    applicability_map: dict[int, list[TaskApplicability]] = {}
    if station_ids:
        task_definitions = list(
            db.execute(
                select(TaskDefinition)
                .where(TaskDefinition.active == True)
                .where(TaskDefinition.scope == TaskScope.PANEL)
            ).scalars()
        )
        if task_definitions:
            applicability_rows = list(
                db.execute(
                    select(TaskApplicability).where(
                        TaskApplicability.task_definition_id.in_(
                            [task.id for task in task_definitions]
                        )
                    )
                ).scalars()
            )
            for row in applicability_rows:
                applicability_map.setdefault(row.task_definition_id, []).append(row)

    task_instances: list[TaskInstance] = []
    task_exceptions: list[TaskException] = []
    if panel_unit_ids:
        task_instances = list(
            db.execute(
                select(TaskInstance)
                .where(TaskInstance.work_unit_id == work_unit.id)
                .where(TaskInstance.panel_unit_id.in_(panel_unit_ids))
            ).scalars()
        )
        task_exceptions = list(
            db.execute(
                select(TaskException)
                .where(TaskException.work_unit_id == work_unit.id)
                .where(TaskException.panel_unit_id.in_(panel_unit_ids))
            ).scalars()
        )

    instance_map: dict[tuple[int, int], list[TaskInstance]] = {}
    for instance in task_instances:
        key = (instance.panel_unit_id, instance.station_id)
        instance_map.setdefault(key, []).append(instance)
    exception_map: dict[tuple[int, int], list[TaskException]] = {}
    for exc in task_exceptions:
        key = (exc.panel_unit_id, exc.station_id)
        exception_map.setdefault(key, []).append(exc)

    panels = []
    for panel_def in panel_definitions:
        panel_unit = panel_unit_map.get(panel_def.id)
        status_value = panel_unit.status if panel_unit else PanelUnitStatus.PLANNED
        current_station_id = panel_unit.current_station_id if panel_unit else None
        current_station = (
            station_map.get(current_station_id) if current_station_id is not None else None
        )
        pending_tasks = []
        if panel_unit and current_station and task_definitions:
            pending_tasks = _pending_panel_tasks(
                current_station,
                task_definitions,
                applicability_map,
                instance_map.get((panel_unit.id, current_station.id), []),
                exception_map.get((panel_unit.id, current_station.id), []),
                work_order.house_type_id,
                work_order.sub_type_id,
                work_unit.module_number,
                panel_def.id,
                panel_def.applicable_task_ids,
            )
        panels.append(
            {
                "panel_definition_id": panel_def.id,
                "panel_unit_id": panel_unit.id if panel_unit else None,
                "panel_code": panel_def.panel_code,
                "status": status_value,
                "current_station_id": current_station_id,
                "current_station_name": current_station.name if current_station else None,
                "pending_tasks": pending_tasks,
            }
        )

    return ProductionQueueModuleStatus(
        work_unit_id=work_unit.id,
        work_order_id=work_order.id,
        project_name=work_order.project_name,
        house_identifier=house_identifier,
        module_number=work_unit.module_number,
        house_type_id=work_order.house_type_id,
        house_type_name=house_type.name,
        sub_type_id=work_order.sub_type_id,
        sub_type_name=sub_type.name if sub_type else None,
        status=work_unit.status,
        planned_assembly_line=_coerce_line(work_unit.planned_assembly_line),
        current_station_id=work_unit.current_station_id,
        current_station_name=module_station.name if module_station else None,
        panels=panels,
    )


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
        if any(unit.status == WorkUnitStatus.COMPLETED for unit in work_units):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change line for completed items",
            )
        for unit in work_units:
            unit.planned_assembly_line = line_value

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
