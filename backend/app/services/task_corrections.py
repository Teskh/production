from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.models.admin import AdminUser
from app.models.enums import (
    PanelUnitStatus,
    StationRole,
    TaskScope,
    TaskStatus,
    WorkUnitStatus,
)
from app.models.house import PanelDefinition
from app.models.qc import QCCheckInstance, QCExecution, QCNotification, QCReworkTask
from app.models.stations import Station
from app.models.tasks import (
    TaskCorrectionLog,
    TaskDefinition,
    TaskInstance,
    TaskParticipation,
    TaskPause,
    TaskStationAdherenceFact,
)
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.schemas.task_corrections import (
    TaskCorrectionApplyResponse,
    TaskCorrectionDeleteCounts,
    TaskCorrectionPreview,
    TaskCorrectionPreviewListResponse,
    TaskCorrectionTargetSummary,
)

TASK_CORRECTION_WINDOW = timedelta(minutes=30)
ENFORCE_TASK_CORRECTION_WINDOW = False
OPEN_TASK_STATUSES = {TaskStatus.IN_PROGRESS, TaskStatus.PAUSED}


@dataclass
class _CorrectionContext:
    instance: TaskInstance
    task_def: TaskDefinition
    station: Station | None
    work_unit: WorkUnit
    panel_unit: PanelUnit | None
    delete_counts: TaskCorrectionDeleteCounts
    qc_check_ids: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    state_changes: list[str] = field(default_factory=list)
    correction_kind: str | None = None
    rollback_applied: bool = False
    blocked_reason: str | None = None


def _reference_time(instance: TaskInstance) -> datetime | None:
    return instance.completed_at or instance.started_at


def _ensure_utc_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _correction_window_minutes() -> int:
    return int(TASK_CORRECTION_WINDOW.total_seconds() // 60)


def _target_summary(instance: TaskInstance, task_def: TaskDefinition) -> TaskCorrectionTargetSummary:
    return TaskCorrectionTargetSummary(
        task_instance_id=instance.id,
        task_definition_id=task_def.id,
        task_name=task_def.name,
        scope=instance.scope,
        status=instance.status,
        work_unit_id=instance.work_unit_id,
        panel_unit_id=instance.panel_unit_id,
        station_id=instance.station_id,
        started_at=instance.started_at,
        completed_at=instance.completed_at,
    )


def _all_applicable_panels_terminal(db: Session, work_unit: WorkUnit, work_order: WorkOrder) -> bool:
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

    if not panel_definitions:
        return False

    panel_units = list(
        db.execute(select(PanelUnit).where(PanelUnit.work_unit_id == work_unit.id)).scalars()
    )
    panel_units_by_definition: dict[int, list[PanelUnit]] = {}
    for panel_unit in panel_units:
        panel_units_by_definition.setdefault(panel_unit.panel_definition_id, []).append(panel_unit)

    terminal_statuses = {PanelUnitStatus.COMPLETED, PanelUnitStatus.CONSUMED}
    for panel_definition in panel_definitions:
        units = panel_units_by_definition.get(panel_definition.id, [])
        if not units:
            return False
        if any(panel_unit.status not in terminal_statuses for panel_unit in units):
            return False
    return True


def _load_context(db: Session, task_instance_id: int) -> _CorrectionContext:
    instance = db.get(TaskInstance, task_instance_id)
    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task instance not found"
        )
    task_def = db.get(TaskDefinition, instance.task_definition_id)
    if not task_def:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    work_unit = db.get(WorkUnit, instance.work_unit_id)
    if not work_unit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Work unit not found"
        )
    station = db.get(Station, instance.station_id) if instance.station_id else None
    panel_unit = db.get(PanelUnit, instance.panel_unit_id) if instance.panel_unit_id else None

    qc_check_ids = list(
        db.execute(
            select(QCCheckInstance.id).where(QCCheckInstance.related_task_instance_id == instance.id)
        ).scalars()
    )
    qc_execution_count = 0
    qc_rework_count = 0
    qc_notification_count = 0
    if qc_check_ids:
        qc_execution_count = len(
            list(
                db.execute(
                    select(QCExecution.id).where(
                        QCExecution.check_instance_id.in_(qc_check_ids)
                    )
                ).scalars()
            )
        )
        rework_ids = list(
            db.execute(
                select(QCReworkTask.id).where(QCReworkTask.check_instance_id.in_(qc_check_ids))
            ).scalars()
        )
        qc_rework_count = len(rework_ids)
        if rework_ids:
            qc_notification_count = len(
                list(
                    db.execute(
                        select(QCNotification.id).where(
                            QCNotification.rework_task_id.in_(rework_ids)
                        )
                    ).scalars()
                )
            )

    delete_counts = TaskCorrectionDeleteCounts(
        participations=len(
            list(
                db.execute(
                    select(TaskParticipation.id).where(
                        TaskParticipation.task_instance_id == instance.id
                    )
                ).scalars()
            )
        ),
        pauses=len(
            list(
                db.execute(
                    select(TaskPause.id).where(TaskPause.task_instance_id == instance.id)
                ).scalars()
            )
        ),
        adherence_facts=len(
            list(
                db.execute(
                    select(TaskStationAdherenceFact.id).where(
                        TaskStationAdherenceFact.task_instance_id == instance.id
                    )
                ).scalars()
            )
        ),
        qc_checks=len(qc_check_ids),
        qc_executions=qc_execution_count,
        qc_rework_tasks=qc_rework_count,
        qc_notifications=qc_notification_count,
    )

    return _CorrectionContext(
        instance=instance,
        task_def=task_def,
        station=station,
        work_unit=work_unit,
        panel_unit=panel_unit,
        delete_counts=delete_counts,
        qc_check_ids=qc_check_ids,
    )


