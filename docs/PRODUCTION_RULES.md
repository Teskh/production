# Production Rules Reference (Behavioral, Alt Model)

This document captures the shop-floor production rules in business terms.
It mirrors `docs/PRODUCTION_RULES.md` but aligns with `docs/REBUILD_ALT_MODEL.md`.
It avoids code-level naming and focuses on behavior the rebuild must preserve.

---

## 1) Core concepts and statuses

Work units (modules) statuses:
- Planned
- Panels
- Magazine
- Assembly
- Completed

Panel units statuses:
- Planned (or missing entry = not started)
- In Progress
- Completed
- Consumed

Task execution:
- Tasks are represented by a single TaskInstance with per-worker TaskParticipation.
- TaskInstance statuses include Not Started (implicit), In Progress, Paused, Completed.
- Skips are represented as TaskException(type=Skip) rather than a task status.

---

## 2) Station sequencing and task applicability

Stations:
- Each station has a role (Panels, Magazine, Assembly, or AUX) and a sequence order.
- The sequence order defines progression within a line.
- Assembly stations also carry a line type label (1, 2, 3).
- AUX stations do not participate in the main flow.

Tasks:
- Tasks are panel-scope or module-scope.
- Task applicability is resolved via TaskApplicability with most-specific-wins rules.
- If no scoped applicability row matches, the task applies and uses `TaskDefinition.default_station_sequence`.
- Tasks require a station_sequence_order to appear in a station queue.
- Tasks with no station_sequence_order are treated as "unscheduled" and appear only in the
  "Other tasks" picker.

Panel-specific task lists:
- A panel definition may provide a whitelist and ordering of applicable tasks.
- If present, that list controls which tasks appear and in what order.
- A parallel list can provide expected minutes aligned to the task list order.

---

## 3) Panel line rules (W line)

### 3.1 W1 selection behavior

At W1:
- The station UI offers a recommended "next panel" based on planned sequence.
- The worker can manually select any eligible panel from the plan list.

### 3.2 Which panel tasks appear at a station

For a given panel at a station, the task list is built by:
- Selecting active panel tasks that match the module house type (or are general),
  and match the station sequence (required).
- Filtering by worker skills when a worker is provided (per TaskSkillRequirement).
- Applying the panel's applicable task list if defined.
- Ordering tasks by the panel's list (if defined), otherwise by station sequence and name.

Carryover tasks (optional suggestions):
- If a panel task was skipped at an earlier W station, it can appear as a catch-up
  suggestion at later W stations.
- These tasks are marked as carried over and include the origin station and skip reason.
- Carryovers do not block advancement or auto-advance.

### 3.3 Panel task completion and shared participation

When a panel task is completed:
- The TaskInstance is completed once, and all active TaskParticipations are closed.
- Any open pauses for the TaskInstance are closed.

### 3.4 Panel advancement at a station

A panel advances when all required tasks for the current station are satisfied:
- A task is satisfied if it is completed or explicitly skipped at that station.

Advancement on the W line:
- Move to the next W station that has applicable tasks for the panel.
- If no such station exists, the panel becomes Completed and the module moves to Magazine.

### 3.5 Auto-advance when a station has no tasks

If a panel has no applicable tasks at the current W station:
- The panel auto-advances to the next W station that has tasks.
- If no station has tasks, the panel becomes Completed and the module moves to Magazine.
- If the panel unit does not exist yet, it is created as In Progress.
- If the module was still Planned, it becomes Panels.

---

## 4) Module line rules (assembly)

### 4.1 Module task applicability

Module tasks can be restricted by applicability lists:
- TaskApplicability rows can scope tasks by house type, module number, subtype, and station.
- Most-specific-wins resolution applies (panel-specific scope is ignored for module tasks).

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

Modules advance only via trigger tasks:
- Any applicable module task marked as an advance trigger is sufficient to advance.
- Stations must provide at least one applicable trigger task to allow advancement.

Advancing:
- Auto-pause any in-progress tasks at the current station (reason: "Auto-pausa por avance").
- Move to the next station in the same line with applicable tasks.
- If none exists, the module becomes Completed and all panels become Consumed.

---

## 5) Station content and queues

Panels stations:
- Show panels whose current station is the station and whose status is In Progress,
  grouped by module.

Magazine station:
- Shows modules in Magazine status with a list of all panels and their statuses.

Assembly stations (line 1/2/3):
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
- Panel task dependencies are evaluated per panel unit; parsing failures are treated as blocked.
- Module task dependencies are evaluated per module unit; parsing failures are treated as blocked.

Concurrency:
- A worker can have only one active non-exempt task at a time.
- Tasks marked as concurrent are exempt from this restriction.

Skips:
- Skipping records a station-scoped TaskException(type=Skip) and a reason.
- Skips pause any active work on that task.
- Skips count as satisfied for panel advancement; module advancement requires a trigger task.

Permissions:
- Allowed-worker restrictions are enforced uniformly for panel and module tasks when configured.
- Regular crew lists are UI suggestions only; they do not override concurrency or allowed-worker rules.

---

## 7) Auxiliary stations

Auxiliary stations are those with role=AUX.
Rules:
- Only module-scope tasks run at auxiliary stations.
- Dependencies, concurrency, and allowed-worker restrictions apply.
- Auxiliary work does not advance module current station or status.
