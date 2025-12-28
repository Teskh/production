# SCP – Rebuild Specification (Working Draft)

This document captures what the current application *does* (features + UX), what data it stores, and how the main workflows work end‑to‑end. The intent is that a team can rebuild the app from this document without copying the current architecture verbatim.

Status: rebuild-ready; filled from codebase study (behavior-first).

---

## 0) Goals of this document

1. Describe the **product behavior** (not the current implementation) well enough to recreate it.
2. Define the **domain model** (entities, statuses, relationships) and the **business rules** that drive production flow.
3. Enumerate the **user roles**, **screens**, and **critical UX decisions/guardrails** that affect usability on the shop floor.
4. Specify **integration points** (SQLite persistence, optional Mongo/GeoVictoria attendance).
5. Make explicit any **edge-case behaviors** so the rebuild can match them.

Non-goal: defend existing architecture or file layout. The rebuild can choose different boundaries as long as it preserves behavior.

---

## 1) Product summary (what this app is)

SCP is a production execution + tracking web app for a modular housing/panelized workflow. It supports:

- **Worker station UI** to execute work (start/pause/resume/finish tasks) and record timestamps/notes.
- **Admin UI** to configure the “production language” (stations, tasks, house types, panels, specialties, crews, expected durations, dependencies, etc.) and to review history/analytics.
- **Quality Control (QC)** checks with sampling, triggers, evidence capture, and rework task tracking.
- **Attendance (“Asistencias”)** views from an optional MongoDB source (GeoVictoria), with mapping between internal workers and external identities.
- **Auxiliary stations** (non W/M/A/B/C) that can perform module-level tasks in parallel with the main line.

---

## 2) Users & roles

Roles are represented in frontend routing + backend auth.

- **Worker**: logs in by name + PIN (or name-only when allowed) and uses the station UI.
- **Supervisor / Gestión de producción / Admin / SysAdmin**: access the admin dashboard.
- **Control de Calidad**: access QC dashboard and execution.

Notes:
- Admin authentication is based on `AdminTeam` entries (first_name + last_name + pin) plus a hardcoded SysAdmin credential.
- QC staff appear to be modeled as an `AdminTeam.role == "Control de Calidad"`; the backend additionally tries to find a matching `Workers` record for them.
- Worker auth rules:
  - Name+PIN requires a 4-digit numeric PIN; if the PIN is `"1111"` the API marks `require_pin_change=true`.
  - Name-only worker login is allowed only when either `qr=true` is provided, or the worker has `login_required=0`; otherwise the API returns “PIN requerido…”.
- Product/security reality in current code: login returns a user object, but most endpoints do not enforce session/token auth; access control is largely UI-gated.

---

## 3) Production flow (rebuild-critical)

This section describes the core shop-floor behavior: how modules and panels move, which tasks appear where, and the rules for advancing and completing work.

### 3.1 Station sequencing and task-to-station mapping

Stations have:
- `station_id` (e.g. `W1`, `A2`, `AUX1`)
- `line_type` (e.g. `W`, `M`, `A`, `B`, `C`, or auxiliary types like `AUX`)
- `sequence_order` (integer ordering)

Task definitions map to stations primarily via `TaskDefinitions.station_sequence_order`, which is compared to `Stations.sequence_order`.
- Panel tasks: `TaskDefinitions.is_panel_task = 1`
- Module tasks: `TaskDefinitions.is_panel_task = 0`

Special case: auxiliary stations are identified by `Stations.role='auxiliary'` or a `line_type` outside `W/M/A/B/C`. Auxiliary tasks are module tasks and are served from a separate “aux task queue”.

### 3.2 Module lifecycle (`ModuleProductionPlan.status`)

Observed status set: `Planned`, `Panels`, `Magazine`, `Assembly`, `Completed`.

Observed transitions:
- `Planned` → `Panels`: when the first panel for this module is started at `W1`.
- `Panels` → `Magazine`: when **any** panel for the module completes the W line (there is no “wait for all panels” check in current code).
- `Magazine` → `Assembly`: when a module task is started at the first station of an assembly line for a module currently in `Magazine`.
- `Assembly` → `Completed`: when the module advances past the last applicable assembly station.

### 3.3 Panel lifecycle (`PanelProductionPlan.status`)

Status set: `Planned`, `In Progress`, `Completed`, `Consumed`.

Panel “not started” is represented as either:
- no `PanelProductionPlan` row yet, or
- a row with `status='Planned'`.

