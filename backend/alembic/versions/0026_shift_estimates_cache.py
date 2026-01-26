"""Add shift estimates cache.

Revision ID: 0026_shift_estimates_cache
Revises: 0025_merge_heads
Create Date: 2026-01-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0026_shift_estimates_cache"
down_revision = "0025_merge_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "shift_estimates" in table_names:
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
        "shift_estimates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("group_key", sa.String(length=64), nullable=False),
        sa.Column("station_role", station_role_enum, nullable=False),
        sa.Column("station_id", sa.Integer(), nullable=True),
        sa.Column("sequence_order", sa.Integer(), nullable=True),
        sa.Column("assigned_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("present_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("estimated_start", sa.DateTime(), nullable=True),
        sa.Column("estimated_end", sa.DateTime(), nullable=True),
        sa.Column("last_exit", sa.DateTime(), nullable=True),
        sa.Column("shift_minutes", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column(
            "computed_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("algorithm_version", sa.Integer(), nullable=False, server_default="1"),
        sa.UniqueConstraint(
            "date",
            "group_key",
            "algorithm_version",
            name="uq_shift_estimates_day_group_version",
        ),
    )
    op.create_index("ix_shift_estimates_date", "shift_estimates", ["date"])
    op.create_index("ix_shift_estimates_group_key", "shift_estimates", ["group_key"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "shift_estimates" not in table_names:
        return
    op.drop_index("ix_shift_estimates_group_key", table_name="shift_estimates")
    op.drop_index("ix_shift_estimates_date", table_name="shift_estimates")
    op.drop_table("shift_estimates")
