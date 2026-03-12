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
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    _REPORTLAB_ERROR: Exception | None = None
except Exception as exc:  # pragma: no cover - import guard only
    colors = None  # type: ignore[assignment]
    A4 = None  # type: ignore[assignment]
    landscape = None  # type: ignore[assignment]
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
_CLR_ORANGE = "#ea580c"
_NOTE_BLOCK_HEIGHT = 46
_NOTE_TITLE = "Como leer los indicadores"
_NOTE_LINE_1 = "Uso correcto: grado de uso correcto del sistema, iniciando/cerrando tareas a tiempo."
_NOTE_LINE_2 = "Uso minimo: grado general de uso del sistema."
_NOTE_LINE_3 = "Uso adecuado: uso correcto con tope en la jornada diaria esperada del trabajador."
_WORKER_UC_BRACKET_LABELS = ("0-20%", "20-40%", "40-60%", "60+%")


def _selected_indicators(payload: StationAssistancePdfRequest) -> list[dict[str, object]]:
    selected: list[dict[str, object]] = []
    if payload.include_productive:
        selected.append(
            {
                "key": "productive",
                "label": "Uso correcto",
                "field": "productive_ratio",
                "station_field": "average_productive",
                "global_field": "global_productive",
                "color": _CLR_GREEN,
                "note": _NOTE_LINE_1,
            }
        )
    if payload.include_expected:
        selected.append(
            {
                "key": "expected",
                "label": "Uso minimo",
                "field": "expected_ratio",
                "station_field": "average_expected",
                "global_field": "global_expected",
                "color": _CLR_BLUE,
                "note": _NOTE_LINE_2,
            }
        )
    if payload.include_adjusted_productive:
        selected.append(
            {
                "key": "adjusted_productive",
                "label": "Uso adecuado",
                "field": "adjusted_productive_ratio",
                "station_field": "average_adjusted_productive",
                "global_field": "global_adjusted_productive",
                "color": _CLR_ORANGE,
                "note": _NOTE_LINE_3,
            }
        )
    return selected


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


def _resolve_worker_productive_brackets(
    payload: StationAssistancePdfRequest,
) -> tuple[list[tuple[str, int]], int, int]:
    provided = payload.worker_productive_brackets
    if provided is not None:
        rows = [
            (_WORKER_UC_BRACKET_LABELS[0], int(provided.range_0_20)),
            (_WORKER_UC_BRACKET_LABELS[1], int(provided.range_20_40)),
            (_WORKER_UC_BRACKET_LABELS[2], int(provided.range_40_60)),
            (_WORKER_UC_BRACKET_LABELS[3], int(provided.range_60_plus)),
        ]
        scored_workers = int(provided.scored_workers)
        total_workers = int(payload.total_workers) if payload.total_workers > 0 else scored_workers
        return rows, scored_workers, total_workers

    range_0_20 = 0
    range_20_40 = 0
    range_40_60 = 0
    range_60_plus = 0
    scored_workers = 0
    total_workers = 0

    for station in payload.stations:
        for worker in station.workers:
            total_workers += 1
            ratio = _safe_ratio(worker.productive_ratio)
            if ratio is None:
                continue
            scored_workers += 1
            if ratio < 0.2:
                range_0_20 += 1
            elif ratio < 0.4:
                range_20_40 += 1
            elif ratio < 0.6:
                range_40_60 += 1
            else:
                range_60_plus += 1

    if payload.total_workers > total_workers:
        total_workers = payload.total_workers

    rows = [
        (_WORKER_UC_BRACKET_LABELS[0], range_0_20),
        (_WORKER_UC_BRACKET_LABELS[1], range_20_40),
        (_WORKER_UC_BRACKET_LABELS[2], range_40_60),
        (_WORKER_UC_BRACKET_LABELS[3], range_60_plus),
    ]
    return rows, scored_workers, total_workers


