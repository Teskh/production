"""Add worker sessions.

Revision ID: 0010_worker_sessions
Revises: 0009_worker_supervisors
Create Date: 2026-01-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0010_worker_sessions"
down_revision = "0009_worker_supervisors"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "worker_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("worker_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("station_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["station_id"], ["stations.id"]),
        sa.ForeignKeyConstraint(["worker_id"], ["workers.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_worker_sessions_worker_id", "worker_sessions", ["worker_id"])
    op.create_index("ix_worker_sessions_token_hash", "worker_sessions", ["token_hash"])
    op.create_index("ix_worker_sessions_station_id", "worker_sessions", ["station_id"])


def downgrade() -> None:
    op.drop_index("ix_worker_sessions_station_id", table_name="worker_sessions")
    op.drop_index("ix_worker_sessions_token_hash", table_name="worker_sessions")
    op.drop_index("ix_worker_sessions_worker_id", table_name="worker_sessions")
    op.drop_table("worker_sessions")
