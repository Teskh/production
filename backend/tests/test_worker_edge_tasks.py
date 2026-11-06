from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import HTTPException
from sqlalchemy import JSON, MetaData, create_engine, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

import app.models  # noqa: F401  (register every table)
from app.api.routes import worker_station, worker_tasks, workers
from app.db.base import Base
from app.models.enums import (
    PanelUnitStatus,
    QCCheckOrigin,
    QCCheckStatus,
    QCReworkStatus,
    StationRole,
    TaskExceptionType,
    TaskScope,
    TaskStatus,
    WorkUnitStatus,
)
from app.models.house import HouseType, PanelDefinition
from app.models.qc import QCCheckInstance, QCReworkTask
from app.models.stations import Station
from app.models.tasks import (
    TaskApplicability,
    TaskDefinition,
    TaskException,
    TaskInstance,
    TaskParticipation,
    TaskPause,
)
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.models.workers import Worker
from app.schemas.worker_station import (
    TaskCompleteRequest,
    TaskLeaveRequest,
    TaskPauseRequest,
    TaskResumeRequest,
    TaskSkipRequest,
    TaskStartRequest,
)
from app.schemas.workers import WorkerUpdate
from app.services.conditions import ConditionContext
from app.services.task_dependencies import DependencyRules, ResolvedTasks
from app.services.task_participation import AUTO_PAUSE_NO_PARTICIPANTS

NOW = datetime(2026, 11, 5, 8, 0, 0)


def _task(task_id: int, *, scope: TaskScope = TaskScope.PANEL, deps=None, **extra) -> SimpleNamespace:
    values = dict(
        id=task_id,
        name=f"T{task_id}",
        scope=scope,
        active=True,
        archived_at=None,
        default_station_sequence=1,
        dependencies_json=deps,
    )
    values.update(extra)
    return SimpleNamespace(**values)


class DependencyRulesTests(unittest.TestCase):
    """Pure evaluation of when a prerequisite stops blocking a dependent task."""

    def _missing(self, dependent, prerequisites, resolved=ResolvedTasks(), rows=None, **kw):
        rules = DependencyRules(
            definitions={task.id: task for task in prerequisites},
            applicability_map=rows or {},
            condition_ctx=ConditionContext({}, {}),
        )
        params = dict(
            work_unit_id=1,
            house_type_id=1,
            sub_type_id=None,
            module_number=1,
            panel_definition_id=7,
        )
        params.update(kw)
        return rules.missing_dependency_ids(dependent, resolved, **params)

    def test_pending_prerequisite_blocks(self) -> None:
        self.assertEqual(self._missing(_task(2, deps=[1]), [_task(1)]), [1])

    def test_completed_or_skipped_prerequisite_is_satisfied(self) -> None:
        resolved = ResolvedTasks(panel_ids=frozenset({1}))
        self.assertEqual(self._missing(_task(2, deps=[1]), [_task(1)], resolved), [])

    def test_archived_inactive_or_deleted_prerequisite_is_satisfied(self) -> None:
        prerequisites = [_task(1, archived_at=NOW), _task(3, active=False)]
        self.assertEqual(self._missing(_task(2, deps=[1, 3, 99]), prerequisites), [])

    def test_prerequisite_not_applicable_to_panel_is_satisfied(self) -> None:
        row = SimpleNamespace(
            id=1, task_definition_id=1, panel_definition_id=7, house_type_id=None,
            sub_type_id=None, module_number=None, applies=False, station_sequence_order=None,
        )
        self.assertEqual(self._missing(_task(2, deps=[1]), [_task(1)], rows={1: [row]}), [])

    def test_panel_task_list_does_not_waive_an_applicable_prerequisite(self) -> None:
        # The panel's task list is ordering metadata and can drift from the
        # applicability rules; only the rules decide whether a prerequisite applies.
        self.assertEqual(
            self._missing(_task(2, deps=[1]), [_task(1)], panel_task_ids=[2]), [1]
        )

    def test_archived_prerequisite_with_open_instance_still_blocks(self) -> None:
        prerequisites = [_task(1, archived_at=NOW), _task(3, active=False)]
        resolved = ResolvedTasks(open_panel_ids=frozenset({1, 3}))
        self.assertEqual(
            self._missing(_task(2, deps=[1, 3]), prerequisites, resolved), [1, 3]
        )

    def test_archived_prerequisite_open_again_blocks_despite_history(self) -> None:
        resolved = ResolvedTasks(panel_ids=frozenset({1}), open_panel_ids=frozenset({1}))
        self.assertEqual(
            self._missing(_task(2, deps=[1]), [_task(1, archived_at=NOW)], resolved), [1]
        )

    def test_archived_prerequisite_already_done_is_satisfied(self) -> None:
        resolved = ResolvedTasks(panel_ids=frozenset({1}), open_panel_ids=frozenset())
        self.assertEqual(
            self._missing(_task(2, deps=[1]), [_task(1, archived_at=NOW)], resolved), []
        )

    def test_module_prerequisite_uses_module_level_resolution(self) -> None:
        prerequisite = _task(1, scope=TaskScope.MODULE)
        dependent = _task(2, scope=TaskScope.MODULE, deps=[1])
        self.assertEqual(
            self._missing(dependent, [prerequisite], panel_definition_id=None), [1]
        )
        resolved = ResolvedTasks(module_ids=frozenset({1}))
        self.assertEqual(
            self._missing(dependent, [prerequisite], resolved, panel_definition_id=None), []
        )

    def test_malformed_dependencies_block(self) -> None:
        self.assertIsNone(self._missing(_task(2, deps={"a": 1}), []))


class WorkerTaskDbTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        metadata = MetaData()
        for table in Base.metadata.tables.values():
            table.to_metadata(metadata)
        for table in metadata.tables.values():
            for column in table.columns:
                if isinstance(column.type, JSONB):
                    column.type = JSON()
        metadata.create_all(self.engine)
        self.db = Session(self.engine)
        db = self.db
        db.add(HouseType(id=1, name="HT", number_of_modules=1))
        db.add(WorkOrder(id=1, project_name="P", house_identifier="H1", house_type_id=1))
        db.add(
            WorkUnit(
                id=1, work_order_id=1, module_number=1, planned_sequence=1,
                status=WorkUnitStatus.PANELS,
            )
        )
        db.add(
            PanelDefinition(
                id=7, house_type_id=1, module_sequence_number=1, group="G", panel_code="P7"
            )
        )
        db.add(Station(id=1, name="W1", role=StationRole.PANELS, sequence_order=1))
        db.add(Station(id=2, name="W2", role=StationRole.PANELS, sequence_order=2))
        db.add(Station(id=10, name="Magazine", role=StationRole.MAGAZINE, sequence_order=None))
        for worker_id in (1, 2):
            db.add(
                Worker(
                    id=worker_id, first_name=f"W{worker_id}", last_name="X",
                    login_required=False, active=True,
                )
            )
        db.add(_task_def(1, station_sequence=1))
        db.add(_task_def(2, station_sequence=1, dependencies_json=[1]))
        db.add(_task_def(3, station_sequence=2, skippable=True))
        db.commit()
        self.worker = db.get(Worker, 1)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def add_panel(self, status=PanelUnitStatus.IN_PROGRESS, station_id=1, panel_id=None) -> PanelUnit:
        panel = PanelUnit(
            id=panel_id, work_unit_id=1, panel_definition_id=7, status=status,
            current_station_id=station_id,
        )
        self.db.add(panel)
        self.db.commit()
        return panel

    def add_instance(self, task_id: int, panel_id: int | None, *, station_id=1,
                     status=TaskStatus.IN_PROGRESS, worker_ids=(1,), rework_task_id=None) -> TaskInstance:
        instance = TaskInstance(
            task_definition_id=task_id, scope=TaskScope.PANEL, work_unit_id=1,
            panel_unit_id=panel_id, station_id=station_id, status=status, started_at=NOW,
            rework_task_id=rework_task_id,
        )
        self.db.add(instance)
        self.db.flush()
        for worker_id in worker_ids:
            self.db.add(
                TaskParticipation(task_instance_id=instance.id, worker_id=worker_id, joined_at=NOW)
            )
        self.db.commit()
        return instance

    def open_pauses(self, instance_id: int) -> list[TaskPause]:
        return list(
            self.db.scalars(
                select(TaskPause)
                .where(TaskPause.task_instance_id == instance_id)
                .where(TaskPause.resumed_at.is_(None))
            )
        )

    def open_participations(self, instance_id: int) -> list[TaskParticipation]:
        return list(
            self.db.scalars(
                select(TaskParticipation)
                .where(TaskParticipation.task_instance_id == instance_id)
                .where(TaskParticipation.left_at.is_(None))
            )
        )

    def start(self, task_id: int, *, panel_unit_id=None, station_id=1, worker=None) -> TaskInstance:
        return worker_tasks.start_task(
            TaskStartRequest(
                task_definition_id=task_id, scope=TaskScope.PANEL, work_unit_id=1,
                panel_unit_id=panel_unit_id, panel_definition_id=7, station_id=station_id,
            ),
            db=self.db,
            worker=worker or self.worker,
        )


