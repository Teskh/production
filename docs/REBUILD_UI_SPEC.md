# SCP - UI Rebuild Guide (Pages + Layout)

This document describes the UI pages that must be rebuilt. It focuses on page layout,
page responsibilities, and explicit interaction patterns. It avoids routes, file names,
and implementation details.

## 1) Navigation overview (role-based)

- Entry starts at the login page.
- After login, users land on a role-appropriate workspace:
  - Workers -> station workspace
  - QC -> QC dashboard
  - Admin roles -> admin dashboard
- QC pages link to each other and provide a direct way back to the login screen.
- Utility pages (day summary and general overview) are accessed outside the primary navigation.

## 2) Login and station context

### Login page
Purpose:
- Authenticate workers and admins.
- Set a station/line context for the workstation.

Layout:
- Worker login flow (name selection/entry, then PIN when required).
- Admin login toggle on the same page.
- Station/line context selector.
- Read-only station schedule preview for the selected context.

Explicit UX decisions:
- Optional QR-based worker login.
- Forced PIN change when required before proceeding.
- Context ambiguity resolved by a modal station picker.
- Station context persists between sessions.

### Station context picker (modal)
Purpose:
- Resolve ambiguous context selections (multiple stations match).

Layout:
- Full-screen modal with station tiles/buttons.

Explicit UX decisions:
- Selecting a station immediately commits the choice (no extra save step).

### Station schedule preview (embedded panel)
Purpose:
- Show upcoming station work in a condensed, read-only view.

Layout:
- Scrollable table paired with a compact visual chart.

Explicit UX decisions:
- Auto-scroll to the current or next task.
- Row details open in a modal.

## 3) Worker station workspace

### Station workspace page
Purpose:
- Execute production work at the current station.

Layout:
- Header with worker identity, station context, and QC notification badge.
- Main list/selection area (panels or modules) with task details for the selection.
- Sections for rework tasks and auxiliary task queues when present.

Explicit UX decisions:
- Task actions (start/pause/resume/finish/skip) require metadata entry in modals.
- Pause and skip require a reason; finish supports comment templates and free text.
- Crew selection is handled in a modal for group tasks.
- Manual module/panel selection is available if items are not listed.
- Auxiliary work supports a dual-mode toggle to start two matching modules.
- A quick-start modal can launch tasks from other stations without leaving the page.

### Pause reason modal
Layout:
- List of predefined reasons and a custom reason input.

Explicit UX decisions:
- Selecting a predefined reason can auto-confirm.

### Skip reason modal
Layout:
- List of predefined reasons and a custom reason input.

### Comment template modal
Layout:
- List of templates and a free-text option.

### Crew selector modal
Layout:
- Multi-select list of workers.

### Manual module/panel selector modal
Layout:
- Search box, module list, and panel list for the selected module.

## 4) Quality control (QC)

### QC dashboard page
Purpose:
- Triage pending checks and rework tasks.

Layout:
- Header with QC identity and quick actions.
- Lists of pending checks and rework tasks.
- Station/line overview to show where checks/rework are concentrated.

Explicit UX decisions:
- QC login is handled via an in-page modal.
- Check/rework cards are clickable to open execution.
- Auto-refresh runs on a fixed interval.

### QC execution page
Purpose:
- Perform a QC check with evidence capture.

Layout:
- Split view: guidance/reference media on top, action controls below.
- Evidence gallery for captured and uploaded media.

Explicit UX decisions:
- Guidance and reference media use carousels.
- Evidence capture uses a full-screen camera overlay.
- Notes entry uses a focused modal panel.

### QC library page
Purpose:
- Browse QC history by module.

Layout:
- Summary tiles, filter bar, and module list.
- Module detail opens in an overlay panel.

Explicit UX decisions:
- Filter bar includes a toggle to show only unfulfilled items.

## 5) Admin dashboard shell

### Admin dashboard page
Purpose:
- Provide navigation to admin pages and render selected content.

Layout:
- Left sidebar navigation grouped by functional area.
- Main content area for the selected page.

Explicit UX decisions:
- Sidebar collapses on small screens and uses an overlay.

## 6) Admin pages - Personnel

### Workers page
Purpose:
- Create, edit, and remove workers.

Layout:
- Edit form and worker list (table or card layout for narrow screens).

Explicit UX decisions:
- Specialties and station assignments are checkable lists.
- Station assignment uses a dropdown with checkboxes.

