# ALT Production Manager (Worker Station Workspace)

This document is a cleaner, implementation-oriented replacement for `docs/PRODUCTION_MANAGER.md`.
It specifies the worker-facing station workspace UX (the “production manager” screen) while
keeping business rules in `docs/PRODUCTION_RULES.md` and structural concepts in
`docs/REBUILD_ALT_MODEL.md`.

---

## 0) Goals (why this doc exists)

- Preserve legacy strengths: station-context UX, auto-focus to active work, W1 manual selection,
  carryovers/backlog visibility, QC/rework overlays, crew/group start, AUX dual-mode.
- Reduce duplication: treat “panel vs module vs auxiliary” as variants of the same
  **Station → Work Item → Task Actions** pattern.
- Keep logic lean: UI orchestrates selection and displays constraints; backend enforces rules.

---

## 1) Core mental model (single abstraction for all stations)

The screen always has:

1. **A selected station** (resolved from a stored “station context”)
2. **A selected work item** (what you’re working on at that station)
3. **A list of tasks** (what can be done, what’s blocked, what’s done)

### 1.1 Station context vs station

- **Station context** is device-level and persisted (this kiosk/tablet is “Panel Line”, “Aux”, etc).
- A context can be:
  - A specific station id (already unambiguous), or
  - A broader context that maps to multiple stations:
    - Panel-line context (choose a specific W station)
    - Auxiliary context (choose a specific AUX station)
    - Assembly-sequence context (same sequence across A/B/C; choose one station)
- When a context is ambiguous, show a station picker modal (selection commits immediately; no “Save”):
  - Panel-line context: list W stations in sequence order; when task definitions load successfully,
    filter out stations with no tasks to avoid dead selections.
  - Auxiliary context: list AUX stations sorted by sequence then name.
  - Assembly-sequence context: list all matching stations across lines, sorted by station id, with a
    prominent line label (A/B/C) before the station name.
  - Preselect the previously saved station if it is still valid for the current context.

### 1.2 Work item types (by station role)

- **Panels (W stations):** a `PanelUnit` (with its parent module context)
- **Assembly stations:** a `WorkUnit` (module)
- **AUX stations:** a module task queue (still module-scope work)
- **Magazine (if used as a station view):** modules in Magazine status (primarily visibility)
- **Rework:** `QCReworkTask` items shown as an overlay list (station-level)

### 1.3 Task runtime states

In UX terms, a task can be:
- **Not started**
- **In progress** (owned by you / owned by another worker / parallel-startable)
- **Paused** (owned by you / owned by another worker)
- **Completed**
- **Skipped (at this station)** with a reason (skip is an exception, not “completion”). Only panel tasks can be skipped.
- **Blocked** (dependencies unmet or task is not allowed for the logged in worker per task_worker_restrictions)

---

## 2) Deterministic page boot sequence (no hidden branching)

1. **Auth gate:** if no worker session exists, redirect to login.
2. **Inactivity logout:** if the worker session is marked “non-permanent”, auto-logout after
   45 seconds without interaction (mouse/touch/scroll/key/click resets the timer).
3. **Resolve station context:**
   - Load station context from local storage.
   - If the context maps to multiple stations, show the station picker modal immediately (see §1.1).
   - If the stored station id is no longer valid, show “no station selected” (do not guess).
4. **Auto-focus to active work (safety feature):**
   - If the worker has no current selection and has an in-progress task, switch to that task’s
     station and preselect its work item.
   - Show a banner explaining the redirect and remember the prior station context so it can be
     restored on “Conclude”.
5. **Load a station snapshot:** queue + rework + QC badge state + selected work item + tasks.

---

## 3) Layout (one workspace, role-specific content)

### Header (always present)

- Worker identity (and quick “Conclude” button to end the session and clear station selection; if
  auto-focus switched stations, restore the prior station context on conclude)
- Current station name + role badge (Panels/Magazine/Assembly/AUX) + line badge (A/B/C when applicable)
- “Change station” affordance
- QC notification badge (opens QC modal)

### Main workspace (always present)

- **Work list pane:** panels/modules/aux items relevant to the station (plus rework banner above it)
- **Task pane:** tasks for the selected work item (plus “other task” affordance where applicable)

Responsive behavior is implementation-defined; the UX must still support:
- Fast switching between “work list” and “task view”
- A clear way to “go back” to the work list when using a single-column layout

---

## 4) Shared interaction rules (applies across station roles)

### 4.1 Work list selection rules

- If only one eligible work item exists, auto-select it.
- If a selected item disappears (advanced, completed, reassigned), clear selection and return to
  the work list (or auto-select the next eligible item when only one remains).
- Always show enough context on each card to prevent mis-work (project/house/module/panel).

### 4.2 Task list composition (three buckets, consistent framing)

The UI uses the same mental grouping everywhere, even if some buckets are empty:

1. **Tasks for this station** (the “normal” list)
2. **Backlog/carryover tasks** (work expected elsewhere, surfaced here as catch-up)
3. **Completed visibility** (shown or hidden depending on station role; see §5)

