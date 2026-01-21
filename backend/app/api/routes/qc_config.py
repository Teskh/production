import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin, get_db
from app.core.config import BASE_DIR
from app.models.house import HouseSubType, HouseType, PanelDefinition
from app.models.qc import (
    QCApplicability,
    QCApplicabilityHouseType,
    QCApplicabilityPanelGroup,
    QCApplicabilitySubType,
    QCCheckCategory,
    QCCheckDefinition,
    QCCheckMediaAsset,
    QCFailureModeDefinition,
    QCTrigger,
)
from app.models.enums import (
    QCCheckKind,
    QCCheckMediaType,
    QCSeverityLevel,
    QCTriggerEventType,
)
from app.models.tasks import TaskDefinition
from app.schemas.qc import (
    QCApplicabilityCreate,
    QCApplicabilityRead,
    QCApplicabilityUpdate,
    QCCheckCategoryCreate,
    QCCheckCategoryRead,
    QCCheckCategoryUpdate,
    QCCheckDefinitionCreate,
    QCCheckDefinitionRead,
    QCCheckDefinitionUpdate,
    QCCheckMediaAssetRead,
    QCFailureModeDefinitionCreate,
    QCFailureModeDefinitionRead,
    QCFailureModeDefinitionUpdate,
    QCTriggerCreate,
    QCTriggerRead,
    QCTriggerUpdate,
)

router = APIRouter(dependencies=[Depends(get_current_admin)])

MEDIA_GALLERY_DIR = BASE_DIR / "media_gallery"


def _require_check_definition(db: Session, check_definition_id: int) -> QCCheckDefinition:
    check = db.get(QCCheckDefinition, check_definition_id)
    if not check:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="QC check definition not found"
        )
    return check


def _require_category(db: Session, category_id: int) -> QCCheckCategory:
    category = db.get(QCCheckCategory, category_id)
    if not category:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="QC category not found"
        )
    return category


def _validate_sampling_value(value: float | None, field_name: str) -> None:
    if value is None:
        return
    if value < 0 or value > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must be between 0 and 1",
        )


def _validate_trigger_params(
    db: Session,
    event_type: QCTriggerEventType,
    params_json: dict | None,
) -> None:
    if params_json is None:
        return
    if not isinstance(params_json, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="params_json must be an object",
        )
    if event_type == QCTriggerEventType.TASK_COMPLETED:
        task_ids = params_json.get("task_definition_ids")
        if task_ids is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="params_json must include task_definition_ids for task_completed",
            )
        if not isinstance(task_ids, list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="task_definition_ids must be a list",
            )
        unique_ids = sorted({int(task_id) for task_id in task_ids}) if task_ids else []
        if unique_ids:
            rows = list(
                db.execute(
                    select(TaskDefinition.id).where(TaskDefinition.id.in_(unique_ids))
                ).scalars()
            )
            if len(rows) != len(unique_ids):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="One or more task definitions not found",
                )


def _validate_applicability_refs(
    db: Session,
    house_type_ids: list[int],
    sub_type_ids: list[int],
    panel_groups: list[str],
) -> None:
    if house_type_ids:
        unique_ids = sorted(set(house_type_ids))
        rows = list(
            db.execute(
                select(HouseType.id).where(HouseType.id.in_(unique_ids))
            ).scalars()
        )
        if len(rows) != len(unique_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
            )
    if sub_type_ids:
        unique_ids = sorted(set(sub_type_ids))
        rows = list(
            db.execute(
                select(HouseSubType.id, HouseSubType.house_type_id).where(
                    HouseSubType.id.in_(unique_ids)
                )
            ).all()
        )
        if len(rows) != len(unique_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="House subtype not found"
            )
        if house_type_ids:
            allowed_house_type_ids = set(house_type_ids)
            for _, house_type_id in rows:
                if house_type_id not in allowed_house_type_ids:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="House subtype does not match selected house types",
                    )
    if panel_groups:
        unique_groups = sorted(set(panel_groups))
        rows = list(
            db.execute(
                select(PanelDefinition.group)
                .where(PanelDefinition.group.in_(unique_groups))
                .distinct()
            ).scalars()
        )
        if len(rows) != len(unique_groups):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Panel group not found",
            )