### Specialties page
Purpose:
- Create, edit, and remove specialties.

Layout:
- Simple list and add/edit form.

### Admin team page
Purpose:
- Create, edit, and remove admin users.

Layout:
- Simple list and add/edit form with role selection and active toggle.

### Assistance page
Purpose:
- View attendance summaries per worker.

Layout:
- Worker selector, summary cards, and day-by-day detail view.
- Day navigation controls and a date picker.

Explicit UX decisions:
- Day navigation supports previous/next controls plus direct date selection.

## 7) Admin pages - Planning and production

### Production status page
Purpose:
- See current station status and manage the production plan ordering.

Layout:
- Station layout grid for panel line, magazine, and assembly lines.
- Upcoming plan list grouped by project.

Explicit UX decisions:
- Upcoming list supports drag-and-drop reordering.
- Multi-select list actions are supported for queue operations.
- Add-batch, set subtype, and set date/time use modals.

### Panel production history page
Purpose:
- Review historical task logs.

Layout:
- Date controls, filter inputs, and a sortable table.

Explicit UX decisions:
- Export action generates a report file.

### Station panels finished page
Purpose:
- Report panels that finished or passed a station on a given day.

Layout:
- Station and date filters, timeline/table of panels, and summary totals.

Explicit UX decisions:
- Export action generates a report file.
- Panels can be inspected via hover or detail affordances.

### Task analysis page
Purpose:
- Analyze task performance data.

Layout:
- Filters, summary stats, histogram chart, and data table.

Explicit UX decisions:
- Hypothesis builder filters chart data by worker or date.

### Panel linear meters page
Purpose:
- Analyze throughput metrics by panel type and station.

Layout:
- Filters, summary metrics, and detailed tables.

## 8) Admin pages - Configuration and definitions

### Stations page
Purpose:
- Create and edit stations.

Layout:
- Station list with add/edit form.

### Module advance rules page
Purpose:
- Configure advancement rules and task applicability/durations.

Layout:
- Tabbed interface for rules, applicability, and durations.

Explicit UX decisions:
- Task selection uses checkable lists.
- Duration editing uses inline numeric inputs.

### House types page
Purpose:
- Create and edit house types and their parameters.

Layout:
- House type list and editor.
- Embedded parameter editor with per-module values.

Explicit UX decisions:
- Generic vs subtype values use checkboxes.

### House parameters page
Purpose:
- Create and edit parameter definitions.

Layout:
- Parameter list and add/edit form.

### House panels page
Purpose:
- Define panels for a house type/module.

Layout:
- House type and module selectors.
- Panel list with add/edit form.

Explicit UX decisions:
- Task applicability and task durations open in matrix-style modals.

### Task definitions page
Purpose:
- Define panel and module tasks.

Layout:
- Task list grouped by station/sequence with an add/edit form.

Explicit UX decisions:
- Dependencies selected via a grouped, collapsible checklist modal.
- Allowed workers and regular crew use multi-select lists.
- Task groups can be collapsed/expanded.

### Pause definitions page
Purpose:
- Define pause reasons and scope them to stations.

Layout:
- Add/edit form and definitions list.

Explicit UX decisions:
- Station scoping uses a dropdown with checkable station lists and an all-stations toggle.

### Note definitions page
Purpose:
- Define comment templates and scope them to stations.

Layout:
- Add/edit form and definitions list.

Explicit UX decisions:
- Station scoping uses a dropdown with checkable station lists and an all-stations toggle.

## 9) Admin pages - Quality

### QC checks page
Purpose:
- Define QC checks, triggers, and applicability rules.

Layout:
- Tabbed editor with cards/sections for definitions, triggers, and applicability.
- Media attachments managed within the editor.

Explicit UX decisions:
- Trigger/task selection uses checkboxes.
- Guidance and reference media use file uploads.

## 10) Utility pages

### Day summary page
Purpose:
- Review station/day summaries and add ex-post notes.

Layout:
- Station and date filters, table of results, and an ex-post notes modal.

Explicit UX decisions:
- Ex-post notes are captured in a modal dialog.

### General overview page
Purpose:
- High-level status of stations and modules.

Layout:
- Grid of station cards with module/task summaries.
- Manual refresh action in the header.

Explicit UX decisions:
- Worker names can be clicked to auto-login and jump to the station workspace.
