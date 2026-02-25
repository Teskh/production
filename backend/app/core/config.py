from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parents[2]

# Load environment defaults from both the repo root and backend folder.
# Repo root is preferred when both exist.
load_dotenv(BASE_DIR.parent / ".env", override=False)
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
    sys_admin_password: str | None = os.getenv("SYS_ADMIN_PASSWORD")
    camera_rtsp_username: str = os.getenv("CAMERA_RTSP_USERNAME", "admin")
    camera_rtsp_password: str = os.getenv("CAMERA_RTSP_PASSWORD", "Geoforce.2030.$")
    camera_rtsp_port: int = int(os.getenv("CAMERA_RTSP_PORT", "554"))
    camera_rtsp_channel: int = int(os.getenv("CAMERA_RTSP_CHANNEL", "1"))
    camera_rtsp_subtype: int = int(os.getenv("CAMERA_RTSP_SUBTYPE", "0"))
    camera_ffmpeg_bin: str = os.getenv("CAMERA_FFMPEG_BIN", "ffmpeg")
    camera_mjpeg_fps: int = int(os.getenv("CAMERA_MJPEG_FPS", "5"))


settings = Settings()