def _unique_list(values: list) -> list:
    seen = set()
    result = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _normalize_panel_groups(groups: list[str]) -> list[str]:
    normalized = []
    for group in groups:
        trimmed = group.strip()
        if trimmed:
            normalized.append(trimmed)
    return _unique_list(normalized)


@router.get("/categories", response_model=list[QCCheckCategoryRead])
def list_qc_categories(db: Session = Depends(get_db)) -> list[QCCheckCategory]:
    return list(
        db.execute(
            select(QCCheckCategory).order_by(QCCheckCategory.sort_order, QCCheckCategory.name)
        ).scalars()
    )


@router.post("/categories", response_model=QCCheckCategoryRead, status_code=status.HTTP_201_CREATED)
def create_qc_category(
    payload: QCCheckCategoryCreate, db: Session = Depends(get_db)
) -> QCCheckCategory:
    if payload.parent_id is not None:
        _require_category(db, payload.parent_id)
    category = QCCheckCategory(**payload.model_dump())
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.get("/categories/{category_id}", response_model=QCCheckCategoryRead)
def get_qc_category(category_id: int, db: Session = Depends(get_db)) -> QCCheckCategory:
    category = db.get(QCCheckCategory, category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC category not found")
    return category


@router.put("/categories/{category_id}", response_model=QCCheckCategoryRead)
def update_qc_category(
    category_id: int, payload: QCCheckCategoryUpdate, db: Session = Depends(get_db)
) -> QCCheckCategory:
    category = db.get(QCCheckCategory, category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC category not found")
    updates = payload.model_dump(exclude_unset=True)
    parent_id = updates.get("parent_id")
    if parent_id is not None:
        if parent_id == category_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Category cannot be its own parent",
            )
        _require_category(db, parent_id)
    for key, value in updates.items():
        setattr(category, key, value)
    db.commit()
    db.refresh(category)
    return category


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_qc_category(category_id: int, db: Session = Depends(get_db)) -> None:
    category = db.get(QCCheckCategory, category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC category not found")
    db.delete(category)
    db.commit()


@router.get("/check-definitions", response_model=list[QCCheckDefinitionRead])
def list_check_definitions(db: Session = Depends(get_db)) -> list[QCCheckDefinition]:
    return list(
        db.execute(select(QCCheckDefinition).order_by(QCCheckDefinition.name)).scalars()
    )


@router.post("/check-definitions", response_model=QCCheckDefinitionRead, status_code=status.HTTP_201_CREATED)
def create_check_definition(
    payload: QCCheckDefinitionCreate, db: Session = Depends(get_db)
) -> QCCheckDefinition:
    if payload.category_id is not None:
        _require_category(db, payload.category_id)
    check = QCCheckDefinition(**payload.model_dump())
    db.add(check)
    db.commit()
    db.refresh(check)
    return check


@router.get("/check-definitions/{check_definition_id}", response_model=QCCheckDefinitionRead)
def get_check_definition(
    check_definition_id: int, db: Session = Depends(get_db)
) -> QCCheckDefinition:
    return _require_check_definition(db, check_definition_id)


@router.put("/check-definitions/{check_definition_id}", response_model=QCCheckDefinitionRead)
def update_check_definition(
    check_definition_id: int, payload: QCCheckDefinitionUpdate, db: Session = Depends(get_db)
) -> QCCheckDefinition:
    check = _require_check_definition(db, check_definition_id)
    updates = payload.model_dump(exclude_unset=True)
    if "category_id" in updates and updates["category_id"] is not None:
        _require_category(db, updates["category_id"])
    for key, value in updates.items():
        setattr(check, key, value)
    db.commit()
    db.refresh(check)
    return check


@router.delete("/check-definitions/{check_definition_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_check_definition(check_definition_id: int, db: Session = Depends(get_db)) -> None:
    check = _require_check_definition(db, check_definition_id)
    db.delete(check)
    db.commit()


@router.get("/triggers", response_model=list[QCTriggerRead])
def list_triggers(db: Session = Depends(get_db)) -> list[QCTrigger]:
    return list(db.execute(select(QCTrigger).order_by(QCTrigger.id)).scalars())


@router.post("/triggers", response_model=QCTriggerRead, status_code=status.HTTP_201_CREATED)
def create_trigger(
    payload: QCTriggerCreate, db: Session = Depends(get_db)
) -> QCTrigger:
    check = _require_check_definition(db, payload.check_definition_id)
    if check.kind != QCCheckKind.TRIGGERED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Triggers can only be added to triggered checks",
        )
    _validate_sampling_value(payload.sampling_rate, "sampling_rate")
    _validate_sampling_value(payload.sampling_step, "sampling_step")
    _validate_trigger_params(db, payload.event_type, payload.params_json)
    trigger = QCTrigger(**payload.model_dump())
    db.add(trigger)
    db.commit()
    db.refresh(trigger)
    return trigger


@router.get("/triggers/{trigger_id}", response_model=QCTriggerRead)
def get_trigger(trigger_id: int, db: Session = Depends(get_db)) -> QCTrigger:
    trigger = db.get(QCTrigger, trigger_id)
    if not trigger:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC trigger not found")
    return trigger


@router.put("/triggers/{trigger_id}", response_model=QCTriggerRead)
def update_trigger(
    trigger_id: int, payload: QCTriggerUpdate, db: Session = Depends(get_db)
) -> QCTrigger:
    trigger = db.get(QCTrigger, trigger_id)
    if not trigger:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC trigger not found")
    updates = payload.model_dump(exclude_unset=True)
    check_definition_id = updates.get("check_definition_id", trigger.check_definition_id)
    check = _require_check_definition(db, check_definition_id)
    if check.kind != QCCheckKind.TRIGGERED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Triggers can only be added to triggered checks",
        )
    event_type = updates.get("event_type", trigger.event_type)
    params_json = updates.get("params_json", trigger.params_json)
    _validate_sampling_value(updates.get("sampling_rate"), "sampling_rate")
    _validate_sampling_value(updates.get("sampling_step"), "sampling_step")
    _validate_trigger_params(db, event_type, params_json)
    for key, value in updates.items():
        setattr(trigger, key, value)
    db.commit()
    db.refresh(trigger)
    return trigger


@router.delete("/triggers/{trigger_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trigger(trigger_id: int, db: Session = Depends(get_db)) -> None:
    trigger = db.get(QCTrigger, trigger_id)
    if not trigger:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC trigger not found")
    db.delete(trigger)
    db.commit()


@router.get("/applicability", response_model=list[QCApplicabilityRead])
def list_applicability(db: Session = Depends(get_db)) -> list[QCApplicability]:
    return list(
        db.execute(
            select(QCApplicability)
            .options(
                selectinload(QCApplicability.house_type_links),
                selectinload(QCApplicability.sub_type_links),
                selectinload(QCApplicability.panel_group_links),
            )
            .order_by(QCApplicability.id)
        ).scalars()
    )


@router.post("/applicability", response_model=QCApplicabilityRead, status_code=status.HTTP_201_CREATED)
def create_applicability(
    payload: QCApplicabilityCreate, db: Session = Depends(get_db)
) -> QCApplicability:
    _require_check_definition(db, payload.check_definition_id)
    house_type_ids = _unique_list(payload.house_type_ids)
    sub_type_ids = _unique_list(payload.sub_type_ids)
    panel_groups = _normalize_panel_groups(payload.panel_groups)
    _validate_applicability_refs(db, house_type_ids, sub_type_ids, panel_groups)
    rule = QCApplicability(check_definition_id=payload.check_definition_id)
    rule.house_type_links = [
        QCApplicabilityHouseType(house_type_id=house_type_id)
        for house_type_id in house_type_ids
    ]
    rule.sub_type_links = [
        QCApplicabilitySubType(sub_type_id=sub_type_id)
        for sub_type_id in sub_type_ids
    ]
    rule.panel_group_links = [
        QCApplicabilityPanelGroup(panel_group=panel_group)
        for panel_group in panel_groups
    ]
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.get("/applicability/{applicability_id}", response_model=QCApplicabilityRead)
def get_applicability(
    applicability_id: int, db: Session = Depends(get_db)
) -> QCApplicability:
    rule = db.execute(
        select(QCApplicability)
        .options(
            selectinload(QCApplicability.house_type_links),
            selectinload(QCApplicability.sub_type_links),
            selectinload(QCApplicability.panel_group_links),
        )
        .where(QCApplicability.id == applicability_id)
    ).scalar_one_or_none()
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="QC applicability rule not found"
        )
    return rule


@router.put("/applicability/{applicability_id}", response_model=QCApplicabilityRead)
def update_applicability(
    applicability_id: int, payload: QCApplicabilityUpdate, db: Session = Depends(get_db)
) -> QCApplicability:
    rule = db.execute(
        select(QCApplicability)
        .options(
            selectinload(QCApplicability.house_type_links),
            selectinload(QCApplicability.sub_type_links),
            selectinload(QCApplicability.panel_group_links),
        )
        .where(QCApplicability.id == applicability_id)
    ).scalar_one_or_none()
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="QC applicability rule not found"
        )
    updates = payload.model_dump(exclude_unset=True)
    if "check_definition_id" in updates:
        _require_check_definition(db, updates["check_definition_id"])
    if "house_type_ids" in updates:
        updates["house_type_ids"] = _unique_list(updates["house_type_ids"] or [])
    if "sub_type_ids" in updates:
        updates["sub_type_ids"] = _unique_list(updates["sub_type_ids"] or [])
    if "panel_groups" in updates:
        updates["panel_groups"] = _normalize_panel_groups(updates["panel_groups"] or [])

    house_type_ids = updates.get("house_type_ids", rule.house_type_ids)
    sub_type_ids = updates.get("sub_type_ids", rule.sub_type_ids)
    panel_groups = updates.get("panel_groups", rule.panel_groups)
    _validate_applicability_refs(db, house_type_ids, sub_type_ids, panel_groups)

    for key, value in updates.items():
        if key == "house_type_ids":
            rule.house_type_links = [
                QCApplicabilityHouseType(house_type_id=house_type_id)
                for house_type_id in value
            ]
        elif key == "sub_type_ids":
            rule.sub_type_links = [
                QCApplicabilitySubType(sub_type_id=sub_type_id)
                for sub_type_id in value
            ]
        elif key == "panel_groups":
            rule.panel_group_links = [
                QCApplicabilityPanelGroup(panel_group=panel_group)
                for panel_group in value
            ]
        else:
            setattr(rule, key, value)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/applicability/{applicability_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_applicability(applicability_id: int, db: Session = Depends(get_db)) -> None:
    rule = db.get(QCApplicability, applicability_id)
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="QC applicability rule not found"
        )
    db.delete(rule)
    db.commit()


