# SCP – Alternative Data Model (Revised Proposal)

Goal: preserve current behavior while reducing special cases and unifying parallel concepts. This is a structural sketch intended to guide a rebuild.

---

## 1) Core entities

### 1.1 Work hierarchy (the product plan)

`WorkOrder`
- id
- project_name
- house_type_id
- sub_type_id (nullable)
- planned_sequence (global ordering)
- planned_assembly_line (A | B | C, nullable)

Notes:
- WorkOrder is a grouping container for modules; it does not carry production state.
- Status and current position are tracked at the WorkUnit level.
- If you need "WorkOrder status" for display, derive it from its WorkUnits.

`WorkUnit` (module)
- id
- work_order_id
- module_number (1-based within the work order)
- status (Planned | Panels | Magazine | Assembly | Completed)
- current_station_id (nullable)

Status semantics (preserved from current system):
- **Planned**: not yet started
- **Panels**: first panel task started at W1
- **Magazine**: any panel for this module completed the W line
- **Assembly**: module task started at first station of an assembly line
- **Completed**: module advanced past last applicable assembly station

`PanelUnit`
- id
- work_unit_id
- panel_definition_id
- status (Planned | InProgress | Completed | Consumed)
- current_station_id (nullable)

Status semantics:
- **Planned**: not yet started (or no row exists)
- **InProgress**: started at W1, moving through W line
- **Completed**: finished W line, waiting in magazine
- **Consumed**: parent module completed assembly

### 1.2 Product definitions

`HouseType`
- id
- name
- number_of_modules

`HouseSubType`
- id
- house_type_id
- name

`PanelDefinition`
- id
- house_type_id
- module_sequence_number
- sub_type_id (nullable)
- group (enum: Paneles de Piso | Paneles de Cielo | Paneles Perimetrales | Tabiques Interiores | Vigas Cajón | Otros | Multiwalls)
- panel_code
- panel_area (nullable, m²)
- panel_length_m (nullable, linear meters)
- applicable_task_ids (json array, nullable — whitelist)
- task_durations_json (nullable — per-task expected minutes)

`HouseParameter`
- id
- name
- unit (nullable)

`HouseParameterValue`
- id
- house_type_id
- parameter_id
- module_sequence_number
- sub_type_id (nullable)
- value (numeric)

### 1.3 Stations

`Station`
- id (autoincrement integer)
- name
- role (Panels | Magazine | Assembly | AUX)
- line_type (1 | 2 | 3, nullable; used only when role = Assembly)
- sequence_order (integer, nullable for AUX stations)

Notes:
- Stations are kept simple. No graph abstraction.
- Panels flow by `role = Panels` and ascending `sequence_order`.
- Magazine is a single station in the flow with `role = Magazine`.
- Assembly flow uses `role = Assembly` + same `line_type` + ascending `sequence_order`.
- AUX stations have `sequence_order = NULL` and do not participate in linear flow.

**Advancement logic (in code, not data):**

```python
def next_station(current_station):
    """Find the next station in the same line with tasks for this work unit."""
    if current_station.role == "Assembly":
        return Station.query.filter(
            Station.role == "Assembly",
            Station.line_type == current_station.line_type,
            Station.sequence_order > current_station.sequence_order,
        ).order_by(Station.sequence_order).first()
    return Station.query.filter(
        Station.role == current_station.role,
        Station.sequence_order > current_station.sequence_order,
    ).order_by(Station.sequence_order).first()
```

**Status change triggers (event-driven, in code):**

| Event | Condition | Status change |
|-------|-----------|---------------|
| Panel task started | station = W1, module.status = Planned | module.status → Panels |
| Panel advances | no next W station | panel.status → Completed, module.status → Magazine |
| Module task started | station.role = Assembly, station.sequence_order = 11 | module.status → Assembly |
| Module advances | no next station in assembly line | module.status → Completed, all panels → Consumed |

### 1.4 Tasks and applicability

