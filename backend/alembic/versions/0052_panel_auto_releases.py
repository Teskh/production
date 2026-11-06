"""Record automatic panel releases so they can be reviewed and undone.

Revision ID: 0052_panel_auto_releases
Revises: 0051_work_unit_completed_at
"""

from alembic import op
import sqlalchemy as sa


revision = "0052_panel_auto_releases"
down_revision = "0051_work_unit_completed_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "panel_auto_releases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "panel_unit_id",
            sa.Integer(),
            sa.ForeignKey("panel_units.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "work_unit_id",
            sa.Integer(),
            sa.ForeignKey("work_units.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_station_id", sa.Integer(), sa.ForeignKey("stations.id"), nullable=False),
        sa.Column("to_station_id", sa.Integer(), sa.ForeignKey("stations.id"), nullable=True),
        sa.Column("previous_panel_status", sa.String(20), nullable=False),
        sa.Column("new_panel_status", sa.String(20), nullable=False),
        sa.Column("previous_work_unit_status", sa.String(20), nullable=False),
        sa.Column("new_work_unit_status", sa.String(20), nullable=False),
        sa.Column("trigger", sa.String(32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("undone_at", sa.DateTime(), nullable=True),
        sa.Column(
            "undone_by_user_id", sa.Integer(), sa.ForeignKey("admin_users.id"), nullable=True
        ),
    )
    op.create_index(
        "ix_panel_auto_releases_panel_unit_id", "panel_auto_releases", ["panel_unit_id"]
    )
    op.create_index(
        "ix_panel_auto_releases_work_unit_id", "panel_auto_releases", ["work_unit_id"]
    )
    op.create_index("ix_panel_auto_releases_created_at", "panel_auto_releases", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_panel_auto_releases_created_at", table_name="panel_auto_releases")
    op.drop_index("ix_panel_auto_releases_work_unit_id", table_name="panel_auto_releases")
    op.drop_index("ix_panel_auto_releases_panel_unit_id", table_name="panel_auto_releases")
    op.drop_table("panel_auto_releases")