def _set_blocked(context: _CorrectionContext, reason: str) -> _CorrectionContext:
    context.blocked_reason = reason
    return context


def _module_has_other_activity(db: Session, instance: TaskInstance) -> bool:
    other_ids = list(
        db.execute(
            select(TaskInstance.id)
            .where(TaskInstance.work_unit_id == instance.work_unit_id)
            .where(TaskInstance.panel_unit_id.is_(None))
            .where(TaskInstance.id != instance.id)
        ).scalars()
    )
    return len(other_ids) > 0


def _module_has_later_or_open_activity(db: Session, instance: TaskInstance) -> bool:
    reference_time = instance.completed_at
    if reference_time is None:
        return False
    other_instances = list(
        db.execute(
            select(TaskInstance)
            .where(TaskInstance.work_unit_id == instance.work_unit_id)
            .where(TaskInstance.panel_unit_id.is_(None))
            .where(TaskInstance.id != instance.id)
        ).scalars()
    )
    for other in other_instances:
        if other.status in OPEN_TASK_STATUSES:
            return True
        if other.started_at and other.started_at >= reference_time:
            return True
        if other.completed_at and other.completed_at >= reference_time:
            return True
    return False


def _panel_has_other_activity(db: Session, instance: TaskInstance) -> bool:
    if instance.panel_unit_id is None:
        return False
    other_ids = list(
        db.execute(
            select(TaskInstance.id)
            .where(TaskInstance.panel_unit_id == instance.panel_unit_id)
            .where(TaskInstance.id != instance.id)
        ).scalars()
    )
    return len(other_ids) > 0


def _all_panel_units_planned(db: Session, work_unit_id: int) -> bool:
    panel_units = list(
        db.execute(select(PanelUnit).where(PanelUnit.work_unit_id == work_unit_id)).scalars()
    )
    if not panel_units:
        return True
    return all(panel_unit.status == PanelUnitStatus.PLANNED for panel_unit in panel_units)


def _first_assembly_station_for_line(db: Session, station: Station) -> Station | None:
    if station.role != StationRole.ASSEMBLY:
        return None
    return (
        db.execute(
            select(Station)
            .where(Station.role == StationRole.ASSEMBLY)
            .where(Station.line_type == station.line_type)
            .order_by(Station.sequence_order)
            .limit(1)
        ).scalar_one_or_none()
    )


