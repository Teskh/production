"""Add panel sequence number to panel definitions.

Revision ID: 0006_panel_sequence_number
Revises: 0005_station_model_seed
Create Date: 2026-01-02
"""

from alembic import op
import sqlalchemy as sa


revision = "0006_panel_sequence_number"
down_revision = "0005_station_model_seed"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "panel_definitions",
        sa.Column("panel_sequence_number", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("panel_definitions", "panel_sequence_number")
