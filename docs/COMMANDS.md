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
TRUSTED_PROXY_CIDRS=127.0.0.0/8,::1/128,172.18.144.1/32
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

### Patagual Windows deployment

The installed production URL is `https://aplicacionph.dyndns.org/produccion/`. Keep the
following ignored files on the production machine:

`ui/.env.production.local`:

```dotenv
VITE_APP_BASE_PATH=/produccion
VITE_API_BASE_URL=/produccion
```

`backend/microsoft.env`:

```dotenv
MICROSOFT_LOGIN_ENABLED=true
MICROSOFT_TENANT_ID=<tenant-id>
MICROSOFT_CLIENT_ID=<client-id>
MICROSOFT_CLIENT_SECRET=<client-secret-value>
MICROSOFT_REDIRECT_URI=https://aplicacionph.dyndns.org/produccion/api/auth/microsoft/callback
APP_BASE_PATH=/produccion
SESSION_COOKIE_SECURE=true
COMPANY_ACCESS_GATE_ENABLED=true
COMPANY_ACCESS_SESSION_HOURS=12
TRUSTED_LAN_CIDRS=10.0.10.0/23
TRUSTED_PROXY_CIDRS=127.0.0.0/8,::1/128,10.0.10.236/32
TRUSTED_CLIENT_IP_HEADER=x-iis-client-ip
```

Build, migrate, and verify a patch before restarting the installed task:

```powershell
uv sync --dev
Push-Location ui
npm ci
npm run lint
npm run build
Pop-Location
$env:PYTHONPATH = "backend"
uv run alembic -c backend/alembic.ini upgrade head
uv run python -m unittest discover -s backend/tests -p "test_*.py"
```

The scheduled task `Produccion App` runs at startup as `SYSTEM`, restarts after failure,
and binds Uvicorn to `127.0.0.1:5174`. Restart it after deploying a patch:

```powershell
Stop-ScheduledTask -TaskName "Produccion App"
Start-ScheduledTask -TaskName "Produccion App"
```

The installed Caddy task reads `C:\caddy\Caddyfile`. The repository templates are
`deployment/Caddyfile.production` and `deployment/iis-web.config`. Caddy provides the old
LAN entry page at `http://10.0.10.236:5173` and proxies IIS to the loopback-only Produccion
listener at `https://127.0.0.1:8093`. IIS owns public HTTPS port 443 and publishes the
`/produccion/` path. Do not expose 5174 or 8093 through the router or firewall.

After a restart or patch, check:

```powershell
curl.exe -k https://127.0.0.1:8093/health
curl.exe -I https://aplicacionph.dyndns.org/produccion/
curl.exe -I http://10.0.10.236:5173/
```

Test one tablet on the LAN and one device on mobile data. The tablet transition page moves
the supported browser settings to the HTTPS app, but Microsoft/login cookies and camera
permission must be granted again once on each device.

## Database-only production sync

The Backups page can pull a fresh PostgreSQL dump from production into a local
development installation. The control is visible only to a SysAdmin browsing through
`localhost`, `127.0.0.1`, or `::1`. Both sides are disabled by default.

First deploy the export endpoint to production. Add this to the production
`backend/microsoft.env` and restart the application:

```dotenv
DATABASE_SYNC_EXPORT_ENABLED=true
DATABASE_SYNC_TOKEN=<same-random-secret-of-at-least-32-characters>
```

Keep the application port private. The export endpoint is reachable through the existing
HTTPS reverse proxy, but it returns a dump only when the shared token is present.

On the development machine, add this to the ignored root or `backend/.env` file and
restart the backend:

```dotenv
DATABASE_SYNC_PULL_ENABLED=true
DATABASE_SYNC_SOURCE_URL=https://aplicacionph.dyndns.org/produccion
DATABASE_SYNC_TOKEN=<same-random-secret-of-at-least-32-characters>
DATABASE_SYNC_TIMEOUT_SECONDS=600
DATABASE_SYNC_MAX_BYTES=2147483648
```

The sync downloads a custom-format dump over HTTPS, rejects redirects and oversized or
invalid files, creates a checkpoint dump of the current local database, restores
production into a temporary database, applies this checkout's Alembic migrations, removes
all copied login sessions, and swaps databases. The prior local database remains available
under the archived database name shown after the operation. A new login is required.

This is intentionally database-only. It does not copy `media_gallery`, QC evidence,
complaint files, other uploaded media, ignored environment files, printer/camera settings,
or machine-local runtime configuration.

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
