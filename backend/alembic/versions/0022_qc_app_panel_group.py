"""Switch QC applicability to panel groups.

Revision ID: 0022_qc_app_panel_group
Revises: 0021_drop_work_order_plan_fields
Create Date: 2026-01-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0022_qc_app_panel_group"
down_revision = "0021_drop_work_order_plan_fields"
branch_labels = None
depends_on = None


def _drop_fk_if_exists(inspector: sa.Inspector, table: str, column: str) -> None:
    for fk in inspector.get_foreign_keys(table):
        if column in fk.get("constrained_columns", []):
            if fk.get("name"):
                op.drop_constraint(fk["name"], table, type_="foreignkey")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "qc_applicability" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("qc_applicability")}

    if "panel_group" not in columns:
        op.add_column(
            "qc_applicability",
            sa.Column("panel_group", sa.String(length=100), nullable=True),
        )
    if "panel_definition_id" in columns:
        _drop_fk_if_exists(inspector, "qc_applicability", "panel_definition_id")
        op.drop_column("qc_applicability", "panel_definition_id")
    if "module_number" in columns:
        op.drop_column("qc_applicability", "module_number")
    if "effective_from" in columns:
        op.drop_column("qc_applicability", "effective_from")
    if "effective_to" in columns:
        op.drop_column("qc_applicability", "effective_to")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "qc_applicability" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("qc_applicability")}
    has_panel_fk = any(
        "panel_definition_id" in fk.get("constrained_columns", [])
        for fk in inspector.get_foreign_keys("qc_applicability")
    )

    add_panel_definition = "panel_definition_id" not in columns
    if add_panel_definition:
        op.add_column(
            "qc_applicability",
            sa.Column("panel_definition_id", sa.Integer(), nullable=True),
        )
    if (not has_panel_fk) and (add_panel_definition or "panel_definition_id" in columns):
        op.create_foreign_key(
            "fk_qc_applicability_panel_definition_id",
            "qc_applicability",
            "panel_definitions",
            ["panel_definition_id"],
            ["id"],
        )
    if "module_number" not in columns:
        op.add_column("qc_applicability", sa.Column("module_number", sa.Integer(), nullable=True))
    if "effective_from" not in columns:
        op.add_column("qc_applicability", sa.Column("effective_from", sa.Date(), nullable=True))
    if "effective_to" not in columns:
        op.add_column("qc_applicability", sa.Column("effective_to", sa.Date(), nullable=True))
    if "panel_group" in columns:
        op.drop_column("qc_applicability", "panel_group")
