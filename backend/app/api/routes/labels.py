from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from sqlalchemy.orm import Session

from app.api.deps import get_db, require_sysadmin, get_current_worker, get_current_worker_session
from app.models.admin import AdminUser
from app.schemas.labels import (
    LabelPrinterStatus,
    LabelSettings,
    LabelTestPrintResponse,
    ProductionLabelData,
)
from app.services import label_printer as label_printer_service
from app.services import panel_labels
from app.schemas.panel_labels import PanelLabelInput, PanelLabelPreview
from app.models.workers import Worker, WorkerSession
from app.models.stations import Station
from app.models.enums import StationRole
from app.models.work import PanelUnit, WorkUnit
from app.models.tasks import TaskInstance
from sqlalchemy import select


router = APIRouter()


def require_framing(
    db: Session = Depends(get_db),
    session: WorkerSession = Depends(get_current_worker_session),
    worker: Worker = Depends(get_current_worker),
) -> Station:
    station = db.get(Station, session.station_id) if session.station_id else None
    if not station or station.role != StationRole.PANELS or station.name.strip().casefold() != "framing":
        raise HTTPException(403, "La impresión está disponible en Framing.")
    return station


def worker_preview(payload: PanelLabelInput, db: Session, station: Station, worker: Worker) -> PanelLabelPreview:
    # Use the same eligibility as the workspace, including planned panels without a PanelUnit.
    from app.api.routes.worker_station import station_snapshot
    snapshot = station_snapshot(station.id, planned_limit=None, db=db, _worker=worker)
    if not any(item.work_unit_id == payload.work_unit_id and item.panel_definition_id == payload.panel_definition_id for item in snapshot.work_items):
        raise HTTPException(409, "El panel ya no está disponible en Framing. Actualiza la estación.")
    return panel_labels.load_preview(db, payload)


@router.post("/worker/preview", response_model=PanelLabelPreview)
def preview_worker_label(
    payload: PanelLabelInput,
    db: Session = Depends(get_db),
    station: Station = Depends(require_framing),
    worker: Worker = Depends(get_current_worker),
) -> PanelLabelPreview:
    return worker_preview(payload, db, station, worker)


def dispatch_panel_label(preview: PanelLabelPreview, copies: int) -> dict:
    try:
        return panel_labels.print_label(preview, copies)
    except (label_printer_service.PrinterNotConfiguredError, label_printer_service.PrinterConnectionError) as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post("/worker/print", response_model=LabelTestPrintResponse)
def print_worker_label(
    payload: PanelLabelInput,
    db: Session = Depends(get_db),
    station: Station = Depends(require_framing),
    worker: Worker = Depends(get_current_worker),
) -> dict:
    return dispatch_panel_label(worker_preview(payload, db, station, worker), payload.copies)


@router.get("/panel-context", response_model=PanelLabelInput | None)
def latest_panel_context(db: Session = Depends(get_db), _admin: AdminUser = Depends(require_sysadmin)):
    panel = db.execute(
        select(PanelUnit).join(TaskInstance, TaskInstance.panel_unit_id == PanelUnit.id)
        .order_by(TaskInstance.started_at.desc().nullslast(), TaskInstance.id.desc()).limit(1)
    ).scalar_one_or_none()
    if panel is None:
        panel = db.execute(select(PanelUnit).join(WorkUnit).order_by(WorkUnit.planned_sequence, PanelUnit.id).limit(1)).scalar_one_or_none()
    if panel is None:
        return None
    return PanelLabelInput(work_unit_id=panel.work_unit_id, panel_definition_id=panel.panel_definition_id)


@router.post("/admin/preview", response_model=PanelLabelPreview)
def preview_admin_label(payload: PanelLabelInput, db: Session = Depends(get_db), _admin: AdminUser = Depends(require_sysadmin)):
    return panel_labels.load_preview(db, payload)


@router.post("/admin/print", response_model=LabelTestPrintResponse)
def print_admin_label(payload: PanelLabelInput, db: Session = Depends(get_db), _admin: AdminUser = Depends(require_sysadmin)):
    return dispatch_panel_label(panel_labels.load_preview(db, payload), payload.copies)


@router.get("/settings", response_model=LabelSettings)
def get_label_settings(
    _admin: AdminUser = Depends(require_sysadmin),
) -> dict:
    return label_printer_service.load_settings()


@router.put("/settings", response_model=LabelSettings)
def update_label_settings(
    payload: LabelSettings,
    _admin: AdminUser = Depends(require_sysadmin),
) -> dict:
    return label_printer_service.save_settings(payload)


@router.get("/status", response_model=LabelPrinterStatus)
def get_printer_status(
    _admin: AdminUser = Depends(require_sysadmin),
) -> dict:
    return label_printer_service.get_status()


@router.get("/latest-production", response_model=ProductionLabelData | None)
def get_latest_production(
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_sysadmin),
) -> dict | None:
    return label_printer_service.load_latest_production_data(db)


@router.post("/test-print", response_model=LabelTestPrintResponse)
def print_test_label(
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_sysadmin),
) -> dict:
    payload = label_printer_service.load_settings()
    production = label_printer_service.load_latest_production_data(db)
    if production is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No hay modulos disponibles en produccion para crear la muestra.",
        )
    try:
        return label_printer_service.send_test_label(payload, production)
    except label_printer_service.PrinterNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except label_printer_service.PrinterConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