def _draw_worker_productive_bracket_summary(
    pdf: "canvas.Canvas",
    *,
    page_width: float,
    margin: float,
    top_y: float,
    bracket_rows: list[tuple[str, int]],
    scored_workers: int,
    total_workers: int,
) -> float:
    if not bracket_rows:
        return top_y

    usable = page_width - margin * 2
    gap = 8
    card_h = 34
    card_w = (usable - gap * (len(bracket_rows) - 1)) / len(bracket_rows)
    card_y = top_y - 14 - card_h

    pdf.setFillColor(colors.HexColor(_CLR_DARK))
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawString(margin, top_y, "Trabajadores por rango de Uso Correcto")

    score_label = f"Con puntaje de Uso Correcto: {scored_workers}"
    if total_workers > 0:
        score_label = f"Con puntaje de Uso Correcto: {scored_workers} de {total_workers}"
    pdf.setFillColor(colors.HexColor(_CLR_MID))
    pdf.setFont("Helvetica", 7.5)
    pdf.drawString(margin, top_y - 10, score_label)

    for idx, (label, count) in enumerate(bracket_rows):
        x = margin + idx * (card_w + gap)
        pdf.setStrokeColor(colors.HexColor(_CLR_RULE))
        pdf.setFillColor(colors.white)
        pdf.roundRect(x, card_y, card_w, card_h, 3, stroke=1, fill=1)

        pdf.setFillColor(colors.HexColor(_CLR_MID))
        pdf.setFont("Helvetica", 7)
        pdf.drawCentredString(x + card_w / 2, card_y + card_h - 10, label)

        pdf.setFillColor(colors.HexColor(_CLR_DARK))
        pdf.setFont("Helvetica-Bold", 14)
        pdf.drawCentredString(x + card_w / 2, card_y + 8, str(count))

    return card_y - 14


def _draw_indicator_note(
    pdf: "canvas.Canvas",
    *,
    margin: float,
    indicator_notes: list[str],
) -> None:
    note_y = margin + 3
    pdf.setFillColor(colors.HexColor(_CLR_DARK))
    pdf.setFont("Helvetica-Bold", 9)
    title_offset = 10 + max(0, len(indicator_notes) - 1) * 9
    pdf.drawString(margin, note_y + title_offset + 8, _NOTE_TITLE)
    pdf.setFillColor(colors.HexColor(_CLR_MID))
    pdf.setFont("Helvetica", 8)
    for index, line in enumerate(indicator_notes):
        y = note_y + (len(indicator_notes) - index - 1) * 9
        pdf.drawString(margin + 4, y, f"- {line}")


def _draw_station_chart(
    pdf: "canvas.Canvas",
    rows: list[StationReportPoint],
    *,
    indicators: list[dict[str, object]],
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

    series_points: dict[str, list[tuple[float, float]]] = {
        str(indicator["key"]): [] for indicator in indicators
    }
    for idx, row in enumerate(ordered):
        x_pos = x_at(idx)
        for indicator in indicators:
            field_name = str(indicator["field"])
            point_y = y_at(getattr(row, field_name))
            if point_y is not None:
                series_points[str(indicator["key"])].append((x_pos, point_y))

    for indicator in indicators:
        draw_series(
            series_points[str(indicator["key"])],
            colors.HexColor(str(indicator["color"])),
        )

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
    indicators: list[dict[str, object]],
    indicator_notes: list[str],
    page_width: float,
    page_height: float,
    margin: float,
    start_y: float,
) -> None:
    usable = page_width - margin * 2
    pad = 6
    metric_col_width = usable * 0.18
    col_station = usable - metric_col_width * len(indicators)
    row_h = 16
    right_edge = margin + usable

    def draw_header(y_pos: float) -> None:
        pdf.setFillColor(colors.HexColor(_CLR_DARK))
        pdf.setFont("Helvetica-Bold", 7.5)
        pdf.drawString(margin + pad, y_pos - 10, "ESTACION")
        indicators_start = margin + col_station
        for index, indicator in enumerate(indicators):
            column_right = indicators_start + metric_col_width * (index + 1)
            pdf.drawRightString(column_right - pad, y_pos - 10, str(indicator["label"]).upper())
        _hline(pdf, margin, right_edge, y_pos - row_h + 2)

    y_pos = start_y
    draw_header(y_pos)
    y_pos -= row_h

    for idx, station in enumerate(stations):
        if y_pos < margin + _NOTE_BLOCK_HEIGHT + 18:
            _draw_indicator_note(pdf, margin=margin, indicator_notes=indicator_notes)
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
        indicators_start = margin + col_station
        for index, indicator in enumerate(indicators):
            station_value = getattr(station, str(indicator["station_field"]))
            column_right = indicators_start + metric_col_width * (index + 1)
            pdf.drawRightString(column_right - pad, y_pos - 10, _format_percent(station_value))
        _hline(pdf, margin, right_edge, y_pos - row_h + 2)
        y_pos -= row_h

    _draw_indicator_note(pdf, margin=margin, indicator_notes=indicator_notes)