Observed transitions:
- Start at `W1`: row becomes/created as `In Progress`, `current_station='W1'`.
- Advance along W: stays `In Progress` and `current_station` changes to the next W station.
- End of W line: becomes `Completed`, `current_station=NULL`.
- Module completion (end of assembly): all panels for the module become `Consumed`, `current_station=NULL`.

### 3.4 Shared execution logging semantics (critical detail)

The system allows **parallel logs** (multiple workers can start the same task), but completion is effectively **shared**:
- Finishing a panel task completes *all non-completed* `PanelTaskLogs` for the same `(plan_id, panel_definition_id, task_definition_id)`.
- Finishing a module task completes *all non-completed* `TaskLogs` for the same `(plan_id, task_definition_id)`.

Rebuild implication: UI/analytics must expect “one worker finishing can close other workers’ logs” for the same task.

### 3.5 Panel production on the W line

#### 3.5.1 Starting panels at W1 (sequence gating)

At station `W1` there is a “start order” rule:
- Only one of the **next two** scheduled panels for W1 is allowed to be started (unless that panel is already in progress at W1).
- The “next two” list is computed from the station daily schedule stream; fallback is global `planned_sequence` order scanning modules in status `Planned`/`Panels` and choosing the first “not started” panels.

#### 3.5.2 Which panel tasks exist at a W station

For a given module + panel at a station:
- Determine station sequence: `Stations.sequence_order`.
- Candidate required tasks are all active `TaskDefinitions` with:
  - `is_panel_task=1`
  - `(house_type_id = module.house_type_id OR house_type_id IS NULL)`
  - `(station_sequence_order = station.sequence_order OR station_sequence_order IS NULL)`
- If `PanelDefinitions.applicable_tasks` is set, it is a whitelist of task_definition_ids for that panel.

#### 3.5.3 Panel advancement rule (per station)

After finishing or skipping tasks, the panel advances when **all required tasks for that panel at that station** are satisfied, where “satisfied” means:
- a completed `PanelTaskLogs` exists for that task, or
- a station-scoped skip override exists in `TaskOverrides` for `(plan_id, panel_definition_id, task_definition_id, station_id)` with `is_panel_task=1`.

Advancing:
- Find next W station by increasing `sequence_order`.
- Skip W stations that have no tasks for the panel (determined without specialty filtering).
- If there is no next W station: mark the panel `Completed` and set module status to `Magazine` (observed behavior).

#### 3.5.4 Auto-advance if a W station has no applicable tasks

If a panel has no tasks at the current W station *and* there are no possible tasks for that station (ignoring specialty), the panel can be automatically pushed forward to the next W station with tasks (or completed if none exist).

#### 3.5.5 Carryover tasks from earlier W stations (“overrides”)

If a panel task was skipped at an earlier W station, downstream W stations still surface it as an optional “catch-up” task:
- A “skipped” task is represented by a `TaskOverrides` row for `(plan_id, panel_definition_id, task_definition_id, station_id)` where `is_panel_task=1`.
- When listing tasks for a panel at a W station, the backend appends “carryover suggestions” for overrides created at earlier W stations.
- These tasks are marked with `carried_over=true` and include:
  - `skipped_at_station=<origin station_id>`
  - `skip_reason=<origin reason>` when present
- Filtering rules:
  - only tasks skipped at a W station with `sequence_order < current_station.sequence_order`
  - only active panel tasks
  - must match the panel’s `PanelDefinitions.applicable_tasks` set when defined
  - must not already be completed for the panel
- Important: carryover tasks are suggestions only; the auto-advance “no tasks at this station” logic uses only tasks strictly applicable to the current station (carryovers do not prevent auto-advance).

### 3.6 Module work in Magazine and Assembly lines

#### 3.6.1 Pulling from Magazine into Assembly

When a worker starts a module task:
- If the module is `status='Magazine'` and the station is the first station sequence for an assembly `line_type`,
- then the module is updated to `status='Assembly'` and `current_station=<first station id for the chosen line>`.
- If `planned_assembly_line` is missing, it may be inferred from the station’s line type.

#### 3.6.2 Which module tasks exist at an assembly station

Candidate required tasks are active `TaskDefinitions` with:
- `is_panel_task=0`
- `(house_type_id = module.house_type_id OR house_type_id IS NULL)`
- `station_sequence_order = station.sequence_order`

