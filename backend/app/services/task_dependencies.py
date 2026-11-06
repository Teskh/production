"""Task dependency evaluation shared by task start (worker_tasks) and station views.

A prerequisite only blocks a dependent task while it still has real work pending for the
same unit. It counts as satisfied when it is:

- completed, or skipped (a SKIPPED instance or a SKIP exception) for the same module/panel;
- archived, inactive or deleted (it can never be done any more);
- not applicable to this module/panel (applicability rows, panel task list or conditions).

Without these rules a dependent task deadlocks forever once its prerequisite was skipped
or stopped applying.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import TaskExceptionType, TaskScope, TaskStatus
from app.models.tasks import TaskApplicability, TaskDefinition, TaskException, TaskInstance
from app.services.conditions import ConditionContext, load_condition_context
from app.services.task_applicability import resolve_task_station_sequence

RESOLVED_TASK_STATUSES = (TaskStatus.COMPLETED, TaskStatus.SKIPPED)
OPEN_TASK_STATUSES = (TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS, TaskStatus.PAUSED)


def _coerce_dependency_id(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def dependency_ids_of(dependencies: Any) -> list[int] | None:
    """Return the dependency ids, or None when the stored value is malformed."""
    if dependencies is None:
        return []
    if not isinstance(dependencies, list):
        return None
    ids: list[int] = []
    for value in dependencies:
        dependency_id = _coerce_dependency_id(value)
        if dependency_id is not None and dependency_id not in ids:
            ids.append(dependency_id)
    return ids


def collect_dependency_ids(task_definitions: Iterable[Any]) -> set[int]:
    collected: set[int] = set()
    for task in task_definitions:
        ids = dependency_ids_of(getattr(task, "dependencies_json", None))
        if ids:
            collected.update(ids)
    return collected


@dataclass(frozen=True)
class ResolvedTasks:
    """Task definition ids already done (completed or skipped) for one module/panel."""

    module_ids: frozenset[int] = frozenset()
    panel_ids: frozenset[int] = frozenset()
    any_panel_ids: frozenset[int] = frozenset()
    # Task definition ids with an unfinished instance (started but not done).
    open_module_ids: frozenset[int] = frozenset()
    open_panel_ids: frozenset[int] = frozenset()
    open_any_panel_ids: frozenset[int] = frozenset()


class ResolvedTaskIndex:
    """Completed/skipped task ids for many work units, loaded with two queries."""

    def __init__(
        self,
        rows: Iterable[tuple[int, int, int | None]],
        open_rows: Iterable[tuple[int, int, int | None]] = (),
    ) -> None:
        self._module: dict[int, set[int]] = {}
        self._any_panel: dict[int, set[int]] = {}
        self._panel: dict[tuple[int, int], set[int]] = {}
        self._open_module: dict[int, set[int]] = {}
        self._open_any_panel: dict[int, set[int]] = {}
        self._open_panel: dict[tuple[int, int], set[int]] = {}
        self._index(rows, self._module, self._any_panel, self._panel)
        self._index(open_rows, self._open_module, self._open_any_panel, self._open_panel)

    @staticmethod
    def _index(
        rows: Iterable[tuple[int, int, int | None]],
        module: dict[int, set[int]],
        any_panel: dict[int, set[int]],
        panel: dict[tuple[int, int], set[int]],
    ) -> None:
        for work_unit_id, task_definition_id, panel_unit_id in rows:
            if panel_unit_id is None:
                module.setdefault(work_unit_id, set()).add(task_definition_id)
                continue
            any_panel.setdefault(work_unit_id, set()).add(task_definition_id)
            panel.setdefault((work_unit_id, panel_unit_id), set()).add(task_definition_id)

    @classmethod
    def load(cls, db: Session, work_unit_ids: Iterable[int]) -> ResolvedTaskIndex:
        ids = sorted(set(work_unit_ids))
        if not ids:
            return cls([])
        instance_rows = db.execute(
            select(
                TaskInstance.work_unit_id,
                TaskInstance.task_definition_id,
                TaskInstance.panel_unit_id,
            )
            .where(TaskInstance.work_unit_id.in_(ids))
            .where(TaskInstance.rework_task_id.is_(None))
            .where(TaskInstance.status.in_(RESOLVED_TASK_STATUSES))
        ).all()
        exception_rows = db.execute(
            select(
                TaskException.work_unit_id,
                TaskException.task_definition_id,
                TaskException.panel_unit_id,
            )
            .where(TaskException.work_unit_id.in_(ids))
            .where(TaskException.exception_type == TaskExceptionType.SKIP)
        ).all()
        open_rows = db.execute(
            select(
                TaskInstance.work_unit_id,
                TaskInstance.task_definition_id,
                TaskInstance.panel_unit_id,
            )
            .where(TaskInstance.work_unit_id.in_(ids))
            .where(TaskInstance.rework_task_id.is_(None))
            .where(TaskInstance.status.in_(OPEN_TASK_STATUSES))
        ).all()
        return cls(
            [tuple(row) for row in (*instance_rows, *exception_rows)],
            [tuple(row) for row in open_rows],
        )

    def for_unit(self, work_unit_id: int, panel_unit_id: int | None) -> ResolvedTasks:
        panel_ids: set[int] = set()
        open_panel_ids: set[int] = set()
        if panel_unit_id is not None:
            panel_ids = self._panel.get((work_unit_id, panel_unit_id), set())
            open_panel_ids = self._open_panel.get((work_unit_id, panel_unit_id), set())
        return ResolvedTasks(
            module_ids=frozenset(self._module.get(work_unit_id, ())),
            panel_ids=frozenset(panel_ids),
            any_panel_ids=frozenset(self._any_panel.get(work_unit_id, ())),
            open_module_ids=frozenset(self._open_module.get(work_unit_id, ())),
            open_panel_ids=frozenset(open_panel_ids),
            open_any_panel_ids=frozenset(self._open_any_panel.get(work_unit_id, ())),
        )


def load_resolved_tasks(
    db: Session, work_unit_id: int, panel_unit_id: int | None
) -> ResolvedTasks:
    return ResolvedTaskIndex.load(db, [work_unit_id]).for_unit(work_unit_id, panel_unit_id)


@dataclass(frozen=True)
class DependencyRules:
    """Definitions, applicability and conditions of every referenced prerequisite."""

    definitions: dict[int, Any]
    applicability_map: dict[int, list[Any]] = field(default_factory=dict)
    condition_ctx: ConditionContext = field(
        default_factory=lambda: ConditionContext({}, {})
    )

    @classmethod
    def load(
        cls,
        db: Session,
        dependency_ids: Iterable[int],
        work_unit_ids: Iterable[int] | None,
    ) -> DependencyRules:
        ids = sorted(set(dependency_ids))
        if not ids:
            return cls(definitions={})
        definitions = {
            task.id: task
            for task in db.execute(
                select(TaskDefinition).where(TaskDefinition.id.in_(ids))
            ).scalars()
        }
        applicability_map: dict[int, list[Any]] = {}
        for row in db.execute(
            select(TaskApplicability).where(TaskApplicability.task_definition_id.in_(ids))
        ).scalars():
            applicability_map.setdefault(row.task_definition_id, []).append(row)
        return cls(
            definitions=definitions,
            applicability_map=applicability_map,
            condition_ctx=load_condition_context(db, ids, work_unit_ids),
        )

    def name_for(self, dependency_id: int) -> str:
        dependency = self.definitions.get(dependency_id)
        return dependency.name if dependency is not None else f"Tarea {dependency_id}"

    def _applies(
        self,
        dependency: Any,
        *,
        work_unit_id: int,
        house_type_id: int,
        sub_type_id: int | None,
        module_number: int,
        panel_definition_id: int | None,
    ) -> bool:
        applies, _sequence = resolve_task_station_sequence(
            dependency,
            self.applicability_map.get(dependency.id, []),
            house_type_id,
            sub_type_id,
            module_number,
            panel_definition_id,
            condition_requirements=self.condition_ctx.requirements_for(dependency.id),
            unit_condition_value_ids=self.condition_ctx.values_for(work_unit_id),
        )
        return applies

    def missing_dependency_ids(
        self,
        task: Any,
        resolved: ResolvedTasks,
        *,
        work_unit_id: int,
        house_type_id: int,
        sub_type_id: int | None,
        module_number: int,
        panel_definition_id: int | None = None,
        panel_task_ids: list[int] | None = None,
    ) -> list[int] | None:
        """Prerequisites of ``task`` still pending; None when dependencies are malformed.

        ``panel_task_ids`` is accepted for caller compatibility but deliberately unused.
        """
        dependency_ids = dependency_ids_of(getattr(task, "dependencies_json", None))
        if dependency_ids is None:
            return None
        missing: list[int] = []
        for dependency_id in dependency_ids:
            if dependency_id == getattr(task, "id", None):
                continue
            dependency = self.definitions.get(dependency_id)
            if dependency is None:
                continue
            if dependency.scope == TaskScope.PANEL:
                if panel_definition_id is not None:
                    done_ids = resolved.panel_ids
                    open_ids = resolved.open_panel_ids
                else:
                    done_ids = resolved.any_panel_ids
                    open_ids = resolved.open_any_panel_ids
                target_panel_definition_id = panel_definition_id
            else:
                done_ids = resolved.module_ids
                open_ids = resolved.open_module_ids
                target_panel_definition_id = None
            if not dependency.active or dependency.archived_at is not None:
                # A retired prerequisite can no longer be started, but work already
                # under way on it still has to be finished first (even if an earlier
                # instance was completed or skipped).
                if dependency_id in open_ids:
                    missing.append(dependency_id)
                continue
            if dependency_id in done_ids:
                continue
            # Applicability rules (including per-panel rows) decide whether the
            # prerequisite applies; the panel's task list is ordering metadata only and
            # can drift from those rules, so it is not used to waive a prerequisite.
            if not self._applies(
                dependency,
                work_unit_id=work_unit_id,
                house_type_id=house_type_id,
                sub_type_id=sub_type_id,
                module_number=module_number,
                panel_definition_id=target_panel_definition_id,
            ):
                continue
            missing.append(dependency_id)
        return missing
