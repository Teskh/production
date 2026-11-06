from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import HTTPException

from app.api.routes.task_definitions import (
    COVERAGE_CONDITIONAL,
    COVERAGE_MISSING,
    HouseTypeShape,
    _validated_dependencies,
    advance_coverage_gaps,
    coverage_stations,
    dependency_validation_error,
    dependent_tasks_for,
    find_dependency_cycle,
    qc_triggers_for_task,
)
from app.models.enums import StationLineType, StationRole, TaskScope
from app.models.stations import Station
from app.models.tasks import TaskApplicability, TaskDefinition
from app.services.conditions import ConditionRule


def stored_task(task_id: int, name: str, deps=None, archived: bool = False, active: bool = True):
    return SimpleNamespace(
        id=task_id,
        name=name,
        dependencies_json=deps,
        archived_at="2026-01-01" if archived else None,
        active=active,
    )


def module_task(task_id: int, name: str, sequence: int, advance: bool = False) -> TaskDefinition:
    return TaskDefinition(
        id=task_id,
        name=name,
        scope=TaskScope.MODULE,
        default_station_sequence=sequence,
        active=True,
        advance_trigger=advance,
    )


def rule(row_id: int, task_id: int, applies: bool, sequence: int | None, **scope) -> TaskApplicability:
    return TaskApplicability(
        id=row_id,
        task_definition_id=task_id,
        house_type_id=scope.get("house_type_id"),
        sub_type_id=scope.get("sub_type_id"),
        module_number=scope.get("module_number"),
        panel_definition_id=None,
        applies=applies,
        station_sequence_order=sequence,
    )


class _NoDb:
    def execute(self, _statement: object) -> object:
        raise AssertionError("database should not be queried")


class _RowsDb:
    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = rows

    def execute(self, _statement: object) -> SimpleNamespace:
        return SimpleNamespace(all=lambda: self.rows)


class DependencyValidationTests(unittest.TestCase):
    def test_direct_cycle_is_found_with_path(self) -> None:
        cycle = find_dependency_cycle(1, [2], {2: [1]})
        self.assertEqual(cycle, [1, 2, 1])

    def test_indirect_cycle_is_found(self) -> None:
        cycle = find_dependency_cycle(1, [2], {2: [3], 3: [1], 4: [1]})
        self.assertEqual(cycle, [1, 2, 3, 1])

    def test_shared_prerequisite_is_not_a_cycle(self) -> None:
        self.assertIsNone(find_dependency_cycle(1, [2, 3], {2: [4], 3: [4], 4: []}))

    def test_stored_entry_for_saved_task_is_replaced(self) -> None:
        # Task 1 used to depend on 2; the new list drops it, so 2 -> 1 is fine.
        self.assertIsNone(find_dependency_cycle(1, [], {1: [2], 2: [1]}))

    def test_self_reference_rejected(self) -> None:
        tasks = [stored_task(1, "A")]
        error = dependency_validation_error(1, [1], tasks)
        self.assertEqual(error, "Una tarea no puede depender de si misma.")

    def test_missing_dependency_rejected(self) -> None:
        error = dependency_validation_error(1, [99], [stored_task(1, "A")])
        self.assertIn("#99", error or "")

    def test_archived_dependency_rejected(self) -> None:
        tasks = [stored_task(1, "A"), stored_task(2, "Vieja", archived=True)]
        error = dependency_validation_error(1, [2], tasks)
        self.assertIn("archivadas", error or "")
        self.assertIn("Vieja", error or "")

    def test_already_saved_archived_dependency_is_tolerated(self) -> None:
        # Editing a task (e.g. renaming it) resubmits its saved dependencies; one that
        # was archived later must not block the save.
        tasks = [stored_task(1, "A"), stored_task(2, "Vieja", archived=True)]
        self.assertIsNone(dependency_validation_error(1, [2], tasks, existing_ids=[2]))

    def test_cycle_message_names_tasks(self) -> None:
        tasks = [stored_task(1, "Armado"), stored_task(2, "Revision", deps=[1])]
        error = dependency_validation_error(1, [2], tasks)
        self.assertEqual(error, "Las dependencias crean un ciclo: Armado → Revision → Armado.")

    def test_archived_task_edges_are_ignored(self) -> None:
        # An archived task cannot run, so its stored deps do not close a cycle.
        tasks = [
            stored_task(1, "A"),
            stored_task(2, "B", deps=[3]),
            stored_task(3, "C", deps=[1], archived=True),
        ]
        self.assertIsNone(dependency_validation_error(1, [2], tasks))

    def test_new_task_only_checks_existence(self) -> None:
        tasks = [stored_task(2, "B", deps=[3]), stored_task(3, "C", deps=[2])]
        self.assertIsNone(dependency_validation_error(None, [2], tasks))

    def test_empty_or_null_dependencies_skip_database(self) -> None:
        self.assertIsNone(_validated_dependencies(_NoDb(), 5, None))  # type: ignore[arg-type]
        self.assertEqual(_validated_dependencies(_NoDb(), 5, []), [])  # type: ignore[arg-type]

    def test_validated_dependencies_raise_400_and_dedupe(self) -> None:
        db = _RowsDb([stored_task(1, "A"), stored_task(2, "B", deps=[1])])
        with self.assertRaises(HTTPException) as ctx:
            _validated_dependencies(db, 1, [2])  # type: ignore[arg-type]
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(_validated_dependencies(db, 2, [1, 1]), [1])  # type: ignore[arg-type]


