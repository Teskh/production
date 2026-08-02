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

Admin sessions establish identity. Admins can use the existing local name/PIN login or
Microsoft Entra ID; both methods create the same database-backed `admin_session`. Entra
sign-in matches the Microsoft work email to an existing active `admin_users` record and
does not create users or replace local role permissions. Admin page permissions are
enforced both by the UI and by backend dependencies on mapped mutation endpoints. Worker
and supervisor workflows use their own session cookies and route dependencies.

The company access middleware is an outer deployment gate, separate from role identity.
Trusted LAN CIDRs and loopback development hosts bypass it. Other clients must complete
the tenant-specific Microsoft flow and receive a database-backed `company_access_session`
before app pages or APIs are served. A matching active admin email additionally creates an
admin session and redirects to the role-appropriate area; an unmatched email receives no
app role and lands on the worker login page.

## Verification

See `docs/COMMANDS.md`. CI runs backend unit tests plus frontend lint and production build.