`TaskDefinition`
- id
- name
- scope (panel | module)
- active (boolean)
- skippable (boolean)
- concurrent_allowed (boolean)
- advance_trigger (boolean, module-only; true advances the module on completion)
- dependencies_json (list of task_definition_ids)

`TaskApplicability`
- id
- task_definition_id
- house_type_id (nullable)
- sub_type_id (nullable)
- module_number (nullable)
- panel_definition_id (nullable)
- applies (boolean, default true)
- station_sequence_order (nullable)

Notes:
- `applies = false` explicitly marks the task as not applicable for the matched scope and stops fallback to broader rules.
- `station_sequence_order` is required for station-bound tasks. If it is NULL, the task is treated as "unscheduled" and appears only in the "Other tasks" picker, not in station queues.
- A row with all scope fields NULL is the task definition's default recommended station sequence (and applies everywhere unless overridden).

Resolution order (most specific wins):
1. panel_definition_id
2. house_type_id + module_number (sub_type_id optional; prefer non-null sub_type_id when both match)
3. house_type_id (sub_type_id optional; prefer non-null sub_type_id when both match)
4. default row (all scope fields NULL)
5. (no rows) → task not applicable

If the winning row has `applies = false`, the task is not applicable at that scope. If `applies = true`, use that row's `station_sequence_order` (NULL means unscheduled).

`TaskExpectedDuration`
- id
- task_definition_id
- house_type_id (nullable)
- sub_type_id (nullable)
- module_number (nullable)
- panel_definition_id (nullable)
- expected_minutes

### 1.5 Workers and skills

`Worker`
- id
- first_name
- last_name
- pin (4-digit, nullable)
- login_required (boolean)
- active (boolean)
- assigned_station_ids (json array, nullable)
- supervisor_id (nullable, FK to AdminUser)

`Skill`
- id
- name

`WorkerSkill`
- worker_id
- skill_id

`TaskSkillRequirement`
- task_definition_id
- skill_id

`TaskWorkerRestriction`
- id
- task_definition_id
- worker_id
- restriction_type (allowed | regular_crew)

Notes:
- `allowed`: only these workers can perform the task
- `regular_crew`: "favorites" list for group starts. The crew picker preselects these
  workers so one worker can start a group task in a few clicks; workers can be
  toggled on/off before starting. No logs/participations are created until start.

### 1.6 Execution (unified model)

`TaskInstance`
- id
- task_definition_id
- scope (panel | module)
- work_unit_id
- panel_unit_id (nullable, required when scope=panel)
- station_id (where work is performed)
- status (NotStarted | InProgress | Paused | Completed | Skipped)
- started_at (nullable)
- completed_at (nullable)
- notes (text, nullable)

`TaskParticipation`
- id
- task_instance_id
- worker_id
- joined_at
- left_at (nullable)

`TaskPause`
- id
- task_instance_id
- reason_id (nullable, FK to PauseReason)
- reason_text (nullable)
- paused_at
- resumed_at (nullable)

`TaskException`
- id
- task_definition_id
- scope (panel | module)
- work_unit_id
- panel_unit_id (nullable)
- station_id (where the exception was created)
- exception_type (Skip | Carryover)
- reason_text (nullable)
- created_by_worker_id
- created_at

Notes:
- **Skip**: task treated as satisfied at this station; counts toward advancement.
- **Carryover**: task was skipped at an earlier station and is surfaced as optional catch-up work at downstream stations.

### 1.7 Man-hours calculation

The system must accurately track worker time investment per task, accounting for pauses.

**Definitions:**
- **Task duration** = `completed_at - started_at` (wall-clock time)
- **Task work time** = task duration − total pause time
- **Worker participation time** = `left_at - joined_at` per `TaskParticipation` row
- **Worker work time** = participation time − (pause time while participating)

**Pause interaction with participations:**

When a task is paused:
1. Create a `TaskPause` row with `paused_at = now()`.
2. All active participations (where `left_at IS NULL`) remain active — workers are considered "on pause" with the task.

