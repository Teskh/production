from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin_page
from app.models.admin import AdminUser
from app.models.enums import QCTriggerEventType, RestrictionType, StationRole, TaskScope
from app.models.house import HouseSubType, HouseType
from app.models.qc import QCCheckDefinition, QCCheckInstance, QCTrigger
from app.models.stations import Station
from app.models.tasks import TaskApplicability, TaskDefinition, TaskInstance
from app.models.workers import Skill, TaskSkillRequirement, TaskWorkerRestriction, Worker
from app.services.conditions import TaskConditionRules, load_condition_context
from app.services.task_applicability import resolve_task_station_sequence
from app.schemas.tasks import (
    AdvanceCoverageHouseType,
    AdvanceCoverageStation,
    TaskAllowedWorkers,
    TaskDefinitionCreate,
    TaskDefinitionRead,
    TaskRegularCrew,
    TaskSpecialty,
    TaskDefinitionUpdate,
    TaskDefinitionUsageRead,
    TaskUsageDependent,
    TaskUsageQCTrigger,
)

router = APIRouter()


def _get_task_definition(task_definition_id: int, db: Session) -> TaskDefinition:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    return task


def _task_usage(task_definition_id: int, db: Session) -> TaskDefinitionUsageRead:
    task_instances = db.scalar(
        select(func.count(TaskInstance.id)).where(
            TaskInstance.task_definition_id == task_definition_id
        )
    )
    qc_checks = db.scalar(
        select(func.count(QCCheckInstance.id))
        .join(
            TaskInstance,
            QCCheckInstance.related_task_instance_id == TaskInstance.id,
        )
        .where(TaskInstance.task_definition_id == task_definition_id)
    )
    return TaskDefinitionUsageRead(
        task_instances=int(task_instances or 0),
        qc_checks=int(qc_checks or 0),
    )


# --- Dependencies -----------------------------------------------------------------


def _coerce_id_list(value: Any) -> list[int]:
    """Read a stored JSON id list, ignoring malformed entries."""
    if not isinstance(value, list):
        return []
    ids: list[int] = []
    for item in value:
        if isinstance(item, bool):
            continue
        if isinstance(item, int):
            candidate = item
        elif isinstance(item, str) and item.strip().isdigit():
            candidate = int(item.strip())
        else:
            continue
        if candidate not in ids:
            ids.append(candidate)
    return ids


def find_dependency_cycle(
    task_id: int,
    dependency_ids: Iterable[int],
    dependencies_by_task: Mapping[int, Iterable[int]],
) -> list[int] | None:
    """Return a cycle [task_id, ..., task_id] created by giving task_id these dependencies.

    ``dependencies_by_task`` holds the stored dependencies of the other tasks; the
    entry for ``task_id`` itself is replaced by ``dependency_ids``.
    """
    graph: dict[int, list[int]] = {
        node: list(deps) for node, deps in dependencies_by_task.items()
    }
    graph[task_id] = list(dependency_ids)
    path = [task_id]
    stack = [iter(graph[task_id])]
    visited: set[int] = set()
    while stack:
        next_id = next(stack[-1], None)
        if next_id is None:
            stack.pop()
            path.pop()
            continue
        if next_id == task_id:
            return [*path, task_id]
        if next_id in visited:
            continue
        visited.add(next_id)
        path.append(next_id)
        stack.append(iter(graph.get(next_id, ())))
    return None


def dependency_validation_error(
    task_id: int | None,
    dependency_ids: Sequence[int],
    tasks: Iterable[Any],
    existing_ids: Iterable[int] = (),
) -> str | None:
    """Spanish error message for an invalid dependency list, or None when valid.

    ``tasks`` are all task definitions (objects with id, name, archived_at and
    dependencies_json). ``existing_ids`` are the dependencies already saved on the task:
    an archived one among them is tolerated (runtime treats it as satisfied), so
    unrelated edits of the dependent task keep working; only newly added archived
    dependencies are rejected.
    """
    kept_ids = set(existing_ids)
    by_id = {task.id: task for task in tasks}
    if task_id is not None and task_id in dependency_ids:
        return "Una tarea no puede depender de si misma."
    missing = [dep_id for dep_id in dependency_ids if dep_id not in by_id]
    if missing:
        return "Dependencias inexistentes: " + ", ".join(f"#{dep_id}" for dep_id in missing) + "."
    archived = [
        by_id[dep_id].name
        for dep_id in dependency_ids
        if by_id[dep_id].archived_at and dep_id not in kept_ids
    ]
    if archived:
        return "No se puede depender de tareas archivadas: " + ", ".join(archived) + "."
    if task_id is None:
        return None
    cycle = find_dependency_cycle(
        task_id,
        dependency_ids,
        {
            task.id: _coerce_id_list(task.dependencies_json)
            for task in by_id.values()
            if task.archived_at is None
        },
    )
    if cycle:
        names = [
            by_id[node].name if node in by_id else f"Tarea {node}" for node in cycle
        ]
        return "Las dependencias crean un ciclo: " + " → ".join(names) + "."
    return None


