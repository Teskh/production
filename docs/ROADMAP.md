# Roadmap Checklist

Checklist for building the application. Update each item to `In progress` or `Done` as work advances.

## Database And Schema
- [-] Status: In progress - finalize data model (WorkOrder/WorkUnit/PanelUnit, tasks, applicability, stations, workers, QC)
- [X] Status: Done - implement PostgreSQL schema for core entities and execution logs
- [ ] Status: Not started - seed baseline reference data (stations, line types, roles, pause reasons, comment templates)
- [ ] Status: Not started - add data access layer patterns (repositories/services) and base validation

## Minimal Admin Backend + Frontend
- [X] Status: Done - admin auth (AdminUser + roles) and session handling
- [X] Status: Done - CRUD APIs for workers, skills, stations, house types/subtypes, panel definitions
- [X] Status: Done - CRUD APIs for task definitions, 
- [ ] Status: Not started - CRUD APIs for task applicability, expected durations, advance rules
- [X] Status: Done - CRUD APIs for house parameters and per-module parameter values
- [X] Status: Done - admin UI screens to edit the above (list/detail/edit/import)
- [X] Status: Done - specialties admin page wired to skills and worker assignments
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
