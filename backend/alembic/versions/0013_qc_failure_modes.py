"""Add QC categories, severity levels, and failure modes.

Revision ID: 0013_qc_failure_modes
Revises: 0012_drop_default_applicability
Create Date: 2026-01-08
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0013_qc_failure_modes"
down_revision = "0012_drop_default_applicability"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("qc_check_categories"):
        op.create_table(
            "qc_check_categories",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("parent_id", sa.Integer(), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False, default=True),
            sa.Column("sort_order", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["parent_id"], ["qc_check_categories.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    index_names = {idx["name"] for idx in inspector.get_indexes("qc_check_categories")}
    if "ix_qc_check_categories_parent_id" not in index_names:
        op.create_index(
            "ix_qc_check_categories_parent_id",
            "qc_check_categories",
            ["parent_id"],
        )

    if not inspector.has_table("qc_severity_levels"):
        op.create_table(
            "qc_severity_levels",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False, default=True),
            sa.PrimaryKeyConstraint("id"),
        )

    if not inspector.has_table("qc_check_severity_options"):
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
    index_names = {
        idx["name"] for idx in inspector.get_indexes("qc_check_severity_options")
    }
    if "ix_qc_check_severity_options_check_definition_id" not in index_names:
        op.create_index(
            "ix_qc_check_severity_options_check_definition_id",
            "qc_check_severity_options",
            ["check_definition_id"],
        )
    if "ix_qc_check_severity_options_severity_level_id" not in index_names:
        op.create_index(
            "ix_qc_check_severity_options_severity_level_id",
            "qc_check_severity_options",
            ["severity_level_id"],
        )

    if not inspector.has_table("qc_failure_mode_definitions"):
        op.create_table(
            "qc_failure_mode_definitions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("check_definition_id", sa.Integer(), nullable=True),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("default_severity_level_id", sa.Integer(), nullable=True),
            sa.Column("default_rework_description", sa.Text(), nullable=True),
            sa.Column("require_evidence", sa.Boolean(), nullable=False, default=False),
            sa.Column("require_measurement", sa.Boolean(), nullable=False, default=False),
            sa.Column("active", sa.Boolean(), nullable=False, default=True),
            sa.Column("created_by_user_id", sa.Integer(), nullable=True),
            sa.Column("archived_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(
                ["check_definition_id"], ["qc_check_definitions.id"]
            ),
            sa.ForeignKeyConstraint(
                ["default_severity_level_id"], ["qc_severity_levels.id"]
            ),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["admin_users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    index_names = {
        idx["name"] for idx in inspector.get_indexes("qc_failure_mode_definitions")
    }
    if "ix_qc_failure_mode_definitions_check_definition_id" not in index_names:
        op.create_index(
            "ix_qc_failure_mode_definitions_check_definition_id",
            "qc_failure_mode_definitions",
            ["check_definition_id"],
        )
    if "ix_qc_failure_mode_definitions_default_severity_level_id" not in index_names:
        op.create_index(
            "ix_qc_failure_mode_definitions_default_severity_level_id",
            "qc_failure_mode_definitions",
            ["default_severity_level_id"],
        )
    if "ix_qc_failure_mode_definitions_created_by_user_id" not in index_names:
        op.create_index(
            "ix_qc_failure_mode_definitions_created_by_user_id",
            "qc_failure_mode_definitions",
            ["created_by_user_id"],
        )

    if not inspector.has_table("qc_execution_failure_modes"):
        op.create_table(
            "qc_execution_failure_modes",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("execution_id", sa.Integer(), nullable=False),
            sa.Column("failure_mode_definition_id", sa.Integer(), nullable=True),
            sa.Column("other_text", sa.Text(), nullable=True),
            sa.Column("measurement_json", postgresql.JSONB(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["execution_id"], ["qc_executions.id"]),
            sa.ForeignKeyConstraint(
                ["failure_mode_definition_id"], ["qc_failure_mode_definitions.id"]
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    index_names = {
        idx["name"] for idx in inspector.get_indexes("qc_execution_failure_modes")
    }
    if "ix_qc_execution_failure_modes_execution_id" not in index_names:
        op.create_index(
            "ix_qc_execution_failure_modes_execution_id",
            "qc_execution_failure_modes",
            ["execution_id"],
        )
    if "ix_qc_execution_failure_modes_failure_mode_definition_id" not in index_names:
        op.create_index(
            "ix_qc_execution_failure_modes_failure_mode_definition_id",
            "qc_execution_failure_modes",
            ["failure_mode_definition_id"],
        )

    qc_check_definition_cols = {
        col["name"] for col in inspector.get_columns("qc_check_definitions")
    }
    if "category_id" not in qc_check_definition_cols:
        op.add_column(
            "qc_check_definitions",
            sa.Column("category_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_qc_check_definitions_category_id",
            "qc_check_definitions",
            "qc_check_categories",
            ["category_id"],
            ["id"],
        )
    index_names = {idx["name"] for idx in inspector.get_indexes("qc_check_definitions")}
    if "ix_qc_check_definitions_category_id" not in index_names:
        op.create_index(
            "ix_qc_check_definitions_category_id",
            "qc_check_definitions",
            ["category_id"],
        )

    qc_check_instance_cols = {
        col["name"] for col in inspector.get_columns("qc_check_instances")
    }
    if "severity_level_id" not in qc_check_instance_cols:
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
    index_names = {idx["name"] for idx in inspector.get_indexes("qc_check_instances")}
    if "ix_qc_check_instances_severity_level_id" not in index_names:
        op.create_index(
            "ix_qc_check_instances_severity_level_id",
            "qc_check_instances",
            ["severity_level_id"],
        )


def downgrade() -> None:
    op.drop_index(
        "ix_qc_check_instances_severity_level_id",
        table_name="qc_check_instances",
    )
    op.drop_constraint(
        "fk_qc_check_instances_severity_level_id",
        "qc_check_instances",
        type_="foreignkey",
    )
    op.drop_column("qc_check_instances", "severity_level_id")

    op.drop_index(
        "ix_qc_check_definitions_category_id",
        table_name="qc_check_definitions",
    )
    op.drop_constraint(
        "fk_qc_check_definitions_category_id",
        "qc_check_definitions",
        type_="foreignkey",
    )
    op.drop_column("qc_check_definitions", "category_id")

    op.drop_index(
        "ix_qc_execution_failure_modes_failure_mode_definition_id",
        table_name="qc_execution_failure_modes",
    )
    op.drop_index(
        "ix_qc_execution_failure_modes_execution_id",
        table_name="qc_execution_failure_modes",
    )
    op.drop_table("qc_execution_failure_modes")

    op.drop_index(
        "ix_qc_failure_mode_definitions_created_by_user_id",
        table_name="qc_failure_mode_definitions",
    )
    op.drop_index(
        "ix_qc_failure_mode_definitions_default_severity_level_id",
        table_name="qc_failure_mode_definitions",
    )
    op.drop_index(
        "ix_qc_failure_mode_definitions_check_definition_id",
        table_name="qc_failure_mode_definitions",
    )
    op.drop_table("qc_failure_mode_definitions")

    op.drop_index(
        "ix_qc_check_severity_options_severity_level_id",
        table_name="qc_check_severity_options",
    )
    op.drop_index(
        "ix_qc_check_severity_options_check_definition_id",
        table_name="qc_check_severity_options",
    )
    op.drop_table("qc_check_severity_options")

    op.drop_table("qc_severity_levels")

    op.drop_index(
        "ix_qc_check_categories_parent_id",
        table_name="qc_check_categories",
    )
    op.drop_table("qc_check_categories")
