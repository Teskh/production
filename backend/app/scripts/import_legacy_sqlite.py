from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models import (
    CommentTemplate,
    HouseParameter,
    HouseParameterValue,
    HouseSubType,
    HouseType,
    PanelDefinition,
    PanelUnit,
    PauseReason,
    Skill,
    TaskApplicability,
    TaskDefinition,
    TaskException,
    TaskExpectedDuration,
    TaskInstance,
    TaskParticipation,
    TaskPause,
    TaskSkillRequirement,
    TaskWorkerRestriction,
    WorkOrder,
    WorkUnit,
    Worker,
    WorkerSkill,
)
from app.models.enums import PanelUnitStatus, TaskScope, TaskStatus, WorkUnitStatus


BASE_DIR = Path(__file__).resolve().parents[2]
DEFAULT_SECTIONS = (
    "tasks",
    "houses",
    "panels",
    "pause_reasons",
    "comment_templates",
)
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


def _bool(value: Any) -> bool:
    if value is None:
        return False
    return bool(int(value))


def _connect_sqlite(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _fetch_rows(conn: sqlite3.Connection, query: str) -> list[sqlite3.Row]:
    return list(conn.execute(query))


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone() is not None


def _row_value(row: sqlite3.Row, *names: str) -> Any:
    keys = row.keys()
    for name in names:
        if name in keys:
            return row[name]
    return None


def _legacy_task_station_orders(conn: sqlite3.Connection) -> dict[int, int | None]:
    orders: dict[int, int | None] = {}
    if not _table_exists(conn, "TaskDefinitions"):
        return orders
    rows = _fetch_rows(
        conn,
        """
        SELECT task_definition_id, station_sequence_order
        FROM TaskDefinitions
        """,
    )
    for row in rows:
        task_id = row["task_definition_id"]
        station_sequence_order = row["station_sequence_order"]
        if station_sequence_order is not None:
            try:
                station_sequence_order = int(station_sequence_order)
            except (TypeError, ValueError):
                station_sequence_order = None
        orders[task_id] = station_sequence_order
    return orders


def _task_default_station_sequences(session: Session) -> dict[int, int | None]:
    return dict(
        session.execute(
            select(
                TaskDefinition.id,
                TaskDefinition.default_station_sequence,
            )
        ).all()
    )


def _parse_json_list(raw: str | None) -> list[Any] | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            return None
        return data
    except json.JSONDecodeError:
        return None


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
    tokens = (
        raw.replace("[", "")
        .replace("]", "")
        .split(",")
    )
    values: list[int] = []
    for token in tokens:
        if not token:
            continue
        try:
            values.append(int(token.strip()))
        except ValueError:
            continue
    return values or None


def _parse_sections(raw: str | None) -> set[str]:
    if not raw:
        return set(DEFAULT_SECTIONS)
    return {item.strip() for item in raw.split(",") if item.strip()}


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
    return mapped or None, unknown


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
        return
    session.add(obj)


def _ensure_empty(
    session: Session, model: Any, label: str, allow_existing: bool
) -> None:
    count = session.execute(
        select(func.count()).select_from(model)
    ).scalar_one()
    if count and not allow_existing:
        raise RuntimeError(f"{label} is not empty ({count} rows).")


def _find_task_applicability(
    session: Session,
    task_definition_id: int,
    house_type_id: int | None,
    sub_type_id: int | None,
    module_number: int | None,
    panel_definition_id: int | None,
) -> TaskApplicability | None:
    stmt = select(TaskApplicability).where(
        TaskApplicability.task_definition_id == task_definition_id
    )
    if house_type_id is None:
        stmt = stmt.where(TaskApplicability.house_type_id.is_(None))
    else:
        stmt = stmt.where(TaskApplicability.house_type_id == house_type_id)
    if sub_type_id is None:
        stmt = stmt.where(TaskApplicability.sub_type_id.is_(None))
    else:
        stmt = stmt.where(TaskApplicability.sub_type_id == sub_type_id)
    if module_number is None:
        stmt = stmt.where(TaskApplicability.module_number.is_(None))
    else:
        stmt = stmt.where(TaskApplicability.module_number == module_number)
    if panel_definition_id is None:
        stmt = stmt.where(TaskApplicability.panel_definition_id.is_(None))
    else:
        stmt = stmt.where(TaskApplicability.panel_definition_id == panel_definition_id)
    return session.execute(stmt).scalar_one_or_none()


def _find_task_expected_duration(
    session: Session,
    task_definition_id: int,
    house_type_id: int | None,
    sub_type_id: int | None,
    module_number: int | None,
    panel_definition_id: int | None,
) -> TaskExpectedDuration | None:
    stmt = select(TaskExpectedDuration).where(
        TaskExpectedDuration.task_definition_id == task_definition_id
    )
    if house_type_id is None:
        stmt = stmt.where(TaskExpectedDuration.house_type_id.is_(None))
    else:
        stmt = stmt.where(TaskExpectedDuration.house_type_id == house_type_id)
    if sub_type_id is None:
        stmt = stmt.where(TaskExpectedDuration.sub_type_id.is_(None))
    else:
        stmt = stmt.where(TaskExpectedDuration.sub_type_id == sub_type_id)
    if module_number is None:
        stmt = stmt.where(TaskExpectedDuration.module_number.is_(None))
    else:
        stmt = stmt.where(TaskExpectedDuration.module_number == module_number)
    if panel_definition_id is None:
        stmt = stmt.where(TaskExpectedDuration.panel_definition_id.is_(None))
    else:
        stmt = stmt.where(TaskExpectedDuration.panel_definition_id == panel_definition_id)
    return session.execute(stmt).scalar_one_or_none()


def _parse_datetime(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        try:
            return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None


def _normalize_text(raw: str | None) -> str | None:
    if raw is None:
        return None
    stripped = str(raw).strip()
    if not stripped:
        return None
    return " ".join(stripped.split()).lower()


def _map_station_id(
    raw: str | None, warnings: list[str], context: str
) -> int | None:
    if not raw:
        return None
    token = raw.strip()
    if not token:
        return None
    station_id = STATION_ID_MAP.get(token)
    if station_id is None:
        warnings.append(f"{context}: unknown station {token}")
    return station_id


def _resolve_station_id(
    station_start: str | None,
    station_finish: str | None,
    warnings: list[str],
    context: str,
) -> int | None:
    if station_start and station_finish and station_start != station_finish:
        warnings.append(
            f"{context}: station_start {station_start} != station_finish {station_finish}"
        )
    station_raw = station_finish or station_start
    return _map_station_id(station_raw, warnings, context)


def _map_work_unit_status(
    raw: str | None, warnings: list[str], context: str
) -> WorkUnitStatus:
    status_map = {
        "planned": WorkUnitStatus.PLANNED,
        "panels": WorkUnitStatus.PANELS,
        "magazine": WorkUnitStatus.MAGAZINE,
        "assembly": WorkUnitStatus.ASSEMBLY,
        "completed": WorkUnitStatus.COMPLETED,
    }
    if not raw:
        return WorkUnitStatus.PLANNED
    mapped = status_map.get(raw.strip().lower())
    if mapped is None:
        warnings.append(f"{context}: unknown status {raw}")
        return WorkUnitStatus.PLANNED
    return mapped


def _map_panel_unit_status(
    raw: str | None, warnings: list[str], context: str
) -> PanelUnitStatus:
    status_map = {
        "planned": PanelUnitStatus.PLANNED,
        "in progress": PanelUnitStatus.IN_PROGRESS,
        "inprogress": PanelUnitStatus.IN_PROGRESS,
        "completed": PanelUnitStatus.COMPLETED,
        "consumed": PanelUnitStatus.CONSUMED,
    }
    if not raw:
        return PanelUnitStatus.PLANNED
    mapped = status_map.get(raw.strip().lower())
    if mapped is None:
        warnings.append(f"{context}: unknown status {raw}")
        return PanelUnitStatus.PLANNED
    return mapped


def _map_task_status(raw: str | None) -> TaskStatus:
    if not raw:
        return TaskStatus.NOT_STARTED
    status_map = {
        "completed": TaskStatus.COMPLETED,
        "paused": TaskStatus.PAUSED,
        "in progress": TaskStatus.IN_PROGRESS,
        "inprogress": TaskStatus.IN_PROGRESS,
        "started": TaskStatus.IN_PROGRESS,
        "skipped": TaskStatus.SKIPPED,
        "skip": TaskStatus.SKIPPED,
        "not started": TaskStatus.NOT_STARTED,
    }
    return status_map.get(raw.strip().lower(), TaskStatus.NOT_STARTED)


def _aggregate_task_status(statuses: list[TaskStatus]) -> TaskStatus:
    if any(status == TaskStatus.PAUSED for status in statuses):
        return TaskStatus.PAUSED
    if any(status == TaskStatus.IN_PROGRESS for status in statuses):
        return TaskStatus.IN_PROGRESS
    if any(status == TaskStatus.SKIPPED for status in statuses):
        return TaskStatus.SKIPPED
    if any(status == TaskStatus.COMPLETED for status in statuses):
        return TaskStatus.COMPLETED
    return TaskStatus.NOT_STARTED


def _collect_notes(records: list[dict[str, Any]]) -> str | None:
    entries: list[str] = []
    seen: set[str] = set()
    for record in records:
        note = record.get("notes")
        if not note:
            continue
        note = str(note).strip()
        if not note:
            continue
        worker_id = record.get("worker_id")
        entry = f"Worker {worker_id}: {note}" if worker_id is not None else note
        if entry in seen:
            continue
        seen.add(entry)
        entries.append(entry)
    return "\n".join(entries) if entries else None


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
        session.execute(delete(TaskWorkerRestriction))
        session.execute(delete(TaskSkillRequirement))
        session.execute(delete(TaskExpectedDuration))
        session.execute(delete(TaskApplicability))
        session.execute(delete(TaskDefinition))
    if "module_task_templates" in sections and "tasks" not in sections:
        session.execute(delete(TaskExpectedDuration))
        session.execute(delete(TaskApplicability))

    if "pause_reasons" in sections:
        session.execute(delete(PauseReason))

    if "comment_templates" in sections:
        session.execute(delete(CommentTemplate))

    if "specialties" in sections:
        session.execute(delete(WorkerSkill))
        session.execute(delete(TaskSkillRequirement))
        session.execute(delete(Skill))


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
        station_sequence_order = row["station_sequence_order"]
        if station_sequence_order is not None:
            try:
                station_sequence_order = int(station_sequence_order)
            except (TypeError, ValueError):
                station_sequence_order = None
        if _bool(row["is_panel_task"]):
            scope = TaskScope.PANEL
        else:
            scope = TaskScope.MODULE
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
            default_station_sequence=station_sequence_order,
        )
        _persist(session, task, allow_existing)
        if scope != TaskScope.PANEL:
            warnings.append(
                f"task_definition_id {row['task_definition_id']}: module task found"
            )

    session.flush()



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
            row["panel_definition_id"], applicable_tasks, task_lengths, warnings
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
                f"pause_definition_id {row['pause_definition_id']}: "
                f"unknown stations {unknown}"
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
                f"note_definition_id {row['note_definition_id']}: "
                f"unknown stations {unknown}"
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


def _import_specialties(
    conn: sqlite3.Connection, session: Session, allow_existing: bool
) -> None:
    rows = _fetch_rows(
        conn,
        """
        SELECT specialty_id, name
        FROM Specialties
        ORDER BY specialty_id
        """,
    )

    for row in rows:
        _persist(
            session,
            Skill(id=row["specialty_id"], name=row["name"]),
            allow_existing,
        )


def _import_workers(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    rows = _fetch_rows(
        conn,
        """
        SELECT worker_id, first_name, last_name, pin, is_active,
               assigned_stations, login_required
        FROM Workers
        ORDER BY worker_id
        """,
    )

    for row in rows:
        mapped_ids, unknown = _parse_station_csv(row["assigned_stations"])
        if unknown:
            warnings.append(
                f"worker_id {row['worker_id']}: unknown stations {unknown}"
            )
        worker = Worker(
            id=row["worker_id"],
            geovictoria_id=None,
            geovictoria_identifier=None,
            first_name=row["first_name"],
            last_name=row["last_name"],
            pin=row["pin"],
            login_required=_bool(row["login_required"]),
            active=_bool(row["is_active"]),
            assigned_station_ids=mapped_ids,
            supervisor_id=None,
        )
        _persist(session, worker, allow_existing)


def _import_worker_skills(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    session.flush()
    rows: list[sqlite3.Row] = []
    if _table_exists(conn, "Workers"):
        try:
            rows += _fetch_rows(
                conn,
                """
                SELECT worker_id, specialty_id
                FROM Workers
                WHERE specialty_id IS NOT NULL
                ORDER BY worker_id
                """,
            )
        except sqlite3.Error as exc:
            warnings.append(f"worker_specialties: failed to read Workers.specialty_id ({exc})")
    else:
        warnings.append("worker_specialties: Workers table not found; skipping")

    if not rows:
        return

    worker_ids = set(session.execute(select(Worker.id)).scalars())
    skill_ids = set(session.execute(select(Skill.id)).scalars())
    if not skill_ids:
        warnings.append("worker_specialties: no skills found; skipping")
        return
    seen: set[tuple[int, int]] = set()
    existing: set[tuple[int, int]] = set()
    if allow_existing:
        existing = set(
            session.execute(
                select(WorkerSkill.worker_id, WorkerSkill.skill_id)
            ).all()
        )

    for row in rows:
        worker_id = row["worker_id"]
        skill_id = row["specialty_id"]
        if worker_id not in worker_ids:
            warnings.append(
                f"worker_specialty worker_id {worker_id}: worker not found"
            )
            continue
        if skill_id not in skill_ids:
            warnings.append(
                f"worker_specialty specialty_id {skill_id}: skill not found"
            )
            continue
        if (worker_id, skill_id) in seen:
            continue
        seen.add((worker_id, skill_id))
        if allow_existing and (worker_id, skill_id) in existing:
            continue
        session.add(WorkerSkill(worker_id=worker_id, skill_id=skill_id))


def _import_task_skill_requirements(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    session.flush()
    rows = _fetch_rows(
        conn,
        """
        SELECT task_definition_id, specialty_id
        FROM TaskDefinitions
        WHERE specialty_id IS NOT NULL
        ORDER BY task_definition_id
        """,
    )

    if not rows:
        return

    task_ids = set(session.execute(select(TaskDefinition.id)).scalars())
    skill_ids = set(session.execute(select(Skill.id)).scalars())
    if not task_ids:
        warnings.append("task_skill_requirements: no tasks found; skipping")
        return
    if not skill_ids:
        warnings.append("task_skill_requirements: no skills found; skipping")
        return
    seen: set[tuple[int, int]] = set()
    existing: set[tuple[int, int]] = set()
    if allow_existing:
        existing = set(
            session.execute(
                select(
                    TaskSkillRequirement.task_definition_id,
                    TaskSkillRequirement.skill_id,
                )
            ).all()
        )

    for row in rows:
        task_id = row["task_definition_id"]
        skill_id = row["specialty_id"]
        if task_id not in task_ids:
            warnings.append(
                f"task_definition_id {task_id}: task not found for skill"
            )
            continue
        if skill_id not in skill_ids:
            warnings.append(
                f"specialty_id {skill_id}: skill not found for task"
            )
            continue
        if (task_id, skill_id) in seen:
            continue
        seen.add((task_id, skill_id))
        if allow_existing and (task_id, skill_id) in existing:
            continue
        session.add(
            TaskSkillRequirement(
                task_definition_id=task_id, skill_id=skill_id
            )
        )


def _import_module_task_applicability(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    session.flush()
    if not _table_exists(conn, "ModuleTaskApplicability"):
        warnings.append("ModuleTaskApplicability table not found; skipping")
        return

    rows = _fetch_rows(conn, "SELECT * FROM ModuleTaskApplicability")
    if not rows:
        return

    module_task_ids = set(
        session.execute(
            select(TaskDefinition.id).where(TaskDefinition.scope == TaskScope.MODULE)
        ).scalars()
    )
    if not module_task_ids:
        warnings.append("module_task_applicability: no module tasks found; skipping")
        return

    house_types = {
        row.id: row.number_of_modules
        for row in session.execute(select(HouseType)).scalars()
    }
    if not house_types:
        warnings.append("module_task_applicability: no house_types found; skipping")
        return

    sub_type_ids = set(session.execute(select(HouseSubType.id)).scalars())
    default_sequences = _task_default_station_sequences(session)

    explicit: dict[tuple[int, int, int, int | None], tuple[bool, int | None]] = {}
    for row in rows:
        task_id = _row_value(row, "task_definition_id", "task_id")
        if task_id is None:
            warnings.append("module_task_applicability: missing task_definition_id")
            continue
        if task_id not in module_task_ids:
            warnings.append(
                f"module_task_applicability task_definition_id {task_id}: "
                "task not found or not a module task"
            )
            continue

        house_type_id = _row_value(row, "house_type_id", "house_type")
        if house_type_id is None:
            warnings.append(
                f"module_task_applicability task_definition_id {task_id}: "
                "missing house_type_id"
            )
            continue
        if house_type_id not in house_types:
            warnings.append(
                f"module_task_applicability task_definition_id {task_id}: "
                f"house_type_id {house_type_id} not found"
            )
            continue

        sub_type_id = _row_value(
            row, "sub_type_id", "house_sub_type_id", "house_subtype_id"
        )
        if sub_type_id is not None and sub_type_id not in sub_type_ids:
            warnings.append(
                f"module_task_applicability task_definition_id {task_id}: "
                f"sub_type_id {sub_type_id} not found; using null sub_type_id"
            )
            sub_type_id = None

        module_number = _row_value(
            row, "module_sequence_number", "module_number", "module_index"
        )
        if module_number is None:
            warnings.append(
                f"module_task_applicability task_definition_id {task_id}: "
                "missing module_number"
            )
            continue
        try:
            module_number = int(module_number)
        except (TypeError, ValueError):
            warnings.append(
                f"module_task_applicability task_definition_id {task_id}: "
                f"invalid module_number {module_number}"
            )
            continue

        if module_number < 1:
            warnings.append(
                f"module_task_applicability task_definition_id {task_id}: "
                f"invalid module_number {module_number}"
            )
            continue
        max_modules = house_types.get(house_type_id)
        if max_modules and module_number > max_modules:
            warnings.append(
                f"module_task_applicability task_definition_id {task_id}: "
                f"module_number {module_number} exceeds house_type {house_type_id} "
                f"module count {max_modules}"
            )

        applies_raw = _row_value(
            row, "applies", "is_applicable", "is_active", "active"
        )
        applies = _bool(applies_raw) if applies_raw is not None else True
        station_sequence_order = _row_value(
            row, "station_sequence_order", "station_sequence", "sequence_order"
        )
        if station_sequence_order is not None:
            try:
                station_sequence_order = int(station_sequence_order)
            except (TypeError, ValueError):
                station_sequence_order = None
        if station_sequence_order is None:
            station_sequence_order = default_sequences.get(task_id)

        explicit[(task_id, house_type_id, module_number, sub_type_id)] = (
            applies,
            station_sequence_order,
        )

    for house_type_id, module_count in house_types.items():
        module_numbers = range(1, (module_count or 0) + 1)
        for module_number in module_numbers:
            for task_id in module_task_ids:
                key = (task_id, house_type_id, module_number, None)
                applies, station_sequence_order = explicit.get(
                key,
                (False, default_sequences.get(task_id)),
            )
                if allow_existing:
                    existing = _find_task_applicability(
                        session,
                        task_id,
                        house_type_id,
                        None,
                        module_number,
                        None,
                    )
                    if existing:
                        existing.applies = applies
                        existing.station_sequence_order = station_sequence_order
                        continue
                session.add(
                    TaskApplicability(
                        task_definition_id=task_id,
                        house_type_id=house_type_id,
                        sub_type_id=None,
                        module_number=module_number,
                        panel_definition_id=None,
                        applies=applies,
                        station_sequence_order=station_sequence_order,
                    )
                )

    for (task_id, house_type_id, module_number, sub_type_id), (
        applies,
        station_sequence_order,
    ) in explicit.items():
        if sub_type_id is None:
            continue
        if allow_existing:
            existing = _find_task_applicability(
                session,
                task_id,
                house_type_id,
                sub_type_id,
                module_number,
                None,
            )
            if existing:
                existing.applies = applies
                existing.station_sequence_order = station_sequence_order
                continue
        session.add(
            TaskApplicability(
                task_definition_id=task_id,
                house_type_id=house_type_id,
                sub_type_id=sub_type_id,
                module_number=module_number,
                panel_definition_id=None,
                applies=applies,
                station_sequence_order=station_sequence_order,
            )
        )


def _import_panel_task_applicability(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    session.flush()
    if not _table_exists(conn, "PanelDefinitions"):
        warnings.append("PanelDefinitions table not found; skipping panel applicability")
        return

    panel_task_ids = set(
        session.execute(
            select(TaskDefinition.id).where(TaskDefinition.scope == TaskScope.PANEL)
        ).scalars()
    )
    if not panel_task_ids:
        warnings.append("panel_task_applicability: no panel tasks found; skipping")
        return

    panel_definition_ids = set(
        session.execute(select(PanelDefinition.id)).scalars()
    )
    if not panel_definition_ids:
        warnings.append(
            "panel_task_applicability: no panel_definitions found; skipping"
        )
        return

    default_sequences = _task_default_station_sequences(session)
    rows = _fetch_rows(
        conn,
        """
        SELECT panel_definition_id, applicable_tasks
        FROM PanelDefinitions
        ORDER BY panel_definition_id
        """,
    )
    for row in rows:
        panel_definition_id = row["panel_definition_id"]
        if panel_definition_id not in panel_definition_ids:
            warnings.append(
                f"panel_task_applicability panel_definition_id {panel_definition_id}: "
                "panel_definition not found"
            )
            continue
        applicable_tasks = _parse_int_list(row["applicable_tasks"]) or []
        applicable_set = set(applicable_tasks)
        unknown_tasks = applicable_set.difference(panel_task_ids)
        if unknown_tasks:
            warnings.append(
                f"panel_task_applicability panel_definition_id {panel_definition_id}: "
                f"unknown tasks {sorted(unknown_tasks)}"
            )
        for task_id in panel_task_ids:
            applies = task_id in applicable_set
            station_sequence_order = default_sequences.get(task_id)
            if allow_existing:
                existing = _find_task_applicability(
                    session,
                    task_id,
                    None,
                    None,
                    None,
                    panel_definition_id,
                )
                if existing:
                    existing.applies = applies
                    existing.station_sequence_order = station_sequence_order
                    continue
            session.add(
                TaskApplicability(
                    task_definition_id=task_id,
                    house_type_id=None,
                    sub_type_id=None,
                    module_number=None,
                    panel_definition_id=panel_definition_id,
                    applies=applies,
                    station_sequence_order=station_sequence_order,
                )
            )


def _import_module_task_expected_durations(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    session.flush()
    if not _table_exists(conn, "ModuleTaskExpectedDurations"):
        warnings.append("ModuleTaskExpectedDurations table not found; skipping")
        return

    rows = _fetch_rows(conn, "SELECT * FROM ModuleTaskExpectedDurations")
    if not rows:
        return

    task_ids = set(session.execute(select(TaskDefinition.id)).scalars())
    if not task_ids:
        warnings.append(
            "module_task_expected_durations: no task_definitions found; skipping"
        )
        return

    house_type_ids = set(session.execute(select(HouseType.id)).scalars())
    sub_type_ids = set(session.execute(select(HouseSubType.id)).scalars())

    for row in rows:
        task_id = _row_value(row, "task_definition_id", "task_id")
        if task_id is None:
            warnings.append("module_task_expected_durations: missing task_definition_id")
            continue
        if task_id not in task_ids:
            warnings.append(
                f"module_task_expected_durations task_definition_id {task_id}: "
                "task not found"
            )
            continue

        house_type_id = _row_value(row, "house_type_id", "house_type")
        if house_type_id is not None and house_type_id not in house_type_ids:
            warnings.append(
                f"module_task_expected_durations task_definition_id {task_id}: "
                f"house_type_id {house_type_id} not found"
            )
            continue

        sub_type_id = _row_value(
            row, "sub_type_id", "house_sub_type_id", "house_subtype_id"
        )
        if sub_type_id is not None and sub_type_id not in sub_type_ids:
            warnings.append(
                f"module_task_expected_durations task_definition_id {task_id}: "
                f"sub_type_id {sub_type_id} not found; using null sub_type_id"
            )
            sub_type_id = None

        module_number = _row_value(
            row, "module_sequence_number", "module_number", "module_index"
        )
        panel_definition_id = _row_value(row, "panel_definition_id")
        expected_minutes = _row_value(
            row,
            "expected_minutes",
            "expected_duration",
            "duration_minutes",
            "minutes",
        )
        if expected_minutes is None:
            warnings.append(
                f"module_task_expected_durations task_definition_id {task_id}: "
                "missing expected_minutes"
            )
            continue
        try:
            expected_minutes = float(expected_minutes)
        except (TypeError, ValueError):
            warnings.append(
                f"module_task_expected_durations task_definition_id {task_id}: "
                f"invalid expected_minutes {expected_minutes}"
            )
            continue

        if allow_existing:
            existing = _find_task_expected_duration(
                session,
                task_id,
                house_type_id,
                sub_type_id,
                module_number,
                panel_definition_id,
            )
            if existing:
                existing.expected_minutes = expected_minutes
                continue

        session.add(
            TaskExpectedDuration(
                task_definition_id=task_id,
                house_type_id=house_type_id,
                sub_type_id=sub_type_id,
                module_number=module_number,
                panel_definition_id=panel_definition_id,
                expected_minutes=expected_minutes,
            )
        )


def _get_or_create_work_order(
    session: Session,
    cache: dict[tuple[str, str, int, int | None], WorkOrder],
    key: tuple[str, str, int, int | None],
    allow_existing: bool,
) -> WorkOrder:
    cached = cache.get(key)
    if cached is not None:
        return cached

    project_name, house_identifier, house_type_id, sub_type_id = key
    existing = None
    if allow_existing:
        existing = session.execute(
            select(WorkOrder).where(
                WorkOrder.project_name == project_name,
                WorkOrder.house_identifier == house_identifier,
                WorkOrder.house_type_id == house_type_id,
                WorkOrder.sub_type_id == sub_type_id,
            )
        ).scalar_one_or_none()

    if existing:
        cache[key] = existing
        return existing

    work_order = WorkOrder(
        project_name=project_name,
        house_identifier=house_identifier,
        house_type_id=house_type_id,
        sub_type_id=sub_type_id,
    )
    session.add(work_order)
    session.flush()
    cache[key] = work_order
    return work_order


def _import_module_production_plan(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    session.flush()
    rows = _fetch_rows(
        conn,
        """
        SELECT plan_id, project_name, house_type_id, house_identifier, module_number,
               planned_sequence, planned_start_datetime, planned_assembly_line,
               current_station, sub_type_id, status
        FROM ModuleProductionPlan
        ORDER BY plan_id
        """,
    )

    if not rows:
        return

    house_type_ids = set(session.execute(select(HouseType.id)).scalars())
    sub_type_ids = set(session.execute(select(HouseSubType.id)).scalars())

    normalized_rows: list[dict[str, Any]] = []
    for row in rows:
        house_type_id = row["house_type_id"]
        if house_type_id not in house_type_ids:
            warnings.append(
                f"plan_id {row['plan_id']}: house_type_id {house_type_id} not found"
            )
            continue
        sub_type_id = row["sub_type_id"]
        if sub_type_id is not None and sub_type_id not in sub_type_ids:
            warnings.append(
                f"plan_id {row['plan_id']}: sub_type_id {sub_type_id} not found; "
                "using null sub_type_id"
            )
            sub_type_id = None
        normalized = dict(row)
        normalized["house_type_id"] = house_type_id
        normalized["sub_type_id"] = sub_type_id
        normalized_rows.append(normalized)

    grouped: dict[tuple[str, str, int, int | None], list[dict[str, Any]]] = {}
    for row in normalized_rows:
        key = (
            row["project_name"],
            row["house_identifier"],
            row["house_type_id"],
            row["sub_type_id"],
        )
        grouped.setdefault(key, []).append(row)

    work_orders: dict[tuple[str, str, int, int | None], WorkOrder] = {}
    for key, group_rows in grouped.items():
        work_orders[key] = _get_or_create_work_order(
            session,
            work_orders,
            key,
            allow_existing,
        )

    for row in normalized_rows:
        key = (
            row["project_name"],
            row["house_identifier"],
            row["house_type_id"],
            row["sub_type_id"],
        )
        work_order = work_orders[key]
        current_station_id = _map_station_id(
            row["current_station"],
            warnings,
            f"plan_id {row['plan_id']}",
        )
        status = _map_work_unit_status(
            row["status"], warnings, f"plan_id {row['plan_id']}"
        )
        work_unit = WorkUnit(
            id=row["plan_id"],
            work_order_id=work_order.id,
            module_number=row["module_number"],
            planned_sequence=row["planned_sequence"],
            planned_start_datetime=_parse_datetime(
                row["planned_start_datetime"]
            ),
            planned_assembly_line=row["planned_assembly_line"],
            status=status,
            current_station_id=current_station_id,
        )
        _persist(session, work_unit, allow_existing)

    session.flush()
    _import_panel_production_plan(conn, session, warnings, allow_existing)


def _import_panel_production_plan(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    session.flush()
    rows = _fetch_rows(
        conn,
        """
        SELECT panel_production_plan_id, plan_id, panel_definition_id,
               status, current_station
        FROM PanelProductionPlan
        ORDER BY panel_production_plan_id
        """,
    )

    if not rows:
        return

    work_unit_ids = set(session.execute(select(WorkUnit.id)).scalars())
    panel_definition_ids = set(
        session.execute(select(PanelDefinition.id)).scalars()
    )

    for row in rows:
        work_unit_id = row["plan_id"]
        panel_definition_id = row["panel_definition_id"]
        if work_unit_id not in work_unit_ids:
            warnings.append(
                f"panel_production_plan_id {row['panel_production_plan_id']}: "
                f"work_unit {work_unit_id} not found"
            )
            continue
        if panel_definition_id not in panel_definition_ids:
            warnings.append(
                f"panel_production_plan_id {row['panel_production_plan_id']}: "
                f"panel_definition {panel_definition_id} not found"
            )
            continue
        current_station_id = _map_station_id(
            row["current_station"],
            warnings,
            f"panel_production_plan_id {row['panel_production_plan_id']}",
        )
        status = _map_panel_unit_status(
            row["status"],
            warnings,
            f"panel_production_plan_id {row['panel_production_plan_id']}",
        )
        panel_unit = PanelUnit(
            id=row["panel_production_plan_id"],
            work_unit_id=work_unit_id,
            panel_definition_id=panel_definition_id,
            status=status,
            current_station_id=current_station_id,
        )
        _persist(session, panel_unit, allow_existing)


def _import_task_logs(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    session.flush()
    rows = _fetch_rows(
        conn,
        """
        SELECT task_log_id, plan_id, task_definition_id, worker_id, status,
               started_at, completed_at, station_start, station_finish, notes
        FROM TaskLogs
        ORDER BY task_log_id
        """,
    )
    if not rows:
        return

    work_unit_ids = set(session.execute(select(WorkUnit.id)).scalars())
    task_ids = set(session.execute(select(TaskDefinition.id)).scalars())
    worker_ids = set(session.execute(select(Worker.id)).scalars())
    existing_instances: dict[tuple[int, int, int, int | None], TaskInstance] = {}

    if not work_unit_ids:
        warnings.append("task_logs: no work_units found; skipping import")
        return
    if not task_ids:
        warnings.append("task_logs: no task_definitions found; skipping import")
        return

    if allow_existing:
        for instance in session.execute(
            select(TaskInstance).where(TaskInstance.scope == TaskScope.MODULE)
        ).scalars():
            key = (
                instance.task_definition_id,
                instance.work_unit_id,
                instance.station_id,
                instance.panel_unit_id,
            )
            existing_instances[key] = instance

    grouped: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
    for row in rows:
        station_id = _resolve_station_id(
            row["station_start"],
            row["station_finish"],
            warnings,
            f"task_log_id {row['task_log_id']}",
        )
        if station_id is None:
            continue
        key = (row["plan_id"], row["task_definition_id"], station_id)
        grouped.setdefault(key, []).append(
            {
                "worker_id": row["worker_id"],
                "status": _map_task_status(row["status"]),
                "started_at": _parse_datetime(row["started_at"]),
                "completed_at": _parse_datetime(row["completed_at"]),
                "notes": row["notes"],
            }
        )

    for (plan_id, task_id, station_id), records in grouped.items():
        if plan_id not in work_unit_ids:
            warnings.append(
                f"task_logs plan_id {plan_id}: work_unit not found"
            )
            continue
        if task_id not in task_ids:
            warnings.append(
                f"task_logs task_definition_id {task_id}: task not found"
            )
            continue
        instance_key = (task_id, plan_id, station_id, None)
        task_instance = existing_instances.get(instance_key)

        statuses = [record["status"] for record in records]
        started_at_values = [
            record["started_at"]
            for record in records
            if record["started_at"] is not None
        ]
        completed_at_values = [
            record["completed_at"]
            for record in records
            if record["completed_at"] is not None
        ]
        instance_status = _aggregate_task_status(statuses)
        started_at = min(started_at_values) if started_at_values else None
        completed_at = (
            max(completed_at_values) if completed_at_values else None
        )
        notes = _collect_notes(records)

        if task_instance is None:
            task_instance = TaskInstance(
                task_definition_id=task_id,
                scope=TaskScope.MODULE,
                work_unit_id=plan_id,
                panel_unit_id=None,
                station_id=station_id,
                status=instance_status,
                started_at=started_at,
                completed_at=completed_at
                if instance_status in (TaskStatus.COMPLETED, TaskStatus.SKIPPED)
                else None,
                notes=notes,
            )
            session.add(task_instance)
            session.flush()
            existing_instances[instance_key] = task_instance
        else:
            task_instance.status = instance_status
            task_instance.started_at = started_at
            task_instance.completed_at = (
                completed_at
                if instance_status in (TaskStatus.COMPLETED, TaskStatus.SKIPPED)
                else None
            )
            if notes:
                task_instance.notes = notes

        existing_participations: set[tuple[int, datetime, datetime | None]] = set()
        if allow_existing:
            existing_participations = set(
                session.execute(
                    select(
                        TaskParticipation.worker_id,
                        TaskParticipation.joined_at,
                        TaskParticipation.left_at,
                    ).where(
                        TaskParticipation.task_instance_id
                        == task_instance.id
                    )
                ).all()
            )

        for record in records:
            worker_id = record["worker_id"]
            if worker_id not in worker_ids:
                warnings.append(
                    f"task_logs worker_id {worker_id}: worker not found"
                )
                continue
            joined_at = record["started_at"] or task_instance.started_at
            if joined_at is None:
                warnings.append(
                    f"task_logs plan_id {plan_id}: missing joined_at"
                )
                continue
            left_at = record["completed_at"]
            if allow_existing and (worker_id, joined_at, left_at) in existing_participations:
                continue
            session.add(
                TaskParticipation(
                    task_instance_id=task_instance.id,
                    worker_id=worker_id,
                    joined_at=joined_at,
                    left_at=left_at,
                )
            )


def _import_panel_task_logs(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    session.flush()
    rows = _fetch_rows(
        conn,
        """
        SELECT panel_task_log_id, plan_id, panel_definition_id, task_definition_id,
               worker_id, status, started_at, completed_at,
               station_start, station_finish, notes
        FROM PanelTaskLogs
        ORDER BY panel_task_log_id
        """,
    )
    if not rows:
        return

    work_unit_ids = set(session.execute(select(WorkUnit.id)).scalars())
    task_ids = set(session.execute(select(TaskDefinition.id)).scalars())
    worker_ids = set(session.execute(select(Worker.id)).scalars())
    panel_lookup: dict[tuple[int, int], int] = {
        (row.work_unit_id, row.panel_definition_id): row.id
        for row in session.execute(
            select(
                PanelUnit.id, PanelUnit.work_unit_id, PanelUnit.panel_definition_id
            )
        )
    }

    if not work_unit_ids:
        warnings.append("panel_task_logs: no work_units found; skipping import")
        return
    if not panel_lookup:
        warnings.append("panel_task_logs: no panel_units found; skipping import")
        return
    if not task_ids:
        warnings.append("panel_task_logs: no task_definitions found; skipping import")
        return

    existing_instances: dict[tuple[int, int, int, int], TaskInstance] = {}
    if allow_existing:
        for instance in session.execute(
            select(TaskInstance).where(TaskInstance.scope == TaskScope.PANEL)
        ).scalars():
            if instance.panel_unit_id is None:
                continue
            key = (
                instance.task_definition_id,
                instance.work_unit_id,
                instance.station_id,
                instance.panel_unit_id,
            )
            existing_instances[key] = instance

    grouped: dict[
        tuple[int, int, int, int], list[dict[str, Any]]
    ] = {}
    for row in rows:
        station_id = _resolve_station_id(
            row["station_start"],
            row["station_finish"],
            warnings,
            f"panel_task_log_id {row['panel_task_log_id']}",
        )
        if station_id is None:
            continue
        key = (
            row["plan_id"],
            row["panel_definition_id"],
            row["task_definition_id"],
            station_id,
        )
        grouped.setdefault(key, []).append(
            {
                "worker_id": row["worker_id"],
                "status": _map_task_status(row["status"]),
                "started_at": _parse_datetime(row["started_at"]),
                "completed_at": _parse_datetime(row["completed_at"]),
                "notes": row["notes"],
            }
        )

    for (plan_id, panel_definition_id, task_id, station_id), records in grouped.items():
        if plan_id not in work_unit_ids:
            warnings.append(
                f"panel_task_logs plan_id {plan_id}: work_unit not found"
            )
            continue
        if task_id not in task_ids:
            warnings.append(
                f"panel_task_logs task_definition_id {task_id}: task not found"
            )
            continue
        panel_key = (plan_id, panel_definition_id)
        panel_unit_id = panel_lookup.get(panel_key)
        if panel_unit_id is None:
            warnings.append(
                f"panel_task_logs plan_id {plan_id} panel_definition_id "
                f"{panel_definition_id}: panel_unit not found"
            )
            continue
        instance_key = (task_id, plan_id, station_id, panel_unit_id)
        task_instance = existing_instances.get(instance_key)

        statuses = [record["status"] for record in records]
        started_at_values = [
            record["started_at"]
            for record in records
            if record["started_at"] is not None
        ]
        completed_at_values = [
            record["completed_at"]
            for record in records
            if record["completed_at"] is not None
        ]
        instance_status = _aggregate_task_status(statuses)
        started_at = min(started_at_values) if started_at_values else None
        completed_at = (
            max(completed_at_values) if completed_at_values else None
        )
        notes = _collect_notes(records)

        if task_instance is None:
            task_instance = TaskInstance(
                task_definition_id=task_id,
                scope=TaskScope.PANEL,
                work_unit_id=plan_id,
                panel_unit_id=panel_unit_id,
                station_id=station_id,
                status=instance_status,
                started_at=started_at,
                completed_at=completed_at
                if instance_status in (TaskStatus.COMPLETED, TaskStatus.SKIPPED)
                else None,
                notes=notes,
            )
            session.add(task_instance)
            session.flush()
            existing_instances[instance_key] = task_instance
        else:
            task_instance.status = instance_status
            task_instance.started_at = started_at
            task_instance.completed_at = (
                completed_at
                if instance_status in (TaskStatus.COMPLETED, TaskStatus.SKIPPED)
                else None
            )
            if notes:
                task_instance.notes = notes

        existing_participations: set[tuple[int, datetime, datetime | None]] = set()
        if allow_existing:
            existing_participations = set(
                session.execute(
                    select(
                        TaskParticipation.worker_id,
                        TaskParticipation.joined_at,
                        TaskParticipation.left_at,
                    ).where(
                        TaskParticipation.task_instance_id
                        == task_instance.id
                    )
                ).all()
            )

        for record in records:
            worker_id = record["worker_id"]
            if worker_id not in worker_ids:
                warnings.append(
                    f"panel_task_logs worker_id {worker_id}: worker not found"
                )
                continue
            joined_at = record["started_at"] or task_instance.started_at
            if joined_at is None:
                warnings.append(
                    f"panel_task_logs plan_id {plan_id}: missing joined_at"
                )
                continue
            left_at = record["completed_at"]
            if allow_existing and (worker_id, joined_at, left_at) in existing_participations:
                continue
            session.add(
                TaskParticipation(
                    task_instance_id=task_instance.id,
                    worker_id=worker_id,
                    joined_at=joined_at,
                    left_at=left_at,
                )
            )


def _import_task_pauses(
    conn: sqlite3.Connection,
    session: Session,
    warnings: list[str],
    allow_existing: bool,
) -> None:
    session.flush()
    if not _table_exists(conn, "TaskPauses"):
        warnings.append("TaskPauses table not found; skipping")
        return

    pause_rows = _fetch_rows(
        conn,
        """
        SELECT task_pause_id, task_log_id, panel_task_log_id, paused_at, resumed_at,
               reason, rework_task_log_id
        FROM TaskPauses
        ORDER BY task_pause_id
        """,
    )
    if not pause_rows:
        return

    task_instance_lookup = {
        (
            row.task_definition_id,
            row.work_unit_id,
            row.station_id,
            row.panel_unit_id,
        ): row.id
        for row in session.execute(select(TaskInstance)).scalars()
    }
    if not task_instance_lookup:
        warnings.append("task_pauses: no task_instances found; skipping")
        return

    reason_lookup = {
        _normalize_text(row.name): row.id
        for row in session.execute(select(PauseReason)).scalars()
        if _normalize_text(row.name)
    }

    panel_lookup: dict[tuple[int, int], int] = {
        (row.work_unit_id, row.panel_definition_id): row.id
        for row in session.execute(
            select(
                PanelUnit.id, PanelUnit.work_unit_id, PanelUnit.panel_definition_id
            )
        )
    }

    task_log_map: dict[int, int] = {}
    if _table_exists(conn, "TaskLogs"):
        task_log_rows = _fetch_rows(
            conn,
            """
            SELECT task_log_id, plan_id, task_definition_id,
                   station_start, station_finish
            FROM TaskLogs
            """,
        )
        for row in task_log_rows:
            station_id = _resolve_station_id(
                row["station_start"],
                row["station_finish"],
                warnings,
                f"task_log_id {row['task_log_id']}",
            )
            if station_id is None:
                continue
            key = (row["task_definition_id"], row["plan_id"], station_id, None)
            instance_id = task_instance_lookup.get(key)
            if instance_id is None:
                warnings.append(
                    f"task_pauses task_log_id {row['task_log_id']}: "
                    "task_instance not found"
                )
                continue
            task_log_map[row["task_log_id"]] = instance_id
    else:
        warnings.append("task_pauses: TaskLogs table not found")

    panel_task_log_map: dict[int, int] = {}
    if _table_exists(conn, "PanelTaskLogs"):
        panel_task_log_rows = _fetch_rows(
            conn,
            """
            SELECT panel_task_log_id, plan_id, panel_definition_id, task_definition_id,
                   station_start, station_finish
            FROM PanelTaskLogs
            """,
        )
        for row in panel_task_log_rows:
            station_id = _resolve_station_id(
                row["station_start"],
                row["station_finish"],
                warnings,
                f"panel_task_log_id {row['panel_task_log_id']}",
            )
            if station_id is None:
                continue
            panel_key = (row["plan_id"], row["panel_definition_id"])
            panel_unit_id = panel_lookup.get(panel_key)
            if panel_unit_id is None:
                warnings.append(
                    f"task_pauses panel_task_log_id {row['panel_task_log_id']}: "
                    "panel_unit not found"
                )
                continue
            key = (
                row["task_definition_id"],
                row["plan_id"],
                station_id,
                panel_unit_id,
            )
            instance_id = task_instance_lookup.get(key)
            if instance_id is None:
                warnings.append(
                    f"task_pauses panel_task_log_id {row['panel_task_log_id']}: "
                    "task_instance not found"
                )
                continue
            panel_task_log_map[row["panel_task_log_id"]] = instance_id
    else:
        warnings.append("task_pauses: PanelTaskLogs table not found")

    for row in pause_rows:
        task_pause_id = row["task_pause_id"]
        task_log_id = row["task_log_id"]
        panel_task_log_id = row["panel_task_log_id"]
        rework_task_log_id = row["rework_task_log_id"]

        if task_log_id and panel_task_log_id:
            warnings.append(
                f"task_pause_id {task_pause_id}: "
                "both task_log_id and panel_task_log_id set; using task_log_id"
            )

        task_instance_id = None
        if task_log_id:
            task_instance_id = task_log_map.get(task_log_id)
        elif panel_task_log_id:
            task_instance_id = panel_task_log_map.get(panel_task_log_id)
        elif rework_task_log_id:
            warnings.append(
                f"task_pause_id {task_pause_id}: rework_task_log_id not supported"
            )
            continue
        else:
            warnings.append(
                f"task_pause_id {task_pause_id}: missing task_log_id"
            )
            continue

        if task_instance_id is None:
            warnings.append(
                f"task_pause_id {task_pause_id}: task_instance not found"
            )
            continue

        paused_at = _parse_datetime(row["paused_at"])
        if paused_at is None:
            warnings.append(
                f"task_pause_id {task_pause_id}: invalid paused_at"
            )
            continue
        resumed_at = _parse_datetime(row["resumed_at"])

        raw_reason = row["reason"]
        normalized = _normalize_text(raw_reason)
        reason_id = reason_lookup.get(normalized) if normalized else None
        reason_text = None
        if reason_id is None and raw_reason:
            reason_text = str(raw_reason).strip()

        pause = TaskPause(
            id=task_pause_id,
            task_instance_id=task_instance_id,
            reason_id=reason_id,
            reason_text=reason_text,
            paused_at=paused_at,
            resumed_at=resumed_at,
        )
        _persist(session, pause, allow_existing)


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
        if not applicable or not durations:
            continue
        if len(applicable) != len(durations):
            mismatch_count += 1

    print("\nPanel task duration checks:")
    print(f"- missing task_length for applicable_tasks: {missing_duration}")
    print(
        "- applicable_tasks/task_length length mismatches: "
        f"{mismatch_count}"
    )
    return 0


def _import(
    sqlite_path: Path,
    sections: set[str],
    allow_existing: bool,
    truncate: bool,
) -> int:
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
                _ensure_empty(
                    session, HouseType, "house_types", allow_existing
                )
                _ensure_empty(
                    session, HouseSubType, "house_sub_types", allow_existing
                )
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
            if "module_task_templates" in sections and "tasks" not in sections:
                _ensure_empty(
                    session, TaskApplicability, "task_applicability", allow_existing
                )
                _ensure_empty(
                    session,
                    TaskExpectedDuration,
                    "task_expected_durations",
                    allow_existing,
                )
            if "specialties" in sections:
                _ensure_empty(session, Skill, "skills", allow_existing)
            if "workers" in sections:
                _ensure_empty(session, Worker, "workers", allow_existing)
            if "module_production" in sections:
                _ensure_empty(session, WorkOrder, "work_orders", allow_existing)
                _ensure_empty(session, WorkUnit, "work_units", allow_existing)
                _ensure_empty(session, PanelUnit, "panel_units", allow_existing)
            if "task_logs" in sections or "panel_task_logs" in sections:
                _ensure_empty(
                    session, TaskInstance, "task_instances", allow_existing
                )
                _ensure_empty(
                    session,
                    TaskParticipation,
                    "task_participations",
                    allow_existing,
                )
            if "task_pauses" in sections:
                _ensure_empty(session, TaskPause, "task_pauses", allow_existing)

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
        if "module_task_templates" in sections:
            _import_panel_task_applicability(
                conn, session, warnings, allow_existing
            )
            _import_module_task_applicability(
                conn, session, warnings, allow_existing
            )
            _import_module_task_expected_durations(
                conn, session, warnings, allow_existing
            )
        if "specialties" in sections:
            _import_specialties(conn, session, allow_existing)
        if "workers" in sections:
            _import_workers(conn, session, warnings, allow_existing)
        if "module_production" in sections:
            _import_module_production_plan(conn, session, warnings, allow_existing)
        if "task_logs" in sections:
            _import_task_logs(conn, session, warnings, allow_existing)
        if "panel_task_logs" in sections:
            _import_panel_task_logs(conn, session, warnings, allow_existing)
        if "task_pauses" in sections:
            _import_task_pauses(conn, session, warnings, allow_existing)

        if "workers" in sections:
            _import_worker_skills(conn, session, warnings, allow_existing)
        if "specialties" in sections or "tasks" in sections:
            _import_task_skill_requirements(
                conn, session, warnings, allow_existing
            )

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
        help=(
            "Comma-separated sections (tasks,houses,panels,pause_reasons,"
            "comment_templates,module_task_templates,workers,specialties,"
            "module_production,task_logs,panel_task_logs,task_pauses)."
        ),
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
    return _import(
        sqlite_path,
        sections,
        args.allow_existing,
        args.truncate,
    )


if __name__ == "__main__":
    raise SystemExit(main())
