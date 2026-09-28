"""Read-only cost drivers. Money and scenario assumptions stay in the browser."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from statistics import median
import unicodedata

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import StationRole, TaskScope, TaskStatus
from app.models.house import HouseSubType, HouseType, PanelDefinition
from app.models.stations import Station
from app.models.tasks import (
    TaskApplicability, TaskDefinition, TaskExpectedDuration, TaskInstance,
    TaskParticipation, TaskPause,
)
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.models.workers import Worker
from app.services.shift_masks import ShiftMaskResolver
from app.services.task_applicability import resolve_task_applicability


def weekdays(start: date, end: date) -> int:
    return sum((start + timedelta(days=i)).weekday() < 5
               for i in range((end - start).days + 1))


def union_intervals(intervals):
    merged = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def subtract_intervals(intervals, pauses):
    for pause_start, pause_end in union_intervals(pauses):
        remaining = []
        for start, end in intervals:
            if pause_end <= start or pause_start >= end:
                remaining.append((start, end))
            else:
                if start < pause_start:
                    remaining.append((start, pause_start))
                if pause_end < end:
                    remaining.append((pause_end, end))
        intervals = remaining
    return intervals


def share_worker_seconds(segments):
    """Divide concurrent work equally; duplicate joins never multiply payroll time."""
    events = defaultdict(list)
    for task_id, start, end in segments:
        if end > start:
            events[start].append((task_id, 1))
            events[end].append((task_id, -1))
    active = defaultdict(int)
    result = defaultdict(float)
    previous = None
    for timestamp, changes in sorted(events.items()):
        if previous is not None and active:
            seconds = (timestamp - previous).total_seconds() / len(active)
            for task_id in active:
                result[task_id] += seconds
        for task_id, change in changes:
            active[task_id] += change
            if active[task_id] == 0:
                del active[task_id]
        previous = timestamp
    return result


def house_exit(modules, expected_modules, exits):
    """A house leaves assembly only after every expected module has a yard exit."""
    if len(modules) != expected_modules:
        return None
    if {m.module_number for m in modules} != set(range(1, expected_modules + 1)):
        return None
    dates = [exits.get(m.id) for m in modules]
    return max(dates) if all(dates) else None


def model_key(house_type_id, sub_type_id):
    return f"{house_type_id}:{sub_type_id or 0}"


def is_floor(group):
    plain = ''.join(c for c in unicodedata.normalize('NFKD', group or '')
                    if not unicodedata.combining(c)).casefold()
    return 'piso' in plain.split()


def matching_duration(rows, house_type_id, sub_type_id, module, panel):
    matching = [r for r in rows if all(
        value is None or value == actual for value, actual in (
            (r.house_type_id, house_type_id), (r.sub_type_id, sub_type_id),
            (r.module_number, module), (r.panel_definition_id, panel))) ]
    def rank(r):
        level = 0 if r.panel_definition_id else 1 if r.house_type_id and r.module_number else 2 if r.house_type_id else 4
        return level, 0 if r.sub_type_id else 1, r.id
    return min(matching, key=rank) if matching else None


def build_cost_data(db: Session, start: date | None, end: date | None) -> dict:
    first, last = db.execute(select(func.min(TaskInstance.completed_at),
                                   func.max(TaskInstance.completed_at))).one()
    last_date = min(last.date(), date.today()) if last else date.today()
    end = end or last_date
    start = start or end - timedelta(days=89)
    if start > end or (end - start).days > 730 or end > date.today():
        raise ValueError('Seleccione un período de hasta 731 días, sin fechas futuras.')
    begin, finish = datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min)
    finish = min(finish, datetime.now())
    orders = list(db.scalars(select(WorkOrder)))
    units = list(db.scalars(select(WorkUnit)))
    order_map = {o.id: o for o in orders}
    unit_map = {u.id: u for u in units}
    by_order = defaultdict(list)
    for unit in units:
        by_order[unit.work_order_id].append(unit)
    types = {h.id: h for h in db.scalars(select(HouseType))}
    subtypes = {h.id: h.name for h in db.scalars(select(HouseSubType))}
    stations = {s.id: s for s in db.scalars(select(Station))}
    tasks = {t.id: t for t in db.scalars(select(TaskDefinition))}
    panels = list(db.scalars(select(PanelDefinition)))
    panel_map = {p.id: p for p in panels}
    panel_units = {p.id: p for p in db.scalars(select(PanelUnit))}
    final_sequence = max((s.sequence_order or 0 for s in stations.values()
                          if s.role == StationRole.ASSEMBLY), default=0)
    exit_rows = db.execute(
        select(TaskInstance.work_unit_id, func.min(TaskInstance.completed_at))
        .join(TaskDefinition, TaskDefinition.id == TaskInstance.task_definition_id)
        .join(Station, Station.id == TaskInstance.station_id)
        .where(TaskInstance.scope == TaskScope.MODULE,
               TaskInstance.status == TaskStatus.COMPLETED,
               TaskDefinition.advance_trigger.is_(True),
               Station.role == StationRole.ASSEMBLY,
               Station.sequence_order == final_sequence)
        .group_by(TaskInstance.work_unit_id)).all()
    exits = dict(exit_rows)
    # No inferred exit from a generic "completed" status or a skipped task.
    completed = {o.id: house_exit(by_order[o.id], types[o.house_type_id].number_of_modules, exits)
                 for o in orders}

    instances = list(db.scalars(select(TaskInstance).where(
        TaskInstance.started_at < finish,
        (TaskInstance.completed_at >= begin) | TaskInstance.completed_at.is_(None),
        TaskInstance.status.in_([TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))))
    instance_map = {t.id: t for t in instances}
    masks = {}
    for role in StationRole:
        targets = [s for s in stations.values() if s.role == role]
        masks[role] = ShiftMaskResolver.load(
            db, station_role=role, station_ids={s.id for s in targets},
            sequence_orders={s.sequence_order for s in targets if s.sequence_order is not None},
            start_date=start, end_date=end, algorithm_version=1)
    pauses = defaultdict(list)
    participations = []
    ids = list(instance_map)
    # Bounded batches avoid driver parameter limits for a long reference period.
    for offset in range(0, len(ids), 5000):
        batch = ids[offset:offset + 5000]
        for p in db.scalars(select(TaskPause).where(TaskPause.task_instance_id.in_(batch))):
            pauses[p.task_instance_id].append((p.paused_at, p.resumed_at or finish))
        participations.extend(db.scalars(select(TaskParticipation).where(TaskParticipation.task_instance_id.in_(batch))))
    worker_segments = defaultdict(list)
    task_segments = defaultdict(list)
    fallback_days = set()
    for p in participations:
        task = instance_map[p.task_instance_id]
        station = stations[task.station_id]
        a = max(begin, task.started_at, p.joined_at)
        b = min(finish, task.completed_at or finish, p.left_at or task.completed_at or finish)
        if b <= a:
            continue
        resolver = masks[station.role]
        segments = resolver.masked_segments(station.id, a, b,
                    sequence_order=station.sequence_order, station_role=station.role) or []
        segments = subtract_intervals(segments, pauses[task.id])
        day_map = resolver.masks_by_station_day.get(station.id)
        if day_map is None:
            day_map = resolver.masks_by_sequence_day.get((station.role, station.sequence_order), {})
        for s, e in segments:
            if s.date() not in day_map:
                fallback_days.add((station.id, s.date()))
            worker_segments[p.worker_id].append((task.id, s, e))
            task_segments[task.id].append((s, e))
    task_seconds = defaultdict(float)
    for segments in worker_segments.values():
        for task_id, seconds in share_worker_seconds(segments).items():
            task_seconds[task_id] += seconds
    project_hours = defaultdict(float)
    samples = defaultdict(list)
    house_hours = defaultdict(float)
    for task in instances:
        unit = unit_map[task.work_unit_id]
        order = order_map[unit.work_order_id]
        seconds = task_seconds[task.id]
        project_hours[order.project_name] += seconds / 3600
        definition = tasks[task.task_definition_id]
        if (not seconds or task.status != TaskStatus.COMPLETED or task.started_at < begin
                or task.completed_at >= finish or definition.advance_trigger or definition.is_rework
                or task.rework_task_id or (task.completed_at - task.started_at).days > 31):
            continue
        minutes = sum((b-a).total_seconds()/60 for a,b in union_intervals(task_segments[task.id]))
        if minutes < 1:  # Instant confirmations are not estimates of task effort.
            continue
        house_hours[order.id] += seconds / 3600
        panel_id = panel_units[task.panel_unit_id].panel_definition_id if task.panel_unit_id in panel_units else None
        key = (model_key(order.house_type_id, order.sub_type_id), unit.module_number, panel_id, definition.id)
        samples[key].append((minutes, seconds / 3600))

    # Compare complete houses against the best-recorded house of the SAME variant,
    # across all history. A recent collapse in logging must not lower the benchmark.
    recorded_slots = defaultdict(set)
    reference_slots = defaultdict(set)
    stages = defaultdict(set)
    assembly_stages = defaultdict(set)
    first_work = {}
    slot_rows = db.execute(select(
        WorkUnit.work_order_id, WorkUnit.module_number, TaskInstance.id,
        TaskInstance.task_definition_id, TaskInstance.panel_unit_id,
        TaskInstance.started_at, TaskInstance.completed_at, TaskInstance.scope)
        .join(WorkUnit, WorkUnit.id == TaskInstance.work_unit_id)
        .join(TaskDefinition, TaskDefinition.id == TaskInstance.task_definition_id)
        .where(TaskInstance.status == TaskStatus.COMPLETED,
               TaskDefinition.advance_trigger.is_(False), TaskDefinition.is_rework.is_(False),
               TaskInstance.rework_task_id.is_(None), TaskInstance.started_at.is_not(None)))
    for oid, module, tid, definition, pid, started, ended, scope in slot_rows:
        first_work[oid] = min(first_work.get(oid, started), started)
        if ended is None or (ended - started).total_seconds() < 60 or (ended - started).days > 31:
            continue
        slot = (module, panel_units[pid].panel_definition_id if pid in panel_units else None, definition)
        recorded_slots[oid].add(slot)
        if begin <= started and ended < finish and task_seconds[tid] > 0:
            reference_slots[oid].add(slot)
            stages[oid].add(scope)
            task_station = stations[instance_map[tid].station_id]
            if scope == TaskScope.MODULE and task_station.role == StationRole.ASSEMBLY:
                assembly_stages[(oid, module)].add(task_station.sequence_order)
    best_coverage = defaultdict(int)
    for order in orders:
        if completed[order.id]:
            key = model_key(order.house_type_id, order.sub_type_id)
            best_coverage[key] = max(best_coverage[key], len(recorded_slots[order.id]))
    cohorts = defaultdict(list)
    for order in orders:
        oid = order.id
        key = model_key(order.house_type_id, order.sub_type_id)
        if (completed[oid] and begin <= completed[oid] < finish
                and first_work.get(oid, finish) >= begin
                and best_coverage[key] >= 20
                and len(reference_slots[oid]) >= best_coverage[key] * .8
                and {TaskScope.PANEL, TaskScope.MODULE}.issubset(stages[oid])
                and all(len(assembly_stages[(oid, m.module_number)]) >= 3 for m in by_order[oid])
                and house_hours[oid] > 0):
            cohorts[key].append(house_hours[oid])

    applicability = defaultdict(list)
    durations = defaultdict(list)
    for row in db.scalars(select(TaskApplicability).order_by(TaskApplicability.id)):
        applicability[row.task_definition_id].append(row)
    for row in db.scalars(select(TaskExpectedDuration)):
        durations[row.task_definition_id].append(row)
    variants = {(o.house_type_id, o.sub_type_id) for o in orders}
    models = []
    for type_id, subtype_id in sorted(variants, key=lambda v: (v[0], v[1] or 0)):
        house = types[type_id]
        key = model_key(type_id, subtype_id)
        catalog = [p for p in panels if p.house_type_id == type_id and p.archived_at is None
                   and p.sub_type_id in (None, subtype_id)]
        floors = [p for p in catalog if is_floor(p.group)]
        area = sum(float(p.panel_area) for p in floors if p.panel_area is not None)
        if (not floors or any(not p.panel_area or p.panel_area <= 0 for p in floors)
                or {p.module_sequence_number for p in floors} != set(range(1, house.number_of_modules + 1))):
            area = None
        recipe = []
        for module in range(1, house.number_of_modules + 1):
            contexts = [None] + [p for p in catalog if p.module_sequence_number == module]
            for panel in contexts:
                scope = TaskScope.PANEL if panel else TaskScope.MODULE
                for task in tasks.values():
                    if task.scope != scope or not task.active or task.archived_at or task.advance_trigger or task.is_rework:
                        continue
                    if panel and panel.applicable_task_ids is not None and task.id not in panel.applicable_task_ids:
                        continue
                    rule = resolve_task_applicability(applicability[task.id], type_id, subtype_id, module, panel.id if panel else None)
                    if rule and not rule.applies:
                        continue
                    observations = samples[(key, module, panel.id if panel else None, task.id)]
                    expected = matching_duration(durations[task.id], type_id, subtype_id, module, panel.id if panel else None)
                    minutes = hours = crew = None
                    source = 'missing'
                    if observations:
                        minutes = median(s[0] for s in observations)
                        hours = median(s[1] for s in observations)
                        crew = hours * 60 / minutes
                        source = 'observed'
                    elif expected and expected.expected_minutes and expected.expected_headcount:
                        minutes = float(expected.expected_minutes)
                        crew = expected.expected_headcount
                        if minutes > 0 and crew > 0:
                            hours = minutes * crew / 60
                            source = 'configured'
                    recipe.append(dict(task_id=task.id, name=task.name, module=module,
                        panel=panel.panel_code if panel else None, minutes=minutes,
                        crew=crew, hours=hours, samples=len(observations), source=source))
        missing = sum(r['hours'] is None for r in recipe)
        recipe_hours = sum(r['hours'] or 0 for r in recipe) if recipe and not missing else None
        cohort_hours = median(cohorts[key]) if len(cohorts[key]) >= 3 else None
        models.append(dict(key=key, name=house.name + (f' · {subtypes.get(subtype_id, "")}' if subtype_id else ''),
            modules=house.number_of_modules, floor_area=area, tasks=recipe,
            hours=cohort_hours if cohort_hours is not None else recipe_hours,
            hours_source='houses' if cohort_hours is not None else 'recipe',
            reference_houses=len(cohorts[key]),
            known_hours=sum(r['hours'] or 0 for r in recipe), missing_tasks=missing))

    projects = []
    for name in sorted({o.project_name for o in orders}):
        members = [o for o in orders if o.project_name == name]
        mix = defaultdict(lambda: dict(houses=0, completed=0, completed_floor_area=0.0, missing_area=0))
        for order in members:
            entry = mix[model_key(order.house_type_id, order.sub_type_id)]
            entry['houses'] += 1
            exited = completed[order.id]
            if exited and begin <= exited < finish:
                entry['completed'] += 1
                # Actual installed floor panels, rather than today's catalog, for history.
                unit_ids = {u.id for u in by_order[order.id]}
                actual = [p for p in panel_units.values() if p.work_unit_id in unit_ids and is_floor(panel_map[p.panel_definition_id].group)]
                covered = {p.work_unit_id for p in actual}
                if covered != unit_ids or any(not panel_map[p.panel_definition_id].panel_area for p in actual):
                    entry['missing_area'] += 1
                else:
                    entry['completed_floor_area'] += sum(float(panel_map[p.panel_definition_id].panel_area) for p in actual)
        projects.append(dict(name=name, models=[dict(key=k, **v) for k,v in mix.items()],
                             recorded_hours=project_hours[name]))
    return dict(start=start, end=end, first_date=first.date() if first else None,
        last_date=last_date, weekdays=weekdays(start,end),
        roster=db.scalar(select(func.count()).select_from(Worker).where(Worker.active.is_(True))) or 0,
        total_recorded_hours=sum(project_hours.values()),
        completed_tasks=sum(t.status == TaskStatus.COMPLETED for t in instances),
        tasks_with_hours=sum(task_seconds[t.id] > 0 for t in instances if t.status == TaskStatus.COMPLETED),
        fallback_shift_days=len(fallback_days), projects=projects, models=models)
