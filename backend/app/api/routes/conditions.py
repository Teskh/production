from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin, get_db
from app.models.admin import AdminUser
from app.models.conditions import (
    ConditionType,
    ConditionValue,
    TaskConditionRule,
    TaskConditionRuleValue,
    WorkUnitCondition,
)
from app.models.house import HouseType
from app.models.tasks import TaskDefinition
from app.models.work import WorkUnit
from app.schemas.conditions import (
    ConditionTypeCreate,
    ConditionTypeRead,
    ConditionTypeUpdate,
    ConditionValueCreate,
    ConditionValueRead,
    ConditionValueUpdate,
    TaskConditionRuleBase,
    TaskConditionRuleRead,
    TaskConditionRulesUpdate,
    WorkUnitConditionRead,
    WorkUnitConditionsBulkUpdate,
    WorkUnitConditionsUpdate,
)

router = APIRouter()


def _rule_to_read(rule: TaskConditionRule) -> TaskConditionRuleRead:
    return TaskConditionRuleRead(
        id=rule.id,
        task_definition_id=rule.task_definition_id,
        condition_type_id=rule.condition_type_id,
        house_type_id=rule.house_type_id,
        mode=rule.mode,
        condition_value_ids=sorted(
            value.condition_value_id for value in rule.rule_values
        ),
    )


def _validated_condition_value_ids(db: Session, condition_value_ids: list[int]) -> list[int]:
    unique_ids = list(dict.fromkeys(condition_value_ids))
    if not unique_ids:
        return []
    found_ids = set(
        db.execute(
            select(ConditionValue.id).where(ConditionValue.id.in_(unique_ids))
        ).scalars()
    )
    missing = [value_id for value_id in unique_ids if value_id not in found_ids]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Condition value not found",
        )
    return unique_ids


@router.get("/types", response_model=list[ConditionTypeRead])
def list_condition_types(db: Session = Depends(get_db)) -> list[ConditionType]:
    return list(
        db.execute(
            select(ConditionType)
            .options(selectinload(ConditionType.values))
            .order_by(ConditionType.name)
        ).scalars()
    )


@router.post("/types", response_model=ConditionTypeRead, status_code=status.HTTP_201_CREATED)
def create_condition_type(
    payload: ConditionTypeCreate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> ConditionType:
    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required"
        )
    existing = db.execute(
        select(ConditionType).where(ConditionType.name == name)
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Condition type already exists"
        )
    row = ConditionType(name=name, active=payload.active)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/types/{type_id}", response_model=ConditionTypeRead)
def update_condition_type(
    type_id: int,
    payload: ConditionTypeUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> ConditionType:
    row = db.get(ConditionType, type_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Condition type not found"
        )
    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates:
        name = updates["name"].strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required"
            )
        duplicate = db.execute(
            select(ConditionType)
            .where(ConditionType.name == name)
            .where(ConditionType.id != type_id)
        ).scalar_one_or_none()
        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Condition type already exists",
            )
        row.name = name
    if "active" in updates and updates["active"] is not None:
        row.active = updates["active"]
    db.commit()
    db.refresh(row)
    return row


@router.delete("/types/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_condition_type(
    type_id: int,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> None:
    row = db.get(ConditionType, type_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Condition type not found"
        )
    value_ids = [value.id for value in row.values]
    in_use = None
    if value_ids:
        in_use = db.execute(
            select(TaskConditionRuleValue.id)
            .where(TaskConditionRuleValue.condition_value_id.in_(value_ids))
            .limit(1)
        ).scalar_one_or_none()
        if in_use is None:
            in_use = db.execute(
                select(WorkUnitCondition.id)
                .where(WorkUnitCondition.condition_value_id.in_(value_ids))
                .limit(1)
            ).scalar_one_or_none()
    if in_use is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Condition type is in use by tasks or production items. "
                "Deactivate it instead."
            ),
        )
    db.delete(row)
    db.commit()


