"""Add Microsoft sign-in email to admin users.

Revision ID: 0044_admin_user_email
Revises: 0043_condition_rules
Create Date: 2026-07-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0044_admin_user_email"
down_revision = "0043_condition_rules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("admin_users"):
        return

    columns = {column["name"] for column in inspector.get_columns("admin_users")}
    if "email" not in columns:
        op.add_column(
            "admin_users",
            sa.Column("email", sa.String(length=320), nullable=True),
        )

    indexes = {index["name"] for index in inspector.get_indexes("admin_users")}
    if "uq_admin_users_email_ci" not in indexes:
        op.execute(
            """
            CREATE UNIQUE INDEX uq_admin_users_email_ci
            ON admin_users (lower(email))
            WHERE email IS NOT NULL AND btrim(email) <> ''
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("admin_users"):
        return

    indexes = {index["name"] for index in inspector.get_indexes("admin_users")}
    if "uq_admin_users_email_ci" in indexes:
        op.drop_index("uq_admin_users_email_ci", table_name="admin_users")

    columns = {column["name"] for column in inspector.get_columns("admin_users")}
    if "email" in columns:
        op.drop_column("admin_users", "email")
