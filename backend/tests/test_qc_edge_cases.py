from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import HTTPException  # noqa: E402

import app.api.routes.qc_complaints as qc_complaints_routes  # noqa: E402
import app.api.routes.qc_runtime as qc_runtime_routes  # noqa: E402
import app.api.routes.worker_tasks as worker_tasks_routes  # noqa: E402
from app.api.routes.qc_config import update_trigger  # noqa: E402
from app.models.enums import (  # noqa: E402
    PanelUnitStatus,
    QCCheckKind,
    QCComplaintEventType,
    QCComplaintStatus,
    QCNotificationStatus,
    QCReworkStatus,
    QCTriggerEventType,
    StationRole,
    TaskStatus,
    WorkUnitStatus,
)
from app.models.qc import QCCheckDefinition, QCTrigger  # noqa: E402
from app.schemas.qc import (  # noqa: E402
    QCComplaintForceClose,
    QCComplaintSupervisorsUpdate,
    QCTriggerRead,
    QCTriggerUpdate,
    QCWorkUnitCompletionRequest,
)
from app.services.qc_runtime import (  # noqa: E402
    cancel_rework,
    effective_sampling_rate,
    panel_is_off_panel_line,
    plan_qc_applicability_prune,
    should_reset_current_sampling,
    summarize_trigger_task_warnings,
)


class Rows:
    def __init__(self, rows=None, one=None):
        self.rows = list(rows or [])
        self.one = one

    def scalars(self) -> "Rows":
        return self

    def all(self):
        return self.rows

    def first(self):
        return self.rows[0] if self.rows else None

    def scalar_one_or_none(self):
        return self.one

    def __iter__(self):
        return iter(self.rows)


def _trigger(**overrides) -> SimpleNamespace:
    values = dict(
        id=1,
        check_definition_id=5,
        event_type=QCTriggerEventType.TASK_COMPLETED,
        params_json={"task_definition_ids": [10]},
        sampling_rate=0.25,
        sampling_autotune=True,
        sampling_step=0.2,
        current_sampling_rate=1.0,
    )
    values.update(overrides)
    return SimpleNamespace(**values)


class SamplingRateTests(unittest.TestCase):
    def test_adaptive_rate_used_only_with_autotune(self) -> None:
        self.assertEqual(effective_sampling_rate(_trigger()), 1.0)
        self.assertEqual(effective_sampling_rate(_trigger(sampling_autotune=False)), 0.25)
        self.assertEqual(effective_sampling_rate(_trigger(current_sampling_rate=None)), 0.25)

    def test_reset_when_base_rate_or_autotune_changes(self) -> None:
        trigger = _trigger()
        self.assertTrue(should_reset_current_sampling(trigger, {"sampling_rate": 0.5}))
        self.assertTrue(should_reset_current_sampling(trigger, {"sampling_autotune": False}))
        self.assertTrue(
            should_reset_current_sampling(trigger, {"reset_current_sampling_rate": True})
        )
        self.assertFalse(
            should_reset_current_sampling(
                trigger, {"sampling_rate": 0.25, "sampling_autotune": True, "sampling_step": 0.1}
            )
        )

    def test_read_schema_exposes_effective_rate(self) -> None:
        read = QCTriggerRead.model_validate(_trigger(sampling_autotune=False))
        self.assertEqual(read.effective_sampling_rate, 0.25)
        self.assertEqual(QCTriggerRead.model_validate(_trigger()).effective_sampling_rate, 1.0)

    def _run_update(self, trigger: SimpleNamespace, payload: QCTriggerUpdate) -> None:
        check = SimpleNamespace(id=5, kind=QCCheckKind.TRIGGERED)
        db = mock.MagicMock()
        db.get.side_effect = lambda model, row_id: {
            QCTrigger: trigger,
            QCCheckDefinition: check,
        }.get(model)
        db.execute.return_value = Rows([10])
        update_trigger(trigger.id, payload, db)

    def test_update_trigger_clears_stale_rate(self) -> None:
        trigger = _trigger()
        self._run_update(trigger, QCTriggerUpdate(sampling_rate=0.4))
        self.assertIsNone(trigger.current_sampling_rate)
        self.assertEqual(trigger.sampling_rate, 0.4)

    def test_update_trigger_keeps_rate_on_unrelated_edit(self) -> None:
        trigger = _trigger()
        self._run_update(trigger, QCTriggerUpdate(sampling_step=0.1, sampling_rate=0.25))
        self.assertEqual(trigger.current_sampling_rate, 1.0)

    def test_update_trigger_explicit_reset(self) -> None:
        trigger = _trigger()
        self._run_update(trigger, QCTriggerUpdate(reset_current_sampling_rate=True))
        self.assertIsNone(trigger.current_sampling_rate)
        self.assertFalse(hasattr(trigger, "reset_current_sampling_rate"))