There is also an applicability filter layer (`ModuleTaskApplicability`) that can restrict which module-task ids are “in play” for a given `(house_type_id, module_number, sub_type_id)`:
- If there are rows for the module’s sub-type scope, only those tasks are considered.
- Else if there are rows for the general scope (sub_type_id NULL), only those tasks are considered.
- Else (no rows), all tasks matching the station sequence are considered.

#### 3.6.3 Module advancement rule (per station)

There are two modes:

1) Rule-based (`ModuleAdvanceRules`)
- If a rule exists for this station sequence (optionally scoped by house type/subtype), the module advances once **all rule trigger tasks** are completed on this plan.
- Trigger tasks are identified only by `task_definition_id` and are *not* required to belong to the current station sequence; the rule is a “gate” evaluated against global completion state for the module.
- When advancing using a rule, any in-progress module tasks at this station sequence are auto-paused (“Auto-pausa por avance de módulo”).

2) Legacy fallback (“all tasks satisfied”)
- If no rule applies, the module advances when all required module tasks for this station are satisfied, where “satisfied” means:
  - a completed `TaskLogs` exists for that task, OR
  - a station-scoped skip override exists in `TaskOverrides` for `(plan_id, task_definition_id, station_id)` with `is_panel_task=0`.
- If there are no required tasks, the station is treated as satisfied immediately.

Advancing:
- Move to the next station in the same `line_type` by increasing `sequence_order`.
- Skip stations that have no applicable tasks for this module.
- If there is no next station with tasks: mark the module `Completed` and mark all its panels as `Consumed`.

#### 3.6.4 What happens when a station has no applicable module tasks

The flow is designed so that a module should not “sit” on stations that have no tasks:
- When advancing, the system looks ahead station-by-station and chooses the next station **that has at least one applicable task** (based on house type + `ModuleTaskApplicability` filtering). Stations with no tasks are skipped.
- If there is no future station with tasks on that line, the module is completed.

### 3.7 Dependencies, concurrency, and skips (shared rules)

Dependencies:
- `TaskDefinitions.task_dependencies` defines prerequisite task ids.
- Panel dependencies are evaluated against completed `PanelTaskLogs` for the same panel.
- Module dependencies are evaluated against completed `TaskLogs` for the same plan.
- If dependency parsing fails, the task is blocked from starting (fail closed).

Concurrency:
- A worker cannot have more than one active non-exempt task at a time.
- Tasks with `concurrent_allowed=1` are exempt.

Skips:
- Skipping creates a row in `TaskOverrides` scoped to station (+ panel for panel tasks).
- Skipping also pauses any active “In Progress” logs for that task and writes a `TaskPauses` entry with a “Skipped override: …” reason.

---

## 4) Domain model & core concepts (glossary)

Terminology as used in DB schema and UI:

- **Station** (`Stations`): physical workstation. Has:
  - `station_id` (string like `W1`, `A2`, `AUX1`),
  - `line_type` (main line types: `W`, `M`, `A`, `B`, `C`; auxiliary: anything else, commonly `AUX`),
  - `sequence_order` (integer ordering for flow; can be null/blank for auxiliary ordering),
  - optional `role` (e.g. `auxiliary`).
- **House Type** (`HouseTypes`): product family; has `number_of_modules`.
- **House SubType (Tipología)** (`HouseSubType`): variant within a house type.
- **Module**: a build unit in a house (module 1..N) for a specific project+house.
- **Module plan item** (`ModuleProductionPlan`): a specific module instance scheduled in the global sequence (project name, house identifier, module number, planned line, planned start, status).
- **Panel definition** (`PanelDefinitions`): panel “template” belonging to a house type + module sequence (group + code). Optional subtype scoping.
  - Can store `panel_area`, `panel_length_m`.
  - Can store a panel-specific list of applicable tasks (`applicable_tasks`) and per-task durations (`task_length`), both JSON stored in TEXT.
