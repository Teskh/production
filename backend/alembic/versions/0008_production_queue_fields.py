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
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    work_order_cols = {col["name"] for col in inspector.get_columns("work_orders")}
    if "house_identifier" not in work_order_cols:
        op.add_column(
            "work_orders",
            sa.Column("house_identifier", sa.String(length=200), nullable=True),
        )
    work_unit_cols = {col["name"] for col in inspector.get_columns("work_units")}
    if "planned_sequence" not in work_unit_cols:
        op.add_column(
            "work_units", sa.Column("planned_sequence", sa.Integer(), nullable=True)
        )
    if "planned_start_datetime" not in work_unit_cols:
        op.add_column(
            "work_units",
            sa.Column("planned_start_datetime", sa.DateTime(), nullable=True),
        )
    if "planned_assembly_line" not in work_unit_cols:
        op.add_column(
            "work_units",
            sa.Column("planned_assembly_line", sa.String(length=1), nullable=True),
        )
    index_names = {idx["name"] for idx in inspector.get_indexes("work_units")}
    if "ix_work_units_planned_sequence" not in index_names:
        op.create_index(
            "ix_work_units_planned_sequence", "work_units", ["planned_sequence"]
        )


def downgrade() -> None:
    op.drop_index("ix_work_units_planned_sequence", table_name="work_units")
    op.drop_column("work_units", "planned_assembly_line")
    op.drop_column("work_units", "planned_start_datetime")
    op.drop_column("work_units", "planned_sequence")
    op.drop_column("work_orders", "house_identifier")
