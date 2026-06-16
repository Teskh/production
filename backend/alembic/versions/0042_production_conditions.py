"""Add production condition types, values, assignments and task requirements.

Revision ID: 0042_production_conditions
Revises: 0041_admin_page_permissions
Create Date: 2026-06-09
"""

from alembic import op
import sqlalchemy as sa


revision = "0042_production_conditions"
down_revision = "0041_admin_page_permissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "condition_types",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False, unique=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table(
        "condition_values",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "condition_type_id",
            sa.Integer(),
            sa.ForeignKey("condition_types.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.UniqueConstraint(
            "condition_type_id", "name", name="uq_condition_value_type_name"
        ),
    )
    op.create_index(
        "ix_condition_values_condition_type_id",
        "condition_values",
        ["condition_type_id"],
    )
    op.create_table(
        "work_unit_conditions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "work_unit_id",
            sa.Integer(),
            sa.ForeignKey("work_units.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "condition_value_id",
            sa.Integer(),
            sa.ForeignKey("condition_values.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "work_unit_id", "condition_value_id", name="uq_work_unit_condition"
        ),
    )
    op.create_index(
        "ix_work_unit_conditions_work_unit_id",
        "work_unit_conditions",
        ["work_unit_id"],
    )
    op.create_index(
        "ix_work_unit_conditions_condition_value_id",
        "work_unit_conditions",
        ["condition_value_id"],
    )
    op.create_table(
        "task_condition_requirements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "task_definition_id",
            sa.Integer(),
            sa.ForeignKey("task_definitions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "condition_value_id",
            sa.Integer(),
            sa.ForeignKey("condition_values.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "task_definition_id",
            "condition_value_id",
            name="uq_task_condition_requirement",
        ),
    )
    op.create_index(
        "ix_task_condition_requirements_task_definition_id",
        "task_condition_requirements",
        ["task_definition_id"],
    )
    op.create_index(
        "ix_task_condition_requirements_condition_value_id",
        "task_condition_requirements",
        ["condition_value_id"],
    )


def downgrade() -> None:
    op.drop_table("task_condition_requirements")
    op.drop_table("work_unit_conditions")
    op.drop_table("condition_values")
    op.drop_table("condition_types")
