"""Add completed station to task adherence facts.

Revision ID: 0030_adherence_completed_station
Revises: 0029_station_adherence_facts
Create Date: 2026-02-18
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0030_adherence_completed_station"
down_revision = "0029_station_adherence_facts"
branch_labels = None
depends_on = None


_TABLE = "task_station_adherence_facts"
_COLUMN = "completed_station_id"
_INDEX = "ix_task_station_adherence_facts_completed_station_id"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _TABLE not in set(inspector.get_table_names()):
        return
    columns = {col["name"] for col in inspector.get_columns(_TABLE)}
    if _COLUMN not in columns:
        op.add_column(
            _TABLE,
            sa.Column(_COLUMN, sa.Integer(), sa.ForeignKey("stations.id"), nullable=True),
        )

    inspector = sa.inspect(op.get_bind())
    index_names = {idx["name"] for idx in inspector.get_indexes(_TABLE)}
    if _INDEX not in index_names:
        op.create_index(_INDEX, _TABLE, [_COLUMN])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _TABLE not in set(inspector.get_table_names()):
        return
    index_names = {idx["name"] for idx in inspector.get_indexes(_TABLE)}
    if _INDEX in index_names:
        op.drop_index(_INDEX, table_name=_TABLE)

    columns = {col["name"] for col in inspector.get_columns(_TABLE)}
    if _COLUMN in columns:
        op.drop_column(_TABLE, _COLUMN)
