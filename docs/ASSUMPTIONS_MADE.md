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
- Legacy sqlite import assumes `TaskDefinitions.house_type_id` and `station_id` are not scoping rules; tasks are imported with a single global `TaskApplicability` row using `station_sequence_order`.
- Legacy panel `task_length` lists are padded or trimmed to match `applicable_tasks` lengths when importing to `panel_definitions.task_durations_json`.
- Pause/note definitions import uses the legacy `stations` CSV (ignoring `station_id`) and maps station codes via the existing W1/A0 mapping to new station IDs.

## 2026-01-05
- Production queue scheduling stores `planned_sequence`, `planned_start_datetime`, and `planned_assembly_line` on `work_units` to order modules directly; `work_orders.planned_sequence` is treated as the first module’s sequence for that house.
- Batch house identifiers are generated from `house_identifier_base` by incrementing any trailing digits (preserving padding); if none exist, the system appends a `-01` style suffix.
- Assembly line changes are stored per module (WorkUnit), so different modules in the same house can target different lines; line values are stored as "1", "2", or "3".

## 2026-01-06
- Added worker auth/session APIs (`/api/worker-sessions/*`) with server-stored sessions and an HTTP-only `worker_session` cookie; login uses `worker_id` + PIN because docs did not define worker auth endpoints.
- Station workspace data comes from `/api/worker-stations/{station_id}/snapshot`, which partially approximates queue computation (adds W1 planned panels) but still skips behaviors like magazine pull eligibility and aux dual-mode pairing.
- AUX stations surface `TaskScope.AUX` tasks when present; if none exist they fall back to module-scope tasks, and tasks with null `station_sequence_order` are treated as station tasks for AUX stations.
- Worker inactivity logout uses the documented 45-second idle timeout for all worker sessions because no login-permanence flag exists in the data model yet.
- Login schedule preview uses `/api/production-queue` as the nearest available backend view until station-specific schedule endpoints are implemented.
- Skip-reason suggestions reuse pause reasons because no dedicated skip reason configuration exists yet.
- W1 panel recommendations include both generic (sub_type_id NULL) and subtype-specific panel definitions for the module sequence.

## 2026-01-07
- QR login MVP uses the browser `BarcodeDetector` API with `getUserMedia` and a center ROI crop; decoded values are shown in the login UI and only matched to workers when the payload equals a worker ID, with no backend session wiring yet.