def _draw_worker_table(
    pdf: "canvas.Canvas",
    workers: list[WorkerReportMetric],
    *,
    station_label: str,
    indicators: list[dict[str, object]],
    indicator_notes: list[str],
    page_width: float,
    page_height: float,
    margin: float,
    start_y: float,
) -> None:
    if not workers:
        pdf.setFillColor(colors.HexColor(_CLR_LIGHT))
        pdf.setFont("Helvetica", 9)
        pdf.drawString(margin, start_y, "Sin detalle de trabajadores para este rango.")
        _draw_indicator_note(pdf, margin=margin, indicator_notes=indicator_notes)
        return

    usable = page_width - margin * 2
    pad = 6
    metric_col_width = 72
    col_name = usable - metric_col_width * len(indicators)
    row_h = 15
    right_edge = margin + usable

    def draw_table_header(y_pos: float) -> float:
        pdf.setFillColor(colors.HexColor(_CLR_DARK))
        pdf.setFont("Helvetica-Bold", 7.5)
        pdf.drawString(margin + pad, y_pos - 10, "TRABAJADOR")
        indicators_start = margin + col_name
        for index, indicator in enumerate(indicators):
            column_right = indicators_start + metric_col_width * (index + 1)
            pdf.drawRightString(column_right - pad, y_pos - 10, str(indicator["label"]).upper())
        _hline(pdf, margin, right_edge, y_pos - row_h + 2)
        return y_pos - row_h

    y_pos = draw_table_header(start_y)
    for idx, worker in enumerate(workers):
        if y_pos < margin + _NOTE_BLOCK_HEIGHT + 12:
            _draw_indicator_note(pdf, margin=margin, indicator_notes=indicator_notes)
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
        indicators_start = margin + col_name
        for index, indicator in enumerate(indicators):
            worker_value = getattr(worker, str(indicator["field"]))
            column_right = indicators_start + metric_col_width * (index + 1)
            pdf.drawRightString(column_right - pad, y_pos - 10, _format_percent(worker_value))
        _hline(pdf, margin, right_edge, y_pos - row_h + 2)
        y_pos -= row_h

    _draw_indicator_note(pdf, margin=margin, indicator_notes=indicator_notes)


