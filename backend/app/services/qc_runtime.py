from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable, Mapping

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session, selectinload

from app.core.security import utc_now
from app.models.enums import (
    QCCheckKind,
    QCCheckOrigin,
    QCCheckStatus,
    QCExecutionOutcome,
    QCNotificationStatus,
    QCReworkStatus,
    QCTriggerEventType,
    StationRole,
    TaskScope,
    TaskStatus,
    WorkUnitStatus,
)
from app.models.qc import (
    QCApplicability,
    QCApplicabilityHouseType,
    QCApplicabilityPanelGroup,
    QCApplicabilitySubType,
    QCCheckDefinition,
    QCCheckInstance,
    QCExecution,
    QCExecutionFailureMode,
    QCFailureModeDefinition,
    QCNotification,
    QCReworkTask,
    QCTrigger,
)
from app.models.tasks import TaskDefinition, TaskInstance, TaskParticipation, TaskPause
from app.models.work import PanelUnit, WorkOrder, WorkUnit


def manual_check_scope_for_status(status: WorkUnitStatus) -> TaskScope | None:
    if status == WorkUnitStatus.PANELS:
        return TaskScope.PANEL
    if status in (WorkUnitStatus.MAGAZINE, WorkUnitStatus.ASSEMBLY, WorkUnitStatus.COMPLETED):
        return TaskScope.MODULE
    return None

def effective_sampling_rate(trigger: Any) -> float:
    """Rate actually used when deciding whether a triggered check opens.

    The adaptive rate only applies while autotune is enabled; a stale value left
    behind after autotune was switched off must not keep sampling at 100%.
    """
    base_rate = trigger.sampling_rate if trigger.sampling_rate is not None else 1.0
    if trigger.sampling_autotune and trigger.current_sampling_rate is not None:
        return trigger.current_sampling_rate
    return base_rate


def should_reset_current_sampling(trigger: Any, updates: Mapping[str, Any]) -> bool:
    """Editing the base rate or the autotune switch restarts the adaptive rate."""
    if updates.get("reset_current_sampling_rate"):
        return True
    for key in ("sampling_rate", "sampling_autotune"):
        if key in updates and updates[key] is not None and updates[key] != getattr(trigger, key):
            return True
    return False


def _hash_to_rate(seed: str) -> float:
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def resolve_qc_applicability(
    rows: list[QCApplicability],
    house_type_id: int,
    sub_type_id: int | None,
    panel_group: str | None,
) -> bool:
    if not rows:
        return True

    for row in rows:
        if row.house_type_ids and house_type_id not in row.house_type_ids:
            continue
        if row.sub_type_ids and (sub_type_id is None or sub_type_id not in row.sub_type_ids):
            continue
        if row.panel_groups and (panel_group is None or panel_group not in row.panel_groups):
            continue
        return True

    return False


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
    panel_group = panel_unit.panel_definition.group if panel_unit else None

    trigger_rows = list(
        db.execute(
            select(QCTrigger)
            .join(QCCheckDefinition, QCTrigger.check_definition_id == QCCheckDefinition.id)
            .where(QCTrigger.event_type == QCTriggerEventType.TASK_COMPLETED)
            .where(QCCheckDefinition.active == True)
            .where(QCCheckDefinition.kind == QCCheckKind.TRIGGERED)
        ).scalars()
    )

    if not trigger_rows:
        return

    now = utc_now()
    for trigger in trigger_rows:
        params = trigger.params_json or {}
        task_ids = params.get("task_definition_ids", []) if isinstance(params, dict) else []
        normalized_task_ids = (
            {int(task_id) for task_id in task_ids} if task_ids else set()
        )
        if not normalized_task_ids:
            continue
        if instance.task_definition_id not in normalized_task_ids:
            continue

        applicability_rows = list(
            db.execute(
                select(QCApplicability)
                .options(
                    selectinload(QCApplicability.house_type_links),
                    selectinload(QCApplicability.sub_type_links),
                    selectinload(QCApplicability.panel_group_links),
                )
                .where(QCApplicability.check_definition_id == trigger.check_definition_id)
            ).scalars()
        )
        applies = resolve_qc_applicability(
            applicability_rows,
            work_order.house_type_id,
            work_order.sub_type_id,
            panel_group,
        )
        if not applies:
            continue

        rate = effective_sampling_rate(trigger)
        sampling_selected = _hash_to_rate(
            f"{work_unit.id}:{trigger.check_definition_id}:{instance.id}"
        ) < rate

        if not sampling_selected:
            continue

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
        normalized_task_ids = (
            {int(task_id) for task_id in task_ids} if task_ids else set()
        )
        if not normalized_task_ids:
            continue
        if task_definition_id not in normalized_task_ids:
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


