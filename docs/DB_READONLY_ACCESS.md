# Read-Only DB User

Current Postgres read-only login for ad hoc querying:

- Host: `localhost`
- Port: `5432`
- Database: `scp`
- Username: `analista`
- Password: `analisis`

Connect with:

```bash
PGHOST=localhost PGPORT=5432 PGDATABASE=scp PGUSER=analista PGPASSWORD='analisis' psql
```

Current access:

- Read-only by default
- Can read most production tables
- Can read `public.workers`
- Cannot read `public.admin_users`
- Cannot read `public.admin_sessions`
- Cannot read `public.worker_sessions`
- Cannot read `public.worker_supervisor_sessions`
- Safe views also exist in `analytics.*`

Notes:

- This only works from the machine running Postgres unless access is exposed via tunnel/VPN/network config.
- If the password changes, update this file.
