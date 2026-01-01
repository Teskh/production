from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parents[2]

load_dotenv(BASE_DIR / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://postgres:postgres@localhost:5432/scp",
    )
    echo_sql: bool = os.getenv("SQL_ECHO", "false").lower() == "true"
    geovictoria_base_url: str = os.getenv(
        "GEOVICTORIA_BASE_URL",
        "https://customerapi.geovictoria.com/api/v1",
    )
    geovictoria_api_user: str | None = os.getenv("GEOVICTORIA_API_USER") or os.getenv(
        "Clave_API"
    )
    geovictoria_api_password: str | None = os.getenv(
        "GEOVICTORIA_API_PASSWORD"
    ) or os.getenv("Secreto")
    geovictoria_token_ttl_seconds: int = int(
        os.getenv("GEOVICTORIA_TOKEN_TTL_SECONDS", "1200")
    )
    backup_dir: Path = Path(os.getenv("BACKUP_DIR", str(BASE_DIR / "backups")))
    backup_admin_db: str = os.getenv("BACKUP_ADMIN_DB", "postgres")
    pg_dump_path: str = os.getenv("PG_DUMP_PATH", "pg_dump")
    pg_restore_path: str = os.getenv("PG_RESTORE_PATH", "pg_restore")
    backup_scheduler_enabled: bool = (
        os.getenv("BACKUP_SCHEDULER_ENABLED", "true").lower() == "true"
    )
    backup_scheduler_poll_seconds: int = int(
        os.getenv("BACKUP_SCHEDULER_POLL_SECONDS", "60")
    )


settings = Settings()
