from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.admin import CommentTemplate, PauseReason
from app.models.enums import TaskScope
from app.models.house import (
    HouseParameter,
    HouseParameterValue,
    HouseSubType,
    HouseType,
    PanelDefinition,
)
from app.models.tasks import (
    TaskApplicability,
    TaskDefinition,
    TaskException,
    TaskInstance,
    TaskPause,
)
from app.models.work import PanelUnit, WorkOrder


STATION_ID_MAP = {
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

DEFAULT_SECTIONS = (
    "tasks",
    "houses",
    "panels",
    "pause_reasons",
    "comment_templates",
)
BASE_DIR = Path(__file__).resolve().parents[3]


def _bool(value: Any) -> bool:
    return bool(int(value)) if value is not None else False


def _parse_json_list(raw: str | None) -> list[Any] | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, list):
        return None
    return data


def _parse_int_list(raw: str | None) -> list[int] | None:
    items = _parse_json_list(raw)
    if items is None:
        return None
    parsed: list[int] = []
    for item in items:
        try:
            parsed.append(int(item))
        except (TypeError, ValueError):
            continue
    return parsed


def _parse_float_list(raw: str | None) -> list[float | None] | None:
    items = _parse_json_list(raw)
    if items is None:
        return None
    parsed: list[float | None] = []
    for item in items:
        if item is None:
            parsed.append(None)
            continue
        try:
            parsed.append(float(item))
        except (TypeError, ValueError):
            parsed.append(None)
    return parsed


def _parse_dependencies(raw: str | None) -> list[int] | None:
    if not raw:
        return None
    parsed = _parse_int_list(raw)
    if parsed is not None:
        return parsed or None
    tokens = [token.strip() for token in raw.replace("[", "").replace("]", "").split(",")]
    values: list[int] = []
    for token in tokens:
        if not token:
            continue
        try:
            values.append(int(token))
        except ValueError:
            continue
    return values or None


def _parse_station_csv(raw: str | None) -> tuple[list[int] | None, list[str]]:
    if not raw:
        return None, []
    tokens = [token.strip() for token in raw.split(",") if token.strip()]
    mapped: list[int] = []
    unknown: list[str] = []
    for token in tokens:
        station_id = STATION_ID_MAP.get(token)
        if station_id is None:
            unknown.append(token)
            continue
        mapped.append(station_id)
    return (mapped or None), unknown


