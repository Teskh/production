"""Add station camera feed mapping column and seed data.

Revision ID: 0028_station_camera_feeds
Revises: 0027_performance_events
Create Date: 2026-02-16
"""

from __future__ import annotations

import re

from alembic import op
import sqlalchemy as sa


revision = "0028_station_camera_feeds"
down_revision = "0027_performance_events"
branch_labels = None
depends_on = None

_CAMERA_IP_BY_STATION_NAME = {
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

_STATION_NAME_ALIASES = {
    "precorte holzma aux": "precorte holzma",
}


def _normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _seed_camera_feed_ips(bind) -> None:
    station_rows = list(
        bind.execute(sa.text("SELECT id, name FROM stations")).mappings()
    )
    if not station_rows:
        return

    for row in station_rows:
        station_id = int(row["id"])
        normalized_name = _normalize_name(str(row["name"]))
        station_key = _STATION_NAME_ALIASES.get(normalized_name, normalized_name)
        camera_feed_ip = _CAMERA_IP_BY_STATION_NAME.get(station_key)
        if not camera_feed_ip:
            continue
        bind.execute(
            sa.text(
                "UPDATE stations SET camera_feed_ip = :camera_feed_ip WHERE id = :station_id"
            ),
            {"camera_feed_ip": camera_feed_ip, "station_id": station_id},
        )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("stations"):
        return

    columns = {col["name"] for col in inspector.get_columns("stations")}
    if "camera_feed_ip" not in columns:
        op.add_column("stations", sa.Column("camera_feed_ip", sa.String(length=64), nullable=True))

    _seed_camera_feed_ips(bind)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("stations"):
        return
    columns = {col["name"] for col in inspector.get_columns("stations")}
    if "camera_feed_ip" in columns:
        op.drop_column("stations", "camera_feed_ip")
