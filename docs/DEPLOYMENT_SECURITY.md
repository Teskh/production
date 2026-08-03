# Secure public and LAN deployment

The application supports one HTTPS hostname with different entry behavior based on the
real client network:

- `10.0.10.0/23` and local development clients reach the worker login page directly.
- Other clients must authenticate with the configured single-tenant Microsoft application.
- A Microsoft email assigned to an active admin user also creates the existing role session.
- A Microsoft email without an active app user creates only company access and lands on
  `/login`.

## DNS and TLS

Use the same hostname internally and externally.

- Public DNS: `exampleurl.com` points to the public IP forwarding HTTPS to the reverse proxy.
- Internal DNS: `exampleurl.com` points directly to `10.0.10.236`.
- Register exactly
  `https://exampleurl.com/api/auth/microsoft/callback` as the Entra Web redirect URI.
- Set `MICROSOFT_REDIRECT_URI` to that exact HTTPS URI.

Split DNS prevents LAN traffic from being hairpinned through the public gateway, which can
hide the tablet's LAN address from the access policy.

## Application settings

```dotenv
COMPANY_ACCESS_GATE_ENABLED=true
COMPANY_ACCESS_SESSION_HOURS=12
TRUSTED_LAN_CIDRS=10.0.10.0/23
TRUSTED_PROXY_CIDRS=127.0.0.0/8,::1/128,172.18.144.1/32
MICROSOFT_REDIRECT_URI=https://exampleurl.com/api/auth/microsoft/callback
```

Apply migrations before starting the new build:

```bash
PYTHONPATH=backend uv run alembic -c backend/alembic.ini upgrade head
```

## Reverse proxy

Terminate TLS at a reverse proxy and forward to a loopback-only application listener. A
minimal Caddy configuration is:

```caddyfile
exampleurl.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:5173
}
```

Caddy supplies the forwarding headers used to recover the original client address and
HTTPS origin. If another proxy or container sits between Caddy and the app, add only that
proxy's CIDR to `TRUSTED_PROXY_CIDRS`.

For the current Windows/WSL production host, Windows reports the WSL gateway as
`172.18.144.1`; that exact `/32` address is trusted so the backend can evaluate the LAN
client carried in `X-Forwarded-For`. If the WSL virtual network is recreated with a new
gateway, update this value to the new exact address.

Run the production application on loopback:

```bash
uv run uvicorn --app-dir backend app.main:app --host 127.0.0.1 --port 5173
```

Allow inbound TCP 443 at the firewall. Do not publish ports 5173 or 2340 to the internet.
The reverse proxy must replace or safely append forwarding headers; clients must not be
able to reach the application listener directly and supply their own trusted headers.

## Validation

After deployment, verify all of these paths:

1. A tablet on `10.0.10.0/23` opens `https://exampleurl.com` and reaches `/login` without
   Microsoft authentication.
2. A device on mobile data opens the same URL and is sent to Microsoft.
3. A company account without an app email mapping returns to `/login` and receives no menu.
4. An active mapped `QC` account reaches `/qc`; a mapped `Prevencionista` reaches
   `/utility/protocols`; other mapped admin roles reach `/admin`.
5. A non-company Microsoft account is rejected by the tenant-specific Microsoft flow.
6. Direct public connections to ports 5173 and 2340 fail.