def enforce_no_active_tasks(
    db: Session, worker_ids: list[int], exclude_instance_id: int | None = None
) -> bool:
    if not worker_ids:
        return False
    stmt = (
        select(TaskParticipation.worker_id)
        .join(TaskInstance, TaskParticipation.task_instance_id == TaskInstance.id)
        .where(TaskParticipation.worker_id.in_(worker_ids))
        .where(TaskParticipation.left_at.is_(None))
        .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
    )
    if exclude_instance_id is not None:
        stmt = stmt.where(TaskInstance.id != exclude_instance_id)
    active = db.execute(stmt).scalars().all()
    return len(active) > 0



# ---------------------------------------------------------------------------
# Rework / module completion helpers
# ---------------------------------------------------------------------------

OPEN_REWORK_STATUSES = (QCReworkStatus.OPEN, QCReworkStatus.IN_PROGRESS)


def panel_is_off_panel_line(panel: Any, station: Any) -> bool:
    """True when a panel already left the panel line (completed, consumed or moved on).

    Reworks created for such a panel cannot be picked up at the panel station
    where the failed check was triggered.
    """
    if panel is None:
        return False
    status_value = getattr(panel.status, "value", panel.status)
    if status_value in ("Completed", "Consumed"):
        return True
    if status_value == "Planned" and panel.current_station_id is None:
        return False
    if panel.current_station_id is None or station is None:
        return True
    return station.role != StationRole.PANELS


def _close_active_rework_instances(
    db: Session, rework_task_id: int, now: datetime, note: str | None
) -> None:
    instances = list(
        db.execute(
            select(TaskInstance)
            .where(TaskInstance.rework_task_id == rework_task_id)
            .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
        ).scalars()
    )
    if not instances:
        return
    instance_ids = [instance.id for instance in instances]
    for instance in instances:
        instance.status = TaskStatus.SKIPPED
        instance.completed_at = now
        if note:
            instance.notes = f"{instance.notes}\n{note}" if instance.notes else note
    for participation in db.execute(
        select(TaskParticipation)
        .where(TaskParticipation.task_instance_id.in_(instance_ids))
        .where(TaskParticipation.left_at.is_(None))
    ).scalars():
        participation.left_at = now
    for pause in db.execute(
        select(TaskPause)
        .where(TaskPause.task_instance_id.in_(instance_ids))
        .where(TaskPause.resumed_at.is_(None))
    ).scalars():
        pause.resumed_at = now


def cancel_rework(
    db: Session,
    rework: QCReworkTask,
    now: datetime,
    note: str | None = None,
    *,
    reason: str | None = None,
    canceled_by_user_id: int | None = None,
) -> bool:
    """Cancel an open rework, closing its running task and dismissing notifications.

    The failed check stays closed with its FAIL execution, so history is kept.
    Returns False when the rework was already finished.
    """
    if rework.status not in OPEN_REWORK_STATUSES:
        return False
    rework.status = QCReworkStatus.CANCELED
    rework.canceled_at = now
    rework.canceled_by_user_id = canceled_by_user_id
    rework.cancel_reason = reason or note
    _close_active_rework_instances(db, rework.id, now, note)
    for notification in db.execute(
        select(QCNotification)
        .where(QCNotification.rework_task_id == rework.id)
        .where(QCNotification.status == QCNotificationStatus.ACTIVE)
    ).scalars():
        notification.status = QCNotificationStatus.DISMISSED
        notification.seen_at = now
    return True


