from __future__ import annotations

import sys
import unittest
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import HTTPException
from sqlalchemy import JSON, MetaData, create_engine, delete, event, select, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.api.routes import production_queue
from app.core.security import utc_now
from app.db.base import Base
from app.models.conditions import WorkUnitCondition
from app.models.enums import (
    PanelUnitStatus,
    StationRole,
    TaskScope,
    TaskStatus,
    WorkUnitStatus,
)
from app.models.house import HouseType, PanelDefinition
from app.models.panel_routing import PanelAutoRelease
from app.models.stations import Station
from app.models.tasks import TaskApplicability, TaskDefinition, TaskInstance
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.services import panel_routing
from app.services.conditions import ConditionContext
from app.services.panel_routing import (
    TRIGGER_ROUTING_CHANGE,
    AutoReleaseUndoError,
    PanelRoutingRules,
    _note_routing_statement,
    _touches_routing,
    advance_panel_if_satisfied,
    auto_release_undo_blocker,
    install_stalled_panel_guard,
    release_stalled_panels,
    undo_auto_release,
)


def _station(station_id: int, sequence_order: int) -> SimpleNamespace:
    return SimpleNamespace(
        id=station_id,
        name=f"S{sequence_order}",
        role=StationRole.PANELS,
        sequence_order=sequence_order,
    )


def _panel_row(task_id: int, applies: bool, sequence_order: int | None) -> SimpleNamespace:
    return SimpleNamespace(
        id=task_id * 100,
        task_definition_id=task_id,
        panel_definition_id=7,
        house_type_id=None,
        sub_type_id=None,
        module_number=None,
        applies=applies,
        station_sequence_order=sequence_order,
    )


class PanelRoutingRulesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.stations = [_station(1, 1), _station(2, 2), _station(3, 3), _station(4, 4)]
        self.work_unit = SimpleNamespace(id=50, module_number=4)
        self.work_order = SimpleNamespace(house_type_id=19, sub_type_id=None)
        self.panel = SimpleNamespace(id=7)

    def _rules(self, rows: list[SimpleNamespace]) -> PanelRoutingRules:
        tasks = [
            SimpleNamespace(id=row.task_definition_id, default_station_sequence=None)
            for row in rows
        ]
        return PanelRoutingRules(
            task_definitions=tasks,
            applicability_map={row.task_definition_id: [row] for row in rows},
            condition_ctx=ConditionContext({}, {}),
            panel_stations=self.stations,
        )

    def test_station_without_applicable_tasks_requires_nothing(self) -> None:
        rules = self._rules([_panel_row(1, True, 1), _panel_row(2, False, 2), _panel_row(3, True, 3)])

        required = rules.required_task_ids(
            self.stations[1], self.work_unit, self.work_order, self.panel
        )

        self.assertEqual(required, set())

    def test_next_station_skips_stations_without_work(self) -> None:
        rules = self._rules([_panel_row(1, True, 1), _panel_row(2, False, 2), _panel_row(3, True, 3)])

        next_station = rules.next_station(
            self.stations[1], self.work_unit, self.work_order, self.panel
        )

        self.assertIs(next_station, self.stations[2])

    def test_next_station_is_none_when_no_later_work(self) -> None:
        rules = self._rules([_panel_row(1, True, 1)])

        next_station = rules.next_station(
            self.stations[0], self.work_unit, self.work_order, self.panel
        )

        self.assertIsNone(next_station)


