"""Add task advance trigger and drop advance rules.

Revision ID: 0003_task_advance_trigger
Revises: 0002_add_geovictoria_fields
Create Date: 2025-12-31
"""

from alembic import op
import sqlalchemy as sa


revision = "0003_task_advance_trigger"
down_revision = "0002_add_geovictoria_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "task_definitions",
        sa.Column(
            "advance_trigger",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.drop_table("advance_rules")
    op.execute("DROP TYPE IF EXISTS advancerulemode")


def downgrade() -> None:
    op.execute(
        "CREATE TYPE advancerulemode AS ENUM ('AllTasksAtStation', 'TriggerTasks')"
    )
    op.create_table(
        "advance_rules",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("scope", sa.Enum("panel", "module", name="taskscope"), nullable=False),
        sa.Column("station_sequence_order", sa.Integer(), nullable=False),
        sa.Column("line_type", sa.String(length=5), nullable=True),
        sa.Column("house_type_id", sa.Integer(), nullable=True),
        sa.Column("sub_type_id", sa.Integer(), nullable=True),
        sa.Column("mode", sa.Enum("AllTasksAtStation", "TriggerTasks", name="advancerulemode"), nullable=False),
        sa.Column("trigger_task_definition_ids", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.ForeignKeyConstraint(["house_type_id"], ["house_types.id"]),
        sa.ForeignKeyConstraint(["sub_type_id"], ["house_sub_types.id"]),
    )
    op.drop_column("task_definitions", "advance_trigger")
