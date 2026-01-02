"""Add worker supervisors.

Revision ID: 0009_worker_supervisors
Revises: 0008_production_queue_fields
Create Date: 2026-01-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0009_worker_supervisors"
down_revision = "0008_production_queue_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("worker_supervisors"):
        op.create_table(
            "worker_supervisors",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("geovictoria_id", sa.String(length=64), nullable=True, unique=True),
            sa.Column(
                "geovictoria_identifier", sa.String(length=32), nullable=True, unique=True
            ),
            sa.Column("first_name", sa.String(length=100), nullable=False),
            sa.Column("last_name", sa.String(length=100), nullable=False),
            sa.Column("pin", sa.String(length=10), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
    op.execute(
        "ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_supervisor_id_fkey"
    )
    existing_fks = {fk["name"] for fk in inspector.get_foreign_keys("workers")}
    if "workers_supervisor_id_fkey" not in existing_fks:
        op.create_foreign_key(
            "workers_supervisor_id_fkey",
            "workers",
            "worker_supervisors",
            ["supervisor_id"],
            ["id"],
        )


def downgrade() -> None:
    op.drop_constraint("workers_supervisor_id_fkey", "workers", type_="foreignkey")
    op.create_foreign_key(
        "workers_supervisor_id_fkey",
        "workers",
        "admin_users",
        ["supervisor_id"],
        ["id"],
    )
    op.drop_table("worker_supervisors")
