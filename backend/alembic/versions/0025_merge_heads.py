"""Merge alembic heads.

Revision ID: 0025_merge_heads
Revises: 0024_qc_applicability_multi, 0018_remove_qc_skip_outcome
Create Date: 2026-01-19
"""

revision = "0025_merge_heads"
down_revision = ("0024_qc_applicability_multi", "0018_remove_qc_skip_outcome")
branch_labels = None
depends_on = None


def upgrade() -> None:
    return


def downgrade() -> None:
    return
