from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import select

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.session import SessionLocal
from app.models.enums import TaskScope
from app.models.house import PanelDefinition
from app.models.tasks import TaskApplicability, TaskDefinition
from app.services.task_applicability import sync_panel_task_applicability


def _desired_task_ids(
    panel: PanelDefinition,
    active_panel_task_ids: set[int],
) -> set[int]:
    if panel.applicable_task_ids is None:
        return set(active_panel_task_ids)
    return {
        task_id
        for task_id in panel.applicable_task_ids
        if isinstance(task_id, int) and task_id in active_panel_task_ids
    }


def _scan() -> dict[str, Any]:
    with SessionLocal() as db:
        panel_tasks = list(
            db.execute(
                select(TaskDefinition)
                .where(TaskDefinition.scope == TaskScope.PANEL)
                .where(TaskDefinition.active == True)
                .order_by(TaskDefinition.id)
            ).scalars()
        )
        task_by_id = {task.id: task for task in panel_tasks}
        active_panel_task_ids = set(task_by_id)
        panels = list(
            db.execute(select(PanelDefinition).order_by(PanelDefinition.id)).scalars()
        )
        rows = list(
            db.execute(
                select(TaskApplicability)
                .where(TaskApplicability.panel_definition_id.is_not(None))
                .order_by(
                    TaskApplicability.panel_definition_id,
                    TaskApplicability.task_definition_id,
                    TaskApplicability.id,
                )
            ).scalars()
        )

        rows_by_panel_task: dict[tuple[int, int], list[TaskApplicability]] = {}
        for row in rows:
            if row.panel_definition_id is None:
                continue
            rows_by_panel_task.setdefault(
                (row.panel_definition_id, row.task_definition_id), []
            ).append(row)

        clashes: list[dict[str, Any]] = []
        missing_rows = 0
        duplicate_rows = 0
        missing_station_sequence = 0

        for panel in panels:
            desired_ids = _desired_task_ids(panel, active_panel_task_ids)
            for task_id, task in task_by_id.items():
                desired_applies = task_id in desired_ids
                scoped_rows = rows_by_panel_task.get((panel.id, task_id), [])
                if not scoped_rows:
                    missing_rows += 1
                    continue
                primary = scoped_rows[0]
                if primary.applies != desired_applies:
                    clashes.append(
                        {
                            "panel_definition_id": panel.id,
                            "panel_code": panel.panel_code,
                            "task_definition_id": task_id,
                            "task_name": task.name,
                            "applicable_task_ids_applies": desired_applies,
                            "task_applicability_id": primary.id,
                            "task_applicability_applies": primary.applies,
                        }
                    )
                if len(scoped_rows) > 1:
                    duplicate_rows += len(scoped_rows) - 1
                if (
                    primary.station_sequence_order is None
                    and task.default_station_sequence is not None
                ):
                    missing_station_sequence += 1

        return {
            "active_panel_tasks": len(panel_tasks),
            "panel_definitions": len(panels),
            "panel_task_clashes": len(clashes),
            "missing_panel_task_rows": missing_rows,
            "duplicate_panel_task_rows": duplicate_rows,
            "missing_station_sequence_rows": missing_station_sequence,
            "clashes": clashes,
        }


def _apply() -> dict[str, Any]:
    with SessionLocal() as db:
        panels = list(
            db.execute(select(PanelDefinition).order_by(PanelDefinition.id)).scalars()
        )
        totals = {"created": 0, "updated": 0, "deleted_duplicates": 0}
        for panel in panels:
            result = sync_panel_task_applicability(db, panel)
            for key in totals:
                totals[key] += result[key]
        db.commit()
    report = _scan()
    report["applied"] = totals
    return report


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Detect and optionally align panel task_applicability rows with the "
            "current House Configurator panel task matrix."
        )
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Update task_applicability rows to match panel_definitions.applicable_task_ids.",
    )
    parser.add_argument(
        "--report-file",
        type=Path,
        help="Optional path to write the JSON report.",
    )
    args = parser.parse_args()

    report = _apply() if args.apply else _scan()
    output = json.dumps(report, indent=2, sort_keys=True)
    if args.report_file:
        args.report_file.write_text(output + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
