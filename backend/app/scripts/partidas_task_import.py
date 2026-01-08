from __future__ import annotations

import argparse
import csv
import re
import unicodedata
import zipfile
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable

from sqlalchemy import delete, select, text

from app.db.session import SessionLocal
from app.models import (
    HouseType,
    Skill,
    TaskApplicability,
    TaskDefinition,
    TaskExpectedDuration,
    TaskSkillRequirement,
    TaskWorkerRestriction,
    Station,
    Worker,
    WorkerSkill,
)
from app.models.enums import RestrictionType, TaskScope
from app.scripts.geovictoria_name_proposals import GeoVictoriaUser, fetch_geovictoria_users


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PARTIDAS_PATH = REPO_ROOT / "docs" / "references" / "partidas_geovictoria.xlsx"
FALLBACK_PARTIDAS_PATH = REPO_ROOT / "docs" / "references" / "partidas.csv"
SHEET_XML = "xl/worksheets/sheet1.xml"
SHARED_STRINGS_XML = "xl/sharedStrings.xml"


@dataclass(frozen=True)
class PartidaEntry:
    task_name: str
    module_number: int
    duration_minutes: float | None
    worker_names: list[str]
    station_sequence: int | None
    specialty: str | None


def _read_xlsx_rows(path: Path) -> list[list[str]]:
    import xml.etree.ElementTree as ET

    with zipfile.ZipFile(path) as zf:
        shared = ET.fromstring(zf.read(SHARED_STRINGS_XML))
        strings = [
            text.text or ""
            for text in shared.iter(
                "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"
            )
        ]
        sheet = ET.fromstring(zf.read(SHEET_XML))

    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rows: list[list[str]] = []
    for row in sheet.findall("m:sheetData/m:row", ns):
        cells: dict[int, str] = {}
        for cell in row.findall("m:c", ns):
            cell_ref = cell.get("r")
            if not cell_ref:
                continue
            idx = _column_index(cell_ref)
            value_el = cell.find("m:v", ns)
            value = "" if value_el is None else value_el.text or ""
            if cell.get("t") == "s":
                try:
                    value = strings[int(value)]
                except (ValueError, IndexError):
                    value = ""
            cells[idx] = value
        max_idx = max(cells) if cells else -1
        rows.append([cells.get(i, "") for i in range(max_idx + 1)])
    return rows


def _read_csv_rows(path: Path) -> list[list[str]]:
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                return list(csv.reader(handle))
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"Unable to decode CSV file: {path}")


def _read_rows(path: Path) -> list[list[str]]:
    if path.suffix.lower() == ".csv":
        return _read_csv_rows(path)
    return _read_xlsx_rows(path)


def _column_index(cell_ref: str) -> int:
    match = re.match(r"([A-Z]+)", cell_ref)
    if not match:
        raise ValueError(f"Invalid cell reference: {cell_ref}")
    letters = match.group(1)
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - 64)
    return idx - 1


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def _normalize_name(value: str) -> str:
    value = _strip_accents(value)
    value = re.sub(r"[^a-zA-Z0-9]+", " ", value.lower()).strip()
    return re.sub(r"\s+", " ", value)


def _normalize_specialty(value: str) -> str:
    return _normalize_name(value)


def _split_names(cell: str) -> list[str]:
    if ";" in cell:
        parts = [part.strip() for part in cell.split(";")]
    elif "," in cell:
        parts = [part.strip() for part in cell.split(",")]
    else:
        parts = [cell.strip()]
    return [part for part in parts if part]


def _parse_module(value: str) -> int | None:
    match = re.search(r"(\d+)", value)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _parse_station_sequence(value: str) -> int | None:
    text = value.strip().upper()
    if not text:
        return None
    if text == "ARMADO":
        return 11
    match = re.match(r"ESTACION\s+(\d+)", text)
    if not match:
        return None
    try:
        number = int(match.group(1))
    except ValueError:
        return None
    if number < 1:
        return None
    return 11 + number


