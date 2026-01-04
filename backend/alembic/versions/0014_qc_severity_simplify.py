"""Simplify QC severity to fixed enum levels.

Revision ID: 0014_qc_severity_simplify
Revises: 0013_qc_failure_modes
Create Date: 2026-01-09
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_qc_severity_simplify"
down_revision = "0013_qc_failure_modes"
branch_labels = None
depends_on = None


def _drop_fk_if_exists(inspector: sa.Inspector, table: str, column: str) -> None:
    for fk in inspector.get_foreign_keys(table):
        if column in fk.get("constrained_columns", []):
            if fk.get("name"):
                op.drop_constraint(fk["name"], table, type_="foreignkey")


def _drop_index_if_exists(inspector: sa.Inspector, table: str, index_name: str) -> None:
    index_names = {idx["name"] for idx in inspector.get_indexes(table)}
    if index_name in index_names:
        op.drop_index(index_name, table_name=table)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    severity_enum = sa.Enum("baja", "media", "critica", name="qcseveritylevel")
    severity_enum.create(bind, checkfirst=True)

    if "qc_check_instances" in table_names:
        columns = {column["name"] for column in inspector.get_columns("qc_check_instances")}
        if "severity_level" not in columns:
            op.add_column(
                "qc_check_instances",
                sa.Column("severity_level", severity_enum, nullable=True),
            )
        if "severity_level_id" in columns:
            _drop_fk_if_exists(inspector, "qc_check_instances", "severity_level_id")
            _drop_index_if_exists(
                inspector, "qc_check_instances", "ix_qc_check_instances_severity_level_id"
            )
            op.drop_column("qc_check_instances", "severity_level_id")

    if "qc_failure_mode_definitions" in table_names:
        columns = {
            column["name"] for column in inspector.get_columns("qc_failure_mode_definitions")
        }
        if "default_severity_level" not in columns:
            op.add_column(
                "qc_failure_mode_definitions",
                sa.Column("default_severity_level", severity_enum, nullable=True),
            )
        if "default_severity_level_id" in columns:
            _drop_fk_if_exists(
                inspector, "qc_failure_mode_definitions", "default_severity_level_id"
            )
            _drop_index_if_exists(
                inspector,
                "qc_failure_mode_definitions",
                "ix_qc_failure_mode_definitions_default_severity_level_id",
            )
            op.drop_column("qc_failure_mode_definitions", "default_severity_level_id")

    if "qc_check_severity_options" in table_names:
        op.drop_table("qc_check_severity_options")

    if "qc_severity_levels" in table_names:
        op.drop_table("qc_severity_levels")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    severity_enum = sa.Enum("baja", "media", "critica", name="qcseveritylevel")

    if "qc_severity_levels" not in table_names:
        op.create_table(
            "qc_severity_levels",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False, default=True),
            sa.PrimaryKeyConstraint("id"),
        )

    if "qc_check_severity_options" not in table_names:
        op.create_table(
            "qc_check_severity_options",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("check_definition_id", sa.Integer(), nullable=False),
            sa.Column("severity_level_id", sa.Integer(), nullable=False),
            sa.Column("is_default", sa.Boolean(), nullable=False, default=False),
            sa.ForeignKeyConstraint(
                ["check_definition_id"], ["qc_check_definitions.id"]
            ),
            sa.ForeignKeyConstraint(["severity_level_id"], ["qc_severity_levels.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_qc_check_severity_options_check_definition_id",
            "qc_check_severity_options",
            ["check_definition_id"],
        )
        op.create_index(
            "ix_qc_check_severity_options_severity_level_id",
            "qc_check_severity_options",
            ["severity_level_id"],
        )

    if "qc_failure_mode_definitions" in table_names:
        columns = {
            column["name"] for column in inspector.get_columns("qc_failure_mode_definitions")
        }
        if "default_severity_level_id" not in columns:
            op.add_column(
                "qc_failure_mode_definitions",
                sa.Column("default_severity_level_id", sa.Integer(), nullable=True),
            )
            op.create_foreign_key(
                "fk_qc_failure_mode_definitions_default_severity_level_id",
                "qc_failure_mode_definitions",
                "qc_severity_levels",
                ["default_severity_level_id"],
                ["id"],
            )
            op.create_index(
                "ix_qc_failure_mode_definitions_default_severity_level_id",
                "qc_failure_mode_definitions",
                ["default_severity_level_id"],
            )
        if "default_severity_level" in columns:
            op.drop_column("qc_failure_mode_definitions", "default_severity_level")

    if "qc_check_instances" in table_names:
        columns = {column["name"] for column in inspector.get_columns("qc_check_instances")}
        if "severity_level_id" not in columns:
            op.add_column(
                "qc_check_instances",
                sa.Column("severity_level_id", sa.Integer(), nullable=True),
            )
            op.create_foreign_key(
                "fk_qc_check_instances_severity_level_id",
                "qc_check_instances",
                "qc_severity_levels",
                ["severity_level_id"],
                ["id"],
            )
            op.create_index(
                "ix_qc_check_instances_severity_level_id",
                "qc_check_instances",
                ["severity_level_id"],
            )
        if "severity_level" in columns:
            op.drop_column("qc_check_instances", "severity_level")

    severity_enum.drop(bind, checkfirst=True)
