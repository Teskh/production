"""Drop QC failure mode requirement flags.

Revision ID: 0015_drop_qc_failure_mode_flags
Revises: 0014_qc_severity_simplify
Create Date: 2026-01-09
"""

from alembic import op
import sqlalchemy as sa


revision = "0015_drop_qc_failure_mode_flags"
down_revision = "0014_qc_severity_simplify"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "qc_failure_mode_definitions" not in table_names:
        return

    columns = {
        column["name"] for column in inspector.get_columns("qc_failure_mode_definitions")
    }
    if "require_evidence" in columns:
        op.drop_column("qc_failure_mode_definitions", "require_evidence")
    if "require_measurement" in columns:
        op.drop_column("qc_failure_mode_definitions", "require_measurement")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "qc_failure_mode_definitions" not in table_names:
        return

    columns = {
        column["name"] for column in inspector.get_columns("qc_failure_mode_definitions")
    }
    if "require_evidence" not in columns:
        op.add_column(
            "qc_failure_mode_definitions",
            sa.Column("require_evidence", sa.Boolean(), nullable=False, default=False),
        )
    if "require_measurement" not in columns:
        op.add_column(
            "qc_failure_mode_definitions",
            sa.Column("require_measurement", sa.Boolean(), nullable=False, default=False),
        )