class RoutingChangeDetectionTests(unittest.TestCase):
    def test_pending_routing_objects_are_detected(self) -> None:
        session = SimpleNamespace(new=[TaskApplicability()], dirty=[], deleted=[])
        self.assertTrue(_touches_routing(session))

    def test_unrelated_objects_are_ignored(self) -> None:
        session = SimpleNamespace(new=[TaskInstance()], dirty=[PanelUnit()], deleted=[])
        self.assertFalse(_touches_routing(session))

    def _statement_state(self, statement: object, model: type, **flags: bool) -> SimpleNamespace:
        return SimpleNamespace(
            is_insert=flags.get("is_insert", False),
            is_update=flags.get("is_update", False),
            is_delete=flags.get("is_delete", False),
            bind_mapper=SimpleNamespace(class_=model),
            session=SimpleNamespace(info={}),
            statement=statement,
        )

    def test_bulk_delete_of_routing_rows_is_noted(self) -> None:
        state = self._statement_state(
            delete(WorkUnitCondition), WorkUnitCondition, is_delete=True
        )
        _note_routing_statement(state)
        self.assertTrue(state.session.info.get("panel_routing_changed"))

    def test_bulk_update_of_routing_rows_is_noted(self) -> None:
        state = self._statement_state(update(PanelDefinition), PanelDefinition, is_update=True)
        _note_routing_statement(state)
        self.assertTrue(state.session.info.get("panel_routing_changed"))

    def test_reads_and_unrelated_writes_are_ignored(self) -> None:
        read = self._statement_state(select(TaskApplicability), TaskApplicability)
        write = self._statement_state(update(PanelUnit), PanelUnit, is_update=True)
        _note_routing_statement(read)
        _note_routing_statement(write)
        self.assertEqual(read.session.info, {})
        self.assertEqual(write.session.info, {})


def _sqlite_engine():
    engine = create_engine("sqlite+pysqlite:///:memory:")

    # pysqlite's own transaction handling breaks SAVEPOINTs; let SQLAlchemy drive it.
    @event.listens_for(engine, "connect")
    def _connect(dbapi_connection, _record):
        dbapi_connection.isolation_level = None

    @event.listens_for(engine, "begin")
    def _begin(connection):
        connection.exec_driver_sql("BEGIN")

    metadata = MetaData()
    for table in Base.metadata.tables.values():
        table.to_metadata(metadata)
    for table in metadata.tables.values():
        for column in table.columns:
            if isinstance(column.type, JSONB):
                column.type = JSON()
    metadata.create_all(engine)
    return engine


