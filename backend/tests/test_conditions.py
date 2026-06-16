from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.models.enums import TaskScope
from app.models.tasks import TaskApplicability, TaskDefinition
from app.services.conditions import ConditionContext, ConditionRule, conditions_met
from app.services.task_applicability import resolve_task_station_sequence


def task(task_id: int, name: str, sequence: int | None = 1) -> TaskDefinition:
    return TaskDefinition(
        id=task_id,
        name=name,
        scope=TaskScope.MODULE,
        default_station_sequence=sequence,
        active=True,
    )


def rule(
    type_id: int,
    value_ids: set[int],
    mode: str = "is",
    house_type_id: int | None = None,
) -> ConditionRule:
    return ConditionRule(
        condition_type_id=type_id,
        house_type_id=house_type_id,
        mode=mode,
        value_ids=frozenset(value_ids),
    )


class ConditionsMetTests(unittest.TestCase):
    def test_no_rules_always_pass(self) -> None:
        self.assertTrue(conditions_met(None, frozenset(), 1))
        self.assertTrue(conditions_met((), frozenset({1, 2}), 1))

    def test_is_rule_met(self) -> None:
        self.assertTrue(conditions_met((rule(1, {10}),), frozenset({10, 99}), 1))

    def test_is_rule_unmet(self) -> None:
        self.assertFalse(conditions_met((rule(1, {10}),), frozenset({11}), 1))
        self.assertFalse(conditions_met((rule(1, {10}),), frozenset(), 1))

    def test_or_within_rule_values(self) -> None:
        rules = (rule(1, {10, 11}),)
        self.assertTrue(conditions_met(rules, frozenset({11}), 1))
        self.assertTrue(conditions_met(rules, frozenset({10}), 1))
        self.assertFalse(conditions_met(rules, frozenset({12}), 1))

    def test_and_across_rules(self) -> None:
        rules = (rule(1, {10}), rule(2, {20}))
        self.assertTrue(conditions_met(rules, frozenset({10, 20}), 1))
        self.assertFalse(conditions_met(rules, frozenset({10}), 1))
        self.assertFalse(conditions_met(rules, frozenset({20}), 1))

    def test_is_not_rule_blocks_when_value_present(self) -> None:
        rules = (rule(1, {10, 11}, mode="is_not"),)
        self.assertFalse(conditions_met(rules, frozenset({10}), 1))
        self.assertFalse(conditions_met(rules, frozenset({11, 99}), 1))

    def test_is_not_rule_passes_when_value_absent(self) -> None:
        rules = (rule(1, {10, 11}, mode="is_not"),)
        self.assertTrue(conditions_met(rules, frozenset(), 1))
        self.assertTrue(conditions_met(rules, frozenset({12}), 1))

    def test_house_scoped_rule_only_applies_to_matching_house(self) -> None:
        rules = (rule(1, {10}, house_type_id=7),)
        # unit of house 7 must satisfy the rule
        self.assertFalse(conditions_met(rules, frozenset(), 7))
        self.assertTrue(conditions_met(rules, frozenset({10}), 7))
        # other houses skip it entirely
        self.assertTrue(conditions_met(rules, frozenset(), 8))

    def test_mixed_global_and_house_scoped_rules(self) -> None:
        rules = (
            rule(1, {10}),  # global: requires 10
            rule(2, {20}, mode="is_not", house_type_id=7),  # house 7: blocks 20
        )
        self.assertTrue(conditions_met(rules, frozenset({10}), 8))
        self.assertTrue(conditions_met(rules, frozenset({10, 20}), 8))
        self.assertFalse(conditions_met(rules, frozenset({10, 20}), 7))
        self.assertTrue(conditions_met(rules, frozenset({10}), 7))


