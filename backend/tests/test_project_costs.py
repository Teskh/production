import sys
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.api.deps import get_db, get_current_admin
from app.api.routes.project_costs import router, require_cost_dashboard
from app.services.project_costs import (
    house_exit, is_floor, matching_duration, share_worker_seconds,
    subtract_intervals, union_intervals, weekdays,
)


class ProjectCostTests(unittest.TestCase):
    def setUp(self):
        self.start = datetime(2026, 3, 2, 8)

    def at(self, minutes):
        return self.start + timedelta(minutes=minutes)

    def test_concurrent_work_conserves_worker_time_and_ignores_duplicate_joins(self):
        hours = share_worker_seconds([
            (1, self.at(0), self.at(120)),
            (1, self.at(0), self.at(120)),
            (2, self.at(60), self.at(120)),
        ])
        self.assertEqual(hours[1], 90 * 60)
        self.assertEqual(hours[2], 30 * 60)
        self.assertEqual(sum(hours.values()), 120 * 60)

    def test_overlapping_pauses_are_only_removed_once(self):
        result = subtract_intervals([(self.at(0), self.at(120))],
            [(self.at(20), self.at(50)), (self.at(40), self.at(70))])
        self.assertEqual(result, [(self.at(0), self.at(20)), (self.at(70), self.at(120))])

    def test_pauses_outside_task_do_not_add_or_remove_time(self):
        interval = [(self.at(0), self.at(60))]
        self.assertEqual(subtract_intervals(interval, [(self.at(70), self.at(100))]), interval)
        self.assertEqual(subtract_intervals(interval, [(self.at(-10), self.at(100))]), [])

    def test_task_duration_uses_union_of_crew_intervals(self):
        result = union_intervals([(self.at(0), self.at(60)), (self.at(30), self.at(90))])
        self.assertEqual(result, [(self.at(0), self.at(90))])

    def test_no_output_weekdays_still_count(self):
        self.assertEqual(weekdays(date(2026, 3, 2), date(2026, 3, 8)), 5)
        self.assertEqual(weekdays(date(2026, 3, 7), date(2026, 3, 8)), 0)

    def test_house_requires_all_modules_and_uses_last_exit(self):
        modules = [SimpleNamespace(id=1, module_number=1), SimpleNamespace(id=2, module_number=2)]
        self.assertIsNone(house_exit(modules, 2, {1: self.at(0)}))
        self.assertIsNone(house_exit(modules[:1], 2, {1: self.at(0)}))
        self.assertEqual(house_exit(modules, 2, {1: self.at(0), 2: self.at(60)}), self.at(60))
        modules[1].module_number = 1
        self.assertIsNone(house_exit(modules, 2, {1: self.at(0), 2: self.at(60)}))

    def test_floor_area_excludes_walls_and_ceiling(self):
        self.assertTrue(is_floor('Paneles de Piso'))
        self.assertTrue(is_floor('  PANELES DE PÍSO '))
        self.assertFalse(is_floor('Paneles de Cielo'))
        self.assertFalse(is_floor('Multiwalls'))

    def test_duration_respects_subtype_and_panel_priority(self):
        def row(i, house=None, subtype=None, module=None, panel=None):
            return SimpleNamespace(id=i, house_type_id=house, sub_type_id=subtype,
                                   module_number=module, panel_definition_id=panel)
        generic, typed, specific, other, panel = row(1), row(2, 5), row(3, 5, 7, 1), row(4, 5, 9, 1), row(5, panel=10)
        self.assertIs(matching_duration([other, generic, typed, specific], 5, 7, 1, None), specific)
        self.assertIs(matching_duration([generic, specific, panel], 5, 7, 1, 10), panel)
        self.assertIsNone(matching_duration([other], 5, 7, 1, None))


class ProjectCostApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router, prefix='/api/project-costs')
        app.dependency_overrides[get_db] = lambda: None
        self.app = app
        self.client = TestClient(app)

    def test_unauthenticated_request_is_rejected(self):
        self.assertEqual(self.client.get('/api/project-costs').status_code, 401)

    def test_invalid_date_never_runs_analysis(self):
        self.app.dependency_overrides[require_cost_dashboard] = lambda: None
        with patch('app.api.routes.project_costs.build_cost_data') as build:
            self.assertEqual(self.client.get('/api/project-costs?start=garbage').status_code, 422)
            build.assert_not_called()

    def test_invalid_period_is_422(self):
        self.app.dependency_overrides[require_cost_dashboard] = lambda: None
        with patch('app.api.routes.project_costs.build_cost_data', side_effect=ValueError('Invalid range')):
            self.assertEqual(self.client.get('/api/project-costs?start=2026-04-01&end=2026-03-01').status_code, 422)

    def test_dashboard_roles_are_enforced(self):
        class Db:
            def execute(self, _):
                return SimpleNamespace(scalars=lambda: [])
            def scalars(self, _):
                return ['Supervisor']
        self.app.dependency_overrides[get_db] = Db
        self.app.dependency_overrides[get_current_admin] = lambda: SimpleNamespace(role='Admin')
        self.assertEqual(self.client.get('/api/project-costs').status_code, 403)
        self.app.dependency_overrides[get_current_admin] = lambda: SimpleNamespace(role='SysAdmin')
        with patch('app.api.routes.project_costs.build_cost_data', return_value={'roster': 74}):
            self.assertEqual(self.client.get('/api/project-costs').json(), {'roster': 74})


if __name__ == '__main__':
    unittest.main()