- **Panel production plan item** (`PanelProductionPlan`): per planned module, each panel has its own status/current station.
- **House parameter definition** (`HouseParameters`): named numeric parameter with an optional unit (e.g., floor area, component count).
- **House parameter value** (`HouseTypeParameters`): a numeric value for a parameter scoped to `(house_type_id, module_sequence_number, sub_type_id?)`.
- **External project link**: `HouseTypes.linked_project_id` optionally points to a “project” in an external SQLite DB used for materials/BOM lookup.
- **Task definition** (`TaskDefinitions`): definitional list of work steps:
  - **Panel tasks** (`is_panel_task=1`) → executed against a panel in a module, logged in `PanelTaskLogs`.
  - **Module tasks** (`is_panel_task=0`) → executed against a module, logged in `TaskLogs`.
  - Tasks can be scoped by house type, station sequence order, specialty.
  - Tasks can encode prerequisites (`task_dependencies`, JSON list) and flags like `concurrent_allowed`, `skippable`.
  - Tasks can constrain who can run them (`TaskDefinitionAllowedWorkers`) and define a “regular crew” (`TaskDefinitionRegularCrew`).
- **Task execution logs**
  - `TaskLogs`: module task executions.
  - `PanelTaskLogs`: panel task executions.
  - Both have status lifecycle (`Not Started` / `In Progress` / `Paused` / `Completed`, plus “Skipped” semantics via overrides).
  - `TaskPauses` records pause intervals (can link to module/panel/rework logs).
- **Skip overrides** (`TaskOverrides`): station-scoped “this task is treated as satisfied here” with a reason; used by panel task completion checks.
- **QC check definition** (`QCCheckDefinitions`): named check with sampling parameters and “active” status.
- **QC triggers** (`QCCheckTriggers`): when to open a QC check instance (e.g. task completed, entering station).
- **QC applicability rules** (`QCCheckApplicabilityRules`): scope checks to house type/module/subtype; higher specificity wins.
- **QC instance** (`QCPlanCheckInstances`): an opened/closed check tied to a plan/module and optionally a panel + task logs.
- **QC execution** (`QCCheckExecutions`): each attempt/outcome (passed/failed/waived/etc.) with notes and performer.
- **QC evidence** (`QCEvidenceMedia`): images/videos attached to an execution; stored in `data/qc_media_gallery`.
- **QC rework** (`QCReworkTasks` + `ReworkTaskLogs`): rework tasks created from failed checks, then executed like tasks.
- **Worker QC notifications** (`WorkerQCNotifications`): pushes failed check/rework info into the worker station UI.
- **Attendance integration (GeoVictoria)**: external time punches stored in Mongo; internal workers optionally store a `geovictoria_identificador` for mapping.

---

---

UI layout and navigation are documented in `docs/REBUILD_UI_SPEC.md`.

---

## 5) Core workflows (end-to-end behavior)

### 5.1 Login & station context selection

Primary UX goals:
- Minimize friction for shop-floor workers (fast login, support touch devices).
- Persist “context” across logins to avoid repeated station selection.

Behavior (from `frontend/src/pages/LoginPage.jsx`, `backend/app/api/auth.py`):

Worker login:
- User selects or types a **full name**.
- If the worker’s `login_required` is false (or if the QR flow is used), attempt **name-only login**.
- Otherwise request a **4-digit PIN**.
- If PIN is the default (`1111`), backend returns `require_pin_change=true` and UI forces a PIN update.

Admin login:
- Toggle to admin login; username is “First Last” (collapsed spaces), password is the admin `pin`.
- SysAdmin uses hardcoded credentials in backend (rebuild should replace this with a safer mechanism).

Station context:
- UI uses localStorage keys:
  - `selectedStationContext` (can be an assembly “sequence”, or special values like `PANEL_LINE_GENERAL`, `AUX_LINE_GENERAL`)
  - `selectedSpecificStationId` (actual station_id)
  - `autoFocusPrevStationContext` (restored on logout in `frontend/src/App.jsx`)
- UX includes a modal to select a **specific station** when the context is ambiguous (e.g., multiple stations share a sequence).
- Login screen shows a lightweight “daily schedule preview” for the selected station (informational only).

### 5.2 Worker station UI (production execution)

The worker UI (`frontend/src/pages/ProductionManager.jsx`) is the heart of the system. It is driven by:
- the logged-in worker identity,
- current station selection (including auxiliary stations),
- data from the admin/production APIs.

Core actions (all must be preserved in the rebuild):
- Start a task (module or panel or auxiliary module task).
- Pause a task (with a required pause reason).
- Resume a paused task.
- Finish a task (optionally with notes/comment templates).
- Skip (some tasks) with a required reason (implemented as overrides for panel tasks).
- Select crew/regular crew behaviors for tasks that require multiple workers.
- See QC notifications (failed checks) and open evidence/reasons.