When a task is resumed:
1. Set `resumed_at = now()` on the `TaskPause` row.
2. Participations remain unchanged.

When a worker leaves mid-task (optional feature):
1. Set `left_at = now()` on their `TaskParticipation` row.
2. They are excluded from subsequent pause/resume cycles.

**Calculating man-hours for a completed task:**

```
For each TaskParticipation P:
    participation_start = P.joined_at
    participation_end   = P.left_at ?? TaskInstance.completed_at

    pause_overlap = 0
    For each TaskPause T where T.resumed_at IS NOT NULL:
        pause_start = max(T.paused_at, participation_start)
        pause_end   = min(T.resumed_at, participation_end)
        if pause_end > pause_start:
            pause_overlap += (pause_end - pause_start)

    worker_work_minutes = (participation_end - participation_start) - pause_overlap

Total man-hours = sum(worker_work_minutes) / 60
```

**Shared completion semantics (preserved):**
- When any worker finishes a task, `TaskInstance.completed_at` is set.
- All participations without `left_at` get `left_at = completed_at`.
- This matches current behavior where one worker finishing closes all parallel logs.

### 1.8 Advancement

Advancement logic:
- Panels: advance when all applicable tasks at the station are Completed or Skipped.
- Modules: advance when any applicable module task with `advance_trigger=true` is Completed.
- Stations must provide at least one applicable trigger task for modules to advance.
- On advancement:
  - Auto-pause any InProgress tasks at the current station (reason: "Auto-pausa por avance").
  - Find next station via `next_station()` logic, skipping stations with no applicable tasks.
  - Update `current_station_id` on the WorkUnit or PanelUnit.
  - If no next station exists: mark Completed (or Consumed for panels).

### 1.9 Configuration entities

`PauseReason`
- id
- name
- applicable_station_ids (json array, nullable — null means all stations)
- active (boolean)

`CommentTemplate`
- id
- text
- applicable_station_ids (json array, nullable)
- active (boolean)

`AdminUser`
- id
- first_name
- last_name
- pin
- role (Supervisor | Admin | SysAdmin | QC)

### 1.10 QC system

`QCCheckDefinition`
- id
- name
- active (boolean)
- guidance_text (nullable)
- version (integer, for tracking changes)
- kind (triggered | manual_template)
- created_by_user_id (nullable, for manual templates)
- archived_at (nullable)

`QCTrigger`
- id
- check_definition_id
- event_type (task_completed | enter_station)
- params_json (e.g., `{"task_definition_ids": [1,2]}` or `{"station_ids": ["W3","A2"]}`)
- sampling_rate (0.0–1.0, default 1.0)
- sampling_autotune (boolean)
- sampling_step (default 0.2)

`QCApplicability`
- id
- check_definition_id
- house_type_id (nullable)
- sub_type_id (nullable)
- module_number (nullable)
- panel_definition_id (nullable)
- force_required (boolean)
- effective_from (date, nullable)
- effective_to (date, nullable)

`QCCheckInstance`
- id
- check_definition_id (nullable)
- origin (triggered | manual)
- ad_hoc_title (nullable)
- ad_hoc_guidance (nullable)
- scope (panel | module)
- work_unit_id
- panel_unit_id (nullable)
- related_task_instance_id (nullable)
- station_id (nullable)
- status (Open | Closed)
- sampling_selected (boolean)
- sampling_probability (float)
- opened_by_user_id (nullable)
- opened_at
- closed_at (nullable)

`QCExecution`
- id
- check_instance_id
- outcome (Pass | Fail | Waive | Skip)
- notes (nullable)
- measurement_json (nullable)
- performed_by_user_id
- performed_at

`QCEvidence`
- id
- execution_id
- media_asset_id
- captured_at

`MediaAsset`
- id
- storage_key
- mime_type
- size_bytes
- width (nullable)
- height (nullable)
- watermark_text (nullable)
- created_at

