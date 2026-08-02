"""Add Microsoft-verified company access sessions.

Revision ID: 0049_company_access_sessions
Revises: 0048_definition_archiving
Create Date: 2026-08-01
"""

from alembic import op
import sqlalchemy as sa


revision = "0049_company_access_sessions"
down_revision = "0048_definition_archiving"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("company_access_sessions"):
        return

    op.create_table(
        "company_access_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_company_access_sessions_email",
        "company_access_sessions",
        ["email"],
    )
    op.create_index(
        "ix_company_access_sessions_expires_at",
        "company_access_sessions",
        ["expires_at"],
    )
    op.create_index(
        "ix_company_access_sessions_token_hash",
        "company_access_sessions",
        ["token_hash"],
        unique=True,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("company_access_sessions"):
        op.drop_table("company_access_sessions")
