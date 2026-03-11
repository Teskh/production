"""Drop performance events telemetry table.

Revision ID: 0033_drop_performance_events
Revises: 0032_task_expected_headcount
Create Date: 2026-03-08
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0033_drop_performance_events"
down_revision = "0032_task_expected_headcount"
branch_labels = None
depends_on = None


_TABLE = "performance_events"
_INDEX_NAMES = (
    "ix_performance_events_created_at",
    "ix_performance_events_event_type",
    "ix_performance_events_page_path",
    "ix_performance_events_api_path",
    "ix_performance_events_request_id",
    "ix_performance_events_device_id",
    "ix_performance_events_session_id",
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if _TABLE not in table_names:
        return

    index_names = {index["name"] for index in inspector.get_indexes(_TABLE)}
    for index_name in _INDEX_NAMES:
        if index_name in index_names:
            op.drop_index(index_name, table_name=_TABLE)

    op.drop_table(_TABLE)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if _TABLE in table_names:
        return

    op.create_table(
        _TABLE,
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
    op.create_index("ix_performance_events_created_at", _TABLE, ["created_at"])
    op.create_index("ix_performance_events_event_type", _TABLE, ["event_type"])
    op.create_index("ix_performance_events_page_path", _TABLE, ["page_path"])
    op.create_index("ix_performance_events_api_path", _TABLE, ["api_path"])
    op.create_index("ix_performance_events_request_id", _TABLE, ["request_id"])
    op.create_index("ix_performance_events_device_id", _TABLE, ["device_id"])
    op.create_index("ix_performance_events_session_id", _TABLE, ["session_id"])
