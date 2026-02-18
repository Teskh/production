# Full reset + migrations (includes station seed):
# PYTHONPATH=backend ./venv/bin/python -m app.scripts.reset_db --yes

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError

from app.core.config import settings
from app.db.session import SessionLocal
from app.db.init_db import init_db
from app.models.enums import StationLineType, StationRole
from app.models.stations import Station


BASE_DIR = Path(__file__).resolve().parents[3]
BACKEND_DIR = BASE_DIR / "backend"
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"
VALID_DB_NAME = re.compile(r"^[A-Za-z0-9_]+$")
CAMERA_IP_BY_STATION_NAME = {
    "framing": "10.0.10.68",
    "mesa 1": "10.0.10.70",
    "puente 1": "10.0.10.67",
    "mesa 2": "10.0.10.67",
    "puente 2": "10.0.10.48",
    "mesa 3": "10.0.10.67",
    "puente 3": "10.0.10.67",
    "mesa 4": "10.0.10.70",
    "puente 4": "10.0.10.70",
    "armado": "10.0.10.241",
    "estacion 1": "10.0.10.40",
    "estacion 2": "10.0.10.40",
    "estacion 3": "10.0.11.244",
    "estacion 4": "10.0.10.246",
    "estacion 5": "10.0.10.34",
    "estacion 6": "10.0.10.237",
    "precorte holzma": "10.0.10.42",
}
STATION_NAME_ALIASES = {
    "precorte holzma aux": "precorte holzma",
}


def _validate_db_name(name: str) -> None:
    if not VALID_DB_NAME.match(name):
        raise ValueError("Database name must contain only letters, numbers, or underscores.")


def _quote_identifier(name: str) -> str:
    return f'"{name}"'


def _admin_engine():
    url = make_url(settings.database_url)
    admin_url = url.set(database=settings.backup_admin_db)
    return create_engine(admin_url, isolation_level="AUTOCOMMIT")


def _terminate_connections(conn, db_name: str) -> None:
    conn.execute(
        text(
            "SELECT pg_terminate_backend(pid) "
            "FROM pg_stat_activity "
            "WHERE datname = :db_name "
            "AND pid <> pg_backend_pid()"
        ),
        {"db_name": db_name},
    )


def _reset_database(name: str, owner: str | None) -> None:
    _validate_db_name(name)
    if owner:
        _validate_db_name(owner)
    with _admin_engine().connect() as conn:
        _terminate_connections(conn, name)
        conn.execute(text(f"DROP DATABASE IF EXISTS {_quote_identifier(name)}"))
        if owner:
            conn.execute(
                text(
                    f"CREATE DATABASE {_quote_identifier(name)} "
                    f"OWNER {_quote_identifier(owner)}"
                )
            )
        else:
            conn.execute(text(f"CREATE DATABASE {_quote_identifier(name)}"))


def _run_alembic() -> None:
    env = os.environ.copy()
    backend_path = str(BACKEND_DIR)
    env["PYTHONPATH"] = (
        backend_path + os.pathsep + env.get("PYTHONPATH", "")
        if env.get("PYTHONPATH")
        else backend_path
    )
    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(ALEMBIC_INI), "upgrade", "head"],
        check=True,
        env=env,
        cwd=str(BACKEND_DIR),
    )


def _normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _apply_camera_seed(rows: list[dict]) -> None:
    for row in rows:
        name = _normalize_name(str(row["name"]))
        station_key = STATION_NAME_ALIASES.get(name, name)
        row["camera_feed_ip"] = CAMERA_IP_BY_STATION_NAME.get(station_key)


