# Production Queue and Batch Planning

## Purpose
The dashboard is designed to let schedulers add batches, order work, edit scheduling details, and mark items complete.

## Queue Items (What’s Scheduled)
- Each queue entry represents a module scheduled for production.
- Entries surface the project, house identifier, module number, house type and optional sub-type, planned start date (MM/DD, show year only if different from current year), and current production status.
- Status is displayed as a color-coded badge (planned, panels, magazine, assembly, completed) to communicate lifecycle at a glance.

## Scheduling and Ordering
- Items are ordered in a single, numbered list that defines the production sequence.
- Drag-and-drop reorders items; the new order is saved immediately.
- Multi-select allows reordering a block together; the block keeps internal order when moved.
- Up/down arrows move a single item or the current multi-selection by one position; arrows are disabled when movement is not possible or items are completed.
- The list visually groups items by project and shows a separator when the project changes to reduce scanning fatigue.

## Multi-Selection and Bulk Actions
- Shift-click selects a contiguous range; Ctrl/Command-click toggles individual items.
- Selection persists across automatic refreshes so users can continue a multi-step edit.
- Clicking outside list rows clears selection to reduce accidental bulk actions.

## Assembly Line Assignment
- Each queue item shows line selectors (A/B/C). Switching a line updates the queue item and, if the item is already on an assembly line, it is moved to the first station of the new line.
- Line changes are blocked for completed items to prevent retroactive rework.
- Bulk line change is supported when multiple items are selected.

## Editing Scheduling Details
- Planned start date/time is editable from each item; bulk edit is supported for selected items.
- House sub-type (a variant under a house type) is editable; bulk edit is allowed only when all selected items share the same house type.
- Badges are clickable and visually distinct to make edits discoverable without opening a separate detail view.

## Batch Production Planning
- “Add Production Batch” opens a modal to add multiple modules in one operation.
- The modal loads the latest house types and their module counts to guide accurate batch creation.
- On success, the queue and station views refresh so new batches appear immediately.

## Finishing and Completion
- Each item can be marked complete directly from the queue, as well as from stations where the module is active.
- Completed items are visually de-emphasized (reduced opacity and completed task styling) and are blocked from reordering or line changes.
- A toggle controls whether completed items remain visible in the queue to support either “active-only” or “full-history” scheduling views.

## Deleting from the Schedule
- Items can be deleted with confirmation to prevent accidental removal.
- Bulk deletion is supported for multi-selected items and prompts a stronger confirmation message.

## Station Visibility (Context for Scheduling)
- The dashboard shows stations for panels, magazine, and assembly lines with each module’s current active tasks.
- Panel stations include a daily progress summary for the first set of planned panels (percent complete and time gap vs. plan).
- Station cards include inline “complete” actions to finish a module without leaving the status view.

## Refresh and Feedback UX
- Auto-refresh runs on a short interval, with a manual refresh button for immediate sync.
- A “Last updated” timestamp gives operators confidence about data freshness.
- Loading and error states are displayed inline; on errors during reordering, the list reverts to the previous order to avoid silent data loss.