@router.post("/values", response_model=ConditionValueRead, status_code=status.HTTP_201_CREATED)
def create_condition_value(
    payload: ConditionValueCreate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> ConditionValue:
    if not db.get(ConditionType, payload.condition_type_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Condition type not found"
        )
    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required"
        )
    existing = db.execute(
        select(ConditionValue)
        .where(ConditionValue.condition_type_id == payload.condition_type_id)
        .where(ConditionValue.name == name)
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Condition value already exists for this type",
        )
    row = ConditionValue(condition_type_id=payload.condition_type_id, name=name)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/values/{value_id}", response_model=ConditionValueRead)
def update_condition_value(
    value_id: int,
    payload: ConditionValueUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> ConditionValue:
    row = db.get(ConditionValue, value_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Condition value not found"
        )
    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates:
        name = updates["name"].strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required"
            )
        duplicate = db.execute(
            select(ConditionValue)
            .where(ConditionValue.condition_type_id == row.condition_type_id)
            .where(ConditionValue.name == name)
            .where(ConditionValue.id != value_id)
        ).scalar_one_or_none()
        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Condition value already exists for this type",
            )
        row.name = name
    db.commit()
    db.refresh(row)
    return row


@router.delete("/values/{value_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_condition_value(
    value_id: int,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> None:
    row = db.get(ConditionValue, value_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Condition value not found"
        )
    in_use = db.execute(
        select(TaskConditionRuleValue.id)
        .where(TaskConditionRuleValue.condition_value_id == value_id)
        .limit(1)
    ).scalar_one_or_none()
    if in_use is None:
        in_use = db.execute(
            select(WorkUnitCondition.id)
            .where(WorkUnitCondition.condition_value_id == value_id)
            .limit(1)
        ).scalar_one_or_none()
    if in_use is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Condition value is in use by tasks or production items",
        )
    db.delete(row)
    db.commit()


def _validate_rules(db: Session, rules: list[TaskConditionRuleBase]) -> None:
    type_ids = {rule.condition_type_id for rule in rules}
    house_type_ids = {
        rule.house_type_id for rule in rules if rule.house_type_id is not None
    }
    all_value_ids = {
        value_id for rule in rules for value_id in rule.condition_value_ids
    }

    if type_ids:
        found_type_ids = set(
            db.execute(
                select(ConditionType.id).where(ConditionType.id.in_(type_ids))
            ).scalars()
        )
        if found_type_ids != type_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Condition type not found",
            )
    if house_type_ids:
        found_house_ids = set(
            db.execute(
                select(HouseType.id).where(HouseType.id.in_(house_type_ids))
            ).scalars()
        )
        if found_house_ids != house_type_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
            )

    value_type_map: dict[int, int] = {}
    if all_value_ids:
        value_type_map = {
            value_id: condition_type_id
            for value_id, condition_type_id in db.execute(
                select(ConditionValue.id, ConditionValue.condition_type_id).where(
                    ConditionValue.id.in_(all_value_ids)
                )
            ).all()
        }
    for rule in rules:
        for value_id in rule.condition_value_ids:
            if value_type_map.get(value_id) != rule.condition_type_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "Condition values must belong to the rule's condition type"
                    ),
                )


@router.get("/task-requirements", response_model=list[TaskConditionRuleRead])
def list_task_condition_rules(
    db: Session = Depends(get_db),
) -> list[TaskConditionRuleRead]:
    rules = list(
        db.execute(
            select(TaskConditionRule)
            .options(selectinload(TaskConditionRule.rule_values))
            .order_by(TaskConditionRule.id)
        ).scalars()
    )
    return [_rule_to_read(rule) for rule in rules]