def lock_qc_checks_for_work_unit(db: Session, work_unit_id: int) -> None:
    """Row-lock every check of a module.

    Inspections lock their check while executing, so taking these locks waits for any
    inspection in flight to commit (and create its rework) before the module's open
    QC items are counted and resolved.
    """
    db.execute(
        select(QCCheckInstance.id)
        .where(QCCheckInstance.work_unit_id == work_unit_id)
        .with_for_update()
    )


def open_qc_items_for_work_unit(
    db: Session, work_unit_id: int
) -> tuple[list[QCCheckInstance], list[QCReworkTask]]:
    checks = list(
        db.execute(
            select(QCCheckInstance)
            .where(QCCheckInstance.work_unit_id == work_unit_id)
            .where(QCCheckInstance.status == QCCheckStatus.OPEN)
        ).scalars()
    )
    reworks = list(
        db.execute(
            select(QCReworkTask)
            .join(QCCheckInstance, QCReworkTask.check_instance_id == QCCheckInstance.id)
            .where(QCCheckInstance.work_unit_id == work_unit_id)
            .where(QCReworkTask.status.in_(OPEN_REWORK_STATUSES))
        ).scalars()
    )
    return checks, reworks


def resolve_open_qc_items_for_completion(
    db: Session, work_unit_id: int, now: datetime, canceled_by_user_id: int | None = None
) -> tuple[int, int]:
    """Close open checks and cancel open reworks of a module being marked finished.

    Closed checks keep no execution, so metrics still count them as not performed,
    but they no longer stay open forever outside every queue.
    """
    checks, reworks = open_qc_items_for_work_unit(db, work_unit_id)
    note = "Retrabajo cancelado al marcar el modulo como terminado"
    canceled = 0
    for rework in reworks:
        if cancel_rework(db, rework, now, note, canceled_by_user_id=canceled_by_user_id):
            canceled += 1
    for check in checks:
        check.status = QCCheckStatus.CLOSED
        check.closed_at = now
    return len(checks), canceled


# ---------------------------------------------------------------------------
# Triggers pointing to archived / inactive task definitions
# ---------------------------------------------------------------------------


def trigger_task_ids(params_json: Any) -> list[int]:
    if not isinstance(params_json, dict):
        return []
    raw_ids = params_json.get("task_definition_ids") or []
    task_ids: list[int] = []
    for raw in raw_ids:
        try:
            task_id = int(raw)
        except (TypeError, ValueError):
            continue
        if task_id not in task_ids:
            task_ids.append(task_id)
    return task_ids


def summarize_trigger_task_warnings(
    checks: Iterable[Any],
    triggers: Iterable[Any],
    task_definitions: Mapping[int, Any],
) -> list[dict[str, Any]]:
    """Group, per active triggered check, the trigger tasks that can no longer fire.

    ``blocked`` is True when no referenced task can complete anymore, i.e. the
    check will never open again.
    """
    triggers_by_check: dict[int, list[Any]] = {}
    for trigger in triggers:
        triggers_by_check.setdefault(trigger.check_definition_id, []).append(trigger)

    warnings: list[dict[str, Any]] = []
    for check in checks:
        issues: list[dict[str, Any]] = []
        usable_tasks = 0
        seen: set[int] = set()
        for trigger in triggers_by_check.get(check.id, []):
            for task_id in trigger_task_ids(trigger.params_json):
                if task_id in seen:
                    continue
                seen.add(task_id)
                task = task_definitions.get(task_id)
                if task is None:
                    reason = "missing"
                elif task.archived_at is not None:
                    reason = "archived"
                elif not task.active:
                    reason = "inactive"
                else:
                    usable_tasks += 1
                    continue
                issues.append(
                    {
                        "task_definition_id": task_id,
                        "task_name": task.name if task is not None else None,
                        "reason": reason,
                    }
                )
        if issues:
            warnings.append(
                {
                    "check_definition_id": check.id,
                    "check_name": check.name,
                    "blocked": usable_tasks == 0,
                    "tasks": issues,
                }
            )
    warnings.sort(key=lambda item: (not item["blocked"], item["check_name"] or ""))
    return warnings