def _validated_dependencies(
    db: Session,
    task_id: int | None,
    dependencies: list[int] | None,
    existing: Any = None,
) -> list[int] | None:
    if dependencies is None:
        return None
    dependency_ids = list(dict.fromkeys(dependencies))
    if not dependency_ids:
        return []
    tasks = db.execute(
        select(
            TaskDefinition.id,
            TaskDefinition.name,
            TaskDefinition.archived_at,
            TaskDefinition.dependencies_json,
        )
    ).all()
    error = dependency_validation_error(
        task_id, dependency_ids, tasks, _coerce_id_list(existing)
    )
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)
    return dependency_ids


# --- Assembly advance-trigger coverage ----------------------------------------------


@dataclass(frozen=True)
class HouseTypeShape:
    id: int
    name: str
    number_of_modules: int
    sub_types: tuple[tuple[int, str], ...] = ()


# (sequence_order, house_type_id, sub_type_id, module_number, reason)
CoverageGap = tuple[int, int, int | None, int, str]

COVERAGE_MISSING = "missing"
COVERAGE_CONDITIONAL = "conditional"


def advance_coverage_gaps(
    module_tasks: Sequence[TaskDefinition],
    applicability_map: Mapping[int, list[TaskApplicability]],
    rules_by_task: Mapping[int, TaskConditionRules],
    house_types: Sequence[HouseTypeShape],
    assembly_sequences: Iterable[int],
    *,
    exclude_task_id: int | None = None,
) -> tuple[set[CoverageGap], dict[int, set[str]]]:
    """Find house type/module combinations a module could get stuck on.

    A module stops at an assembly station when some module task applies there and
    only leaves when an advance-trigger task completes. For each assembly sequence
    and each house type / sub type / module number, report "missing" when tasks
    apply but no advance-trigger task does, and "conditional" when every
    advance-trigger task that applies is gated by condition rules for that house
    type. Also returns the advance-trigger task names that route to each sequence.
    """
    sequences = set(assembly_sequences)
    gaps: set[CoverageGap] = set()
    advance_names: dict[int, set[str]] = {}
    tasks = [task for task in module_tasks if task.id != exclude_task_id]
    for house_type in house_types:
        # Work orders may have no sub type even when the house type defines some, so the
        # base (sub type None) variant is always checked too.
        sub_type_ids: list[int | None] = [None] + [sub_id for sub_id, _ in house_type.sub_types]
        for module_number in range(1, max(house_type.number_of_modules, 0) + 1):
            for sub_type_id in sub_type_ids:
                routed: dict[int, list[tuple[TaskDefinition, bool]]] = {}
                for task in tasks:
                    applies, sequence = resolve_task_station_sequence(
                        task,
                        applicability_map.get(task.id, []),
                        house_type.id,
                        sub_type_id,
                        module_number,
                        None,
                    )
                    if not applies or sequence not in sequences:
                        continue
                    conditional = any(
                        rule.house_type_id is None or rule.house_type_id == house_type.id
                        for rule in rules_by_task.get(task.id, ())
                    )
                    routed.setdefault(sequence, []).append((task, conditional))
                for sequence, entries in routed.items():
                    advance = [entry for entry in entries if entry[0].advance_trigger]
                    for task, _ in advance:
                        advance_names.setdefault(sequence, set()).add(task.name)
                    if not advance:
                        reason = COVERAGE_MISSING
                    elif all(conditional for _, conditional in advance):
                        reason = COVERAGE_CONDITIONAL
                    else:
                        continue
                    gaps.add((sequence, house_type.id, sub_type_id, module_number, reason))
    return gaps, advance_names


