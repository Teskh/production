from __future__ import annotations

import copy
import json
import re
import socket
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from sqlalchemy import case, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.enums import TaskStatus, WorkUnitStatus
from app.models.house import PanelDefinition
from app.models.tasks import TaskInstance
from app.models.work import PanelUnit, WorkOrder, WorkUnit
from app.schemas.labels import LabelSettings, ProductionLabelData


PRINT_WIDTH_DOTS = 799
LABEL_LENGTH_DOTS = 1618
DOTS_PER_MM = 8

DEFAULT_SETTINGS = LabelSettings().model_dump()


class PrinterNotConfiguredError(RuntimeError):
    pass


class PrinterConnectionError(RuntimeError):
    pass


def _settings_path() -> Path:
    return Path(settings.label_printer_settings_path)


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
    temporary.replace(path)


def load_settings() -> dict[str, Any]:
    path = _settings_path()
    data = copy.deepcopy(DEFAULT_SETTINGS)
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as handle:
                stored = json.load(handle)
            if isinstance(stored, dict):
                data.update(stored)
        except (OSError, json.JSONDecodeError):
            pass
    try:
        return LabelSettings.model_validate(data).model_dump()
    except ValidationError:
        return copy.deepcopy(DEFAULT_SETTINGS)


def save_settings(payload: LabelSettings | dict[str, Any]) -> dict[str, Any]:
    validated = (
        payload
        if isinstance(payload, LabelSettings)
        else LabelSettings.model_validate(payload)
    )
    data = validated.model_dump()
    _save_json(_settings_path(), data)
    return data


def _task_context_statement():
    return (
        select(TaskInstance, WorkUnit, WorkOrder, PanelDefinition)
        .join(WorkUnit, TaskInstance.work_unit_id == WorkUnit.id)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .outerjoin(PanelUnit, TaskInstance.panel_unit_id == PanelUnit.id)
        .outerjoin(PanelDefinition, PanelUnit.panel_definition_id == PanelDefinition.id)
    )


def _production_data_from_task_row(
    row: tuple[TaskInstance, WorkUnit, WorkOrder, PanelDefinition | None],
    *,
    source: str,
) -> dict[str, Any]:
    task, work_unit, work_order, panel_definition = row
    panel_name = panel_definition.panel_code if panel_definition is not None else None
    return ProductionLabelData(
        work_unit_id=work_unit.id,
        production_number=work_order.house_identifier or f"WO-{work_order.id}",
        project_name=work_order.project_name,
        module_number=work_unit.module_number,
        panel_name=panel_name,
        scope="panel" if panel_name else "module",
        source=source,
        activity_at=task.completed_at or task.started_at,
    ).model_dump()


def load_latest_production_data(db: Session) -> dict[str, Any] | None:
    active_row = db.execute(
        _task_context_statement()
        .where(TaskInstance.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.PAUSED]))
        .order_by(TaskInstance.started_at.desc().nullslast(), TaskInstance.id.desc())
        .limit(1)
    ).one_or_none()
    if active_row is not None:
        return _production_data_from_task_row(active_row, source="active_task")

    recent_row = db.execute(
        _task_context_statement()
        .where(TaskInstance.started_at.is_not(None))
        .order_by(
            TaskInstance.completed_at.desc().nullslast(),
            TaskInstance.started_at.desc().nullslast(),
            TaskInstance.id.desc(),
        )
        .limit(1)
    ).one_or_none()
    if recent_row is not None:
        return _production_data_from_task_row(recent_row, source="recent_activity")

    queue_row = db.execute(
        select(WorkUnit, WorkOrder)
        .join(WorkOrder, WorkUnit.work_order_id == WorkOrder.id)
        .where(WorkUnit.status != WorkUnitStatus.COMPLETED)
        .order_by(
            case(
                (
                    WorkUnit.status.in_(
                        [
                            WorkUnitStatus.PANELS,
                            WorkUnitStatus.MAGAZINE,
                            WorkUnitStatus.ASSEMBLY,
                        ]
                    ),
                    0,
                ),
                else_=1,
            ),
            WorkUnit.planned_sequence.asc().nullslast(),
            WorkUnit.id,
        )
        .limit(1)
    ).one_or_none()
    if queue_row is None:
        return None
    work_unit, work_order = queue_row
    return ProductionLabelData(
        work_unit_id=work_unit.id,
        production_number=work_order.house_identifier or f"WO-{work_order.id}",
        project_name=work_order.project_name,
        module_number=work_unit.module_number,
        panel_name=None,
        scope="module",
        source="production_queue",
        activity_at=None,
    ).model_dump()