def find_trigger_task_warnings(db: Session) -> list[dict[str, Any]]:
    checks = list(
        db.execute(
            select(QCCheckDefinition)
            .where(QCCheckDefinition.active == True)
            .where(QCCheckDefinition.archived_at.is_(None))
            .where(QCCheckDefinition.kind == QCCheckKind.TRIGGERED)
        ).scalars()
    )
    if not checks:
        return []
    triggers = list(
        db.execute(
            select(QCTrigger)
            .where(QCTrigger.check_definition_id.in_([check.id for check in checks]))
            .where(QCTrigger.event_type == QCTriggerEventType.TASK_COMPLETED)
        ).scalars()
    )
    task_ids = {task_id for trigger in triggers for task_id in trigger_task_ids(trigger.params_json)}
    task_definitions = (
        {
            task.id: task
            for task in db.execute(
                select(TaskDefinition).where(TaskDefinition.id.in_(task_ids))
            ).scalars()
        }
        if task_ids
        else {}
    )
    return summarize_trigger_task_warnings(checks, triggers, task_definitions)


# ---------------------------------------------------------------------------
# Applicability pruning when house types / subtypes are deleted
# ---------------------------------------------------------------------------


@dataclass
class QCApplicabilityPrunePlan:
    house_type_link_ids: list[int] = field(default_factory=list)
    sub_type_link_ids: list[int] = field(default_factory=list)
    rule_ids_to_delete: list[int] = field(default_factory=list)
    check_ids_to_deactivate: list[int] = field(default_factory=list)
    check_names_to_deactivate: list[str] = field(default_factory=list)

    @property
    def touched(self) -> bool:
        return bool(
            self.house_type_link_ids
            or self.sub_type_link_ids
            or self.rule_ids_to_delete
            or self.check_ids_to_deactivate
        )


def plan_qc_applicability_prune(
    rules: Iterable[Any],
    rule_counts_by_check: Mapping[int, int],
    active_check_ids: Iterable[int],
    house_type_ids: Iterable[int],
    sub_type_ids: Iterable[int],
) -> QCApplicabilityPrunePlan:
    """Work out how to drop deleted house types / subtypes from QC applicability.

    An empty id list in a rule means "all", so removing the last house type or
    subtype of a rule would silently widen the check. Such rules are deleted
    instead; a check left without any rule would then apply to everything, so it
    is deactivated.
    """
    house_set = set(house_type_ids)
    sub_set = set(sub_type_ids)
    active_set = set(active_check_ids)
    plan = QCApplicabilityPrunePlan()
    deleted_by_check: dict[int, int] = {}
    for rule in rules:
        house_links = list(rule.house_type_links)
        sub_links = list(rule.sub_type_links)
        removed_house = [link for link in house_links if link.house_type_id in house_set]
        removed_sub = [link for link in sub_links if link.sub_type_id in sub_set]
        if not removed_house and not removed_sub:
            continue
        widens = bool(removed_house and len(removed_house) == len(house_links)) or bool(
            removed_sub and len(removed_sub) == len(sub_links)
        )
        if widens:
            plan.rule_ids_to_delete.append(rule.id)
            deleted_by_check[rule.check_definition_id] = (
                deleted_by_check.get(rule.check_definition_id, 0) + 1
            )
        else:
            plan.house_type_link_ids.extend(link.id for link in removed_house)
            plan.sub_type_link_ids.extend(link.id for link in removed_sub)
    for check_id, deleted in sorted(deleted_by_check.items()):
        remaining = rule_counts_by_check.get(check_id, 0) - deleted
        if remaining <= 0 and check_id in active_set:
            plan.check_ids_to_deactivate.append(check_id)
    return plan


