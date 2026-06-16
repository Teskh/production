from __future__ import annotations

from collections.abc import Iterable, Sequence, Set as AbstractSet
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.conditions import (
    ConditionType,
    TaskConditionRule,
    TaskConditionRuleValue,
    WorkUnitCondition,
)

CONDITION_RULE_MODE_IS = "is"
CONDITION_RULE_MODE_IS_NOT = "is_not"
CONDITION_RULE_MODES = (CONDITION_RULE_MODE_IS, CONDITION_RULE_MODE_IS_NOT)


@dataclass(frozen=True)
class ConditionRule:
    condition_type_id: int
    house_type_id: int | None
    mode: str
    value_ids: frozenset[int]


TaskConditionRules = tuple[ConditionRule, ...]


def conditions_met(
    rules: Sequence[ConditionRule] | None,
    unit_condition_value_ids: AbstractSet[int],
    house_type_id: int | None,
) -> bool:
    """Evaluate a task's condition rules against a work unit.

    Rules scoped to another house type are skipped; a global rule
    (house_type_id None) always evaluates. For matching rules, 'is' requires
    at least one of the rule's values to be assigned to the unit and 'is_not'
    requires none of them to be. All matching rules must pass (AND); tasks
    without rules always pass.
    """
    if not rules:
        return True
    for rule in rules:
        if rule.house_type_id is not None and rule.house_type_id != house_type_id:
            continue
        has_value = bool(rule.value_ids & unit_condition_value_ids)
        if rule.mode == CONDITION_RULE_MODE_IS_NOT:
            if has_value:
                return False
        elif not has_value:
            return False
    return True


class ConditionContext:
    """Preloaded condition rules and work-unit assignments."""

    __slots__ = ("_rules_by_task", "_values_by_work_unit")

    def __init__(
        self,
        rules_by_task: dict[int, TaskConditionRules],
        values_by_work_unit: dict[int, set[int]],
    ) -> None:
        self._rules_by_task = rules_by_task
        self._values_by_work_unit = values_by_work_unit

    def requirements_for(self, task_definition_id: int) -> TaskConditionRules | None:
        return self._rules_by_task.get(task_definition_id)

    def values_for(self, work_unit_id: int | None) -> frozenset[int]:
        if work_unit_id is None:
            return frozenset()
        return frozenset(self._values_by_work_unit.get(work_unit_id, ()))

    def task_applies(
        self,
        task_definition_id: int,
        work_unit_id: int | None,
        house_type_id: int | None,
    ) -> bool:
        return conditions_met(
            self.requirements_for(task_definition_id),
            self.values_for(work_unit_id),
            house_type_id,
        )


def load_condition_context(
    db: Session,
    task_definition_ids: Iterable[int],
    work_unit_ids: Iterable[int] | None,
) -> ConditionContext:
    """Preload condition data; pass work_unit_ids=None to load all assignments."""
    rules_by_task: dict[int, TaskConditionRules] = {}
    task_ids = sorted(set(task_definition_ids))
    if task_ids:
        rule_rows = db.execute(
            select(
                TaskConditionRule.task_definition_id,
                TaskConditionRule.id,
                TaskConditionRule.condition_type_id,
                TaskConditionRule.house_type_id,
                TaskConditionRule.mode,
                TaskConditionRuleValue.condition_value_id,
            )
            .join(
                TaskConditionRuleValue,
                TaskConditionRuleValue.rule_id == TaskConditionRule.id,
            )
            .join(ConditionType, ConditionType.id == TaskConditionRule.condition_type_id)
            .where(ConditionType.active == True)
            .where(TaskConditionRule.task_definition_id.in_(task_ids))
        ).all()
        grouped: dict[int, dict[int, tuple[int, int | None, str, set[int]]]] = {}
        for task_definition_id, rule_id, condition_type_id, house_type_id, mode, value_id in rule_rows:
            task_rules = grouped.setdefault(task_definition_id, {})
            entry = task_rules.get(rule_id)
            if entry is None:
                entry = (condition_type_id, house_type_id, mode, set())
                task_rules[rule_id] = entry
            entry[3].add(value_id)
        for task_definition_id, task_rules in grouped.items():
            rules_by_task[task_definition_id] = tuple(
                ConditionRule(
                    condition_type_id=condition_type_id,
                    house_type_id=house_type_id,
                    mode=mode,
                    value_ids=frozenset(value_ids),
                )
                for condition_type_id, house_type_id, mode, value_ids in task_rules.values()
            )

    values_by_work_unit: dict[int, set[int]] = {}
    assignment_stmt = select(
        WorkUnitCondition.work_unit_id,
        WorkUnitCondition.condition_value_id,
    )
    if work_unit_ids is not None:
        unit_ids = sorted(set(work_unit_ids))
        if not unit_ids:
            return ConditionContext(rules_by_task, values_by_work_unit)
        assignment_stmt = assignment_stmt.where(
            WorkUnitCondition.work_unit_id.in_(unit_ids)
        )
    for work_unit_id, condition_value_id in db.execute(assignment_stmt).all():
        values_by_work_unit.setdefault(work_unit_id, set()).add(condition_value_id)

    return ConditionContext(rules_by_task, values_by_work_unit)
