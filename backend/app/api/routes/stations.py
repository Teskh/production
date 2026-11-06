from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin_page
from app.models.admin import AdminUser
from app.models.enums import (
    PanelUnitStatus,
    StationLineType,
    StationRole,
    TaskScope,
    WorkUnitStatus,
)
from app.models.stations import Station
from app.models.tasks import TaskApplicability, TaskDefinition
from app.models.work import PanelUnit, WorkUnit
from app.schemas.stations import (
    StationChangeImpactRead,
    StationCreate,
    StationRead,
    StationUpdate,
)

router = APIRouter()

ROUTED_TASK_NAME_LIMIT = 15

ROLE_LABELS = {
    StationRole.PANELS: "Paneles",
    StationRole.MAGAZINE: "Magazine",
    StationRole.ASSEMBLY: "Ensamblaje",
    StationRole.AUX: "AUX",
}


@router.get("", response_model=list[StationRead])
def list_stations(db: Session = Depends(get_db)) -> list[Station]:
    return list(db.execute(select(Station).order_by(Station.id)).scalars())


def _validate_station_payload(
    *,
    role: StationRole,
    line_type: str | None,
    sequence_order: int | None,
) -> None:
    if role == StationRole.ASSEMBLY:
        if line_type is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Assembly stations require a line type",
            )
    else:
        if line_type is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Line type is only allowed for assembly stations",
            )
    if role == StationRole.AUX:
        if sequence_order is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Aux stations must not have a sequence order",
            )
    else:
        if sequence_order is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sequence order is required for non-aux stations",
            )
        if sequence_order <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sequence order must be a positive number",
            )


