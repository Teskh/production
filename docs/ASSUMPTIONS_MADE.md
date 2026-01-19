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
- Legacy sqlite import assumes `TaskDefinitions.house_type_id` and `station_id` are not scoping rules; tasks store `station_sequence_order` on `TaskDefinition.default_station_sequence`, and no default-scope `TaskApplicability` rows are created.
- Legacy panel `task_length` lists are padded or trimmed to match `applicable_tasks` lengths when importing to `panel_definitions.task_durations_json`.
- Pause/note definitions import uses the legacy `stations` CSV (ignoring `station_id`) and maps station codes via the existing W1/A0 mapping to new station IDs.

## 2026-01-02
- Force-deleting a house type cascades through related production/config data (work orders/units, panel units, task/QC history, applicability/duration rules, parameter values) so the delete can complete without leaving orphaned rows.

## 2026-01-04
- QC configuration is managed via new REST endpoints under `/api/qc/*` (categories, check definitions, triggers, applicability rules, failure modes), with severity levels fixed to Baja/Media/Crítica.

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
- Assistance dashboard uses `GET /api/geovictoria/attendance` to fetch GeoVictoria `AttendanceBook` + `Consolidated` payloads for a worker (using GeoVictoria identifier/RUT for `UserIds`), returning raw payloads and deriving day-level entry/exit/lunch fields client-side via best-effort key matching.

## 2026-01-07
- QR login MVP uses the browser `BarcodeDetector` API with `getUserMedia` and a center ROI crop; decoded values are shown in the login UI and only matched to workers when the payload equals a worker ID, with no backend session wiring yet.
- QC registro photo watermarks use `work_orders.house_identifier` for the house name via `/api/production-queue`, since QC check detail payloads do not expose the house identifier.

## 2026-01-08
- Legacy module production rows are grouped by project name + house identifier + house type + subtype to create `work_orders`, with `work_units.id` set to the legacy `plan_id` and `work_orders.planned_sequence` set to the smallest module sequence in the group.
- Panel production rows are imported into `panel_units` during module production import, keyed by the legacy `panel_production_plan_id`.
- Legacy task logs are grouped by plan + panel + task + station (station_finish preferred, otherwise station_start) into single task instances, with one task participation per log row.
- Legacy task applicability now uses explicit module rows and panel `applicable_tasks`, and implicit missing pairs are written as `applies = false` when the `module_task_templates` import section is used (skipping global default applicability rows in that case).

## 2026-01-09
- Task applicability defaults are now implied by `task_definitions` (absence of a scoped `TaskApplicability` row means applies=true), and default-scope applicability rows are no longer used.

## 2026-01-10
- QC auto-skip executions are attributed to a system QC admin user created on demand (`System QC`, PIN `0000`) so `QCExecution.performed_by_user_id` stays required.
- Adaptive sampling updates apply to any `QCTrigger` for the same check definition that includes the triggering `task_definition_id`.

## 2026-01-08
- Login panel goal summary assumes `GET /api/station-panels-finished` only counts a panel once all applicable tasks for the station are satisfied (including skips), and uses the latest completion/skip at prior panel stations to count pass-through panels with no tasks.
- Worker badge printing defaults to the ID-1 size (86 x 54 mm) as the standardized badge format.

## 2026-01-10
- Task analysis dashboard assumes a `GET /api/task-analysis` endpoint that accepts `house_type_id`, `panel_definition_id`, `task_definition_id`, `station_id`, `worker_id`, `from_date`, and `to_date` query params and returns `data_points`, `stats.average_duration`, and `expected_reference_minutes` in the legacy shape until the backend analytics routes are rebuilt.
- When `panel_definitions.applicable_task_ids` is null, `panel_definitions.task_durations_json` is assumed to align with panel-scope tasks ordered by `default_station_sequence` then name (matching the House Configurator UI ordering) for task analysis expected-minute lookup.

