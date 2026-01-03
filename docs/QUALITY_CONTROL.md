# Quality Control (QC)

## Purpose
- Provide consistent inspections across production.
- Capture evidence and maintain a usable history of checks.
- Route failures into rework and notify the right workers.

## Core concepts
- Check definitions: named checks with descriptions, active state, and sampling settings.
- Triggers: events that can open a check (task completion or station entry).
- Applicability rules: scope checks by house type, module number, and optional subtype.
- Check instances: a specific check opened for a module or panel, optionally tied to the triggering task.
- Executions: the recorded outcome of a check (pass, fail, waive, skip) with notes.
- Evidence: photos or videos attached to an execution.
- Rework tasks: corrective work created from failed checks.
- Worker notifications: alerts for the worker whose work triggered the failed check.

## Triggering and sampling
- A trigger fires on task completion or station entry.
- Applicability uses most-specific-wins; if no rules exist, the check applies to all.
- A force-required rule overrides sampling and always opens the check.
- Sampling is deterministic per plan, check, and trigger event so results are repeatable.
- If a check is not selected by sampling, it is still recorded as skipped for audit.
- Adaptive sampling (when enabled): a fail spikes the rate to 100%; passes step it down toward the base rate.

## Check lifecycle
- Open checks are executed by QC staff with an outcome and notes.
- Pass/waive/skip closes the check and auto-completes any open rework for it.
- Fail marks the check failed, creates a rework task, and alerts the original worker.
- A check cannot be re-executed while its rework is open or in progress.
- Completing rework reopens the check for reinspection.

## Rework workflow
- Rework tasks are linked to the check and inherit module or panel context.
- Workers can start or join rework, pause with a reason, resume, and complete.
- Concurrency guardrail: a worker cannot start rework while any other work is active.
- Completing rework closes all active rework logs and marks the rework done.
- Rework can be canceled when appropriate.

## Evidence and guidance
- Check definitions can include guidance and reference media.
- The execution view supports photo/video capture with a full-screen camera overlay.
- Captured images include a watermark with module, panel (if any), check, and timestamp.
- Evidence is visible in the execution view, history, and worker notifications.

## User-facing surfaces and UX decisions
### QC dashboard
- Triage pending checks and rework tasks with clickable cards.
- Line and station overview shows where issues are concentrated.
- Auto-refresh on a fixed interval.
- QC login happens in a modal to preserve context.

### QC execution
- Split layout: guidance/reference media on top, actions and evidence below.
- Notes entry uses a focused modal panel.
- Fast pass/fail actions; rework blocks re-execution until resolved.

### QC library (history)
- Module-centric history with summary tiles and filters.
- Filter bar includes a toggle for unfulfilled items (open, failed, or rework).
- Module detail opens in an overlay and shows executions, evidence, and rework attempts.

### Worker station experience
- QC alert badge near the worker identity; modal shows failures, notes, evidence, and rework status.
- Notifications are informational and do not block task actions.
- Station view surfaces rework tasks with clear status coloring and start/pause/complete controls.

## Integration with production flow
- Checks can be tied to module tasks or panel tasks for traceability.
- Rework tasks appear at the relevant station and must be cleared before reinspection.
- Worker notifications target the original worker who performed the checked task.
- Active notifications focus on recent failures and unresolved rework to reduce noise.
