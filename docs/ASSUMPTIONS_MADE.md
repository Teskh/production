## 2025-12-29
- Backend uses SQLAlchemy ORM models as the initial schema source, with a simple `Base.metadata.create_all` initializer and `DATABASE_URL` config until migrations are introduced.
- Added an `admin_sessions` table with hashed session tokens for HTTP-only cookie auth (server-side session storage).
- Backup tooling stores `.dump` files plus `backup_settings.json`/`backup_metadata.json` under `backend/backups`, with automation handled either by `app.scripts.backup_runner` or the in-app scheduler.
- Backup restore creates a manual checkpoint backup, restores the selected `.dump` into a new database, then swaps names so the primary database points at the restored data.
- Backup scheduling can run inside the FastAPI process via a startup background task that polls settings and triggers `pg_dump` when due.
- House parameter value editing treats empty module inputs as deletions and saves values scoped to the selected house type plus optional subtype (null subtype means default values).

## 2025-12-31
- Module Rules UI treats expected duration resolution with the same most-specific-wins order as task applicability (module -> house type -> default) when showing baseline values.

## 2026-01-01
- Added REST endpoints `GET/POST/PUT/DELETE /api/pause-reasons` and `/api/comment-templates` to manage PauseReason and CommentTemplate config, since docs did not define specific API paths.
- Added `GET/POST/PUT/DELETE /api/workers/supervisors` and a workers/supervisors roster toggle in the personnel UI to manage the new supervisor table and assignments, since docs did not define the supervisor API/UI behavior.

## 2026-01-05
- Production queue scheduling stores `planned_sequence`, `planned_start_datetime`, and `planned_assembly_line` on `work_units` to order modules directly; `work_orders.planned_sequence` is treated as the first module’s sequence for that house.
- Batch house identifiers are generated from `house_identifier_base` by incrementing any trailing digits (preserving padding); if none exist, the system appends a `-01` style suffix.
- Assembly line changes are treated as per-house (WorkOrder) assignments, so updating line for any module applies to all modules in that house and is blocked when any module is completed; line values are stored as "1", "2", or "3".