`QCReworkTask`
- id
- check_instance_id
- description
- status (Open | InProgress | Done | Canceled)
- created_at

`QCNotification`
- id
- worker_id
- rework_task_id
- status (Active | Dismissed)
- created_at
- seen_at (nullable)

Notes:
- `QCTrigger` rows apply only to `QCCheckDefinition.kind = triggered`.
- Manual QC entries are created as `QCCheckInstance` rows with `origin = manual`.
  - If created from a manual template, set `check_definition_id` and leave `ad_hoc_*` null.
  - If fully ad hoc, leave `check_definition_id` null and require `ad_hoc_title`.
  - Manual checks bypass sampling: set `sampling_selected = true` and `sampling_probability = 1.0`.
- `opened_by_user_id` records the QC user for manual checks; triggered checks can leave it null or set to a system user.
- `QCApplicability` can still scope manual templates; ad hoc checks bypass applicability filters.

---

## 2) Key behavior mapping

### 2.1 Panel vs module flow
- Both use `TaskInstance`; `scope` field distinguishes them.
- Panel tasks set `panel_unit_id`; module tasks leave it null.
- Same dependency, concurrency, pause, completion logic applies to both.
- AUX stations are just stations with `role=AUX`; their tasks don't affect module advancement.

### 2.2 Crew logging
- Starting a task creates one `TaskInstance` and one `TaskParticipation` per worker.
- Man-hours are calculated per the formula in §1.7 (participation time minus pause overlap).
- Shared completion: finishing sets `completed_at` on the instance and `left_at` on all open participations.

### 2.3 Station flow
- Panels flow by `role=Panels` + ascending `sequence_order`.
- Assembly flow uses `role=Assembly` + same `line_type` + ascending `sequence_order`.
- Magazine is a single station with `role=Magazine`.
- Next station is the next applicable station in the same flow.
- Stations with no applicable tasks are skipped automatically.
- Status changes are event-driven (see §1.3 table).

### 2.4 Advancement
- Panels advance when all applicable tasks at the station are Completed or Skipped.
- Modules advance when any applicable module task with `advance_trigger=true` is Completed.
- Auto-pause active tasks at current station.
- Find next station, skipping those with no tasks.
- If no next station: mark work unit/panel as Completed/Consumed.

### 2.5 Dependencies and concurrency
- `TaskDefinition.dependencies_json` lists prerequisite task_definition_ids.
- A task is blocked until all dependencies have Completed instances for the same work_unit (and panel_unit if panel-scoped).
- Invalid or unparsable dependency config blocks the task start (fail closed for both panel and module tasks).
- A worker cannot start a non-concurrent task if they have another non-concurrent task InProgress.
- Allowed-worker restrictions are enforced for both panel and module tasks when configured; `regular_crew` is a UI-only suggestion list.

### 2.6 Skips and carryovers
- Skipping creates a `TaskException(type=Skip)` at the current station.
- Skipping pauses any in-progress work on that task instance and records a `TaskPause` reason like "Skipped override: ...".
- Skipped tasks count as satisfied for panel advancement; module advancement requires trigger task completion.
- Downstream stations surface skipped tasks as carryover opportunities (computed at runtime, not stored).
- Completing a carryover task creates a normal `TaskInstance` at the downstream station.
- Carryovers are optional and do not block auto-advance when a station has no required tasks.

### 2.7 W1 selection behavior
- W1 offers a recommended next panel based on planned sequence.
- Workers can manually select any eligible panel from the plan list (no "next two only" gating).

### 2.8 Performance and caching

For rebuild performance, cache task *templates* (applicability + expected durations) per panel definition and station sequence on the server, and invalidate only when task definitions or applicability/duration data change. Keep task status live from `TaskInstance`/`TaskException` data rather than caching status, and support a batched summary endpoint so UIs can request multiple station summaries in one call instead of recomputing the schedule for each station separately.

---

## 3) Migration from current schema

### 3.1 Entity mappings