class TaskDependentsTests(unittest.TestCase):
    def test_qc_triggers_matching_task_ids(self) -> None:
        rows = [
            (1, 10, "Check A", {"task_definition_ids": [5, 7]}),
            (2, 11, "Check B", {"task_definition_ids": ["5"]}),
            (3, 12, "Check C", {"task_definition_ids": [8]}),
            (4, 13, "Check D", None),
        ]
        triggers = qc_triggers_for_task(5, rows)
        self.assertEqual([trigger.trigger_id for trigger in triggers], [1, 2])

    def test_dependent_tasks_exclude_archived(self) -> None:
        tasks = [
            stored_task(5, "Base"),
            stored_task(6, "Zocalo", deps=[5]),
            stored_task(7, "Archivada", deps=[5], archived=True),
            stored_task(8, "Alero", deps=[5], active=False),
            stored_task(9, "Otra", deps=[4]),
        ]
        dependents = dependent_tasks_for(5, tasks)
        self.assertEqual([dep.name for dep in dependents], ["Alero", "Zocalo"])
        self.assertFalse(dependents[0].active)


class AdvanceCoverageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.house_a = HouseTypeShape(id=1, name="Casa A", number_of_modules=2)
        self.house_b = HouseTypeShape(id=2, name="Casa B", number_of_modules=1)

    def test_station_without_advance_task_is_missing_for_every_module(self) -> None:
        tasks = [module_task(1, "Terminaciones", 12)]
        gaps, _ = advance_coverage_gaps(tasks, {}, {}, [self.house_a], [12])
        self.assertEqual(
            gaps,
            {(12, 1, None, 1, COVERAGE_MISSING), (12, 1, None, 2, COVERAGE_MISSING)},
        )

    def test_station_without_any_module_task_is_skipped(self) -> None:
        tasks = [module_task(1, "Mover", 12, advance=True)]
        gaps, names = advance_coverage_gaps(tasks, {}, {}, [self.house_a], [12, 13])
        self.assertEqual(gaps, set())
        self.assertEqual(names, {12: {"Mover"}})

    def test_advance_task_excluded_for_house_type_and_module(self) -> None:
        tasks = [module_task(1, "Terminaciones", 12), module_task(2, "Mover", 12, advance=True)]
        applicability = {
            2: [rule(1, 2, False, None, house_type_id=1, module_number=2)],
        }
        gaps, _ = advance_coverage_gaps(
            tasks, applicability, {}, [self.house_a, self.house_b], [12]
        )
        self.assertEqual(gaps, {(12, 1, None, 2, COVERAGE_MISSING)})

    def test_condition_gated_advance_task_is_conditional(self) -> None:
        tasks = [module_task(1, "Terminaciones", 12), module_task(2, "Mover", 12, advance=True)]
        rules = {
            2: (ConditionRule(condition_type_id=1, house_type_id=2, mode="is", value_ids=frozenset({4})),)
        }
        gaps, _ = advance_coverage_gaps(tasks, {}, rules, [self.house_a, self.house_b], [12])
        self.assertEqual(gaps, {(12, 2, None, 1, COVERAGE_CONDITIONAL)})

    def test_excluding_task_reveals_sole_advance_trigger(self) -> None:
        tasks = [module_task(1, "Terminaciones", 12), module_task(2, "Mover", 12, advance=True)]
        baseline, _ = advance_coverage_gaps(tasks, {}, {}, [self.house_b], [12])
        without, _ = advance_coverage_gaps(tasks, {}, {}, [self.house_b], [12], exclude_task_id=2)
        self.assertEqual(without - baseline, {(12, 2, None, 1, COVERAGE_MISSING)})

    def test_sub_types_are_evaluated_and_named_when_partial(self) -> None:
        house = HouseTypeShape(
            id=3, name="Casa C", number_of_modules=1, sub_types=((30, "Espejo"), (31, "Normal"))
        )
        tasks = [module_task(1, "Terminaciones", 12), module_task(2, "Mover", 12, advance=True)]
        applicability = {2: [rule(1, 2, False, None, house_type_id=3, sub_type_id=30)]}
        gaps, names = advance_coverage_gaps(tasks, applicability, {}, [house], [12])
        self.assertEqual(gaps, {(12, 3, 30, 1, COVERAGE_MISSING)})
        stations = [
            Station(id=14, name="Estacion 1", role=StationRole.ASSEMBLY, line_type=StationLineType.LINE_1, sequence_order=12),
            Station(id=99, name="Estacion 9", role=StationRole.ASSEMBLY, line_type=StationLineType.LINE_1, sequence_order=20),
        ]
        result = coverage_stations(gaps, stations, [house], names)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].line_type, "1")
        self.assertEqual(result[0].advance_task_names, ["Mover"])
        entry = result[0].house_types[0]
        self.assertEqual(entry.house_type_name, "Casa C")
        self.assertEqual(entry.module_numbers, [1])
        self.assertEqual(entry.sub_type_names, ["Espejo"])


if __name__ == "__main__":
    unittest.main()
