"""Archive panel and task definitions without deleting production history.

Revision ID: 0048_definition_archiving
Revises: 0047_qc_execution_time_idx
Create Date: 2026-07-22
"""

from alembic import op
import sqlalchemy as sa


revision = "0048_definition_archiving"
down_revision = "0047_qc_execution_time_idx"
branch_labels = None
depends_on = None


def _add_archive_columns(table_name: str) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns(table_name)}

    if "archived_at" not in columns:
        op.add_column(table_name, sa.Column("archived_at", sa.DateTime(), nullable=True))
    if "archived_by_user_id" not in columns:
        op.add_column(
            table_name,
            sa.Column("archived_by_user_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            f"fk_{table_name}_archived_by_user_id",
            table_name,
            "admin_users",
            ["archived_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )

    indexes = {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}
    index_name = f"ix_{table_name}_archived_at"
    if index_name not in indexes:
        op.create_index(index_name, table_name, ["archived_at"])


def upgrade() -> None:
    _add_archive_columns("panel_definitions")
    _add_archive_columns("task_definitions")


def _drop_archive_columns(table_name: str) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes(table_name)}
    index_name = f"ix_{table_name}_archived_at"
    if index_name in indexes:
        op.drop_index(index_name, table_name=table_name)

    foreign_keys = {fk["name"] for fk in sa.inspect(bind).get_foreign_keys(table_name)}
    fk_name = f"fk_{table_name}_archived_by_user_id"
    if fk_name in foreign_keys:
        op.drop_constraint(fk_name, table_name, type_="foreignkey")

    columns = {column["name"] for column in sa.inspect(bind).get_columns(table_name)}
    if "archived_by_user_id" in columns:
        op.drop_column(table_name, "archived_by_user_id")
    if "archived_at" in columns:
        op.drop_column(table_name, "archived_at")


def downgrade() -> None:
    _drop_archive_columns("task_definitions")
    _drop_archive_columns("panel_definitions")