| Current | New |
|---------|-----|
| `ModuleProductionPlan` | `WorkOrder` + `WorkUnit` (one WorkUnit per module) |
| `PanelProductionPlan` | `PanelUnit` |
| `Stations` | `Station` (new IDs, role/line_type reshaped) |
| `TaskDefinitions` | `TaskDefinition` + `TaskApplicability` |
| `TaskDefinitions.station_sequence_order` | `TaskApplicability.station_sequence_order` (default row) |
| `TaskDefinitions.specialty_id` | `TaskSkillRequirement` |
| `TaskLogs` | `TaskInstance(scope=module)` + `TaskParticipation` |
| `PanelTaskLogs` | `TaskInstance(scope=panel)` + `TaskParticipation` |
| `TaskPauses` | `TaskPause` |
| `TaskOverrides` | `TaskException` |
| `Specialties` | `Skill` |
| `WorkerSpecialties` | `WorkerSkill` |
| `TaskDefinitionAllowedWorkers` | `TaskWorkerRestriction(type=allowed)` |
| `TaskDefinitionRegularCrew` | `TaskWorkerRestriction(type=regular_crew)` |
| `ModuleTaskApplicability` | `TaskApplicability` rows |
| `ModuleTaskExpectedDurations` | `TaskExpectedDuration` |
| `PanelDefinitions.task_length` | `TaskExpectedDuration` rows |
| `PauseDefinitions` | `PauseReason` |
| `NoteDefinitions` | `CommentTemplate` |
| `AdminTeam` | `AdminUser` |
| `HouseTypes` | `HouseType` |
| `HouseSubType` | `HouseSubType` |
| `HouseParameters` | `HouseParameter` |
| `HouseTypeParameters` | `HouseParameterValue` |
| `PanelDefinitions` | `PanelDefinition` |
| `QCCheckDefinitions` | `QCCheckDefinition` |
| `QCCheckTriggers` | `QCTrigger` |
| `QCCheckApplicabilityRules` | `QCApplicability` |
| `QCPlanCheckInstances` | `QCCheckInstance` |
| `QCCheckExecutions` | `QCExecution` |
| `QCEvidenceMedia` | `QCEvidence` + `MediaAsset` |
| `QCMedia` | `MediaAsset` (with link from `QCCheckDefinition`) |
| `QCReworkTasks` | `QCReworkTask` |
| `WorkerQCNotifications` | `QCNotification` |
| `ReworkTaskLogs` | `TaskInstance` with a flag or separate `ReworkExecution` table |

### 3.2 Data migration steps

1. **Migrate stations**
   - Create `Station` rows using the new role/line_type model (Panels, Magazine, Assembly + line 1/2/3, AUX).
   - AUX stations are those with `sequence_order IS NULL`.

2. **Migrate task definitions**
   - Copy `TaskDefinitions` to `TaskDefinition`.
   - For each task's `station_sequence_order`, create a default `TaskApplicability` row (all scope fields NULL, `applies = true`).
   - Migrate `specialty_id` to `TaskSkillRequirement` rows.

3. **Migrate work orders and units**
   - Group `ModuleProductionPlan` rows by `(project_name, house_identifier)` to create `WorkOrder` rows.
   - Create one `WorkUnit` per `ModuleProductionPlan` row, linking to its WorkOrder.
   - Copy status and current_station to WorkUnit.

4. **Migrate execution logs**
   - For each `TaskLogs` row, create a `TaskInstance(scope=module)` and a `TaskParticipation`.
   - For each `PanelTaskLogs` row, create a `TaskInstance(scope=panel)` and a `TaskParticipation`.
   - Migrate `TaskPauses` with FK updates.

5. **Migrate overrides to exceptions**
   - For each `TaskOverrides` row, create a `TaskException(type=Skip)`.
   - Carryovers are computed at runtime (not stored).

6. **Migrate workers and skills**
   - Copy `Workers` to `Worker`.
   - Copy `Specialties` to `Skill`.
   - Copy `WorkerSpecialties` to `WorkerSkill`.
   - Migrate `TaskDefinitionAllowedWorkers` and `TaskDefinitionRegularCrew` to `TaskWorkerRestriction`.

