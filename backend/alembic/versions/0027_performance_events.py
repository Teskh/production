"""Add performance events telemetry table.

Revision ID: 0027_performance_events
Revises: 0026_shift_estimates_cache
Create Date: 2026-02-11
"""

from alembic import op
import sqlalchemy as sa


revision = "0027_performance_events"
down_revision = "0026_shift_estimates_cache"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "performance_events" in table_names:
        return

    op.create_table(
        "performance_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("page_path", sa.String(length=255), nullable=True),
        sa.Column("api_path", sa.String(length=255), nullable=True),
        sa.Column("method", sa.String(length=12), nullable=True),
        sa.Column("duration_ms", sa.Numeric(10, 2), nullable=False),
        sa.Column("server_duration_ms", sa.Numeric(10, 2), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("ok", sa.Boolean(), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("device_id", sa.String(length=64), nullable=True),
        sa.Column("device_name", sa.String(length=120), nullable=True),
        sa.Column("app_version", sa.String(length=64), nullable=True),
        sa.Column("session_id", sa.String(length=64), nullable=True),
        sa.Column("sampled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_index(
        "ix_performance_events_created_at", "performance_events", ["created_at"]
    )
    op.create_index("ix_performance_events_event_type", "performance_events", ["event_type"])
    op.create_index("ix_performance_events_page_path", "performance_events", ["page_path"])
    op.create_index("ix_performance_events_api_path", "performance_events", ["api_path"])
    op.create_index("ix_performance_events_request_id", "performance_events", ["request_id"])
    op.create_index("ix_performance_events_device_id", "performance_events", ["device_id"])
    op.create_index("ix_performance_events_session_id", "performance_events", ["session_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "performance_events" not in table_names:
        return
    op.drop_index("ix_performance_events_session_id", table_name="performance_events")
    op.drop_index("ix_performance_events_device_id", table_name="performance_events")
    op.drop_index("ix_performance_events_request_id", table_name="performance_events")
    op.drop_index("ix_performance_events_api_path", table_name="performance_events")
    op.drop_index("ix_performance_events_page_path", table_name="performance_events")
    op.drop_index("ix_performance_events_event_type", table_name="performance_events")
    op.drop_index("ix_performance_events_created_at", table_name="performance_events")
    op.drop_table("performance_events")
