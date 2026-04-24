"""Add GeoVictoria attendance cache table.

Revision ID: 0037_gv_attendance_cache
Revises: 0036_task_correction_logs
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa


revision = "0037_gv_attendance_cache"
down_revision = "0036_task_correction_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "geovictoria_attendance_cache" in table_names:
        return

    op.create_table(
        "geovictoria_attendance_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("normalized_identifier", sa.String(length=32), nullable=False),
        sa.Column("attendance_date", sa.Date(), nullable=False),
        sa.Column(
            "is_present",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("first_entry", sa.DateTime(), nullable=True),
        sa.Column("last_exit", sa.DateTime(), nullable=True),
        sa.Column("source_identifier", sa.String(length=64), nullable=True),
        sa.Column("geovictoria_id", sa.String(length=64), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "normalized_identifier",
            "attendance_date",
            name="uq_geovictoria_attendance_cache_identifier_day",
        ),
    )
    op.create_index(
        "ix_geovictoria_attendance_cache_normalized_identifier",
        "geovictoria_attendance_cache",
        ["normalized_identifier"],
    )
    op.create_index(
        "ix_geovictoria_attendance_cache_attendance_date",
        "geovictoria_attendance_cache",
        ["attendance_date"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "geovictoria_attendance_cache" not in table_names:
        return

    op.drop_index(
        "ix_geovictoria_attendance_cache_attendance_date",
        table_name="geovictoria_attendance_cache",
    )
    op.drop_index(
        "ix_geovictoria_attendance_cache_normalized_identifier",
        table_name="geovictoria_attendance_cache",
    )
    op.drop_table("geovictoria_attendance_cache")