def _plan_correction(db: Session, context: _CorrectionContext) -> _CorrectionContext:
    instance = context.instance
    task_def = context.task_def

    if instance.rework_task_id is not None:
        return _set_blocked(context, "Rework tasks cannot be corrected through this route")

    if instance.status not in (*OPEN_TASK_STATUSES, TaskStatus.COMPLETED):
        return _set_blocked(context, "Only in-progress, paused, or completed tasks can be corrected")

    reference_time = _reference_time(instance)
    if reference_time is None:
        return _set_blocked(context, "Task is missing timing information required for correction")
    if ENFORCE_TASK_CORRECTION_WINDOW and (
        utc_now() - _ensure_utc_aware(reference_time) > TASK_CORRECTION_WINDOW
    ):
        return _set_blocked(
            context,
            f"Task corrections are limited to the last {_correction_window_minutes()} minutes",
        )

    if context.delete_counts.qc_executions > 0 or context.delete_counts.qc_rework_tasks > 0:
        return _set_blocked(
            context,
            "Tasks with executed QC or generated rework cannot be corrected automatically",
        )

    context.correction_kind = "delete_only"

    if instance.scope == TaskScope.PANEL:
        if instance.status in OPEN_TASK_STATUSES and context.panel_unit is not None:
            panel_unit = context.panel_unit
            if (
                not _panel_has_other_activity(db, instance)
                and panel_unit.status == PanelUnitStatus.IN_PROGRESS
                and panel_unit.current_station_id == instance.station_id
            ):
                context.correction_kind = "delete_and_reset_panel_to_planned"
                context.rollback_applied = True
                context.state_changes.append("Panel will return to Planned at the panel line queue.")
                if context.work_unit.status == WorkUnitStatus.PANELS:
                    context.state_changes.append(
                        "Work unit will return to Planned if no other panel has started."
                    )
        return context

    if instance.scope != TaskScope.MODULE or context.station is None:
        return context

    if (
        instance.status in OPEN_TASK_STATUSES
        and context.station.role == StationRole.ASSEMBLY
        and not _module_has_other_activity(db, instance)
        and context.work_unit.status == WorkUnitStatus.ASSEMBLY
    ):
        first_station = _first_assembly_station_for_line(db, context.station)
        if first_station and context.work_unit.current_station_id == first_station.id:
            work_order = db.get(WorkOrder, context.work_unit.work_order_id)
            if work_order and _all_applicable_panels_terminal(db, context.work_unit, work_order):
                context.correction_kind = "delete_and_reset_module_to_magazine"
                context.rollback_applied = True
                context.state_changes.append("Module will return to Magazine.")
                return context
            panel_units = list(
                db.execute(
                    select(PanelUnit).where(PanelUnit.work_unit_id == context.work_unit.id)
                ).scalars()
            )
            if not panel_units or all(unit.status == PanelUnitStatus.PLANNED for unit in panel_units):
                context.correction_kind = "delete_and_reset_module_to_planned"
                context.rollback_applied = True
                context.state_changes.append("Module will return to Planned.")
                return context
            return _set_blocked(
                context,
                "Module start changed the workflow state and the previous status cannot be inferred safely",
            )

    if (
        task_def.advance_trigger
        and instance.status == TaskStatus.COMPLETED
        and context.station.role == StationRole.ASSEMBLY
    ):
        if context.work_unit.status == WorkUnitStatus.COMPLETED:
            return _set_blocked(
                context,
                "Final module completion cannot be corrected automatically",
            )
        if context.work_unit.status != WorkUnitStatus.ASSEMBLY:
            return _set_blocked(
                context,
                "Module no longer sits in Assembly, so the movement is not safe to roll back",
            )
        if context.work_unit.current_station_id is None:
            return _set_blocked(
                context,
                "Module no longer has a current station, so the movement is not safe to roll back",
            )
        if context.work_unit.current_station_id == instance.station_id:
            return context
        if _module_has_later_or_open_activity(db, instance):
            return _set_blocked(
                context,
                "Module movement already has downstream activity, so it cannot be rolled back safely",
            )
        context.correction_kind = "delete_and_rollback_module_move"
        context.rollback_applied = True
        context.state_changes.append("Module will move back to the previous assembly station.")

    return context


def build_task_correction_preview(db: Session, task_instance_id: int) -> TaskCorrectionPreview:
    context = _plan_correction(db, _load_context(db, task_instance_id))
    return TaskCorrectionPreview(
        task=_target_summary(context.instance, context.task_def),
        eligible=context.blocked_reason is None,
        correction_kind=context.correction_kind,
        rollback_applied=context.rollback_applied,
        blocked_reason=context.blocked_reason,
        warnings=context.warnings,
        state_changes=context.state_changes,
        delete_counts=context.delete_counts,
        correction_window_minutes=_correction_window_minutes(),
    )