def _parse_duration(value: str) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", ".")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _partidas_entries(
    path: Path, *, prefer_geovictoria: bool, warnings: list[str]
) -> list[PartidaEntry]:
    rows = _read_rows(path)
    if not rows:
        raise RuntimeError("Partidas file has no rows.")
    header = rows[0]
    try:
        name_idx = header.index("Nombre de tarea")
    except ValueError as exc:
        raise RuntimeError("Missing 'Nombre de tarea' column in partidas sheet.") from exc
    try:
        duration_idx = header.index("Duración (minutos)")
    except ValueError as exc:
        raise RuntimeError("Missing 'Duración (minutos)' column in partidas sheet.") from exc
    try:
        module_idx = header.index("MODULO")
    except ValueError as exc:
        raise RuntimeError("Missing 'MODULO' column in partidas sheet.") from exc
    try:
        station_idx = header.index("ESTACION")
    except ValueError as exc:
        raise RuntimeError("Missing 'ESTACION' column in partidas sheet.") from exc
    try:
        specialty_idx = header.index("Especialidad")
    except ValueError as exc:
        raise RuntimeError("Missing 'Especialidad' column in partidas sheet.") from exc

    workers_idx = None
    geovictoria_idx = None
    if "Nombres de los trabajadores" in header:
        workers_idx = header.index("Nombres de los trabajadores")
    if "Nombres de trabajadores (GeoVictoria)" in header:
        geovictoria_idx = header.index("Nombres de trabajadores (GeoVictoria)")

    entries: list[PartidaEntry] = []
    for row in rows[1:]:
        if name_idx >= len(row):
            continue
        task_name = row[name_idx].strip()
        if not task_name:
            continue
        module_text = row[module_idx].strip() if module_idx < len(row) else ""
        module_number = _parse_module(module_text)
        if module_number is None:
            warnings.append(
                f"Skipping task '{task_name}': invalid module value '{module_text}'."
            )
            continue
        station_text = row[station_idx].strip() if station_idx < len(row) else ""
        station_sequence = _parse_station_sequence(station_text)
        specialty = (
            row[specialty_idx].strip() if specialty_idx < len(row) else ""
        ) or None

        duration = None
        if duration_idx < len(row):
            duration = _parse_duration(row[duration_idx])

        worker_cell = ""
        if prefer_geovictoria and geovictoria_idx is not None:
            if geovictoria_idx < len(row):
                worker_cell = row[geovictoria_idx].strip()
        if not worker_cell and workers_idx is not None and workers_idx < len(row):
            worker_cell = row[workers_idx].strip()

        worker_names = _split_names(worker_cell) if worker_cell else []
        entries.append(
            PartidaEntry(
                task_name=task_name,
                module_number=module_number,
                duration_minutes=duration,
                worker_names=worker_names,
                station_sequence=station_sequence,
                specialty=specialty,
            )
        )
    return entries


def _worker_lookup(workers: Iterable[Worker]) -> tuple[dict[str, Worker], list[str]]:
    lookup: dict[str, Worker] = {}
    duplicates: list[str] = []
    for worker in workers:
        full = f"{worker.first_name} {worker.last_name}".strip()
        normalized = _normalize_name(full)
        reversed_full = _normalize_name(f"{worker.last_name} {worker.first_name}")
        for key in {normalized, reversed_full}:
            if not key:
                continue
            if key in lookup and lookup[key].id != worker.id:
                duplicates.append(full)
                continue
            lookup[key] = worker
    return lookup, duplicates


def _geovictoria_match(
    name: str, users: Iterable[GeoVictoriaUser]
) -> tuple[GeoVictoriaUser | None, float]:
    normalized_target = _normalize_name(name)
    best: GeoVictoriaUser | None = None
    best_score = 0.0
    for user in users:
        full_name = user.full_name
        if not full_name:
            continue
        normalized_full = _normalize_name(full_name)
        reversed_full = _normalize_name(
            " ".join(part for part in [user.last_name, user.first_name] if part)
        )
        score = max(
            SequenceMatcher(None, normalized_target, normalized_full).ratio(),
            SequenceMatcher(None, normalized_target, reversed_full).ratio(),
        )
        if score > best_score:
            best_score = score
            best = user
    return best, best_score


