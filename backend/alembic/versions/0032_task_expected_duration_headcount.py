"""Add expected headcount to task expected durations.

Revision ID: 0032_task_expected_headcount
Revises: 0031_merge_shift_presence_heads
Create Date: 2026-03-06
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0032_task_expected_headcount"
down_revision = "0031_merge_shift_presence_heads"
branch_labels = None
depends_on = None


_TABLE = "task_expected_durations"
_MINUTES_COLUMN = "expected_minutes"
_HEADCOUNT_COLUMN = "expected_headcount"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _TABLE not in set(inspector.get_table_names()):
        return

    columns = {col["name"]: col for col in inspector.get_columns(_TABLE)}

    if _HEADCOUNT_COLUMN not in columns:
        op.add_column(_TABLE, sa.Column(_HEADCOUNT_COLUMN, sa.Integer(), nullable=True))

    minutes_column = columns.get(_MINUTES_COLUMN)
    if minutes_column is not None and not minutes_column.get("nullable", False):
        op.alter_column(
            _TABLE,
            _MINUTES_COLUMN,
            existing_type=sa.Numeric(10, 2),
            nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _TABLE not in set(inspector.get_table_names()):
        return

    columns = {col["name"]: col for col in inspector.get_columns(_TABLE)}

    if _HEADCOUNT_COLUMN in columns:
        op.drop_column(_TABLE, _HEADCOUNT_COLUMN)

    minutes_column = columns.get(_MINUTES_COLUMN)
    if minutes_column is not None and minutes_column.get("nullable", False):
        op.execute(
            sa.text(
                f"DELETE FROM {_TABLE} "
                f"WHERE {_MINUTES_COLUMN} IS NULL"
            )
        )
        op.alter_column(
            _TABLE,
            _MINUTES_COLUMN,
            existing_type=sa.Numeric(10, 2),
            nullable=False,
        )
