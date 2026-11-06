from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import HTTPException

from app.api.routes.stations import (
    StationPlacement,
    build_station_change_impact,
    delete_station,
    find_sequence_conflict,
    panel_start_lost,
    routed_task_names,
    update_station,
)
from app.models.enums import StationLineType, StationRole, TaskScope
from app.models.stations import Station
from app.schemas.stations import StationUpdate


def station(station_id: int, name: str, role: StationRole, seq: int | None, line: str | None = None):
    return SimpleNamespace(id=station_id, name=name, role=role, line_type=line, sequence_order=seq)


def task(task_id: int, name: str, scope: TaskScope, seq: int | None, active: bool = True):
    return SimpleNamespace(
        id=task_id,
        name=name,
        scope=scope,
        active=active,
        archived_at=None,
        default_station_sequence=seq,
    )


def placement(role: StationRole, seq: int | None, line: str | None = None) -> StationPlacement:
    return StationPlacement(role=role, line_type=line, sequence_order=seq)


STATIONS = [
    station(1, "Framing", StationRole.PANELS, 1),
    station(2, "Mesa 1", StationRole.PANELS, 2),
    station(11, "Armado L1", StationRole.ASSEMBLY, 11, "1"),
    station(12, "Armado L2", StationRole.ASSEMBLY, 11, "2"),
    station(14, "Estacion 1 L1", StationRole.ASSEMBLY, 12, "1"),
    station(32, "Precorte", StationRole.AUX, None),
]


class StationRoutingHelpersTests(unittest.TestCase):
    def test_sequence_conflict_is_per_role_and_line(self) -> None:
        self.assertIsNone(
            find_sequence_conflict(STATIONS, 14, placement(StationRole.ASSEMBLY, 11, "3"))
        )
        conflict = find_sequence_conflict(STATIONS, 14, placement(StationRole.ASSEMBLY, 11, "1"))
        self.assertEqual(conflict.id, 11)
        # Panels at 11 do not clash with assembly stations at 11.
        self.assertIsNone(find_sequence_conflict(STATIONS, 2, placement(StationRole.PANELS, 11)))

    def test_sequence_conflict_ignores_self_and_aux(self) -> None:
        self.assertIsNone(find_sequence_conflict(STATIONS, 2, placement(StationRole.PANELS, 2)))
        self.assertIsNone(find_sequence_conflict(STATIONS, 99, placement(StationRole.AUX, None)))

    def test_panel_start_lost_on_renumber_or_delete(self) -> None:
        self.assertTrue(panel_start_lost(STATIONS, 1, placement(StationRole.PANELS, 3)))
        self.assertTrue(panel_start_lost(STATIONS, 1, None))
        self.assertFalse(panel_start_lost(STATIONS, 2, placement(StationRole.PANELS, 5)))
        # Another station takes sequence 1 in the same edit.
        self.assertFalse(panel_start_lost(STATIONS, 1, placement(StationRole.PANELS, 1)))

    def test_routed_tasks_match_scope_sequence_and_overrides(self) -> None:
        tasks = [
            task(1, "Armado panel", TaskScope.PANEL, 2),
            task(2, "Modulo seq 2", TaskScope.MODULE, 2),
            task(3, "Override", TaskScope.PANEL, 5),
            task(4, "Inactiva", TaskScope.PANEL, 2, active=False),
        ]
        rows = [
            SimpleNamespace(task_definition_id=3, applies=True, station_sequence_order=2),
            SimpleNamespace(task_definition_id=2, applies=True, station_sequence_order=2),
        ]
        names = routed_task_names(2, placement(StationRole.PANELS, 2), tasks, rows)
        self.assertEqual(names, ["Armado panel", "Override"])

    def test_aux_tasks_route_by_station_id(self) -> None:
        tasks = [task(1, "Precorte", TaskScope.AUX, 32), task(2, "Otra AUX", TaskScope.AUX, 33)]
        names = routed_task_names(32, placement(StationRole.AUX, None), tasks, [])
        self.assertEqual(names, ["Precorte"])


