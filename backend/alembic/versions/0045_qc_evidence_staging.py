"""Add staged QC evidence uploads.

Revision ID: 0045_qc_evidence_staging
Revises: 0044_admin_user_email
Create Date: 2026-07-16
"""

from alembic import op
import sqlalchemy as sa


revision = "0045_qc_evidence_staging"
down_revision = "0044_admin_user_email"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("qc_evidence_uploads"):
        return

    op.create_table(
        "qc_evidence_uploads",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("check_instance_id", sa.Integer(), nullable=False),
        sa.Column("media_asset_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=False),
        sa.Column("client_upload_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["check_instance_id"],
            ["qc_check_instances.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["media_asset_id"],
            ["media_assets.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["admin_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_upload_id", name="uq_qc_evidence_uploads_client_upload_id"),
        sa.UniqueConstraint("media_asset_id", name="uq_qc_evidence_uploads_media_asset_id"),
    )
    op.create_index(
        "ix_qc_evidence_uploads_check_instance_id",
        "qc_evidence_uploads",
        ["check_instance_id"],
    )
    op.create_index(
        "ix_qc_evidence_uploads_uploaded_by_user_id",
        "qc_evidence_uploads",
        ["uploaded_by_user_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("qc_evidence_uploads"):
        op.drop_table("qc_evidence_uploads")
