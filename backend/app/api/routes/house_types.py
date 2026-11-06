import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin_page
from app.models.admin import AdminUser
from app.models.house import HouseParameterValue, HouseSubType, HouseType, PanelDefinition
from app.models.qc import (
    QCApplicability,
    QCApplicabilityHouseType,
    QCApplicabilitySubType,
    QCCheckInstance,
    QCExecution,
    QCEvidence,
    QCNotification,
    QCReworkTask,
)
from app.models.tasks import (
    TaskApplicability,
    TaskException,
    TaskExpectedDuration,
    TaskInstance,
    TaskParticipation,
    TaskPause,
)
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.schemas.houses import (
    HouseSubTypeCreate,
    HouseSubTypeRead,
    HouseSubTypeUpdate,
    HouseTypeCreate,
    HouseTypeRead,
    HouseTypeUpdate,
)
from app.services.qc_runtime import (
    QCApplicabilityPrunePlan,
    apply_qc_applicability_prune,
    plan_qc_applicability_prune_for_refs,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _count(db: Session, stmt) -> int:
    return int(db.scalar(stmt) or 0)


def _house_type_cascade_queries(house_type_id: int):
    sub_type_ids = select(HouseSubType.id).where(
        HouseSubType.house_type_id == house_type_id
    )
    panel_definition_ids = select(PanelDefinition.id).where(
        PanelDefinition.house_type_id == house_type_id
    )
    work_order_ids = select(WorkOrder.id).where(
        WorkOrder.house_type_id == house_type_id
    )
    work_unit_ids = select(WorkUnit.id).where(
        WorkUnit.work_order_id.in_(work_order_ids)
    )
    panel_unit_ids = select(PanelUnit.id).where(
        or_(
            PanelUnit.work_unit_id.in_(work_unit_ids),
            PanelUnit.panel_definition_id.in_(panel_definition_ids),
        )
    )
    task_instance_ids = select(TaskInstance.id).where(
        or_(
            TaskInstance.work_unit_id.in_(work_unit_ids),
            TaskInstance.panel_unit_id.in_(panel_unit_ids),
        )
    )
    qc_check_instance_ids = select(QCCheckInstance.id).where(
        or_(
            QCCheckInstance.work_unit_id.in_(work_unit_ids),
            QCCheckInstance.panel_unit_id.in_(panel_unit_ids),
            QCCheckInstance.related_task_instance_id.in_(task_instance_ids),
        )
    )
    qc_execution_ids = select(QCExecution.id).where(
        QCExecution.check_instance_id.in_(qc_check_instance_ids)
    )
    qc_rework_task_ids = select(QCReworkTask.id).where(
        QCReworkTask.check_instance_id.in_(qc_check_instance_ids)
    )
    return {
        "sub_type_ids": sub_type_ids,
        "panel_definition_ids": panel_definition_ids,
        "work_order_ids": work_order_ids,
        "work_unit_ids": work_unit_ids,
        "panel_unit_ids": panel_unit_ids,
        "task_instance_ids": task_instance_ids,
        "qc_check_instance_ids": qc_check_instance_ids,
        "qc_execution_ids": qc_execution_ids,
        "qc_rework_task_ids": qc_rework_task_ids,
    }


def _house_type_cascade_counts(db: Session, house_type_id: int, queries) -> dict[str, int]:
    sub_type_ids = queries["sub_type_ids"]
    panel_definition_ids = queries["panel_definition_ids"]
    work_order_ids = queries["work_order_ids"]
    work_unit_ids = queries["work_unit_ids"]
    panel_unit_ids = queries["panel_unit_ids"]
    task_instance_ids = queries["task_instance_ids"]
    qc_check_instance_ids = queries["qc_check_instance_ids"]
    qc_execution_ids = queries["qc_execution_ids"]
    qc_rework_task_ids = queries["qc_rework_task_ids"]

    task_scope_filter = or_(
        TaskApplicability.house_type_id == house_type_id,
        TaskApplicability.sub_type_id.in_(sub_type_ids),
        TaskApplicability.panel_definition_id.in_(panel_definition_ids),
    )
    task_duration_filter = or_(
        TaskExpectedDuration.house_type_id == house_type_id,
        TaskExpectedDuration.sub_type_id.in_(sub_type_ids),
        TaskExpectedDuration.panel_definition_id.in_(panel_definition_ids),
    )
    qc_applicability_house_type_ids = select(
        QCApplicabilityHouseType.applicability_id
    ).where(QCApplicabilityHouseType.house_type_id == house_type_id)
    qc_applicability_sub_type_ids = select(
        QCApplicabilitySubType.applicability_id
    ).where(QCApplicabilitySubType.sub_type_id.in_(sub_type_ids))
    qc_applicability_filter = or_(
        QCApplicability.id.in_(qc_applicability_house_type_ids),
        QCApplicability.id.in_(qc_applicability_sub_type_ids),
    )

    return {
        "sub_types": _count(
            db,
            select(func.count()).where(HouseSubType.house_type_id == house_type_id),
        ),
        "panel_definitions": _count(
            db,
            select(func.count()).where(
                PanelDefinition.house_type_id == house_type_id
            ),
        ),
        "panel_units": _count(
            db,
            select(func.count()).where(
                or_(
                    PanelUnit.work_unit_id.in_(work_unit_ids),
                    PanelUnit.panel_definition_id.in_(panel_definition_ids),
                )
            ),
        ),
        "parameter_values": _count(
            db,
            select(func.count()).where(
                HouseParameterValue.house_type_id == house_type_id
            ),
        ),
        "work_orders": _count(
            db,
            select(func.count()).where(WorkOrder.house_type_id == house_type_id),
        ),
        "work_units": _count(
            db,
            select(func.count()).where(WorkUnit.work_order_id.in_(work_order_ids)),
        ),
        "task_applicability": _count(
            db, select(func.count()).where(task_scope_filter)
        ),
        "task_expected_durations": _count(
            db, select(func.count()).where(task_duration_filter)
        ),
        "task_instances": _count(
            db,
            select(func.count()).where(
                or_(
                    TaskInstance.work_unit_id.in_(work_unit_ids),
                    TaskInstance.panel_unit_id.in_(panel_unit_ids),
                )
            ),
        ),
        "task_participations": _count(
            db,
            select(func.count()).where(
                TaskParticipation.task_instance_id.in_(task_instance_ids)
            ),
        ),
        "task_pauses": _count(
            db,
            select(func.count()).where(
                TaskPause.task_instance_id.in_(task_instance_ids)
            ),
        ),
        "task_exceptions": _count(
            db,
            select(func.count()).where(
                or_(
                    TaskException.work_unit_id.in_(work_unit_ids),
                    TaskException.panel_unit_id.in_(panel_unit_ids),
                )
            ),
        ),
        "qc_applicability": _count(
            db, select(func.count()).where(qc_applicability_filter)
        ),
        "qc_check_instances": _count(
            db,
            select(func.count()).where(
                or_(
                    QCCheckInstance.work_unit_id.in_(work_unit_ids),
                    QCCheckInstance.panel_unit_id.in_(panel_unit_ids),
                    QCCheckInstance.related_task_instance_id.in_(
                        task_instance_ids
                    ),
                )
            ),
        ),
        "qc_executions": _count(
            db,
            select(func.count()).where(
                QCExecution.check_instance_id.in_(qc_check_instance_ids)
            ),
        ),
        "qc_evidence": _count(
            db,
            select(func.count()).where(
                QCEvidence.execution_id.in_(qc_execution_ids)
            ),
        ),
        "qc_rework_tasks": _count(
            db,
            select(func.count()).where(
                QCReworkTask.check_instance_id.in_(qc_check_instance_ids)
            ),
        ),
        "qc_notifications": _count(
            db,
            select(func.count()).where(
                QCNotification.rework_task_id.in_(qc_rework_task_ids)
            ),
        ),
    }


def _house_type_qc_prune_plan(db: Session, house_type_id: int) -> QCApplicabilityPrunePlan:
    sub_type_ids = list(
        db.execute(
            select(HouseSubType.id).where(HouseSubType.house_type_id == house_type_id)
        ).scalars()
    )
    return plan_qc_applicability_prune_for_refs(db, [house_type_id], sub_type_ids)


def _qc_deactivation_message(plan: QCApplicabilityPrunePlan) -> str:
    count = len(plan.check_ids_to_deactivate)
    names = ", ".join(plan.check_names_to_deactivate[:5])
    if len(plan.check_names_to_deactivate) > 5:
        names += ", ..."
    noun = "inspeccion QC quedaria desactivada" if count == 1 else "inspecciones QC quedarian desactivadas"
    return f"{count} {noun} ({names})"


def _delete_house_type_cascade(
    db: Session, house_type_id: int, queries, qc_plan: QCApplicabilityPrunePlan
) -> None:
    sub_type_ids = queries["sub_type_ids"]
    panel_definition_ids = queries["panel_definition_ids"]
    work_order_ids = queries["work_order_ids"]
    work_unit_ids = queries["work_unit_ids"]
    panel_unit_ids = queries["panel_unit_ids"]
    task_instance_ids = queries["task_instance_ids"]
    qc_check_instance_ids = queries["qc_check_instance_ids"]
    qc_execution_ids = queries["qc_execution_ids"]
    qc_rework_task_ids = queries["qc_rework_task_ids"]

    db.execute(
        delete(QCEvidence).where(
            QCEvidence.execution_id.in_(qc_execution_ids)
        )
    )
    db.execute(
        delete(QCNotification).where(
            QCNotification.rework_task_id.in_(qc_rework_task_ids)
        )
    )
    db.execute(
        delete(QCExecution).where(
            QCExecution.check_instance_id.in_(qc_check_instance_ids)
        )
    )
    db.execute(
        delete(QCReworkTask).where(
            QCReworkTask.check_instance_id.in_(qc_check_instance_ids)
        )
    )
    db.execute(
        delete(QCCheckInstance).where(
            or_(
                QCCheckInstance.work_unit_id.in_(work_unit_ids),
                QCCheckInstance.panel_unit_id.in_(panel_unit_ids),
                QCCheckInstance.related_task_instance_id.in_(task_instance_ids),
            )
        )
    )
    db.execute(
        delete(TaskParticipation).where(
            TaskParticipation.task_instance_id.in_(task_instance_ids)
        )
    )
    db.execute(
        delete(TaskPause).where(
            TaskPause.task_instance_id.in_(task_instance_ids)
        )
    )
    db.execute(
        delete(TaskException).where(
            or_(
                TaskException.work_unit_id.in_(work_unit_ids),
                TaskException.panel_unit_id.in_(panel_unit_ids),
            )
        )
    )
    db.execute(
        delete(TaskInstance).where(
            or_(
                TaskInstance.work_unit_id.in_(work_unit_ids),
                TaskInstance.panel_unit_id.in_(panel_unit_ids),
            )
        )
    )
    db.execute(
        delete(PanelUnit).where(
            or_(
                PanelUnit.work_unit_id.in_(work_unit_ids),
                PanelUnit.panel_definition_id.in_(panel_definition_ids),
            )
        )
    )
    db.execute(
        delete(WorkUnit).where(WorkUnit.work_order_id.in_(work_order_ids))
    )
    db.execute(
        delete(WorkOrder).where(WorkOrder.house_type_id == house_type_id)
    )
    db.execute(
        delete(TaskApplicability).where(
            or_(
                TaskApplicability.house_type_id == house_type_id,
                TaskApplicability.sub_type_id.in_(sub_type_ids),
                TaskApplicability.panel_definition_id.in_(panel_definition_ids),
            )
        )
    )
    db.execute(
        delete(TaskExpectedDuration).where(
            or_(
                TaskExpectedDuration.house_type_id == house_type_id,
                TaskExpectedDuration.sub_type_id.in_(sub_type_ids),
                TaskExpectedDuration.panel_definition_id.in_(panel_definition_ids),
            )
        )
    )
    # Drop only the deleted house type / subtypes from QC applicability. Removing a
    # whole rule could leave a check with no rules, which means "applies to all".
    apply_qc_applicability_prune(db, qc_plan)
    db.execute(
        delete(HouseParameterValue).where(
            HouseParameterValue.house_type_id == house_type_id
        )
    )
    db.execute(
        delete(PanelDefinition).where(
            PanelDefinition.house_type_id == house_type_id
        )
    )
    db.execute(
        delete(HouseSubType).where(
            HouseSubType.house_type_id == house_type_id
        )
    )


@router.get("", response_model=list[HouseTypeRead])
def list_house_types(db: Session = Depends(get_db)) -> list[HouseType]:
    return list(db.execute(select(HouseType).order_by(HouseType.name)).scalars())


@router.post("", response_model=HouseTypeRead, status_code=status.HTTP_201_CREATED)
def create_house_type(
    payload: HouseTypeCreate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("house-config", edit=True)),
) -> HouseType:
    house_type = HouseType(**payload.model_dump())
    db.add(house_type)
    db.commit()
    db.refresh(house_type)
    return house_type


