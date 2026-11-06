"""Record who canceled a QC rework, when, and why; add the force_closed complaint event.

Revision ID: 0053_qc_rework_cancellation
Revises: 0052_panel_auto_releases
"""

from alembic import op
import sqlalchemy as sa


revision = "0053_qc_rework_cancellation"
down_revision = "0052_panel_auto_releases"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("qc_rework_tasks", sa.Column("canceled_at", sa.DateTime(), nullable=True))
    op.add_column(
        "qc_rework_tasks",
        sa.Column(
            "canceled_by_user_id",
            sa.Integer(),
            sa.ForeignKey(
                "admin_users.id",
                ondelete="SET NULL",
                name="fk_qc_rework_tasks_canceled_by_user_id",
            ),
            nullable=True,
        ),
    )
    op.add_column("qc_rework_tasks", sa.Column("cancel_reason", sa.Text(), nullable=True))
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE qccomplainteventtype ADD VALUE IF NOT EXISTS 'force_closed'")


def downgrade() -> None:
    # The 'force_closed' enum value is left in place (Postgres can't drop enum values).
    op.drop_column("qc_rework_tasks", "cancel_reason")
    op.drop_constraint(
        "fk_qc_rework_tasks_canceled_by_user_id", "qc_rework_tasks", type_="foreignkey"
    )
    op.drop_column("qc_rework_tasks", "canceled_by_user_id")
    op.drop_column("qc_rework_tasks", "canceled_at")
