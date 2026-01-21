"""Add QC applicability multi-select scope tables.

Revision ID: 0024_qc_applicability_multi
Revises: 0023_qc_app_drop_force
Create Date: 2026-01-19
"""

from alembic import op
import sqlalchemy as sa


revision = "0024_qc_applicability_multi"
down_revision = "0023_qc_app_drop_force"
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

    if "qc_applicability_house_types" not in table_names:
        op.create_table(
            "qc_applicability_house_types",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "applicability_id",
                sa.Integer(),
                sa.ForeignKey("qc_applicability.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "house_type_id",
                sa.Integer(),
                sa.ForeignKey("house_types.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.UniqueConstraint(
                "applicability_id",
                "house_type_id",
                name="uq_qc_app_house_type",
            ),
        )
        op.create_index(
            "ix_qc_app_house_types_applicability_id",
            "qc_applicability_house_types",
            ["applicability_id"],
        )
        op.create_index(
            "ix_qc_app_house_types_house_type_id",
            "qc_applicability_house_types",
            ["house_type_id"],
        )

    if "qc_applicability_sub_types" not in table_names:
        op.create_table(
            "qc_applicability_sub_types",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "applicability_id",
                sa.Integer(),
                sa.ForeignKey("qc_applicability.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "sub_type_id",
                sa.Integer(),
                sa.ForeignKey("house_sub_types.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.UniqueConstraint(
                "applicability_id",
                "sub_type_id",
                name="uq_qc_app_sub_type",
            ),
        )
        op.create_index(
            "ix_qc_app_sub_types_applicability_id",
            "qc_applicability_sub_types",
            ["applicability_id"],
        )
        op.create_index(
            "ix_qc_app_sub_types_sub_type_id",
            "qc_applicability_sub_types",
            ["sub_type_id"],
        )

    if "qc_applicability_panel_groups" not in table_names:
        op.create_table(
            "qc_applicability_panel_groups",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "applicability_id",
                sa.Integer(),
                sa.ForeignKey("qc_applicability.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("panel_group", sa.String(length=100), nullable=False),
            sa.UniqueConstraint(
                "applicability_id",
                "panel_group",
                name="uq_qc_app_panel_group",
            ),
        )
        op.create_index(
            "ix_qc_app_panel_groups_applicability_id",
            "qc_applicability_panel_groups",
            ["applicability_id"],
        )
        op.create_index(
            "ix_qc_app_panel_groups_panel_group",
            "qc_applicability_panel_groups",
            ["panel_group"],
        )

    columns = {column["name"] for column in inspector.get_columns("qc_applicability")}
    if "house_type_id" in columns:
        op.execute(
            sa.text(
                """
                INSERT INTO qc_applicability_house_types (applicability_id, house_type_id)
                SELECT id, house_type_id
                FROM qc_applicability
                WHERE house_type_id IS NOT NULL
                ON CONFLICT DO NOTHING
                """
            )
        )
    if "sub_type_id" in columns:
        op.execute(
            sa.text(
                """
                INSERT INTO qc_applicability_sub_types (applicability_id, sub_type_id)
                SELECT id, sub_type_id
                FROM qc_applicability
                WHERE sub_type_id IS NOT NULL
                ON CONFLICT DO NOTHING
                """
            )
        )
    if "panel_group" in columns:
        op.execute(
            sa.text(
                """
                INSERT INTO qc_applicability_panel_groups (applicability_id, panel_group)
                SELECT id, trim(panel_group)
                FROM qc_applicability
                WHERE panel_group IS NOT NULL AND trim(panel_group) <> ''
                ON CONFLICT DO NOTHING
                """
            )
        )

    if "house_type_id" in columns:
        _drop_fk_if_exists(inspector, "qc_applicability", "house_type_id")
        op.drop_column("qc_applicability", "house_type_id")
    if "sub_type_id" in columns:
        _drop_fk_if_exists(inspector, "qc_applicability", "sub_type_id")
        op.drop_column("qc_applicability", "sub_type_id")
    if "panel_group" in columns:
        op.drop_column("qc_applicability", "panel_group")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "qc_applicability" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("qc_applicability")}
    if "house_type_id" not in columns:
        op.add_column(
            "qc_applicability",
            sa.Column("house_type_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_qc_applicability_house_type_id",
            "qc_applicability",
            "house_types",
            ["house_type_id"],
            ["id"],
        )
    if "sub_type_id" not in columns:
        op.add_column(
            "qc_applicability",
            sa.Column("sub_type_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_qc_applicability_sub_type_id",
            "qc_applicability",
            "house_sub_types",
            ["sub_type_id"],
            ["id"],
        )
    if "panel_group" not in columns:
        op.add_column(
            "qc_applicability",
            sa.Column("panel_group", sa.String(length=100), nullable=True),
        )

    if "qc_applicability_house_types" in table_names:
        op.execute(
            sa.text(
                """
                UPDATE qc_applicability AS qa
                SET house_type_id = src.house_type_id
                FROM (
                    SELECT applicability_id, MIN(house_type_id) AS house_type_id
                    FROM qc_applicability_house_types
                    GROUP BY applicability_id
                ) AS src
                WHERE qa.id = src.applicability_id
                """
            )
        )
    if "qc_applicability_sub_types" in table_names:
        op.execute(
            sa.text(
                """
                UPDATE qc_applicability AS qa
                SET sub_type_id = src.sub_type_id
                FROM (
                    SELECT applicability_id, MIN(sub_type_id) AS sub_type_id
                    FROM qc_applicability_sub_types
                    GROUP BY applicability_id
                ) AS src
                WHERE qa.id = src.applicability_id
                """
            )
        )
    if "qc_applicability_panel_groups" in table_names:
        op.execute(
            sa.text(
                """
                UPDATE qc_applicability AS qa
                SET panel_group = src.panel_group
                FROM (
                    SELECT applicability_id, MIN(panel_group) AS panel_group
                    FROM qc_applicability_panel_groups
                    GROUP BY applicability_id
                ) AS src
                WHERE qa.id = src.applicability_id
                """
            )
        )

    if "qc_applicability_panel_groups" in table_names:
        op.drop_index(
            "ix_qc_app_panel_groups_panel_group",
            table_name="qc_applicability_panel_groups",
        )
        op.drop_index(
            "ix_qc_app_panel_groups_applicability_id",
            table_name="qc_applicability_panel_groups",
        )
        op.drop_table("qc_applicability_panel_groups")

    if "qc_applicability_sub_types" in table_names:
        op.drop_index(
            "ix_qc_app_sub_types_sub_type_id",
            table_name="qc_applicability_sub_types",
        )
        op.drop_index(
            "ix_qc_app_sub_types_applicability_id",
            table_name="qc_applicability_sub_types",
        )
        op.drop_table("qc_applicability_sub_types")

    if "qc_applicability_house_types" in table_names:
        op.drop_index(
            "ix_qc_app_house_types_house_type_id",
            table_name="qc_applicability_house_types",
        )
        op.drop_index(
            "ix_qc_app_house_types_applicability_id",
            table_name="qc_applicability_house_types",
        )
        op.drop_table("qc_applicability_house_types")