@router.get("/{house_type_id}", response_model=HouseTypeRead)
def get_house_type(house_type_id: int, db: Session = Depends(get_db)) -> HouseType:
    house_type = db.get(HouseType, house_type_id)
    if not house_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House type not found")
    return house_type


@router.put("/{house_type_id}", response_model=HouseTypeRead)
def update_house_type(
    house_type_id: int,
    payload: HouseTypeUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("house-config", edit=True)),
) -> HouseType:
    house_type = db.get(HouseType, house_type_id)
    if not house_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House type not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(house_type, key, value)
    db.commit()
    db.refresh(house_type)
    return house_type


@router.delete("/{house_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_house_type(
    house_type_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("house-config", edit=True)),
) -> None:
    house_type = db.get(HouseType, house_type_id)
    if not house_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House type not found")
    queries = _house_type_cascade_queries(house_type_id)
    counts = _house_type_cascade_counts(db, house_type_id, queries)
    qc_plan = _house_type_qc_prune_plan(db, house_type_id)
    cascade_total = sum(counts.values())
    summary_counts = dict(counts)
    if qc_plan.check_ids_to_deactivate:
        summary_counts["qc_checks_deactivated"] = len(qc_plan.check_ids_to_deactivate)
    counts_summary = ", ".join(
        f"{key}={value}" for key, value in summary_counts.items() if value
    )
    if cascade_total > 0 and not force:
        qc_note = (
            f"{_qc_deactivation_message(qc_plan)}. "
            if qc_plan.check_ids_to_deactivate
            else ""
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "House type has dependent records. "
                f"{counts_summary}. "
                f"{qc_note}"
                "Retry with ?force=true to delete anyway."
            ),
        )
    if cascade_total > 0:
        logger.warning(
            "Deleting house_type_id=%s with cascading data: %s",
            house_type_id,
            counts_summary or "none",
        )
        if force:
            _delete_house_type_cascade(db, house_type_id, queries, qc_plan)
    db.delete(house_type)
    db.commit()


