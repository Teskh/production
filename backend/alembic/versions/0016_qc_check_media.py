"""Add QC check media assets.

Revision ID: 0016_qc_check_media
Revises: 0015_drop_qc_failure_mode_flags
Create Date: 2026-01-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0016_qc_check_media"
down_revision = "0015_drop_qc_failure_mode_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "qc_check_media_assets" in table_names:
        return

    existing_enums = {enum["name"] for enum in inspector.get_enums()}
    if "qccheckmediatype" not in existing_enums:
        media_type_enum = postgresql.ENUM(
            "guidance", "reference", name="qccheckmediatype"
        )
        media_type_enum.create(bind)
    media_type_enum = postgresql.ENUM(
        "guidance", "reference", name="qccheckmediatype", create_type=False
    )

    op.create_table(
        "qc_check_media_assets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("check_definition_id", sa.Integer(), nullable=False),
        sa.Column("media_type", media_type_enum, nullable=False),
        sa.Column("uri", sa.String(length=400), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["check_definition_id"], ["qc_check_definitions.id"]
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_qc_check_media_assets_check_definition_id",
        "qc_check_media_assets",
        ["check_definition_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "qc_check_media_assets" in table_names:
        op.drop_index(
            "ix_qc_check_media_assets_check_definition_id",
            table_name="qc_check_media_assets",
        )
        op.drop_table("qc_check_media_assets")

    media_type_enum = postgresql.ENUM(
        "guidance", "reference", name="qccheckmediatype", create_type=False
    )
    media_type_enum.drop(bind, checkfirst=True)
