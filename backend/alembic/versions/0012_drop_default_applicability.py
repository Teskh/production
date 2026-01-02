"""Drop default task applicability rows.

Revision ID: 0012_drop_default_applicability
Revises: 0011_task_default_station_seq
Create Date: 2026-01-07
"""

from alembic import op
import sqlalchemy as sa


revision = "0012_drop_default_applicability"
down_revision = "0011_task_default_station_seq"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM task_applicability
        WHERE house_type_id IS NULL
          AND sub_type_id IS NULL
          AND module_number IS NULL
          AND panel_definition_id IS NULL
        """
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO task_applicability (
                task_definition_id,
                house_type_id,
                sub_type_id,
                module_number,
                panel_definition_id,
                applies,
                station_sequence_order
            )
            SELECT
                td.id,
                NULL,
                NULL,
                NULL,
                NULL,
                TRUE,
                td.default_station_sequence
            FROM task_definitions td
            WHERE NOT EXISTS (
                SELECT 1
                FROM task_applicability ta
                WHERE ta.task_definition_id = td.id
                  AND ta.house_type_id IS NULL
                  AND ta.sub_type_id IS NULL
                  AND ta.module_number IS NULL
                  AND ta.panel_definition_id IS NULL
            )
            """
        )
    )
