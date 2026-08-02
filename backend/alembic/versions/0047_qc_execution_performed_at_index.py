"""Index QC executions by performance time.

Revision ID: 0047_qc_execution_time_idx
Revises: 0046_qc_evidence_upload_idx
Create Date: 2026-07-16
"""

from alembic import op
import sqlalchemy as sa


revision = "0047_qc_execution_time_idx"
down_revision = "0046_qc_evidence_upload_idx"
branch_labels = None
depends_on = None


INDEX_NAME = "ix_qc_executions_performed_at"
TABLE_NAME = "qc_executions"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table(TABLE_NAME):
        return
    existing_indexes = {index["name"] for index in inspector.get_indexes(TABLE_NAME)}
    if INDEX_NAME not in existing_indexes:
        op.create_index(INDEX_NAME, TABLE_NAME, ["performed_at"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table(TABLE_NAME):
        return
    existing_indexes = {index["name"] for index in inspector.get_indexes(TABLE_NAME)}
    if INDEX_NAME in existing_indexes:
        op.drop_index(INDEX_NAME, table_name=TABLE_NAME)
