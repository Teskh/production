"""Add production queue scheduling fields.

Revision ID: 0008_production_queue_fields
Revises: 0007_task_scope_aux
Create Date: 2026-01-05
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_production_queue_fields"
down_revision = "0007_task_scope_aux"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "work_orders",
        sa.Column("house_identifier", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "work_units", sa.Column("planned_sequence", sa.Integer(), nullable=True)
    )
    op.add_column(
        "work_units",
        sa.Column("planned_start_datetime", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "work_units",
        sa.Column("planned_assembly_line", sa.String(length=1), nullable=True),
    )
    op.create_index(
        "ix_work_units_planned_sequence", "work_units", ["planned_sequence"]
    )


def downgrade() -> None:
    op.drop_index("ix_work_units_planned_sequence", table_name="work_units")
    op.drop_column("work_units", "planned_assembly_line")
    op.drop_column("work_units", "planned_start_datetime")
    op.drop_column("work_units", "planned_sequence")
    op.drop_column("work_orders", "house_identifier")