Task metadata capture UX rules:
- Pause requires a reason. The pause modal offers predefined reasons (definitions may target a station via legacy `station_id` or via a CSV `stations` list; empty `stations` means “applies to all stations”), plus a free-text option.
- Choosing a predefined pause reason auto-confirms immediately; free-text requires explicit confirmation.
- Notes/comments are typed or chosen from station-scoped templates, and are stored on the finished log row (`notes`) when a task is completed.

#### 5.2.1 Auto-focus to a worker’s active task (UX guardrail)

If a worker already has a task `In Progress`, the UI can auto-redirect them to the station that task belongs to and pre-select the relevant module/panel:
- Backend definition of “latest active task”:
  - fetch latest `PanelTaskLogs(status='In Progress')` for the worker (by `started_at`)
  - fetch latest `TaskLogs(status='In Progress')` for the worker (module tasks only, by `started_at`)
  - return whichever started later (panel wins ties).
- When auto-focusing, the UI overwrites station context in localStorage:
  - `selectedStationContext` and `selectedSpecificStationId` are set to the resolved station id
  - `autoFocusPrevStationContext` stores the prior station context (for “redirected from …” messaging).

#### 5.2.2 Station daily schedule (W line) and “panels passed today”

The station daily schedule endpoint returns a forward-looking stream of work for a station derived from the global planned order (not just what is physically at the station):
- It iterates `ModuleProductionPlan` by `planned_sequence` (excluding `Completed`), then iterates `PanelDefinitions` in panel order (respecting sub-type rules).
- For the station sequence, it emits:
  - actual tasks at that station, with `expected_minutes` and computed `actual_minutes`, and task status.
  - “panel placeholder” rows when a panel has no tasks at that station (`task_name='Panel sin tareas en esta estación'`), so the UI can still show that the panel “passed”.
- It excludes tasks completed on a prior calendar day from the daily plan list.
- For W stations it also returns the daily “pass-through” summary:
  - `panels_passed_today_count`
  - `panels_passed_today_list` (plan/panel identifiers, panel code, module info, panel area)
  - `panels_passed_today_area_sum`

#### 5.2.3 “Otra tarea” quick-start + backlog tasks (assembly)

The UI includes a “quick start other task” affordance for the currently selected module:
- It can list startable tasks for that module across assembly-line stations (A/B/C) using the station overview payload (not just the current station).
- It includes two scopes:
  - eligible tasks at those stations
  - backlog tasks (“Pendientes de estaciones anteriores”) derived from anomaly detection
- It hides tasks that are `Completed`, `Skipped`, dependency-blocked, or currently `In Progress` when `concurrent_allowed=false`.
- Starting from this modal calls the normal module-task start endpoint with `station_start` set to the task’s station; it does not require switching the current station UI.

Business rules (backend `backend/app/database/production_flow/panel_flow.py`, `.../module_flow.py`, `.../worker_concurrency.py`):
- **Dependencies**: tasks can require prerequisite tasks (`task_dependencies`) to be completed before starting.
- **Concurrency**: workers cannot start a new non-exempt task while another non-exempt task is active (unless `concurrent_allowed`).
- **Panel task completion**:
  - Completing a panel task can advance the panel along W-stations when *all required tasks for that panel at that station* are satisfied.
  - A station’s “required tasks” can be filtered per panel via `PanelDefinitions.applicable_tasks`.
  - Skipped tasks count as satisfied via `TaskOverrides` (station-scoped).
- **QC triggers**:
  - Completing tasks can open QC instances (deterministic sampling).
  - Failed QC can create rework tasks and worker notifications.

Auxiliary stations:
- Stations are considered auxiliary if `Stations.role == "auxiliary"` OR `line_type` is not one of `W/M/A/B/C`.
- Auxiliary UI supports “dual mode” (start the same aux task for two matching modules) and uses `/api/aux` routes.

### 5.3 Admin configuration workflows

Admin pages configure:
- Stations (including auxiliary stations).
- Workers (specialties, station assignments, login flags, GeoVictoria ID mapping).
- Task definitions (panel vs module tasks, station mapping, dependencies, expected durations, skippable/concurrent).
- House types, subtypes (tipologías), parameters, panel definitions, multiwalls.
- Pause definitions and note/comment templates.
- Module advance rules.
- House parameters and per-house-type parameter values.
- Optional external project link per house type (for materials).

Admin pages also provide:
- Active production dashboard.
- History and exports (panel history, finished panels, linear meters, task analysis).