def _task_def(task_id: int, *, station_sequence: int, **extra) -> TaskDefinition:
    values = dict(
        id=task_id, name=f"Tarea {task_id}", scope=TaskScope.PANEL,
        default_station_sequence=station_sequence, active=True, skippable=False,
        concurrent_allowed=False, advance_trigger=False, is_rework=False,
    )
    values.update(extra)
    return TaskDefinition(**values)


class StartTaskEdgeTests(WorkerTaskDbTestCase):
    def test_stale_tablet_reuses_existing_panel_unit(self) -> None:
        panel = self.add_panel()
        instance = self.start(1)
        self.assertEqual(instance.panel_unit_id, panel.id)
        self.assertEqual(len(list(self.db.scalars(select(PanelUnit)))), 1)

    def test_stale_tablet_cannot_restart_finished_panel(self) -> None:
        self.add_panel(status=PanelUnitStatus.COMPLETED, station_id=None)
        with self.assertRaises(HTTPException) as ctx:
            self.start(1)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(len(list(self.db.scalars(select(PanelUnit)))), 1)

    def test_start_joins_existing_open_instance_even_with_duplicates(self) -> None:
        panel = self.add_panel()
        first = self.add_instance(1, panel.id)
        self.add_instance(1, panel.id, worker_ids=())
        joined = self.start(1, panel_unit_id=panel.id, worker=self.db.get(Worker, 2))
        self.assertEqual(joined.id, first.id)

    def test_skipped_prerequisite_does_not_deadlock_dependent(self) -> None:
        panel = self.add_panel()
        with self.assertRaises(HTTPException):
            self.start(2, panel_unit_id=panel.id)
        self.db.rollback()
        self.db.add(
            TaskException(
                task_definition_id=1, scope=TaskScope.PANEL, work_unit_id=1,
                panel_unit_id=panel.id, station_id=1, exception_type=TaskExceptionType.SKIP,
                created_by_worker_id=1, created_at=NOW,
            )
        )
        self.db.commit()
        instance = self.start(2, panel_unit_id=panel.id)
        self.assertEqual(instance.status, TaskStatus.IN_PROGRESS)

    def test_archived_prerequisite_does_not_deadlock_dependent(self) -> None:
        panel = self.add_panel()
        self.db.get(TaskDefinition, 1).archived_at = NOW
        self.db.commit()
        instance = self.start(2, panel_unit_id=panel.id)
        self.assertEqual(instance.task_definition_id, 2)

    def test_not_applicable_prerequisite_does_not_deadlock_dependent(self) -> None:
        panel = self.add_panel()
        self.db.add(
            TaskApplicability(task_definition_id=1, panel_definition_id=7, applies=False)
        )
        self.db.commit()
        instance = self.start(2, panel_unit_id=panel.id)
        self.assertEqual(instance.task_definition_id, 2)


