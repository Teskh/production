from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session, aliased

from app.api.deps import get_db
from app.models.enums import TaskScope
from app.models.house import PanelDefinition
from app.models.stations import Station
from app.models.tasks import TaskDefinition, TaskStationAdherenceFact
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.schemas.task_station_adherence import (
    TaskStationAdherenceResponse,
    TaskStationAdherenceRow,
    TaskStationAdherenceSummary,
)

router = APIRouter()


def _parse_datetime(value: str | None, field: str, end_of_day: bool = False) -> datetime | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    normalized = raw.replace(" ", "T")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {field} value",
        ) from exc
    if end_of_day and len(raw) == 10:
        return dt.replace(hour=23, minute=59, second=59, microsecond=999999)
    return dt


@router.get("", response_model=TaskStationAdherenceResponse)
def get_task_station_adherence(
    from_date: str | None = None,
    to_date: str | None = None,
    house_type_id: int | None = None,
    scope: TaskScope | None = None,
    task_definition_id: int | None = None,
    actual_station_id: int | None = None,
    completed_station_id: int | None = None,
    planned_station_id: int | None = None,
    include_non_kpi: bool = False,
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> TaskStationAdherenceResponse:
    from_dt = _parse_datetime(from_date, "from_date")
    to_dt = _parse_datetime(to_date, "to_date", end_of_day=True)

    fact = TaskStationAdherenceFact
    conditions = []
    if from_dt is not None:
        conditions.append(fact.completed_at >= from_dt)
    if to_dt is not None:
        conditions.append(fact.completed_at <= to_dt)
    if scope is not None:
        conditions.append(fact.scope == scope)
    if task_definition_id is not None:
        conditions.append(fact.task_definition_id == task_definition_id)
    if actual_station_id is not None:
        conditions.append(fact.actual_station_id == actual_station_id)
    if completed_station_id is not None:
        conditions.append(fact.completed_station_id == completed_station_id)
    if planned_station_id is not None:
        conditions.append(fact.planned_station_id == planned_station_id)
    if not include_non_kpi:
        conditions.append(fact.included_in_kpi == True)

    summary_conditions = list(conditions)

    summary_stmt = (
        select(
            func.count(fact.id),
            func.coalesce(
                func.sum(case((fact.included_in_kpi == True, 1), else_=0)),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                fact.included_in_kpi == True,
                                fact.is_deviation == False,
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                fact.included_in_kpi == True,
                                fact.is_deviation == True,
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
        )
        .select_from(fact)
        .join(WorkUnit, fact.work_unit_id == WorkUnit.id)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
    )
    if house_type_id is not None:
        summary_conditions.append(WorkOrder.house_type_id == house_type_id)
    if summary_conditions:
        summary_stmt = summary_stmt.where(*summary_conditions)

    total_rows, kpi_rows, matched_rows, deviation_rows = db.execute(summary_stmt).one()

    actual_station = aliased(Station)
    completed_station = aliased(Station)
    planned_station = aliased(Station)

    row_conditions = list(conditions)
    row_stmt = (
        select(
            fact,
            TaskDefinition.name,
            WorkOrder.project_name,
            WorkOrder.house_identifier,
            WorkUnit.module_number,
            PanelDefinition.panel_code,
            actual_station.name,
            completed_station.name,
            planned_station.name,
        )
        .select_from(fact)
        .join(TaskDefinition, fact.task_definition_id == TaskDefinition.id)
        .join(WorkUnit, fact.work_unit_id == WorkUnit.id)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .outerjoin(PanelUnit, fact.panel_unit_id == PanelUnit.id)
        .outerjoin(PanelDefinition, PanelUnit.panel_definition_id == PanelDefinition.id)
        .outerjoin(actual_station, fact.actual_station_id == actual_station.id)
        .outerjoin(completed_station, fact.completed_station_id == completed_station.id)
        .outerjoin(planned_station, fact.planned_station_id == planned_station.id)
        .order_by(fact.completed_at.desc(), fact.id.desc())
        .offset(offset)
        .limit(limit)
    )
    if house_type_id is not None:
        row_conditions.append(WorkOrder.house_type_id == house_type_id)
    if row_conditions:
        row_stmt = row_stmt.where(*row_conditions)

    rows = []
    for (
        fact_row,
        task_name,
        project_name,
        house_identifier,
        module_number,
        panel_code,
        actual_station_name,
        completed_station_name,
        planned_station_name,
    ) in db.execute(row_stmt).all():
        rows.append(
            TaskStationAdherenceRow(
                task_instance_id=fact_row.task_instance_id,
                completed_at=fact_row.completed_at,
                task_definition_id=fact_row.task_definition_id,
                task_name=task_name,
                scope=fact_row.scope,
                project_name=project_name,
                house_identifier=house_identifier,
                module_number=module_number,
                panel_code=panel_code,
                actual_station_id=fact_row.actual_station_id,
                actual_station_name=actual_station_name,
                completed_station_id=fact_row.completed_station_id,
                completed_station_name=completed_station_name,
                planned_station_id=fact_row.planned_station_id,
                planned_station_name=planned_station_name,
                planned_station_sequence=fact_row.planned_station_sequence,
                resolution_code=fact_row.resolution_code,
                included_in_kpi=fact_row.included_in_kpi,
                is_deviation=fact_row.is_deviation,
            )
        )

    adherence_rate = (
        round((matched_rows / kpi_rows) * 100, 2) if kpi_rows else None
    )

    return TaskStationAdherenceResponse(
        from_date=from_date,
        to_date=to_date,
        summary=TaskStationAdherenceSummary(
            total_rows=int(total_rows or 0),
            kpi_rows=int(kpi_rows or 0),
            matched_rows=int(matched_rows or 0),
            deviation_rows=int(deviation_rows or 0),
            adherence_rate=adherence_rate,
        ),
        rows=rows,
    )
