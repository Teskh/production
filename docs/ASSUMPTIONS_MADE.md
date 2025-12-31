## 2025-12-29
- Backend uses SQLAlchemy ORM models as the initial schema source, with a simple `Base.metadata.create_all` initializer and `DATABASE_URL` config until migrations are introduced.
- Added an `admin_sessions` table with hashed session tokens for HTTP-only cookie auth (server-side session storage).
- Backup tooling stores `.dump` files plus `backup_settings.json`/`backup_metadata.json` under `backend/backups`, with automation expected to run via an external scheduler invoking `app.scripts.backup_runner`.
- Backup restore creates a manual checkpoint backup, restores the selected `.dump` into a new database, then swaps names so the primary database points at the restored data.