class StationChangeImpactTests(unittest.TestCase):
    def test_occupied_station_blocks_sequence_change(self) -> None:
        impact = build_station_change_impact(
            STATIONS[1], placement(StationRole.PANELS, 3), STATIONS, [], [], 2, 0
        )
        self.assertIsNotNone(impact.blocking_message)
        self.assertIn("2 panel(es)", impact.blocking_message or "")

    def test_name_only_change_has_no_warnings_even_when_occupied(self) -> None:
        impact = build_station_change_impact(
            STATIONS[1], placement(StationRole.PANELS, 2), STATIONS, [], [], 2, 1
        )
        self.assertIsNone(impact.blocking_message)
        self.assertEqual(impact.warnings, [])

    def test_renumber_warns_about_stranded_tasks_and_panel_start(self) -> None:
        tasks = [task(1, "Armado Estructura Panel", TaskScope.PANEL, 1)]
        impact = build_station_change_impact(
            STATIONS[0], placement(StationRole.PANELS, 20), STATIONS, tasks, [], 0, 0
        )
        self.assertEqual(impact.routed_task_count, 1)
        self.assertTrue(impact.missing_panel_start)
        self.assertEqual(len(impact.warnings), 2)

    def test_assembly_sequence_still_covered_on_same_line_is_not_stranded(self) -> None:
        stations = [*STATIONS, station(15, "Duplicada L1", StationRole.ASSEMBLY, 12, "1")]
        tasks = [task(1, "Terminaciones", TaskScope.MODULE, 12)]
        impact = build_station_change_impact(
            stations[4], placement(StationRole.ASSEMBLY, 18, "1"), stations, tasks, [], 0, 0
        )
        self.assertEqual(impact.routed_task_count, 0)

    def test_assembly_other_lines_do_not_cover_this_line(self) -> None:
        tasks = [task(1, "Mover", TaskScope.MODULE, 11)]
        impact = build_station_change_impact(
            STATIONS[2], placement(StationRole.ASSEMBLY, 18, "1"), STATIONS, tasks, [], 0, 0
        )
        self.assertEqual(impact.routed_task_count, 1)
        self.assertIn("linea 1", impact.warnings[0])

    def test_conflict_reported_as_warning(self) -> None:
        impact = build_station_change_impact(
            STATIONS[4], placement(StationRole.ASSEMBLY, 11, "1"), STATIONS, [], [], 0, 0
        )
        self.assertEqual(impact.sequence_conflict_station, "Armado L1")


class _StationDb:
    def __init__(self, row: Station, others: list[Station], counts: list[int]) -> None:
        self.row = row
        self.others = others
        self.counts = list(counts)
        self.committed = False
        self.deleted = False

    def get(self, _model: type, row_id: int) -> Station | None:
        return self.row if row_id == self.row.id else None

    def scalar(self, _statement: object) -> int:
        return self.counts.pop(0)

    def execute(self, _statement: object) -> SimpleNamespace:
        rows = [self.row, *self.others]
        return SimpleNamespace(scalars=lambda: iter(rows))

    def delete(self, _row: object) -> None:
        self.deleted = True

    def commit(self) -> None:
        self.committed = True

    def refresh(self, _row: object) -> None:
        pass


class StationEndpointGuardTests(unittest.TestCase):
    def make_station(self) -> Station:
        return Station(id=2, name="Mesa 1", role=StationRole.PANELS, line_type=None, sequence_order=2)

    def test_update_blocks_sequence_change_with_panels_present(self) -> None:
        db = _StationDb(self.make_station(), [], [3, 0])
        with self.assertRaises(HTTPException) as ctx:
            update_station(2, StationUpdate(sequence_order=4), db, object())  # type: ignore[arg-type]
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertFalse(db.committed)

    def test_update_rejects_duplicate_sequence(self) -> None:
        other = Station(id=3, name="Puente 1", role=StationRole.PANELS, line_type=None, sequence_order=3)
        db = _StationDb(self.make_station(), [other], [0, 0])
        with self.assertRaises(HTTPException) as ctx:
            update_station(2, StationUpdate(sequence_order=3), db, object())  # type: ignore[arg-type]
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("Puente 1", ctx.exception.detail)

    def test_update_name_only_skips_guards(self) -> None:
        db = _StationDb(self.make_station(), [], [])
        payload = StationUpdate(name="Mesa Uno", role=StationRole.PANELS, sequence_order=2)
        saved = update_station(2, payload, db, object())  # type: ignore[arg-type]
        self.assertEqual(saved.name, "Mesa Uno")
        self.assertTrue(db.committed)

    def test_update_assembly_line_change_is_guarded(self) -> None:
        row = Station(id=14, name="Estacion 1", role=StationRole.ASSEMBLY, line_type=StationLineType.LINE_1, sequence_order=12)
        db = _StationDb(row, [], [0, 1])
        with self.assertRaises(HTTPException):
            update_station(14, StationUpdate(line_type=StationLineType.LINE_2), db, object())  # type: ignore[arg-type]

    def test_delete_blocked_while_occupied(self) -> None:
        db = _StationDb(self.make_station(), [], [0, 2])
        with self.assertRaises(HTTPException) as ctx:
            delete_station(2, db, object())  # type: ignore[arg-type]
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertFalse(db.deleted)


if __name__ == "__main__":
    unittest.main()