7. **Migrate configuration**
   - Copy `PauseDefinitions` to `PauseReason`, converting `stations` CSV to JSON array.
   - Copy `NoteDefinitions` to `CommentTemplate`, converting `stations` CSV to JSON array.

8. **Migrate QC data**
   - Direct copy for most QC tables with FK updates.
   - Split `QCEvidenceMedia` into `QCEvidence` + `MediaAsset`.

### 3.3 Validation queries

After migration, verify:
- All work units have correct status based on their task completion state.
- Task applicability coverage: all active tasks have at least one applicability rule.
- Participation counts match original log counts.
- Station sequence_order values are consistent within each flow (Panels, Magazine, Assembly line 1/2/3).

---

## 4) Simplifications achieved

| Current complexity | New approach |
|-------------------|--------------|
| Separate `TaskLogs` + `PanelTaskLogs` tables | Unified `TaskInstance` with scope field |
| Parallel logs per worker, shared completion | `TaskParticipation` rows, single `TaskInstance` |
| Implicit carryover logic in queries | Explicit `TaskException(type=Skip)`, carryovers computed at runtime |
| `TaskOverrides` with implicit skip semantics | `TaskException(type=Skip)` with clear meaning |
| Specialty as nullable FK on task | `TaskSkillRequirement` join table |
| Allowed workers + regular crew as separate tables | Unified `TaskWorkerRestriction` with type |
| Station-scoped pause/note definitions via CSV | JSON array `applicable_station_ids` |
| Status + current_station on both plan levels | Status only on WorkUnit/PanelUnit (WorkOrder is just a container) |

---

## 5) Behavioral requirements migrated from REBUILD_SPEC.md

These are behavior and UX requirements from the legacy spec that are not captured elsewhere in this model. Where they conflict with the sections above, the model above wins.

### 5.1 Product scope and roles
- SCP covers worker station execution, admin configuration/history, QC workflows, and auxiliary stations.
- Roles: Worker, Supervisor/Admin/SysAdmin, Control de Calidad.
- Admin auth uses AdminUser first+last+pin; legacy SysAdmin uses hardcoded credentials (replace in rebuild).
- Worker auth: name list plus PIN; name-only allowed when qr=true or login_required=0; default PIN "1111" triggers require_pin_change.
- Legacy access control is UI-gated and most APIs are unauthenticated; rebuild should enforce auth.

### 5.2 Station context and login UX
- Station context is persisted in localStorage keys: selectedStationContext, selectedSpecificStationId, autoFocusPrevStationContext.
- If a context maps to multiple stations, show a modal station picker; selection commits immediately.
- Login screen shows a read-only station schedule preview for the selected context.
- Auto-focus: if worker has an InProgress task, redirect to that station and pre-select module/panel; latest started task wins (panel wins ties).

### 5.3 Worker station UI and task actions
- Actions: start, pause (reason required), resume, finish (optional notes/templates), skip (reason required).
- Pause reasons and comment templates are station-scoped; predefined pause reasons can auto-confirm.
- Crew selection modal is used for group starts; regular crew is a "favorites" list
  that preselects workers to minimize clicks (workers can be toggled on/off).
  No logs/participations are created until the task is started.
- Manual module/panel selector is available for items not listed in the queue.
- Quick-start "other task" modal surfaces startable tasks from other stations plus backlog tasks; hides completed/skipped/blocked/in-progress tasks when concurrency disallows; starts via normal start endpoint with station_start set.

### 5.4 Station queues and daily schedule
- W stations show panels whose current station matches and status is InProgress, grouped by module.
- Magazine shows modules in Magazine status with a list of panels and their statuses.
- Assembly stations show modules in Assembly status at that station; first station also shows Magazine modules eligible to pull.
- Upcoming modules list is ordered by planned sequence and excludes Completed items.
- Daily schedule stream (if kept) iterates planned modules and panel order, includes placeholder rows when a panel has no tasks at that station, and excludes tasks completed on prior calendar days.
- W stations return panels_passed_today_count/list/area_sum for daily summaries.

