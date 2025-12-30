from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://postgres:postgres@localhost:5432/scp",
    )
    echo_sql: bool = os.getenv("SQL_ECHO", "false").lower() == "true"


settings = Settings()
