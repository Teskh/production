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


_CLR_DARK = "#0f172a"
_CLR_MID = "#475569"
_CLR_LIGHT = "#94a3b8"
_CLR_RULE = "#cbd5e1"
_CLR_ZEBRA = "#f8fafc"
_CLR_GREEN = "#16a34a"
_CLR_BLUE = "#2563eb"


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
    pdf.setStrokeColor(colors.HexColor(_CLR_RULE))
    pdf.setFillColor(colors.white)
    pdf.roundRect(x, y, width, height, 4, stroke=1, fill=1)
    pdf.setFillColor(colors.HexColor(_CLR_MID))
    pdf.setFont("Helvetica", 7)
    pdf.drawString(x + 10, y + height - 14, label.upper())
    pdf.setFillColor(colors.HexColor(_CLR_DARK))
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(x + 10, y + 10, value)


def _hline(pdf: "canvas.Canvas", x1: float, x2: float, y: float) -> None:
    pdf.setStrokeColor(colors.HexColor(_CLR_RULE))
    pdf.setLineWidth(0.5)
    pdf.line(x1, y, x2, y)


def _draw_station_chart(
    pdf: "canvas.Canvas",
    rows: list[StationReportPoint],
    *,
    x: float,
    y: float,
    width: float,
    height: float,
) -> None:
    inner_left = x + 30
    inner_right = x + width - 8
    inner_bottom = y + 20
    inner_top = y + height - 8
    inner_width = max(1.0, inner_right - inner_left)
    inner_height = max(1.0, inner_top - inner_bottom)

    for tick in (0.0, 0.25, 0.5, 0.75, 1.0):
        y_tick = inner_bottom + tick * inner_height
        pdf.setStrokeColor(colors.HexColor("#e2e8f0"))
        pdf.setLineWidth(0.4)
        pdf.line(inner_left, y_tick, inner_right, y_tick)
        pdf.setFillColor(colors.HexColor(_CLR_LIGHT))
        pdf.setFont("Helvetica", 7)
        pdf.drawRightString(inner_left - 4, y_tick - 2, f"{round(tick * 100)}%")

    ordered = sorted(rows, key=lambda row: row.key)
    if not ordered:
        pdf.setFillColor(colors.HexColor(_CLR_LIGHT))
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
        pdf.setLineWidth(1.6)
        for idx in range(1, len(points)):
            x1, y1 = points[idx - 1]
            x2, y2 = points[idx]
            pdf.line(x1, y1, x2, y2)
        pdf.setFillColor(line_color)
        for x_pos, y_pos in points:
            pdf.circle(x_pos, y_pos, 2, stroke=0, fill=1)

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

    draw_series(productive_points, colors.HexColor(_CLR_GREEN))
    draw_series(expected_points, colors.HexColor(_CLR_BLUE))

    label_step = max(1, len(ordered) // 9) if len(ordered) > 12 else 1
    pdf.setFillColor(colors.HexColor(_CLR_MID))
    pdf.setFont("Helvetica", 7)
    for idx, row in enumerate(ordered):
        if idx % label_step != 0 and idx != len(ordered) - 1:
            continue
        label = row.key[8:10] + "/" + row.key[5:7] if len(row.key) >= 10 else row.key
        pdf.drawCentredString(x_at(idx), y + 6, label)


def _draw_station_summary_table(
    pdf: "canvas.Canvas",
    stations: list[StationReportSection],
    *,
    page_width: float,
    page_height: float,
    margin: float,
    start_y: float,
) -> None:
    usable = page_width - margin * 2
    pad = 6
    col_trab = 56
    col_uc = 72
    col_um = 72
    col_station = usable - col_trab - col_uc - col_um
    row_h = 16
    right_edge = margin + usable

    def draw_header(y_pos: float) -> None:
        pdf.setFillColor(colors.HexColor(_CLR_DARK))
        pdf.setFont("Helvetica-Bold", 7.5)
        pdf.drawString(margin + pad, y_pos - 10, "ESTACION")
        pdf.drawRightString(margin + col_station + col_trab - pad, y_pos - 10, "TRAB.")
        pdf.drawRightString(margin + col_station + col_trab + col_uc - pad, y_pos - 10, "USO CORRECTO")
        pdf.drawRightString(right_edge - pad, y_pos - 10, "USO MINIMO")
        _hline(pdf, margin, right_edge, y_pos - row_h + 2)

    y_pos = start_y
    draw_header(y_pos)
    y_pos -= row_h

    for idx, station in enumerate(stations):
        if y_pos < margin + 26:
            pdf.showPage()
            pdf.setFont("Helvetica-Bold", 13)
            pdf.setFillColor(colors.HexColor(_CLR_DARK))
            pdf.drawString(margin, page_height - margin, "Resumen por estacion (continuacion)")
            y_pos = page_height - margin - 24
            draw_header(y_pos)
            y_pos -= row_h

        if idx % 2 == 0:
            pdf.setFillColor(colors.HexColor(_CLR_ZEBRA))
            pdf.rect(margin, y_pos - row_h + 2, usable, row_h, stroke=0, fill=1)

        pdf.setFillColor(colors.HexColor(_CLR_DARK))
        pdf.setFont("Helvetica", 8)
        station_label = _truncate_text(pdf, station.label, col_station - pad * 2, font_size=8)
        pdf.drawString(margin + pad, y_pos - 10, station_label)
        pdf.drawRightString(
            margin + col_station + col_trab - pad,
            y_pos - 10,
            f"{station.workers_with_data}/{station.workers_total}",
        )
        pdf.drawRightString(
            margin + col_station + col_trab + col_uc - pad,
            y_pos - 10,
            _format_percent(station.average_productive),
        )
        pdf.drawRightString(
            right_edge - pad,
            y_pos - 10,
            _format_percent(station.average_expected),
        )
        _hline(pdf, margin, right_edge, y_pos - row_h + 2)
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
        pdf.setFillColor(colors.HexColor(_CLR_LIGHT))
        pdf.setFont("Helvetica", 9)
        pdf.drawString(margin, start_y, "Sin detalle de trabajadores para este rango.")
        return

    usable = page_width - margin * 2
    pad = 6
    col_uc = 80
    col_um = 80
    col_name = usable - col_uc - col_um
    row_h = 15
    right_edge = margin + usable

    def draw_table_header(y_pos: float) -> float:
        pdf.setFillColor(colors.HexColor(_CLR_DARK))
        pdf.setFont("Helvetica-Bold", 7.5)
        pdf.drawString(margin + pad, y_pos - 10, "TRABAJADOR")
        pdf.drawRightString(margin + col_name + col_uc - pad, y_pos - 10, "USO CORRECTO")
        pdf.drawRightString(right_edge - pad, y_pos - 10, "USO MINIMO")
        _hline(pdf, margin, right_edge, y_pos - row_h + 2)
        return y_pos - row_h

    y_pos = draw_table_header(start_y)
    for idx, worker in enumerate(workers):
        if y_pos < margin + 20:
            pdf.showPage()
            pdf.setFillColor(colors.HexColor(_CLR_DARK))
            pdf.setFont("Helvetica-Bold", 13)
            pdf.drawString(
                margin, page_height - margin, f"{station_label} - detalle (cont.)"
            )
            y_pos = draw_table_header(page_height - margin - 20)

        if idx % 2 == 0:
            pdf.setFillColor(colors.HexColor(_CLR_ZEBRA))
            pdf.rect(margin, y_pos - row_h + 2, usable, row_h, stroke=0, fill=1)

        pdf.setFillColor(colors.HexColor(_CLR_DARK))
        pdf.setFont("Helvetica", 8)
        worker_label = _truncate_text(pdf, worker.label, col_name - pad * 2, font_size=8)
        pdf.drawString(margin + pad, y_pos - 10, worker_label)
        pdf.drawRightString(
            margin + col_name + col_uc - pad, y_pos - 10, _format_percent(worker.productive_ratio)
        )
        pdf.drawRightString(
            right_edge - pad, y_pos - 10, _format_percent(worker.expected_ratio)
        )
        _hline(pdf, margin, right_edge, y_pos - row_h + 2)
        y_pos -= row_h


def _build_station_assistance_pdf(payload: StationAssistancePdfRequest) -> bytes:
    if _REPORTLAB_ERROR is not None or canvas is None or A4 is None or mm is None:
        raise RuntimeError("reportlab is not available")

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    page_width, page_height = A4
    margin = 14 * mm
    usable = page_width - margin * 2

    generated = payload.generated_at or datetime.now()
    generated_label = generated.strftime("%Y-%m-%d %H:%M")

    # ── First page: global summary ──
    y = page_height - margin
    pdf.setFillColor(colors.HexColor(_CLR_DARK))
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(margin, y, "Reporte de asistencia y uso del sistema")

    y -= 16
    pdf.setFillColor(colors.HexColor(_CLR_MID))
    pdf.setFont("Helvetica", 8)
    pdf.drawString(
        margin, y,
        f"Generado: {generated_label}   |   Rango: ultimos {payload.report_days} dias "
        f"({payload.from_date} \u2192 {payload.to_date})   |   Estaciones: {len(payload.stations)}",
    )

    # Metric cards
    y -= 58
    gap = 10
    card_w = (usable - gap * 2) / 3
    card_h = 46
    _draw_metric_card(
        pdf, x=margin, y=y, width=card_w, height=card_h,
        label="Uso correcto global", value=_format_percent(payload.global_productive),
    )
    _draw_metric_card(
        pdf, x=margin + card_w + gap, y=y, width=card_w, height=card_h,
        label="Uso minimo global", value=_format_percent(payload.global_expected),
    )
    _draw_metric_card(
        pdf, x=margin + (card_w + gap) * 2, y=y, width=card_w, height=card_h,
        label="Trabajadores", value=str(payload.total_workers),
    )

    # Explanation block
    y -= 52
    pdf.setFillColor(colors.HexColor(_CLR_DARK))
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(margin, y, "Como leer los indicadores")
    y -= 12
    pdf.setFillColor(colors.HexColor(_CLR_MID))
    pdf.setFont("Helvetica", 7.5)
    pdf.drawString(margin + 4, y, "\u2022 Uso correcto: grado de uso correcto del sistema, iniciando/cerrando tareas a tiempo.")
    y -= 11
    pdf.drawString(margin + 4, y, "\u2022 Uso minimo: grado general de uso del sistema.")

    # Summary table
    y -= 18
    _draw_station_summary_table(
        pdf, payload.stations,
        page_width=page_width, page_height=page_height, margin=margin, start_y=y,
    )

    # ── Per-station pages ──
    for station in payload.stations:
        pdf.showPage()
        y = page_height - margin

        station_title = station.label.strip() or "Estacion"
        pdf.setFillColor(colors.HexColor(_CLR_DARK))
        pdf.setFont("Helvetica-Bold", 15)
        pdf.drawString(margin, y, station_title)

        # Large averages
        y -= 36
        pdf.setFont("Helvetica-Bold", 28)
        pdf.setFillColor(colors.HexColor(_CLR_GREEN))
        uc_text = _format_percent(station.average_productive)
        pdf.drawString(margin, y, uc_text)
        uc_w = pdf.stringWidth(uc_text, "Helvetica-Bold", 28)
        pdf.setFillColor(colors.HexColor(_CLR_MID))
        pdf.setFont("Helvetica", 9)
        pdf.drawString(margin + uc_w + 4, y + 2, "Uso Correcto")

        mid_x = margin + usable * 0.35
        pdf.setFont("Helvetica-Bold", 28)
        pdf.setFillColor(colors.HexColor(_CLR_BLUE))
        um_text = _format_percent(station.average_expected)
        pdf.drawString(mid_x, y, um_text)
        um_w = pdf.stringWidth(um_text, "Helvetica-Bold", 28)
        pdf.setFillColor(colors.HexColor(_CLR_MID))
        pdf.setFont("Helvetica", 9)
        pdf.drawString(mid_x + um_w + 4, y + 2, "Uso Minimo")

        # Chart
        y -= 16
        chart_h = 170
        chart_y = y - chart_h
        _draw_station_chart(
            pdf, station.rows,
            x=margin, y=chart_y, width=usable, height=chart_h,
        )

        # Legend
        legend_y = chart_y - 14
        pdf.setFont("Helvetica", 7.5)
        pdf.setFillColor(colors.HexColor(_CLR_MID))
        pdf.setStrokeColor(colors.HexColor(_CLR_GREEN))
        pdf.setLineWidth(2)
        pdf.line(margin, legend_y, margin + 12, legend_y)
        pdf.drawString(margin + 16, legend_y - 3, "Uso Correcto")
        pdf.setStrokeColor(colors.HexColor(_CLR_BLUE))
        pdf.line(margin + 90, legend_y, margin + 102, legend_y)
        pdf.drawString(margin + 106, legend_y - 3, "Uso Minimo")

        # Worker detail table
        if payload.include_workers:
            worker_y = legend_y - 22
            pdf.setFillColor(colors.HexColor(_CLR_DARK))
            pdf.setFont("Helvetica-Bold", 9)
            pdf.drawString(margin, worker_y, "Detalle por trabajador")
            _draw_worker_table(
                pdf, station.workers,
                station_label=station_title,
                page_width=page_width, page_height=page_height,
                margin=margin, start_y=worker_y - 12,
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
