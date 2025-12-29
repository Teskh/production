# Roadmap Checklist

Checklist for building the application. Update each item to `In progress` or `Done` as work advances.

## Database And Schema
- [ ] Status: Not started - finalize data model (WorkOrder/WorkUnit/PanelUnit, tasks, applicability, stations, workers, QC)
- [ ] Status: Not started - pick migration tool + create initial migration scaffolding
- [ ] Status: Not started - implement PostgreSQL schema for core entities and execution logs
- [ ] Status: Not started - seed baseline reference data (stations, line types, roles, pause reasons, comment templates)
- [ ] Status: Not started - add data access layer patterns (repositories/services) and base validation

## Minimal Admin Backend + Frontend
- [ ] Status: Not started - admin auth (AdminUser + roles) and session handling
- [ ] Status: Not started - CRUD APIs for workers, skills, stations, house types/subtypes, panel definitions
- [ ] Status: Not started - CRUD APIs for task definitions, applicability, expected durations, advance rules
- [ ] Status: Not started - CRUD APIs for house parameters and per-module parameter values
- [ ] Status: Not started - admin UI screens to edit the above (list/detail/edit/import)
- [ ] Status: Not started - guardrails/validation in admin UI (required fields, ranges, conflicts)

## Production Line Logic
- [ ] Status: Not started - worker login + station context selection (QR/PIN, stored station context)
- [ ] Status: Not started - task lifecycle endpoints (start, pause, resume, finish, skip)
- [ ] Status: Not started - station queue computation (W, M, A/B/C, auxiliary)
- [ ] Status: Not started - advancement engine (auto-advance, status transitions, skip/carryover)
- [ ] Status: Not started - enforcement rules (dependencies, skills, allowed workers, concurrency)
- [ ] Status: Not started - worker station UI (queues, task actions, crew picker, other tasks modal)
- [ ] Status: Not started - realtime updates via WebSockets for station queues and task status
- [ ] Status: Not started - reporting endpoints (station summaries, man-hours, task analytics)
- [ ] Status: Not started - QC workflows (checks, sampling, rework tasks, evidence capture)
- [ ] Status: Not started - performance pass (task template caching, batch endpoints)
