import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Factory,
  RefreshCcw,
  Users,
  X,
} from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type DashboardMode = 'panel' | 'module';

type StationOption = {
  id: number;
  name: string;
  role: string;
  line_type: string | null;
  sequence_order: number | null;
};

type PanelStationAttendancePoint = {
  station_id: number;
  station_name: string;
  attendance: number | null;
  attendance_share: number | null;
};

type PanelAttendanceThroughputDay = {
  date: string;
  production_panels: number;
  line_attendance: number;
  throughput_per_attended_worker: number | null;
  cache_rows: number;
  cache_expected_rows: number;
  station_attendance: PanelStationAttendancePoint[];
};

type PanelAttendanceThroughputResponse = {
  mode: 'panel';
  requested_from_date: string;
  requested_to_date: string;
  effective_to_date: string;
  production_station_id: number;
  production_station_name: string;
  compared_station_ids: number[];
  min_total_line_attendance: number;
  dropped_incomplete_days: number;
  dropped_low_attendance_days: number;
  available_stations: StationOption[];
  rows: PanelAttendanceThroughputDay[];
};

type ModuleStationMetricPoint = {
  station_id: number;
  station_name: string;
  line_type: string | null;
  sequence_order: number;
  attendance: number | null;
  move_count: number;
  avg_active_move_hours: number | null;
  movements_per_workday: number | null;
};

type ModuleAttendanceThroughputDay = {
  date: string;
  line_attendance: number;
  line_avg_active_move_hours: number | null;
  line_movements_per_workday: number | null;
  throughput_per_attended_worker: number | null;
  cache_rows: number;
  cache_expected_rows: number;
  station_metrics: ModuleStationMetricPoint[];
};

type ModuleAttendanceThroughputResponse = {
  mode: 'module';
  requested_from_date: string;
  requested_to_date: string;
  effective_to_date: string;
  line_type: string | null;
  selected_station_ids: number[];
  min_total_line_attendance: number;
  min_moves_per_station_day: number;
  workday_hours: number;
  first_station_entry_task_definition_id: number;
  movement_history_lookback_days: number;
  dropped_incomplete_days: number;
  dropped_low_attendance_days: number;
  dropped_no_movement_days: number;
  available_stations: StationOption[];
  rows: ModuleAttendanceThroughputDay[];
};

type LineSeries = {
  id: string;
  name: string;
  axis: 'left' | 'right';
  color: string;
  values: Array<number | null | undefined>;
  width?: number;
  initiallyVisible?: boolean;
  onPointClick?: (point: TrendPointClick) => void;
};

type TrendPointClick = {
  seriesId: string;
  seriesName: string;
  axis: 'left' | 'right';
  date: string;
  value: number;
  index: number;
};

type ChartViewMode = 'line' | 'scatter';

type RegressionStats = {
  n: number;
  slope: number;
  intercept: number;
  correlation: number;
  rSquared: number;
  rmse: number;
};

type SequenceTrend = {
  sequenceOrder: number;
  sequenceName: string;
  lineTypes: string[];
  stationIds: number[];
  stationCount: number;
  dates: string[];
  movementsPerWorkday: Array<number | null>;
  attendance: Array<number | null>;
};

type StationTrend = {
  stationId: number;
  stationName: string;
  lineType: string | null;
  sequenceOrder: number;
  dates: string[];
  movementsPerWorkday: Array<number | null>;
  attendance: Array<number | null>;
};

type ModuleMovementDayStationSummary = {
  station_id: number;
  station_name: string;
  line_type: string | null;
  sequence_order: number;
  attendance: number | null;
  move_count: number;
  avg_active_move_hours: number | null;
  movements_per_workday: number | null;
  total_active_minutes: number;
  qualifies_for_average: boolean;
};

type ModuleMovementIntervalDetail = {
  station_id: number;
  station_name: string;
  line_type: string | null;
  sequence_order: number;
  project_name: string | null;
  house_identifier: string | null;
  tramo_start_task_name: string;
  tramo_start_task_started_at: string;
  tramo_end_task_name: string;
  tramo_end_task_started_at: string;
  interval_start_at: string;
  interval_end_at: string;
  elapsed_minutes: number;
  active_minutes: number;
};

type ModuleMovementDayDetailResponse = {
  mode: 'module-detail';
  date: string;
  line_type: string | null;
  sequence_order: number | null;
  station_id: number | null;
  selected_station_ids: number[];
  selected_sequence_orders: number[];
  min_total_line_attendance: number;
  min_moves_per_station_day: number;
  workday_hours: number;
  first_station_entry_task_definition_id: number;
  movement_history_lookback_days: number;
  cache_rows: number;
  cache_expected_rows: number;
  cache_complete: boolean;
  line_attendance: number | null;
  line_avg_active_move_hours: number | null;
  line_movements_per_workday: number | null;
  throughput_per_attended_worker: number | null;
  station_summaries: ModuleMovementDayStationSummary[];
  movement_intervals: ModuleMovementIntervalDetail[];
};

const LINE_COLORS = [
  '#2563eb',
  '#0f766e',
  '#7c3aed',
  '#c2410c',
  '#be123c',
  '#1d4ed8',
  '#15803d',
  '#6d28d9',
  '#b45309',
  '#334155',
];

const pad = (value: number) => String(value).padStart(2, '0');

const todayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const yesterdayStr = () => {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const isoDaysAgo = (days: number) => {
  const now = new Date();
  now.setDate(now.getDate() - days);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const clampDateToYesterday = (value: string) => {
  if (!value) return yesterdayStr();
  if (value >= todayStr()) return yesterdayStr();
  return value;
};

const normalizeDateRange = (fromDate: string, toDate: string) => {
  const safeFrom = fromDate || isoDaysAgo(30);
  const safeTo = clampDateToYesterday(toDate || yesterdayStr());
  if (safeFrom <= safeTo) return { from: safeFrom, to: safeTo };
  return { from: safeTo, to: safeFrom };
};

const buildHeaders = (options: RequestInit): Headers => {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
};

const apiRequest = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: buildHeaders(options),
    credentials: 'include',
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Solicitud fallida (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

const formatDateLabel = (value: string) => {
  if (!value) return '-';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
};

const formatShortDate = (value: string) => {
  if (!value) return '-';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatTramoDateTimeLabel = (value: string) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const currentYear = new Date().getFullYear();
  const datePart =
    parsed.getFullYear() === currentYear
      ? `${pad(parsed.getMonth() + 1)}/${pad(parsed.getDate())}`
      : `${parsed.getFullYear()}/${pad(parsed.getMonth() + 1)}/${pad(parsed.getDate())}`;
  const timePart = `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  return `${datePart} ${timePart}`;
};

const formatNum = (value: number | null | undefined, digits = 2) => {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toFixed(digits);
};

const formatLineTypeLabel = (value: string | null | undefined) => {
  if (!value) return 'Sin linea';
  return `Linea ${value}`;
};

const withAxisPadding = (maxValue: number) => {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 1;
  const headroom = Math.max(maxValue * 0.08, 0.5);
  return maxValue + headroom;
};

const withDomainPadding = (values: number[]) => {
  if (values.length === 0) {
    return { min: 0, max: 1 };
  }
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return { min: 0, max: 1 };
  }

  if (minValue === maxValue) {
    const pad = Math.max(Math.abs(minValue) * 0.08, 0.5);
    const min = Math.max(0, minValue - pad);
    const max = maxValue + pad;
    if (max <= min) return { min: 0, max: 1 };
    return { min, max };
  }

  const span = maxValue - minValue;
  const pad = Math.max(span * 0.08, 0.5);
  const min = Math.max(0, minValue - pad);
  const max = maxValue + pad;
  if (max <= min) return { min: 0, max: 1 };
  return { min, max };
};

const computeLinearRegression = (points: Array<{ x: number; y: number }>): RegressionStats | null => {
  if (points.length < 2) return null;

  const n = points.length;
  const sumX = points.reduce((acc, point) => acc + point.x, 0);
  const sumY = points.reduce((acc, point) => acc + point.y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  points.forEach((point) => {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  });

  if (!Number.isFinite(sxx) || sxx <= 0) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  const denominator = Math.sqrt(Math.max(sxx * syy, 0));
  const rawCorrelation = denominator > 0 ? sxy / denominator : 0;
  const correlation = Math.max(-1, Math.min(1, rawCorrelation));
  const rSquared = correlation * correlation;

  const mse =
    points.reduce((acc, point) => {
      const estimate = slope * point.x + intercept;
      const residual = point.y - estimate;
      return acc + residual * residual;
    }, 0) / n;

  return {
    n,
    slope,
    intercept,
    correlation,
    rSquared,
    rmse: Math.sqrt(Math.max(0, mse)),
  };
};

const buildRegressionSegment = ({
  slope,
  intercept,
  xMin,
  xMax,
  yMin,
  yMax,
}: {
  slope: number;
  intercept: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}) => {
  const epsilon = 1e-9;
  const isWithin = (value: number, min: number, max: number) =>
    value >= min - epsilon && value <= max + epsilon;

  const candidates: Array<{ x: number; y: number }> = [];

  const atXMin = slope * xMin + intercept;
  if (Number.isFinite(atXMin) && isWithin(atXMin, yMin, yMax)) {
    candidates.push({ x: xMin, y: atXMin });
  }

  const atXMax = slope * xMax + intercept;
  if (Number.isFinite(atXMax) && isWithin(atXMax, yMin, yMax)) {
    candidates.push({ x: xMax, y: atXMax });
  }

  if (Math.abs(slope) > epsilon) {
    const atYMin = (yMin - intercept) / slope;
    if (Number.isFinite(atYMin) && isWithin(atYMin, xMin, xMax)) {
      candidates.push({ x: atYMin, y: yMin });
    }

    const atYMax = (yMax - intercept) / slope;
    if (Number.isFinite(atYMax) && isWithin(atYMax, xMin, xMax)) {
      candidates.push({ x: atYMax, y: yMax });
    }
  }

  const unique: Array<{ x: number; y: number }> = [];
  candidates.forEach((candidate) => {
    const duplicate = unique.some(
      (point) => Math.abs(point.x - candidate.x) < 1e-6 && Math.abs(point.y - candidate.y) < 1e-6
    );
    if (!duplicate) {
      unique.push(candidate);
    }
  });

  if (unique.length < 2) return null;

  let bestA = unique[0];
  let bestB = unique[1];
  let bestDistance = -1;

  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      const dx = unique[i].x - unique[j].x;
      const dy = unique[i].y - unique[j].y;
      const distance = dx * dx + dy * dy;
      if (distance > bestDistance) {
        bestDistance = distance;
        bestA = unique[i];
        bestB = unique[j];
      }
    }
  }

  return { a: bestA, b: bestB };
};

const average = (values: Array<number | null | undefined>) => {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((acc, value) => acc + value, 0) / filtered.length;
};

const toFiniteOrNull = (value: number | null | undefined): number | null => {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
};

const buildLineSegments = (values: Array<number | null | undefined>) => {
  const segments: Array<Array<{ index: number; value: number }>> = [];
  let current: Array<{ index: number; value: number }> = [];

  values.forEach((value, index) => {
    const finite = toFiniteOrNull(value);
    if (finite == null) {
      if (current.length > 0) {
        segments.push(current);
      }
      current = [];
      return;
    }
    current.push({ index, value: finite });
  });

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
};

const normalizeVisibility = (series: LineSeries[], previous: Record<string, boolean>) => {
  const next: Record<string, boolean> = {};
  series.forEach((entry) => {
    if (Object.prototype.hasOwnProperty.call(previous, entry.id)) {
      next[entry.id] = previous[entry.id];
    } else {
      next[entry.id] = entry.initiallyVisible ?? true;
    }
  });
  return next;
};

const DualAxisTrendChart: React.FC<{
  title: string;
  subtitle: string;
  dates: string[];
  leftAxisLabel: string;
  rightAxisLabel: string;
  series: LineSeries[];
}> = ({ title, subtitle, dates, leftAxisLabel, rightAxisLabel, series }) => {
  const [viewMode, setViewMode] = useState<ChartViewMode>('line');
  const [visibleBySeries, setVisibleBySeries] = useState<Record<string, boolean>>(() =>
    normalizeVisibility(series, {})
  );
  const [scatterLagByPair, setScatterLagByPair] = useState<Record<string, 0 | 1>>({});

  useEffect(() => {
    setVisibleBySeries((previous) => normalizeVisibility(series, previous));
  }, [series]);

  if (dates.length === 0 || series.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-8 text-sm text-[var(--ink-muted)]">
        No hay datos para mostrar tendencia.
      </div>
    );
  }

  const visibleSeries = series.filter((entry) => visibleBySeries[entry.id] ?? true);
  const visibleLeftSeries = visibleSeries.filter((entry) => entry.axis === 'left');
  const visibleRightSeries = visibleSeries.filter((entry) => entry.axis === 'right');

  const leftValues = visibleLeftSeries
    .flatMap((entry) => entry.values)
    .map(toFiniteOrNull)
    .filter((value): value is number => value != null);

  const rightValues = visibleRightSeries
    .flatMap((entry) => entry.values)
    .map(toFiniteOrNull)
    .filter((value): value is number => value != null);

  const leftMax = withAxisPadding(Math.max(1, ...leftValues));
  const rightMax = withAxisPadding(Math.max(1, ...rightValues));

  const width = 980;
  const height = 380;
  const margin = { top: 28, right: 68, bottom: 62, left: 70 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const toX = (index: number) =>
    margin.left + (dates.length === 1 ? plotWidth / 2 : (index / (dates.length - 1)) * plotWidth);

  const toYLeft = (value: number) => margin.top + plotHeight - (value / leftMax) * plotHeight;
  const toYRight = (value: number) => margin.top + plotHeight - (value / rightMax) * plotHeight;

  const yTicks = 5;
  const xTickCount = Math.min(8, dates.length);
  const xTickIndexes = Array.from({ length: xTickCount }, (_, idx) => {
    if (xTickCount === 1) return 0;
    return Math.round((idx * (dates.length - 1)) / (xTickCount - 1));
  }).filter((value, index, arr) => arr.indexOf(value) === index);

  const toggleSeries = (seriesId: string) => {
    setVisibleBySeries((previous) => ({
      ...previous,
      [seriesId]: !(previous[seriesId] ?? true),
    }));
  };

  const setPairLag = (pairId: string, lag: 0 | 1) => {
    setScatterLagByPair((previous) => ({
      ...previous,
      [pairId]: lag,
    }));
  };

  const scatterPairs = visibleLeftSeries.flatMap((leftEntry, leftIndex) =>
    visibleRightSeries
      .map((rightEntry, rightIndex) => {
        const buildLagPoints = (lagDays: 0 | 1) =>
          dates.flatMap((date, dateIndex) => {
            const rightIndex = dateIndex - lagDays;
            if (rightIndex < 0 || rightIndex >= dates.length) return [];
            const y = toFiniteOrNull(leftEntry.values[dateIndex]);
            const x = toFiniteOrNull(rightEntry.values[rightIndex]);
            if (x == null || y == null) return [];
            return [{ date, xDate: dates[rightIndex], index: dateIndex, x, y }];
          });

        const lag0Points = buildLagPoints(0);
        const lag1Points = buildLagPoints(1);
        const lag0Regression = computeLinearRegression(lag0Points);
        const lag1Regression = computeLinearRegression(lag1Points);

        if (lag0Points.length === 0 && lag1Points.length === 0) return null;

        const color =
          visibleLeftSeries.length === 1
            ? rightEntry.color
            : visibleRightSeries.length === 1
              ? leftEntry.color
              : LINE_COLORS[(leftIndex * Math.max(1, visibleRightSeries.length) + rightIndex) % LINE_COLORS.length];

        const lag0R2 = lag0Regression?.rSquared ?? -1;
        const lag1R2 = lag1Regression?.rSquared ?? -1;
        const defaultLag: 0 | 1 = lag1R2 > lag0R2 ? 1 : 0;
        const selectedLag = scatterLagByPair[`${leftEntry.id}__${rightEntry.id}`] ?? defaultLag;
        const selectedPoints = selectedLag === 0 ? lag0Points : lag1Points;
        const selectedRegression = selectedLag === 0 ? lag0Regression : lag1Regression;

        return {
          id: `${leftEntry.id}__${rightEntry.id}`,
          name: `${leftEntry.name} vs ${rightEntry.name}`,
          leftEntry,
          rightEntry,
          color,
          selectedLag,
          defaultLag,
          points: selectedPoints,
          pairRegression: selectedRegression,
          lagStats: {
            0: { points: lag0Points, regression: lag0Regression },
            1: { points: lag1Points, regression: lag1Regression },
          },
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null)
  );

  const scatterRenderablePairs = scatterPairs.filter((pair) => pair.points.length > 0);
  const scatterXValues = scatterRenderablePairs.flatMap((pair) => pair.points.map((point) => point.x));
  const scatterYValues = scatterRenderablePairs.flatMap((pair) => pair.points.map((point) => point.y));
  const scatterPoints = scatterRenderablePairs.flatMap((pair) =>
    pair.points.map((point) => ({ x: point.x, y: point.y }))
  );
  const scatterXDomain = withDomainPadding(scatterXValues);
  const scatterYDomain = withDomainPadding(scatterYValues);
  const scatterXSpan = Math.max(scatterXDomain.max - scatterXDomain.min, 1e-9);
  const scatterYSpan = Math.max(scatterYDomain.max - scatterYDomain.min, 1e-9);
  const toScatterX = (value: number) =>
    margin.left + ((value - scatterXDomain.min) / scatterXSpan) * plotWidth;
  const toScatterY = (value: number) =>
    margin.top + plotHeight - ((value - scatterYDomain.min) / scatterYSpan) * plotHeight;
  const scatterRegression = computeLinearRegression(scatterPoints);
  const scatterRegressionSegment =
    scatterRegression == null
      ? null
      : buildRegressionSegment({
          slope: scatterRegression.slope,
          intercept: scatterRegression.intercept,
          xMin: scatterXDomain.min,
          xMax: scatterXDomain.max,
          yMin: scatterYDomain.min,
          yMax: scatterYDomain.max,
        });
  const scatterRegressionEquation =
    scatterRegression == null
      ? null
      : `Regresion: y = ${scatterRegression.slope.toFixed(3)}x + ${scatterRegression.intercept.toFixed(3)}`;

  const scatterTicks = 5;

  return (
    <section className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">{title}</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{subtitle}</p>
        </div>
        <div className="inline-flex rounded-full border border-black/10 bg-white p-1">
          <button
            type="button"
            onClick={() => setViewMode('line')}
            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
              viewMode === 'line' ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-muted)] hover:bg-black/5'
            }`}
          >
            Linea
          </button>
          <button
            type="button"
            onClick={() => setViewMode('scatter')}
            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
              viewMode === 'scatter'
                ? 'bg-[var(--ink)] text-white'
                : 'text-[var(--ink-muted)] hover:bg-black/5'
            }`}
          >
            Dispersion
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        {viewMode === 'line' ? (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-[340px] min-w-[900px] w-full"
            role="img"
            aria-label={`${title} en vista linea`}
          >
            <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} fill="#f8fafc" rx={14} />

            {Array.from({ length: yTicks + 1 }).map((_, idx) => {
              const ratio = idx / yTicks;
              const y = margin.top + ratio * plotHeight;
              const leftTick = leftMax * (1 - ratio);
              const rightTick = rightMax * (1 - ratio);
              return (
                <g key={`grid-${idx}`}>
                  <line x1={margin.left} x2={margin.left + plotWidth} y1={y} y2={y} stroke="rgba(15,27,45,0.12)" />
                  <text x={margin.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="rgba(15,27,45,0.78)">
                    {leftTick.toFixed(1)}
                  </text>
                  <text x={margin.left + plotWidth + 8} y={y + 4} textAnchor="start" fontSize="11" fill="rgba(15,27,45,0.78)">
                    {rightTick.toFixed(1)}
                  </text>
                </g>
              );
            })}

            {xTickIndexes.map((tickIndex) => {
              const x = toX(tickIndex);
              return (
                <g key={`xtick-${tickIndex}`}>
                  <line x1={x} x2={x} y1={margin.top} y2={margin.top + plotHeight} stroke="rgba(15,27,45,0.08)" />
                  <text
                    x={x}
                    y={margin.top + plotHeight + 18}
                    textAnchor="middle"
                    fontSize="11"
                    fill="rgba(15,27,45,0.78)"
                  >
                    {formatShortDate(dates[tickIndex])}
                  </text>
                </g>
              );
            })}

            <line
              x1={margin.left}
              x2={margin.left + plotWidth}
              y1={margin.top + plotHeight}
              y2={margin.top + plotHeight}
              stroke="rgba(15,27,45,0.55)"
            />
            <line
              x1={margin.left}
              x2={margin.left}
              y1={margin.top}
              y2={margin.top + plotHeight}
              stroke="rgba(15,27,45,0.55)"
            />
            <line
              x1={margin.left + plotWidth}
              x2={margin.left + plotWidth}
              y1={margin.top}
              y2={margin.top + plotHeight}
              stroke="rgba(15,27,45,0.55)"
            />

            {series.map((entry) => {
              const isVisible = visibleBySeries[entry.id] ?? true;
              if (!isVisible) {
                return null;
              }

              const segments = buildLineSegments(entry.values);
              const toY = entry.axis === 'left' ? toYLeft : toYRight;

              return (
                <g key={entry.id}>
                  {segments.map((segment, index) => {
                    if (segment.length < 2) {
                      return null;
                    }
                    const points = segment
                      .map((point) => `${toX(point.index)},${toY(point.value)}`)
                      .join(' ');
                    return (
                      <polyline
                        key={`${entry.id}-line-${index}`}
                        points={points}
                        fill="none"
                        stroke={entry.color}
                        strokeWidth={entry.width ?? 2.5}
                      />
                    );
                  })}

                  {segments.flatMap((segment) =>
                    segment.map((point) => (
                      <circle
                        key={`${entry.id}-pt-${point.index}`}
                        cx={toX(point.index)}
                        cy={toY(point.value)}
                        r={2.6}
                        fill={entry.color}
                        onClick={() =>
                          entry.onPointClick?.({
                            seriesId: entry.id,
                            seriesName: entry.name,
                            axis: entry.axis,
                            date: dates[point.index],
                            value: point.value,
                            index: point.index,
                          })
                        }
                        style={entry.onPointClick ? { cursor: 'pointer' } : undefined}
                      >
                        <title>
                          {`${formatDateLabel(dates[point.index])} | ${entry.name}: ${point.value.toFixed(3)}${
                            entry.onPointClick ? ' (click para detalle)' : ''
                          }`}
                        </title>
                      </circle>
                    ))
                  )}
                </g>
              );
            })}

            <text
              x={margin.left + plotWidth / 2}
              y={height - 8}
              textAnchor="middle"
              fontSize="12"
              fill="rgba(15,27,45,0.8)"
            >
              Fecha
            </text>
            <text
              x={16}
              y={margin.top + plotHeight / 2}
              textAnchor="middle"
              fontSize="12"
              transform={`rotate(-90 16 ${margin.top + plotHeight / 2})`}
              fill="rgba(15,27,45,0.8)"
            >
              {leftAxisLabel}
            </text>
            <text
              x={width - 16}
              y={margin.top + plotHeight / 2}
              textAnchor="middle"
              fontSize="12"
              transform={`rotate(90 ${width - 16} ${margin.top + plotHeight / 2})`}
              fill="rgba(15,27,45,0.8)"
            >
              {rightAxisLabel}
            </text>
          </svg>
        ) : (
          <>
            {visibleLeftSeries.length === 0 || visibleRightSeries.length === 0 ? (
              <div className="flex h-[340px] min-w-[900px] items-center justify-center rounded-xl border border-dashed border-black/10 bg-white/70 px-4 text-sm text-[var(--ink-muted)]">
                Activa al menos una serie por eje para ver la dispersion.
              </div>
            ) : scatterRenderablePairs.length === 0 ? (
              <div className="flex h-[340px] min-w-[900px] items-center justify-center rounded-xl border border-dashed border-black/10 bg-white/70 px-4 text-sm text-[var(--ink-muted)]">
                No hay puntos validos para construir la dispersion con la configuracion de lag actual.
              </div>
            ) : (
              <svg
                viewBox={`0 0 ${width} ${height}`}
                className="h-[340px] min-w-[900px] w-full"
                role="img"
                aria-label={`${title} en vista dispersion`}
              >
                <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} fill="#f8fafc" rx={14} />

                {Array.from({ length: scatterTicks + 1 }).map((_, idx) => {
                  const ratio = idx / scatterTicks;
                  const xValue = scatterXDomain.min + ratio * (scatterXDomain.max - scatterXDomain.min);
                  const yValue = scatterYDomain.max - ratio * (scatterYDomain.max - scatterYDomain.min);
                  const x = toScatterX(xValue);
                  const y = toScatterY(yValue);
                  return (
                    <g key={`scatter-grid-${idx}`}>
                      <line x1={margin.left} x2={margin.left + plotWidth} y1={y} y2={y} stroke="rgba(15,27,45,0.12)" />
                      <line x1={x} x2={x} y1={margin.top} y2={margin.top + plotHeight} stroke="rgba(15,27,45,0.08)" />
                      <text x={margin.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="rgba(15,27,45,0.78)">
                        {yValue.toFixed(1)}
                      </text>
                      <text
                        x={x}
                        y={margin.top + plotHeight + 18}
                        textAnchor="middle"
                        fontSize="11"
                        fill="rgba(15,27,45,0.78)"
                      >
                        {xValue.toFixed(1)}
                      </text>
                    </g>
                  );
                })}

                <line
                  x1={margin.left}
                  x2={margin.left + plotWidth}
                  y1={margin.top + plotHeight}
                  y2={margin.top + plotHeight}
                  stroke="rgba(15,27,45,0.55)"
                />
                <line
                  x1={margin.left}
                  x2={margin.left}
                  y1={margin.top}
                  y2={margin.top + plotHeight}
                  stroke="rgba(15,27,45,0.55)"
                />

                {scatterRegressionSegment && (
                  <g>
                    <line
                      x1={toScatterX(scatterRegressionSegment.a.x)}
                      y1={toScatterY(scatterRegressionSegment.a.y)}
                      x2={toScatterX(scatterRegressionSegment.b.x)}
                      y2={toScatterY(scatterRegressionSegment.b.y)}
                      stroke="#0f172a"
                      strokeWidth={2}
                      strokeDasharray="7 5"
                    />
                    <text
                      x={margin.left + 10}
                      y={margin.top + 14}
                      fontSize="11"
                      fill="rgba(15,27,45,0.85)"
                    >
                      {scatterRegressionEquation}
                    </text>
                  </g>
                )}

                {scatterRenderablePairs.map((pair) => (
                  <g key={pair.id}>
                    {pair.points.map((point) => {
                      const pointClickTarget = pair.leftEntry.onPointClick ?? pair.rightEntry.onPointClick;
                      return (
                        <circle
                          key={`${pair.id}-${point.index}`}
                          cx={toScatterX(point.x)}
                          cy={toScatterY(point.y)}
                          r={3}
                          fill={pair.color}
                          fillOpacity={0.72}
                          stroke="white"
                          strokeWidth={0.8}
                          onClick={() =>
                            pointClickTarget?.({
                              seriesId: pair.leftEntry.onPointClick ? pair.leftEntry.id : pair.rightEntry.id,
                              seriesName: pair.leftEntry.onPointClick
                                ? pair.leftEntry.name
                                : pair.rightEntry.name,
                              axis: pair.leftEntry.onPointClick ? 'left' : 'right',
                              date: point.date,
                              value: pair.leftEntry.onPointClick ? point.y : point.x,
                              index: point.index,
                            })
                          }
                          style={pointClickTarget ? { cursor: 'pointer' } : undefined}
                        >
                          <title>
                            {`${formatDateLabel(point.date)} | ${pair.name} · Lag ${pair.selectedLag}d · X (${formatDateLabel(point.xDate)}) ${point.x.toFixed(3)} · Y ${point.y.toFixed(3)}${
                              pointClickTarget ? ' (click para detalle)' : ''
                            }`}
                          </title>
                        </circle>
                      );
                    })}
                  </g>
                ))}

                <text
                  x={margin.left + plotWidth / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="12"
                  fill="rgba(15,27,45,0.8)"
                >
                  {rightAxisLabel}
                </text>
                <text
                  x={16}
                  y={margin.top + plotHeight / 2}
                  textAnchor="middle"
                  fontSize="12"
                  transform={`rotate(-90 16 ${margin.top + plotHeight / 2})`}
                  fill="rgba(15,27,45,0.8)"
                >
                  {leftAxisLabel}
                </text>
              </svg>
            )}
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {series.map((entry) => {
          const visible = visibleBySeries[entry.id] ?? true;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => toggleSeries(entry.id)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition ${
                visible
                  ? 'border-black/20 bg-white text-[var(--ink)]'
                  : 'border-black/10 bg-black/5 text-[var(--ink-muted)]'
              }`}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: entry.color }} />
              {entry.name}
              <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                {entry.axis === 'left' ? 'L' : 'R'}
              </span>
            </button>
          );
        })}
      </div>

      {viewMode === 'scatter' && scatterPairs.length > 0 && (
        <div className="mt-2 space-y-2">
          {scatterPairs.map((pair) => (
            <div
              key={`pair-${pair.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 bg-white px-3 py-2"
            >
              <div className="inline-flex items-center gap-2 text-[11px] text-[var(--ink-muted)]">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: pair.color }} />
                <span className="text-[var(--ink)]">{pair.name}</span>
                <span>lag activo: {pair.selectedLag}d</span>
                <span>auto: {pair.defaultLag}d</span>
                <span>puntos: {pair.points.length}</span>
              </div>

              <div className="inline-flex rounded-full border border-black/10 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setPairLag(pair.id, 0)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                    pair.selectedLag === 0
                      ? 'bg-[var(--ink)] text-white'
                      : 'text-[var(--ink-muted)] hover:bg-black/5'
                  }`}
                >
                  Lag 0d · R2 {formatNum(pair.lagStats[0].regression?.rSquared, 3)}
                </button>
                <button
                  type="button"
                  onClick={() => setPairLag(pair.id, 1)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                    pair.selectedLag === 1
                      ? 'bg-[var(--ink)] text-white'
                      : 'text-[var(--ink-muted)] hover:bg-black/5'
                  }`}
                >
                  Lag 1d · R2 {formatNum(pair.lagStats[1].regression?.rSquared, 3)}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewMode === 'scatter' && scatterRegression && (
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] text-[var(--ink-muted)]">
            n: {scatterRegression.n}
          </span>
          <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] text-[var(--ink-muted)]">
            r: {scatterRegression.correlation.toFixed(3)}
          </span>
          <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] text-[var(--ink-muted)]">
            R2: {scatterRegression.rSquared.toFixed(3)}
          </span>
          <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] text-[var(--ink-muted)]">
            pendiente: {scatterRegression.slope.toFixed(3)}
          </span>
          <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] text-[var(--ink-muted)]">
            intercepto: {scatterRegression.intercept.toFixed(3)}
          </span>
          <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] text-[var(--ink-muted)]">
            RMSE: {scatterRegression.rmse.toFixed(3)}
          </span>
        </div>
      )}
    </section>
  );
};

const DashboardLineAttendanceThroughput: React.FC = () => {
  const { setHeader } = useAdminHeader();

  const [mode, setMode] = useState<DashboardMode>('panel');
  const [fromDate, setFromDate] = useState(() => isoDaysAgo(30));
  const [toDate, setToDate] = useState(() => yesterdayStr());

  const [panelProductionStationId, setPanelProductionStationId] = useState('');
  const [panelMinAttendance, setPanelMinAttendance] = useState(1);

  const [moduleMinAttendance, setModuleMinAttendance] = useState(1);
  const [moduleMinMovesPerStationDay, setModuleMinMovesPerStationDay] = useState(1);

  const [panelData, setPanelData] = useState<PanelAttendanceThroughputResponse | null>(null);
  const [moduleData, setModuleData] = useState<ModuleAttendanceThroughputResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [movementModalTitle, setMovementModalTitle] = useState('');
  const [movementModalDate, setMovementModalDate] = useState('');
  const [movementModalValue, setMovementModalValue] = useState<number | null>(null);
  const [movementModalLoading, setMovementModalLoading] = useState(false);
  const [movementModalError, setMovementModalError] = useState('');
  const [movementModalData, setMovementModalData] = useState<ModuleMovementDayDetailResponse | null>(
    null
  );

  useEffect(() => {
    setHeader({
      title: 'Asistencia vs flujo de linea',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  const panelSummary = useMemo(() => {
    const rows = panelData?.rows ?? [];
    const totalPanels = rows.reduce((acc, row) => acc + row.production_panels, 0);
    return {
      days: rows.length,
      totalPanels,
      avgAttendance: average(rows.map((row) => row.line_attendance)),
      avgThroughput: average(rows.map((row) => row.throughput_per_attended_worker)),
    };
  }, [panelData]);

  const moduleSummary = useMemo(() => {
    const rows = moduleData?.rows ?? [];
    return {
      days: rows.length,
      avgAttendance: average(rows.map((row) => row.line_attendance)),
      avgMovementsPerWorkday: average(rows.map((row) => row.line_movements_per_workday)),
      avgThroughput: average(rows.map((row) => row.throughput_per_attended_worker)),
    };
  }, [moduleData]);

  const loadPanel = useCallback(async () => {
    const range = normalizeDateRange(fromDate, toDate);
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('from_date', range.from);
      params.set('to_date', range.to);
      params.set('min_total_line_attendance', String(Math.max(0, panelMinAttendance)));
      if (panelProductionStationId) {
        params.set('production_station_id', panelProductionStationId);
      }

      const data = await apiRequest<PanelAttendanceThroughputResponse>(
        `/api/line-attendance-throughput/panel?${params.toString()}`
      );
      setPanelData(data);
      if (!panelProductionStationId) {
        setPanelProductionStationId(String(data.production_station_id));
      }
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setPanelData(null);
      setError(err instanceof Error ? err.message : 'No se pudo cargar el modo panel.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, panelMinAttendance, panelProductionStationId, toDate]);

  const loadModule = useCallback(async () => {
    const range = normalizeDateRange(fromDate, toDate);
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('from_date', range.from);
      params.set('to_date', range.to);
      params.set('min_total_line_attendance', String(Math.max(0, moduleMinAttendance)));
      params.set(
        'min_moves_per_station_day',
        String(Math.max(1, Math.floor(moduleMinMovesPerStationDay || 1)))
      );
      params.set('workday_hours', '8');

      const data = await apiRequest<ModuleAttendanceThroughputResponse>(
        `/api/line-attendance-throughput/module?${params.toString()}`
      );
      setModuleData(data);
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setModuleData(null);
      setError(err instanceof Error ? err.message : 'No se pudo cargar el modo modulo.');
    } finally {
      setLoading(false);
    }
  }, [
    fromDate,
    moduleMinAttendance,
    moduleMinMovesPerStationDay,
    toDate,
  ]);

  useEffect(() => {
    if (mode === 'panel' && panelData == null) {
      void loadPanel();
    }
    if (mode === 'module' && moduleData == null) {
      void loadModule();
    }
  }, [loadModule, loadPanel, mode, moduleData, panelData]);

  const reloadActiveMode = () => {
    if (mode === 'panel') {
      void loadPanel();
      return;
    }
    void loadModule();
  };

  const panelAvailableStations = panelData?.available_stations ?? [];

  const panelEffectiveRangeInfo = useMemo(() => {
    if (!panelData) return null;
    if (panelData.requested_to_date === panelData.effective_to_date) return null;
    return `Hasta se ajusto a ${formatDateLabel(panelData.effective_to_date)} (excluye dia actual).`;
  }, [panelData]);

  const moduleEffectiveRangeInfo = useMemo(() => {
    if (!moduleData) return null;
    if (moduleData.requested_to_date === moduleData.effective_to_date) return null;
    return `Hasta se ajusto a ${formatDateLabel(moduleData.effective_to_date)} (excluye dia actual).`;
  }, [moduleData]);

  const closeMovementModal = useCallback(() => {
    setMovementModalOpen(false);
    setMovementModalError('');
    setMovementModalLoading(false);
  }, []);

  const openMovementModal = useCallback(
    async ({
      date,
      title,
      value,
      sequenceOrder,
      stationId,
    }: {
      date: string;
      title: string;
      value: number;
      sequenceOrder?: number;
      stationId?: number;
    }) => {
      setMovementModalOpen(true);
      setMovementModalTitle(title);
      setMovementModalDate(date);
      setMovementModalValue(value);
      setMovementModalError('');
      setMovementModalLoading(true);
      setMovementModalData(null);

      try {
        const params = new URLSearchParams();
        params.set('day', date);
        params.set('min_total_line_attendance', String(Math.max(0, moduleMinAttendance)));
        params.set(
          'min_moves_per_station_day',
          String(Math.max(1, Math.floor(moduleMinMovesPerStationDay || 1)))
        );
        params.set('workday_hours', '8');
        if (sequenceOrder != null) {
          params.set('sequence_order', String(sequenceOrder));
        }
        if (stationId != null) {
          params.set('station_id', String(stationId));
        }

        const detail = await apiRequest<ModuleMovementDayDetailResponse>(
          `/api/line-attendance-throughput/module/day-detail?${params.toString()}`
        );
        setMovementModalData(detail);
      } catch (err) {
        setMovementModalError(
          err instanceof Error ? err.message : 'No se pudo cargar el detalle del punto.'
        );
      } finally {
        setMovementModalLoading(false);
      }
    },
    [moduleMinAttendance, moduleMinMovesPerStationDay]
  );

  const panelOverviewSeries = useMemo<LineSeries[]>(() => {
    if (!panelData) return [];

    const stationNameById = new Map(panelData.available_stations.map((station) => [station.id, station.name]));
    const selectedStationIds = panelData.compared_station_ids.filter((value) => Number.isFinite(value));

    const rows = panelData.rows;
    const series: LineSeries[] = [
      {
        id: 'panel-production',
        name: 'Produccion paneles/dia',
        axis: 'left',
        color: '#2563eb',
        values: rows.map((row) => row.production_panels),
        width: 3,
      },
      {
        id: 'panel-line-attendance',
        name: 'Asistencia linea',
        axis: 'right',
        color: '#ea580c',
        values: rows.map((row) => row.line_attendance),
        width: 2.5,
      },
    ];

    selectedStationIds.forEach((stationId, index) => {
      series.push({
        id: `panel-station-${stationId}`,
        name: `${stationNameById.get(stationId) ?? `Estacion ${stationId}`} asistencia`,
        axis: 'right',
        color: LINE_COLORS[index % LINE_COLORS.length],
        values: rows.map((row) => {
          const metric = row.station_attendance.find((item) => item.station_id === stationId);
          return metric?.attendance ?? null;
        }),
        width: 1.8,
        initiallyVisible: false,
      });
    });

    return series;
  }, [panelData]);

  const moduleOverviewSeries = useMemo<LineSeries[]>(() => {
    if (!moduleData) return [];
    return [
      {
        id: 'module-line-movements',
        name: `Movimientos por ${formatNum(moduleData.workday_hours, 1)}h`,
        axis: 'left',
        color: '#2563eb',
        values: moduleData.rows.map((row) => row.line_movements_per_workday),
        width: 3,
        onPointClick: (point) =>
          void openMovementModal({
            date: point.date,
            title: 'Detalle del movimiento total de linea',
            value: point.value,
          }),
      },
      {
        id: 'module-line-attendance',
        name: 'Asistencia linea',
        axis: 'right',
        color: '#ea580c',
        values: moduleData.rows.map((row) => row.line_attendance),
        width: 2.5,
      },
    ];
  }, [moduleData, openMovementModal]);

  const moduleSequenceTrends = useMemo<SequenceTrend[]>(() => {
    if (!moduleData) return [];

    const selectedIds = moduleData.selected_station_ids.filter((value) => Number.isFinite(value));
    const selectedIdSet = new Set(selectedIds);

    const stationsBySequence = new Map<number, StationOption[]>();
    moduleData.available_stations.forEach((station) => {
      if (!selectedIdSet.has(station.id)) return;
      if (station.sequence_order == null) return;
      const current = stationsBySequence.get(station.sequence_order) ?? [];
      current.push(station);
      stationsBySequence.set(station.sequence_order, current);
    });

    const rows = moduleData.rows;
    const trends: SequenceTrend[] = [];

    Array.from(stationsBySequence.entries())
      .sort(([seqA], [seqB]) => seqA - seqB)
      .forEach(([sequenceOrder, stations]) => {
        const stationIds = stations.map((station) => station.id);
        const dates = rows.map((row) => row.date);

        const movementsPerWorkday = rows.map((row) => {
          const metrics = row.station_metrics.filter((metric) => stationIds.includes(metric.station_id));
          let weightedHours = 0;
          let totalMoves = 0;

          metrics.forEach((metric) => {
            if (metric.avg_active_move_hours == null || metric.move_count <= 0) {
              return;
            }
            weightedHours += metric.avg_active_move_hours * metric.move_count;
            totalMoves += metric.move_count;
          });

          if (totalMoves <= 0) return null;
          const avgHours = weightedHours / totalMoves;
          if (!Number.isFinite(avgHours) || avgHours <= 0) return null;
          return moduleData.workday_hours / avgHours;
        });

        const attendance = rows.map((row) => {
          const metric = row.station_metrics.find(
            (item) => item.sequence_order === sequenceOrder && item.attendance != null
          );
          return metric?.attendance ?? null;
        });

        const uniqueNames = Array.from(new Set(stations.map((station) => station.name)));
        const sequenceName = uniqueNames.length === 1 ? uniqueNames[0] : uniqueNames.join(' / ');
        const lineTypes = Array.from(
          new Set(
            stations
              .map((station) => station.line_type)
              .filter((lineType): lineType is string => Boolean(lineType))
          )
        ).sort();

        trends.push({
          sequenceOrder,
          sequenceName,
          lineTypes,
          stationIds,
          stationCount: stations.length,
          dates,
          movementsPerWorkday,
          attendance,
        });
      });

    return trends;
  }, [moduleData]);

  const moduleStationTrendsBySequence = useMemo(() => {
    if (!moduleData) {
      return new Map<number, StationTrend[]>();
    }

    const selectedIds = moduleData.selected_station_ids.filter((value) => Number.isFinite(value));
    const selectedIdSet = new Set(selectedIds);

    const grouped = new Map<number, StationTrend[]>();
    const rows = moduleData.rows;

    moduleData.available_stations.forEach((station) => {
      if (!selectedIdSet.has(station.id)) return;
      if (station.sequence_order == null) return;

      const trend: StationTrend = {
        stationId: station.id,
        stationName: station.name,
        lineType: station.line_type,
        sequenceOrder: station.sequence_order,
        dates: rows.map((row) => row.date),
        movementsPerWorkday: rows.map((row) => {
          const metric = row.station_metrics.find((item) => item.station_id === station.id);
          return metric?.movements_per_workday ?? null;
        }),
        attendance: rows.map((row) => {
          const metric = row.station_metrics.find((item) => item.station_id === station.id);
          return metric?.attendance ?? null;
        }),
      };

      const list = grouped.get(station.sequence_order) ?? [];
      list.push(trend);
      grouped.set(station.sequence_order, list);
    });

    return grouped;
  }, [moduleData]);

  useEffect(() => {
    if (!movementModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMovementModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeMovementModal, movementModalOpen]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-black/5 bg-white/85 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">Operacion diaria</p>
            <h1 className="mt-1 font-display text-xl text-[var(--ink)]">
              Relacion asistencia y rendimiento de linea
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">
              Dashboard diario (sin polling) con enfoque principal en tendencias por fecha,
              replicando la lectura de los scripts de referencia.
            </p>
          </div>
          <button
            type="button"
            onClick={reloadActiveMode}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)] transition hover:bg-black/5 disabled:opacity-60"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refrescar
          </button>
        </div>

        <div className="mt-4 inline-flex rounded-full border border-black/10 bg-white p-1">
          <button
            type="button"
            onClick={() => setMode('panel')}
            className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
              mode === 'panel' ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-muted)] hover:bg-black/5'
            }`}
          >
            Panel
          </button>
          <button
            type="button"
            onClick={() => setMode('module')}
            className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
              mode === 'module' ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-muted)] hover:bg-black/5'
            }`}
          >
            Modulo
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm text-[var(--ink-muted)]">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-4 w-4" /> Desde
            </span>
            <input
              type="date"
              value={fromDate}
              max={yesterdayStr()}
              onChange={(event) => setFromDate(clampDateToYesterday(event.target.value))}
              className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-[var(--ink-muted)]">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-4 w-4" /> Hasta
            </span>
            <input
              type="date"
              value={toDate}
              max={yesterdayStr()}
              onChange={(event) => setToDate(clampDateToYesterday(event.target.value))}
              className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
            />
          </label>

          {mode === 'panel' ? (
            <>
              <label className="flex flex-col gap-1 text-sm text-[var(--ink-muted)]">
                <span className="inline-flex items-center gap-1">
                  <Factory className="h-4 w-4" /> Estacion productiva
                </span>
                <select
                  value={panelProductionStationId}
                  onChange={(event) => setPanelProductionStationId(event.target.value)}
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                >
                  {panelAvailableStations.map((station) => (
                    <option key={station.id} value={String(station.id)}>
                      {station.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-[var(--ink-muted)]">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-4 w-4" /> Min asistencia linea
                </span>
                <input
                  type="number"
                  min={0}
                  value={panelMinAttendance}
                  onChange={(event) => setPanelMinAttendance(Math.max(0, Number(event.target.value) || 0))}
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={reloadActiveMode}
                  disabled={loading}
                  className="inline-flex items-center rounded-xl border border-black/10 bg-[var(--accent)]/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink)] transition hover:bg-[var(--accent)]/20 disabled:opacity-60"
                >
                  Aplicar filtros
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm text-[var(--ink-muted)]">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-4 w-4" /> Min asistencia linea
                </span>
                <input
                  type="number"
                  min={0}
                  value={moduleMinAttendance}
                  onChange={(event) => setModuleMinAttendance(Math.max(0, Number(event.target.value) || 0))}
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-[var(--ink-muted)]">
                <span>Movimientos minimos por estacion/dia</span>
                <input
                  type="number"
                  min={1}
                  value={moduleMinMovesPerStationDay}
                  onChange={(event) =>
                    setModuleMinMovesPerStationDay(Math.max(1, Math.floor(Number(event.target.value) || 1)))
                  }
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={reloadActiveMode}
                  disabled={loading}
                  className="inline-flex items-center rounded-xl border border-black/10 bg-[var(--accent)]/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink)] transition hover:bg-[var(--accent)]/20 disabled:opacity-60"
                >
                  Aplicar filtros
                </button>
              </div>
            </>
          )}
        </div>

        {mode === 'module' && (
          <p className="mt-3 text-xs text-[var(--ink-muted)]">
            Tipo de linea: todas. Jornada de calculo fija: 8 horas.
          </p>
        )}

        {loadedAt && (
          <p className="mt-3 text-xs text-[var(--ink-muted)]">
            Ultima carga: {new Date(loadedAt).toLocaleString()}
          </p>
        )}
      </section>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {mode === 'panel' && panelData && (
        <>
          <section className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Cobertura y recorte</p>
                <p className="text-sm text-[var(--ink)]">
                  Produccion desde <strong>{panelData.production_station_name}</strong>
                </p>
              </div>
              {panelEffectiveRangeInfo && (
                <p className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">{panelEffectiveRangeInfo}</p>
              )}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-black/5 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Dias usados</p>
                <p className="mt-1 text-xl font-semibold text-[var(--ink)]">{panelSummary.days}</p>
              </div>
              <div className="rounded-xl border border-black/5 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Paneles totales</p>
                <p className="mt-1 text-xl font-semibold text-[var(--ink)]">{panelSummary.totalPanels}</p>
              </div>
              <div className="rounded-xl border border-black/5 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Asistencia promedio</p>
                <p className="mt-1 text-xl font-semibold text-[var(--ink)]">{formatNum(panelSummary.avgAttendance, 1)}</p>
              </div>
              <div className="rounded-xl border border-black/5 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Paneles por operario</p>
                <p className="mt-1 text-xl font-semibold text-[var(--ink)]">{formatNum(panelSummary.avgThroughput, 3)}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
              <span className="rounded-full bg-black/5 px-3 py-1">
                Dias incompletos fuera: {panelData.dropped_incomplete_days}
              </span>
              <span className="rounded-full bg-black/5 px-3 py-1">
                Dias bajo asistencia minima: {panelData.dropped_low_attendance_days}
              </span>
            </div>
          </section>

          <DualAxisTrendChart
            title="Tendencia diaria de produccion vs asistencia"
            subtitle="Replica la lectura del script: paneles por dia (izquierda) y asistencia de linea/estaciones (derecha)."
            dates={panelData.rows.map((row) => row.date)}
            leftAxisLabel="Paneles por dia"
            rightAxisLabel="Asistencia (personas)"
            series={panelOverviewSeries}
          />

          <section className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Detalle diario</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-left text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    <th className="px-2 py-2">Fecha</th>
                    <th className="px-2 py-2">Paneles</th>
                    <th className="px-2 py-2">Asistencia linea</th>
                    <th className="px-2 py-2">Paneles/operario</th>
                    <th className="px-2 py-2">Estaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {panelData.rows.map((row) => (
                    <tr key={row.date} className="border-b border-black/5 align-top text-[var(--ink)]">
                      <td className="px-2 py-2 font-medium">{formatDateLabel(row.date)}</td>
                      <td className="px-2 py-2">{row.production_panels}</td>
                      <td className="px-2 py-2">{row.line_attendance}</td>
                      <td className="px-2 py-2 font-semibold">{formatNum(row.throughput_per_attended_worker, 3)}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {row.station_attendance.map((station) => (
                            <span
                              key={`${row.date}-${station.station_id}`}
                              className="rounded-full border border-black/10 bg-white px-2 py-1 text-[11px] text-[var(--ink-muted)]"
                            >
                              {station.station_name}: {station.attendance ?? '-'}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && panelData.rows.length === 0 && (
                    <tr>
                      <td className="px-2 py-4 text-[var(--ink-muted)]" colSpan={5}>
                        Sin dias disponibles para los filtros actuales.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {mode === 'module' && moduleData && (
        <>
          <section className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Cobertura y recorte</p>
                <p className="text-sm text-[var(--ink)]">Movimiento activo por secuencia de ensamblaje</p>
              </div>
              {moduleEffectiveRangeInfo && (
                <p className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">{moduleEffectiveRangeInfo}</p>
              )}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-black/5 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Dias usados</p>
                <p className="mt-1 text-xl font-semibold text-[var(--ink)]">{moduleSummary.days}</p>
              </div>
              <div className="rounded-xl border border-black/5 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Asistencia promedio</p>
                <p className="mt-1 text-xl font-semibold text-[var(--ink)]">{formatNum(moduleSummary.avgAttendance, 1)}</p>
              </div>
              <div className="rounded-xl border border-black/5 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Mov/jornada promedio</p>
                <p className="mt-1 text-xl font-semibold text-[var(--ink)]">
                  {formatNum(moduleSummary.avgMovementsPerWorkday, 2)}
                </p>
              </div>
              <div className="rounded-xl border border-black/5 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Mov/operario</p>
                <p className="mt-1 text-xl font-semibold text-[var(--ink)]">{formatNum(moduleSummary.avgThroughput, 3)}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
              <span className="rounded-full bg-black/5 px-3 py-1">
                Dias incompletos fuera: {moduleData.dropped_incomplete_days}
              </span>
              <span className="rounded-full bg-black/5 px-3 py-1">
                Dias bajo asistencia minima: {moduleData.dropped_low_attendance_days}
              </span>
              <span className="rounded-full bg-black/5 px-3 py-1">
                Dias sin movimiento util: {moduleData.dropped_no_movement_days}
              </span>
            </div>
          </section>

          <DualAxisTrendChart
            title="Tendencia general de movimiento vs asistencia"
            subtitle="Replica la vista general del script modular: movimientos por jornada (izquierda) y asistencia total (derecha). Click en un punto azul para ver como se calculo."
            dates={moduleData.rows.map((row) => row.date)}
            leftAxisLabel={`Movimientos por ${formatNum(moduleData.workday_hours, 1)}h`}
            rightAxisLabel="Asistencia (personas)"
            series={moduleOverviewSeries}
          />

          {moduleSequenceTrends.map((sequenceTrend) => (
            <div key={`sequence-${sequenceTrend.sequenceOrder}`} className="space-y-3">
              <DualAxisTrendChart
                title={`Tendencia ${sequenceTrend.sequenceName}`}
                subtitle={`Orden ${sequenceTrend.sequenceOrder} · ${sequenceTrend.stationCount} estaciones · ${
                  sequenceTrend.lineTypes.length > 0
                    ? sequenceTrend.lineTypes.map((lineType) => formatLineTypeLabel(lineType)).join(', ')
                    : 'Sin linea'
                }`}
                dates={sequenceTrend.dates}
                leftAxisLabel={`Movimientos por ${formatNum(moduleData.workday_hours, 1)}h`}
                rightAxisLabel="Asistencia secuencia"
                series={[
                  {
                    id: `sequence-${sequenceTrend.sequenceOrder}-moves`,
                    name: 'Movimientos secuencia',
                    axis: 'left',
                    color: '#2563eb',
                    values: sequenceTrend.movementsPerWorkday,
                    width: 3,
                    onPointClick: (point) =>
                      void openMovementModal({
                        date: point.date,
                        title: `Detalle de movimientos: ${sequenceTrend.sequenceName}`,
                        value: point.value,
                        sequenceOrder: sequenceTrend.sequenceOrder,
                      }),
                  },
                  {
                    id: `sequence-${sequenceTrend.sequenceOrder}-attendance`,
                    name: 'Asistencia secuencia',
                    axis: 'right',
                    color: '#ea580c',
                    values: sequenceTrend.attendance,
                    width: 2.5,
                  },
                ]}
              />

              {(moduleStationTrendsBySequence.get(sequenceTrend.sequenceOrder)?.length ?? 0) > 1 && (
                <details className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">
                    Ver estaciones individuales · {sequenceTrend.sequenceName} ·{' '}
                    {sequenceTrend.lineTypes.length > 0
                      ? sequenceTrend.lineTypes.map((lineType) => formatLineTypeLabel(lineType)).join(', ')
                      : 'Sin linea'}
                  </summary>
                  <div className="mt-4 space-y-4">
                    {(moduleStationTrendsBySequence.get(sequenceTrend.sequenceOrder) ?? []).map((stationTrend) => (
                      <DualAxisTrendChart
                        key={`station-${stationTrend.stationId}`}
                        title={stationTrend.stationName}
                        subtitle={`Orden ${stationTrend.sequenceOrder} · ${formatLineTypeLabel(stationTrend.lineType)}`}
                        dates={stationTrend.dates}
                        leftAxisLabel={`Movimientos por ${formatNum(moduleData.workday_hours, 1)}h`}
                        rightAxisLabel="Asistencia estacion"
                        series={[
                          {
                            id: `station-${stationTrend.stationId}-moves`,
                            name: 'Movimientos estacion',
                            axis: 'left',
                            color: '#2563eb',
                            values: stationTrend.movementsPerWorkday,
                            width: 3,
                            onPointClick: (point) =>
                              void openMovementModal({
                                date: point.date,
                                title: `Detalle de movimientos: ${stationTrend.stationName} (${formatLineTypeLabel(stationTrend.lineType)})`,
                                value: point.value,
                                stationId: stationTrend.stationId,
                              }),
                          },
                          {
                            id: `station-${stationTrend.stationId}-attendance`,
                            name: 'Asistencia estacion',
                            axis: 'right',
                            color: '#ea580c',
                            values: stationTrend.attendance,
                            width: 2.5,
                          },
                        ]}
                      />
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}

          <section className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Detalle diario</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-left text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    <th className="px-2 py-2">Fecha</th>
                    <th className="px-2 py-2">Mov/jornada linea</th>
                    <th className="px-2 py-2">Asistencia linea</th>
                    <th className="px-2 py-2">Mov/operario</th>
                    <th className="px-2 py-2">Estaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {moduleData.rows.map((row) => (
                    <tr key={row.date} className="border-b border-black/5 align-top text-[var(--ink)]">
                      <td className="px-2 py-2 font-medium">{formatDateLabel(row.date)}</td>
                      <td className="px-2 py-2">{formatNum(row.line_movements_per_workday, 2)}</td>
                      <td className="px-2 py-2">{row.line_attendance}</td>
                      <td className="px-2 py-2 font-semibold">{formatNum(row.throughput_per_attended_worker, 3)}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {row.station_metrics.map((station) => (
                            <span
                              key={`${row.date}-${station.station_id}`}
                              className="rounded-full border border-black/10 bg-white px-2 py-1 text-[11px] text-[var(--ink-muted)]"
                            >
                              {station.station_name} ({formatLineTypeLabel(station.line_type)}): A {station.attendance ?? '-'} | M {station.move_count}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && moduleData.rows.length === 0 && (
                    <tr>
                      <td className="px-2 py-4 text-[var(--ink-muted)]" colSpan={5}>
                        Sin dias disponibles para los filtros actuales.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {movementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={closeMovementModal}>
          <div
            className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Detalle de movimientos del punto"
          >
            <div className="flex items-start justify-between gap-3 border-b border-black/10 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-[var(--ink)]">{movementModalTitle}</h3>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  {formatDateLabel(movementModalDate)}
                  {movementModalValue != null ? ` · Punto: ${formatNum(movementModalValue, 3)}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={closeMovementModal}
                className="rounded-full border border-black/10 p-2 text-[var(--ink-muted)] hover:bg-black/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[calc(90vh-84px)] space-y-4 overflow-y-auto px-5 py-4">
              {movementModalLoading && (
                <p className="text-sm text-[var(--ink-muted)]">Cargando detalle del calculo...</p>
              )}

              {!movementModalLoading && movementModalError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {movementModalError}
                </div>
              )}

              {!movementModalLoading && !movementModalError && movementModalData && (
                <>
                  <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <div className="rounded-xl border border-black/10 bg-white p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Asistencia linea</p>
                      <p className="mt-1 text-lg font-semibold text-[var(--ink)]">
                        {movementModalData.line_attendance ?? '-'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-black/10 bg-white p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Mov/jornada</p>
                      <p className="mt-1 text-lg font-semibold text-[var(--ink)]">
                        {formatNum(movementModalData.line_movements_per_workday, 3)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-black/10 bg-white p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Promedio horas activas</p>
                      <p className="mt-1 text-lg font-semibold text-[var(--ink)]">
                        {formatNum(movementModalData.line_avg_active_move_hours, 3)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-black/10 bg-white p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Mov/operario</p>
                      <p className="mt-1 text-lg font-semibold text-[var(--ink)]">
                        {formatNum(movementModalData.throughput_per_attended_worker, 4)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-black/10 bg-white p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Cache</p>
                      <p className="mt-1 text-lg font-semibold text-[var(--ink)]">
                        {movementModalData.cache_rows}/{movementModalData.cache_expected_rows}
                      </p>
                    </div>
                    <div className="rounded-xl border border-black/10 bg-white p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Intervalos</p>
                      <p className="mt-1 text-lg font-semibold text-[var(--ink)]">
                        {movementModalData.movement_intervals.length}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-black/10 bg-white p-4">
                    <h4 className="text-sm font-semibold text-[var(--ink)]">Resumen por estacion</h4>
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="border-b border-black/10 text-left uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                            <th className="px-2 py-2">Estacion</th>
                            <th className="px-2 py-2">Linea</th>
                            <th className="px-2 py-2">Asist.</th>
                            <th className="px-2 py-2">Movs</th>
                            <th className="px-2 py-2">Prom h</th>
                            <th className="px-2 py-2">Mov/8h</th>
                            <th className="px-2 py-2">Min activos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {movementModalData.station_summaries.map((station) => (
                            <tr key={station.station_id} className="border-b border-black/5 text-[var(--ink)]">
                              <td className="px-2 py-2">{station.station_name}</td>
                              <td className="px-2 py-2">{formatLineTypeLabel(station.line_type)}</td>
                              <td className="px-2 py-2">{station.attendance ?? '-'}</td>
                              <td className="px-2 py-2">{station.move_count}</td>
                              <td className="px-2 py-2">{formatNum(station.avg_active_move_hours, 3)}</td>
                              <td className="px-2 py-2">{formatNum(station.movements_per_workday, 3)}</td>
                              <td className="px-2 py-2">{formatNum(station.total_active_minutes, 2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-xl border border-black/10 bg-white p-4">
                    <h4 className="text-sm font-semibold text-[var(--ink)]">
                      Movimientos del dia y tramos usados en el calculo
                    </h4>
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="border-b border-black/10 text-left uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                            <th className="px-2 py-2">Inicio tramo</th>
                            <th className="px-2 py-2">Fin tramo</th>
                            <th className="px-2 py-2">Estacion</th>
                            <th className="px-2 py-2">Proyecto</th>
                            <th className="px-2 py-2">Casa</th>
                            <th className="px-2 py-2">Min total</th>
                            <th className="px-2 py-2">Min activos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {movementModalData.movement_intervals.map((interval, index) => (
                            <tr
                              key={`${interval.station_id}-${interval.interval_start_at}-${interval.interval_end_at}-${index}`}
                              className="border-b border-black/5 text-[var(--ink)]"
                            >
                              <td className="px-2 py-2">
                                {interval.tramo_start_task_name} started at{' '}
                                {formatTramoDateTimeLabel(interval.tramo_start_task_started_at)}
                              </td>
                              <td className="px-2 py-2">
                                {interval.tramo_end_task_name} started at{' '}
                                {formatTramoDateTimeLabel(interval.tramo_end_task_started_at)}
                              </td>
                              <td className="px-2 py-2">
                                {interval.station_name} ({formatLineTypeLabel(interval.line_type)})
                              </td>
                              <td className="px-2 py-2">{interval.project_name ?? '-'}</td>
                              <td className="px-2 py-2">{interval.house_identifier ?? '-'}</td>
                              <td className="px-2 py-2">{formatNum(interval.elapsed_minutes, 2)}</td>
                              <td className="px-2 py-2 font-semibold">{formatNum(interval.active_minutes, 2)}</td>
                            </tr>
                          ))}
                          {movementModalData.movement_intervals.length === 0 && (
                            <tr>
                              <td colSpan={7} className="px-2 py-3 text-[var(--ink-muted)]">
                                No se encontraron intervalos de movimiento para ese punto.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardLineAttendanceThroughput;