### 5.4 QC workflows

There are three key surfaces:

1) QC definitions (admin):
- Create/edit/deactivate check definitions.
- Configure triggers and applicability rules.
- Attach guidance/reference media to check definitions.

2) QC dashboard:
- See pending/open checks, filter by line/station.
- See rework tasks (open/in progress), grouped by line/station.

3) QC execution page:
- Load a specific check instance.
- Execute: choose outcome + notes.
- Capture images from device camera; watermark text includes module/panel/check + timestamp.
- Upload evidence files; later view evidence thumbnails.
- If outcome is `fail`:
  - Create a `QCReworkTasks` row (`status='open'`) tied to the check instance (description defaults to “Trabajo requerido…” if notes absent).
  - Create/refresh a `WorkerQCNotifications` entry for the worker who performed the checked task (derived from the related task log’s `worker_id`).
- If outcome is `pass`/`waive`/`skip`:
  - Close the QC instance and auto-complete any open rework tasks tied to it.
- The worker-notifications feed returns “active” failures by default: notifications created within the last 36 hours and whose linked rework is not `done`/`canceled`.

### 5.5 Attendance (asistencias) workflow

Behavior:
- Admin selects a worker.
- If the worker lacks a `geovictoria_identificador`, UI attempts auto-match in Mongo by first+last name; if exactly one match, it writes the identifier back to the worker record.
- Backend computes daily summaries (work intervals, overlap, expected minutes per tasks, etc.) using Mongo punches + internal task logs.

---

## 6) UX decisions worth preserving (current rationale)

These are implementation-independent behaviors that matter:

- **Fast login** with name list + optional QR/name-only flow for selected workers.
- **Persist station context** so a station tablet is “ready to go” after logout/restart.
- **Modal-first task actions** (pause/skip reasons, comment templates, crew selection) so required metadata is always captured.
- **Station daily schedule preview** on login: helps workers anticipate upcoming tasks.
- **QC evidence capture on mobile** with clear error messaging about HTTPS/secure context camera restrictions.
- **Admin sidebar collapses on small screens** (shop-floor tablets).

---

## 7) What we have captured (and rebuild-critical details)

### Captured in this spec
- Core entities and their status lifecycles (modules, panels, tasks, QC).
- Production flow rules: W-line panel flow, Magazine/Assembly module flow, advancement and skip semantics.
- Key shop-floor constraints: dependency enforcement, worker concurrency constraints, and “shared completion” across parallel logs.
- High-level admin/QC/attendance capabilities (behavioral, not implementation).

### Previously-missing details (now resolved from code)

#### 7.1 Analytics: “Task analysis” (admin)

Endpoint behavior (`/admin/task-analysis`):
- Inputs: `houseTypeId` + `panelDefinitionId` are required; optional filters: `taskDefinitionId`, `stationId`, `workerId`, `fromDate`, `toDate`.
- Data source: `PanelTaskLogs` joined with module/panel/task/worker metadata.
- Duration calculation: `duration_minutes = (completed_at - started_at)` per log (this view does **not** subtract pause time).
- Modes:
  - `mode='task'` when `taskDefinitionId` is provided: returns one row per completed log for that task.
  - `mode='station'` when `stationId` is provided (and no `taskDefinitionId`): groups per module plan and sums durations of all completed panel-task logs at that station for the panel definition.
  - `mode='panel'` when neither `taskDefinitionId` nor `stationId` is provided: groups per module plan and sums durations of all completed panel-task logs for that panel definition.
- “Expected minutes” reference:
  - Task mode: uses the expected minutes for that task from the panel definition’s expected-minutes map.
  - Station/panel modes: uses the sum of expected minutes for tasks that appear in the samples; additionally, station mode tries to compute a station-specific expected total by building the station task list for that panel.

#### 7.2 Analytics: “Metros lineales” (admin)

Endpoint behavior (`/admin/panel-linear-meters`):
- Data source: completed `PanelTaskLogs` at W stations (`W1..W9`), enriched with station info and panel definition metadata (`panel_length_m`).
- Work time per sample: `(completed_at - started_at) - pause_minutes` (pause time derived from `TaskPauses`).
- Optional outlier filter: if a task has expected minutes, drop samples whose `work_minutes / expected_minutes` is outside `[minMultiplier, maxMultiplier]`.
- Aggregation: per `panel_definition_id` and per W station:
  - `avg_time_minutes = total_work_minutes / sample_count`
  - `lm_per_minute = panel_length_m / avg_time_minutes` (when both are present and > 0)
  - also reports average expected minutes and average ratio when available.