def _normalize_camera_feed_ip(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


# --- Change impact ------------------------------------------------------------------


@dataclass(frozen=True)
class StationPlacement:
    """Where a station sits in routing: role, assembly line and sequence."""

    role: StationRole
    line_type: str | None
    sequence_order: int | None

    @classmethod
    def of(cls, station: Any) -> StationPlacement:
        return cls(
            role=StationRole(_enum_value(station.role)),
            line_type=_enum_value(station.line_type),
            sequence_order=station.sequence_order,
        )


def find_sequence_conflict(
    stations: Iterable[Any], station_id: int | None, placement: StationPlacement
) -> Any | None:
    """Another station with the same role, line and sequence, if any."""
    if placement.role == StationRole.AUX or placement.sequence_order is None:
        return None
    for other in stations:
        if station_id is not None and other.id == station_id:
            continue
        if StationPlacement.of(other) == placement:
            return other
    return None


def panel_start_lost(
    stations: Iterable[Any], station_id: int, new: StationPlacement | None
) -> bool:
    """True when a PANELS station with sequence 1 exists now but would not afterwards.

    New panels only start at a PANELS station with sequence 1. ``new`` is None
    when the station is being deleted.
    """
    def is_start(placement: StationPlacement | None) -> bool:
        return (
            placement is not None
            and placement.role == StationRole.PANELS
            and placement.sequence_order == 1
        )

    rows = list(stations)
    before = any(is_start(StationPlacement.of(row)) for row in rows)
    after = any(
        is_start(new if row.id == station_id else StationPlacement.of(row)) for row in rows
    )
    return before and not after


def routes_lost(old: StationPlacement, new: StationPlacement | None) -> bool:
    if new is None:
        return True
    if old.role != new.role:
        return True
    if old.role == StationRole.AUX:
        return False
    return old.sequence_order != new.sequence_order or old.line_type != new.line_type


def _scopes_for_role(role: StationRole) -> tuple[TaskScope, ...]:
    if role == StationRole.PANELS:
        return (TaskScope.PANEL,)
    if role == StationRole.ASSEMBLY:
        return (TaskScope.MODULE,)
    if role == StationRole.MAGAZINE:
        return (TaskScope.PANEL, TaskScope.MODULE)
    return (TaskScope.AUX,)


def routed_task_names(
    station_id: int,
    old: StationPlacement,
    tasks: Iterable[Any],
    applicability_rows: Iterable[Any],
) -> list[str]:
    """Active task names that route to this station's current position.

    Panel/module tasks route by sequence number (default sequence or an applicable
    override); AUX tasks store the AUX station id as their sequence.
    """
    target = station_id if old.role == StationRole.AUX else old.sequence_order
    if target is None:
        return []
    scopes = {_enum_value(scope) for scope in _scopes_for_role(old.role)}
    eligible = {
        task.id: task
        for task in tasks
        if _enum_value(task.scope) in scopes and task.active and task.archived_at is None
    }
    routed: set[int] = {
        task_id for task_id, task in eligible.items() if task.default_station_sequence == target
    }
    for row in applicability_rows:
        if (
            row.task_definition_id in eligible
            and row.applies
            and row.station_sequence_order == target
        ):
            routed.add(row.task_definition_id)
    return sorted((eligible[task_id].name for task_id in routed), key=str.lower)


def build_station_change_impact(
    station: Any,
    new: StationPlacement | None,
    stations: Sequence[Any],
    tasks: Sequence[Any],
    applicability_rows: Sequence[Any],
    panels_at_station: int,
    modules_at_station: int,
) -> StationChangeImpactRead:
    """Evaluate a role/line/sequence change (``new``) or a delete (``new`` None)."""
    old = StationPlacement.of(station)
    impact = StationChangeImpactRead(
        panels_at_station=panels_at_station, modules_at_station=modules_at_station
    )
    placement_changed = new is None or new != old
    if not placement_changed:
        return impact

    occupied = panels_at_station or modules_at_station
    if occupied:
        action = "eliminar la estacion" if new is None else "cambiar rol, linea o secuencia"
        impact.blocking_message = (
            f"No se puede {action}: hay {panels_at_station} panel(es) y "
            f"{modules_at_station} modulo(s) en {station.name}. "
            "Muevalos o terminelos primero."
        )

    if new is not None:
        conflict = find_sequence_conflict(stations, station.id, new)
        if conflict is not None:
            impact.sequence_conflict_station = conflict.name
            line = f" de la linea {new.line_type}" if new.line_type else ""
            impact.warnings.append(
                f"Ya existe la estacion {conflict.name} ({ROLE_LABELS[new.role]}{line}) "
                f"con secuencia {new.sequence_order}."
            )

    if routes_lost(old, new):
        kept_elsewhere = old.role != StationRole.AUX and any(
            other.id != station.id and StationPlacement.of(other) == old for other in stations
        )
        if not kept_elsewhere:
            names = routed_task_names(station.id, old, tasks, applicability_rows)
            impact.routed_task_count = len(names)
            impact.routed_task_names = names[:ROUTED_TASK_NAME_LIMIT]
            if names:
                where = (
                    "a esta estacion AUX"
                    if old.role == StationRole.AUX
                    else f"a la secuencia {old.sequence_order}"
                )
                listed = ", ".join(names[:ROUTED_TASK_NAME_LIMIT])
                extra = (
                    f" y {len(names) - ROUTED_TASK_NAME_LIMIT} mas"
                    if len(names) > ROUTED_TASK_NAME_LIMIT
                    else ""
                )
                scope_label = (
                    f"estacion de la linea {old.line_type}"
                    if old.role == StationRole.ASSEMBLY and old.line_type
                    else "estacion"
                )
                impact.warnings.append(
                    f"{len(names)} tarea(s) activa(s) apuntan {where} y ninguna otra "
                    f"{scope_label} la cubre; dejaran de aparecer hasta reasignarlas: "
                    f"{listed}{extra}."
                )

    if panel_start_lost(stations, station.id, new):
        impact.missing_panel_start = True
        impact.warnings.append(
            "No quedara ninguna estacion de Paneles con secuencia 1. Los paneles nuevos "
            "solo comienzan en la secuencia 1, por lo que no podran iniciarse."
        )
    return impact


def _occupancy(db: Session, station: Station) -> tuple[int, int]:
    panels = db.scalar(
        select(func.count(PanelUnit.id))
        .where(PanelUnit.current_station_id == station.id)
        .where(PanelUnit.status == PanelUnitStatus.IN_PROGRESS)
    )
    if station.role == StationRole.MAGAZINE:
        # Magazine holds modules by status, not by current_station_id (panel completion
        # moves a module to MAGAZINE without assigning a station).
        module_filter = WorkUnit.status == WorkUnitStatus.MAGAZINE
    else:
        module_filter = (WorkUnit.current_station_id == station.id) & (
            WorkUnit.status != WorkUnitStatus.COMPLETED
        )
    modules = db.scalar(select(func.count(WorkUnit.id)).where(module_filter))
    return int(panels or 0), int(modules or 0)


def _change_impact(
    db: Session, station: Station, new: StationPlacement | None
) -> StationChangeImpactRead:
    stations = list(db.execute(select(Station)).scalars())
    tasks = db.execute(
        select(
            TaskDefinition.id,
            TaskDefinition.name,
            TaskDefinition.scope,
            TaskDefinition.active,
            TaskDefinition.archived_at,
            TaskDefinition.default_station_sequence,
        )
    ).all()
    applicability_rows = db.execute(
        select(
            TaskApplicability.task_definition_id,
            TaskApplicability.applies,
            TaskApplicability.station_sequence_order,
        )
    ).all()
    panels, modules = _occupancy(db, station)
    return build_station_change_impact(
        station, new, stations, tasks, applicability_rows, panels, modules
    )


def _raise_sequence_conflict(db: Session, station_id: int | None, placement: StationPlacement) -> None:
    conflict = find_sequence_conflict(
        db.execute(select(Station)).scalars(), station_id, placement
    )
    if conflict is not None:
        line = f" de la linea {placement.line_type}" if placement.line_type else ""
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Ya existe la estacion {conflict.name} ({ROLE_LABELS[placement.role]}{line}) "
                f"con secuencia {placement.sequence_order}. Cada rol y linea debe tener "
                "secuencias unicas."
            ),
        )