class PanelRoutingDatabaseTests(unittest.TestCase):
    """One module with one panel and a task at each of three panel stations."""

    def setUp(self) -> None:
        self.engine = _sqlite_engine()
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()
        db = self.db
        db.add(HouseType(id=1, name="Casa", number_of_modules=1))
        db.add(
            PanelDefinition(
                id=1, house_type_id=1, module_sequence_number=1, group="Muros", panel_code="P1"
            )
        )
        self.stations = [
            Station(id=index, name=f"S{index}", role=StationRole.PANELS, sequence_order=index)
            for index in (1, 2, 3)
        ]
        db.add_all(self.stations)
        db.add(Station(id=9, name="Ensamble", role=StationRole.ASSEMBLY, sequence_order=10))
        self.tasks = [
            TaskDefinition(
                id=index,
                name=f"T{index}",
                scope=TaskScope.PANEL,
                default_station_sequence=index,
                active=True,
            )
            for index in (1, 2, 3)
        ]
        db.add_all(self.tasks)
        db.add(WorkOrder(id=1, project_name="Proyecto", house_identifier="C1", house_type_id=1))
        db.add(
            WorkUnit(
                id=1, work_order_id=1, module_number=1, planned_sequence=1,
                status=WorkUnitStatus.PANELS,
            )
        )
        db.add(
            PanelUnit(
                id=1, work_unit_id=1, panel_definition_id=1,
                status=PanelUnitStatus.IN_PROGRESS, current_station_id=1,
            )
        )
        db.commit()
        self.panel = db.get(PanelUnit, 1)
        self.work_unit = db.get(WorkUnit, 1)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _instance(self, task_id: int, station_id: int, status: TaskStatus, **times) -> TaskInstance:
        now = utc_now()
        instance = TaskInstance(
            task_definition_id=task_id,
            scope=TaskScope.PANEL,
            work_unit_id=1,
            panel_unit_id=1,
            station_id=station_id,
            status=status,
            started_at=times.get("started_at", now - timedelta(hours=1)),
            completed_at=times.get(
                "completed_at", now - timedelta(minutes=30) if status == TaskStatus.COMPLETED else None
            ),
        )
        self.db.add(instance)
        self.db.flush()
        return instance

    def _place(self, station_id: int | None, status: PanelUnitStatus) -> None:
        self.panel.current_station_id = station_id
        self.panel.status = status
        self.db.flush()

    # 1. Late completions never move a panel backwards or reopen it.

    def test_completion_at_current_station_advances(self) -> None:
        self._instance(1, 1, TaskStatus.COMPLETED)

        self.assertTrue(advance_panel_if_satisfied(self.db, self.panel, self.stations[0]))

        self.assertEqual(self.panel.current_station_id, 2)

    def test_late_completion_at_left_station_does_not_move_panel_back(self) -> None:
        self._place(3, PanelUnitStatus.IN_PROGRESS)
        self._instance(1, 1, TaskStatus.COMPLETED)

        self.assertFalse(advance_panel_if_satisfied(self.db, self.panel, self.stations[0]))

        self.assertEqual(self.panel.current_station_id, 3)
        self.assertEqual(self.panel.status, PanelUnitStatus.IN_PROGRESS)

    def test_late_completion_does_not_reopen_completed_panel(self) -> None:
        self._place(None, PanelUnitStatus.COMPLETED)
        self.work_unit.status = WorkUnitStatus.ASSEMBLY
        self._instance(1, 1, TaskStatus.COMPLETED)

        self.assertFalse(advance_panel_if_satisfied(self.db, self.panel, self.stations[0]))

        self.assertIsNone(self.panel.current_station_id)
        self.assertEqual(self.panel.status, PanelUnitStatus.COMPLETED)
        self.assertEqual(self.work_unit.status, WorkUnitStatus.ASSEMBLY)

    # 2. Only open work at the panel's current station holds it back.

    def test_forgotten_open_task_elsewhere_does_not_block_release(self) -> None:
        self._place(2, PanelUnitStatus.IN_PROGRESS)
        self._instance(1, 1, TaskStatus.PAUSED)
        self.tasks[1].active = False
        self.db.flush()

        released = release_stalled_panels(self.db)

        self.assertEqual([item.panel_unit.id for item in released], [1])
        self.assertEqual(self.panel.current_station_id, 3)

    def test_open_task_at_current_station_blocks_release(self) -> None:
        self._place(2, PanelUnitStatus.IN_PROGRESS)
        self._instance(2, 2, TaskStatus.IN_PROGRESS)
        self.tasks[1].active = False
        self.db.flush()

        self.assertEqual(release_stalled_panels(self.db), [])
        self.assertEqual(self.panel.current_station_id, 2)

    # 3. Every automatic release is recorded and can be undone.

    def test_guard_records_release_with_trigger_and_reason(self) -> None:
        # In-memory SQLite shares one connection; free it for the guarded session.
        self.db.close()
        db = self.session_factory()
        try:
            install_stalled_panel_guard(self.session_factory)
            db.get(TaskDefinition, 1).active = False
            db.commit()
            record = db.execute(select(PanelAutoRelease)).scalar_one()
            self.assertEqual(record.panel_unit_id, 1)
            self.assertEqual(record.from_station_id, 1)
            self.assertEqual(record.to_station_id, 2)
            self.assertEqual(record.previous_panel_status, PanelUnitStatus.IN_PROGRESS)
            self.assertEqual(record.previous_work_unit_status, WorkUnitStatus.PANELS)
            self.assertEqual(record.trigger, TRIGGER_ROUTING_CHANGE)
            self.assertEqual(record.reason, "Cambio de configuración: tareas")
            self.assertEqual(db.get(PanelUnit, 1).current_station_id, 2)
        finally:
            db.close()
            for name, fn in (
                ("before_flush", "_note_routing_flush"),
                ("do_orm_execute", "_note_routing_statement"),
                ("before_commit", "_release_before_commit"),
                ("after_rollback", "_forget_routing_change"),
            ):
                event.remove(self.session_factory, name, getattr(panel_routing, fn))

    def _complete_by_mistake(self) -> PanelAutoRelease:
        """Panel at the last station; its task gets unticked, so the module goes to Magazine."""
        self._place(3, PanelUnitStatus.IN_PROGRESS)
        self.tasks[2].active = False
        self.db.flush()
        (item,) = release_stalled_panels(self.db, reason="Cambio de configuración: tareas")
        self.db.commit()
        return item.record

    def test_release_to_completed_records_module_status_change(self) -> None:
        record = self._complete_by_mistake()

        self.assertIsNone(record.to_station_id)
        self.assertEqual(record.new_panel_status, PanelUnitStatus.COMPLETED)
        self.assertEqual(record.previous_work_unit_status, WorkUnitStatus.PANELS)
        self.assertEqual(record.new_work_unit_status, WorkUnitStatus.MAGAZINE)

    def test_undo_restores_panel_and_module(self) -> None:
        record = self._complete_by_mistake()
        self.tasks[2].active = True

        undo_auto_release(self.db, record, admin_user_id=None)
        self.db.commit()

        self.assertEqual(self.panel.status, PanelUnitStatus.IN_PROGRESS)
        self.assertEqual(self.panel.current_station_id, 3)
        self.assertEqual(self.work_unit.status, WorkUnitStatus.PANELS)
        self.assertIsNotNone(record.undone_at)
        self.assertEqual(auto_release_undo_blocker(self.db, record), "Esta liberación ya fue deshecha.")

    def test_undo_is_blocked_once_the_module_moved_on(self) -> None:
        record = self._complete_by_mistake()
        self.work_unit.status = WorkUnitStatus.ASSEMBLY
        self.db.flush()

        with self.assertRaises(AutoReleaseUndoError):
            undo_auto_release(self.db, record, admin_user_id=None)
        self.assertEqual(self.panel.status, PanelUnitStatus.COMPLETED)

    def test_undo_is_blocked_by_work_after_release(self) -> None:
        self._place(2, PanelUnitStatus.IN_PROGRESS)
        self.tasks[1].active = False
        self.db.flush()
        (item,) = release_stalled_panels(self.db)
        self._instance(3, 3, TaskStatus.IN_PROGRESS, started_at=utc_now() + timedelta(seconds=5))

        self.assertEqual(
            auto_release_undo_blocker(self.db, item.record),
            "Se registró trabajo en el panel después de la liberación.",
        )

    def test_undo_api_lists_and_restores(self) -> None:
        self._place(2, PanelUnitStatus.IN_PROGRESS)
        self.tasks[1].active = False
        self.db.flush()
        (item,) = release_stalled_panels(self.db)
        self.db.commit()
        admin = SimpleNamespace(id=None, role="Admin")

        (listed,) = production_queue.list_auto_releases(days=14, limit=100, db=self.db, _admin=admin)
        self.assertTrue(listed.can_undo)
        self.assertEqual(listed.panel_code, "P1")
        self.assertEqual(listed.from_station_name, "S2")
        self.assertEqual(listed.to_station_name, "S3")

        undone = production_queue.undo_panel_auto_release(item.record.id, db=self.db, admin=admin)
        self.assertFalse(undone.can_undo)
        self.assertIsNotNone(undone.undone_at)
        self.assertEqual(self.db.get(PanelUnit, 1).current_station_id, 2)

        with self.assertRaises(HTTPException) as ctx:
            production_queue.undo_panel_auto_release(item.record.id, db=self.db, admin=admin)
        self.assertEqual(ctx.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
