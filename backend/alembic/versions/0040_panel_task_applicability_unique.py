"""Prevent duplicate panel task applicability rows.

Revision ID: 0040_panel_task_app_uniq
Revises: 0039_qc_quality_complaints
Create Date: 2026-04-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0040_panel_task_app_uniq"
down_revision = "0039_qc_quality_complaints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "task_applicability" not in table_names:
        return

    bind.execute(
        sa.text(
            """
            delete from task_applicability ta
            using task_applicability survivor
            where ta.panel_definition_id is not null
              and survivor.panel_definition_id = ta.panel_definition_id
              and survivor.task_definition_id = ta.task_definition_id
              and survivor.id < ta.id
            """
        )
    )
    op.create_index(
        "uq_task_applicability_panel_task",
        "task_applicability",
        ["task_definition_id", "panel_definition_id"],
        unique=True,
        postgresql_where=sa.text("panel_definition_id is not null"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_task_applicability_panel_task",
        table_name="task_applicability",
    )
