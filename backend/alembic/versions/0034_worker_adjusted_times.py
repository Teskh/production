"""Add adjusted worker times from adjusted_times.csv.

Revision ID: 0034_worker_adjusted_times
Revises: 0033_drop_performance_events
Create Date: 2026-03-12
"""

from __future__ import annotations

import csv
import re
import unicodedata
from decimal import Decimal
from pathlib import Path

from alembic import op
import sqlalchemy as sa


revision = "0034_worker_adjusted_times"
down_revision = "0033_drop_performance_events"
branch_labels = None
depends_on = None


_TABLE = "workers"
_COLUMN = "adjusted_times"
_CSV_PATH = Path(__file__).resolve().parents[3] / "docs" / "references" / "adjusted_times.csv"


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def _normalize_name(value: str) -> str:
    text = _strip_accents(value or "").lower().strip()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _tokens(value: str) -> list[str]:
    return [token for token in _normalize_name(value).split(" ") if token]


def _read_csv_rows(path: Path) -> list[dict[str, str]]:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                reader = csv.DictReader(handle)
                return [
                    {str(key).strip(): (value or "").strip() for key, value in row.items()}
                    for row in reader
                ]
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"Unable to decode CSV file: {path}")


def _row_name(row: dict[str, str]) -> str:
    return row.get("NOMBRE_CORREGIDO") or row.get("NOMBRE") or ""


def _match_rank(target_name: str, worker: dict[str, object]) -> int:
    target_tokens = _tokens(target_name)
    if not target_tokens:
        return 0

    first_name = str(worker["first_name"] or "")
    last_name = str(worker["last_name"] or "")
    full_name = f"{first_name} {last_name}".strip()
    reversed_name = f"{last_name} {first_name}".strip()

    normalized_target = _normalize_name(target_name)
    if normalized_target in {_normalize_name(full_name), _normalize_name(reversed_name)}:
        return 3

    first_tokens = _tokens(first_name)
    last_tokens = _tokens(last_name)
    if (
        len(target_tokens) == 2
        and first_tokens
        and last_tokens
        and target_tokens[0] == first_tokens[0]
        and target_tokens[1] == last_tokens[0]
    ):
        return 2

    available_tokens = set(first_tokens + last_tokens)
    if all(token in available_tokens for token in target_tokens):
        return 1

    return 0


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _TABLE not in set(inspector.get_table_names()):
        return

    columns = {col["name"] for col in inspector.get_columns(_TABLE)}
    if _COLUMN not in columns:
        op.add_column(_TABLE, sa.Column(_COLUMN, sa.Numeric(5, 2), nullable=True))

    if not _CSV_PATH.exists():
        raise RuntimeError(f"Adjusted times CSV not found: {_CSV_PATH}")

    workers = sa.Table(_TABLE, sa.MetaData(), autoload_with=bind)
    worker_rows = [
        {
            "id": row.id,
            "first_name": row.first_name,
            "last_name": row.last_name,
        }
        for row in bind.execute(
            sa.select(workers.c.id, workers.c.first_name, workers.c.last_name)
        )
    ]

    updates: dict[int, Decimal] = {}
    for row in _read_csv_rows(_CSV_PATH):
        name = _row_name(row)
        if not name:
            continue

        raw_value = (row.get("TRABAJO OPERATIVO") or "").replace(",", ".").strip()
        if not raw_value:
            continue
        value = Decimal(raw_value).quantize(Decimal("0.01"))

        ranked_matches = [
            (_match_rank(name, worker), worker) for worker in worker_rows
        ]
        ranked_matches = [
            (rank, worker) for rank, worker in ranked_matches if rank > 0
        ]
        if not ranked_matches:
            raise RuntimeError(f"No worker match found for adjusted_times row '{name}'")

        best_rank = max(rank for rank, _worker in ranked_matches)
        matches = [worker for rank, worker in ranked_matches if rank == best_rank]
        if not matches:
            raise RuntimeError(f"No worker match found for adjusted_times row '{name}'")
        if len(matches) > 1:
            matched_ids = ", ".join(str(worker["id"]) for worker in matches)
            raise RuntimeError(
                f"Ambiguous worker match for adjusted_times row '{name}': {matched_ids}"
            )

        updates[int(matches[0]["id"])] = value

    for worker_id, value in updates.items():
        bind.execute(
            sa.update(workers)
            .where(workers.c.id == worker_id)
            .values({_COLUMN: value})
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _TABLE not in set(inspector.get_table_names()):
        return

    columns = {col["name"] for col in inspector.get_columns(_TABLE)}
    if _COLUMN in columns:
        op.drop_column(_TABLE, _COLUMN)
