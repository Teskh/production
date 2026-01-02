"""Add GeoVictoria worker fields.

Revision ID: 0002_add_geovictoria_fields
Revises: 0001_initial
Create Date: 2025-12-30
"""

from alembic import op
import sqlalchemy as sa


def _column_exists(conn, table: str, column: str) -> bool:
    inspector = sa.inspect(conn)
    return any(col["name"] == column for col in inspector.get_columns(table))


def _unique_constraint_exists(conn, table: str, columns: list[str]) -> bool:
    inspector = sa.inspect(conn)
    target = sorted(columns)
    for constraint in inspector.get_unique_constraints(table):
        if sorted(constraint.get("column_names") or []) == target:
            return True
    return False

revision = "0002_add_geovictoria_fields"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if not _column_exists(conn, "workers", "geovictoria_id"):
        op.add_column(
            "workers", sa.Column("geovictoria_id", sa.String(length=64), nullable=True)
        )
    if not _column_exists(conn, "workers", "geovictoria_identifier"):
        op.add_column(
            "workers",
            sa.Column("geovictoria_identifier", sa.String(length=32), nullable=True),
        )
    if not _unique_constraint_exists(conn, "workers", ["geovictoria_id"]):
        op.create_unique_constraint(
            "uq_workers_geovictoria_id", "workers", ["geovictoria_id"]
        )
    if not _unique_constraint_exists(conn, "workers", ["geovictoria_identifier"]):
        op.create_unique_constraint(
            "uq_workers_geovictoria_identifier",
            "workers",
            ["geovictoria_identifier"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    for constraint in inspector.get_unique_constraints("workers"):
        columns = constraint.get("column_names") or []
        name = constraint.get("name")
        if not name:
            continue
        if columns == ["geovictoria_identifier"]:
            op.drop_constraint(name, "workers", type_="unique")
        if columns == ["geovictoria_id"]:
            op.drop_constraint(name, "workers", type_="unique")
    if _column_exists(conn, "workers", "geovictoria_identifier"):
        op.drop_column("workers", "geovictoria_identifier")
    if _column_exists(conn, "workers", "geovictoria_id"):
        op.drop_column("workers", "geovictoria_id")
