"""Panel routing: which station an in-progress panel belongs at.

A panel moves on only when something re-evaluates it. Completing or skipping a task does
that for the station the task ran at. Configuration edits (task rules, panel definitions,
stations, conditions) can also leave a panel with no work at its current station; the
guard installed by ``install_stalled_panel_guard`` re-evaluates panels in the same commit
as such an edit, so they are never stranded at a station they no longer need.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import event, or_, select
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker

from app.models.conditions import (
    ConditionType,
    ConditionValue,
    TaskConditionRule,
    TaskConditionRuleValue,
    WorkUnitCondition,
)
from app.models.enums import (
    PanelUnitStatus,
    StationRole,
    TaskExceptionType,
    TaskScope,
    TaskStatus,
    WorkUnitStatus,
)
from app.models.house import PanelDefinition
from app.models.panel_routing import PanelAutoRelease
from app.models.stations import Station
from app.models.tasks import TaskApplicability, TaskDefinition, TaskException, TaskInstance
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.core.security import utc_now
from app.services.conditions import ConditionContext, load_condition_context
from app.services.task_applicability import resolve_task_station_sequence

logger = logging.getLogger(__name__)

OPEN_TASK_STATUSES = (TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS, TaskStatus.PAUSED)

# Models whose changes can alter which stations a panel needs.
ROUTING_MODELS: tuple[type, ...] = (
    TaskDefinition,
    TaskApplicability,
    PanelDefinition,
    Station,
    ConditionType,
    ConditionValue,
    TaskConditionRule,
    TaskConditionRuleValue,
    WorkUnitCondition,
)
_ROUTING_CHANGED = "panel_routing_changed"
_ROUTING_CHANGED_MODELS = "panel_routing_changed_models"

TRIGGER_ROUTING_CHANGE = "routing_change"
TRIGGER_SCRIPT = "script"

# Spanish labels shown to admins for the configuration that triggered a release.
_ROUTING_MODEL_LABELS = {
    "TaskDefinition": "tareas",
    "TaskApplicability": "aplicabilidad de tareas",
    "PanelDefinition": "paneles",
    "Station": "estaciones",
    "ConditionType": "condiciones",
    "ConditionValue": "condiciones",
    "TaskConditionRule": "reglas de condición",
    "TaskConditionRuleValue": "reglas de condición",
    "WorkUnitCondition": "condiciones del módulo",
}


@dataclass(frozen=True)
class PanelRoutingRules:
    """Panel task configuration loaded once and evaluated for any number of panels."""

    task_definitions: list[TaskDefinition]
    applicability_map: dict[int, list[TaskApplicability]]
    condition_ctx: ConditionContext
    panel_stations: list[Station]

    @classmethod
    def load(cls, db: Session, work_unit_ids: list[int] | None) -> PanelRoutingRules:
        task_definitions = list(
            db.execute(
                select(TaskDefinition)
                .where(TaskDefinition.active == True)
                .where(TaskDefinition.archived_at.is_(None))
                .where(TaskDefinition.scope == TaskScope.PANEL)
            ).scalars()
        )
        task_ids = [task.id for task in task_definitions]
        applicability_map: dict[int, list[TaskApplicability]] = {}
        if task_ids:
            for row in db.execute(
                select(TaskApplicability).where(TaskApplicability.task_definition_id.in_(task_ids))
            ).scalars():
                applicability_map.setdefault(row.task_definition_id, []).append(row)
        panel_stations = list(
            db.execute(
                select(Station)
                .where(Station.role == StationRole.PANELS)
                .where(Station.sequence_order.is_not(None))
                .order_by(Station.sequence_order)
            ).scalars()
        )
        return cls(
            task_definitions=task_definitions,
            applicability_map=applicability_map,
            condition_ctx=load_condition_context(db, task_ids, work_unit_ids),
            panel_stations=panel_stations,
        )

    def required_task_ids(
        self,
        station: Station,
        work_unit: WorkUnit,
        work_order: WorkOrder,
        panel_definition: PanelDefinition,
    ) -> set[int]:
        if station.sequence_order is None:
            return set()
        unit_condition_value_ids = self.condition_ctx.values_for(work_unit.id)
        required_ids: set[int] = set()
        for task in self.task_definitions:
            applies, station_sequence_order = resolve_task_station_sequence(
                task,
                self.applicability_map.get(task.id, []),
                work_order.house_type_id,
                work_order.sub_type_id,
                work_unit.module_number,
                panel_definition.id,
                condition_requirements=self.condition_ctx.requirements_for(task.id),
                unit_condition_value_ids=unit_condition_value_ids,
            )
            if applies and station_sequence_order == station.sequence_order:
                required_ids.add(task.id)
        return required_ids

    def next_station(
        self,
        station: Station,
        work_unit: WorkUnit,
        work_order: WorkOrder,
        panel_definition: PanelDefinition,
    ) -> Station | None:
        if station.sequence_order is None:
            return None
        for candidate in self.panel_stations:
            if candidate.sequence_order <= station.sequence_order:
                continue
            if self.required_task_ids(candidate, work_unit, work_order, panel_definition):
                return candidate
        return None


def _applicable_panel_definitions_for_work_unit(
    db: Session, work_unit: WorkUnit, work_order: WorkOrder
) -> list[PanelDefinition]:
    existing_definition_ids = set(
        db.execute(
            select(PanelUnit.panel_definition_id).where(
                PanelUnit.work_unit_id == work_unit.id
            )
        ).scalars()
    )
    archive_filter = PanelDefinition.archived_at.is_(None)
    if existing_definition_ids:
        archive_filter = archive_filter | PanelDefinition.id.in_(existing_definition_ids)
    panel_definitions = list(
        db.execute(
            select(PanelDefinition)
            .where(PanelDefinition.house_type_id == work_order.house_type_id)
            .where(PanelDefinition.module_sequence_number == work_unit.module_number)
            .where(archive_filter)
        ).scalars()
    )
    general = [panel_def for panel_def in panel_definitions if panel_def.sub_type_id is None]
    if work_order.sub_type_id is not None:
        specific = [
            panel_def
            for panel_def in panel_definitions
            if panel_def.sub_type_id == work_order.sub_type_id
        ]
        return general + specific
    return general


def _all_applicable_panels_terminal(
    db: Session, work_unit: WorkUnit, work_order: WorkOrder
) -> bool:
    panel_definitions = _applicable_panel_definitions_for_work_unit(db, work_unit, work_order)
    if not panel_definitions:
        return False

    panel_units = list(
        db.execute(select(PanelUnit).where(PanelUnit.work_unit_id == work_unit.id)).scalars()
    )
    panel_units_by_definition: dict[int, list[PanelUnit]] = {}
    for panel_unit in panel_units:
        panel_units_by_definition.setdefault(panel_unit.panel_definition_id, []).append(panel_unit)

    terminal_statuses = {PanelUnitStatus.COMPLETED, PanelUnitStatus.CONSUMED}
    for panel_definition in panel_definitions:
        units = panel_units_by_definition.get(panel_definition.id, [])
        if not units:
            return False
        if any(panel_unit.status not in terminal_statuses for panel_unit in units):
            return False
    return True


def advance_panel_if_satisfied(
    db: Session,
    panel_unit: PanelUnit,
    station: Station,
    rules: PanelRoutingRules | None = None,
) -> bool:
    """Move the panel past ``station`` once its required tasks there are done.

    Returns True when the panel left the station (advanced or completed).

    Only a panel that is in progress at ``station`` can leave it. A late completion or
    skip at a station the panel already left must not move it backwards or reopen it.
    """
    if station.role != StationRole.PANELS:
        return False
    if (
        panel_unit.status != PanelUnitStatus.IN_PROGRESS
        or panel_unit.current_station_id != station.id
    ):
        return False
    work_unit = db.get(WorkUnit, panel_unit.work_unit_id)
    if not work_unit:
        return False
    work_order = db.get(WorkOrder, work_unit.work_order_id)
    if not work_order:
        return False
    panel_def = db.get(PanelDefinition, panel_unit.panel_definition_id)
    if not panel_def:
        return False
    if rules is None:
        rules = PanelRoutingRules.load(db, [work_unit.id])

    required_ids = rules.required_task_ids(station, work_unit, work_order, panel_def)
    if required_ids:
        completed_ids = set(
            db.execute(
                select(TaskInstance.task_definition_id)
                .where(TaskInstance.work_unit_id == work_unit.id)
                .where(TaskInstance.panel_unit_id == panel_unit.id)
                .where(TaskInstance.station_id == station.id)
                .where(TaskInstance.status.in_([TaskStatus.COMPLETED, TaskStatus.SKIPPED]))
                .where(TaskInstance.task_definition_id.in_(required_ids))
            ).scalars()
        )
        skipped_ids = set(
            db.execute(
                select(TaskException.task_definition_id)
                .where(TaskException.work_unit_id == work_unit.id)
                .where(TaskException.panel_unit_id == panel_unit.id)
                .where(TaskException.station_id == station.id)
                .where(TaskException.exception_type == TaskExceptionType.SKIP)
                .where(TaskException.task_definition_id.in_(required_ids))
            ).scalars()
        )
        if not required_ids.issubset(completed_ids | skipped_ids):
            return False

    next_station = rules.next_station(station, work_unit, work_order, panel_def)
    if next_station:
        panel_unit.current_station_id = next_station.id
        panel_unit.status = PanelUnitStatus.IN_PROGRESS
        if work_unit.status == WorkUnitStatus.PLANNED:
            work_unit.status = WorkUnitStatus.PANELS
    else:
        panel_unit.current_station_id = None
        panel_unit.status = PanelUnitStatus.COMPLETED
        all_applicable_panels_done = _all_applicable_panels_terminal(db, work_unit, work_order)
        if all_applicable_panels_done and work_unit.status in (
            WorkUnitStatus.PLANNED,
            WorkUnitStatus.PANELS,
        ):
            work_unit.status = WorkUnitStatus.MAGAZINE
        elif work_unit.status == WorkUnitStatus.PLANNED:
            work_unit.status = WorkUnitStatus.PANELS
    return True


@dataclass(frozen=True)
class ReleasedPanel:
    panel_unit: PanelUnit
    from_station: Station
    record: PanelAutoRelease


def release_stalled_panels(
    db: Session,
    *,
    trigger: str = TRIGGER_ROUTING_CHANGE,
    reason: str | None = None,
) -> list[ReleasedPanel]:
    """Advance in-progress panels whose current station has no work left for them.

    Panels with an open task at their current station are left alone: the worker can
    still see and finish that task, and completing it advances the panel the usual way.
    Open tasks at other stations (e.g. forgotten ones) do not hold a panel back.

    Every release is recorded as a ``PanelAutoRelease`` so it can be reviewed and undone.
    """
    rows = list(
        db.execute(
            select(PanelUnit, Station)
            .join(Station, PanelUnit.current_station_id == Station.id)
            .where(PanelUnit.status == PanelUnitStatus.IN_PROGRESS)
            .where(Station.role == StationRole.PANELS)
            .order_by(PanelUnit.id)
        ).all()
    )
    if not rows:
        return []
    busy_pairs = {
        (panel_unit_id, station_id)
        for panel_unit_id, station_id in db.execute(
            select(TaskInstance.panel_unit_id, TaskInstance.station_id)
            .where(TaskInstance.panel_unit_id.in_([panel.id for panel, _ in rows]))
            .where(TaskInstance.status.in_(OPEN_TASK_STATUSES))
        ).all()
    }
    rules = PanelRoutingRules.load(db, sorted({panel.work_unit_id for panel, _ in rows}))
    released: list[ReleasedPanel] = []
    for panel_unit, station in rows:
        if (panel_unit.id, station.id) in busy_pairs:
            continue
        work_unit = db.get(WorkUnit, panel_unit.work_unit_id)
        if work_unit is None:
            continue
        previous_panel_status = panel_unit.status
        previous_work_unit_status = work_unit.status
        if not advance_panel_if_satisfied(db, panel_unit, station, rules):
            continue
        record = PanelAutoRelease(
            panel_unit_id=panel_unit.id,
            work_unit_id=work_unit.id,
            from_station_id=station.id,
            to_station_id=panel_unit.current_station_id,
            previous_panel_status=previous_panel_status,
            new_panel_status=panel_unit.status,
            previous_work_unit_status=previous_work_unit_status,
            new_work_unit_status=work_unit.status,
            trigger=trigger,
            reason=reason,
            created_at=utc_now(),
        )
        db.add(record)
        # Sibling panels of the same module read these statuses back.
        db.flush()
        released.append(ReleasedPanel(panel_unit=panel_unit, from_station=station, record=record))
    return released


def auto_release_undo_blocker(db: Session, record: PanelAutoRelease) -> str | None:
    """Why ``record`` can no longer be undone, or None when it still can.

    An undo is allowed only while nothing has happened to the panel (or to its module,
    when the release changed the module's status) since the release.
    """
    if record.undone_at is not None:
        return "Esta liberación ya fue deshecha."
    panel_unit = db.get(PanelUnit, record.panel_unit_id)
    work_unit = db.get(WorkUnit, record.work_unit_id)
    if panel_unit is None or work_unit is None:
        return "El panel o el módulo ya no existe."
    if (
        panel_unit.status != record.new_panel_status
        or panel_unit.current_station_id != record.to_station_id
    ):
        return "El panel cambió de estación o estado después de la liberación."
    if work_unit.status != record.new_work_unit_status:
        later_sibling_release = db.execute(
            select(PanelAutoRelease.id)
            .where(PanelAutoRelease.work_unit_id == record.work_unit_id)
            .where(PanelAutoRelease.id > record.id)
            .where(PanelAutoRelease.undone_at.is_(None))
            .where(PanelAutoRelease.new_work_unit_status == work_unit.status)
            .limit(1)
        ).scalar_one_or_none()
        if later_sibling_release is not None:
            return "Deshaga primero las liberaciones más recientes de este módulo."
        return "El módulo cambió de estado después de la liberación."
    activity_after = or_(
        TaskInstance.started_at > record.created_at,
        TaskInstance.completed_at > record.created_at,
    )
    panel_activity = db.execute(
        select(TaskInstance.id)
        .where(TaskInstance.panel_unit_id == panel_unit.id)
        .where(activity_after)
        .limit(1)
    ).scalar_one_or_none()
    panel_exception = db.execute(
        select(TaskException.id)
        .where(TaskException.panel_unit_id == panel_unit.id)
        .where(TaskException.created_at > record.created_at)
        .limit(1)
    ).scalar_one_or_none()
    if panel_activity is not None or panel_exception is not None:
        return "Se registró trabajo en el panel después de la liberación."
    if record.previous_work_unit_status != record.new_work_unit_status:
        module_activity = db.execute(
            select(TaskInstance.id)
            .where(TaskInstance.work_unit_id == work_unit.id)
            .where(TaskInstance.panel_unit_id.is_(None))
            .where(activity_after)
            .limit(1)
        ).scalar_one_or_none()
        if module_activity is not None:
            return "Se registró trabajo en el módulo después de la liberación."
    return None


class AutoReleaseUndoError(Exception):
    pass


def undo_auto_release(
    db: Session, record: PanelAutoRelease, admin_user_id: int | None
) -> None:
    """Put the panel (and its module status) back where the release found it.

    This does not touch routing configuration, so the guard does not run on this commit.
    If the configuration still leaves no work at that station, the next routing edit
    will release the panel again; fix the configuration first.
    """
    blocker = auto_release_undo_blocker(db, record)
    if blocker:
        raise AutoReleaseUndoError(blocker)
    panel_unit = db.get(PanelUnit, record.panel_unit_id)
    work_unit = db.get(WorkUnit, record.work_unit_id)
    panel_unit.status = record.previous_panel_status
    panel_unit.current_station_id = record.from_station_id
    if record.previous_work_unit_status != record.new_work_unit_status:
        work_unit.status = record.previous_work_unit_status
    record.undone_at = utc_now()
    record.undone_by_user_id = admin_user_id


def _routing_reason(model_names: set[str]) -> str:
    labels = sorted({_ROUTING_MODEL_LABELS.get(name, name) for name in model_names})
    if not labels:
        return "Cambio de configuración"
    return "Cambio de configuración: " + ", ".join(labels)


def _routing_model_names(session: Session) -> set[str]:
    return {
        type(obj).__name__
        for obj in (*session.new, *session.dirty, *session.deleted)
        if isinstance(obj, ROUTING_MODELS)
    }


def _touches_routing(session: Session) -> bool:
    return any(
        isinstance(obj, ROUTING_MODELS)
        for obj in (*session.new, *session.dirty, *session.deleted)
    )


def _note_routing_flush(session: Session, _flush_context: object, _instances: object) -> None:
    names = _routing_model_names(session)
    if names:
        session.info[_ROUTING_CHANGED] = True
        session.info.setdefault(_ROUTING_CHANGED_MODELS, set()).update(names)


def _note_routing_statement(state: ORMExecuteState) -> None:
    if not (state.is_insert or state.is_update or state.is_delete):
        return
    mapper = state.bind_mapper
    if mapper is not None and issubclass(mapper.class_, ROUTING_MODELS):
        state.session.info[_ROUTING_CHANGED] = True
        state.session.info.setdefault(_ROUTING_CHANGED_MODELS, set()).add(
            mapper.class_.__name__
        )


def _release_before_commit(session: Session) -> None:
    if not (session.info.get(_ROUTING_CHANGED) or _touches_routing(session)):
        return
    model_names = set(session.info.get(_ROUTING_CHANGED_MODELS, ()))
    model_names |= _routing_model_names(session)
    session.flush()
    session.info.pop(_ROUTING_CHANGED, None)
    session.info.pop(_ROUTING_CHANGED_MODELS, None)
    try:
        with session.begin_nested():
            released = release_stalled_panels(
                session,
                trigger=TRIGGER_ROUTING_CHANGE,
                reason=_routing_reason(model_names),
            )
    except Exception:
        # Never block the configuration edit itself; the panel stays where it was.
        logger.exception("Could not re-evaluate panel positions after a routing change")
        return
    for item in released:
        logger.info(
            "Panel unit %s left station %s after a routing change (no work left there)",
            item.panel_unit.id,
            item.from_station.name,
        )


def _forget_routing_change(session: Session, *_args: object) -> None:
    session.info.pop(_ROUTING_CHANGED, None)
    session.info.pop(_ROUTING_CHANGED_MODELS, None)


def install_stalled_panel_guard(session_factory: sessionmaker) -> None:
    """Re-evaluate in-progress panels whenever a commit changes panel routing config."""
    event.listen(session_factory, "before_flush", _note_routing_flush)
    event.listen(session_factory, "do_orm_execute", _note_routing_statement)
    event.listen(session_factory, "before_commit", _release_before_commit)
    event.listen(session_factory, "after_rollback", _forget_routing_change)