#### 7.3 Task logging semantics: crews / “partir tarea grupal”

The system has two different concepts that work together:

1) Regular crew definition (admin)
- A task definition can have a “regular crew” list (workers) stored in `TaskDefinitionRegularCrew`.
- This affects only UI suggestions (the modal preselects these workers); it does not automatically create logs.

2) Starting a task “in group”
- Panel tasks: `/panel-tasks/start-group` loops over `worker_ids` and calls `start_panel_task(...)` once per worker, creating one `PanelTaskLogs` row per worker (parallel logs).
- Module tasks: `/tasks/start-group` loops over `worker_ids` and calls `start_module_task(...)` once per worker, creating one `TaskLogs` row per worker (parallel logs).
- Finishing remains “shared completion”:
  - `finish_panel_task(...)` marks **all** non-completed logs for that `(plan_id, panel_definition_id, task_definition_id)` as completed, using the same `completed_at` timestamp for all.
  - `finish_module_task(...)` marks **all** non-completed logs for that `(plan_id, task_definition_id)` as completed, using the same `completed_at` timestamp for all.

#### 7.4 Skips: what can be skipped

Skips are supported at the API/business-rule level for:
- Panel tasks (`/panel-tasks/skip`) via `TaskOverrides(is_panel_task=1, station_id + panel_definition_id scope)`.
- Module tasks (`/module-tasks/skip`) via `TaskOverrides(is_panel_task=0, station_id scope)`.
- When a skip is recorded, any active “In Progress” logs for that task are paused and a `TaskPauses` record is created with reason `Skipped override: ...`.

#### 7.5 QC trigger scoping (what events create QC instances)

There are two trigger types, both evaluated explicitly by production flow code:

1) `task_completed`
- Evaluated on panel task completion and module task completion.
- Trigger config contains `params_json.task_definition_ids` (list).
- Creates a `QCPlanCheckInstances` row linked to either:
  - `related_panel_task_log_id` (for panel tasks), or
  - `related_task_log_id` (for module tasks).
- Not evaluated for rework task logs.

2) `enter_station`
- Evaluated when production flow advances a panel or module to a new `current_station`.
- Trigger config contains `params_json.station_sequence_order` (single value).
- For panels: instance links to `panel_production_plan_id` when available.

Both trigger types apply only if the check is active and its applicability rules match the module (house type + module number + optional sub-type). Sampling is deterministic per `(plan_id, check_definition_id, trigger_event_id)`.

#### 7.6 Auxiliary stations (aux task queues)

Aux stations are stations whose `role='auxiliary'` or whose `line_type` is not one of `W/M/A/B/C`.

Behavior:
- Aux tasks are **module tasks** (`is_panel_task=0`) executed via `TaskLogs`, but they do **not** advance module `current_station` or module status.
- Default eligible module statuses for aux queues: `('Planned', 'Panels')` (configurable via request query params in the aux API).
- “Pending tasks” for an aux station are computed from task definitions associated with that aux station, minus tasks already completed/skipped for that module.
- Dual mode pairing (`auto_pair_identical`):
  - When enabled, starting an aux task for one module can auto-add up to one additional module that is “identical” (same `house_type_id`, `module_number`, and `sub_type_id`) and in an eligible status, and that has not already run that task (`TaskLogs` status in `('In Progress','Paused','Completed')` blocks pairing).

#### 7.7 Reporting: “Station panels finished” + export + ex-post notes

The system has a reporting view that reconstructs “which panels finished/passed a station on a day”:
- Candidates for a station+day include panels that:
  - had a panel task completed with `station_finish=<station_id>` that day, OR
  - had a skip override created for that station that day, OR
  - completed a downstream W-line station that day (pass-through), plus an expansion query for panels that completed any W station up to the station sequence by end-of-day.
- Output is grouped house → module → panels, and includes per-panel task rows (with statuses and time totals) plus `time_summary` and `panels_passed_today_area_sum`.
- Ex-post notes: a separate endpoint appends `[ex-post] ...` into `PanelTaskLogs.notes` for *all* logs of the plan+panel (newline-separated).
- Export: an endpoint generates an XLSX report for station/date using the same underlying report payload.

#### 7.8 External materials lookup (task materials)