def build_task_correction_previews(
    db: Session, task_instance_ids: list[int]
) -> TaskCorrectionPreviewListResponse:
    previews: list[TaskCorrectionPreview] = []
    seen: set[int] = set()
    for task_instance_id in task_instance_ids:
        if task_instance_id in seen:
            continue
        seen.add(task_instance_id)
        try:
            preview = build_task_correction_preview(db, task_instance_id)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                continue
            raise
        previews.append(preview)
    return TaskCorrectionPreviewListResponse(previews=previews)


def _apply_state_rollback(db: Session, context: _CorrectionContext) -> None:
    instance = context.instance

    if context.correction_kind == "delete_and_reset_panel_to_planned":
        if context.panel_unit is None:
            return
        context.panel_unit.status = PanelUnitStatus.PLANNED
        context.panel_unit.current_station_id = None
        if (
            context.work_unit.status == WorkUnitStatus.PANELS
            and _all_panel_units_planned(db, context.work_unit.id)
        ):
            context.work_unit.status = WorkUnitStatus.PLANNED
            context.work_unit.current_station_id = None
        return

    if context.correction_kind == "delete_and_reset_module_to_magazine":
        context.work_unit.status = WorkUnitStatus.MAGAZINE
        context.work_unit.current_station_id = None
        return

    if context.correction_kind == "delete_and_reset_module_to_planned":
        context.work_unit.status = WorkUnitStatus.PLANNED
        context.work_unit.current_station_id = None
        return

    if context.correction_kind == "delete_and_rollback_module_move":
        context.work_unit.status = WorkUnitStatus.ASSEMBLY
        context.work_unit.current_station_id = instance.station_id


def _delete_related_qc(db: Session, qc_check_ids: list[int]) -> None:
    if not qc_check_ids:
        return
    db.execute(delete(QCCheckInstance).where(QCCheckInstance.id.in_(qc_check_ids)))


def apply_task_correction(
    db: Session,
    task_instance_id: int,
    admin: AdminUser,
    *,
    reason: str | None = None,
) -> TaskCorrectionApplyResponse:
    context = _plan_correction(db, _load_context(db, task_instance_id))
    preview = TaskCorrectionPreview(
        task=_target_summary(context.instance, context.task_def),
        eligible=context.blocked_reason is None,
        correction_kind=context.correction_kind,
        rollback_applied=context.rollback_applied,
        blocked_reason=context.blocked_reason,
        warnings=context.warnings,
        state_changes=context.state_changes,
        delete_counts=context.delete_counts,
        correction_window_minutes=_correction_window_minutes(),
    )
    if context.blocked_reason is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=context.blocked_reason)

    _apply_state_rollback(db, context)

    correction_log = TaskCorrectionLog(
        original_task_instance_id=context.instance.id,
        task_definition_id=context.task_def.id,
        task_name_snapshot=context.task_def.name,
        scope=context.instance.scope,
        status_snapshot=context.instance.status,
        work_unit_id=context.instance.work_unit_id,
        panel_unit_id=context.instance.panel_unit_id,
        station_id=context.instance.station_id,
        corrected_by_user_id=admin.id,
        correction_kind=context.correction_kind or "delete_only",
        rollback_applied=context.rollback_applied,
        reason=reason.strip() if reason else None,
        details_json={
            "delete_counts": preview.delete_counts.model_dump(),
            "warnings": preview.warnings,
            "state_changes": preview.state_changes,
        },
        created_at=utc_now(),
    )
    db.add(correction_log)
    db.flush()

    _delete_related_qc(db, context.qc_check_ids)
    db.execute(
        delete(TaskStationAdherenceFact).where(
            TaskStationAdherenceFact.task_instance_id == context.instance.id
        )
    )
    db.execute(delete(TaskPause).where(TaskPause.task_instance_id == context.instance.id))
    db.execute(
        delete(TaskParticipation).where(TaskParticipation.task_instance_id == context.instance.id)
    )
    db.delete(context.instance)

    db.commit()
    db.refresh(correction_log)

    return TaskCorrectionApplyResponse(
        correction_id=correction_log.id,
        preview=preview,
    )