class PanelOffLineTests(unittest.TestCase):
    def test_completed_or_moved_panel_is_off_line(self) -> None:
        panels_station = SimpleNamespace(role=StationRole.PANELS)
        magazine = SimpleNamespace(role=StationRole.MAGAZINE)
        completed = SimpleNamespace(status=PanelUnitStatus.COMPLETED, current_station_id=None)
        in_line = SimpleNamespace(status=PanelUnitStatus.IN_PROGRESS, current_station_id=3)
        self.assertTrue(panel_is_off_panel_line(completed, None))
        self.assertFalse(panel_is_off_panel_line(in_line, panels_station))
        self.assertTrue(panel_is_off_panel_line(in_line, magazine))
        self.assertFalse(panel_is_off_panel_line(None, None))


class TriggerWarningTests(unittest.TestCase):
    def test_flags_archived_inactive_and_missing_tasks(self) -> None:
        checks = [
            SimpleNamespace(id=1, name="Escuadra"),
            SimpleNamespace(id=2, name="Clavado"),
            SimpleNamespace(id=3, name="Sano"),
        ]
        triggers = [
            SimpleNamespace(check_definition_id=1, params_json={"task_definition_ids": [10]}),
            SimpleNamespace(check_definition_id=2, params_json={"task_definition_ids": [11, 12, 99]}),
            SimpleNamespace(check_definition_id=3, params_json={"task_definition_ids": [12]}),
        ]
        tasks = {
            10: SimpleNamespace(name="Armado", active=True, archived_at=datetime(2026, 1, 1)),
            11: SimpleNamespace(name="Clavado", active=False, archived_at=None),
            12: SimpleNamespace(name="Corte", active=True, archived_at=None),
        }
        warnings = summarize_trigger_task_warnings(checks, triggers, tasks)
        by_check = {item["check_definition_id"]: item for item in warnings}
        self.assertEqual(set(by_check), {1, 2})
        self.assertTrue(by_check[1]["blocked"])
        self.assertEqual(by_check[1]["tasks"][0]["reason"], "archived")
        self.assertFalse(by_check[2]["blocked"])
        self.assertEqual(
            sorted(task["reason"] for task in by_check[2]["tasks"]), ["inactive", "missing"]
        )
        # Blocked checks are listed first.
        self.assertEqual(warnings[0]["check_definition_id"], 1)


def _rule(rule_id, check_id, house_ids=(), sub_ids=()):
    return SimpleNamespace(
        id=rule_id,
        check_definition_id=check_id,
        house_type_links=[
            SimpleNamespace(id=rule_id * 100 + index, house_type_id=house_id)
            for index, house_id in enumerate(house_ids)
        ],
        sub_type_links=[
            SimpleNamespace(id=rule_id * 1000 + index, sub_type_id=sub_id)
            for index, sub_id in enumerate(sub_ids)
        ],
    )


class ApplicabilityPruneTests(unittest.TestCase):
    def test_removes_only_deleted_subtype_when_others_remain(self) -> None:
        rule = _rule(1, 7, sub_ids=[3, 4])
        plan = plan_qc_applicability_prune([rule], {7: 1}, {7}, [], [3])
        self.assertEqual(plan.sub_type_link_ids, [1000])
        self.assertEqual(plan.rule_ids_to_delete, [])
        self.assertEqual(plan.check_ids_to_deactivate, [])

    def test_last_subtype_deactivates_check_instead_of_widening(self) -> None:
        rule = _rule(1, 7, house_ids=[2], sub_ids=[3])
        plan = plan_qc_applicability_prune([rule], {7: 1}, {7}, [], [3])
        self.assertEqual(plan.rule_ids_to_delete, [1])
        self.assertEqual(plan.check_ids_to_deactivate, [7])

    def test_other_rules_keep_check_active(self) -> None:
        rule = _rule(1, 7, house_ids=[2])
        plan = plan_qc_applicability_prune([rule], {7: 2}, {7}, [2], [])
        self.assertEqual(plan.rule_ids_to_delete, [1])
        self.assertEqual(plan.check_ids_to_deactivate, [])

    def test_house_type_delete_drops_its_subtypes_too(self) -> None:
        # Rule for houses [2, 5] limited to subtype 3 (of house 2): deleting house 2
        # removes subtype 3 as well, so the rule would otherwise widen.
        rule = _rule(1, 7, house_ids=[2, 5], sub_ids=[3])
        plan = plan_qc_applicability_prune([rule], {7: 1}, {7}, [2], [3])
        self.assertEqual(plan.rule_ids_to_delete, [1])
        self.assertEqual(plan.check_ids_to_deactivate, [7])

    def test_house_type_removed_from_multi_house_rule(self) -> None:
        rule = _rule(1, 7, house_ids=[2, 5])
        plan = plan_qc_applicability_prune([rule], {7: 1}, {7}, [2], [])
        self.assertEqual(plan.house_type_link_ids, [100])
        self.assertEqual(plan.check_ids_to_deactivate, [])

    def test_inactive_check_not_reported(self) -> None:
        rule = _rule(1, 7, sub_ids=[3])
        plan = plan_qc_applicability_prune([rule], {7: 1}, set(), [], [3])
        self.assertEqual(plan.rule_ids_to_delete, [1])
        self.assertEqual(plan.check_ids_to_deactivate, [])