## 2026-01-11
- Panel linear meters dashboard assumes `GET /api/panel-linear-meters` with `from_date`, `to_date`, `house_type_id`, `min_multiplier`, and `max_multiplier` params, returning per-panel-definition rows with station aggregates; W-stations are treated as stations with `Station.role == Panels`.
- Outlier filtering for panel linear meters uses the ratio of summed panel-unit station duration to summed expected minutes for tasks recorded at that station; samples without expected minutes are retained and excluded from ratio filtering.
- Pause summary assumes `GET /api/pause-summary` with `from_date`, `to_date`, and optional `house_type_id`, returning pause durations computed from `TaskPause.resumed_at` (or task completion), grouped by reason, filtered by `TaskPause.paused_at` in the date range for panel-scope tasks at panel stations.

## 2026-01-12
- Panel production history assumes a `GET /api/panel-task-history` endpoint filtered by `TaskInstance.completed_at` (date-only values treated as end-of-day) and defaults to completed panel-scope tasks, with pause durations calculated from `TaskPause.resumed_at` or task completion.

## 2026-01-13
- Station panels finished dashboard assumes `GET /api/station-panels-finished` counts panels only after all applicable tasks at the station are satisfied (including skips), and pass-through panels without task logs use the latest completion/skip at any prior panel station as their pass timestamp.
- GeoVictoria name proposal script writes a minimal XLSX (sheet1 + shared strings only) for the updated partidas file, and keeps unmatched names unchanged in the new GeoVictoria column.
- Synthetic shift CSV generator builds in-memory work orders/units/panels from existing house types/panel definitions, schedules tasks sequentially per station using task applicability + expected durations (panel `task_durations_json` or `task_expected_durations`), assigns workers by station assignment (fallback to all workers), and writes a single denormalized timeline CSV without seeding the database.
- Plant view dashboard groups stations into lanes by matching station names against simple regexes (W/panel, A/armado, magazine, aux) and expects CSV data to be loaded via upload or served from `/synthetic_task_timeline.csv`.
- Plant view dashboard infers assembly line labels by ordering station IDs within each station name (Armado/Estacion N) and treats workers as “assigned” to a station group if they appear in the CSV for that group.
- Plant view dashboard always renders Armado + Estacion 1-6 with three line slots, creating placeholder stations when the CSV has no rows for a specific termination station.

## 2026-01-14
- Partidas task import treats the sheet as module-scope tasks, maps `ESTACION` to `TaskDefinition.default_station_sequence` using ARMADO=11/ESTACION 1=12, and overwrites applicability for the selected house type by deleting + recreating module-scope rows.
- Regular crew assignments are rebuilt for tasks listed in partidas using exact normalized name matches (prefering the GeoVictoria column when present), with GeoVictoria IDs pulled from the API when available; missing workers are created and assigned stations by matching `Station.sequence_order` to the derived `ESTACION` sequence.
- Worker badge printing assumes the official logo lives at `ui/public/logo.png` and is referenced via `/logo.png`.
- Worker badge name parsing uses the first token as the first name and the second-to-last token as the first surname (assuming the last two tokens are surnames).

## 2026-01-15
- QC dashboard station grid uses `/api/stations` for layout and derives module/panel labels from the most recent pending check or rework task at each station, since no dedicated station-occupancy endpoint exists yet.
- House type copy tooling treats module-related config as subtypes, panel definitions, house parameter values, and task applicability/expected-duration rows scoped to the source house type (including subtype/panel-specific rows).

## 2026-01-16
- Planned sequencing and assembly line metadata live only on `work_units`; `work_orders` no longer store planned_* fields, and legacy import does not set them.

## 2026-01-17
- Floor status dashboard pulls live station data from `/api/worker-stations/{station_id}/snapshot`, and the endpoint tolerates anonymous access by omitting worker-specific filters (skills, participation, QC notifications).
- Task time dashboard normalized tab uses per-panel completions from `/api/station-panels-finished` (with `from_date`/`to_date` range support), filters by `panel_definitions.group`, and computes minutes per m/m2 from each completion using `panel_definitions.panel_area`/`panel_length_m`, excluding panels missing either metric.