def _build_station_assistance_pdf(payload: StationAssistancePdfRequest) -> bytes:
    if _REPORTLAB_ERROR is not None or canvas is None or A4 is None or mm is None:
        raise RuntimeError("reportlab is not available")
    indicators = _selected_indicators(payload)
    if not indicators:
        raise RuntimeError("No indicators selected")
    indicator_notes = [str(indicator["note"]) for indicator in indicators]

    buffer = BytesIO()
    page_size = landscape(A4)
    pdf = canvas.Canvas(buffer, pagesize=page_size)
    page_width, page_height = page_size
    margin = 14 * mm
    usable = page_width - margin * 2

    generated = payload.generated_at or datetime.now()
    generated_label = generated.strftime("%Y-%m-%d %H:%M")
    document_title = (
        f"Reporte asistencia estaciones {payload.from_date} a {payload.to_date}"
    )
    pdf.setTitle(document_title)
    pdf.setSubject("Reporte de asistencia y uso del sistema por estacion")
    pdf.setCreator("backend/app/api/routes/reports.py")

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
    gap = 14
    card_w = (usable - gap * (len(indicators) - 1)) / len(indicators)
    card_h = 46
    for index, indicator in enumerate(indicators):
        _draw_metric_card(
            pdf,
            x=margin + (card_w + gap) * index,
            y=y,
            width=card_w,
            height=card_h,
            label=f"{indicator['label']} global",
            value=_format_percent(getattr(payload, str(indicator["global_field"]))),
        )

    # Worker bracket summary on first page when worker detail is enabled.
    y -= 16
    if payload.include_workers:
        bracket_rows, scored_workers, total_workers = _resolve_worker_productive_brackets(payload)
        y = _draw_worker_productive_bracket_summary(
            pdf,
            page_width=page_width,
            margin=margin,
            top_y=y,
            bracket_rows=bracket_rows,
            scored_workers=scored_workers,
            total_workers=total_workers,
        )

    # Summary table
    y -= 8
    _draw_station_summary_table(
        pdf, payload.stations,
        indicators=indicators,
        indicator_notes=indicator_notes,
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
        indicator_x_positions = [
            margin + usable * ratio for ratio in (0.0, 0.35, 0.68)
        ]
        for index, indicator in enumerate(indicators):
            x_pos = indicator_x_positions[index] if index < len(indicator_x_positions) else margin + usable * (index / max(1, len(indicators)))
            pdf.setFont("Helvetica-Bold", 28)
            pdf.setFillColor(colors.HexColor(str(indicator["color"])))
            value_text = _format_percent(getattr(station, str(indicator["station_field"])))
            pdf.drawString(x_pos, y, value_text)
            value_width = pdf.stringWidth(value_text, "Helvetica-Bold", 28)
            pdf.setFillColor(colors.HexColor(_CLR_MID))
            pdf.setFont("Helvetica", 9)
            pdf.drawString(x_pos + value_width + 4, y + 2, str(indicator["label"]))

        # Chart
        y -= 16
        chart_h = 170
        chart_y = y - chart_h
        _draw_station_chart(
            pdf, station.rows,
            indicators=indicators,
            x=margin, y=chart_y, width=usable, height=chart_h,
        )

        # Legend
        legend_y = chart_y - 14
        pdf.setFont("Helvetica", 7.5)
        pdf.setFillColor(colors.HexColor(_CLR_MID))
        legend_x = margin
        for indicator in indicators:
            pdf.setStrokeColor(colors.HexColor(str(indicator["color"])))
            pdf.setLineWidth(2)
            pdf.line(legend_x, legend_y, legend_x + 12, legend_y)
            pdf.drawString(legend_x + 16, legend_y - 3, str(indicator["label"]))
            legend_x += 16 + pdf.stringWidth(str(indicator["label"]), "Helvetica", 7.5) + 28

        # Worker detail table
        if payload.include_workers:
            worker_y = legend_y - 22
            pdf.setFillColor(colors.HexColor(_CLR_DARK))
            pdf.setFont("Helvetica-Bold", 9)
            pdf.drawString(margin, worker_y, "Detalle por trabajador")
            _draw_worker_table(
                pdf, station.workers,
                station_label=station_title,
                indicators=indicators,
                indicator_notes=indicator_notes,
                page_width=page_width, page_height=page_height,
                margin=margin, start_y=worker_y - 12,
            )
        else:
            _draw_indicator_note(pdf, margin=margin, indicator_notes=indicator_notes)

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
    if not (payload.include_productive or payload.include_expected or payload.include_adjusted_productive):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one indicator must be selected.",
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