def coverage_stations(
    gaps: Iterable[CoverageGap],
    stations: Sequence[Station],
    house_types: Sequence[HouseTypeShape],
    advance_names: Mapping[int, set[str]] | None = None,
) -> list[AdvanceCoverageStation]:
    house_by_id = {house_type.id: house_type for house_type in house_types}
    grouped: dict[int, dict[tuple[int, str], tuple[set[int], set[int | None]]]] = {}
    for sequence, house_type_id, sub_type_id, module_number, reason in gaps:
        entry = grouped.setdefault(sequence, {}).setdefault(
            (house_type_id, reason), (set(), set())
        )
        entry[0].add(module_number)
        entry[1].add(sub_type_id)
    result: list[AdvanceCoverageStation] = []
    for station in sorted(
        stations, key=lambda row: (row.line_type or "", row.sequence_order or 0, row.id)
    ):
        if station.sequence_order is None or station.sequence_order not in grouped:
            continue
        house_entries: list[AdvanceCoverageHouseType] = []
        for (house_type_id, reason), (modules, sub_ids) in grouped[station.sequence_order].items():
            house_type = house_by_id.get(house_type_id)
            if house_type is None:
                continue
            sub_names = dict(house_type.sub_types)
            all_subs = set(sub_names)
            affected_subs = {sub_id for sub_id in sub_ids if sub_id is not None}
            sub_type_names = (
                sorted(sub_names[sub_id] for sub_id in affected_subs)
                if all_subs and affected_subs != all_subs
                else []
            )
            house_entries.append(
                AdvanceCoverageHouseType(
                    house_type_id=house_type_id,
                    house_type_name=house_type.name,
                    module_numbers=sorted(modules),
                    sub_type_names=sub_type_names,
                    reason=reason,
                )
            )
        house_entries.sort(key=lambda entry: (entry.reason, entry.house_type_name.lower()))
        line_type = station.line_type
        result.append(
            AdvanceCoverageStation(
                station_id=station.id,
                station_name=station.name,
                line_type=getattr(line_type, "value", line_type),
                sequence_order=station.sequence_order,
                advance_task_names=sorted((advance_names or {}).get(station.sequence_order, set())),
                house_types=house_entries,
            )
        )
    return result


@dataclass
class CoverageInputs:
    module_tasks: list[TaskDefinition]
    applicability_map: dict[int, list[TaskApplicability]]
    rules_by_task: dict[int, TaskConditionRules]
    house_types: list[HouseTypeShape]
    assembly_stations: list[Station]


def _load_coverage_inputs(db: Session) -> CoverageInputs:
    module_tasks = list(
        db.execute(
            select(TaskDefinition)
            .where(TaskDefinition.active == True)  # noqa: E712
            .where(TaskDefinition.archived_at.is_(None))
            .where(TaskDefinition.scope == TaskScope.MODULE)
            .order_by(TaskDefinition.id)
        ).scalars()
    )
    task_ids = [task.id for task in module_tasks]
    applicability_map: dict[int, list[TaskApplicability]] = {}
    if task_ids:
        for row in db.execute(
            select(TaskApplicability).where(TaskApplicability.task_definition_id.in_(task_ids))
        ).scalars():
            applicability_map.setdefault(row.task_definition_id, []).append(row)
    condition_ctx = load_condition_context(db, task_ids, [])
    rules_by_task = {
        task_id: rules
        for task_id in task_ids
        if (rules := condition_ctx.requirements_for(task_id))
    }
    sub_types_by_house: dict[int, list[tuple[int, str]]] = {}
    for sub_id, house_type_id, sub_name in db.execute(
        select(HouseSubType.id, HouseSubType.house_type_id, HouseSubType.name).order_by(
            HouseSubType.id
        )
    ).all():
        sub_types_by_house.setdefault(house_type_id, []).append((sub_id, sub_name))
    house_types = [
        HouseTypeShape(
            id=house_id,
            name=name,
            number_of_modules=int(number_of_modules or 0),
            sub_types=tuple(sub_types_by_house.get(house_id, [])),
        )
        for house_id, name, number_of_modules in db.execute(
            select(HouseType.id, HouseType.name, HouseType.number_of_modules).order_by(
                HouseType.name
            )
        ).all()
    ]
    assembly_stations = list(
        db.execute(
            select(Station)
            .where(Station.role == StationRole.ASSEMBLY)
            .where(Station.sequence_order.is_not(None))
        ).scalars()
    )
    return CoverageInputs(
        module_tasks=module_tasks,
        applicability_map=applicability_map,
        rules_by_task=rules_by_task,
        house_types=house_types,
        assembly_stations=assembly_stations,
    )


