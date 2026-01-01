# Panel Management Page (Admin)

This document explains the admin screen used to manage panels by housing type and module, and the related modals for task applicability and task durations. It describes the business rules the screen enforces and the UX choices behind the interactions.

## Purpose and Scope

The screen lets an admin:
- Choose a housing type and a module, then view the full list of panels for that selection.
- Organize panels into defined business groups (floor, ceiling, perimeter, interior walls, box beams, other, multiwalls).
- Add new panels or edit existing ones, including optional dimensions and an optional sub-type.
- Control which panel tasks apply to a specific panel (either inline while editing, or in bulk using a matrix modal).
- Maintain production order with sequence numbers and move panels up or down.
- Enter task durations per panel, per station task, in a grid optimized for bulk entry.

## Page Layout and Flow

### Selection controls (housing type and module)
- The screen starts with two selectors: housing type and module.
- The module selector is populated from the chosen housing type and only shows 1..N modules based on that type’s configuration.
- When the housing type changes, the module selection resets to module 1 and any in-progress edits are cleared. This prevents accidental cross-type edits and keeps the selection context consistent.
- Once both selections are valid, the screen loads all panels for that housing type and module (across all sub-types) in a single fetch.

### Status and guidance
- If no housing type is selected, the screen displays an italic guidance message prompting the user to pick one.
- While loading, a soft “loading” indicator appears.
- Errors are shown inline in red to keep attention close to the controls that triggered them.

### Grouped panel list
- Panels are grouped into a fixed set of business groups (floor, ceiling, perimeter, interior walls, box beams, other, multiwalls).
- Within each group, panels are sorted by production sequence number first, then by panel code as a tie-breaker. This keeps the list aligned with the intended station flow while still deterministic for unordered items.
- Each panel row shows:
  - Production order number (or “?” if missing).
  - Panel code.
  - Optional area (m²) and length (m), shown only when valid numeric values exist.
  - Optional sub-type label (highlighted in blue) so users can spot specialized variants while still working in an “all sub-types” list.

### Row actions (move, edit, delete)
- Up/down arrows move a panel within the global sequence for the module. The “up” arrow is disabled for the first item; the “down” arrow is disabled for the last, preventing no-op moves.
- “Edit” opens the add/edit modal with data pre-filled.
- “Delete” asks for confirmation before removing a panel definition, reducing accidental loss.

### Primary actions
- “Add Panel” opens the add/edit modal in a clean state.
- “Applicable Tasks…” opens a matrix modal to manage task applicability across panels.
- “Task Durations…” opens a matrix modal for entering station task durations.
- The two task-related buttons are disabled when there are no panels in the current selection to avoid empty grids and unnecessary requests.

## Add/Edit Panel Modal

### Why a modal
The add/edit flow uses a modal overlay so users can make changes without losing their place in the grouped list. Clicking outside the modal closes it, reinforcing a lightweight, interruptible workflow.

### Required and optional fields
- Panel code is required. Empty values are blocked with a clear error message.
- Panel group is required and defaults to the first group (floor) for consistent data entry.
- Sub-type is optional. A “none/general” option allows panels to be shared across sub-types while still allowing specialization.
- Area (m²) and length (m) are optional, but if provided they must be valid non-negative numbers. The input accepts either dot or comma decimals; commas are normalized to dots to accommodate local typing habits.

### Production order
- The production order field appears only when editing an existing panel. This reduces confusion during creation and makes it clear that reordering is an advanced action.
- The helper text states the number must be unique within the module, reinforcing the business rule used for ordering.

### Task applicability checkboxes
- The modal includes a list of station tasks that are eligible for panels in the selected housing type. This list is filtered to “panel tasks” and includes both housing-type-specific tasks and global tasks.
- Tasks are ordered by station sequence (if defined) and then by name to align with the factory flow.
- By default, all tasks apply. The UI communicates this clearly: users uncheck tasks that do not apply to this panel.
- The system stores only exclusions. If all tasks apply, it saves a null value rather than an explicit list. This keeps the data model compact and expresses “use the default behavior.”

### Saving and validation behavior
- The modal blocks save on invalid numeric input (non-numeric or negative values) and displays a business-friendly error message.
- On save, the panel is created or updated, and the list refreshes to reflect current ordering and grouping.
- Cancel resets the modal and clears any in-progress edits or exclusions so the next open starts cleanly.

## Applicable Tasks Modal (Matrix)

### Purpose
This modal is designed for bulk editing of task applicability across multiple panels, which is faster than opening each panel one by one.

### Layout and interaction
- Tasks are listed as rows; panels are columns.
- The task column is sticky so task names remain visible while horizontally scrolling.
- Each cell is a color-coded toggle: green means the task applies, red means it does not. Clicking toggles the state.
- This grid is sized to remain usable in large datasets: the modal uses a wide layout and an internal scroll container, keeping the header and task column visible.

### Business rules applied
- The candidate task list matches the same “panel task” filtering and housing type scoping used in the add/edit modal.
- If a panel has no stored applicability list, it is treated as “all tasks apply.”
- Saving writes applicability per panel. If all tasks apply, the panel stores a null value; otherwise it stores the explicit list. This keeps the data consistent with the default behavior used elsewhere.

## Task Durations Modal (Matrix)

### Purpose
This modal captures per-panel durations for each station task, enabling production time planning and throughput analysis.

### Layout and interaction
- The layout mirrors the applicability matrix: tasks as rows, panels as columns, sticky task column, and horizontal scrolling.
- Cells show numeric inputs in minutes for applicable tasks and a muted “N/A” badge for non-applicable tasks. This avoids accidental entry where a task does not apply.
- Numeric inputs are constrained to non-negative integers (minutes). Empty input clears the value.

### Business rules applied
- The task list and applicability rules match the other flows (panel tasks + global tasks, ordered by station sequence then name).
- Durations are stored in the same order as the applicable task list for each panel. This ensures the task duration array aligns with the panel’s applicable task order, even when some tasks are excluded.
- When a duration is missing or invalid, it is stored as null to represent “not defined,” not zero.

## Data Consistency and Refresh Strategy

- After add/edit/delete/move operations, the panel list is reloaded for the active housing type and module to prevent stale order or grouping.
- After saving from the applicability or duration modals, the panel list refreshes so the main screen remains in sync with the modal changes.
- If task definitions fail to load, core panel management still works; only the task selection experience is impacted. This design keeps essential operations available even when auxiliary data is missing.

## UX Rationale Summary

- Lightweight modal overlays keep users focused on the current context without navigating away.
- Disabled actions when prerequisites aren’t met (no housing type, no panels) reduce confusion and prevent empty workflows.
- Inline validation and explicit error messages protect data quality at the point of entry.
- Sorting by production order and grouping by business categories mirrors shop-floor thinking and improves scannability.
- Matrix-based modals are intentionally used for bulk operations where row-by-row editing would be too slow.
