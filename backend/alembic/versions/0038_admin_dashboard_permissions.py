"""Add admin dashboard permissions.

Revision ID: 0038_admin_dashboard_permissions
Revises: 0037_gv_attendance_cache
Create Date: 2026-04-25
"""

from alembic import op
import sqlalchemy as sa


revision = "0038_admin_dashboard_permissions"
down_revision = "0037_gv_attendance_cache"
branch_labels = None
depends_on = None


ALL_DASHBOARDS = [
    "plant-view",
    "panel-linear-meters",
    "panel-production-history",
    "panel-analysis",
    "tasks-analysis",
    "task-footage",
    "station-adherence",
    "assistance-activity",
    "line-attendance-throughput",
]

SYSADMIN_ONLY_DASHBOARDS = {"plant-view", "task-footage"}
ASSISTANCE_DASHBOARDS = {"assistance-activity", "line-attendance-throughput"}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "admin_dashboard_permissions" not in table_names:
        op.create_table(
            "admin_dashboard_permissions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("dashboard_id", sa.String(length=100), nullable=False),
            sa.Column("role", sa.String(length=50), nullable=False),
            sa.UniqueConstraint(
                "dashboard_id",
                "role",
                name="uq_admin_dashboard_permissions_dashboard_role",
            ),
        )
        op.create_index(
            "ix_admin_dashboard_permissions_dashboard_id",
            "admin_dashboard_permissions",
            ["dashboard_id"],
        )
        op.create_index(
            "ix_admin_dashboard_permissions_role",
            "admin_dashboard_permissions",
            ["role"],
        )

    roles = [
        row[0]
        for row in bind.execute(
            sa.text(
                """
                SELECT DISTINCT role
                FROM admin_users
                WHERE role IS NOT NULL AND btrim(role) <> ''
                ORDER BY role
                """
            )
        )
    ]
    if "SysAdmin" not in roles:
        roles.insert(0, "SysAdmin")

    permission_table = sa.table(
        "admin_dashboard_permissions",
        sa.column("dashboard_id", sa.String),
        sa.column("role", sa.String),
    )
    existing = {
        (row[0], row[1])
        for row in bind.execute(
            sa.text("SELECT dashboard_id, role FROM admin_dashboard_permissions")
        )
    }

    rows = []
    for dashboard_id in ALL_DASHBOARDS:
        if dashboard_id in SYSADMIN_ONLY_DASHBOARDS:
            dashboard_roles = ["SysAdmin"]
        elif dashboard_id in ASSISTANCE_DASHBOARDS:
            dashboard_roles = [role for role in roles if role in {"SysAdmin", "MC Senior"}]
            if "SysAdmin" not in dashboard_roles:
                dashboard_roles.insert(0, "SysAdmin")
        else:
            dashboard_roles = roles

        for role in dashboard_roles:
            key = (dashboard_id, role)
            if key not in existing:
                rows.append({"dashboard_id": dashboard_id, "role": role})

    if rows:
        op.bulk_insert(permission_table, rows)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "admin_dashboard_permissions" not in table_names:
        return

    op.drop_index(
        "ix_admin_dashboard_permissions_role",
        table_name="admin_dashboard_permissions",
    )
    op.drop_index(
        "ix_admin_dashboard_permissions_dashboard_id",
        table_name="admin_dashboard_permissions",
    )
    op.drop_table("admin_dashboard_permissions")