def _compute_coverage(
    inputs: CoverageInputs, exclude_task_id: int | None = None
) -> tuple[set[CoverageGap], dict[int, set[str]]]:
    return advance_coverage_gaps(
        inputs.module_tasks,
        inputs.applicability_map,
        inputs.rules_by_task,
        inputs.house_types,
        {station.sequence_order for station in inputs.assembly_stations},
        exclude_task_id=exclude_task_id,
    )


# --- Dependents shown before archiving / inactivating ------------------------------


def qc_triggers_for_task(task_definition_id: int, rows: Iterable[Any]) -> list[TaskUsageQCTrigger]:
    """Pick triggers whose params_json.task_definition_ids include the task."""
    result: list[TaskUsageQCTrigger] = []
    for trigger_id, check_definition_id, check_name, params_json in rows:
        params = params_json if isinstance(params_json, dict) else {}
        if task_definition_id in _coerce_id_list(params.get("task_definition_ids")):
            result.append(
                TaskUsageQCTrigger(
                    trigger_id=trigger_id,
                    check_definition_id=check_definition_id,
                    check_name=check_name,
                )
            )
    return result


def dependent_tasks_for(task_definition_id: int, tasks: Iterable[Any]) -> list[TaskUsageDependent]:
    return sorted(
        (
            TaskUsageDependent(task_definition_id=task.id, name=task.name, active=bool(task.active))
            for task in tasks
            if task.id != task_definition_id
            and task.archived_at is None
            and task_definition_id in _coerce_id_list(task.dependencies_json)
        ),
        key=lambda dependent: dependent.name.lower(),
    )


def _task_dependents(task: TaskDefinition, db: Session) -> dict[str, Any]:
    trigger_rows = db.execute(
        select(
            QCTrigger.id,
            QCTrigger.check_definition_id,
            QCCheckDefinition.name,
            QCTrigger.params_json,
        )
        .join(QCCheckDefinition, QCCheckDefinition.id == QCTrigger.check_definition_id)
        .where(QCTrigger.event_type == QCTriggerEventType.TASK_COMPLETED)
        .where(QCCheckDefinition.active == True)  # noqa: E712
        .order_by(QCCheckDefinition.name, QCTrigger.id)
    ).all()
    task_rows = db.execute(
        select(
            TaskDefinition.id,
            TaskDefinition.name,
            TaskDefinition.active,
            TaskDefinition.archived_at,
            TaskDefinition.dependencies_json,
        )
    ).all()
    advance_stations: list[AdvanceCoverageStation] = []
    if (
        task.scope == TaskScope.MODULE
        and task.advance_trigger
        and task.active
        and task.archived_at is None
    ):
        inputs = _load_coverage_inputs(db)
        baseline, _ = _compute_coverage(inputs)
        without_task, _ = _compute_coverage(inputs, exclude_task_id=task.id)
        advance_stations = coverage_stations(
            without_task - baseline, inputs.assembly_stations, inputs.house_types
        )
    return {
        "qc_triggers": qc_triggers_for_task(task.id, trigger_rows),
        "dependent_tasks": dependent_tasks_for(task.id, task_rows),
        "advance_trigger_stations": advance_stations,
    }


def _archive_task_definition(
    task: TaskDefinition, admin: AdminUser, db: Session
) -> TaskDefinition:
    if task.archived_at is None:
        task.archived_at = datetime.now(UTC).replace(tzinfo=None)
        task.archived_by_user_id = admin.id
        db.commit()
        db.refresh(task)
    return task


