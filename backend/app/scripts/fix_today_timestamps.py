"""One-off script to fix timestamps recorded with +3 hour offset.

Due to a UTC vs local time bug, tasks performed today were recorded
with timestamps 3 hours ahead. This script subtracts 3 hours from
all task_instances and task_participations timestamps that fall on today's date.

Usage:
    python -m app.scripts.fix_today_timestamps [--dry-run]

Options:
    --dry-run    Show what would be changed without making changes
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta

from sqlalchemy import select, and_, or_
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.tasks import TaskInstance, TaskParticipation, TaskPause


OFFSET = timedelta(hours=3)


def get_today_range() -> tuple[datetime, datetime]:
    """Get datetime range for today (midnight to midnight)."""
    today = date.today()
    start = datetime(today.year, today.month, today.day, 0, 0, 0)
    end = datetime(today.year, today.month, today.day, 23, 59, 59, 999999)
    return start, end


def fix_task_instances(db: Session, dry_run: bool) -> int:
    """Fix timestamps on task_instances from today."""
    start, end = get_today_range()
    
    instances = list(
        db.execute(
            select(TaskInstance).where(
                or_(
                    and_(
                        TaskInstance.started_at >= start,
                        TaskInstance.started_at <= end,
                    ),
                    and_(
                        TaskInstance.completed_at >= start,
                        TaskInstance.completed_at <= end,
                    ),
                )
            )
        ).scalars()
    )
    
    count = 0
    for instance in instances:
        changes = []
        if instance.started_at and start <= instance.started_at <= end:
            old_val = instance.started_at
            new_val = old_val - OFFSET
            changes.append(f"started_at: {old_val} -> {new_val}")
            if not dry_run:
                instance.started_at = new_val
        
        if instance.completed_at and start <= instance.completed_at <= end:
            old_val = instance.completed_at
            new_val = old_val - OFFSET
            changes.append(f"completed_at: {old_val} -> {new_val}")
            if not dry_run:
                instance.completed_at = new_val
        
        if changes:
            count += 1
            print(f"TaskInstance {instance.id}: {', '.join(changes)}")
    
    return count


def fix_task_participations(db: Session, dry_run: bool) -> int:
    """Fix timestamps on task_participations from today."""
    start, end = get_today_range()
    
    participations = list(
        db.execute(
            select(TaskParticipation).where(
                or_(
                    and_(
                        TaskParticipation.joined_at >= start,
                        TaskParticipation.joined_at <= end,
                    ),
                    and_(
                        TaskParticipation.left_at >= start,
                        TaskParticipation.left_at <= end,
                    ),
                )
            )
        ).scalars()
    )
    
    count = 0
    for participation in participations:
        changes = []
        if participation.joined_at and start <= participation.joined_at <= end:
            old_val = participation.joined_at
            new_val = old_val - OFFSET
            changes.append(f"joined_at: {old_val} -> {new_val}")
            if not dry_run:
                participation.joined_at = new_val
        
        if participation.left_at and start <= participation.left_at <= end:
            old_val = participation.left_at
            new_val = old_val - OFFSET
            changes.append(f"left_at: {old_val} -> {new_val}")
            if not dry_run:
                participation.left_at = new_val
        
        if changes:
            count += 1
            print(f"TaskParticipation {participation.id}: {', '.join(changes)}")
    
    return count


def fix_task_pauses(db: Session, dry_run: bool) -> int:
    """Fix timestamps on task_pauses from today."""
    start, end = get_today_range()
    
    pauses = list(
        db.execute(
            select(TaskPause).where(
                or_(
                    and_(
                        TaskPause.paused_at >= start,
                        TaskPause.paused_at <= end,
                    ),
                    and_(
                        TaskPause.resumed_at >= start,
                        TaskPause.resumed_at <= end,
                    ),
                )
            )
        ).scalars()
    )
    
    count = 0
    for pause in pauses:
        changes = []
        if pause.paused_at and start <= pause.paused_at <= end:
            old_val = pause.paused_at
            new_val = old_val - OFFSET
            changes.append(f"paused_at: {old_val} -> {new_val}")
            if not dry_run:
                pause.paused_at = new_val
        
        if pause.resumed_at and start <= pause.resumed_at <= end:
            old_val = pause.resumed_at
            new_val = old_val - OFFSET
            changes.append(f"resumed_at: {old_val} -> {new_val}")
            if not dry_run:
                pause.resumed_at = new_val
        
        if changes:
            count += 1
            print(f"TaskPause {pause.id}: {', '.join(changes)}")
    
    return count


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fix timestamps recorded with +3 hour offset today"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without making changes",
    )
    args = parser.parse_args()
    
    start, end = get_today_range()
    print(f"Looking for timestamps between {start} and {end}")
    print(f"Will subtract {OFFSET} from matching timestamps")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("-" * 60)
    
    db = SessionLocal()
    try:
        print("\n=== TaskInstances ===")
        instance_count = fix_task_instances(db, args.dry_run)
        
        print("\n=== TaskParticipations ===")
        participation_count = fix_task_participations(db, args.dry_run)
        
        print("\n=== TaskPauses ===")
        pause_count = fix_task_pauses(db, args.dry_run)
        
        print("-" * 60)
        print(f"Total: {instance_count} instances, {participation_count} participations, {pause_count} pauses")
        
        if not args.dry_run:
            db.commit()
            print("Changes committed.")
        else:
            print("Dry run - no changes made. Run without --dry-run to apply.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
