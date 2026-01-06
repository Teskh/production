"""Make admin user roles free-form and add active flag.

Revision ID: 0018_admin_users_role_string
Revises: 0017_qc_rework_sampling
Create Date: 2026-01-05
"""

from alembic import op
import sqlalchemy as sa


revision = "0018_admin_users_role_string"
down_revision = "0017_qc_rework_sampling"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("admin_users"):
        return

    existing_columns = {col["name"] for col in inspector.get_columns("admin_users")}
    if "active" not in existing_columns:
        op.add_column(
            "admin_users",
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        )
        op.alter_column("admin_users", "active", server_default=None)

    op.execute(
        "ALTER TABLE admin_users ALTER COLUMN role TYPE VARCHAR(50) USING role::text"
    )

    op.execute(
        """
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'adminrole') THEN
    DROP TYPE adminrole;
  END IF;
END
$$;
"""
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("admin_users"):
        return

    op.execute(
        """
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'adminrole') THEN
    CREATE TYPE adminrole AS ENUM ('Supervisor', 'Admin', 'SysAdmin', 'QC');
  END IF;
END
$$;
"""
    )

    op.execute(
        """
ALTER TABLE admin_users
  ALTER COLUMN role TYPE adminrole
  USING (
    CASE
      WHEN role IN ('Supervisor', 'Admin', 'SysAdmin', 'QC') THEN role::adminrole
      ELSE 'Admin'::adminrole
    END
  )
"""
    )

    existing_columns = {col["name"] for col in inspector.get_columns("admin_users")}
    if "active" in existing_columns:
        op.drop_column("admin_users", "active")