Ordering rules must respect `docs/PRODUCTION_RULES.md`:
- Panel tasks: panel-defined task list if present; otherwise station sequence then name.
- Tasks without a station assignment never appear in station queues; they only appear in “Other task”.

### 4.3 Action gating (what disables controls)

Start/Resume is disabled when:
- Dependencies are not satisfied (show tooltip/inline reason)
- The task is restricted to other workers (show restriction note)
- The backend rejects due to concurrency rules (UI must surface the rejection clearly)

### 4.4 Actions (consistent semantics)

- **Start:** begin work; backend creates/joins the appropriate task instance and worker participation.
- **Resume:** continues a paused task (same instance).
- **Pause:** requires a reason (predefined reasons can auto-confirm; custom requires confirm).
- **Comment:** template + free text; keep the UX consistent across panel/module/AUX.
- **Skip:** only if skippable; requires a reason; records a station-scoped skip exception.
- **Complete:** finishes the task; closes participations; may trigger advancement per rules.

Crew/group start (when configured):
- Show a group-start affordance for tasks with “regular crew” suggestions.
- Crew modal preselects the regular crew and allows search/add/remove before confirming.

### 4.5 Post-action behavior

After any action, refresh the station snapshot:
- Keep the operator oriented (show a short inline success/error)
- If the work item advanced away from the station, clear selection (don’t leave the user on a dead view)
- If a task was started at a different station (via “Other task”), treat it as active work so that
  auto-focus rules can redirect appropriately

---

## 5) Station role specifics (only the deltas)

### 5.1 Panels line (W stations)

**Work list**
- W1 shows two groups:
  - “Panels available to work” (upcoming panels for the next module)
  - “Panels in progress” (already started in W1)
- W2+ shows panels currently at the station.
- W1 must offer a recommended “next panel” based on planned sequence, but the worker can still pick
  any eligible panel
- W1 supports manual module/panel selection:
  - Module list: Planned/Panels only (exclude Magazine/Assembly/Completed)
  - Panel list: exclude Completed and Consumed

**Task view**
- Show:
  - Tasks at this station
  - Tasks skipped earlier (carryover suggestions, visually distinct)
  - Completed tasks remain visible with a completion badge (operator visibility is valuable on W)

**Navigation**
- In single-column layouts, provide a back affordance to the work list.
- Hide the back affordance when only one panel is available to avoid an extra tap.

### 5.2 Assembly line (module stations)

**Work list**
- Show modules whose current station matches this station.
- If this is the first station of an assembly line, also show Magazine modules eligible to be pulled
  (visually marked as “in Magazine ”).
- Each module card shows: project/house/module, planned line if known, and backlog count.

**Task view**
- Two sections:
  - Eligible tasks for the current station
  - Backlog tasks from earlier stations (visually distinct)
- Default to showing only active statuses (not started / in progress / paused).
- If worker skills/specialty filtering is available, apply it consistently (both lists).

**“Other task” (quick-start)**
- A modal lists startable tasks for the module across stations.
- Exclude completed/skipped/blocked tasks; exclude in-progress tasks when parallel starts are not allowed.
- Starting from this modal uses the task’s assigned station (not necessarily the current station).

### 5.3 AUX stations

- Two lists: “In progress” (max 10) and “Available” (max 10).
- Tasks show status, module context, short description, and dependency state.
- Dual mode (x2):
  - When enabled, starting a pending task attempts to pair one additional matching module
    (same house type/subtype/module number + same task), subject to dependency and restriction checks.
  - UI indicates whether a twin was found and started.
- If another worker owns the active log, show the task as read-only with an explanation.

### 5.4 Magazine station (optional visibility view)

If Magazine is implemented as a worker-facing station view:
- Show modules in Magazine status and the status of their panels.
- Treat this as visibility-first; assembly “pull” remains a first-assembly-station concept.

---

## 6) QC + rework overlays (always visible, never blocking)

### 6.1 QC notifications badge (worker-level)

- A QC alert appears when the worker has active QC failures.
- Clicking opens a modal with:
  - Check name + related task
  - Module/panel context
  - Timestamp, QC inspector, rework id, and rework status
  - Evidence thumbnails (open in a new tab)
- Informational only; does not block task actions.

### 6.2 Rework banner (station-level)

If the station has pending rework:
- Show a banner above the work list with rework items.
- Each item shows check name, module context, optional panel, and notes.
- Background color indicates in-progress/paused.
- If another worker is active, show a hint that you can join.

Actions:
- Start/join, resume, pause (reason), complete (may reopen QC for reinspection).

---

## 7) Persistence (local storage keys)

Persist station context and auto-focus restore state in local storage:
- `selectedStationContext`
- `selectedSpecificStationId`
- `autoFocusPrevStationContext`

Other persistence (e.g., “last selected work item per station”) is optional and should never override
auto-focus safety behavior.