@router.put(
    "/task-requirements/{task_definition_id}",
    response_model=list[TaskConditionRuleRead],
)
def set_task_condition_rules(
    task_definition_id: int,
    payload: TaskConditionRulesUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> list[TaskConditionRuleRead]:
    if not db.get(TaskDefinition, task_definition_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    _validate_rules(db, payload.rules)
    existing = list(
        db.execute(
            select(TaskConditionRule).where(
                TaskConditionRule.task_definition_id == task_definition_id
            )
        ).scalars()
    )
    for rule in existing:
        db.delete(rule)
    db.flush()
    for rule_payload in payload.rules:
        rule = TaskConditionRule(
            task_definition_id=task_definition_id,
            condition_type_id=rule_payload.condition_type_id,
            house_type_id=rule_payload.house_type_id,
            mode=rule_payload.mode,
        )
        db.add(rule)
        db.flush()
        for value_id in dict.fromkeys(rule_payload.condition_value_ids):
            db.add(
                TaskConditionRuleValue(rule_id=rule.id, condition_value_id=value_id)
            )
    db.commit()
    rules = list(
        db.execute(
            select(TaskConditionRule)
            .options(selectinload(TaskConditionRule.rule_values))
            .where(TaskConditionRule.task_definition_id == task_definition_id)
            .order_by(TaskConditionRule.id)
        ).scalars()
    )
    return [_rule_to_read(rule) for rule in rules]


@router.get("/work-units", response_model=list[WorkUnitConditionRead])
def list_work_unit_conditions(
    db: Session = Depends(get_db),
) -> list[WorkUnitCondition]:
    return list(
        db.execute(select(WorkUnitCondition).order_by(WorkUnitCondition.id)).scalars()
    )


@router.put(
    "/work-units/{work_unit_id}",
    response_model=list[WorkUnitConditionRead],
)
def set_work_unit_conditions(
    work_unit_id: int,
    payload: WorkUnitConditionsUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> list[WorkUnitCondition]:
    if not db.get(WorkUnit, work_unit_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Work unit not found"
        )
    value_ids = _validated_condition_value_ids(db, payload.condition_value_ids)
    db.execute(
        delete(WorkUnitCondition).where(WorkUnitCondition.work_unit_id == work_unit_id)
    )
    rows = [
        WorkUnitCondition(work_unit_id=work_unit_id, condition_value_id=value_id)
        for value_id in value_ids
    ]
    db.add_all(rows)
    db.commit()
    return list(
        db.execute(
            select(WorkUnitCondition)
            .where(WorkUnitCondition.work_unit_id == work_unit_id)
            .order_by(WorkUnitCondition.id)
        ).scalars()
    )


@router.post("/work-units/bulk", response_model=list[WorkUnitConditionRead])
def bulk_update_work_unit_conditions(
    payload: WorkUnitConditionsBulkUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> list[WorkUnitCondition]:
    unit_ids = list(dict.fromkeys(payload.work_unit_ids))
    found_unit_ids = set(
        db.execute(select(WorkUnit.id).where(WorkUnit.id.in_(unit_ids))).scalars()
    )
    if len(found_unit_ids) != len(unit_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Work unit not found"
        )

    replace_ids = (
        _validated_condition_value_ids(db, payload.replace_value_ids)
        if payload.replace_value_ids is not None
        else None
    )
    add_ids = _validated_condition_value_ids(db, payload.add_value_ids)
    remove_ids = set(payload.remove_value_ids)

    existing_rows = list(
        db.execute(
            select(WorkUnitCondition).where(
                WorkUnitCondition.work_unit_id.in_(unit_ids)
            )
        ).scalars()
    )
    existing_by_unit: dict[int, dict[int, WorkUnitCondition]] = {}
    for row in existing_rows:
        existing_by_unit.setdefault(row.work_unit_id, {})[row.condition_value_id] = row

    for unit_id in unit_ids:
        current = existing_by_unit.get(unit_id, {})
        if replace_ids is not None:
            desired = set(replace_ids)
        else:
            desired = (set(current) | set(add_ids)) - remove_ids
        for value_id, row in current.items():
            if value_id not in desired:
                db.delete(row)
        for value_id in desired - set(current):
            db.add(WorkUnitCondition(work_unit_id=unit_id, condition_value_id=value_id))

    db.commit()
    return list(
        db.execute(
            select(WorkUnitCondition)
            .where(WorkUnitCondition.work_unit_id.in_(unit_ids))
            .order_by(WorkUnitCondition.work_unit_id, WorkUnitCondition.id)
        ).scalars()
    )