@router.get("/{house_type_id}/subtypes", response_model=list[HouseSubTypeRead])
def list_house_subtypes(
    house_type_id: int, db: Session = Depends(get_db)
) -> list[HouseSubType]:
    stmt = select(HouseSubType).where(HouseSubType.house_type_id == house_type_id)
    return list(db.execute(stmt.order_by(HouseSubType.name)).scalars())


@router.post(
    "/{house_type_id}/subtypes",
    response_model=HouseSubTypeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_house_subtype(
    house_type_id: int,
    payload: HouseSubTypeCreate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("house-config", edit=True)),
) -> HouseSubType:
    house_type = db.get(HouseType, house_type_id)
    if not house_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House type not found")
    subtype = HouseSubType(house_type_id=house_type_id, name=payload.name)
    db.add(subtype)
    db.commit()
    db.refresh(subtype)
    return subtype


@router.get("/subtypes/{sub_type_id}", response_model=HouseSubTypeRead)
def get_house_subtype(sub_type_id: int, db: Session = Depends(get_db)) -> HouseSubType:
    subtype = db.get(HouseSubType, sub_type_id)
    if not subtype:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House subtype not found")
    return subtype


@router.put("/subtypes/{sub_type_id}", response_model=HouseSubTypeRead)
def update_house_subtype(
    sub_type_id: int,
    payload: HouseSubTypeUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("house-config", edit=True)),
) -> HouseSubType:
    subtype = db.get(HouseSubType, sub_type_id)
    if not subtype:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House subtype not found")
    updates = payload.model_dump(exclude_unset=True)
    if "house_type_id" in updates and not db.get(HouseType, updates["house_type_id"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="House type not found"
        )
    for key, value in updates.items():
        setattr(subtype, key, value)
    db.commit()
    db.refresh(subtype)
    return subtype


SUBTYPE_DEPENDENCY_LABELS = {
    "work_orders": "ordenes de trabajo",
    "panel_definitions": "definiciones de panel",
    "parameter_values": "valores de parametros",
    "task_applicability": "reglas de aplicabilidad de tareas",
    "task_expected_durations": "duraciones esperadas de tareas",
}


def _sub_type_dependency_counts(db: Session, sub_type_id: int) -> dict[str, int]:
    return {
        "work_orders": _count(
            db, select(func.count()).where(WorkOrder.sub_type_id == sub_type_id)
        ),
        "panel_definitions": _count(
            db, select(func.count()).where(PanelDefinition.sub_type_id == sub_type_id)
        ),
        "parameter_values": _count(
            db,
            select(func.count()).where(HouseParameterValue.sub_type_id == sub_type_id),
        ),
        "task_applicability": _count(
            db, select(func.count()).where(TaskApplicability.sub_type_id == sub_type_id)
        ),
        "task_expected_durations": _count(
            db,
            select(func.count()).where(TaskExpectedDuration.sub_type_id == sub_type_id),
        ),
    }


@router.delete("/subtypes/{sub_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_house_subtype(
    sub_type_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("house-config", edit=True)),
) -> None:
    subtype = db.get(HouseSubType, sub_type_id)
    if not subtype:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House subtype not found")
    dependencies = _sub_type_dependency_counts(db, sub_type_id)
    if any(dependencies.values()):
        used_by = ", ".join(
            f"{value} {SUBTYPE_DEPENDENCY_LABELS[key]}"
            for key, value in dependencies.items()
            if value
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"El subtipo esta en uso y no se puede eliminar: {used_by}.",
        )
    qc_plan = plan_qc_applicability_prune_for_refs(db, sub_type_ids=[sub_type_id])
    if qc_plan.check_ids_to_deactivate and not force:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{_qc_deactivation_message(qc_plan)} porque solo aplican a este subtipo. "
                "Reintente con ?force=true para eliminar de todos modos."
            ),
        )
    # Remove only this subtype from QC applicability; rules that targeted only this
    # subtype are dropped and checks left without rules are deactivated, instead of
    # letting an empty list widen them to every house.
    apply_qc_applicability_prune(db, qc_plan)
    db.delete(subtype)
    db.commit()
