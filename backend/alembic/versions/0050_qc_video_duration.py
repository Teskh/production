"""Store QC video playback duration.

Revision ID: 0050_qc_video_duration
Revises: 0049_company_access_sessions
"""

from alembic import op
import sqlalchemy as sa


revision = "0050_qc_video_duration"
down_revision = "0049_company_access_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("media_assets", sa.Column("duration_seconds", sa.Float(), nullable=True))
    op.alter_column("media_assets", "size_bytes", existing_type=sa.Integer(), type_=sa.BigInteger())


def downgrade() -> None:
    op.drop_column("media_assets", "duration_seconds")
    # Keep the wider byte counter so rollback preserves records for large files.
