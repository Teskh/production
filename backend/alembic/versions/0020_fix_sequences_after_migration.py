"""Fix sequences after legacy data migration.

Revision ID: 0020_fix_sequences
Revises: 0019_admin_user_pin_length
Create Date: 2026-01-09
"""

from alembic import op
import sqlalchemy as sa


revision = "0020_fix_sequences"
down_revision = "0019_admin_user_pin_length"
branch_labels = None
depends_on = None

TABLES_WITH_SEQUENCES = [
    "task_pauses",
    "task_instances",
    "task_participations",
    "task_exceptions",
    "task_definitions",
    "task_applicabilities",
    "task_expected_durations",
    "task_skill_requirements",
    "task_worker_restrictions",
    "workers",
    "worker_skills",
    "work_orders",
    "work_units",
    "panel_units",
    "panel_definitions",
    "house_types",
    "house_sub_types",
    "house_parameters",
    "house_parameter_values",
    "pause_reasons",
    "comment_templates",
    "skills",
    "stations",
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table_name in TABLES_WITH_SEQUENCES:
        if not inspector.has_table(table_name):
            continue

        columns = {col["name"] for col in inspector.get_columns(table_name)}
        if "id" not in columns:
            continue

        bind.execute(
            sa.text(f"""
                SELECT setval(
                    pg_get_serial_sequence('{table_name}', 'id'),
                    COALESCE((SELECT MAX(id) FROM {table_name}), 0) + 1,
                    false
                )
            """)
        )


def downgrade() -> None:
    pass