def _connect_sqlite(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _fetch_rows(conn: sqlite3.Connection, query: str) -> list[sqlite3.Row]:
    return list(conn.execute(query))


def _report(sqlite_path: Path) -> int:
    conn = _connect_sqlite(sqlite_path)
    cursor = conn.cursor()

    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    tables = [row[0] for row in cursor.fetchall()]
    print("Legacy tables:")
    for table in tables:
        print(f"- {table}")

    print("\nRow counts:")
    for table in tables:
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
        except sqlite3.Error as exc:
            count = f"ERROR: {exc}"
        print(f"- {table}: {count}")

    mismatch_count = 0
    missing_duration = 0
    for row in _fetch_rows(
        conn,
        "SELECT panel_definition_id, applicable_tasks, task_length FROM PanelDefinitions",
    ):
        applicable = _parse_int_list(row["applicable_tasks"])
        durations = _parse_float_list(row["task_length"])
        if applicable and durations is None:
            missing_duration += 1
            continue
        if applicable and durations and len(applicable) != len(durations):
            mismatch_count += 1

    print("\nPanel task duration checks:")
    print(f"- missing task_length for applicable_tasks: {missing_duration}")
    print(f"- applicable_tasks/task_length length mismatches: {mismatch_count}")

    return 0


def _ensure_empty(session: Session, model, label: str, allow_existing: bool) -> None:
    count = session.execute(select(func.count()).select_from(model)).scalar_one()
    if count and not allow_existing:
        raise RuntimeError(f"{label} is not empty ({count} rows).")


def _truncate_tables(session: Session, sections: set[str]) -> None:
    blockers: list[str] = []
    if "panels" in sections:
        panel_units = session.execute(
            select(func.count()).select_from(PanelUnit)
        ).scalar_one()
        if panel_units:
            blockers.append(
                f"panel_definitions referenced by panel_units ({panel_units} rows)"
            )
    if "houses" in sections:
        work_orders = session.execute(
            select(func.count()).select_from(WorkOrder)
        ).scalar_one()
        if work_orders:
            blockers.append(
                f"house_types referenced by work_orders ({work_orders} rows)"
            )
    if "tasks" in sections:
        task_instances = session.execute(
            select(func.count()).select_from(TaskInstance)
        ).scalar_one()
        if task_instances:
            blockers.append(
                f"task_definitions referenced by task_instances ({task_instances} rows)"
            )
        task_exceptions = session.execute(
            select(func.count()).select_from(TaskException)
        ).scalar_one()
        if task_exceptions:
            blockers.append(
                f"task_definitions referenced by task_exceptions ({task_exceptions} rows)"
            )
    if "pause_reasons" in sections:
        task_pauses = session.execute(
            select(func.count()).select_from(TaskPause)
        ).scalar_one()
        if task_pauses:
            blockers.append(
                f"pause_reasons referenced by task_pauses ({task_pauses} rows)"
            )
    if blockers:
        raise RuntimeError(
            "Cannot truncate config tables because production data exists: "
            + "; ".join(blockers)
        )

    if "panels" in sections:
        session.execute(delete(PanelDefinition))
    if "houses" in sections:
        session.execute(delete(HouseParameterValue))
        session.execute(delete(HouseParameter))
        session.execute(delete(HouseSubType))
        session.execute(delete(HouseType))
    if "tasks" in sections:
        session.execute(delete(TaskApplicability))
        session.execute(delete(TaskDefinition))
    if "pause_reasons" in sections:
        session.execute(delete(PauseReason))
    if "comment_templates" in sections:
        session.execute(delete(CommentTemplate))


def _align_durations(
    panel_id: int,
    task_ids: list[int] | None,
    durations: list[float | None] | None,
    warnings: list[str],
) -> list[float | None] | None:
    if task_ids is None or durations is None:
        return durations
    if len(task_ids) == len(durations):
        return durations
    if len(durations) < len(task_ids):
        warnings.append(
            f"panel_definition_id {panel_id}: padded task_length to match applicable_tasks"
        )
        return durations + [None] * (len(task_ids) - len(durations))
    warnings.append(
        f"panel_definition_id {panel_id}: trimmed task_length to match applicable_tasks"
    )
    return durations[: len(task_ids)]


def _persist(session: Session, obj: Any, allow_existing: bool) -> None:
    if allow_existing:
        session.merge(obj)
    else:
        session.add(obj)


def _existing_default_applicability(session: Session) -> set[int]:
    rows = session.execute(
        select(TaskApplicability.task_definition_id).where(
            TaskApplicability.house_type_id.is_(None),
            TaskApplicability.sub_type_id.is_(None),
            TaskApplicability.module_number.is_(None),
            TaskApplicability.panel_definition_id.is_(None),
        )
    ).scalars()
    return set(rows)


def _update_default_applicability(
    session: Session, task_id: int, station_sequence_order: int | None
) -> TaskApplicability:
    row = session.execute(
        select(TaskApplicability).where(
            TaskApplicability.task_definition_id == task_id,
            TaskApplicability.house_type_id.is_(None),
            TaskApplicability.sub_type_id.is_(None),
            TaskApplicability.module_number.is_(None),
            TaskApplicability.panel_definition_id.is_(None),
        )
    ).scalar_one_or_none()
    if row:
        row.station_sequence_order = station_sequence_order
        row.applies = True
        return row
    row = TaskApplicability(
        task_definition_id=task_id,
        applies=True,
        station_sequence_order=station_sequence_order,
    )
    session.add(row)
    return row


def _import_tasks(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    rows = _fetch_rows(
        conn,
        """
        SELECT
            task_definition_id,
            name,
            task_dependencies,
            is_panel_task,
            is_active,
            skippable,
            concurrent_allowed,
            station_sequence_order
        FROM TaskDefinitions
        ORDER BY task_definition_id
        """,
    )
    for row in rows:
        scope = TaskScope.PANEL if _bool(row["is_panel_task"]) else TaskScope.MODULE
        dependencies = _parse_dependencies(row["task_dependencies"])
        task = TaskDefinition(
            id=row["task_definition_id"],
            name=row["name"],
            scope=scope,
            active=_bool(row["is_active"]),
            skippable=_bool(row["skippable"]),
            concurrent_allowed=_bool(row["concurrent_allowed"]),
            advance_trigger=False,
            dependencies_json=dependencies,
        )
        _persist(session, task, allow_existing)
        if scope != TaskScope.PANEL:
            warnings.append(
                f"task_definition_id {row['task_definition_id']}: module task found"
            )
    session.flush()

    existing_defaults: set[int] = set()
    if allow_existing:
        existing_defaults = _existing_default_applicability(session)
    for row in rows:
        task_id = row["task_definition_id"]
        station_sequence_order = row["station_sequence_order"]
        if allow_existing:
            _update_default_applicability(session, task_id, station_sequence_order)
            continue
        if task_id in existing_defaults:
            continue
        applicability = TaskApplicability(
            task_definition_id=task_id,
            applies=True,
            station_sequence_order=station_sequence_order,
        )
        session.add(applicability)


def _import_houses(
    conn: sqlite3.Connection, session: Session, allow_existing: bool
) -> None:
    rows = _fetch_rows(
        conn,
        """
        SELECT house_type_id, name, number_of_modules
        FROM HouseTypes
        ORDER BY house_type_id
        """,
    )
    for row in rows:
        _persist(
            session,
            HouseType(
                id=row["house_type_id"],
                name=row["name"],
                number_of_modules=row["number_of_modules"],
            ),
            allow_existing,
        )

    rows = _fetch_rows(
        conn,
        """
        SELECT sub_type_id, house_type_id, name
        FROM HouseSubType
        ORDER BY sub_type_id
        """,
    )
    for row in rows:
        _persist(
            session,
            HouseSubType(
                id=row["sub_type_id"],
                house_type_id=row["house_type_id"],
                name=row["name"],
            ),
            allow_existing,
        )

    rows = _fetch_rows(
        conn,
        """
        SELECT parameter_id, name, unit
        FROM HouseParameters
        ORDER BY parameter_id
        """,
    )
    for row in rows:
        _persist(
            session,
            HouseParameter(
                id=row["parameter_id"],
                name=row["name"],
                unit=row["unit"],
            ),
            allow_existing,
        )

    rows = _fetch_rows(
        conn,
        """
        SELECT house_type_parameter_id, house_type_id, parameter_id,
               module_sequence_number, sub_type_id, value
        FROM HouseTypeParameters
        ORDER BY house_type_parameter_id
        """,
    )
    for row in rows:
        _persist(
            session,
            HouseParameterValue(
                id=row["house_type_parameter_id"],
                house_type_id=row["house_type_id"],
                parameter_id=row["parameter_id"],
                module_sequence_number=row["module_sequence_number"],
                sub_type_id=row["sub_type_id"],
                value=row["value"],
            ),
            allow_existing,
        )


def _import_panels(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    rows = _fetch_rows(
        conn,
        """
        SELECT
            panel_definition_id,
            house_type_id,
            module_sequence_number,
            panel_group,
            panel_code,
            sub_type_id,
            panel_sequence_number,
            applicable_tasks,
            task_length,
            panel_area,
            panel_length_m
        FROM PanelDefinitions
        ORDER BY panel_definition_id
        """,
    )
    for row in rows:
        applicable_tasks = _parse_int_list(row["applicable_tasks"])
        task_lengths = _parse_float_list(row["task_length"])
        task_lengths = _align_durations(
            row["panel_definition_id"],
            applicable_tasks,
            task_lengths,
            warnings,
        )
        _persist(
            session,
            PanelDefinition(
                id=row["panel_definition_id"],
                house_type_id=row["house_type_id"],
                module_sequence_number=row["module_sequence_number"],
                sub_type_id=row["sub_type_id"],
                group=row["panel_group"],
                panel_code=row["panel_code"],
                panel_sequence_number=row["panel_sequence_number"],
                applicable_task_ids=applicable_tasks,
                task_durations_json=task_lengths,
                panel_area=row["panel_area"],
                panel_length_m=row["panel_length_m"],
            ),
            allow_existing,
        )


def _import_pause_reasons(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    rows = _fetch_rows(
        conn,
        """
        SELECT pause_definition_id, name, stations, is_active
        FROM PauseDefinitions
        ORDER BY pause_definition_id
        """,
    )
    for row in rows:
        mapped_ids, unknown = _parse_station_csv(row["stations"])
        if unknown:
            warnings.append(
                f"pause_definition_id {row['pause_definition_id']}: unknown stations {unknown}"
            )
        _persist(
            session,
            PauseReason(
                id=row["pause_definition_id"],
                name=row["name"],
                applicable_station_ids=mapped_ids,
                active=_bool(row["is_active"]),
            ),
            allow_existing,
        )


def _import_comment_templates(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    rows = _fetch_rows(
        conn,
        """
        SELECT note_definition_id, name, stations, is_active
        FROM NoteDefinitions
        ORDER BY note_definition_id
        """,
    )
    for row in rows:
        mapped_ids, unknown = _parse_station_csv(row["stations"])
        if unknown:
            warnings.append(
                f"note_definition_id {row['note_definition_id']}: unknown stations {unknown}"
            )
        _persist(
            session,
            CommentTemplate(
                id=row["note_definition_id"],
                text=row["name"],
                applicable_station_ids=mapped_ids,
                active=_bool(row["is_active"]),
            ),
            allow_existing,
        )


def _import(sqlite_path: Path, sections: set[str], allow_existing: bool, truncate: bool) -> int:
    conn = _connect_sqlite(sqlite_path)
    warnings: list[str] = []
    session = SessionLocal()
    try:
        if truncate:
            _truncate_tables(session, sections)
            session.commit()

        if not allow_existing:
            if "tasks" in sections:
                _ensure_empty(
                    session, TaskDefinition, "task_definitions", allow_existing
                )
                _ensure_empty(
                    session, TaskApplicability, "task_applicability", allow_existing
                )
            if "houses" in sections:
                _ensure_empty(session, HouseType, "house_types", allow_existing)
                _ensure_empty(session, HouseSubType, "house_sub_types", allow_existing)
                _ensure_empty(
                    session, HouseParameter, "house_parameters", allow_existing
                )
                _ensure_empty(
                    session,
                    HouseParameterValue,
                    "house_parameter_values",
                    allow_existing,
                )
            if "panels" in sections:
                _ensure_empty(
                    session, PanelDefinition, "panel_definitions", allow_existing
                )
            if "pause_reasons" in sections:
                _ensure_empty(
                    session, PauseReason, "pause_reasons", allow_existing
                )
            if "comment_templates" in sections:
                _ensure_empty(
                    session, CommentTemplate, "comment_templates", allow_existing
                )

        if "tasks" in sections:
            _import_tasks(conn, session, warnings, allow_existing)
        if "houses" in sections:
            _import_houses(conn, session, allow_existing)
        if "panels" in sections:
            _import_panels(conn, session, warnings, allow_existing)
        if "pause_reasons" in sections:
            _import_pause_reasons(conn, session, warnings, allow_existing)
        if "comment_templates" in sections:
            _import_comment_templates(conn, session, warnings, allow_existing)

        session.commit()
    except RuntimeError as exc:
        session.rollback()
        print(str(exc))
        return 1
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    if warnings:
        print("Warnings:")
        for warning in warnings:
            print(f"- {warning}")

    return 0


def _parse_sections(raw: str | None) -> set[str]:
    if not raw:
        return set(DEFAULT_SECTIONS)
    return {item.strip() for item in raw.split(",") if item.strip()}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import legacy sqlite config data into the PostgreSQL schema."
    )
    parser.add_argument(
        "--sqlite",
        type=Path,
        default=BASE_DIR / "docs/references/database.db",
        help="Path to the legacy sqlite database file.",
    )
    parser.add_argument(
        "--mode",
        choices=("report", "import"),
        default="report",
        help="Run a read-only report or perform the import.",
    )
    parser.add_argument(
        "--sections",
        type=str,
        default=None,
        help="Comma-separated sections (tasks,houses,panels,pause_reasons,comment_templates).",
    )
    parser.add_argument(
        "--allow-existing",
        action="store_true",
        help="Allow imports into non-empty tables.",
    )
    parser.add_argument(
        "--truncate",
        action="store_true",
        help="Delete target rows before importing.",
    )
    args = parser.parse_args()

    sqlite_path = args.sqlite
    if not sqlite_path.exists():
        raise SystemExit(f"SQLite file not found: {sqlite_path}")

    if args.mode == "report":
        return _report(sqlite_path)

    sections = _parse_sections(args.sections)
    return _import(sqlite_path, sections, args.allow_existing, args.truncate)


if __name__ == "__main__":
    raise SystemExit(main())