def printer_profile() -> dict[str, Any]:
    return {
        "model": "Zebra ZD420",
        "dpi": 203,
        "dots_per_mm": DOTS_PER_MM,
        "print_width_dots": PRINT_WIDTH_DOTS,
        "label_length_dots": LABEL_LENGTH_DOTS,
        "print_width_mm": round(PRINT_WIDTH_DOTS / DOTS_PER_MM, 1),
        "label_length_mm": round(LABEL_LENGTH_DOTS / DOTS_PER_MM, 1),
        "media_type": "Gap/notch",
        "print_method": "Thermal transfer",
    }


def _printer_target() -> tuple[str, int, float]:
    host = settings.zebra_printer_host.strip()
    if not host or host == "0.0.0.0":
        raise PrinterNotConfiguredError(
            "La impresora aun no tiene una IP configurada en ZEBRA_PRINTER_HOST."
        )
    return (
        host,
        settings.zebra_printer_port,
        max(settings.zebra_printer_timeout_seconds, 0.25),
    )


def _status_values(raw_status: str) -> list[str]:
    quoted = re.findall(r'"([^"\r\n]*)"', raw_status)
    if len(quoted) >= 5:
        return quoted
    return [part.strip().strip('"') for part in raw_status.split(",")]


def _status_summary(raw_status: str) -> tuple[str, str]:
    values = _status_values(raw_status)
    if len(values) < 5:
        return "connected", "Impresora conectada; respuesta de estado no reconocida."
    paused = values[0] == "1"
    has_error = values[1] == "1"
    has_warning = values[4] == "1"
    if has_error:
        return "error", "Impresora conectada con un error activo."
    if paused:
        return "paused", "Impresora conectada y en pausa."
    if has_warning:
        return "warning", "Impresora conectada con una advertencia activa."
    return "ready", "Impresora conectada y lista."


def get_status() -> dict[str, Any]:
    profile = printer_profile()
    try:
        host, port, timeout = _printer_target()
    except PrinterNotConfiguredError as exc:
        return {
            "configured": False,
            "connected": False,
            "state": "not_configured",
            "message": str(exc),
            "host": None,
            "port": settings.zebra_printer_port,
            "raw_status": None,
            "profile": profile,
        }

    try:
        with socket.create_connection((host, port), timeout=timeout) as connection:
            connection.settimeout(timeout)
            connection.sendall(b'! U1 getvar "zpl.system_status"\r\n')
            try:
                raw = connection.recv(4096).decode("utf-8", errors="replace").strip()
            except socket.timeout:
                raw = ""
    except OSError as exc:
        return {
            "configured": True,
            "connected": False,
            "state": "offline",
            "message": f"No se pudo conectar con la impresora en {host}:{port}: {exc}",
            "host": host,
            "port": port,
            "raw_status": None,
            "profile": profile,
        }

    state, message = (
        _status_summary(raw)
        if raw
        else ("connected", "Impresora conectada; no devolvio estado detallado.")
    )
    return {
        "configured": True,
        "connected": True,
        "state": state,
        "message": message,
        "host": host,
        "port": port,
        "raw_status": raw or None,
        "profile": profile,
    }


def _zpl_text(value: str, *, max_length: int) -> str:
    normalized = " ".join(value.split())[:max_length]
    return (
        normalized.replace("^", " ")
        .replace("~", " ")
        .replace("\\", "/")
    )