def _ensure_partidas_path(path: Path | None) -> Path:
    if path is not None:
        return path
    if DEFAULT_PARTIDAS_PATH.exists():
        return DEFAULT_PARTIDAS_PATH
    return FALLBACK_PARTIDAS_PATH


def _ensure_worker_sequence(session) -> None:
    sequence = session.execute(
        text("SELECT pg_get_serial_sequence('workers', 'id')")
    ).scalar()
    if not sequence:
        return
    max_id = session.execute(text("SELECT MAX(id) FROM workers")).scalar() or 0
    session.execute(
        text("SELECT setval(:sequence, :value, true)"),
        {"sequence": sequence, "value": max_id},
    )


def _ensure_task_definition_sequence(session) -> None:
    sequence = session.execute(
        text("SELECT pg_get_serial_sequence('task_definitions', 'id')")
    ).scalar()
    if not sequence:
        return
    max_id = session.execute(text("SELECT MAX(id) FROM task_definitions")).scalar() or 0
    session.execute(
        text("SELECT setval(:sequence, :value, true)"),
        {"sequence": sequence, "value": max_id},
    )


def run_partidas_import(
    *,
    house_type_id: int,
    partidas_path: Path | None = None,
    prefer_geovictoria: bool = True,
    reset_regular_crew: bool = True,
    reset_expected_durations: bool = True,
    match_geovictoria: bool = True,
    geovictoria_min_score: float = 0.6,
) -> str:
    warnings: list[str] = []
    output: list[str] = []
    partidas_path = _ensure_partidas_path(partidas_path)
    if not partidas_path.exists():
        raise RuntimeError(f"Partidas file not found: {partidas_path}")

    entries = _partidas_entries(
        partidas_path, prefer_geovictoria=prefer_geovictoria, warnings=warnings
    )
    if not entries:
        raise RuntimeError("No task rows found in partidas sheet.")

    geovictoria_users: list[GeoVictoriaUser] = []
    if match_geovictoria:
        try:
            geovictoria_users = fetch_geovictoria_users()
        except Exception as exc:
            warnings.append(f"GeoVictoria lookup failed; skipping IDs ({exc}).")

    with SessionLocal() as session:
        house_type = session.get(HouseType, house_type_id)
        if not house_type:
            raise RuntimeError(f"House type {house_type_id} not found.")

        output.append(
            f"House type: {house_type.name} (modules: {house_type.number_of_modules})"
        )
        output.append(f"Partidas rows: {len(entries)}")

        task_names = sorted({entry.task_name for entry in entries})
        task_station_sequence: dict[str, int | None] = {}
        task_specialty_names: dict[str, str] = {}
        specialties_by_key: dict[str, str] = {}
        for entry in entries:
            if entry.task_name not in task_station_sequence:
                task_station_sequence[entry.task_name] = entry.station_sequence
            else:
                existing_station = task_station_sequence[entry.task_name]
                if (
                    entry.station_sequence is not None
                    and existing_station is not None
                    and entry.station_sequence != existing_station
                ):
                    warnings.append(
                        f"Task '{entry.task_name}' has multiple station values; "
                        f"using {existing_station}."
                    )
            if entry.specialty:
                specialty_key = _normalize_specialty(entry.specialty)
                if not specialty_key:
                    continue
                existing_specialty = task_specialty_names.get(entry.task_name)
                if existing_specialty is None:
                    task_specialty_names[entry.task_name] = entry.specialty.strip()
                elif _normalize_specialty(existing_specialty) != specialty_key:
                    warnings.append(
                        f"Task '{entry.task_name}' has multiple specialties; "
                        f"using {existing_specialty}."
                    )
                specialties_by_key.setdefault(
                    specialty_key, entry.specialty.strip()
                )

        existing_tasks = {
            task.name: task
            for task in session.execute(
                select(TaskDefinition).where(TaskDefinition.scope == TaskScope.MODULE)
            ).scalars()
        }
        created = 0
        _ensure_task_definition_sequence(session)
        for name in task_names:
            if name in existing_tasks:
                continue
            station_sequence = task_station_sequence.get(name)
            task = TaskDefinition(
                name=name,
                scope=TaskScope.MODULE,
                default_station_sequence=station_sequence,
                active=True,
                skippable=False,
                concurrent_allowed=False,
                advance_trigger=False,
                is_rework=False,
                dependencies_json=None,
            )
            session.add(task)
            existing_tasks[name] = task
            created += 1
        session.flush()
        output.append(f"Tasks created: {created}")

        existing_skills: dict[str, Skill] = {}
        for skill in session.execute(select(Skill)).scalars():
            key = _normalize_specialty(skill.name)
            if key:
                existing_skills.setdefault(key, skill)
        skills_created = 0
        for key, name in specialties_by_key.items():
            if key in existing_skills:
                continue
            skill = Skill(name=name)
            session.add(skill)
            existing_skills[key] = skill
            skills_created += 1
        if skills_created:
            session.flush()
        output.append(f"Specialties created: {skills_created}")

        task_skill_ids: dict[str, int] = {}
        for task_name, specialty in task_specialty_names.items():
            key = _normalize_specialty(specialty)
            skill = existing_skills.get(key)
            if not skill:
                warnings.append(
                    f"Specialty '{specialty}' not found for task '{task_name}'."
                )
                continue
            task_skill_ids[task_name] = skill.id

        if task_skill_ids:
            task_ids_for_skills = [
                existing_tasks[name].id for name in task_skill_ids
            ]
            session.execute(
                delete(TaskSkillRequirement).where(
                    TaskSkillRequirement.task_definition_id.in_(task_ids_for_skills)
                )
            )
            task_skills_added = 0
            for task_name, skill_id in task_skill_ids.items():
                task_id = existing_tasks[task_name].id
                session.add(
                    TaskSkillRequirement(
                        task_definition_id=task_id, skill_id=skill_id
                    )
                )
                task_skills_added += 1
            output.append(f"Task specialties assigned: {task_skills_added}")

        workers = list(session.execute(select(Worker)).scalars())
        lookup, duplicates = _worker_lookup(workers)
        geovictoria_lookup: dict[str, Worker] = {}
        for worker in workers:
            for value in (worker.geovictoria_id, worker.geovictoria_identifier):
                if value:
                    geovictoria_lookup[value.strip()] = worker
        if duplicates:
            warnings.append(
                "Duplicate worker names detected; matching may be ambiguous: "
                + ", ".join(sorted(set(duplicates)))
            )

        worker_station_sequences: dict[str, set[int]] = {}
        for entry in entries:
            if entry.station_sequence is None:
                continue
            for name in entry.worker_names:
                normalized = _normalize_name(name)
                if not normalized:
                    continue
                worker_station_sequences.setdefault(normalized, set()).add(
                    entry.station_sequence
                )

        stations_by_sequence: dict[int, list[int]] = {}
        for station in session.execute(select(Station)).scalars():
            if station.sequence_order is None:
                continue
            stations_by_sequence.setdefault(station.sequence_order, []).append(station.id)
        for station_ids in stations_by_sequence.values():
            station_ids.sort()

        task_workers: dict[int, set[int]] = {}
        missing_workers: set[str] = set()
        created_workers = 0
        worker_skill_pairs: set[tuple[int, int]] = set()
        if entries:
            _ensure_worker_sequence(session)
        for entry in entries:
            task_id = existing_tasks[entry.task_name].id
            if task_id not in task_workers:
                task_workers[task_id] = set()
            for name in entry.worker_names:
                normalized = _normalize_name(name)
                worker = lookup.get(normalized)
                if not worker:
                    first, last = _split_worker_name(name)
                    assigned_station_ids = _station_ids_for_worker(
                        normalized,
                        name,
                        worker_station_sequences,
                        stations_by_sequence,
                        warnings,
                    )
                    geovictoria_id = None
                    geovictoria_identifier = None
                    if geovictoria_users:
                        match, score = _geovictoria_match(
                            name, geovictoria_users
                        )
                        if match and score >= geovictoria_min_score:
                            geovictoria_id = match.geovictoria_id or match.identifier
                            geovictoria_identifier = (
                                match.identifier or match.geovictoria_id
                            )
                            existing_by_id = None
                            if geovictoria_id:
                                existing_by_id = geovictoria_lookup.get(
                                    geovictoria_id.strip()
                                )
                            if not existing_by_id and geovictoria_identifier:
                                existing_by_id = geovictoria_lookup.get(
                                    geovictoria_identifier.strip()
                                )
                            if existing_by_id:
                                worker = existing_by_id
                                lookup[normalized] = worker
                                task_workers[task_id].add(worker.id)
                                continue
                        else:
                            warnings.append(
                                f"No GeoVictoria ID match for '{name}' (score {score:.2f})."
                            )
                    worker = Worker(
                        geovictoria_id=geovictoria_id,
                        geovictoria_identifier=geovictoria_identifier,
                        first_name=first,
                        last_name=last,
                        pin=None,
                        login_required=False,
                        active=True,
                        assigned_station_ids=assigned_station_ids,
                        supervisor_id=None,
                    )
                    session.add(worker)
                    session.flush()
                    lookup[normalized] = worker
                    created_workers += 1
                    if geovictoria_id is None and geovictoria_identifier is None:
                        missing_workers.add(name)
                task_workers[task_id].add(worker.id)
                if entry.specialty:
                    specialty_key = _normalize_specialty(entry.specialty)
                    skill = existing_skills.get(specialty_key)
                    if skill:
                        worker_skill_pairs.add((worker.id, skill.id))

        if created_workers:
            output.append(f"Workers created: {created_workers}")

        if worker_skill_pairs:
            existing_worker_ids = sorted({pair[0] for pair in worker_skill_pairs})
            existing_pairs = set(
                session.execute(
                    select(WorkerSkill.worker_id, WorkerSkill.skill_id).where(
                        WorkerSkill.worker_id.in_(existing_worker_ids)
                    )
                ).all()
            )
            worker_skills_added = 0
            for pair in sorted(worker_skill_pairs):
                if pair in existing_pairs:
                    continue
                worker_id, skill_id = pair
                session.add(WorkerSkill(worker_id=worker_id, skill_id=skill_id))
                worker_skills_added += 1
            if worker_skills_added:
                output.append(f"Worker specialties assigned: {worker_skills_added}")

        task_ids = [existing_tasks[name].id for name in task_names]
        if reset_regular_crew and task_ids:
            session.execute(
                delete(TaskWorkerRestriction).where(
                    TaskWorkerRestriction.task_definition_id.in_(task_ids),
                    TaskWorkerRestriction.restriction_type
                    == RestrictionType.REGULAR_CREW,
                )
            )

        crew_added = 0
        for task_id, worker_ids in task_workers.items():
            for worker_id in sorted(worker_ids):
                session.add(
                    TaskWorkerRestriction(
                        task_definition_id=task_id,
                        worker_id=worker_id,
                        restriction_type=RestrictionType.REGULAR_CREW,
                    )
                )
                crew_added += 1
        output.append(f"Regular crew assignments added: {crew_added}")

        if missing_workers:
            warnings.append(
                "Unmatched worker names: " + ", ".join(sorted(missing_workers))
            )

        module_numbers = list(range(1, house_type.number_of_modules + 1))
        module_tasks = list(
            session.execute(
                select(TaskDefinition).where(TaskDefinition.scope == TaskScope.MODULE)
            ).scalars()
        )

        session.execute(
            delete(TaskApplicability).where(
                TaskApplicability.house_type_id == house_type_id,
                TaskApplicability.sub_type_id.is_(None),
                TaskApplicability.panel_definition_id.is_(None),
                TaskApplicability.module_number.in_(module_numbers),
            )
        )
        existing_applicability: dict[tuple[int, int], TaskApplicability] = {}

        created_applicability = 0
        for task in module_tasks:
            for module_number in module_numbers:
                record = TaskApplicability(
                    task_definition_id=task.id,
                    house_type_id=house_type_id,
                    sub_type_id=None,
                    module_number=module_number,
                    panel_definition_id=None,
                    applies=False,
                    station_sequence_order=task.default_station_sequence,
                )
                session.add(record)
                existing_applicability[(task.id, module_number)] = record
                created_applicability += 1

        output.append(f"Task applicability rows created: {created_applicability}")

        durations_added = 0
        if reset_expected_durations:
            session.execute(
                delete(TaskExpectedDuration).where(
                    TaskExpectedDuration.house_type_id == house_type_id,
                    TaskExpectedDuration.sub_type_id.is_(None),
                    TaskExpectedDuration.panel_definition_id.is_(None),
                    TaskExpectedDuration.module_number.in_(module_numbers),
                )
            )

        seen_duration_keys: set[tuple[int, int]] = set()
        for entry in entries:
            if entry.module_number not in module_numbers:
                warnings.append(
                    f"Skipping task '{entry.task_name}': module {entry.module_number} "
                    f"exceeds house type module count."
                )
                continue
            task = existing_tasks[entry.task_name]
            key = (task.id, entry.module_number)
            if key in seen_duration_keys:
                warnings.append(
                    f"Duplicate duration for '{entry.task_name}' module {entry.module_number};"
                    " keeping latest value."
                )
            seen_duration_keys.add(key)
            record = existing_applicability.get(key)
            if record:
                record.applies = True
            if entry.duration_minutes is None:
                warnings.append(
                    f"Missing duration for '{entry.task_name}' module {entry.module_number}."
                )
                continue
            session.add(
                TaskExpectedDuration(
                    task_definition_id=task.id,
                    house_type_id=house_type_id,
                    sub_type_id=None,
                    module_number=entry.module_number,
                    panel_definition_id=None,
                    expected_minutes=entry.duration_minutes,
                )
            )
            durations_added += 1

        output.append(f"Expected durations added: {durations_added}")
        session.commit()

    if warnings:
        output.append("")
        output.append("Warnings:")
        output.extend(f"- {warning}" for warning in warnings)
    return "\n".join(output)