class ResolverConditionFilterTests(unittest.TestCase):
    def test_unmet_conditions_suppress_scope_applicable_task(self) -> None:
        task_def = task(10, "Treated sill plate installation")

        applies, station_sequence = resolve_task_station_sequence(
            task_def,
            [],
            house_type_id=1,
            sub_type_id=None,
            module_number=1,
            panel_definition_id=None,
            condition_requirements=(rule(1, {10}),),
            unit_condition_value_ids=frozenset(),
        )

        self.assertFalse(applies)
        self.assertIsNone(station_sequence)

    def test_met_conditions_fall_through_to_scope_resolution(self) -> None:
        task_def = task(10, "Treated sill plate installation")
        row = TaskApplicability(
            id=1,
            task_definition_id=10,
            house_type_id=1,
            applies=True,
            station_sequence_order=3,
        )

        applies, station_sequence = resolve_task_station_sequence(
            task_def,
            [row],
            house_type_id=1,
            sub_type_id=None,
            module_number=1,
            panel_definition_id=None,
            condition_requirements=(rule(1, {10}),),
            unit_condition_value_ids=frozenset({10}),
        )

        self.assertTrue(applies)
        self.assertEqual(station_sequence, 3)

    def test_resolver_uses_house_type_for_scoped_rules(self) -> None:
        task_def = task(10, "Optional package work")
        scoped = (rule(1, {10}, house_type_id=2),)

        applies_other_house, _ = resolve_task_station_sequence(
            task_def,
            [],
            house_type_id=1,
            sub_type_id=None,
            module_number=1,
            panel_definition_id=None,
            condition_requirements=scoped,
            unit_condition_value_ids=frozenset(),
        )
        applies_scoped_house, _ = resolve_task_station_sequence(
            task_def,
            [],
            house_type_id=2,
            sub_type_id=None,
            module_number=1,
            panel_definition_id=None,
            condition_requirements=scoped,
            unit_condition_value_ids=frozenset(),
        )

        self.assertTrue(applies_other_house)
        self.assertFalse(applies_scoped_house)

    def test_scope_false_override_wins_even_with_met_conditions(self) -> None:
        task_def = task(10, "Treated sill plate installation")
        row = TaskApplicability(
            id=1,
            task_definition_id=10,
            house_type_id=1,
            applies=False,
            station_sequence_order=None,
        )

        applies, _station_sequence = resolve_task_station_sequence(
            task_def,
            [row],
            house_type_id=1,
            sub_type_id=None,
            module_number=1,
            panel_definition_id=None,
            condition_requirements=(rule(1, {10}),),
            unit_condition_value_ids=frozenset({10}),
        )

        self.assertFalse(applies)

    def test_no_conditions_keeps_existing_behavior(self) -> None:
        task_def = task(10, "Armado")

        applies, station_sequence = resolve_task_station_sequence(
            task_def,
            [],
            house_type_id=1,
            sub_type_id=None,
            module_number=1,
            panel_definition_id=None,
        )

        self.assertTrue(applies)
        self.assertEqual(station_sequence, 1)


class ConditionContextTests(unittest.TestCase):
    def test_task_applies_uses_unit_assignments(self) -> None:
        ctx = ConditionContext(
            rules_by_task={10: (rule(1, {100}),)},
            values_by_work_unit={5: {100}, 6: {101}},
        )

        self.assertTrue(ctx.task_applies(10, 5, 1))
        self.assertFalse(ctx.task_applies(10, 6, 1))
        self.assertFalse(ctx.task_applies(10, 7, 1))
        self.assertFalse(ctx.task_applies(10, None, 1))
        self.assertTrue(ctx.task_applies(99, 6, 1))

    def test_task_applies_respects_house_scope(self) -> None:
        ctx = ConditionContext(
            rules_by_task={10: (rule(1, {100}, house_type_id=3),)},
            values_by_work_unit={5: set()},
        )

        self.assertFalse(ctx.task_applies(10, 5, 3))
        self.assertTrue(ctx.task_applies(10, 5, 4))


if __name__ == "__main__":
    unittest.main()
