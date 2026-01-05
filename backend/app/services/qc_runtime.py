from __future__ import annotations

import hashlib
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.models.admin import AdminUser
from app.models.enums import (
    AdminRole,
    QCCheckOrigin,
    QCCheckStatus,
    QCExecutionOutcome,
    QCNotificationStatus,
    QCTriggerEventType,
    TaskScope,
    TaskStatus,
)
from app.models.qc import (
    QCApplicability,
    QCCheckDefinition,
    QCCheckInstance,
    QCExecution,
    QCExecutionFailureMode,
    QCFailureModeDefinition,
    QCNotification,
    QCReworkTask,
    QCTrigger,
)
from app.models.tasks import TaskDefinition, TaskInstance, TaskParticipation
from app.models.work import PanelUnit, WorkOrder, WorkUnit

SYSTEM_QC_FIRST_NAME = "System"
SYSTEM_QC_LAST_NAME = "QC"
SYSTEM_QC_PIN = "0000"


def ensure_system_qc_user(db: Session) -> AdminUser:
    admin = (
        db.execute(
            select(AdminUser)
            .where(AdminUser.first_name == SYSTEM_QC_FIRST_NAME)
            .where(AdminUser.last_name == SYSTEM_QC_LAST_NAME)
        )
        .scalars()
        .first()
    )
    if admin:
        return admin
    admin = AdminUser(
        first_name=SYSTEM_QC_FIRST_NAME,
        last_name=SYSTEM_QC_LAST_NAME,
        pin=SYSTEM_QC_PIN,
        role=AdminRole.QC,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def _hash_to_rate(seed: str) -> float:
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def resolve_qc_applicability(
    rows: list[QCApplicability],
    house_type_id: int,
    sub_type_id: int | None,
    module_number: int,
    panel_definition_id: int | None,
    on_date: date | None = None,
) -> tuple[bool, bool]:
    if not rows:
        return True, False

    candidates: list[QCApplicability] = []
    for row in rows:
        if row.effective_from and on_date and on_date < row.effective_from:
            continue
        if row.effective_to and on_date and on_date > row.effective_to:
            continue
        if row.house_type_id is not None and row.house_type_id != house_type_id:
            continue
        if row.sub_type_id is not None and row.sub_type_id != sub_type_id:
            continue
        if row.module_number is not None and row.module_number != module_number:
            continue
        if row.panel_definition_id is not None and row.panel_definition_id != panel_definition_id:
            continue
        candidates.append(row)

    if not candidates:
        return False, False

    def score(row: QCApplicability) -> tuple[int, int, int, int]:
        return (
            1 if row.panel_definition_id is not None else 0,
            1 if row.module_number is not None else 0,
            1 if row.sub_type_id is not None else 0,
            1 if row.house_type_id is not None else 0,
        )

    selected = sorted(candidates, key=score, reverse=True)[0]
    return True, selected.force_required


def open_qc_checks_for_task_completion(db: Session, instance: TaskInstance) -> None:
    task_def = db.get(TaskDefinition, instance.task_definition_id)
    if not task_def:
        return
    work_unit = db.get(WorkUnit, instance.work_unit_id)
    if not work_unit:
        return
    work_order = db.get(WorkOrder, work_unit.work_order_id)
    if not work_order:
        return
    panel_unit = db.get(PanelUnit, instance.panel_unit_id) if instance.panel_unit_id else None
    panel_definition_id = panel_unit.panel_definition_id if panel_unit else None

    trigger_rows = list(
        db.execute(
            select(QCTrigger)
            .join(QCCheckDefinition, QCTrigger.check_definition_id == QCCheckDefinition.id)
            .where(QCTrigger.event_type == QCTriggerEventType.TASK_COMPLETED)
            .where(QCCheckDefinition.active == True)
        ).scalars()
    )

    if not trigger_rows:
        return

    now = utc_now()
    today = now.date()
    for trigger in trigger_rows:
        params = trigger.params_json or {}
        task_ids = params.get("task_definition_ids", []) if isinstance(params, dict) else []
        if task_ids and instance.task_definition_id not in task_ids:
            continue

        applicability_rows = list(
            db.execute(
                select(QCApplicability).where(
                    QCApplicability.check_definition_id == trigger.check_definition_id
                )
            ).scalars()
        )
        applies, force_required = resolve_qc_applicability(
            applicability_rows,
            work_order.house_type_id,
            work_order.sub_type_id,
            work_unit.module_number,
            panel_definition_id,
            on_date=today,
        )
        if not applies:
            continue

        base_rate = trigger.sampling_rate
        rate = trigger.current_sampling_rate if trigger.current_sampling_rate is not None else base_rate
        sampling_selected = True if force_required else _hash_to_rate(
            f"{work_unit.id}:{trigger.check_definition_id}:{instance.id}"
        ) < rate

        check_instance = QCCheckInstance(
            check_definition_id=trigger.check_definition_id,
            origin=QCCheckOrigin.TRIGGERED,
            ad_hoc_title=None,
            ad_hoc_guidance=None,
            scope=instance.scope,
            work_unit_id=work_unit.id,
            panel_unit_id=panel_unit.id if panel_unit else None,
            related_task_instance_id=instance.id,
            station_id=instance.station_id,
            status=QCCheckStatus.OPEN,
            opened_by_user_id=None,
            opened_at=now,
        )
        db.add(check_instance)
        db.flush()

        if not sampling_selected:
            system_user = ensure_system_qc_user(db)
            execution = QCExecution(
                check_instance_id=check_instance.id,
                outcome=QCExecutionOutcome.SKIP,
                notes="Auto-skip by sampling",
                measurement_json=None,
                performed_by_user_id=system_user.id,
                performed_at=now,
            )
            db.add(execution)
            check_instance.status = QCCheckStatus.CLOSED
            check_instance.closed_at = now


def update_sampling_from_execution(
    db: Session, check_instance: QCCheckInstance, outcome: QCExecutionOutcome
) -> None:
    if check_instance.origin != QCCheckOrigin.TRIGGERED:
        return
    if check_instance.related_task_instance_id is None:
        return
    task_instance = db.get(TaskInstance, check_instance.related_task_instance_id)
    if not task_instance:
        return
    task_definition_id = task_instance.task_definition_id

    triggers = list(
        db.execute(
            select(QCTrigger)
            .where(QCTrigger.check_definition_id == check_instance.check_definition_id)
            .where(QCTrigger.event_type == QCTriggerEventType.TASK_COMPLETED)
        ).scalars()
    )
    if not triggers:
        return

    for trigger in triggers:
        if not trigger.sampling_autotune:
            continue
        params = trigger.params_json or {}
        task_ids = params.get("task_definition_ids", []) if isinstance(params, dict) else []
        if task_ids and task_definition_id not in task_ids:
            continue
        base_rate = trigger.sampling_rate
        current_rate = trigger.current_sampling_rate if trigger.current_sampling_rate is not None else base_rate
        if outcome == QCExecutionOutcome.FAIL:
            trigger.current_sampling_rate = 1.0
        elif outcome == QCExecutionOutcome.PASS:
            trigger.current_sampling_rate = max(base_rate, current_rate - trigger.sampling_step)


def apply_failure_modes(
    db: Session,
    execution: QCExecution,
    failure_mode_ids: list[int],
    other_text: str | None,
    measurement_json: dict | None,
    notes: str | None,
) -> None:
    unique_ids = sorted(set(failure_mode_ids))
    if unique_ids:
        modes = list(
            db.execute(
                select(QCFailureModeDefinition)
                .where(QCFailureModeDefinition.id.in_(unique_ids))
            ).scalars()
        )
        mode_ids = {mode.id for mode in modes}
        for mode_id in unique_ids:
            if mode_id not in mode_ids:
                continue
            db.add(
                QCExecutionFailureMode(
                    execution_id=execution.id,
                    failure_mode_definition_id=mode_id,
                    other_text=None,
                    measurement_json=measurement_json,
                    notes=notes,
                )
            )
    if other_text:
        db.add(
            QCExecutionFailureMode(
                execution_id=execution.id,
                failure_mode_definition_id=None,
                other_text=other_text,
                measurement_json=measurement_json,
                notes=notes,
            )
        )


def create_notifications_for_task(
    db: Session, rework_task: QCReworkTask, task_instance_id: int
) -> None:
    participant_ids = list(
        db.execute(
            select(TaskParticipation.worker_id)
            .where(TaskParticipation.task_instance_id == task_instance_id)
        ).scalars()
    )
    for worker_id in sorted(set(participant_ids)):
        db.add(
            QCNotification(
                worker_id=worker_id,
                rework_task_id=rework_task.id,
                status=QCNotificationStatus.ACTIVE,
                created_at=utc_now(),
                seen_at=None,
            )
        )


def enforce_no_active_tasks(db: Session, worker_ids: list[int]) -> bool:
    if not worker_ids:
        return False
    active = (
        db.execute(
            select(TaskParticipation.worker_id)
            .join(TaskInstance, TaskParticipation.task_instance_id == TaskInstance.id)
            .where(TaskParticipation.worker_id.in_(worker_ids))
            .where(TaskParticipation.left_at.is_(None))
            .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
        )
        .scalars()
        .all()
    )
    return len(active) > 0
