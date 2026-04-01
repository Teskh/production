"""Add safety protocol management and supervisor signing.

Revision ID: 0035_safety_protocols
Revises: 0034_worker_adjusted_times
Create Date: 2026-04-01
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0035_safety_protocols"
down_revision = "0034_worker_adjusted_times"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "worker_supervisor_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("supervisor_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["supervisor_id"], ["worker_supervisors.id"], name="fk_worker_supervisor_sessions_supervisor_id"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_worker_supervisor_sessions_supervisor_id",
        "worker_supervisor_sessions",
        ["supervisor_id"],
        unique=False,
    )

    op.create_table(
        "safety_protocols",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["admin_users.id"], name="fk_safety_protocols_created_by_user_id"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "safety_protocol_applicability",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("protocol_id", sa.Integer(), nullable=False),
        sa.Column("supervisor_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["protocol_id"], ["safety_protocols.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["supervisor_id"], ["worker_supervisors.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "protocol_id",
            "supervisor_id",
            name="uq_safety_protocol_applicability_protocol_supervisor",
        ),
    )
    op.create_index(
        "ix_safety_protocol_applicability_protocol_id",
        "safety_protocol_applicability",
        ["protocol_id"],
        unique=False,
    )
    op.create_index(
        "ix_safety_protocol_applicability_supervisor_id",
        "safety_protocol_applicability",
        ["supervisor_id"],
        unique=False,
    )

    op.create_table(
        "safety_protocol_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("protocol_id", sa.Integer(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("change_summary", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["admin_users.id"], name="fk_safety_protocol_versions_created_by_user_id"
        ),
        sa.ForeignKeyConstraint(
            ["protocol_id"], ["safety_protocols.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "protocol_id",
            "version_number",
            name="uq_safety_protocol_versions_protocol_version_number",
        ),
    )
    op.create_index(
        "ix_safety_protocol_versions_protocol_id",
        "safety_protocol_versions",
        ["protocol_id"],
        unique=False,
    )

    op.create_table(
        "safety_protocol_documents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("protocol_version_id", sa.Integer(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("storage_key", sa.String(length=400), nullable=False),
        sa.Column("uri", sa.String(length=400), nullable=False),
        sa.Column("mime_type", sa.String(length=200), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["protocol_version_id"], ["safety_protocol_versions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "protocol_version_id",
            "original_filename",
            name="uq_safety_protocol_documents_version_filename",
        ),
    )
    op.create_index(
        "ix_safety_protocol_documents_protocol_version_id",
        "safety_protocol_documents",
        ["protocol_version_id"],
        unique=False,
    )

    op.create_table(
        "safety_protocol_signatures",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("protocol_id", sa.Integer(), nullable=False),
        sa.Column("protocol_version_id", sa.Integer(), nullable=False),
        sa.Column("supervisor_id", sa.Integer(), nullable=False),
        sa.Column("signed_name", sa.String(length=200), nullable=False),
        sa.Column("signed_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["protocol_id"], ["safety_protocols.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["protocol_version_id"], ["safety_protocol_versions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["supervisor_id"], ["worker_supervisors.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "protocol_version_id",
            "supervisor_id",
            name="uq_safety_protocol_signatures_version_supervisor",
        ),
    )
    op.create_index(
        "ix_safety_protocol_signatures_protocol_id",
        "safety_protocol_signatures",
        ["protocol_id"],
        unique=False,
    )
    op.create_index(
        "ix_safety_protocol_signatures_protocol_version_id",
        "safety_protocol_signatures",
        ["protocol_version_id"],
        unique=False,
    )
    op.create_index(
        "ix_safety_protocol_signatures_supervisor_id",
        "safety_protocol_signatures",
        ["supervisor_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_safety_protocol_signatures_supervisor_id",
        table_name="safety_protocol_signatures",
    )
    op.drop_index(
        "ix_safety_protocol_signatures_protocol_version_id",
        table_name="safety_protocol_signatures",
    )
    op.drop_index(
        "ix_safety_protocol_signatures_protocol_id",
        table_name="safety_protocol_signatures",
    )
    op.drop_table("safety_protocol_signatures")

    op.drop_index(
        "ix_safety_protocol_documents_protocol_version_id",
        table_name="safety_protocol_documents",
    )
    op.drop_table("safety_protocol_documents")

    op.drop_index(
        "ix_safety_protocol_versions_protocol_id",
        table_name="safety_protocol_versions",
    )
    op.drop_table("safety_protocol_versions")

    op.drop_index(
        "ix_safety_protocol_applicability_supervisor_id",
        table_name="safety_protocol_applicability",
    )
    op.drop_index(
        "ix_safety_protocol_applicability_protocol_id",
        table_name="safety_protocol_applicability",
    )
    op.drop_table("safety_protocol_applicability")

    op.drop_table("safety_protocols")

    op.drop_index(
        "ix_worker_supervisor_sessions_supervisor_id",
        table_name="worker_supervisor_sessions",
    )
    op.drop_table("worker_supervisor_sessions")