def plan_qc_applicability_prune_for_refs(
    db: Session,
    house_type_ids: Iterable[int] = (),
    sub_type_ids: Iterable[int] = (),
) -> QCApplicabilityPrunePlan:
    house_ids = sorted(set(house_type_ids))
    sub_ids = sorted(set(sub_type_ids))
    filters = []
    if house_ids:
        filters.append(
            QCApplicability.id.in_(
                select(QCApplicabilityHouseType.applicability_id).where(
                    QCApplicabilityHouseType.house_type_id.in_(house_ids)
                )
            )
        )
    if sub_ids:
        filters.append(
            QCApplicability.id.in_(
                select(QCApplicabilitySubType.applicability_id).where(
                    QCApplicabilitySubType.sub_type_id.in_(sub_ids)
                )
            )
        )
    if not filters:
        return QCApplicabilityPrunePlan()
    rules = list(
        db.execute(
            select(QCApplicability)
            .options(
                selectinload(QCApplicability.house_type_links),
                selectinload(QCApplicability.sub_type_links),
            )
            .where(or_(*filters))
        ).scalars()
    )
    if not rules:
        return QCApplicabilityPrunePlan()
    check_ids = sorted({rule.check_definition_id for rule in rules})
    rule_counts = {
        check_id: int(count)
        for check_id, count in db.execute(
            select(QCApplicability.check_definition_id, func.count(QCApplicability.id))
            .where(QCApplicability.check_definition_id.in_(check_ids))
            .group_by(QCApplicability.check_definition_id)
        ).all()
    }
    active_checks = {
        check.id: check.name
        for check in db.execute(
            select(QCCheckDefinition)
            .where(QCCheckDefinition.id.in_(check_ids))
            .where(QCCheckDefinition.active == True)
        ).scalars()
    }
    plan = plan_qc_applicability_prune(rules, rule_counts, active_checks.keys(), house_ids, sub_ids)
    plan.check_names_to_deactivate = [
        active_checks[check_id] for check_id in plan.check_ids_to_deactivate
    ]
    return plan


def apply_qc_applicability_prune(db: Session, plan: QCApplicabilityPrunePlan) -> None:
    if plan.house_type_link_ids:
        db.execute(
            delete(QCApplicabilityHouseType).where(
                QCApplicabilityHouseType.id.in_(plan.house_type_link_ids)
            )
        )
    if plan.sub_type_link_ids:
        db.execute(
            delete(QCApplicabilitySubType).where(
                QCApplicabilitySubType.id.in_(plan.sub_type_link_ids)
            )
        )
    if plan.rule_ids_to_delete:
        rule_ids = plan.rule_ids_to_delete
        db.execute(
            delete(QCApplicabilityHouseType).where(
                QCApplicabilityHouseType.applicability_id.in_(rule_ids)
            )
        )
        db.execute(
            delete(QCApplicabilitySubType).where(
                QCApplicabilitySubType.applicability_id.in_(rule_ids)
            )
        )
        db.execute(
            delete(QCApplicabilityPanelGroup).where(
                QCApplicabilityPanelGroup.applicability_id.in_(rule_ids)
            )
        )
        db.execute(delete(QCApplicability).where(QCApplicability.id.in_(rule_ids)))
    if plan.check_ids_to_deactivate:
        db.execute(
            update(QCCheckDefinition)
            .where(QCCheckDefinition.id.in_(plan.check_ids_to_deactivate))
            .values(active=False)
            .execution_options(synchronize_session=False)
        )
