from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)


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


settings = Settings()
