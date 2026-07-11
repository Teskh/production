# Application architecture

SCP is a single repository containing a FastAPI/PostgreSQL backend and a React frontend.

## Main areas

- Worker login and station execution: station context, task lifecycle, crew participation,
  pauses, notes, and panel/module progression.
- Production planning: work orders, module sequencing, production lines, conditions, and
  queue management.
- Quality control: check definitions, execution, evidence, complaints, rework, and reports.
- Administration: personnel, stations, product definitions, task rules, permissions,
  backups, and dashboards.
- Integrations: GeoVictoria attendance, BUK personnel data, RTSP camera feeds, PDF/Excel
  reporting, and PostgreSQL backup/restore.

## Backend

`backend/app/main.py` creates the application, starts optional schedulers, mounts media,
and serves the compiled SPA. API routers live in `backend/app/api/routes`, shared business
logic in `backend/app/services`, SQLAlchemy models in `backend/app/models`, and response or
request contracts in `backend/app/schemas`.

Alembic migrations under `backend/alembic/versions` are the schema source of truth.

## Frontend

`ui/src/App.tsx` defines role-oriented routes. Layouts own session and navigation context;
pages are loaded at route boundaries to keep the initial bundle small. The application
uses same-origin cookie sessions and Vite proxies API requests during development.

## Authorization

Admin sessions establish identity. Admin page permissions are enforced both by the UI and
by backend dependencies on mapped mutation endpoints. Worker and supervisor workflows use
their own session cookies and route dependencies.

## Verification

See `docs/COMMANDS.md`. CI runs backend unit tests plus frontend lint and production build.