def _seed_stations(force: bool = False) -> None:
    rows = [
        {"id": 1, "name": "Framing", "role": StationRole.PANELS, "line_type": None, "sequence_order": 1},
        {"id": 2, "name": "Mesa 1", "role": StationRole.PANELS, "line_type": None, "sequence_order": 2},
        {"id": 3, "name": "Puente 1", "role": StationRole.PANELS, "line_type": None, "sequence_order": 3},
        {"id": 4, "name": "Mesa 2", "role": StationRole.PANELS, "line_type": None, "sequence_order": 4},
        {"id": 5, "name": "Puente 2", "role": StationRole.PANELS, "line_type": None, "sequence_order": 5},
        {"id": 6, "name": "Mesa 3", "role": StationRole.PANELS, "line_type": None, "sequence_order": 6},
        {"id": 7, "name": "Puente 3", "role": StationRole.PANELS, "line_type": None, "sequence_order": 7},
        {"id": 8, "name": "Mesa 4", "role": StationRole.PANELS, "line_type": None, "sequence_order": 8},
        {"id": 9, "name": "Puente 4", "role": StationRole.PANELS, "line_type": None, "sequence_order": 9},
        {"id": 10, "name": "Magazine", "role": StationRole.MAGAZINE, "line_type": None, "sequence_order": 10},
        {"id": 11, "name": "Armado", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_1, "sequence_order": 11},
        {"id": 12, "name": "Armado", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_2, "sequence_order": 11},
        {"id": 13, "name": "Armado", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_3, "sequence_order": 11},
        {"id": 14, "name": "Estacion 1", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_1, "sequence_order": 12},
        {"id": 15, "name": "Estacion 1", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_2, "sequence_order": 12},
        {"id": 16, "name": "Estacion 1", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_3, "sequence_order": 12},
        {"id": 17, "name": "Estacion 2", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_1, "sequence_order": 13},
        {"id": 18, "name": "Estacion 2", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_2, "sequence_order": 13},
        {"id": 19, "name": "Estacion 2", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_3, "sequence_order": 13},
        {"id": 20, "name": "Estacion 3", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_1, "sequence_order": 14},
        {"id": 21, "name": "Estacion 3", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_2, "sequence_order": 14},
        {"id": 22, "name": "Estacion 3", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_3, "sequence_order": 14},
        {"id": 23, "name": "Estacion 4", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_1, "sequence_order": 15},
        {"id": 24, "name": "Estacion 4", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_2, "sequence_order": 15},
        {"id": 25, "name": "Estacion 4", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_3, "sequence_order": 15},
        {"id": 26, "name": "Estacion 5", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_1, "sequence_order": 16},
        {"id": 27, "name": "Estacion 5", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_2, "sequence_order": 16},
        {"id": 28, "name": "Estacion 5", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_3, "sequence_order": 16},
        {"id": 29, "name": "Estacion 6", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_1, "sequence_order": 17},
        {"id": 30, "name": "Estacion 6", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_2, "sequence_order": 17},
        {"id": 31, "name": "Estacion 6", "role": StationRole.ASSEMBLY, "line_type": StationLineType.LINE_3, "sequence_order": 17},
        {"id": 32, "name": "Precorte Holzma", "role": StationRole.AUX, "line_type": None, "sequence_order": None},
    ]
    _apply_camera_seed(rows)
    session = SessionLocal()
    try:
        existing = session.query(Station).count()
        if existing and not force:
            print(f"Stations already present ({existing} rows); skipping seed.")
            return
        session.add_all(Station(**row) for row in rows)
        session.execute(
            text(
                "SELECT setval(pg_get_serial_sequence('stations', 'id'), "
                "(SELECT MAX(id) FROM stations))"
            )
        )
        session.commit()
    finally:
        session.close()


def _safe_url(url) -> str:
    return url.render_as_string(hide_password=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Drop and recreate the configured PostgreSQL database."
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirm destructive reset.",
    )
    parser.add_argument(
        "--database",
        type=str,
        default=None,
        help="Override database name from DATABASE_URL.",
    )
    parser.add_argument(
        "--setup",
        choices=("init-seed", "init", "alembic", "none"),
        default="init-seed",
        help="How to initialize schema after reset (default: init-seed).",
    )
    parser.add_argument(
        "--force-seed",
        action="store_true",
        help="Seed stations even if data already exists.",
    )
    args = parser.parse_args()

    url = make_url(settings.database_url)
    if not url.database:
        raise SystemExit("DATABASE_URL must include a database name.")
    db_name = args.database or url.database

    if not args.yes:
        raise SystemExit(
            "Refusing to reset without --yes. This will DROP the database."
        )

    owner = url.username
    print(f"Resetting database: {db_name}")
    try:
        _reset_database(db_name, owner)
    except OperationalError as exc:
        admin_url = url.set(database=settings.backup_admin_db)
        print(
            "Failed to connect to PostgreSQL for reset.",
            file=sys.stderr,
        )
        print(
            f"Check DATABASE_URL / BACKUP_ADMIN_DB and ensure Postgres is running.\n"
            f"Target: {_safe_url(admin_url)}",
            file=sys.stderr,
        )
        print(str(exc).strip(), file=sys.stderr)
        return 1

    if args.setup == "alembic":
        print("Running alembic migrations (includes station seed).")
        _run_alembic()
    elif args.setup == "init-seed":
        print("Running init_db and seeding stations.")
        init_db()
        _seed_stations(force=args.force_seed)
    elif args.setup == "init":
        print("Running init_db (tables only, no station seed).")
        init_db()
    else:
        print("Skipping schema initialization.")

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