def _fitted_font_size(
    value: str, *, available_dots: int, preferred: int, minimum: int
) -> int:
    estimated_character_width = 0.68
    fitted = int(available_dots / max(len(value) * estimated_character_width, 1))
    return max(minimum, min(preferred, fitted))


def build_test_zpl(
    payload: LabelSettings | dict[str, Any],
    production: ProductionLabelData | dict[str, Any],
) -> str:
    label_settings = (
        payload
        if isinstance(payload, LabelSettings)
        else LabelSettings.model_validate(payload)
    )
    production_data = (
        production
        if isinstance(production, ProductionLabelData)
        else ProductionLabelData.model_validate(production)
    )
    selected = set(label_settings.selected_fields)
    commands = [
        "^XA",
        "^CI28",
        f"^PW{PRINT_WIDTH_DOTS}",
        f"^LL{LABEL_LENGTH_DOTS}",
        "^LH0,0",
        "^FO24,24^GB751,1570,4^FS",
        "^FO24,1040^GB751,4,4^FS",
    ]

    if "production_number" in selected:
        production_number = _zpl_text(production_data.production_number, max_length=28)
        production_font_size = _fitted_font_size(
            production_number, available_dots=900, preferred=72, minimum=34
        )
        commands.extend(
            [
                "^FO718,70^A0R,28,28^FDN PRODUCCION^FS",
                f"^FO642,70^A0R,{production_font_size},{production_font_size}^FD{production_number}^FS",
            ]
        )

    if "project_name" in selected:
        project_name = _zpl_text(production_data.project_name, max_length=32)
        project_font_size = _fitted_font_size(
            project_name, available_dots=900, preferred=48, minimum=26
        )
        commands.extend(
            [
                "^FO540,70^A0R,26,26^FDPROYECTO^FS",
                f"^FO480,70^A0R,{project_font_size},{project_font_size}^FD{project_name}^FS",
            ]
        )

    if "module_number" in selected:
        commands.extend(
            [
                "^FO718,1110^A0R,28,28^FDMODULO^FS",
                f"^FO600,1110^A0R,108,108^FDM-{production_data.module_number:02d}^FS",
            ]
        )

    if "panel_name" in selected and production_data.panel_name:
        panel_name = _zpl_text(production_data.panel_name, max_length=28)
        panel_font_size = _fitted_font_size(
            panel_name, available_dots=430, preferred=58, minimum=28
        )
        commands.extend(
            [
                "^FO380,1110^A0R,26,26^FDPANEL^FS",
                f"^FO310,1110^A0R,{panel_font_size},{panel_font_size}^FD{panel_name}^FS",
            ]
        )

    commands.extend(
        [
            "^FO78,70^A0R,22,22^FDZD420 / 203 DPI / MUESTRA PRODUCCION / LANDSCAPE^FS",
            f"^PQ{label_settings.copies},0,1,N",
            "^XZ",
        ]
    )
    return "\n".join(commands)


def send_test_label(
    payload: LabelSettings | dict[str, Any],
    production: ProductionLabelData | dict[str, Any],
) -> dict[str, Any]:
    label_settings = (
        payload
        if isinstance(payload, LabelSettings)
        else LabelSettings.model_validate(payload)
    )
    host, port, timeout = _printer_target()
    zpl = build_test_zpl(label_settings, production)
    encoded = zpl.encode("utf-8")
    try:
        with socket.create_connection((host, port), timeout=timeout) as connection:
            connection.settimeout(timeout)
            connection.sendall(encoded)
    except OSError as exc:
        raise PrinterConnectionError(
            f"No se pudo enviar la muestra a {host}:{port}: {exc}"
        ) from exc
    return {
        "sent": True,
        "message": f"Etiqueta de prueba enviada a {host}:{port}.",
        "bytes_sent": len(encoded),
        "copies": label_settings.copies,
    }
