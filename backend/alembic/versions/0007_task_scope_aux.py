"""Add aux task scope.

Revision ID: 0007_task_scope_aux
Revises: 0006_panel_sequence_number
Create Date: 2026-01-03
"""

from alembic import op

revision = "0007_task_scope_aux"
down_revision = "0006_panel_sequence_number"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE taskscope ADD VALUE IF NOT EXISTS 'aux'")


def downgrade() -> None:
    pass
