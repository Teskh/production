"""Add shift estimate worker presence cache table.

Revision ID: 0029_shift_worker_presence
Revises: 0028_station_camera_feeds
Create Date: 2026-02-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0029_shift_worker_presence"
down_revision = "0028_station_camera_feeds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "shift_estimate_worker_presence" in table_names:
        return

    existing_enums = {enum["name"] for enum in inspector.get_enums()}
    if "stationrole" not in existing_enums:
        station_role_enum = postgresql.ENUM(
            "Panels", "Magazine", "Assembly", "AUX", name="stationrole"
        )
        station_role_enum.create(bind)
    station_role_enum = postgresql.ENUM(
        "Panels", "Magazine", "Assembly", "AUX", name="stationrole", create_type=False
    )

    op.create_table(
        "shift_estimate_worker_presence",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("group_key", sa.String(length=64), nullable=False),
        sa.Column("worker_id", sa.Integer(), nullable=False),
        sa.Column("station_role", station_role_enum, nullable=False),
        sa.Column("station_id", sa.Integer(), nullable=True),
        sa.Column("sequence_order", sa.Integer(), nullable=True),
        sa.Column("is_assigned", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_present", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("first_entry", sa.DateTime(), nullable=True),
        sa.Column("last_exit", sa.DateTime(), nullable=True),
        sa.Column("attendance_status", sa.String(length=20), nullable=False),
        sa.Column(
            "computed_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("algorithm_version", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(["worker_id"], ["workers.id"]),
        sa.UniqueConstraint(
            "date",
            "group_key",
            "worker_id",
            "algorithm_version",
            name="uq_shift_estimate_worker_presence_day_group_worker_version",
        ),
    )
    op.create_index(
        "ix_shift_estimate_worker_presence_date",
        "shift_estimate_worker_presence",
        ["date"],
    )
    op.create_index(
        "ix_shift_estimate_worker_presence_group_key",
        "shift_estimate_worker_presence",
        ["group_key"],
    )
    op.create_index(
        "ix_shift_estimate_worker_presence_worker_id",
        "shift_estimate_worker_presence",
        ["worker_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "shift_estimate_worker_presence" not in table_names:
        return
    op.drop_index(
        "ix_shift_estimate_worker_presence_worker_id",
        table_name="shift_estimate_worker_presence",
    )
    op.drop_index(
        "ix_shift_estimate_worker_presence_group_key",
        table_name="shift_estimate_worker_presence",
    )
    op.drop_index(
        "ix_shift_estimate_worker_presence_date",
        table_name="shift_estimate_worker_presence",
    )
    op.drop_table("shift_estimate_worker_presence")