@router.get("", response_model=list[TaskDefinitionRead])
def list_task_definitions(
    include_archived: bool = False, db: Session = Depends(get_db)
) -> list[TaskDefinitionRead]:
    stmt = select(TaskDefinition).order_by(TaskDefinition.name)
    if not include_archived:
        stmt = stmt.where(TaskDefinition.archived_at.is_(None))
    tasks = list(db.execute(stmt).scalars())
    if not tasks:
        return []

    task_ids = [task.id for task in tasks]
    skill_rows = db.execute(
        select(
            TaskSkillRequirement.task_definition_id,
            TaskSkillRequirement.skill_id,
        )
        .where(TaskSkillRequirement.task_definition_id.in_(task_ids))
        .order_by(
            TaskSkillRequirement.task_definition_id,
            TaskSkillRequirement.skill_id,
        )
    ).all()
    skill_id_by_task_id: dict[int, int] = {}
    for task_definition_id, skill_id in skill_rows:
        skill_id_by_task_id.setdefault(task_definition_id, skill_id)

    return [
        TaskDefinitionRead.model_validate(task, from_attributes=True).model_copy(
            update={"skill_id": skill_id_by_task_id.get(task.id)}
        )
        for task in tasks
    ]


@router.post("", response_model=TaskDefinitionRead, status_code=status.HTTP_201_CREATED)
def create_task_definition(
    payload: TaskDefinitionCreate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
) -> TaskDefinition:
    data = payload.model_dump()
    data["dependencies_json"] = _validated_dependencies(db, None, data.get("dependencies_json"))
    task = TaskDefinition(**data)
    db.add(task)
    db.flush()
    db.add(
        TaskApplicability(
            task_definition_id=task.id,
            house_type_id=None,
            sub_type_id=None,
            module_number=None,
            panel_definition_id=None,
            applies=False,
            station_sequence_order=task.default_station_sequence,
        )
    )
    db.commit()
    db.refresh(task)
    return task


@router.get("/advance-trigger-coverage", response_model=list[AdvanceCoverageStation])
def get_advance_trigger_coverage(db: Session = Depends(get_db)) -> list[AdvanceCoverageStation]:
    """Assembly stations where some house type/module may never get an advance trigger."""
    inputs = _load_coverage_inputs(db)
    gaps, advance_names = _compute_coverage(inputs)
    return coverage_stations(gaps, inputs.assembly_stations, inputs.house_types, advance_names)


@router.get("/{task_definition_id}", response_model=TaskDefinitionRead)
def get_task_definition(
    task_definition_id: int, db: Session = Depends(get_db)
) -> TaskDefinition:
    return _get_task_definition(task_definition_id, db)


@router.get("/{task_definition_id}/usage", response_model=TaskDefinitionUsageRead)
def get_task_definition_usage(
    task_definition_id: int, db: Session = Depends(get_db)
) -> TaskDefinitionUsageRead:
    task = _get_task_definition(task_definition_id, db)
    usage = _task_usage(task_definition_id, db)
    return usage.model_copy(update=_task_dependents(task, db))


@router.put("/{task_definition_id}", response_model=TaskDefinitionRead)
def update_task_definition(
    task_definition_id: int,
    payload: TaskDefinitionUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
) -> TaskDefinition:
    task = _get_task_definition(task_definition_id, db)
    updates = payload.model_dump(exclude_unset=True)
    if "dependencies_json" in updates:
        updates["dependencies_json"] = _validated_dependencies(
            db, task.id, updates["dependencies_json"], task.dependencies_json
        )
    for key, value in updates.items():
        setattr(task, key, value)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_definition_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_definition(
    task_definition_id: int,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
) -> None:
    task = _get_task_definition(task_definition_id, db)
    _archive_task_definition(task, admin, db)


@router.post("/{task_definition_id}/archive", response_model=TaskDefinitionRead)
def archive_task_definition(
    task_definition_id: int,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
) -> TaskDefinition:
    task = _get_task_definition(task_definition_id, db)
    return _archive_task_definition(task, admin, db)


@router.post("/{task_definition_id}/restore", response_model=TaskDefinitionRead)
def restore_task_definition(
    task_definition_id: int,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
) -> TaskDefinition:
    task = _get_task_definition(task_definition_id, db)
    if task.archived_at is not None:
        task.archived_at = None
        task.archived_by_user_id = None
        db.commit()
        db.refresh(task)
    return task


@router.get("/{task_definition_id}/specialty", response_model=TaskSpecialty)
def get_task_specialty(
    task_definition_id: int, db: Session = Depends(get_db)
) -> TaskSpecialty:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    skill_id = (
        db.execute(
            select(TaskSkillRequirement.skill_id)
            .where(TaskSkillRequirement.task_definition_id == task_definition_id)
            .order_by(TaskSkillRequirement.skill_id)
        )
        .scalars()
        .first()
    )
    return TaskSpecialty(skill_id=skill_id)


