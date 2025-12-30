from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.house import HouseSubType, HouseType, PanelDefinition
from app.models.tasks import AdvanceRule, TaskApplicability, TaskDefinition, TaskExpectedDuration
from app.schemas.tasks import (
    AdvanceRuleCreate,
    AdvanceRuleRead,
    AdvanceRuleUpdate,
    TaskApplicabilityCreate,
    TaskApplicabilityRead,
    TaskApplicabilityUpdate,
    TaskExpectedDurationCreate,
    TaskExpectedDurationRead,
    TaskExpectedDurationUpdate,
)

router = APIRouter()


@router.get("/applicability", response_model=list[TaskApplicabilityRead])
def list_task_applicability(db: Session = Depends(get_db)) -> list[TaskApplicability]:
    return list(db.execute(select(TaskApplicability).order_by(TaskApplicability.id)).scalars())


@router.post(
    "/applicability",
    response_model=TaskApplicabilityRead,
    status_code=status.HTTP_201_CREATED,
)
def create_task_applicability(
    payload: TaskApplicabilityCreate, db: Session = Depends(get_db)
) -> TaskApplicability:
    if not db.get(TaskDefinition, payload.task_definition_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Task definition not found"
        )
    if payload.house_type_id is not None and not db.get(HouseType, payload.house_type_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
        )
    if payload.sub_type_id is not None and not db.get(HouseSubType, payload.sub_type_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House subtype not found"
        )
    if payload.panel_definition_id is not None and not db.get(
        PanelDefinition, payload.panel_definition_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Panel definition not found"
        )
    row = TaskApplicability(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/applicability/{applicability_id}", response_model=TaskApplicabilityRead)
def get_task_applicability(
    applicability_id: int, db: Session = Depends(get_db)
) -> TaskApplicability:
    row = db.get(TaskApplicability, applicability_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task applicability not found"
        )
    return row


@router.put("/applicability/{applicability_id}", response_model=TaskApplicabilityRead)
def update_task_applicability(
    applicability_id: int,
    payload: TaskApplicabilityUpdate,
    db: Session = Depends(get_db),
) -> TaskApplicability:
    row = db.get(TaskApplicability, applicability_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task applicability not found"
        )
    updates = payload.model_dump(exclude_unset=True)
    if "task_definition_id" in updates and not db.get(
        TaskDefinition, updates["task_definition_id"]
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Task definition not found"
        )
    if "house_type_id" in updates and updates["house_type_id"] is not None:
        if not db.get(HouseType, updates["house_type_id"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
            )
    if "sub_type_id" in updates and updates["sub_type_id"] is not None:
        if not db.get(HouseSubType, updates["sub_type_id"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="House subtype not found"
            )
    if "panel_definition_id" in updates and updates["panel_definition_id"] is not None:
        if not db.get(PanelDefinition, updates["panel_definition_id"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Panel definition not found",
            )
    for key, value in updates.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/applicability/{applicability_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_applicability(
    applicability_id: int, db: Session = Depends(get_db)
) -> None:
    row = db.get(TaskApplicability, applicability_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task applicability not found"
        )
    db.delete(row)
    db.commit()


@router.get("/durations", response_model=list[TaskExpectedDurationRead])
def list_task_durations(db: Session = Depends(get_db)) -> list[TaskExpectedDuration]:
    return list(db.execute(select(TaskExpectedDuration).order_by(TaskExpectedDuration.id)).scalars())


@router.post("/durations", response_model=TaskExpectedDurationRead, status_code=status.HTTP_201_CREATED)
def create_task_duration(
    payload: TaskExpectedDurationCreate, db: Session = Depends(get_db)
) -> TaskExpectedDuration:
    if not db.get(TaskDefinition, payload.task_definition_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Task definition not found"
        )
    if payload.house_type_id is not None and not db.get(HouseType, payload.house_type_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
        )
    if payload.sub_type_id is not None and not db.get(HouseSubType, payload.sub_type_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House subtype not found"
        )
    if payload.panel_definition_id is not None and not db.get(
        PanelDefinition, payload.panel_definition_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Panel definition not found"
        )
    row = TaskExpectedDuration(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/durations/{duration_id}", response_model=TaskExpectedDurationRead)
def get_task_duration(
    duration_id: int, db: Session = Depends(get_db)
) -> TaskExpectedDuration:
    row = db.get(TaskExpectedDuration, duration_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task duration not found"
        )
    return row


@router.put("/durations/{duration_id}", response_model=TaskExpectedDurationRead)
def update_task_duration(
    duration_id: int, payload: TaskExpectedDurationUpdate, db: Session = Depends(get_db)
) -> TaskExpectedDuration:
    row = db.get(TaskExpectedDuration, duration_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task duration not found"
        )
    updates = payload.model_dump(exclude_unset=True)
    if "task_definition_id" in updates and not db.get(
        TaskDefinition, updates["task_definition_id"]
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Task definition not found"
        )
    if "house_type_id" in updates and updates["house_type_id"] is not None:
        if not db.get(HouseType, updates["house_type_id"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
            )
    if "sub_type_id" in updates and updates["sub_type_id"] is not None:
        if not db.get(HouseSubType, updates["sub_type_id"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="House subtype not found"
            )
    if "panel_definition_id" in updates and updates["panel_definition_id"] is not None:
        if not db.get(PanelDefinition, updates["panel_definition_id"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Panel definition not found",
            )
    for key, value in updates.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/durations/{duration_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_duration(duration_id: int, db: Session = Depends(get_db)) -> None:
    row = db.get(TaskExpectedDuration, duration_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task duration not found"
        )
    db.delete(row)
    db.commit()


@router.get("/advance-rules", response_model=list[AdvanceRuleRead])
def list_advance_rules(db: Session = Depends(get_db)) -> list[AdvanceRule]:
    return list(db.execute(select(AdvanceRule).order_by(AdvanceRule.id)).scalars())


@router.post("/advance-rules", response_model=AdvanceRuleRead, status_code=status.HTTP_201_CREATED)
def create_advance_rule(payload: AdvanceRuleCreate, db: Session = Depends(get_db)) -> AdvanceRule:
    if payload.house_type_id is not None and not db.get(HouseType, payload.house_type_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
        )
    if payload.sub_type_id is not None and not db.get(HouseSubType, payload.sub_type_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House subtype not found"
        )
    row = AdvanceRule(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/advance-rules/{rule_id}", response_model=AdvanceRuleRead)
def get_advance_rule(rule_id: int, db: Session = Depends(get_db)) -> AdvanceRule:
    row = db.get(AdvanceRule, rule_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Advance rule not found"
        )
    return row


@router.put("/advance-rules/{rule_id}", response_model=AdvanceRuleRead)
def update_advance_rule(
    rule_id: int, payload: AdvanceRuleUpdate, db: Session = Depends(get_db)
) -> AdvanceRule:
    row = db.get(AdvanceRule, rule_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Advance rule not found"
        )
    updates = payload.model_dump(exclude_unset=True)
    if "house_type_id" in updates and updates["house_type_id"] is not None:
        if not db.get(HouseType, updates["house_type_id"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
            )
    if "sub_type_id" in updates and updates["sub_type_id"] is not None:
        if not db.get(HouseSubType, updates["sub_type_id"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="House subtype not found"
            )
    for key, value in updates.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/advance-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_advance_rule(rule_id: int, db: Session = Depends(get_db)) -> None:
    row = db.get(AdvanceRule, rule_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Advance rule not found"
        )
    db.delete(row)
    db.commit()
