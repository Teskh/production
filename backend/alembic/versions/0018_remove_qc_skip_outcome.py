"""Remove QC skip outcomes.

Revision ID: 0018_remove_qc_skip_outcome
Revises: 0017_qc_rework_sampling
Create Date: 2026-01-15
"""

from alembic import op
import sqlalchemy as sa


revision = "0018_remove_qc_skip_outcome"
down_revision = "0017_qc_rework_sampling"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "qc_executions" in table_names:
        op.execute(
            "DELETE FROM qc_executions WHERE outcome::text = 'Skip'"
        )

    if "qc_check_instances" in table_names and "qc_executions" in table_names:
        op.execute(
            "DELETE FROM qc_check_instances "
            "WHERE status::text = 'Closed' "
            "AND origin::text = 'triggered' "
            "AND NOT EXISTS ("
            "    SELECT 1 FROM qc_executions "
            "    WHERE qc_executions.check_instance_id = qc_check_instances.id"
            ")"
        )


def downgrade() -> None:
    # Irreversible cleanup: skip outcomes and empty triggered checks are removed.
    return
