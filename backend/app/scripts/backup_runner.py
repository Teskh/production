from __future__ import annotations

import argparse
from app.services import backups as backup_service


def main() -> int:
    parser = argparse.ArgumentParser(description="Run scheduled database backups.")
    parser.add_argument("--force", action="store_true", help="Run backup regardless of schedule.")
    parser.add_argument("--label", type=str, default=None, help="Optional label for the backup.")
    args = parser.parse_args()

    settings = backup_service.load_backup_settings()
    if not args.force and not backup_service.is_backup_due(settings):
        print("Backup not due; exiting.")
        return 0

    backup_record, updated_settings, pruned = backup_service.create_backup(args.label)
    print(f"Backup created: {backup_record['filename']}")
    if pruned:
        print(f"Pruned backups: {', '.join(pruned)}")
    if updated_settings.get("last_backup_at"):
        print(f"Last backup timestamp: {updated_settings['last_backup_at']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
