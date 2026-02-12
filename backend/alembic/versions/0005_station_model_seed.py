"""Rebuild stations with new schema and seed data.

Revision ID: 0005_station_model_seed
Revises: 0004_task_applicability_applies
Create Date: 2025-12-31
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_station_model_seed"
down_revision = "0004_task_applicability_applies"
branch_labels = None
depends_on = None


_STATION_ID_MAP = {
    "W1": 1,
    "W2": 2,
    "W3": 3,
    "W4": 4,
    "W5": 5,
    "W6": 6,
    "W7": 7,
    "W8": 8,
    "W9": 9,
    "M1": 10,
    "A0": 11,
    "B0": 12,
    "C0": 13,
    "A1": 14,
    "B1": 15,
    "C1": 16,
    "A2": 17,
    "B2": 18,
    "C2": 19,
    "A3": 20,
    "B3": 21,
    "C3": 22,
    "A4": 23,
    "B4": 24,
    "C4": 25,
    "A5": 26,
    "B5": 27,
    "C5": 28,
    "A6": 29,
    "B6": 30,
    "C6": 31,
    "AUX1": 32,
}


def _case_mapping(column: str) -> str:
    cases = []
    for legacy_id, new_id in _STATION_ID_MAP.items():
        cases.append(f"WHEN {column} = '{legacy_id}' THEN '{new_id}'")
    cases.append(f"WHEN {column} ~ '^[0-9]+$' THEN {column}")
    return "CASE " + " ".join(cases) + " ELSE NULL END"


def _remap_station_id(table: str, column: str) -> None:
    op.execute(
        f"UPDATE {table} SET {column} = {_case_mapping(column)}"
    )


def _remap_station_id_array(table: str, column: str) -> None:
    array_source = (
        f"CASE "
        f"WHEN jsonb_typeof({table}.{column}) = 'array' THEN {table}.{column} "
        f"WHEN jsonb_typeof({table}.{column}) IN ('string', 'number') "
        f"THEN jsonb_build_array({table}.{column}) "
        f"ELSE '[]'::jsonb END"
    )
    cases = []
    for legacy_id, new_id in _STATION_ID_MAP.items():
        cases.append(f"WHEN value = '{legacy_id}' THEN {new_id}")
    cases.append("WHEN value ~ '^[0-9]+$' THEN value::int")
    case_sql = "CASE " + " ".join(cases) + " ELSE NULL END"
    op.execute(
        f"""
        UPDATE {table}
        SET {column} = (
            SELECT jsonb_agg(mapped_id)
            FROM (
                SELECT {case_sql} AS mapped_id
                FROM jsonb_array_elements_text({array_source}) AS value
            ) mapped
            WHERE mapped_id IS NOT NULL
        )
        WHERE {column} IS NOT NULL
        """
    )


def upgrade() -> None:
    conn = op.get_bind()
    op.execute("DROP TABLE IF EXISTS stations CASCADE")

    for table, column in (
        ("work_units", "current_station_id"),
        ("panel_units", "current_station_id"),
        ("task_instances", "station_id"),
        ("task_exceptions", "station_id"),
        ("qc_check_instances", "station_id"),
    ):
        data_type = conn.execute(
            sa.text(
                """
                SELECT data_type
                FROM information_schema.columns
                WHERE table_name = :table_name AND column_name = :column_name
                """
            ),
            {"table_name": table, "column_name": column},
        ).scalar_one_or_none()
        if data_type and data_type.lower() in {"integer", "bigint"}:
            continue
        _remap_station_id(table, column)
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN {column} TYPE INTEGER USING {column}::integer"
        )

    for table, column in (
        ("workers", "assigned_station_ids"),
        ("pause_reasons", "applicable_station_ids"),
        ("comment_templates", "applicable_station_ids"),
    ):
        array_source = (
            f"CASE "
            f"WHEN jsonb_typeof({table}.{column}) = 'array' THEN {table}.{column} "
            f"WHEN jsonb_typeof({table}.{column}) IN ('string', 'number') "
            f"THEN jsonb_build_array({table}.{column}) "
            f"ELSE '[]'::jsonb END"
        )
        legacy_ids = conn.execute(
            sa.text(
                f"""
                SELECT 1
                FROM {table}
                WHERE {column} IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text({array_source}) AS value
                    WHERE value = ANY(:legacy_ids)
                )
                LIMIT 1
                """
            ),
            {"legacy_ids": list(_STATION_ID_MAP.keys())},
        ).scalar_one_or_none()
        if legacy_ids:
            _remap_station_id_array(table, column)

    op.execute("DROP TYPE IF EXISTS stationlinetype")
    op.execute("DROP TYPE IF EXISTS stationrole")

    station_line_type = sa.Enum("1", "2", "3", name="stationlinetype")
    station_role = sa.Enum("Panels", "Magazine", "Assembly", "AUX", name="stationrole")

    op.create_table(
        "stations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("line_type", station_line_type, nullable=True),
        sa.Column("sequence_order", sa.Integer(), nullable=True),
        sa.Column("role", station_role, nullable=False),
    )

    station_table = sa.table(
        "stations",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("line_type", station_line_type),
        sa.column("sequence_order", sa.Integer()),
        sa.column("role", station_role),
    )
    op.bulk_insert(
        station_table,
        [
            {"id": 1, "name": "Framing", "role": "Panels", "line_type": None, "sequence_order": 1},
            {"id": 2, "name": "Mesa 1", "role": "Panels", "line_type": None, "sequence_order": 2},
            {"id": 3, "name": "Puente 1", "role": "Panels", "line_type": None, "sequence_order": 3},
            {"id": 4, "name": "Mesa 2", "role": "Panels", "line_type": None, "sequence_order": 4},
            {"id": 5, "name": "Puente 2", "role": "Panels", "line_type": None, "sequence_order": 5},
            {"id": 6, "name": "Mesa 3", "role": "Panels", "line_type": None, "sequence_order": 6},
            {"id": 7, "name": "Puente 3", "role": "Panels", "line_type": None, "sequence_order": 7},
            {"id": 8, "name": "Mesa 4", "role": "Panels", "line_type": None, "sequence_order": 8},
            {"id": 9, "name": "Puente 4", "role": "Panels", "line_type": None, "sequence_order": 9},
            {"id": 10, "name": "Magazine", "role": "Magazine", "line_type": None, "sequence_order": 10},
            {"id": 11, "name": "Armado", "role": "Assembly", "line_type": "1", "sequence_order": 11},
            {"id": 12, "name": "Armado", "role": "Assembly", "line_type": "2", "sequence_order": 11},
            {"id": 13, "name": "Armado", "role": "Assembly", "line_type": "3", "sequence_order": 11},
            {"id": 14, "name": "Estacion 1", "role": "Assembly", "line_type": "1", "sequence_order": 12},
            {"id": 15, "name": "Estacion 1", "role": "Assembly", "line_type": "2", "sequence_order": 12},
            {"id": 16, "name": "Estacion 1", "role": "Assembly", "line_type": "3", "sequence_order": 12},
            {"id": 17, "name": "Estacion 2", "role": "Assembly", "line_type": "1", "sequence_order": 13},
            {"id": 18, "name": "Estacion 2", "role": "Assembly", "line_type": "2", "sequence_order": 13},
            {"id": 19, "name": "Estacion 2", "role": "Assembly", "line_type": "3", "sequence_order": 13},
            {"id": 20, "name": "Estacion 3", "role": "Assembly", "line_type": "1", "sequence_order": 14},
            {"id": 21, "name": "Estacion 3", "role": "Assembly", "line_type": "2", "sequence_order": 14},
            {"id": 22, "name": "Estacion 3", "role": "Assembly", "line_type": "3", "sequence_order": 14},
            {"id": 23, "name": "Estacion 4", "role": "Assembly", "line_type": "1", "sequence_order": 15},
            {"id": 24, "name": "Estacion 4", "role": "Assembly", "line_type": "2", "sequence_order": 15},
            {"id": 25, "name": "Estacion 4", "role": "Assembly", "line_type": "3", "sequence_order": 15},
            {"id": 26, "name": "Estacion 5", "role": "Assembly", "line_type": "1", "sequence_order": 16},
            {"id": 27, "name": "Estacion 5", "role": "Assembly", "line_type": "2", "sequence_order": 16},
            {"id": 28, "name": "Estacion 5", "role": "Assembly", "line_type": "3", "sequence_order": 16},
            {"id": 29, "name": "Estacion 6", "role": "Assembly", "line_type": "1", "sequence_order": 17},
            {"id": 30, "name": "Estacion 6", "role": "Assembly", "line_type": "2", "sequence_order": 17},
            {"id": 31, "name": "Estacion 6", "role": "Assembly", "line_type": "3", "sequence_order": 17},
            {"id": 32, "name": "Precorte Holzma", "role": "AUX", "line_type": None, "sequence_order": None},
        ],
    )
    op.execute(
        "SELECT setval(pg_get_serial_sequence('stations', 'id'), (SELECT MAX(id) FROM stations))"
    )

    op.create_foreign_key(
        "work_units_current_station_id_fkey",
        "work_units",
        "stations",
        ["current_station_id"],
        ["id"],
    )
    op.create_foreign_key(
        "panel_units_current_station_id_fkey",
        "panel_units",
        "stations",
        ["current_station_id"],
        ["id"],
    )
    op.create_foreign_key(
        "task_instances_station_id_fkey",
        "task_instances",
        "stations",
        ["station_id"],
        ["id"],
    )
    op.create_foreign_key(
        "task_exceptions_station_id_fkey",
        "task_exceptions",
        "stations",
        ["station_id"],
        ["id"],
    )
    op.create_foreign_key(
        "qc_check_instances_station_id_fkey",
        "qc_check_instances",
        "stations",
        ["station_id"],
        ["id"],
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS stations CASCADE")
    op.execute("DROP TYPE IF EXISTS stationlinetype")
    op.execute("DROP TYPE IF EXISTS stationrole")
