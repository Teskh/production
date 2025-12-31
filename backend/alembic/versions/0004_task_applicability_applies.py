"""Add applies flag to task applicability.

Revision ID: 0004_task_applicability_applies
Revises: 0003_task_advance_trigger
Create Date: 2025-12-31
"""

from alembic import op
import sqlalchemy as sa


revision = "0004_task_applicability_applies"
down_revision = "0003_task_advance_trigger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "task_applicability",
        sa.Column("applies", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("task_applicability", "applies")