class ReworkInstanceGuardTests(WorkerTaskDbTestCase):
    def test_generic_routes_reject_rework_instances(self) -> None:
        panel = self.add_panel()
        instance = self.add_instance(1, panel.id, rework_task_id=5)
        session = SimpleNamespace(station_id=1)
        calls = [
            lambda: worker_tasks.complete_task(
                TaskCompleteRequest(task_instance_id=instance.id),
                db=self.db, worker=self.worker, session=session,
            ),
            lambda: worker_tasks.pause_task(
                TaskPauseRequest(task_instance_id=instance.id), db=self.db, worker=self.worker
            ),
            lambda: worker_tasks.resume_task(
                TaskResumeRequest(task_instance_id=instance.id), db=self.db, worker=self.worker
            ),
        ]
        for call in calls:
            with self.assertRaises(HTTPException) as ctx:
                call()
            self.assertEqual(ctx.exception.status_code, 409)
        self.db.refresh(instance)
        self.assertEqual(instance.status, TaskStatus.IN_PROGRESS)


class PauseResumeTests(WorkerTaskDbTestCase):
    def test_pausing_twice_keeps_a_single_open_pause(self) -> None:
        panel = self.add_panel()
        instance = self.add_instance(1, panel.id)
        for _ in range(2):
            worker_tasks.pause_task(
                TaskPauseRequest(task_instance_id=instance.id, reason_text="Material"),
                db=self.db, worker=self.worker,
            )
        self.assertEqual(len(self.open_pauses(instance.id)), 1)

    def test_resume_closes_every_open_pause(self) -> None:
        panel = self.add_panel()
        instance = self.add_instance(1, panel.id, status=TaskStatus.PAUSED)
        for offset in (10, 5):
            self.db.add(
                TaskPause(task_instance_id=instance.id, paused_at=NOW + timedelta(minutes=offset))
            )
        self.db.commit()
        worker_tasks.resume_task(
            TaskResumeRequest(task_instance_id=instance.id), db=self.db, worker=self.worker
        )
        self.assertEqual(self.open_pauses(instance.id), [])
        self.assertEqual(instance.status, TaskStatus.IN_PROGRESS)


class SkipTests(WorkerTaskDbTestCase):
    def test_skip_closes_open_instance(self) -> None:
        panel = self.add_panel(station_id=2)
        instance = self.add_instance(3, panel.id, station_id=2, status=TaskStatus.PAUSED)
        self.db.add(TaskPause(task_instance_id=instance.id, paused_at=NOW))
        self.db.commit()
        worker_tasks.skip_task(
            TaskSkipRequest(
                task_definition_id=3, scope=TaskScope.PANEL, work_unit_id=1,
                panel_unit_id=panel.id, station_id=2, reason_text="No aplica",
            ),
            db=self.db,
            worker=self.worker,
        )
        self.db.refresh(instance)
        self.assertEqual(instance.status, TaskStatus.SKIPPED)
        self.assertIsNotNone(instance.completed_at)
        self.assertEqual(self.open_pauses(instance.id), [])
        self.assertEqual(self.open_participations(instance.id), [])