@router.get("/failure-modes", response_model=list[QCFailureModeDefinitionRead])
def list_failure_modes(db: Session = Depends(get_db)) -> list[QCFailureModeDefinition]:
    return list(
        db.execute(
            select(QCFailureModeDefinition).order_by(QCFailureModeDefinition.name)
        ).scalars()
    )


@router.post("/failure-modes", response_model=QCFailureModeDefinitionRead, status_code=status.HTTP_201_CREATED)
def create_failure_mode(
    payload: QCFailureModeDefinitionCreate, db: Session = Depends(get_db)
) -> QCFailureModeDefinition:
    if payload.check_definition_id is not None:
        _require_check_definition(db, payload.check_definition_id)
    if payload.default_severity_level is not None and payload.default_severity_level not in QCSeverityLevel:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="QC severity level not found"
        )
    failure_mode = QCFailureModeDefinition(**payload.model_dump())
    db.add(failure_mode)
    db.commit()
    db.refresh(failure_mode)
    return failure_mode


@router.get("/failure-modes/{failure_mode_id}", response_model=QCFailureModeDefinitionRead)
def get_failure_mode(
    failure_mode_id: int, db: Session = Depends(get_db)
) -> QCFailureModeDefinition:
    mode = db.get(QCFailureModeDefinition, failure_mode_id)
    if not mode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC failure mode not found")
    return mode


