"""Drop QC applicability force_required.

Revision ID: 0023_qc_app_drop_force
Revises: 0022_qc_app_panel_group
Create Date: 2026-01-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0023_qc_app_drop_force"
down_revision = "0022_qc_app_panel_group"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "qc_applicability" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("qc_applicability")}
    if "force_required" in columns:
        op.drop_column("qc_applicability", "force_required")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "qc_applicability" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("qc_applicability")}
    if "force_required" not in columns:
        op.add_column(
            "qc_applicability",
            sa.Column("force_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