class LeaveTaskTests(WorkerTaskDbTestCase):
    def test_crew_member_leaves_and_last_one_pauses_task(self) -> None:
        panel = self.add_panel()
        instance = self.add_instance(1, panel.id, worker_ids=(1, 2))
        worker_tasks.leave_task_route(
            TaskLeaveRequest(task_instance_id=instance.id), db=self.db, worker=self.worker
        )
        self.assertEqual(instance.status, TaskStatus.IN_PROGRESS)
        self.assertEqual([p.worker_id for p in self.open_participations(instance.id)], [2])

        worker_tasks.leave_task_route(
            TaskLeaveRequest(task_instance_id=instance.id),
            db=self.db,
            worker=self.db.get(Worker, 2),
        )
        self.assertEqual(instance.status, TaskStatus.PAUSED)
        pauses = self.open_pauses(instance.id)
        self.assertEqual(len(pauses), 1)
        self.assertEqual(pauses[0].reason_text, AUTO_PAUSE_NO_PARTICIPANTS)

    def test_non_participant_cannot_leave(self) -> None:
        panel = self.add_panel()
        instance = self.add_instance(1, panel.id, worker_ids=(2,))
        with self.assertRaises(HTTPException) as ctx:
            worker_tasks.leave_task_route(
                TaskLeaveRequest(task_instance_id=instance.id), db=self.db, worker=self.worker
            )
        self.assertEqual(ctx.exception.status_code, 409)

    def test_deactivating_worker_releases_open_tasks(self) -> None:
        panel = self.add_panel()
        solo = self.add_instance(1, panel.id, worker_ids=(1,))
        shared = self.add_instance(3, panel.id, station_id=2, worker_ids=(1, 2))
        admin = SimpleNamespace(id=1)

        listed = workers.list_worker_open_tasks(1, db=self.db, _admin=admin)
        self.assertEqual(
            {(row.task_instance_id, row.other_participant_count) for row in listed},
            {(solo.id, 0), (shared.id, 1)},
        )

        workers.update_worker(1, WorkerUpdate(active=False), db=self.db, _admin=admin)
        self.db.refresh(solo)
        self.db.refresh(shared)
        self.assertEqual(solo.status, TaskStatus.PAUSED)
        self.assertEqual(shared.status, TaskStatus.IN_PROGRESS)
        self.assertEqual(self.open_participations(solo.id), [])
        self.assertEqual([p.worker_id for p in self.open_participations(shared.id)], [2])
        self.assertEqual(workers.list_worker_open_tasks(1, db=self.db, _admin=admin), [])


class FinishedPanelReworkVisibilityTests(WorkerTaskDbTestCase):
    def add_rework(self, panel: PanelUnit) -> QCReworkTask:
        check = QCCheckInstance(
            origin=QCCheckOrigin.MANUAL, scope=TaskScope.PANEL, work_unit_id=1,
            panel_unit_id=panel.id, station_id=2, status=QCCheckStatus.CLOSED, opened_at=NOW,
        )
        self.db.add(check)
        self.db.flush()
        rework = QCReworkTask(
            check_instance_id=check.id, description="Corregir", status=QCReworkStatus.OPEN,
            created_at=NOW,
        )
        self.db.add(rework)
        self.db.commit()
        return rework

    def snapshot(self, station_id: int):
        return worker_station.station_snapshot(
            station_id, planned_limit=None, db=self.db, _worker=self.worker
        )

    def test_finished_panel_rework_shows_at_magazine_with_module(self) -> None:
        panel = self.add_panel(status=PanelUnitStatus.COMPLETED, station_id=None)
        rework = self.add_rework(panel)

        snapshot = self.snapshot(10)

        self.assertEqual([item.id for item in snapshot.work_items], ["module-1"])
        self.assertEqual([task.id for task in snapshot.qc_rework_tasks], [rework.id])
        self.assertTrue(snapshot.qc_rework_tasks[0].panel_left_line)
        self.assertEqual(snapshot.qc_rework_tasks[0].panel_code, "P7")

    def test_finished_panel_rework_shows_at_module_assembly_station(self) -> None:
        self.db.add(Station(id=20, name="A1", role=StationRole.ASSEMBLY, sequence_order=10))
        work_unit = self.db.get(WorkUnit, 1)
        work_unit.status = WorkUnitStatus.ASSEMBLY
        work_unit.current_station_id = 20
        panel = self.add_panel(status=PanelUnitStatus.CONSUMED, station_id=None)
        rework = self.add_rework(panel)

        self.assertEqual([task.id for task in self.snapshot(20).qc_rework_tasks], [rework.id])
        self.assertEqual(self.snapshot(10).qc_rework_tasks, [])

    def test_in_progress_panel_rework_stays_on_panel_station(self) -> None:
        panel = self.add_panel(status=PanelUnitStatus.IN_PROGRESS, station_id=2)
        rework = self.add_rework(panel)

        self.assertEqual([task.id for task in self.snapshot(2).qc_rework_tasks], [rework.id])
        self.assertFalse(self.snapshot(2).qc_rework_tasks[0].panel_left_line)
        self.assertEqual(self.snapshot(10).work_items, [])


if __name__ == "__main__":
    unittest.main()