If enabled, the UI can show a “materials list” for the selected task:
- Endpoint takes `(task_definition_id, house_type_id)` and returns materials based on:
  - `HouseTypes.linked_project_id` (if absent, returns an empty list),
  - an external SQLite “projects” DB and external SQLite “main.db”,
  - BOM quantities plus attribute-based filtering for applicability.

#### 7.9 Compliance: module task anomalies (admin)

The admin can request an “anomalies” summary for one or more module plans:
- `unfinished_tasks`: tasks expected at or before the module’s current station sequence that are neither completed nor skipped via override.
- `misplaced_tasks`: completed task logs whose expected station (sequence+planned line) does not match where they were recorded (unless explicitly overridden).

Backlog surfacing:
- Station overview can optionally attach these `unfinished_tasks` as `backlog_tasks` for modules currently shown at an assembly station.
- This behavior is gated by an environment flag `STATIONS_BACKLOG_ENABLED` (defaults to enabled unless explicitly set to a falsey value like `0/false/off`).

#### 7.10 Behavior clarifications resolved from code

- **Auth/session**: login returns user info only; no tokens/sessions. Access control is UI/localStorage‑gated. Workers without `login_permanance` are auto‑logged out after 45s of inactivity.
- **Plan generation**: `planned_sequence` appends from current max; modules per house are inserted in descending module_number; `planned_start_datetime` increments +1h per module; planned line cycles A/B/C by current max sequence. `house_identifier_base` is accepted but identifiers are numeric (string), with optional collision checks when `starting_house_number` is provided.
- **Reorder**: admin reorder rewrites *all* `planned_sequence` to 1..N in the provided list; no server‑side concurrency guard.
- **Timebase**: “today” uses server local time midnight (00:00–23:59:59) for daily schedule and reports; panels‑finished uses a separate `08:20` day start for idle/overtime summaries. QC timestamps use current server time for events.
- **Module task ordering**: station task lists and magazine eligibility are ordered by `TaskDefinitions.name`; backlog tasks are ordered by `planned_sequence` then name. “Otra tarea” modal sorts by station name → scope → task name.
- **Specialty filtering**:
  - Panel tasks: backend filters by a single `specialty_id` (UI passes worker’s first specialty); if none, only tasks with `specialty_id IS NULL` are returned.
  - Module tasks: backend does not filter by specialty; UI filters to tasks whose specialty is NULL or in the worker’s specialties (override modal disables this filter).
- **Pause/resume/finish semantics**:
  - Pause requires an in‑progress log; resume closes the latest open pause row.
  - Finish completes *all* non‑completed logs for the same plan/task (panel or module), closes open pauses, and applies `notes` to all logs via `COALESCE(?, notes)`.
- **Dependencies + allowed workers**:
  - Module tasks: invalid dependency JSON blocks starts; allowed‑worker lists enforced.
  - Panel tasks: dependency parse failures fail open; allowed‑worker lists are not enforced.
- **QC sampling**:
  - Deterministic seed: `sha256(f"{plan_id}:{check_definition_id}:{trigger_event_id}")[:16]`.
  - Sampling uses `sampling_current_rate` if present; skipped samples still create `QCPlanCheckInstances` rows with `status='skipped'`.
  - Adaptive sampling: fail → current rate = 1.0; pass → current rate decreases by `sampling_step` but not below base rate.
- **Rework lifecycle**:
  - Fail creates `QCReworkTasks` (`status='open'`).
  - Rework work creates/resumes `ReworkTaskLogs`; workers cannot start if they have any other active task/panel/rework.
  - Completing rework closes pauses, completes *all* rework logs, marks rework `done`, and reopens the QC instance.
  - Rework list filters by the panel/module `current_station` (no explicit station assignment).
- **Auxiliary pairing**: auto‑pair selects the earliest `planned_sequence` module with same house_type/module_number/sub_type, status in Planned/Panels, and no existing logs for that task; pairing candidates can be skipped if dependency checks fail.
- **Materials lookup**: tasks link to external Items/Accessories whose `associated_tasks` JSON contains the task id; material conditions are OR across `group_id` and AND within a group; quantity comes from `Bill_Of_Materials`, unit from `Materials.Units`, and results dedupe by `material_id`.
- **QR login**: QR text is split on whitespace; only the first two tokens are used as “First Last”. QR flow sets `qr=true` and bypasses `login_required`; scanner polls ~1 Hz with a 10s de‑dupe window.
