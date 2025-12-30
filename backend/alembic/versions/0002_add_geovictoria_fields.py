"""Add GeoVictoria worker fields.

Revision ID: 0002_add_geovictoria_fields
Revises: 0001_initial
Create Date: 2025-12-30
"""

from alembic import op
import sqlalchemy as sa

revision = "0002_add_geovictoria_fields"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workers", sa.Column("geovictoria_id", sa.String(length=64), nullable=True))
    op.add_column(
        "workers",
        sa.Column("geovictoria_identifier", sa.String(length=32), nullable=True),
    )
    op.create_unique_constraint(
        "uq_workers_geovictoria_id", "workers", ["geovictoria_id"]
    )
    op.create_unique_constraint(
        "uq_workers_geovictoria_identifier", "workers", ["geovictoria_identifier"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_workers_geovictoria_identifier", "workers", type_="unique")
    op.drop_constraint("uq_workers_geovictoria_id", "workers", type_="unique")
    op.drop_column("workers", "geovictoria_identifier")
    op.drop_column("workers", "geovictoria_id")
