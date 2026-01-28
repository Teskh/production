"""Normalize legacy assembly line identifiers on work units.

Usage:
    python -m app.scripts.normalize_line_types [--dry-run]

This script converts planned_assembly_line values of A/B/C to 1/2/3.
Unknown values are reported and left unchanged.
"""

from __future__ import annotations

import argparse

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.work import WorkUnit


LINE_MAP = {
    "A": "1",
    "B": "2",
    "C": "3",
}
VALID_LINES = {"1", "2", "3"}


def _normalize(value: str) -> str:
    return value.strip().upper()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Normalize planned_assembly_line values from A/B/C to 1/2/3"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without making changes",
    )
    args = parser.parse_args()

    with SessionLocal() as session:
        rows = list(
            session.execute(
                select(WorkUnit).where(WorkUnit.planned_assembly_line.isnot(None))
            ).scalars()
        )

        updated = 0
        unknown: list[tuple[int, str]] = []
        for unit in rows:
            raw = unit.planned_assembly_line
            if raw is None:
                continue
            normalized = _normalize(raw)
            if normalized in VALID_LINES:
                continue
            mapped = LINE_MAP.get(normalized)
            if mapped is None:
                unknown.append((unit.id, raw))
                continue
            updated += 1
            print(f"WorkUnit {unit.id}: {raw} -> {mapped}")
            if not args.dry_run:
                unit.planned_assembly_line = mapped

        print("-" * 60)
        print(f"Matched {updated} legacy values.")
        if unknown:
            print(f"Found {len(unknown)} unknown values (left unchanged):")
            for unit_id, value in unknown:
                print(f"  WorkUnit {unit_id}: {value}")
        if args.dry_run:
            print("Dry run - no changes made. Run without --dry-run to apply.")
        else:
            session.commit()
            print("Changes committed.")


if __name__ == "__main__":
    main()
