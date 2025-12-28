# Production Rules Reference (Behavioral)

This document captures the shop-floor production rules in business terms.
It avoids code-level naming and focuses on the behavior the rebuild must preserve.
It complements `docs/REBUILD_SPEC.md`.

---

## 1) Core concepts and statuses

Module plan item statuses:
- Planned
- Panels
- Magazine
- Assembly
- Completed

Panel plan item statuses:
- Planned (or missing entry = not started)
- In Progress
- Completed
- Consumed

Task execution logs:
- Panel tasks and module tasks each have execution logs.
- Statuses include Not Started (implicit), In Progress, Paused, Completed.
- Skips are represented as station-scoped overrides rather than a log status.

---

## 2) Station sequencing and task applicability

Stations:
- Each station has a line type (W, M, A, B, C, or auxiliary) and a sequence order.
- The sequence order defines progression within a line.
- For assembly lines (A/B/C), the first station is the lowest sequence order for that line.

Tasks:
- Tasks are either panel tasks or module tasks.
- Task applicability is filtered by:
  - House type (specific or general)
  - Station sequence order (specific or general)
  - Specialty when a worker specialty is provided (otherwise only general specialty)
- Tasks with no station sequence order are treated as applicable at any station sequence.

Panel-specific task lists:
- A panel definition may provide a whitelist and ordering of applicable tasks.
- If present, that list controls which tasks appear and in what order.
- A parallel list can provide expected minutes aligned to the task list order.

---

## 3) Panel line rules (W line)

### 3.1 W1 start order (next two panels only)

At W1, only one of the next two scheduled panels can be started, unless the panel
is already in progress at W1. The "next two" list is computed as follows:
1) Use the daily schedule stream for W1, which is derived from the global planned
   order of modules and panels. Panels with no tasks still appear as pass-through
   entries. Tasks completed on prior calendar days are excluded from the stream.
2) If the daily schedule yields no candidates, fall back to the global planned
   sequence of modules in Planned/Panels status and take the earliest not-started
   panels for each module (based on defined panel order).

If the upcoming list is empty, W1 start order is not restricted.

### 3.2 Which panel tasks appear at a station

For a given panel at a station, the task list is built by:
- Selecting active panel tasks that match the module house type (or are general),
  and match the station sequence (or are general).
- Filtering by worker specialty if provided.
- Applying the panel's applicable task list if defined.
- Ordering tasks by the panel's list (if defined), otherwise by station sequence and name.

Carryover tasks (optional suggestions):
- If a panel task was skipped at an earlier W station, it can appear as a catch-up
  suggestion at later W stations.
- These tasks are marked as carried over and include the origin station and skip reason.
- Carryovers do not block advancement or auto-advance.

### 3.3 Panel task completion and shared logs

When a panel task is completed:
- All non-completed logs for the same panel/task are completed together.
- Any open pauses for those logs are closed.

### 3.4 Panel advancement at a station

A panel advances when all required tasks for the current station are satisfied:
- A task is satisfied if it is completed or explicitly skipped at that station.
- Specialty filtering is not used for the satisfaction check.

Advancement on the W line:
- Move to the next W station that has applicable tasks for the panel.
- If no such station exists, the panel becomes Completed and the module moves to Magazine.

### 3.5 Auto-advance when a station has no tasks

If a panel has no applicable tasks at the current W station (ignoring specialty):
- The panel auto-advances to the next W station that has tasks.
- If no station has tasks, the panel becomes Completed and the module moves to Magazine.
- If the panel plan item does not exist yet, it is created as In Progress.
- If the module was still Planned, it becomes Panels.

---

## 4) Module line rules (assembly)

### 4.1 Module task applicability

Module tasks can be restricted by applicability lists:
- If there is a task list for (house type, module number, subtype), only those tasks apply.
- Else if there is a task list for (house type, module number, no subtype), only those apply.
- Else all matching tasks apply.

### 4.2 Module status transitions

- Planned -> Panels: when the first panel is started at W1 or auto-advanced.
- Panels -> Magazine: when any panel completes the W line.
- Magazine -> Assembly: when a module task starts at the first station of an assembly line.
- Assembly -> Completed: when there are no further stations with applicable tasks.
- When a module completes, all its panels become Consumed.

### 4.3 Starting module tasks at the first assembly station

When starting a module task:
- Dependencies must be satisfied; invalid dependency configuration blocks the start.
- If a task has an allowed-worker list, only those workers can start it.

When the module is in Magazine and the task starts at the first station of a line:
- The module status becomes Assembly.
- The planned assembly line is set from the station if it was not already set.
- The module current station is set to the first station of the planned line,
  even if the task was started at another station.

### 4.4 Module advancement at a station

There are two modes:
1) Rule-based: if an advance rule exists for the station sequence (scoped by house type/subtype),
   the module advances when all rule trigger tasks are completed anywhere in the module.
   Advancing via a rule auto-pauses any in-progress module tasks at that station.
2) Fallback: the module advances when all required tasks at the station are satisfied
   (completed or explicitly skipped). If the station has no required tasks, it advances immediately.

Advancement:
- Move to the next station in the same line with applicable tasks.
- If none exists, the module becomes Completed and all panels become Consumed.

---

## 5) Station content and queues

W stations:
- Show panels whose current station is the station and whose status is In Progress,
  grouped by module.

Magazine station (M1):
- Shows modules in Magazine status with a list of all panels and their statuses.

Assembly stations (A/B/C):
- Show modules in Assembly status whose current station matches the station.
- Tasks shown at the station respect task applicability rules.
- The first station in a line also shows Magazine modules eligible to be pulled.
  If the first station has no tasks for a module, the next station with tasks is used
  to determine eligibility.

Upcoming modules list:
- A global list ordered by planned sequence.
- Completed modules are excluded unless explicitly requested.

---

## 6) Dependencies, concurrency, skips, permissions

Dependencies:
- Panel task dependencies are evaluated per panel; if parsing fails, the task can still start.
- Module task dependencies are evaluated per module; if parsing fails, the task cannot start.

Concurrency:
- A worker can have only one active non-exempt task (panel or module) at a time.
- Tasks marked as concurrent are exempt from this restriction.

Skips:
- Skipping records a station-scoped override and pauses any active logs for that task.
- Skips count as satisfied for station advancement.

Permissions:
- Module tasks enforce allowed-worker lists when configured.
- Panel tasks do not enforce allowed-worker lists in current behavior.

---

## 7) Auxiliary stations

Auxiliary stations are those marked as auxiliary or with a line type outside W/M/A/B/C.
Rules:
- Only module tasks run at auxiliary stations.
- Dependencies, concurrency, and allowed-worker restrictions apply.
- By default, auxiliary selection targets modules in Planned/Panels status unless overridden.

---

## 8) Edge behaviors to preserve

- W1 gating applies only when the panel is not already in progress at W1.
- If the "upcoming panels" list is empty, W1 start order is not restricted.
- Completing any single panel through W advances its module to Magazine.
- Task completion is shared across workers for the same panel/module task.
- Advancement and auto-advance ignore specialty filtering.
- Tasks without a station sequence apply to any station sequence within their line.