### 5.5 Task listing and sorting
- Panel task order: panel-defined list if present, otherwise station sequence then name.
- Module task lists default to TaskDefinition.name ordering when otherwise unspecified.
- "Other task" modal sorts by station name, scope, task name; backlog tasks ordered by planned_sequence then name.

### 5.6 Dependencies, permissions, and specialty
- Dependencies block starts when prerequisites are not completed.
- Legacy: module dependency parse failures block start; panel dependency parse failures allow start.
- Allowed-worker restriction enforced for module tasks; legacy panel tasks do not enforce.
- Legacy specialty filtering: panel tasks filtered by worker's first specialty; module tasks not filtered.
- Preferred: unify via TaskSkillRequirement for both panel and module tasks.

### 5.7 QC workflows and sampling
- Trigger types: task_completed (panel or module) and enter_station.
- Applicability rules match by house type, module number, and subtype; higher specificity wins.
- Manual QC checks are created directly by QC staff against a module/panel (optional station context).
  - If created from a manual template, it uses `QCCheckDefinition.kind = manual_template`.
  - If fully ad hoc, it uses `QCCheckInstance.ad_hoc_title` and no definition.
  - Manual checks bypass triggers and sampling but still allow evidence and rework tasks.
- Deterministic sampling seed: sha256("{plan_id}:{check_definition_id}:{trigger_event_id}")[:16].
- Sampling uses current rate if present; skipped samples still create instances with status=skipped.
- Adaptive sampling: fail sets current rate to 1.0; pass decreases by sampling_step but not below base rate.
- Fail creates QCReworkTask (status Open) and QCNotification for the original worker; pass/waive/skip closes the instance and auto-completes open rework tasks.
- Notifications feed returns active failures within 36 hours unless rework is done or canceled.
- Evidence capture supports image/video upload; camera requires secure context; watermark includes module/panel/check + timestamp.

### 5.8 Auxiliary stations
- Aux stations are those with role=AUX.
- Aux tasks are module-scope and do not advance module status or current station.
- Eligible statuses default to Planned and Panels (configurable).
- Pending tasks are applicable definitions minus completed/skipped tasks.
- Dual-mode pairing can auto-pair one additional identical module (same house_type/module_number/sub_type) without existing logs for that task; dependency checks still apply.

### 5.9 Reporting and analytics
- Task analysis: filters by house type/panel/task/station/worker/date; task mode returns per log durations; station/panel modes aggregate per plan; expected minutes sourced from panel definition task durations.
- Panel linear meters: uses completed W-station panel tasks; work time excludes pause minutes; optional outlier filter by ratio; compute avg_time and lm_per_min.
- Station panels finished: include completed tasks, skips, and pass-through panels; grouped by house/module/panel with time summaries.
- Ex-post notes append to all task logs for a panel (store as appended text on TaskInstance notes).
- Export endpoints generate XLSX from the same report payloads.
- Anomalies/backlog tasks: unfinished tasks (expected by station) and misplaced tasks (logged at wrong station) can be surfaced in station overviews when enabled.

### 5.10 Planning, reorder, timebase, and login behavior
- Plan generation: planned_sequence appends from max; modules per house inserted in descending module_number; planned_start_datetime increments +1h; planned line cycles A/B/C; house_identifier_base accepted with optional collision checks.
- Reorder rewrites planned_sequence to 1..N in the provided order (no concurrency guard).
- "Today" uses server local midnight for daily schedule and reports; station panels finished uses 08:20 as day start for idle/overtime summaries; QC timestamps use server time.
- Workers without login_permanance are auto-logged out after 45s inactivity.
- QR login uses first two whitespace tokens as first/last name; scanner polls about 1 Hz with a 10s de-dupe window.
