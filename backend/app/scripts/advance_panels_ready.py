"""Advance panels that have no work left at their current station.

The application does this automatically whenever routing configuration changes; this
script is for repairing data changed outside the application. Each release is recorded
and can be undone from the Production Queue admin page.

Usage:
    python -m app.scripts.advance_panels_ready [--dry-run]

Options:
    --dry-run    Show what would be changed without making changes
"""

from __future__ import annotations

import argparse

from app.db.session import SessionLocal
from app.models.stations import Station
from app.services.panel_routing import TRIGGER_SCRIPT, release_stalled_panels


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Advance panels that have no work left at their current station."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without making changes",
    )
    args = parser.parse_args()
    prefix = "[DRY RUN] " if args.dry_run else ""

    with SessionLocal() as session:
        released = release_stalled_panels(
            session,
            trigger=TRIGGER_SCRIPT,
            reason="Script advance_panels_ready",
        )
        for item in released:
            panel = item.panel_unit
            destination = (
                session.get(Station, panel.current_station_id).name
                if panel.current_station_id
                else "completed"
            )
            print(
                f"{prefix}PanelUnit {panel.id}: {item.from_station.name} -> {destination}"
            )
        if args.dry_run:
            session.rollback()
        else:
            session.commit()

    print(f"{prefix}{len(released)} panel(s) released.")


if __name__ == "__main__":
    main()
