"""Expand admin user PIN length to 32 characters.

Revision ID: 0019_admin_user_pin_length
Revises: 0018_admin_users_role_string
Create Date: 2026-01-05
"""

from alembic import op
import sqlalchemy as sa


revision = "0019_admin_user_pin_length"
down_revision = "0018_admin_users_role_string"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("admin_users"):
        return

    existing_columns = {col["name"] for col in inspector.get_columns("admin_users")}
    if "pin" not in existing_columns:
        return

    op.alter_column(
        "admin_users",
        "pin",
        existing_type=sa.String(length=10),
        type_=sa.String(length=32),
        nullable=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("admin_users"):
        return

    existing_columns = {col["name"] for col in inspector.get_columns("admin_users")}
    if "pin" not in existing_columns:
        return

    op.execute(
        "ALTER TABLE admin_users ALTER COLUMN pin TYPE VARCHAR(10) USING LEFT(pin, 10)"
    )
