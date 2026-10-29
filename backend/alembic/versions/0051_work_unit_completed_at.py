"""Record when a module was marked completed.

Revision ID: 0051_work_unit_completed_at
Revises: 0050_qc_video_duration
"""

from alembic import op
import sqlalchemy as sa


revision = "0051_work_unit_completed_at"
down_revision = "0050_qc_video_duration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("work_units", sa.Column("completed_at", sa.DateTime(), nullable=True))
    op.create_index("ix_work_units_completed_at", "work_units", ["completed_at"])
    # Existing completed modules have no completion record; use their last finished task.
    op.execute(
        """
        UPDATE work_units AS wu
        SET completed_at = last_task.completed_at
        FROM (
            SELECT work_unit_id, MAX(completed_at) AS completed_at
            FROM task_instances
            WHERE completed_at IS NOT NULL
            GROUP BY work_unit_id
        ) AS last_task
        WHERE wu.id = last_task.work_unit_id
          AND wu.status = 'COMPLETED'
        """
    )


def downgrade() -> None:
    op.drop_index("ix_work_units_completed_at", table_name="work_units")
    op.drop_column("work_units", "completed_at")