class CancelReworkTests(unittest.TestCase):
    def test_cancel_closes_running_task_and_notifications(self) -> None:
        rework = SimpleNamespace(id=4, status=QCReworkStatus.IN_PROGRESS)
        instance = SimpleNamespace(id=9, status=TaskStatus.PAUSED, completed_at=None, notes=None)
        participation = SimpleNamespace(left_at=None)
        pause = SimpleNamespace(resumed_at=None)
        notification = SimpleNamespace(status=QCNotificationStatus.ACTIVE, seen_at=None)
        db = mock.MagicMock()
        db.execute.side_effect = [
            Rows([instance]),
            Rows([participation]),
            Rows([pause]),
            Rows([notification]),
        ]
        now = datetime(2026, 11, 5, 12, 0)
        self.assertTrue(cancel_rework(db, rework, now, "cancelado"))
        self.assertEqual(rework.status, QCReworkStatus.CANCELED)
        self.assertEqual(instance.status, TaskStatus.SKIPPED)
        self.assertEqual(instance.completed_at, now)
        self.assertEqual(participation.left_at, now)
        self.assertEqual(pause.resumed_at, now)
        self.assertEqual(notification.status, QCNotificationStatus.DISMISSED)

    def test_finished_rework_is_left_alone(self) -> None:
        rework = SimpleNamespace(id=4, status=QCReworkStatus.DONE)
        db = mock.MagicMock()
        self.assertFalse(cancel_rework(db, rework, datetime(2026, 11, 5), None))
        db.execute.assert_not_called()


class MarkModuleCompletedTests(unittest.TestCase):
    def setUp(self) -> None:
        self.work_unit = SimpleNamespace(
            id=7, status=WorkUnitStatus.ASSEMBLY, completed_at=None, current_station_id=3
        )
        self.db = mock.MagicMock()

        def execute(statement):
            sql = str(statement)
            if "FROM work_units" in sql:
                return Rows(one=self.work_unit)
            return Rows([])

        self.db.execute.side_effect = execute
        self.admin = SimpleNamespace(id=1, role="QC")
        patches = [
            mock.patch.object(
                qc_runtime_routes,
                "open_qc_items_for_work_unit",
                return_value=([object(), object()], [object()]),
            ),
            mock.patch.object(qc_runtime_routes, "_open_module_task_count", return_value=1),
            mock.patch.object(
                qc_runtime_routes,
                "resolve_open_qc_items_for_completion",
                return_value=(2, 1),
            ),
            mock.patch.object(
                qc_runtime_routes,
                "close_open_instances_for_work_unit",
                return_value=[object()],
            ),
            mock.patch.object(qc_runtime_routes, "lock_qc_checks_for_work_unit"),
        ]
        self.mocks = [patcher.start() for patcher in patches]
        for patcher in patches:
            self.addCleanup(patcher.stop)

    def test_refuses_to_orphan_open_items(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            qc_runtime_routes.mark_work_unit_completed(7, None, self.admin, self.db)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail["open_checks"], 2)
        self.assertEqual(ctx.exception.detail["open_reworks"], 1)
        self.assertEqual(self.work_unit.status, WorkUnitStatus.ASSEMBLY)
        self.db.commit.assert_not_called()

    def test_resolves_items_and_closes_module_tasks(self) -> None:
        result = qc_runtime_routes.mark_work_unit_completed(
            7, QCWorkUnitCompletionRequest(resolve_open_items=True), self.admin, self.db
        )
        self.assertEqual(self.work_unit.status, WorkUnitStatus.COMPLETED)
        self.assertIsNone(self.work_unit.current_station_id)
        self.assertEqual(result.closed_checks, 2)
        self.assertEqual(result.canceled_reworks, 1)
        self.assertEqual(result.closed_tasks, 1)
        self.mocks[2].assert_called_once()
        self.mocks[3].assert_called_once()
        self.db.commit.assert_called_once()


class ComplaintSupervisorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.complaint = SimpleNamespace(
            id=3,
            status=QCComplaintStatus.OPEN,
            supervisors=[],
            closed_at=None,
            updated_at=None,
        )
        self.admin = SimpleNamespace(id=1, role="QC")
        patcher = mock.patch.object(
            qc_complaints_routes, "get_complaint", return_value="detail"
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_force_close_keeps_history(self) -> None:
        db = mock.MagicMock()
        db.execute.return_value = Rows(one=self.complaint)
        result = qc_complaints_routes.force_close_complaint(
            3, QCComplaintForceClose(message="Supervisor ya no esta"), db, self.admin
        )
        self.assertEqual(result, "detail")
        self.assertEqual(self.complaint.status, QCComplaintStatus.CLOSED)
        event = db.add.call_args_list[0].args[0]
        self.assertEqual(event.event_type, QCComplaintEventType.FORCE_CLOSED)
        self.assertIn("Supervisor ya no esta", event.message)
        db.delete.assert_not_called()

    def test_force_close_requires_reason(self) -> None:
        db = mock.MagicMock()
        with self.assertRaises(HTTPException) as ctx:
            qc_complaints_routes.force_close_complaint(
                3, QCComplaintForceClose(message="  "), db, self.admin
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_reassign_supervisors_of_orphaned_complaint(self) -> None:
        new_supervisor = SimpleNamespace(id=8, first_name="Ana", last_name="Rojas")
        db = mock.MagicMock()

        def execute(statement):
            sql = str(statement)
            if "FROM qc_quality_complaints" in sql:
                return Rows(one=self.complaint)
            return Rows([])

        db.execute.side_effect = execute
        with mock.patch.object(
            qc_complaints_routes, "_load_supervisors", return_value=[new_supervisor]
        ):
            qc_complaints_routes.update_complaint_supervisors(
                3, QCComplaintSupervisorsUpdate(supervisor_ids=[8]), db, self.admin
            )
        self.assertEqual([link.supervisor_id for link in self.complaint.supervisors], [8])
        added = [call.args[0] for call in db.add.call_args_list]
        event = next(item for item in added if hasattr(item, "event_type"))
        self.assertEqual(event.event_type, QCComplaintEventType.COMMENT)
        self.assertIn("sin supervisor", event.message)
        notifications = [item for item in added if hasattr(item, "supervisor_id")]
        self.assertEqual([item.supervisor_id for item in notifications], [8])


class ReworkPauseTests(unittest.TestCase):
    def _db(self, instance, pauses):
        participation = SimpleNamespace(left_at=None)
        db = mock.MagicMock()

        def execute(statement):
            sql = str(statement)
            if "FROM task_pauses" in sql:
                open_pauses = [pause for pause in pauses if pause.resumed_at is None]
                return Rows(open_pauses)
            if "FROM task_participations" in sql and "JOIN task_instances" in sql:
                return Rows([])  # enforce_no_active_tasks: no other active task
            if "FROM task_participations" in sql:
                return Rows([participation])
            if "SELECT task_instances.status" in sql:
                return Rows([instance.status])  # row lock in pause_instance
            if "FROM task_instances" in sql:
                return Rows([instance])
            return Rows([])

        db.execute.side_effect = execute
        return db

    def test_pause_on_paused_rework_does_not_stack(self) -> None:
        instance = SimpleNamespace(id=9, status=TaskStatus.PAUSED)
        open_pause = SimpleNamespace(resumed_at=None)
        db = self._db(instance, [open_pause])
        qc_runtime_routes.pause_rework_task(
            4,
            qc_runtime_routes.QCReworkPauseRequest(reason_id=None, reason_text="otra"),
            SimpleNamespace(id=2),
            db,
        )
        db.add.assert_not_called()
        db.commit.assert_not_called()
        self.assertEqual(instance.status, TaskStatus.PAUSED)

    def test_pause_in_progress_rework_adds_one_pause(self) -> None:
        instance = SimpleNamespace(id=9, status=TaskStatus.IN_PROGRESS)
        db = self._db(instance, [])
        qc_runtime_routes.pause_rework_task(
            4,
            qc_runtime_routes.QCReworkPauseRequest(reason_id=None, reason_text="almuerzo"),
            SimpleNamespace(id=2),
            db,
        )
        self.assertEqual(instance.status, TaskStatus.PAUSED)
        self.assertEqual(db.add.call_count, 1)

    def test_resume_closes_every_open_pause(self) -> None:
        instance = SimpleNamespace(id=9, status=TaskStatus.PAUSED)
        pauses = [SimpleNamespace(resumed_at=None), SimpleNamespace(resumed_at=None)]
        db = self._db(instance, pauses)
        qc_runtime_routes.resume_rework_task(4, SimpleNamespace(id=2), db)
        self.assertEqual(instance.status, TaskStatus.IN_PROGRESS)
        self.assertTrue(all(pause.resumed_at is not None for pause in pauses))
        db.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
