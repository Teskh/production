"""Add QC rework logging and sampling state adjustments.

Revision ID: 0017_qc_rework_sampling
Revises: 0016_qc_check_media
Create Date: 2026-01-09
"""

from alembic import op
import sqlalchemy as sa


revision = "0017_qc_rework_sampling"
down_revision = "0016_qc_check_media"
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

    if "task_definitions" in table_names:
        columns = {column["name"] for column in inspector.get_columns("task_definitions")}
        if "is_rework" not in columns:
            op.add_column(
                "task_definitions",
                sa.Column(
                    "is_rework",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            )

    if "task_instances" in table_names:
        columns = {column["name"] for column in inspector.get_columns("task_instances")}
        if "rework_task_id" not in columns:
            op.add_column(
                "task_instances",
                sa.Column("rework_task_id", sa.Integer(), nullable=True),
            )
            op.create_foreign_key(
                "fk_task_instances_rework_task_id",
                "task_instances",
                "qc_rework_tasks",
                ["rework_task_id"],
                ["id"],
            )
            op.create_index(
                "ix_task_instances_rework_task_id",
                "task_instances",
                ["rework_task_id"],
            )

    if "qc_triggers" in table_names:
        columns = {column["name"] for column in inspector.get_columns("qc_triggers")}
        if "current_sampling_rate" not in columns:
            op.add_column(
                "qc_triggers",
                sa.Column("current_sampling_rate", sa.Float(), nullable=True),
            )

    if "qc_check_instances" in table_names:
        columns = {column["name"] for column in inspector.get_columns("qc_check_instances")}
        if "sampling_selected" in columns:
            op.drop_column("qc_check_instances", "sampling_selected")
        if "sampling_probability" in columns:
            op.drop_column("qc_check_instances", "sampling_probability")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "qc_check_instances" in table_names:
        columns = {column["name"] for column in inspector.get_columns("qc_check_instances")}
        if "sampling_selected" not in columns:
            op.add_column(
                "qc_check_instances",
                sa.Column(
                    "sampling_selected",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.true(),
                ),
            )
        if "sampling_probability" not in columns:
            op.add_column(
                "qc_check_instances",
                sa.Column(
                    "sampling_probability",
                    sa.Float(),
                    nullable=False,
                    server_default=sa.text("1.0"),
                ),
            )

    if "qc_triggers" in table_names:
        columns = {column["name"] for column in inspector.get_columns("qc_triggers")}
        if "current_sampling_rate" in columns:
            op.drop_column("qc_triggers", "current_sampling_rate")

    if "task_instances" in table_names:
        columns = {column["name"] for column in inspector.get_columns("task_instances")}
        if "rework_task_id" in columns:
            _drop_fk_if_exists(inspector, "task_instances", "rework_task_id")
            _drop_index_if_exists(inspector, "task_instances", "ix_task_instances_rework_task_id")
            op.drop_column("task_instances", "rework_task_id")

    if "task_definitions" in table_names:
        columns = {column["name"] for column in inspector.get_columns("task_definitions")}
        if "is_rework" in columns:
            op.drop_column("task_definitions", "is_rework")