def _split_worker_name(name: str) -> tuple[str, str]:
    parts = [part for part in name.strip().split() if part]
    if not parts:
        return ("", "")
    if len(parts) == 1:
        return (parts[0], "")
    return (parts[0], " ".join(parts[1:]))


def _station_ids_for_worker(
    normalized_name: str,
    display_name: str,
    worker_station_sequences: dict[str, set[int]],
    stations_by_sequence: dict[int, list[int]],
    warnings: list[str],
) -> list[int] | None:
    sequences = worker_station_sequences.get(normalized_name, set())
    station_ids: list[int] = []
    for seq in sorted(sequences):
        station_list = stations_by_sequence.get(seq)
        if not station_list:
            warnings.append(
                f"No station found with sequence {seq} for worker '{display_name}'."
            )
            continue
        station_ids.extend(station_list)
    return station_ids or None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import partidas tasks/crew/applicability into the database."
    )
    parser.add_argument("--house-type-id", type=int, required=True)
    parser.add_argument(
        "--partidas",
        type=Path,
        default=None,
        help="Path to partidas XLSX (default: docs/references/partidas_geovictoria.xlsx).",
    )
    parser.add_argument(
        "--no-geovictoria",
        action="store_true",
        help="Use the original worker column instead of GeoVictoria names.",
    )
    parser.add_argument(
        "--skip-regular-crew",
        action="store_true",
        help="Skip updating regular crew restrictions.",
    )
    parser.add_argument(
        "--skip-expected-durations",
        action="store_true",
        help="Skip resetting/adding expected durations.",
    )
    parser.add_argument(
        "--skip-geovictoria-match",
        action="store_true",
        help="Skip fetching GeoVictoria IDs when creating missing workers.",
    )
    parser.add_argument(
        "--geovictoria-min-score",
        type=float,
        default=0.6,
        help="Minimum GeoVictoria name match score (default: 0.6).",
    )
    args = parser.parse_args()

    output = run_partidas_import(
        house_type_id=args.house_type_id,
        partidas_path=args.partidas,
        prefer_geovictoria=not args.no_geovictoria,
        reset_regular_crew=not args.skip_regular_crew,
        reset_expected_durations=not args.skip_expected_durations,
        match_geovictoria=not args.skip_geovictoria_match,
        geovictoria_min_score=args.geovictoria_min_score,
    )
    print(output)


if __name__ == "__main__":
    main()
