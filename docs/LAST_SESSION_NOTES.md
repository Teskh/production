• Session Report

- Moved default task station assignment to task_definitions.default_station_sequence, added migration backend/alembic/versions/0011_task_default_station_seq.py, and dropped default-scope applicability rows with backend/alembic/versions/0012_drop_default_applicability.py.
- Simplified task definition handling by removing the station-sequence-order endpoint and wiring the default station into the main task definition payload: backend/app/   
api/routes/task_definitions.py, backend/app/schemas/tasks.py, ui/src/pages/admin/config/TaskDefs.tsx.
- Centralized applicability resolution with defaults in backend/app/services/task_applicability.py and reused it in backend/app/api/routes/worker_station.py, backend/app/ 
api/routes/production_queue.py, and backend/app/api/routes/worker_tasks.py.
- Enforced “override only” applicability rows at the API layer: backend/app/api/routes/task_rules.py.
- Updated module task rules UI to show/edit station per module and highlight default vs override, including save/reset/diff logic and grouping: ui/src/pages/admin/config/ 
HouseConfigurator.tsx.
- Made migrations more idempotent to tolerate Base.metadata.create_all in 0001_initial: backend/alembic/versions/0003_task_advance_trigger.py, backend/alembic/versions/0004_task_applicability_applies.py, backend/alembic/versions/0006_panel_sequence_number.py, backend/alembic/versions/0008_production_queue_fields.py, backend/alembic/versions/0009_worker_supervisors.py, backend/alembic/versions/0010_worker_sessions.py, backend/alembic/versions/0011_task_default_station_seq.py.                
- Documented the new applicability default behavior in docs/ASSUMPTIONS_MADE.md.

Import impact (backend/app/scripts/import_legacy_sqlite.py)
The legacy import now writes station defaults directly into TaskDefinition.default_station_sequence and no longer creates default-scope TaskApplicability rows. That means 
“applies” defaults are implicit (true when no scoped row exists), so any legacy data that previously relied on a default applicability row for station assignment now      
expects the task definition’s default to carry that. This is a simplification, but it also means if you later import datasets that assume default applicability rows exist,
they’ll now be ignored/removed and your overrides must be explicit (house/module/panel scoped) to take effect.