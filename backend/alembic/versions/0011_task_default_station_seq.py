"""Add default station sequence to task definitions.

Revision ID: 0011_task_default_station_seq
Revises: 0010_worker_sessions
Create Date: 2026-01-07
"""

from alembic import op
import sqlalchemy as sa


revision = "0011_task_default_station_seq"
down_revision = "0010_worker_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("task_definitions")}
    if "default_station_sequence" not in columns:
        op.add_column(
            "task_definitions",
            sa.Column("default_station_sequence", sa.Integer(), nullable=True),
        )
    bind.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT
                    id,
                    task_definition_id,
                    station_sequence_order,
                    ROW_NUMBER() OVER (
                        PARTITION BY task_definition_id
                        ORDER BY id
                    ) AS rn
                FROM task_applicability
                WHERE house_type_id IS NULL
                  AND sub_type_id IS NULL
                  AND module_number IS NULL
                  AND panel_definition_id IS NULL
            )
            UPDATE task_definitions
            SET default_station_sequence = ranked.station_sequence_order
            FROM ranked
            WHERE task_definitions.id = ranked.task_definition_id
              AND ranked.rn = 1
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE task_applicability
            SET station_sequence_order = NULL
            WHERE house_type_id IS NULL
              AND sub_type_id IS NULL
              AND module_number IS NULL
              AND panel_definition_id IS NULL
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
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
    bind.execute(
        sa.text(
            """
            UPDATE task_applicability
            SET station_sequence_order = td.default_station_sequence
            FROM task_definitions td
            WHERE task_applicability.task_definition_id = td.id
              AND task_applicability.house_type_id IS NULL
              AND task_applicability.sub_type_id IS NULL
              AND task_applicability.module_number IS NULL
              AND task_applicability.panel_definition_id IS NULL
            """
        )
    )
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("task_definitions")}
    if "default_station_sequence" in columns:
        op.drop_column("task_definitions", "default_station_sequence")
