# Development workflow

Run all commands from the repository root unless a command starts with `cd`.

## First-time setup

```bash
uv sync --dev
cd ui && npm ci
```

`uv sync` creates the root `.venv` and installs the backend plus test dependencies from
`pyproject.toml` and `uv.lock`.

## Development servers

Backend:

```bash
uv run uvicorn --app-dir backend app.main:app --reload --host 0.0.0.0 --port 2340
```

Frontend, in a second terminal:

```bash
cd ui && npm run dev -- --host 0.0.0.0 --port 5173
```

Vite proxies `/api` and `/media_gallery` to the backend development server.

## Microsoft admin login

Microsoft sign-in is an additional admin login method; local name/PIN login remains
available. Configure these values in the ignored root or `backend/.env` file:

```dotenv
MICROSOFT_LOGIN_ENABLED=true
MICROSOFT_TENANT_ID=<tenant-id>
MICROSOFT_CLIENT_ID=<client-id>
MICROSOFT_CLIENT_SECRET=<client-secret-value>
MICROSOFT_REDIRECT_URI=http://localhost:5173/api/admin/microsoft/callback
```

The redirect URI must exactly match a Web redirect URI registered in Entra. Set an
explicit URI for Vite development because the browser uses port 5173 while the proxied
backend listens on port 2340. Production must use its externally reachable HTTPS origin,
for example `https://production.example/api/admin/microsoft/callback`. After changing env
values, restart the backend. Assign each eligible admin's Microsoft work email under
Admin > Personal > Equipo admin before testing sign-in.

## Verification

```bash
uv run python -m unittest discover -s backend/tests -p "test_*.py"
cd ui && npm run lint && npm run build
```

## Database migrations

```bash
PYTHONPATH=backend uv run alembic -c backend/alembic.ini upgrade head
```

## Production build and server

```bash
cd ui && npm ci && npm run build
cd .. && uv run uvicorn --app-dir backend app.main:app --host 0.0.0.0 --port 5173
```

The FastAPI application serves `ui/dist` and handles SPA route fallback.

## Maintenance example

```bash
uv run --directory backend python -m app.scripts.fix_today_timestamps --dry-run
```