@router.put("/failure-modes/{failure_mode_id}", response_model=QCFailureModeDefinitionRead)
def update_failure_mode(
    failure_mode_id: int, payload: QCFailureModeDefinitionUpdate, db: Session = Depends(get_db)
) -> QCFailureModeDefinition:
    mode = db.get(QCFailureModeDefinition, failure_mode_id)
    if not mode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC failure mode not found")
    updates = payload.model_dump(exclude_unset=True)
    if "check_definition_id" in updates and updates["check_definition_id"] is not None:
        _require_check_definition(db, updates["check_definition_id"])
    if "default_severity_level" in updates and updates["default_severity_level"] is not None:
        if updates["default_severity_level"] not in QCSeverityLevel:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="QC severity level not found"
            )
    for key, value in updates.items():
        setattr(mode, key, value)
    db.commit()
    db.refresh(mode)
    return mode


@router.delete("/failure-modes/{failure_mode_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_failure_mode(failure_mode_id: int, db: Session = Depends(get_db)) -> None:
    mode = db.get(QCFailureModeDefinition, failure_mode_id)
    if not mode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC failure mode not found")
    db.delete(mode)
    db.commit()


@router.get("/check-media", response_model=list[QCCheckMediaAssetRead])
def list_check_media(
    check_definition_id: int | None = None, db: Session = Depends(get_db)
) -> list[QCCheckMediaAsset]:
    query = select(QCCheckMediaAsset).order_by(QCCheckMediaAsset.created_at.desc())
    if check_definition_id is not None:
        query = query.where(QCCheckMediaAsset.check_definition_id == check_definition_id)
    return list(db.execute(query).scalars())


@router.post(
    "/check-media",
    response_model=QCCheckMediaAssetRead,
    status_code=status.HTTP_201_CREATED,
)
def create_check_media(
    check_definition_id: int = Form(...),
    media_type: QCCheckMediaType = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> QCCheckMediaAsset:
    _require_check_definition(db, check_definition_id)
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only image uploads are supported",
        )

    suffix = Path(file.filename or "").suffix.lower() or ".jpg"
    safe_name = f"{uuid4().hex}{suffix}"
    target_dir = MEDIA_GALLERY_DIR / str(check_definition_id) / media_type.value
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / safe_name

    with target_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    uri = f"/media_gallery/{check_definition_id}/{media_type.value}/{safe_name}"
    asset = QCCheckMediaAsset(
        check_definition_id=check_definition_id,
        media_type=media_type,
        uri=uri,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


@router.delete("/check-media/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_check_media(media_id: int, db: Session = Depends(get_db)) -> None:
    asset = db.get(QCCheckMediaAsset, media_id)
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="QC check media not found"
        )
    file_path = BASE_DIR / asset.uri.lstrip("/")
    if file_path.exists():
        file_path.unlink()
    db.delete(asset)
    db.commit()
