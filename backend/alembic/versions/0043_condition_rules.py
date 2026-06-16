"""Replace flat task condition requirements with is/is-not rules.

Existing requirements migrate to one 'is' rule per (task, condition type),
scoped to all house types — preserving prior behavior exactly.

Revision ID: 0043_condition_rules
Revises: 0042_production_conditions
Create Date: 2026-06-11
"""

from alembic import op
import sqlalchemy as sa


revision = "0043_condition_rules"
down_revision = "0042_production_conditions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_condition_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "task_definition_id",
            sa.Integer(),
            sa.ForeignKey("task_definitions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "condition_type_id",
            sa.Integer(),
            sa.ForeignKey("condition_types.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "house_type_id",
            sa.Integer(),
            sa.ForeignKey("house_types.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("mode", sa.String(length=10), nullable=False, server_default="is"),
    )
    op.create_index(
        "ix_task_condition_rules_task_definition_id",
        "task_condition_rules",
        ["task_definition_id"],
    )
    op.create_index(
        "ix_task_condition_rules_condition_type_id",
        "task_condition_rules",
        ["condition_type_id"],
    )
    op.create_table(
        "task_condition_rule_values",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "rule_id",
            sa.Integer(),
            sa.ForeignKey("task_condition_rules.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "condition_value_id",
            sa.Integer(),
            sa.ForeignKey("condition_values.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "rule_id", "condition_value_id", name="uq_task_condition_rule_value"
        ),
    )
    op.create_index(
        "ix_task_condition_rule_values_rule_id",
        "task_condition_rule_values",
        ["rule_id"],
    )
    op.create_index(
        "ix_task_condition_rule_values_condition_value_id",
        "task_condition_rule_values",
        ["condition_value_id"],
    )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            insert into task_condition_rules (task_definition_id, condition_type_id, mode)
            select distinct req.task_definition_id, cv.condition_type_id, 'is'
            from task_condition_requirements req
            join condition_values cv on cv.id = req.condition_value_id
            """
        )
    )
    bind.execute(
        sa.text(
            """
            insert into task_condition_rule_values (rule_id, condition_value_id)
            select rule.id, req.condition_value_id
            from task_condition_requirements req
            join condition_values cv on cv.id = req.condition_value_id
            join task_condition_rules rule
              on rule.task_definition_id = req.task_definition_id
             and rule.condition_type_id = cv.condition_type_id
             and rule.house_type_id is null
             and rule.mode = 'is'
            """
        )
    )
    op.drop_table("task_condition_requirements")


def downgrade() -> None:
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
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            insert into task_condition_requirements (task_definition_id, condition_value_id)
            select distinct rule.task_definition_id, rv.condition_value_id
            from task_condition_rules rule
            join task_condition_rule_values rv on rv.rule_id = rule.id
            where rule.mode = 'is' and rule.house_type_id is null
            """
        )
    )
    op.drop_table("task_condition_rule_values")
    op.drop_table("task_condition_rules")
