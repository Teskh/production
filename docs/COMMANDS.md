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

## Microsoft and network-aware access

Microsoft sign-in is both an admin login method and the company gate for requests arriving
from outside trusted networks. Local name/PIN login remains available. Configure these
values in the ignored root or `backend/.env` file:

```dotenv
MICROSOFT_LOGIN_ENABLED=true
MICROSOFT_TENANT_ID=<tenant-id>
MICROSOFT_CLIENT_ID=<client-id>
MICROSOFT_CLIENT_SECRET=<client-secret-value>
MICROSOFT_REDIRECT_URI=http://localhost:5173/api/auth/microsoft/callback
COMPANY_ACCESS_GATE_ENABLED=true
COMPANY_ACCESS_SESSION_HOURS=12
TRUSTED_LAN_CIDRS=10.0.10.0/23
TRUSTED_PROXY_CIDRS=127.0.0.0/8,::1/128
```

The redirect URI must exactly match a Web redirect URI registered in Entra. Set an
explicit URI for Vite development because the browser uses port 5173 while the proxied
backend listens on port 2340. Production must use its externally reachable HTTPS origin,
for example `https://production.example/api/auth/microsoft/callback`. After changing env
values, restart the backend. Assign each eligible admin's Microsoft work email under
Admin > Personal > Equipo admin before testing sign-in.

The production LAN value above comes from server address `10.0.10.236` with subnet mask
`255.255.254.0`; it covers `10.0.10.0` through `10.0.11.255`. Requests from that range
bypass the company gate and reach the worker login page. Loopback development through
`localhost:5173` is also trusted. Requests from elsewhere must complete Microsoft sign-in.
An active admin email receives its existing role session and role-appropriate landing page;
an unregistered or inactive email receives only company access and lands on `/login`.

`TRUSTED_PROXY_CIDRS` must contain only reverse proxies operated by the deployment. The app
uses `X-Forwarded-For` only when the immediate connection comes from one of those ranges.
If the reverse proxy runs in Docker or on another host, add its exact subnet rather than a
broad private range. Keep the application port inaccessible from the internet.

See `docs/DEPLOYMENT_SECURITY.md` for the same-hostname HTTPS, split-DNS, reverse-proxy,
firewall, and validation checklist.

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
When HTTPS is terminated by a reverse proxy on the same machine, bind this command to
`127.0.0.1` instead of `0.0.0.0` and expose only reverse-proxy port 443.

## Zebra label printer

The Etiquetas admin page uses the backend to send ZPL directly to a configured Zebra
printer. Add the printer's reserved Wi-Fi address to the ignored root or `backend/.env`:

```dotenv
ZEBRA_PRINTER_HOST=10.0.10.203
ZEBRA_PRINTER_PORT=9100
ZEBRA_PRINTER_TIMEOUT_SECONDS=3
```

Restart the backend after changing these values. The page selects the active production
task, then the most recent task activity, and finally the first non-completed queue item as
a fallback. It previews the production number, project, module, and conditional panel code
in landscape orientation. Until `ZEBRA_PRINTER_HOST` is set, layout configuration and the
preview remain available while status and sample-print actions report that the printer is
not configured.

## Maintenance example

```bash
uv run --directory backend python -m app.scripts.fix_today_timestamps --dry-run
```
