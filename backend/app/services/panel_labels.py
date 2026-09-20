"""Panel label data and a shared layout for browser previews and Zebra output."""
from datetime import datetime
from html import escape
import re
import textwrap
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.house import HouseSubType, HouseType, PanelDefinition
from app.models.work import WorkOrder, WorkUnit
from app.schemas.panel_labels import PanelLabelData, PanelLabelInput, PanelLabelPreview
from app.services import label_printer


def load_preview(db: Session, payload: PanelLabelInput) -> PanelLabelPreview:
    unit = db.get(WorkUnit, payload.work_unit_id)
    panel = db.get(PanelDefinition, payload.panel_definition_id)
    order = db.get(WorkOrder, unit.work_order_id) if unit else None
    if not unit or not panel or not order:
        raise HTTPException(404, "Panel o módulo no encontrado.")
    if (panel.house_type_id != order.house_type_id
            or panel.module_sequence_number != unit.module_number
            or panel.sub_type_id not in (None, order.sub_type_id)):
        raise HTTPException(409, "El panel no pertenece al módulo seleccionado.")
    house = db.get(HouseType, order.house_type_id)
    subtype = db.get(HouseSubType, order.sub_type_id) if order.sub_type_id else None
    model = house.name.strip() if house else ""
    if subtype:
        # Some catalogues name the model in the subtype, e.g. THS A.
        model = subtype.name.strip() if subtype.name.strip().startswith(model) or model == "Padre Hurtado" else f"{model}-{subtype.name.strip()}"
    sources = {
        "description": "Código de panel del catálogo. Puede reemplazarse por el código del plano.",
        "model": "Modelo y subtipo de la orden de trabajo.",
        "project": "Proyecto de la orden de trabajo.",
        "module": "Número de módulo de producción.",
        "label_date": "Fecha de impresión en Chile.",
        "correlativo": f"Sin correspondencia confirmada. Casa: {order.house_identifier or 'sin identificador'}.",
        "area": "Área del panel registrada en el catálogo, en m².",
    }
    area_value = payload.area if payload.area is not None else panel.panel_area
    area = f"{area_value:.2f}" if area_value is not None and area_value > 0 else ""
    if not area:
        sources["area"] = "El catálogo no tiene un área válida. Ingresa el área del plano en m²."
    house_number = re.search(r"(\d+)\s*$", order.house_identifier or "")
    correlativo = house_number.group(1) if house_number else ""
    if correlativo:
        sources["correlativo"] = f"Número de casa: {order.house_identifier}."
    data = PanelLabelData(
        description=payload.description or panel.panel_code.strip(),
        model=payload.model or model,
        project=order.project_name.strip(),
        module=unit.module_number,
        area=area,
        label_date=payload.label_date or datetime.now(ZoneInfo("America/Santiago")).date(),
        correlativo=payload.correlativo or correlativo,
    )
    for key in ("description", "model", "area", "correlativo"):
        if getattr(payload, key) is not None:
            sources[key] = "Ingresado para esta impresión."
    missing = [key for key in ("description", "model", "project", "area", "correlativo") if not getattr(data, key)]
    return PanelLabelPreview(target=payload, data=data, missing_fields=missing, sources=sources, svg=render_svg(data))


def layout(data: PanelLabelData) -> list[tuple[int, int, int, str]]:
    """Landscape x/y/font/text, in printer dots; shared by SVG and ZPL."""
    rows: list[tuple[int, int, int, str]] = []
    def text(x: int, y: int, value: str, width: int, preferred: int = 48, max_lines: int = 1):
        value = " ".join(value.split())
        # Fit the available lines before shrinking long names.
        for size in range(preferred, 19, -1):
            lines = textwrap.wrap(value, width=max(1, int(width / (size * .68))))
            if len(lines) <= max_lines:
                break
        for index, line in enumerate(lines):
            rows.append((x, y + index * (size + 4), size, line))
    text(80, 70, "Proyecto", 1400, 30)
    project_heading = f"{data.project or 'Pendiente'}  #{data.correlativo or 'Pendiente'}"
    text(80, 125, project_heading, 1440, 100)
    for x, width, caption, value, size in [
        (80, 480, "Panel", data.description, 154),
        (610, 520, "Modelo", data.model, 112),
        (1210, 300, "Módulo", f"MD{data.module}", 144),
    ]:
        text(x, 320, caption, width, 32)
        text(x, 395, value or "Pendiente", width, size, max_lines=2 if caption == "Modelo" else 1)
    for x, caption, value in [
        (80, "Área", f"{data.area} m²" if data.area else "Pendiente"),
        (1210, "Fecha", data.label_date.strftime("%d/%m/%Y")),
    ]:
        text(x, 668, caption, 350, 24)
        text(x, 705, value, 350, 36)
    return rows


def rules() -> list[tuple[int, int, int, int]]:
    """Landscape rectangles, shared by the preview and printer."""
    return [
        (40, 28, 1538, 4), (40, 763, 1538, 4),
        (40, 28, 4, 739), (1574, 28, 4, 739),
        (40, 270, 1538, 4),
        (1170, 270, 3, 370),
        (40, 640, 1538, 4),
    ]


def render_svg(data: PanelLabelData) -> str:
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1618 799" role="img" aria-label="Etiqueta de panel">', '<rect width="1618" height="799" fill="white"/>']
    for x, y, width, height in rules():
        parts.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" fill="black"/>')
    for x, y, size, value in layout(data):
        parts.append(f'<text x="{x}" y="{y + size * .8}" font-family="Arial, sans-serif" font-weight="700" font-size="{size}" fill="black">{escape(value)}</text>')
    return "".join(parts) + "</svg>"


def build_zpl(data: PanelLabelData, copies: int = 1) -> str:
    if not 1 <= copies <= 10:
        raise ValueError("Copies must be between 1 and 10")
    commands = ["^XA", "^CI28", "^PW799", "^LL1618", "^LH0,0", "^LS0", "^LT0"]
    for x, y, width, height in rules():
        commands.append(f"^FO{799-y-height},{x}^GB{height},{width},{min(width, height)}^FS")
    for x, y, size, value in layout(data):
        # Hex-encode UTF-8 bytes so data cannot become ZPL commands.
        encoded = "".join(f"_{byte:02X}" for byte in value.encode("utf-8"))
        commands.append(f"^FO{799-y-size},{x}^A0R,{size},{size}^FH_^FD{encoded}^FS")
    return "\n".join([*commands, f"^PQ{copies},0,1,N", "^XZ"])


def print_label(preview: PanelLabelPreview, copies: int) -> dict:
    if preview.missing_fields:
        raise HTTPException(422, "Completa los campos pendientes antes de imprimir.")
    return label_printer.send_zpl(build_zpl(preview.data, copies), copies)
