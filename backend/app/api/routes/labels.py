from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from sqlalchemy.orm import Session

from app.api.deps import get_db, require_sysadmin
from app.models.admin import AdminUser
from app.schemas.labels import (
    LabelPrinterStatus,
    LabelSettings,
    LabelTestPrintResponse,
    ProductionLabelData,
)
from app.services import label_printer as label_printer_service


router = APIRouter()


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
