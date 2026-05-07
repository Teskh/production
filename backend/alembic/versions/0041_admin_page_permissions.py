"""Add admin page permissions.

Revision ID: 0041_admin_page_permissions
Revises: 0040_panel_task_app_uniq
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0041_admin_page_permissions"
down_revision = "0040_panel_task_app_uniq"
branch_labels = None
depends_on = None


ADMIN_PAGE_IDS = [
    "dashboards",
    "workers",
    "production-queue",
    "house-config",
    "house-params",
    "stations",
    "task-defs",
    "pause-note-defs",
    "backups",
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "admin_page_permissions" not in table_names:
        op.create_table(
            "admin_page_permissions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("page_id", sa.String(length=100), nullable=False),
            sa.Column("role", sa.String(length=50), nullable=False),
            sa.Column("can_view", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("can_edit", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("page_id", "role", name="uq_admin_page_permissions_page_role"),
        )
        op.create_index(
            "ix_admin_page_permissions_page_id",
            "admin_page_permissions",
            ["page_id"],
        )
        op.create_index(
            "ix_admin_page_permissions_role",
            "admin_page_permissions",
            ["role"],
        )

    roles = [
        row[0]
        for row in bind.execute(
            sa.text("SELECT DISTINCT role FROM admin_users WHERE role IS NOT NULL")
        ).all()
        if row[0]
    ]
    if "SysAdmin" not in roles:
        roles.insert(0, "SysAdmin")

    existing = {
        (row.page_id, row.role)
        for row in bind.execute(sa.text("SELECT page_id, role FROM admin_page_permissions")).all()
    }
    permission_table = sa.table(
        "admin_page_permissions",
        sa.column("page_id", sa.String),
        sa.column("role", sa.String),
        sa.column("can_view", sa.Boolean),
        sa.column("can_edit", sa.Boolean),
    )
    rows = [
        {"page_id": page_id, "role": role, "can_view": True, "can_edit": True}
        for page_id in ADMIN_PAGE_IDS
        for role in roles
        if (page_id, role) not in existing
    ]
    if rows:
        op.bulk_insert(permission_table, rows)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "admin_page_permissions" not in table_names:
        return
    op.drop_index("ix_admin_page_permissions_role", table_name="admin_page_permissions")
    op.drop_index("ix_admin_page_permissions_page_id", table_name="admin_page_permissions")
    op.drop_table("admin_page_permissions")
