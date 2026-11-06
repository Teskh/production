from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.routes.conditions import condition_deactivation_effect
from app.services.conditions import ConditionRule

FLOOR_TYPE = 1
ROOF_TYPE = 2


def cond(type_id: int, mode: str, *values: int, house_type_id: int | None = None) -> ConditionRule:
    return ConditionRule(
        condition_type_id=type_id,
        house_type_id=house_type_id,
        mode=mode,
        value_ids=frozenset(values),
    )


class ConditionDeactivationEffectTests(unittest.TestCase):
    def test_is_rule_drop_makes_task_apply_to_units_without_value(self) -> None:
        rules = {10: [cond(FLOOR_TYPE, "is", 100)]}
        units = [
            (1, 5, frozenset({100})),  # already applies; unchanged
            (2, 5, frozenset()),  # starts applying
        ]
        by_task, changed = condition_deactivation_effect(FLOOR_TYPE, rules, units)
        self.assertEqual(changed, {2})
        self.assertEqual(by_task[10], {2})

    def test_is_not_rule_drop_brings_back_excluded_units(self) -> None:
        rules = {11: [cond(FLOOR_TYPE, "is_not", 100)]}
        units = [(1, 5, frozenset({100})), (2, 5, frozenset())]
        _, changed = condition_deactivation_effect(FLOOR_TYPE, rules, units)
        self.assertEqual(changed, {1})

    def test_house_scoped_rule_only_affects_that_house_type(self) -> None:
        rules = {12: [cond(FLOOR_TYPE, "is", 100, house_type_id=7)]}
        units = [(1, 7, frozenset()), (2, 8, frozenset())]
        _, changed = condition_deactivation_effect(FLOOR_TYPE, rules, units)
        self.assertEqual(changed, {1})

    def test_other_condition_types_still_apply(self) -> None:
        # The roof rule still excludes unit 1, so dropping the floor rule changes nothing.
        rules = {13: [cond(FLOOR_TYPE, "is", 100), cond(ROOF_TYPE, "is", 200)]}
        units = [(1, 5, frozenset()), (2, 5, frozenset({200}))]
        by_task, changed = condition_deactivation_effect(FLOOR_TYPE, rules, units)
        self.assertEqual(changed, {2})
        self.assertEqual(by_task[13], {2})


if __name__ == "__main__":
    unittest.main()
