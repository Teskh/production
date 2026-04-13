"""Add task correction audit logs.

Revision ID: 0036_task_correction_logs
Revises: 0035_safety_protocols
Create Date: 2026-04-02
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import ENUM as PGEnum


revision = "0036_task_correction_logs"
down_revision = "0035_safety_protocols"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_correction_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("original_task_instance_id", sa.Integer(), nullable=False),
        sa.Column("task_definition_id", sa.Integer(), nullable=False),
        sa.Column("task_name_snapshot", sa.String(length=200), nullable=False),
        sa.Column(
            "scope",
            PGEnum("panel", "module", "aux", name="taskscope", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "status_snapshot",
            PGEnum(
                "NotStarted",
                "InProgress",
                "Paused",
                "Completed",
                "Skipped",
                name="taskstatus",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("work_unit_id", sa.Integer(), nullable=False),
        sa.Column("panel_unit_id", sa.Integer(), nullable=True),
        sa.Column("station_id", sa.Integer(), nullable=False),
        sa.Column("corrected_by_user_id", sa.Integer(), nullable=False),
        sa.Column("correction_kind", sa.String(length=60), nullable=False),
        sa.Column("rollback_applied", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("details_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["corrected_by_user_id"],
            ["admin_users.id"],
            name="fk_task_correction_logs_corrected_by_user_id",
        ),
        sa.ForeignKeyConstraint(
            ["panel_unit_id"],
            ["panel_units.id"],
            name="fk_task_correction_logs_panel_unit_id",
        ),
        sa.ForeignKeyConstraint(
            ["station_id"],
            ["stations.id"],
            name="fk_task_correction_logs_station_id",
        ),
        sa.ForeignKeyConstraint(
            ["task_definition_id"],
            ["task_definitions.id"],
            name="fk_task_correction_logs_task_definition_id",
        ),
        sa.ForeignKeyConstraint(
            ["work_unit_id"],
            ["work_units.id"],
            name="fk_task_correction_logs_work_unit_id",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_task_correction_logs_original_task_instance_id",
        "task_correction_logs",
        ["original_task_instance_id"],
        unique=False,
    )
    op.create_index(
        "ix_task_correction_logs_task_definition_id",
        "task_correction_logs",
        ["task_definition_id"],
        unique=False,
    )
    op.create_index(
        "ix_task_correction_logs_work_unit_id",
        "task_correction_logs",
        ["work_unit_id"],
        unique=False,
    )
    op.create_index(
        "ix_task_correction_logs_panel_unit_id",
        "task_correction_logs",
        ["panel_unit_id"],
        unique=False,
    )
    op.create_index(
        "ix_task_correction_logs_station_id",
        "task_correction_logs",
        ["station_id"],
        unique=False,
    )
    op.create_index(
        "ix_task_correction_logs_corrected_by_user_id",
        "task_correction_logs",
        ["corrected_by_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_task_correction_logs_corrected_by_user_id",
        table_name="task_correction_logs",
    )
    op.drop_index(
        "ix_task_correction_logs_station_id",
        table_name="task_correction_logs",
    )
    op.drop_index(
        "ix_task_correction_logs_panel_unit_id",
        table_name="task_correction_logs",
    )
    op.drop_index(
        "ix_task_correction_logs_work_unit_id",
        table_name="task_correction_logs",
    )
    op.drop_index(
        "ix_task_correction_logs_task_definition_id",
        table_name="task_correction_logs",
    )
    op.drop_index(
        "ix_task_correction_logs_original_task_instance_id",
        table_name="task_correction_logs",
    )
    op.drop_table("task_correction_logs")
