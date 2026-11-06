"""Participation and pause bookkeeping for task instances.

Shared by the worker task routes (pause/resume/skip/leave) and the worker admin routes
(deactivation), so that pauses never stack up and crew members can always leave a task.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.models.enums import TaskStatus
from app.models.tasks import TaskInstance, TaskParticipation, TaskPause

OPEN_INSTANCE_STATUSES = (TaskStatus.IN_PROGRESS, TaskStatus.PAUSED)
# Includes instances created but never started (e.g. imported); module completion must
# close those too.
UNFINISHED_INSTANCE_STATUSES = (TaskStatus.NOT_STARTED, *OPEN_INSTANCE_STATUSES)
AUTO_PAUSE_NO_PARTICIPANTS = "Pausa automatica: sin participantes"
AUTO_PAUSE_WORKER_DEACTIVATED = "Pausa automatica: trabajador desactivado"


def close_open_pauses(db: Session, task_instance_id: int, at: datetime) -> int:
    pauses = list(
        db.execute(
            select(TaskPause)
            .where(TaskPause.task_instance_id == task_instance_id)
            .where(TaskPause.resumed_at.is_(None))
        ).scalars()
    )
    for pause in pauses:
        pause.resumed_at = at
    return len(pauses)


def close_open_participations(db: Session, task_instance_id: int, at: datetime) -> int:
    participations = list(
        db.execute(
            select(TaskParticipation)
            .where(TaskParticipation.task_instance_id == task_instance_id)
            .where(TaskParticipation.left_at.is_(None))
        ).scalars()
    )
    for participation in participations:
        participation.left_at = at
    return len(participations)


def lock_instance(db: Session, instance: TaskInstance) -> TaskStatus | None:
    """Row-lock ``instance`` so concurrent pause/leave requests serialize on it.

    Returns the status stored in the database once the lock is held (it may have been
    changed by a request that committed while this one waited)."""
    if instance.id is None:
        return None
    return (
        db.execute(
            select(TaskInstance.status)
            .where(TaskInstance.id == instance.id)
            .with_for_update()
        )
        .scalars()
        .first()
    )


def _sync_locked_status(instance: TaskInstance, stored_status: TaskStatus | None) -> None:
    """Adopt the status read under the row lock; the cached ORM value may be stale."""
    if stored_status is not None and instance.status != stored_status:
        instance.status = stored_status


def has_open_pause(db: Session, task_instance_id: int) -> bool:
    return (
        db.execute(
            select(TaskPause.id)
            .where(TaskPause.task_instance_id == task_instance_id)
            .where(TaskPause.resumed_at.is_(None))
            .limit(1)
        ).first()
        is not None
    )


def pause_instance(
    db: Session,
    instance: TaskInstance,
    *,
    reason_id: int | None = None,
    reason_text: str | None = None,
    at: datetime | None = None,
) -> bool:
    """Pause ``instance``; a no-op when it is already paused. Returns True if it paused."""
    _sync_locked_status(instance, lock_instance(db, instance))
    if instance.status != TaskStatus.IN_PROGRESS:
        # Already paused, or finished/skipped by a request that committed first.
        return False
    instance.status = TaskStatus.PAUSED
    if not has_open_pause(db, instance.id):
        db.add(
            TaskPause(
                task_instance_id=instance.id,
                reason_id=reason_id,
                reason_text=reason_text,
                paused_at=at or utc_now(),
            )
        )
    return True


def active_participant_count(db: Session, task_instance_id: int) -> int:
    return int(
        db.execute(
            select(func.count(TaskParticipation.id))
            .where(TaskParticipation.task_instance_id == task_instance_id)
            .where(TaskParticipation.left_at.is_(None))
        ).scalar()
        or 0
    )


def leave_task(
    db: Session,
    instance: TaskInstance,
    worker_id: int,
    *,
    at: datetime | None = None,
    pause_reason_text: str = AUTO_PAUSE_NO_PARTICIPANTS,
) -> bool | None:
    """Close the worker's open participation in ``instance``.

    Returns None when the worker was not participating, otherwise whether the task was
    auto-paused because nobody is left working on it.
    """
    now = at or utc_now()
    # Lock first: two crew members leaving at once must not both see the other one as
    # still participating and leave the task running with nobody on it.
    _sync_locked_status(instance, lock_instance(db, instance))
    participations = list(
        db.execute(
            select(TaskParticipation)
            .where(TaskParticipation.task_instance_id == instance.id)
            .where(TaskParticipation.worker_id == worker_id)
            .where(TaskParticipation.left_at.is_(None))
        ).scalars()
    )
    if not participations:
        return None
    for participation in participations:
        participation.left_at = now
    db.flush()
    if instance.status != TaskStatus.IN_PROGRESS:
        return False
    if active_participant_count(db, instance.id) > 0:
        return False
    return pause_instance(db, instance, reason_text=pause_reason_text, at=now)


@dataclass(frozen=True)
class ReleasedParticipation:
    instance: TaskInstance
    auto_paused: bool


def release_worker_participations(
    db: Session,
    worker_id: int,
    *,
    pause_reason_text: str = AUTO_PAUSE_WORKER_DEACTIVATED,
) -> list[ReleasedParticipation]:
    """Remove a worker from every open task (e.g. on deactivation)."""
    now = utc_now()
    instances = list(
        db.execute(
            select(TaskInstance)
            .join(TaskParticipation, TaskParticipation.task_instance_id == TaskInstance.id)
            .where(TaskParticipation.worker_id == worker_id)
            .where(TaskParticipation.left_at.is_(None))
            .distinct()
            .order_by(TaskInstance.id)
        ).scalars()
    )
    released: list[ReleasedParticipation] = []
    for instance in instances:
        auto_paused = leave_task(
            db, instance, worker_id, at=now, pause_reason_text=pause_reason_text
        )
        released.append(ReleasedParticipation(instance=instance, auto_paused=bool(auto_paused)))
    return released


def open_task_instances_for_worker(db: Session, worker_id: int) -> list[TaskInstance]:
    return list(
        db.execute(
            select(TaskInstance)
            .join(TaskParticipation, TaskParticipation.task_instance_id == TaskInstance.id)
            .where(TaskParticipation.worker_id == worker_id)
            .where(TaskParticipation.left_at.is_(None))
            .where(TaskInstance.status.in_(OPEN_INSTANCE_STATUSES))
            .distinct()
            .order_by(TaskInstance.id)
        ).scalars()
    )


CLOSED_BY_MODULE_COMPLETION_NOTE = "Cerrada sin terminar al marcar el modulo como terminado"


def close_open_instances_for_work_unit(
    db: Session, work_unit_id: int, note: str = CLOSED_BY_MODULE_COMPLETION_NOTE
) -> list[TaskInstance]:
    """Close every open (non-rework) task of a module and its panels as SKIPPED.

    Used when a module is declared finished with work still open: the tasks were not
    confirmed done, so they must not look like completions in reports or production
    exits, but the labor already recorded on them is kept (costs count started skips).
    """
    now = utc_now()
    instances = list(
        db.execute(
            select(TaskInstance)
            .where(TaskInstance.work_unit_id == work_unit_id)
            .where(TaskInstance.rework_task_id.is_(None))
            .where(TaskInstance.status.in_(UNFINISHED_INSTANCE_STATUSES))
            .with_for_update()
        ).scalars()
    )
    for instance in instances:
        instance.status = TaskStatus.SKIPPED
        instance.completed_at = now
        instance.notes = f"{instance.notes}\n{note}" if instance.notes else note
        close_open_participations(db, instance.id, now)
        close_open_pauses(db, instance.id, now)
    return instances