@router.put("/{task_definition_id}/specialty", response_model=TaskSpecialty)
def set_task_specialty(
    task_definition_id: int,
    payload: TaskSpecialty,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
) -> TaskSpecialty:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    if payload.skill_id is not None and not db.get(Skill, payload.skill_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Skill not found"
        )
    db.query(TaskSkillRequirement).filter(
        TaskSkillRequirement.task_definition_id == task_definition_id
    ).delete()
    if payload.skill_id is not None:
        db.add(
            TaskSkillRequirement(
                task_definition_id=task_definition_id, skill_id=payload.skill_id
            )
        )
    db.commit()
    return TaskSpecialty(skill_id=payload.skill_id)


def _list_task_worker_ids(
    task_definition_id: int, db: Session, restriction_type: RestrictionType
) -> list[int]:
    return list(
        db.execute(
            select(TaskWorkerRestriction.worker_id)
            .where(
                TaskWorkerRestriction.task_definition_id == task_definition_id,
                TaskWorkerRestriction.restriction_type == restriction_type,
            )
            .order_by(TaskWorkerRestriction.worker_id)
        ).scalars()
    )


def _set_task_worker_ids(
    task_definition_id: int,
    worker_ids: list[int],
    db: Session,
    restriction_type: RestrictionType,
) -> list[int]:
    unique_ids = sorted(set(worker_ids))
    if unique_ids:
        workers = list(
            db.execute(select(Worker.id).where(Worker.id.in_(unique_ids))).scalars()
        )
        if len(workers) != len(unique_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more workers not found",
            )
    db.query(TaskWorkerRestriction).filter(
        TaskWorkerRestriction.task_definition_id == task_definition_id,
        TaskWorkerRestriction.restriction_type == restriction_type,
    ).delete()
    for worker_id in unique_ids:
        db.add(
            TaskWorkerRestriction(
                task_definition_id=task_definition_id,
                worker_id=worker_id,
                restriction_type=restriction_type,
            )
        )
    db.commit()
    return unique_ids


@router.get("/{task_definition_id}/allowed-workers", response_model=TaskAllowedWorkers)
def list_allowed_workers(
    task_definition_id: int, db: Session = Depends(get_db)
) -> TaskAllowedWorkers:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    worker_ids = _list_task_worker_ids(task_definition_id, db, RestrictionType.ALLOWED)
    return TaskAllowedWorkers(worker_ids=worker_ids if worker_ids else None)


@router.put("/{task_definition_id}/allowed-workers", response_model=TaskAllowedWorkers)
def set_allowed_workers(
    task_definition_id: int,
    payload: TaskAllowedWorkers,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
) -> TaskAllowedWorkers:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    worker_ids = payload.worker_ids or []
    if not worker_ids:
        db.query(TaskWorkerRestriction).filter(
            TaskWorkerRestriction.task_definition_id == task_definition_id,
            TaskWorkerRestriction.restriction_type == RestrictionType.ALLOWED,
        ).delete()
        db.commit()
        return TaskAllowedWorkers(worker_ids=None)
    updated = _set_task_worker_ids(
        task_definition_id, worker_ids, db, RestrictionType.ALLOWED
    )
    return TaskAllowedWorkers(worker_ids=updated)


@router.get("/{task_definition_id}/regular-crew", response_model=TaskRegularCrew)
def list_regular_crew(
    task_definition_id: int, db: Session = Depends(get_db)
) -> TaskRegularCrew:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    worker_ids = _list_task_worker_ids(
        task_definition_id, db, RestrictionType.REGULAR_CREW
    )
    return TaskRegularCrew(worker_ids=worker_ids)


@router.put("/{task_definition_id}/regular-crew", response_model=TaskRegularCrew)
def set_regular_crew(
    task_definition_id: int,
    payload: TaskRegularCrew,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("task-defs", edit=True)),
) -> TaskRegularCrew:
    task = db.get(TaskDefinition, task_definition_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task definition not found"
        )
    worker_ids = payload.worker_ids or []
    updated = _set_task_worker_ids(
        task_definition_id, worker_ids, db, RestrictionType.REGULAR_CREW
    )
    return TaskRegularCrew(worker_ids=updated)