@router.post("", response_model=StationRead, status_code=status.HTTP_201_CREATED)
def create_station(
    payload: StationCreate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("stations", edit=True)),
) -> Station:
    payload.camera_feed_ip = _normalize_camera_feed_ip(payload.camera_feed_ip)
    _validate_station_payload(
        role=payload.role,
        line_type=payload.line_type.value if payload.line_type else None,
        sequence_order=payload.sequence_order,
    )
    _raise_sequence_conflict(
        db,
        None,
        StationPlacement(
            role=payload.role,
            line_type=payload.line_type.value if payload.line_type else None,
            sequence_order=payload.sequence_order,
        ),
    )
    station = Station(**payload.model_dump())
    db.add(station)
    db.commit()
    db.refresh(station)
    return station


@router.get("/{station_id}", response_model=StationRead)
def get_station(station_id: int, db: Session = Depends(get_db)) -> Station:
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    return station


@router.get("/{station_id}/change-impact", response_model=StationChangeImpactRead)
def get_station_change_impact(
    station_id: int,
    role: StationRole | None = None,
    line_type: StationLineType | None = None,
    sequence_order: int | None = None,
    delete: bool = False,
    db: Session = Depends(get_db),
) -> StationChangeImpactRead:
    """Preview what a role/line/sequence change, or a delete, would affect.

    Omitted query values mean "unchanged", except that line type and sequence are
    cleared when the new role does not use them.
    """
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    if delete:
        return _change_impact(db, station, None)
    current = StationPlacement.of(station)
    new_role = role or current.role
    new_line = _enum_value(line_type) if line_type is not None else current.line_type
    new_sequence = sequence_order if sequence_order is not None else current.sequence_order
    if new_role != StationRole.ASSEMBLY:
        new_line = None
    if new_role == StationRole.AUX:
        new_sequence = None
    return _change_impact(
        db, station, StationPlacement(role=new_role, line_type=new_line, sequence_order=new_sequence)
    )


@router.put("/{station_id}", response_model=StationRead)
def update_station(
    station_id: int,
    payload: StationUpdate,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("stations", edit=True)),
) -> Station:
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    updates = payload.model_dump(exclude_unset=True)
    if "camera_feed_ip" in updates:
        updates["camera_feed_ip"] = _normalize_camera_feed_ip(updates["camera_feed_ip"])
    role = updates.get("role", station.role)
    line_type = updates.get("line_type", station.line_type)
    sequence_order = updates.get("sequence_order", station.sequence_order)
    _validate_station_payload(
        role=role,
        line_type=line_type.value if line_type else None,
        sequence_order=sequence_order,
    )
    new_placement = StationPlacement(
        role=StationRole(_enum_value(role)),
        line_type=_enum_value(line_type),
        sequence_order=sequence_order,
    )
    if new_placement != StationPlacement.of(station):
        panels, modules = _occupancy(db, station)
        if panels or modules:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"No se puede cambiar rol, linea o secuencia: hay {panels} panel(es) y "
                    f"{modules} modulo(s) en {station.name}. Muevalos o terminelos primero."
                ),
            )
        _raise_sequence_conflict(db, station.id, new_placement)
    for key, value in updates.items():
        setattr(station, key, value)
    db.commit()
    db.refresh(station)
    return station


@router.delete("/{station_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_station(
    station_id: int,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_admin_page("stations", edit=True)),
) -> None:
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    panels, modules = _occupancy(db, station)
    if panels or modules:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"No se puede eliminar la estacion: hay {panels} panel(es) y {modules} "
                f"modulo(s) en {station.name}. Muevalos o terminelos primero."
            ),
        )
    db.delete(station)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "No se puede eliminar la estacion porque tiene historial de produccion "
                "(tareas, sesiones o registros) asociado."
            ),
        ) from exc
