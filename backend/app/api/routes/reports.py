from __future__ import annotations

from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response

from app.api.deps import get_current_admin
from app.models.admin import AdminUser
from app.schemas.reports import (
    StationAssistancePdfRequest,
    StationReportPoint,
    StationReportSection,
    WorkerReportMetric,
)

router = APIRouter()


try:  # pragma: no cover - import guard only
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    _REPORTLAB_ERROR: Exception | None = None
except Exception as exc:  # pragma: no cover - import guard only
    colors = None  # type: ignore[assignment]
    A4 = None  # type: ignore[assignment]
    mm = None  # type: ignore[assignment]
    canvas = None  # type: ignore[assignment]
    _REPORTLAB_ERROR = exc


def _format_percent(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{round(value * 100)}%"


def _safe_ratio(value: float | None) -> float | None:
    if value is None:
        return None
    return max(0.0, min(1.0, float(value)))


def _truncate_text(
    pdf: "canvas.Canvas",
    text: str,
    max_width: float,
    *,
    font_name: str = "Helvetica",
    font_size: int = 9,
) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""
    if pdf.stringWidth(raw, font_name, font_size) <= max_width:
        return raw
    ellipsis = "..."
    allowed = raw
    while allowed and pdf.stringWidth(allowed + ellipsis, font_name, font_size) > max_width:
        allowed = allowed[:-1]
    return (allowed + ellipsis) if allowed else ellipsis


def _draw_metric_card(
    pdf: "canvas.Canvas",
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    label: str,
    value: str,
) -> None:
    pdf.setFillColor(colors.HexColor("#f8fafc"))
    pdf.setStrokeColor(colors.HexColor("#d6dce5"))
    pdf.roundRect(x, y, width, height, 6, stroke=1, fill=1)
    pdf.setFillColor(colors.HexColor("#475569"))
    pdf.setFont("Helvetica", 8)
    pdf.drawString(x + 8, y + height - 14, label.upper())
    pdf.setFillColor(colors.HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(x + 8, y + 12, value)


def _draw_station_chart(
    pdf: "canvas.Canvas",
    rows: list[StationReportPoint],
    *,
    x: float,
    y: float,
    width: float,
    height: float,
) -> None:
    inner_left = x + 36
    inner_right = x + width - 12
    inner_bottom = y + 22
    inner_top = y + height - 20
    inner_width = max(1.0, inner_right - inner_left)
    inner_height = max(1.0, inner_top - inner_bottom)

    pdf.setFillColor(colors.HexColor("#f8fafc"))
    pdf.setStrokeColor(colors.HexColor("#d6dce5"))
    pdf.roundRect(x, y, width, height, 6, stroke=1, fill=1)

    for tick in (0.0, 0.5, 1.0):
        y_tick = inner_bottom + tick * inner_height
        pdf.setStrokeColor(colors.HexColor("#e8edf5"))
        pdf.line(inner_left, y_tick, inner_right, y_tick)
        pdf.setFillColor(colors.HexColor("#4b5d73"))
        pdf.setFont("Helvetica", 8)
        pdf.drawRightString(inner_left - 4, y_tick - 2, f"{round(tick * 100)}%")

    ordered = sorted(rows, key=lambda row: row.key)
    if not ordered:
        pdf.setFillColor(colors.HexColor("#64748b"))
        pdf.setFont("Helvetica", 9)
        pdf.drawString(inner_left, inner_bottom + inner_height / 2, "Sin datos suficientes para graficar.")
        return

    step = inner_width / (len(ordered) - 1) if len(ordered) > 1 else 0.0

    def x_at(index: int) -> float:
        if len(ordered) > 1:
            return inner_left + step * index
        return inner_left + inner_width / 2

    def y_at(ratio: float | None) -> float | None:
        safe = _safe_ratio(ratio)
        if safe is None:
            return None
        return inner_bottom + safe * inner_height

    def draw_series(points: list[tuple[float, float]], line_color) -> None:
        if not points:
            return
        pdf.setStrokeColor(line_color)
        pdf.setLineWidth(1.8)
        for idx in range(1, len(points)):
            x1, y1 = points[idx - 1]
            x2, y2 = points[idx]
            pdf.line(x1, y1, x2, y2)
        pdf.setFillColor(line_color)
        for x_pos, y_pos in points:
            pdf.circle(x_pos, y_pos, 2.2, stroke=0, fill=1)

    productive_points = []
    expected_points = []
    for idx, row in enumerate(ordered):
        x_pos = x_at(idx)
        prod_y = y_at(row.productive_ratio)
        exp_y = y_at(row.expected_ratio)
        if prod_y is not None:
            productive_points.append((x_pos, prod_y))
        if exp_y is not None:
            expected_points.append((x_pos, exp_y))

    draw_series(productive_points, colors.HexColor("#16a34a"))
    draw_series(expected_points, colors.HexColor("#2563eb"))

    label_step = max(1, len(ordered) // 9) if len(ordered) > 12 else 1
    pdf.setFillColor(colors.HexColor("#4b5d73"))
    pdf.setFont("Helvetica", 8)
    for idx, row in enumerate(ordered):
        if idx % label_step != 0 and idx != len(ordered) - 1:
            continue
        label = row.key[8:10] + "/" + row.key[5:7] if len(row.key) >= 10 else row.key
        pdf.drawCentredString(x_at(idx), y + 8, label)


def _draw_station_summary_table(
    pdf: "canvas.Canvas",
    stations: list[StationReportSection],
    *,
    page_width: float,
    page_height: float,
    margin: float,
    start_y: float,
) -> None:
    col_station = 280
    col_workers = 78
    col_prod = 72
    col_exp = 72
    row_h = 15

    def draw_header(y_pos: float) -> None:
        pdf.setFillColor(colors.HexColor("#f1f5f9"))
        pdf.setStrokeColor(colors.HexColor("#d6dce5"))
        pdf.rect(margin, y_pos - row_h + 2, page_width - margin * 2, row_h, stroke=1, fill=1)
        pdf.setFillColor(colors.HexColor("#475569"))
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawString(margin + 5, y_pos - 9, "ESTACION")
        pdf.drawRightString(margin + col_station + col_workers - 6, y_pos - 9, "TRAB.")
        pdf.drawRightString(
            margin + col_station + col_workers + col_prod - 6, y_pos - 9, "PRODUCTIVO"
        )
        pdf.drawRightString(
            margin + col_station + col_workers + col_prod + col_exp - 6, y_pos - 9, "COBERTURA"
        )

    y_pos = start_y
    draw_header(y_pos)
    y_pos -= row_h

    for idx, station in enumerate(stations):
        if y_pos < margin + 26:
            pdf.showPage()
            pdf.setFont("Helvetica-Bold", 14)
            pdf.setFillColor(colors.HexColor("#0f172a"))
            pdf.drawString(margin, page_height - margin, "Resumen por estacion (continuacion)")
            y_pos = page_height - margin - 24
            draw_header(y_pos)
            y_pos -= row_h

        if idx % 2 == 0:
            pdf.setFillColor(colors.HexColor("#f8fafc"))
            pdf.setStrokeColor(colors.HexColor("#f1f5f9"))
            pdf.rect(margin, y_pos - row_h + 2, page_width - margin * 2, row_h, stroke=0, fill=1)

        pdf.setFillColor(colors.HexColor("#0f172a"))
        pdf.setFont("Helvetica", 8)
        station_label = _truncate_text(pdf, station.label, col_station - 10, font_size=8)
        pdf.drawString(margin + 5, y_pos - 9, station_label)
        pdf.drawRightString(
            margin + col_station + col_workers - 6,
            y_pos - 9,
            f"{station.workers_with_data}/{station.workers_total}",
        )
        pdf.drawRightString(
            margin + col_station + col_workers + col_prod - 6,
            y_pos - 9,
            _format_percent(station.average_productive),
        )
        pdf.drawRightString(
            margin + col_station + col_workers + col_prod + col_exp - 6,
            y_pos - 9,
            _format_percent(station.average_expected),
        )
        y_pos -= row_h


def _draw_worker_table(
    pdf: "canvas.Canvas",
    workers: list[WorkerReportMetric],
    *,
    station_label: str,
    page_width: float,
    page_height: float,
    margin: float,
    start_y: float,
) -> None:
    if not workers:
        pdf.setFillColor(colors.HexColor("#64748b"))
        pdf.setFont("Helvetica", 9)
        pdf.drawString(margin, start_y, "Sin detalle de trabajadores para este rango.")
        return

    col_name = 270
    col_prod = 74
    col_exp = 74
    col_days = 70
    row_h = 14

    def draw_table_header(y_pos: float) -> float:
        pdf.setFillColor(colors.HexColor("#f1f5f9"))
        pdf.setStrokeColor(colors.HexColor("#d6dce5"))
        pdf.rect(margin, y_pos - row_h + 2, page_width - margin * 2, row_h, stroke=1, fill=1)
        pdf.setFillColor(colors.HexColor("#475569"))
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawString(margin + 5, y_pos - 9, "TRABAJADOR")
        pdf.drawRightString(margin + col_name + col_prod - 6, y_pos - 9, "PRODUCTIVO")
        pdf.drawRightString(margin + col_name + col_prod + col_exp - 6, y_pos - 9, "COBERTURA")
        pdf.drawRightString(
            margin + col_name + col_prod + col_exp + col_days - 6, y_pos - 9, "DIAS"
        )
        return y_pos - row_h

    y_pos = draw_table_header(start_y)
    for idx, worker in enumerate(workers):
        if y_pos < margin + 20:
            pdf.showPage()
            pdf.setFillColor(colors.HexColor("#0f172a"))
            pdf.setFont("Helvetica-Bold", 13)
            pdf.drawString(
                margin, page_height - margin, f"{station_label} - detalle por trabajador (cont.)"
            )
            y_pos = draw_table_header(page_height - margin - 20)

        if idx % 2 == 0:
            pdf.setFillColor(colors.HexColor("#f8fafc"))
            pdf.setStrokeColor(colors.HexColor("#f1f5f9"))
            pdf.rect(margin, y_pos - row_h + 2, page_width - margin * 2, row_h, stroke=0, fill=1)

        pdf.setFillColor(colors.HexColor("#0f172a"))
        pdf.setFont("Helvetica", 8)
        worker_label = _truncate_text(pdf, worker.label, col_name - 10, font_size=8)
        pdf.drawString(margin + 5, y_pos - 9, worker_label)
        pdf.drawRightString(
            margin + col_name + col_prod - 6, y_pos - 9, _format_percent(worker.productive_ratio)
        )
        pdf.drawRightString(
            margin + col_name + col_prod + col_exp - 6, y_pos - 9, _format_percent(worker.expected_ratio)
        )
        pdf.drawRightString(
            margin + col_name + col_prod + col_exp + col_days - 6,
            y_pos - 9,
            f"{worker.days_with_data}/{worker.days_total}",
        )
        y_pos -= row_h


def _build_station_assistance_pdf(payload: StationAssistancePdfRequest) -> bytes:
    if _REPORTLAB_ERROR is not None or canvas is None or A4 is None or mm is None:
        raise RuntimeError("reportlab is not available")

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    page_width, page_height = A4
    margin = 16 * mm

    generated = payload.generated_at or datetime.now()
    generated_label = generated.strftime("%Y-%m-%d %H:%M")

    # First page: global summary.
    title_y = page_height - margin
    pdf.setFillColor(colors.HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(margin, title_y, "Reporte de asistencia y uso del sistema")
    pdf.setFillColor(colors.HexColor("#475569"))
    pdf.setFont("Helvetica", 9)
    pdf.drawString(
        margin,
        title_y - 14,
        (
            f"Generado: {generated_label}  |  Rango: ultimos {payload.report_days} dias "
            f"({payload.from_date} -> {payload.to_date})  |  Estaciones: {len(payload.stations)}"
        ),
    )

    card_y = title_y - 80
    card_w = (page_width - margin * 2 - 16) / 3
    card_h = 52
    _draw_metric_card(
        pdf,
        x=margin,
        y=card_y,
        width=card_w,
        height=card_h,
        label="Productivo global",
        value=_format_percent(payload.global_productive),
    )
    _draw_metric_card(
        pdf,
        x=margin + card_w + 8,
        y=card_y,
        width=card_w,
        height=card_h,
        label="Cobertura global",
        value=_format_percent(payload.global_expected),
    )
    _draw_metric_card(
        pdf,
        x=margin + (card_w + 8) * 2,
        y=card_y,
        width=card_w,
        height=card_h,
        label="Trabajadores",
        value=str(payload.total_workers),
    )

    notes_y = card_y - 84
    notes_h = 60
    pdf.setFillColor(colors.white)
    pdf.setStrokeColor(colors.HexColor("#d6dce5"))
    pdf.roundRect(margin, notes_y, page_width - margin * 2, notes_h, 6, stroke=1, fill=1)
    pdf.setFillColor(colors.HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(margin + 8, notes_y + notes_h - 14, "Como leer los indicadores")
    pdf.setFillColor(colors.HexColor("#475569"))
    pdf.setFont("Helvetica", 8)
    pdf.drawString(
        margin + 8,
        notes_y + notes_h - 28,
        "• Tiempo productivo: grado de uso correcto del sistema, iniciando/cerrando tareas a tiempo.",
    )
    pdf.drawString(
        margin + 8,
        notes_y + notes_h - 42,
        "• Cobertura esperada: grado general de uso del sistema",
    )

    _draw_station_summary_table(
        pdf,
        payload.stations,
        page_width=page_width,
        page_height=page_height,
        margin=margin,
        start_y=notes_y - 16,
    )

    # One page per station.
    for station in payload.stations:
        pdf.showPage()
        station_title = station.label.strip() or "Estacion"
        pdf.setFillColor(colors.HexColor("#0f172a"))
        pdf.setFont("Helvetica-Bold", 16)
        pdf.drawString(margin, page_height - margin, station_title)
        pdf.setFillColor(colors.HexColor("#475569"))
        pdf.setFont("Helvetica", 9)
        pdf.drawString(
            margin,
            page_height - margin - 14,
            (
                f"Trabajadores con datos: {station.workers_with_data}/{station.workers_total}  |  "
                f"Productivo: {_format_percent(station.average_productive)}  |  "
                f"Cobertura: {_format_percent(station.average_expected)}"
            ),
        )

        chart_y = page_height - margin - 250
        _draw_station_chart(
            pdf,
            station.rows,
            x=margin,
            y=chart_y,
            width=page_width - margin * 2,
            height=190,
        )
        legend_y = chart_y - 12
        pdf.setFont("Helvetica", 8)
        pdf.setFillColor(colors.HexColor("#475569"))
        pdf.setStrokeColor(colors.HexColor("#16a34a"))
        pdf.setLineWidth(2)
        pdf.line(margin, legend_y, margin + 12, legend_y)
        pdf.drawString(margin + 16, legend_y - 3, "Productivo")
        pdf.setStrokeColor(colors.HexColor("#2563eb"))
        pdf.line(margin + 88, legend_y, margin + 100, legend_y)
        pdf.drawString(margin + 104, legend_y - 3, "Cobertura esperada")

        if payload.include_workers:
            worker_title_y = legend_y - 22
            pdf.setFillColor(colors.HexColor("#0f172a"))
            pdf.setFont("Helvetica-Bold", 10)
            pdf.drawString(margin, worker_title_y, "Detalle por trabajador")
            _draw_worker_table(
                pdf,
                station.workers,
                station_label=station_title,
                page_width=page_width,
                page_height=page_height,
                margin=margin,
                start_y=worker_title_y - 10,
            )

    pdf.save()
    buffer.seek(0)
    return buffer.getvalue()


@router.post("/station-assistance-pdf")
def generate_station_assistance_pdf(
    payload: StationAssistancePdfRequest,
    _admin: AdminUser = Depends(get_current_admin),
) -> Response:
    if not payload.stations:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one station is required.",
        )
    try:
        pdf_bytes = _build_station_assistance_pdf(payload)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"PDF engine unavailable: {exc}",
        ) from exc

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"reporte_asistencia_estaciones_{stamp}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
