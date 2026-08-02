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
load_dotenv(BASE_DIR / "microsoft.env", override=False)


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
    geovictoria_attendance_min_interval_seconds: float = float(
        os.getenv("GEOVICTORIA_ATTENDANCE_MIN_INTERVAL_SECONDS", "0.35")
    )
    geovictoria_429_retry_seconds: float = float(
        os.getenv("GEOVICTORIA_429_RETRY_SECONDS", "1.5")
    )
    geovictoria_429_max_retries: int = int(
        os.getenv("GEOVICTORIA_429_MAX_RETRIES", "2")
    )
    buk_base_url: str = os.getenv("BUK_BASE_URL", "https://grupopatagual.buk.cl")
    buk_api_token: str | None = os.getenv("BUK_API_TOKEN") or os.getenv("BUK_TOKEN")
    buk_country: str = os.getenv("BUK_COUNTRY", "chile")
    buk_people_cache_ttl_seconds: int = int(
        os.getenv("BUK_PEOPLE_CACHE_TTL_SECONDS", "300")
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
    shift_estimate_scheduler_enabled: bool = (
        os.getenv("SHIFT_ESTIMATE_SCHEDULER_ENABLED", "true").lower() == "true"
    )
    shift_estimate_scheduler_poll_seconds: int = int(
        os.getenv("SHIFT_ESTIMATE_SCHEDULER_POLL_SECONDS", "60")
    )
    shift_estimate_scheduler_settings_path: Path = Path(
        os.getenv(
            "SHIFT_ESTIMATE_SCHEDULER_SETTINGS_PATH",
            str(BASE_DIR / "runtime" / "shift_estimate_scheduler_settings.json"),
        )
    )
    label_printer_settings_path: Path = Path(
        os.getenv(
            "LABEL_PRINTER_SETTINGS_PATH",
            str(BASE_DIR / "runtime" / "label_printer_settings.json"),
        )
    )
    zebra_printer_host: str = os.getenv("ZEBRA_PRINTER_HOST", "").strip()
    zebra_printer_port: int = int(os.getenv("ZEBRA_PRINTER_PORT", "9100"))
    zebra_printer_timeout_seconds: float = float(
        os.getenv("ZEBRA_PRINTER_TIMEOUT_SECONDS", "3")
    )
    sys_admin_password: str | None = os.getenv("SYS_ADMIN_PASSWORD")
    microsoft_login_enabled: bool = (
        os.getenv("MICROSOFT_LOGIN_ENABLED", "true").lower() == "true"
    )
    microsoft_tenant_id: str = os.getenv("MICROSOFT_TENANT_ID", "")
    microsoft_client_id: str = os.getenv("MICROSOFT_CLIENT_ID", "")
    microsoft_client_secret: str = os.getenv("MICROSOFT_CLIENT_SECRET", "")
    microsoft_redirect_uri: str = os.getenv("MICROSOFT_REDIRECT_URI", "")
    company_access_gate_enabled: bool = (
        os.getenv("COMPANY_ACCESS_GATE_ENABLED", "true").lower() == "true"
    )
    company_access_session_hours: int = int(
        os.getenv("COMPANY_ACCESS_SESSION_HOURS", "12")
    )
    trusted_lan_cidrs: str = os.getenv(
        "TRUSTED_LAN_CIDRS", "10.0.10.0/23"
    )
    trusted_proxy_cidrs: str = os.getenv(
        "TRUSTED_PROXY_CIDRS", "127.0.0.0/8,::1/128"
    )
    camera_rtsp_username: str = os.getenv("CAMERA_RTSP_USERNAME", "admin")
    camera_rtsp_password: str = os.getenv("CAMERA_RTSP_PASSWORD", "Geoforce.2030.$")
    camera_rtsp_port: int = int(os.getenv("CAMERA_RTSP_PORT", "554"))
    camera_rtsp_channel: int = int(os.getenv("CAMERA_RTSP_CHANNEL", "1"))
    camera_rtsp_subtype: int = int(os.getenv("CAMERA_RTSP_SUBTYPE", "0"))
    camera_ffmpeg_bin: str = os.getenv("CAMERA_FFMPEG_BIN", "ffmpeg")
    camera_mjpeg_fps: int = int(os.getenv("CAMERA_MJPEG_FPS", "5"))


settings = Settings()
