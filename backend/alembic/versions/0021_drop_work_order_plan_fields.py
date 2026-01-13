"""Drop work order scheduling fields.

Revision ID: 0021_drop_work_order_plan_fields
Revises: 0020_fix_sequences_after_migration
Create Date: 2026-01-16
"""

from alembic import op
import sqlalchemy as sa


revision = "0021_drop_work_order_plan_fields"
down_revision = "0020_fix_sequences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("work_orders")}
    index_names = {idx["name"] for idx in inspector.get_indexes("work_orders")}

    if "ix_work_orders_planned_sequence" in index_names:
        op.drop_index("ix_work_orders_planned_sequence", table_name="work_orders")
    if "planned_sequence" in columns:
        op.drop_column("work_orders", "planned_sequence")
    if "planned_assembly_line" in columns:
        op.drop_column("work_orders", "planned_assembly_line")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("work_orders")}
    index_names = {idx["name"] for idx in inspector.get_indexes("work_orders")}

    if "planned_sequence" not in columns:
        op.add_column(
            "work_orders", sa.Column("planned_sequence", sa.Integer(), nullable=True)
        )
    if "planned_assembly_line" not in columns:
        op.add_column(
            "work_orders",
            sa.Column("planned_assembly_line", sa.String(length=1), nullable=True),
        )
    if "ix_work_orders_planned_sequence" not in index_names:
        op.create_index(
            "ix_work_orders_planned_sequence", "work_orders", ["planned_sequence"]
        )
