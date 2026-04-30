import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Link2, RefreshCcw, X } from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const CECO_MAPPING_STORAGE_KEY = 'lineAttendanceThroughput.cecoSupervisorMappings.v1';
const DATE_RANGE_STORAGE_KEY = 'lineAttendanceThroughput.dateRange.v1';
const HIDDEN_CECO_MAPPING_VALUE = 'none';
type CecoMappingValue = number | typeof HIDDEN_CECO_MAPPING_VALUE;

type Coverage = {
  geovictoria_available: boolean;
  geovictoria_active_users: number;
  geovictoria_active_users_matched_locally: number;
  geovictoria_active_users_unmatched_locally: number;
  buk_available: boolean;
  buk_people_indexed: number;
  buk_people_with_cost_center: number;
  active_local_workers: number;
  active_local_geo_linked_workers: number;
  active_local_geo_linked_workers_matched_in_geovictoria: number;
  active_local_geo_linked_workers_matched_in_buk: number;
  active_local_geo_linked_workers_with_supervisor: number;
  active_local_geo_linked_workers_without_supervisor: number;
  active_local_geo_linked_workers_resolved_by_ceco: number;
  active_local_geo_linked_workers_unresolved_after_fallback: number;
  local_supervisors: number;
  local_supervisors_matched_in_geovictoria: number;
  supervisor_cost_center_mappings: number;
};

type SupervisorOption = {
  id: number;
  name: string;
};

type CostCenterSummary = {
  cost_center_code: string;
  cost_center_name: string | null;
  buk_people_count: number;
  matched_local_worker_count: number;
  direct_supervisor_worker_count: number;
  fallback_candidate_worker_count: number;
};

type CostCenterDay = {
  date: string;
  cost_center_code: string;
  present_people_count: number;
  total_people_count: number;
};

type CostCenterPerson = {
  identifier: string;
  person_name: string | null;
  cost_center_code: string;
  cost_center_name: string | null;
};

type PersonShiftDay = {
  date: string;
  identifier: string;
  person_name: string | null;
  cost_center_code: string;
  cost_center_name: string | null;
  present: boolean;
  first_entry: string | null;
  last_exit: string | null;
};

type WorkerAssignment = {
  worker_id: number;
  worker_name: string;
  geovictoria_identifier: string | null;
  direct_supervisor_id: number | null;
  buk_matched: boolean;
  buk_cost_center_code: string | null;
  buk_cost_center_name: string | null;
};

type WorkerDay = {
  date: string;
  worker_id: number;
  present: boolean;
  productive: boolean;
  task_participation_count: number;
  panel_touch_ids: number[];
};

type DayRow = {
  date: string;
  eligible_local_worker_count: number;
  eligible_supervised_worker_count: number;
  present_worker_count: number;
  present_supervised_worker_count: number;
  present_unassigned_worker_count: number;
  productive_worker_count: number;
  productive_supervised_worker_count: number;
  productive_unassigned_worker_count: number;
  present_productive_overlap_count: number;
  task_participation_count: number;
  completed_task_count: number;
  completed_panel_count: number;
  finished_panel_count: number;
  finished_panel_area_m2: number;
  finished_panel_linear_meters: number;
  finished_module_count: number;
};

type ResponsePayload = {
  from_date: string;
  to_date: string;
  generated_at: string;
  ceco_mapping_enabled: boolean;
  coverage: Coverage;
  warnings: string[];
  days: DayRow[];
  supervisors: SupervisorOption[];
  buk_cost_centers: CostCenterSummary[];
  buk_cost_center_days: CostCenterDay[];
  worker_assignments: WorkerAssignment[];
  worker_days: WorkerDay[];
};

type AttendancePayload = {
  from_date: string;
  to_date: string;
  generated_at: string;
  requested_cost_center_codes: string[];
  warnings: string[];
  buk_cost_center_days: CostCenterDay[];
  buk_people: CostCenterPerson[];
  buk_person_shift_days: PersonShiftDay[];
};

type OutputFamily = 'panels' | 'modules';
type CecoMappingSet = Record<string, CecoMappingValue>;
type CecoMappingByFamily = Record<OutputFamily, CecoMappingSet>;
type PanelMetric = 'count' | 'area' | 'linear';
type OutputMetricKey =
  | 'finished_panel_count'
  | 'finished_panel_area_m2'
  | 'finished_panel_linear_meters'
  | 'finished_module_count';

type OutputMetricConfig = {
  key: OutputMetricKey;
  label: string;
  shortLabel: string;
  format: (value: number) => string;
};

type EffectiveDashboard = {
  coverage: Coverage;
  warnings: string[];
  sanitizedMap: Record<string, CecoMappingValue>;
  hiddenCostCenterCount: number;
  hiddenWorkerCount: number;
};

type CohortOption = {
  value: string;
  label: string;
  helper: string;
  costCenterCodes: string[];
  kind: 'all' | 'supervisor' | 'cost_center';
};

type MappingTab = 'visible' | 'hidden';
type AnalysisTab = 'correlation' | 'fte';
type ChartMode = 'timeline' | 'scatter';

type ChartPoint = {
  date: string;
  label: string;
  attendance: number;
  output: number;
};

type RegressionSummary = {
  slope: number;
  intercept: number;
  rSquared: number;
  xMin: number;
  xMax: number;
  yStart: number;
  yEnd: number;
};

type FteCostCenterSummary = {
  costCenter: CostCenterSummary;
  peopleCount: number;
  presentDays: number;
  netHours: number;
  extraHours: number;
  fteDays: number;
  avgFte: number;
};

type FteExtraHoursDetail = {
  shift: PersonShiftDay;
  person: CostCenterPerson | null;
  netHours: number;
  extraHours: number;
};

const EMPTY_DAYS: DayRow[] = [];
const EMPTY_COST_CENTER_DAYS: CostCenterDay[] = [];

const WARNING_LABELS: Record<string, string> = {
  geovictoria_roster_unfiltered: 'Roster GeoVictoria global, sin filtro de piso.',
  geovictoria_roster_unavailable: 'GeoVictoria no respondio: se muestran solo datos locales.',
  buk_unavailable: 'BUK no disponible: sin fallback por CECO.',
  local_ceco_mappings_missing: 'Faltan mappings CECO para incluir parte del fallback.',
};

const normalizeStoredCecoMappingSet = (value: unknown): CecoMappingSet => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, mappingValue]) =>
        typeof key === 'string' &&
        (typeof mappingValue === 'number' || mappingValue === HIDDEN_CECO_MAPPING_VALUE),
    ),
  ) as CecoMappingSet;
};

const loadStoredCecoMappings = (): CecoMappingByFamily => {
  if (typeof window === 'undefined') {
    return {
      panels: {},
      modules: {},
    };
  }
  try {
    const raw = window.localStorage.getItem(CECO_MAPPING_STORAGE_KEY);
    if (!raw) {
      return {
        panels: {},
        modules: {},
      };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {
        panels: {},
        modules: {},
      };
    }

    const familyPanels = normalizeStoredCecoMappingSet(
      (parsed as Partial<Record<OutputFamily, unknown>>).panels,
    );
    const familyModules = normalizeStoredCecoMappingSet(
      (parsed as Partial<Record<OutputFamily, unknown>>).modules,
    );
    if (Object.keys(familyPanels).length || Object.keys(familyModules).length) {
      return {
        panels: familyPanels,
        modules: familyModules,
      };
    }

    const legacyMappings = normalizeStoredCecoMappingSet(parsed);
    return {
      panels: { ...legacyMappings },
      modules: { ...legacyMappings },
    };
  } catch {
    return {
      panels: {},
      modules: {},
    };
  }
};

const getDefaultDateRange = () => {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(end.getDate() - 13);
  return {
    fromDate: toDateInputValue(start),
    toDate: toDateInputValue(end),
  };
};

const loadStoredDateRange = () => {
  const fallback = getDefaultDateRange();
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(DATE_RANGE_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<Record<'fromDate' | 'toDate', unknown>>;
    const fromDate = typeof parsed.fromDate === 'string' ? parsed.fromDate : fallback.fromDate;
    const toDate = typeof parsed.toDate === 'string' ? parsed.toDate : fallback.toDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      return fallback;
    }
    return { fromDate, toDate };
  } catch {
    return fallback;
  }
};

const formatCostCenterLabel = (
  costCenterCode: string | null | undefined,
  costCenterName?: string | null,
) => {
  const normalizedCode = costCenterCode?.trim() || null;
  const normalizedName = costCenterName?.trim() || null;
  if (normalizedName && normalizedCode && normalizedName !== normalizedCode) {
    return `${normalizedName} (${normalizedCode})`;
  }
  return normalizedName ?? normalizedCode ?? 'Sin CECO';
};

const apiRequest = async <T,>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> => {
  const { timeoutMs = 50000, ...requestOptions } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...requestOptions,
      headers: {
        'Content-Type': 'application/json',
        ...(requestOptions.headers || {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = 'No se pudo completar la solicitud.';
      try {
        const payload = await response.json();
        if (payload?.detail) {
          message = String(payload.detail);
        }
      } catch {
        // Keep default message.
      }
      throw new Error(message);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('La consulta tardo demasiado. Ajusta el cohorte o el rango.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const pad = (value: number) => String(value).padStart(2, '0');

const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const formatInteger = (value: number | null | undefined) =>
  new Intl.NumberFormat('es-CL', {
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));

const formatDecimal = (value: number | null | undefined) =>
  new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(Number(value ?? 0));

const formatPreciseDecimal = (value: number | null | undefined) =>
  new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));

const formatShortDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
  });
};

const formatLongDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString('es-CL', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
};

const formatClock = (value: string | null | undefined) => {
  if (!value) {
    return '—';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }
  return parsed.toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const parseTimeOfDayMinutes = (value: string) => {
  const [hoursRaw, minutesRaw] = value.split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 8 * 60;
  }
  return Math.max(0, Math.min(24 * 60, hours * 60 + minutes));
};

const applyShiftStartFloor = (entry: Date, startMinutes: number) => {
  const floored = new Date(entry);
  floored.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  return entry > floored ? entry : floored;
};

const estimateNetShiftHours = (
  shift: PersonShiftDay,
  startTime: string,
  lunchMinutes: number,
  otherMinutes: number,
) => {
  if (!shift.first_entry || !shift.last_exit) {
    return 0;
  }
  const entry = new Date(shift.first_entry);
  const exit = new Date(shift.last_exit);
  if (Number.isNaN(entry.getTime()) || Number.isNaN(exit.getTime()) || exit <= entry) {
    return 0;
  }
  const effectiveEntry = applyShiftStartFloor(entry, parseTimeOfDayMinutes(startTime));
  const grossMinutes = Math.max(0, (exit.getTime() - effectiveEntry.getTime()) / 60000);
  return Math.max(0, grossMinutes - lunchMinutes - otherMinutes) / 60;
};

const estimateExtraHours = (netHours: number, baseDailyHours: number) =>
  Math.max(0, netHours - baseDailyHours);

const isWeekday = (value: string) => {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return true;
  }
  const day = parsed.getDay();
  return day !== 0 && day !== 6;
};

const hasOwn = (source: object, key: string) =>
  Object.prototype.hasOwnProperty.call(source, key);

const SummaryCard = ({
  label,
  value,
  detail,
  tone = 'default',
  onClick,
  tooltip,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'default' | 'accent' | 'warning';
  onClick?: () => void;
  tooltip?: string;
}) => {
  const toneClasses =
    tone === 'accent'
      ? 'border-[var(--accent-soft)] bg-[var(--accent-soft)]/55'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50/85'
        : 'border-black/5 bg-white/88';
  const content = (
    <>
      <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">{label}</p>
      <div className="mt-3 text-3xl font-semibold text-[var(--ink)]">{value}</div>
      {detail ? <p className="mt-2 text-sm text-[var(--ink-muted)]">{detail}</p> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={tooltip}
        className={`rounded-2xl border px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${toneClasses}`}
      >
        {content}
      </button>
    );
  }
  return (
    <article title={tooltip} className={`rounded-2xl border px-4 py-4 shadow-sm ${toneClasses}`}>
      {content}
    </article>
  );
};

const ComparisonChart = ({
  points,
  outputLabel,
  outputFormatter,
  activeDate,
  onActiveDateChange,
}: {
  points: ChartPoint[];
  outputLabel: string;
  outputFormatter: (value: number) => string;
  activeDate: string | null;
  onActiveDateChange: (value: string) => void;
}) => {
  if (!points.length) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-8 text-sm text-[var(--ink-muted)]">
        No hay dias comparables para el rango seleccionado.
      </div>
    );
  }

  const resolvedActiveDate =
    points.find((point) => point.date === activeDate)?.date ?? points[points.length - 1].date;
  const svgWidth = Math.max(760, points.length * 52);
  const svgHeight = 320;
  const padding = { top: 24, right: 52, bottom: 48, left: 44 };
  const innerWidth = svgWidth - padding.left - padding.right;
  const innerHeight = svgHeight - padding.top - padding.bottom;
  const attendanceMax = Math.max(1, ...points.map((point) => point.attendance));
  const outputMax = Math.max(1, ...points.map((point) => point.output));
  const step = points.length > 1 ? innerWidth / (points.length - 1) : 0;
  const barWidth = Math.min(26, Math.max(12, innerWidth / Math.max(points.length * 2.3, 1)));
  const hoverWidth = points.length > 1 ? Math.max(28, step) : 56;
  const tickInterval = Math.max(1, Math.ceil(points.length / 8));

  const xFor = (index: number) =>
    points.length > 1 ? padding.left + step * index : padding.left + innerWidth / 2;
  const yForAttendance = (value: number) =>
    padding.top + innerHeight - (value / attendanceMax) * innerHeight;
  const yForOutput = (value: number) =>
    padding.top + innerHeight - (value / outputMax) * innerHeight;

  const attendancePath = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${xFor(index)} ${yForAttendance(point.attendance)}`,
    )
    .join(' ');
  const activeIndex = points.findIndex((point) => point.date === resolvedActiveDate);
  const activeX = activeIndex >= 0 ? xFor(activeIndex) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--ink-muted)]">
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#0f766e]" />
            Asistencia
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#d6a34a]" />
            {outputLabel}
          </span>
        </div>
        <div className="text-xs text-[var(--ink-muted)]">
          Max {formatInteger(attendanceMax)} personas / {outputFormatter(outputMax)}
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="block min-w-full"
          role="img"
          aria-label="Grafico de asistencia y produccion por dia habil"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding.top + innerHeight * ratio;
            return (
              <line
                key={ratio}
                x1={padding.left}
                y1={y}
                x2={svgWidth - padding.right}
                y2={y}
                stroke="rgba(15, 23, 42, 0.09)"
                strokeWidth="1"
              />
            );
          })}

          {activeX !== null ? (
            <line
              x1={activeX}
              y1={padding.top}
              x2={activeX}
              y2={padding.top + innerHeight}
              stroke="rgba(15, 23, 42, 0.18)"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
          ) : null}

          {points.map((point, index) => {
            const x = xFor(index);
            const barY = yForOutput(point.output);
            const barHeight = padding.top + innerHeight - barY;
            const isActive = point.date === resolvedActiveDate;
            return (
              <g key={point.date}>
                <rect
                  x={x - barWidth / 2}
                  y={barY}
                  width={barWidth}
                  height={Math.max(barHeight, 2)}
                  rx={barWidth / 2}
                  fill={isActive ? '#c9901f' : '#d6a34a'}
                  opacity={isActive ? 1 : 0.72}
                />
              </g>
            );
          })}

          <path
            d={attendancePath}
            fill="none"
            stroke="#0f766e"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {points.map((point, index) => {
            const x = xFor(index);
            const y = yForAttendance(point.attendance);
            const isActive = point.date === resolvedActiveDate;
            const showTick = index === 0 || index === points.length - 1 || index % tickInterval === 0;
            return (
              <g key={`${point.date}-line`}>
                <circle
                  cx={x}
                  cy={y}
                  r={isActive ? 4.5 : 3}
                  fill="#0f766e"
                  stroke="white"
                  strokeWidth="2"
                />
                {showTick ? (
                  <text
                    x={x}
                    y={svgHeight - 18}
                    textAnchor="middle"
                    fontSize="11"
                    fill="rgba(15, 23, 42, 0.58)"
                  >
                    {point.label}
                  </text>
                ) : null}
                <rect
                  x={x - hoverWidth / 2}
                  y={padding.top}
                  width={hoverWidth}
                  height={innerHeight + 24}
                  fill="transparent"
                  tabIndex={0}
                  onMouseEnter={() => onActiveDateChange(point.date)}
                  onFocus={() => onActiveDateChange(point.date)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

const buildRegressionSummary = (points: ChartPoint[]): RegressionSummary | null => {
  if (points.length < 2) {
    return null;
  }

  const n = points.length;
  const sumX = points.reduce((sum, point) => sum + point.attendance, 0);
  const sumY = points.reduce((sum, point) => sum + point.output, 0);
  const sumXY = points.reduce((sum, point) => sum + point.attendance * point.output, 0);
  const sumXX = points.reduce((sum, point) => sum + point.attendance * point.attendance, 0);
  const sumYY = points.reduce((sum, point) => sum + point.output * point.output, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    return null;
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const rSquaredDenominator = (n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY);
  const rSquared =
    rSquaredDenominator > 0
      ? ((n * sumXY - sumX * sumY) * (n * sumXY - sumX * sumY)) / rSquaredDenominator
      : 0;

  const attendanceValues = points.map((point) => point.attendance);
  const xMin = Math.min(...attendanceValues);
  const xMax = Math.max(...attendanceValues);
  return {
    slope,
    intercept,
    rSquared,
    xMin,
    xMax,
    yStart: intercept + slope * xMin,
    yEnd: intercept + slope * xMax,
  };
};

const ScatterRegressionChart = ({
  points,
  outputLabel,
  outputFormatter,
  regression,
  activeDate,
  onActiveDateChange,
}: {
  points: ChartPoint[];
  outputLabel: string;
  outputFormatter: (value: number) => string;
  regression: RegressionSummary | null;
  activeDate: string | null;
  onActiveDateChange: (value: string) => void;
}) => {
  if (!points.length) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-8 text-sm text-[var(--ink-muted)]">
        No hay dias comparables para el rango seleccionado.
      </div>
    );
  }

  const resolvedActiveDate =
    points.find((point) => point.date === activeDate)?.date ?? points[points.length - 1].date;
  const svgWidth = 760;
  const svgHeight = 360;
  const padding = { top: 24, right: 32, bottom: 52, left: 56 };
  const innerWidth = svgWidth - padding.left - padding.right;
  const innerHeight = svgHeight - padding.top - padding.bottom;
  const attendanceValues = points.map((point) => point.attendance);
  const xObservedMin = Math.min(...attendanceValues, regression?.xMin ?? Number.POSITIVE_INFINITY);
  const xObservedMax = Math.max(...attendanceValues, regression?.xMax ?? 0);
  const xPaddingBase =
    xObservedMax > xObservedMin ? (xObservedMax - xObservedMin) * 0.08 : Math.max(1, xObservedMax * 0.08);
  const xPadding = Math.min(xPaddingBase, Math.max(0.5, xObservedMin * 0.35));
  const xDomainMin = Math.max(0, xObservedMin - xPadding);
  const xDomainMax = xObservedMax + xPaddingBase;
  const xSpan = Math.max(1, xDomainMax - xDomainMin);
  const yMax = Math.max(
    1,
    ...points.map((point) => point.output),
    regression ? Math.max(regression.yStart, regression.yEnd, 0) : 0,
  );
  const xFor = (value: number) => padding.left + ((value - xDomainMin) / xSpan) * innerWidth;
  const yFor = (value: number) =>
    padding.top + innerHeight - (Math.max(value, 0) / yMax) * innerHeight;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--ink-muted)]">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#0f766e]" />
            Dias
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-0.5 w-4 rounded-full bg-[#d6a34a]" />
            Regresion lineal
          </span>
        </div>
        <div>
          Eje X: asistencia / Eje Y: {outputLabel.toLowerCase()}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="block min-w-full"
          role="img"
          aria-label="Grafico de dispersion entre asistencia y produccion con regresion lineal"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding.top + innerHeight * ratio;
            return (
              <line
                key={`h-${ratio}`}
                x1={padding.left}
                y1={y}
                x2={svgWidth - padding.right}
                y2={y}
                stroke="rgba(15, 23, 42, 0.09)"
                strokeWidth="1"
              />
            );
          })}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const x = padding.left + innerWidth * ratio;
            return (
              <line
                key={`v-${ratio}`}
                x1={x}
                y1={padding.top}
                x2={x}
                y2={padding.top + innerHeight}
                stroke="rgba(15, 23, 42, 0.06)"
                strokeWidth="1"
              />
            );
          })}

          {regression ? (
            <line
              x1={xFor(regression.xMin)}
              y1={yFor(regression.yStart)}
              x2={xFor(regression.xMax)}
              y2={yFor(regression.yEnd)}
              stroke="#d6a34a"
              strokeWidth="3"
              strokeLinecap="round"
            />
          ) : null}

          {points.map((point) => {
            const isActive = point.date === resolvedActiveDate;
            return (
              <g key={`${point.date}-scatter`}>
                <circle
                  cx={xFor(point.attendance)}
                  cy={yFor(point.output)}
                  r={isActive ? 6 : 4.5}
                  fill={isActive ? '#0b5e58' : '#0f766e'}
                  stroke="white"
                  strokeWidth="2"
                />
                <circle
                  cx={xFor(point.attendance)}
                  cy={yFor(point.output)}
                  r={16}
                  fill="transparent"
                  tabIndex={0}
                  onMouseEnter={() => onActiveDateChange(point.date)}
                  onFocus={() => onActiveDateChange(point.date)}
                />
              </g>
            );
          })}

          <text
            x={padding.left + innerWidth / 2}
            y={svgHeight - 14}
            textAnchor="middle"
            fontSize="12"
            fill="rgba(15, 23, 42, 0.58)"
          >
            Asistencia
          </text>
          <text
            x={18}
            y={padding.top + innerHeight / 2}
            textAnchor="middle"
            fontSize="12"
            fill="rgba(15, 23, 42, 0.58)"
            transform={`rotate(-90 18 ${padding.top + innerHeight / 2})`}
          >
            {outputLabel}
          </text>

          {[0, 0.5, 1].map((ratio) => (
            <text
              key={`x-tick-${ratio}`}
              x={padding.left + innerWidth * ratio}
              y={svgHeight - 30}
              textAnchor="middle"
              fontSize="11"
              fill="rgba(15, 23, 42, 0.58)"
            >
              {formatInteger(xDomainMin + xSpan * ratio)}
            </text>
          ))}
          {[0, 0.5, 1].map((ratio) => (
            <text
              key={`y-tick-${ratio}`}
              x={padding.left - 10}
              y={yFor(yMax * ratio) + 4}
              textAnchor="end"
              fontSize="11"
              fill="rgba(15, 23, 42, 0.58)"
            >
              {outputFormatter(yMax * ratio)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
};

const DashboardLineAttendanceThroughput: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [fromDate, setFromDate] = useState<string>(() => loadStoredDateRange().fromDate);
  const [toDate, setToDate] = useState<string>(() => loadStoredDateRange().toDate);
  const [cecoSupervisorMaps, setCecoSupervisorMaps] = useState<CecoMappingByFamily>(
    () => loadStoredCecoMappings(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<ResponsePayload | null>(null);
  const [attendanceData, setAttendanceData] = useState<AttendancePayload | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');
  const [outputFamily, setOutputFamily] = useState<OutputFamily>('panels');
  const [panelMetric, setPanelMetric] = useState<PanelMetric>('count');
  const [selectedCohort, setSelectedCohort] = useState('');
  const [showMappings, setShowMappings] = useState(false);
  const [mappingTab, setMappingTab] = useState<MappingTab>('visible');
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('correlation');
  const [chartMode, setChartMode] = useState<ChartMode>('timeline');
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [fteStartTime, setFteStartTime] = useState('08:00');
  const [fteLunchMinutes, setFteLunchMinutes] = useState(30);
  const [fteOtherMinutes, setFteOtherMinutes] = useState(0);
  const [fteWeeklyHours, setFteWeeklyHours] = useState(42);
  const [fteCostCenterCodes, setFteCostCenterCodes] = useState<string[]>([]);
  const [activeFteCostCenterCode, setActiveFteCostCenterCode] = useState<string | null>(null);
  const [activeFtePersonIdentifier, setActiveFtePersonIdentifier] = useState<string | null>(null);
  const [showExtraHoursDetails, setShowExtraHoursDetails] = useState(false);
  const attendanceCacheRef = useRef<Map<string, AttendancePayload>>(new Map());
  const attendanceInFlightRef = useRef<Map<string, Promise<AttendancePayload>>>(new Map());
  const attendanceRequestSerialRef = useRef(0);
  const cecoSupervisorMap = cecoSupervisorMaps[outputFamily];

  useEffect(() => {
    setHeader({
      title: 'Asistencia y produccion',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    attendanceRequestSerialRef.current += 1;
    attendanceCacheRef.current.clear();
    attendanceInFlightRef.current.clear();
    setAttendanceData(null);
    setAttendanceLoading(false);
    setAttendanceError('');
    try {
      const params = new URLSearchParams({
        from_date: fromDate,
        to_date: toDate,
      });
      const payload = await apiRequest<ResponsePayload>(
        `/api/line-attendance-throughput/summary?${params.toString()}`,
        { timeoutMs: 45000 },
      );
      setData(payload);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'No se pudo cargar el dashboard.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(CECO_MAPPING_STORAGE_KEY, JSON.stringify(cecoSupervisorMaps));
  }, [cecoSupervisorMaps]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(
      DATE_RANGE_STORAGE_KEY,
      JSON.stringify({ fromDate, toDate }),
    );
  }, [fromDate, toDate]);

  const updateActiveCecoSupervisorMap = useCallback(
    (updater: (current: CecoMappingSet) => CecoMappingSet) => {
      setCecoSupervisorMaps((current) => ({
        ...current,
        [outputFamily]: updater(current[outputFamily] ?? {}),
      }));
    },
    [outputFamily],
  );

  const effectiveDashboard = useMemo<EffectiveDashboard | null>(() => {
    if (!data) {
      return null;
    }

    const supervisorNameById = new Map(data.supervisors.map((item) => [item.id, item.name]));
    const detectedCostCenters = new Set(data.buk_cost_centers.map((item) => item.cost_center_code));
    const sanitizedMap = Object.fromEntries(
      Object.entries(cecoSupervisorMap).filter(
        ([costCenterCode, supervisorId]) =>
          detectedCostCenters.has(costCenterCode) &&
          (supervisorId === HIDDEN_CECO_MAPPING_VALUE || supervisorNameById.has(supervisorId)),
      ),
    ) as Record<string, CecoMappingValue>;

    const hiddenCostCenters = new Set(
      Object.entries(sanitizedMap)
        .filter(([, value]) => value === HIDDEN_CECO_MAPPING_VALUE)
        .map(([costCenterCode]) => costCenterCode),
    );

    const includedWorkerAssignments = data.worker_assignments.filter(
      (worker) =>
        !worker.buk_cost_center_code || !hiddenCostCenters.has(worker.buk_cost_center_code),
    );

    const resolvedSupervisorIdByWorkerId = new Map<number, number | null>();
    let resolvedByCeco = 0;
    let unresolvedAfterFallback = 0;

    for (const worker of includedWorkerAssignments) {
      const mappingValue = worker.buk_cost_center_code
        ? sanitizedMap[worker.buk_cost_center_code]
        : undefined;
      const resolvedSupervisorId =
        worker.direct_supervisor_id !== null
          ? worker.direct_supervisor_id
          : typeof mappingValue === 'number'
            ? mappingValue
            : null;
      resolvedSupervisorIdByWorkerId.set(worker.worker_id, resolvedSupervisorId);
      if (worker.direct_supervisor_id === null) {
        if (resolvedSupervisorId !== null) {
          resolvedByCeco += 1;
        } else {
          unresolvedAfterFallback += 1;
        }
      }
    }

    const mappedCostCenterCount = Object.entries(sanitizedMap).filter(
      ([, value]) => typeof value === 'number',
    ).length;
    const hiddenWorkerCount = data.worker_assignments.length - includedWorkerAssignments.length;
    const effectiveWarnings = [...data.warnings];

    if (
      data.coverage.buk_available &&
      data.buk_cost_centers.some(
        (item) =>
          item.fallback_candidate_worker_count > 0 && !hasOwn(sanitizedMap, item.cost_center_code),
      )
    ) {
      effectiveWarnings.push('local_ceco_mappings_missing');
    }

    return {
      coverage: {
        ...data.coverage,
        active_local_geo_linked_workers: includedWorkerAssignments.length,
        active_local_geo_linked_workers_matched_in_buk: includedWorkerAssignments.filter(
          (worker) => worker.buk_matched,
        ).length,
        active_local_geo_linked_workers_with_supervisor: includedWorkerAssignments.filter(
          (worker) => worker.direct_supervisor_id !== null,
        ).length,
        active_local_geo_linked_workers_without_supervisor: includedWorkerAssignments.filter(
          (worker) => worker.direct_supervisor_id === null,
        ).length,
        active_local_geo_linked_workers_resolved_by_ceco: resolvedByCeco,
        active_local_geo_linked_workers_unresolved_after_fallback: unresolvedAfterFallback,
        supervisor_cost_center_mappings: mappedCostCenterCount,
      },
      warnings: effectiveWarnings,
      sanitizedMap,
      hiddenCostCenterCount: hiddenCostCenters.size,
      hiddenWorkerCount,
    };
  }, [cecoSupervisorMap, data]);

  const productionDays = data?.days ?? EMPTY_DAYS;
  const weekdayDays = useMemo(
    () => productionDays.filter((day) => isWeekday(day.date)),
    [productionDays],
  );
  const costCenterDays = attendanceData?.buk_cost_center_days ?? EMPTY_COST_CENTER_DAYS;
  const coverage = effectiveDashboard?.coverage ?? data?.coverage ?? null;
  const warnings = useMemo(
    () =>
      [...(effectiveDashboard?.warnings ?? data?.warnings ?? []), ...(attendanceData?.warnings ?? [])]
        .filter(Boolean)
        .filter((warning, index, source) => source.indexOf(warning) === index),
    [attendanceData?.warnings, data?.warnings, effectiveDashboard?.warnings],
  );

  const outputMetric = useMemo<OutputMetricConfig>(() => {
    if (outputFamily === 'modules') {
      return {
        key: 'finished_module_count',
        label: 'Modulos terminados',
        shortLabel: 'modulos',
        format: formatInteger,
      };
    }
    if (panelMetric === 'area') {
      return {
        key: 'finished_panel_area_m2',
        label: 'm2 de paneles',
        shortLabel: 'm2',
        format: formatDecimal,
      };
    }
    if (panelMetric === 'linear') {
      return {
        key: 'finished_panel_linear_meters',
        label: 'm lineales de paneles',
        shortLabel: 'm lineales',
        format: formatDecimal,
      };
    }
    return {
      key: 'finished_panel_count',
      label: 'Paneles terminados',
      shortLabel: 'paneles',
      format: formatInteger,
    };
  }, [outputFamily, panelMetric]);

  const visibleCostCenters = useMemo(
    () =>
      (data?.buk_cost_centers ?? []).filter(
        (item) =>
          item.buk_people_count > 0 &&
          effectiveDashboard?.sanitizedMap[item.cost_center_code] !== HIDDEN_CECO_MAPPING_VALUE,
      ),
    [data?.buk_cost_centers, effectiveDashboard?.sanitizedMap],
  );
  const fteEligibleCostCenters = useMemo(
    () =>
      visibleCostCenters.filter(
        (item) => typeof effectiveDashboard?.sanitizedMap[item.cost_center_code] === 'number',
      ),
    [effectiveDashboard?.sanitizedMap, visibleCostCenters],
  );

  const cohortOptions = useMemo<CohortOption[]>(() => {
    const visibleCodes = visibleCostCenters.map((item) => item.cost_center_code);
    const options: CohortOption[] = [
      {
        value: 'all',
        label: 'Todos los CECOs visibles',
        helper: `${formatInteger(
          visibleCostCenters.reduce((sum, item) => sum + item.buk_people_count, 0),
        )} personas / ${formatInteger(visibleCostCenters.length)} CECOs`,
        costCenterCodes: visibleCodes,
        kind: 'all',
      },
    ];

    const costCentersBySupervisor = new Map<number, string[]>();
    for (const item of visibleCostCenters) {
      const mappingValue = effectiveDashboard?.sanitizedMap[item.cost_center_code];
      if (typeof mappingValue !== 'number') {
        continue;
      }
      const bucket = costCentersBySupervisor.get(mappingValue) ?? [];
      bucket.push(item.cost_center_code);
      costCentersBySupervisor.set(mappingValue, bucket);
    }

    for (const supervisor of data?.supervisors ?? []) {
      const costCenterCodes = costCentersBySupervisor.get(supervisor.id) ?? [];
      if (!costCenterCodes.length) {
        continue;
      }
      const cohortPeopleCount = visibleCostCenters
        .filter((item) => costCenterCodes.includes(item.cost_center_code))
        .reduce((sum, item) => sum + item.buk_people_count, 0);
      options.push({
        value: `supervisor:${supervisor.id}`,
        label: supervisor.name,
        helper: `${formatInteger(cohortPeopleCount)} personas / ${formatInteger(
          costCenterCodes.length,
        )} CECOs`,
        costCenterCodes,
        kind: 'supervisor',
      });
    }

    for (const item of visibleCostCenters) {
      options.push({
        value: `ceco:${item.cost_center_code}`,
        label: formatCostCenterLabel(item.cost_center_code, item.cost_center_name),
        helper: `${formatInteger(item.buk_people_count)} personas`,
        costCenterCodes: [item.cost_center_code],
        kind: 'cost_center',
      });
    }

    return options;
  }, [data?.supervisors, effectiveDashboard?.sanitizedMap, visibleCostCenters]);

  useEffect(() => {
    if (!cohortOptions.length) {
      return;
    }
    if (cohortOptions.some((option) => option.value === selectedCohort)) {
      return;
    }
    setSelectedCohort(
      cohortOptions.find((option) => option.kind !== 'all')?.value ?? cohortOptions[0].value,
    );
  }, [cohortOptions, selectedCohort]);

  const selectedCohortOption = useMemo(
    () => cohortOptions.find((option) => option.value === selectedCohort) ?? null,
    [cohortOptions, selectedCohort],
  );

  const selectedCostCenterCodes = useMemo(
    () => [...new Set(selectedCohortOption?.costCenterCodes ?? [])].sort(),
    [selectedCohortOption],
  );
  const selectedFteCostCenterCodes = useMemo(
    () =>
      selectedCostCenterCodes.filter(
        (code) => typeof effectiveDashboard?.sanitizedMap[code] === 'number',
      ),
    [effectiveDashboard?.sanitizedMap, selectedCostCenterCodes],
  );
  const selectedCostCenterCodeSet = useMemo(
    () => new Set(selectedCostCenterCodes),
    [selectedCostCenterCodes],
  );
  useEffect(() => {
    setFteCostCenterCodes(selectedFteCostCenterCodes);
  }, [selectedFteCostCenterCodes]);

  const requestedAttendanceCostCenterCodes = useMemo(
    () => [...new Set([...selectedCostCenterCodes, ...fteCostCenterCodes])].sort(),
    [fteCostCenterCodes, selectedCostCenterCodes],
  );

  const attendanceRequestKey = useMemo(
    () =>
      requestedAttendanceCostCenterCodes.length
        ? `${fromDate}__${toDate}__${requestedAttendanceCostCenterCodes.join(',')}`
        : '',
    [fromDate, requestedAttendanceCostCenterCodes, toDate],
  );

  const loadAttendance = useCallback(async () => {
    const requestSerial = attendanceRequestSerialRef.current + 1;
    attendanceRequestSerialRef.current = requestSerial;

    if (!data || !requestedAttendanceCostCenterCodes.length || !attendanceRequestKey) {
      setAttendanceData(null);
      setAttendanceLoading(false);
      setAttendanceError('');
      return;
    }

    const cachedPayload = attendanceCacheRef.current.get(attendanceRequestKey);
    if (cachedPayload) {
      setAttendanceData(cachedPayload);
      setAttendanceLoading(false);
      setAttendanceError('');
      return;
    }

    setAttendanceLoading(true);
    setAttendanceError('');
    setAttendanceData(null);
    try {
      let request = attendanceInFlightRef.current.get(attendanceRequestKey);
      if (!request) {
        const params = new URLSearchParams({
          from_date: fromDate,
          to_date: toDate,
        });
        requestedAttendanceCostCenterCodes.forEach((code) => params.append('cost_center_code', code));
        request = apiRequest<AttendancePayload>(
          `/api/line-attendance-throughput/attendance?${params.toString()}`,
          { timeoutMs: 180000 },
        )
          .then((payload) => {
            attendanceCacheRef.current.set(attendanceRequestKey, payload);
            return payload;
          })
          .finally(() => {
            attendanceInFlightRef.current.delete(attendanceRequestKey);
          });
        attendanceInFlightRef.current.set(attendanceRequestKey, request);
      }

      const payload = await request;
      if (attendanceRequestSerialRef.current !== requestSerial) {
        return;
      }
      setAttendanceData(payload);
    } catch (err) {
      if (attendanceRequestSerialRef.current !== requestSerial) {
        return;
      }
      setAttendanceError(err instanceof Error ? err.message : 'No se pudo cargar la asistencia.');
    } finally {
      if (attendanceRequestSerialRef.current === requestSerial) {
        setAttendanceLoading(false);
      }
    }
  }, [attendanceRequestKey, data, fromDate, requestedAttendanceCostCenterCodes, toDate]);

  useEffect(() => {
    if (!data) {
      return;
    }
    void loadAttendance();
  }, [data, loadAttendance]);

  const selectedCohortPeopleCount = useMemo(
    () =>
      visibleCostCenters.reduce(
        (sum, item) =>
          sum +
          (selectedCostCenterCodeSet.has(item.cost_center_code) ? item.buk_people_count : 0),
        0,
      ),
    [selectedCostCenterCodeSet, visibleCostCenters],
  );

  const attendanceByDate = useMemo(() => {
    const totals = new Map<string, number>();
    if (!selectedCostCenterCodeSet.size) {
      return totals;
    }
    for (const row of costCenterDays) {
      if (!selectedCostCenterCodeSet.has(row.cost_center_code)) {
        continue;
      }
      totals.set(row.date, (totals.get(row.date) ?? 0) + row.present_people_count);
    }
    return totals;
  }, [costCenterDays, selectedCostCenterCodeSet]);

  const chartPoints = useMemo<ChartPoint[]>(
    () =>
      weekdayDays
        .map((day) => ({
          date: day.date,
          label: formatShortDate(day.date),
          attendance: attendanceByDate.get(day.date) ?? 0,
          output: Number(day[outputMetric.key] ?? 0),
        }))
        .filter((point) => point.attendance > 0 && point.output > 0),
    [attendanceByDate, outputMetric.key, weekdayDays],
  );
  const comparableDayCount = chartPoints.length;

  useEffect(() => {
    if (!chartPoints.length) {
      setActiveDate(null);
      return;
    }
    setActiveDate((current) => {
      if (current && chartPoints.some((point) => point.date === current)) {
        return current;
      }
      return chartPoints[chartPoints.length - 1].date;
    });
  }, [chartPoints]);

  const activePoint = useMemo(
    () =>
      chartPoints.find((point) => point.date === activeDate) ?? chartPoints[chartPoints.length - 1] ?? null,
    [activeDate, chartPoints],
  );
  const regressionSummary = useMemo(() => buildRegressionSummary(chartPoints), [chartPoints]);

  const rangeSummary = useMemo(() => {
    if (!chartPoints.length) {
      return {
        cohortPeopleCount: selectedCohortPeopleCount,
        averageAttendance: 0,
        totalOutput: 0,
        averageOutput: 0,
      };
    }
    const totalAttendance = chartPoints.reduce((sum, point) => sum + point.attendance, 0);
    const totalOutput = chartPoints.reduce((sum, point) => sum + point.output, 0);
    return {
      cohortPeopleCount: selectedCohortPeopleCount,
      averageAttendance: Math.round(totalAttendance / chartPoints.length),
      totalOutput,
      averageOutput: totalOutput / chartPoints.length,
    };
  }, [chartPoints, selectedCohortPeopleCount]);

  const fteCostCenterCodeSet = useMemo(() => new Set(fteCostCenterCodes), [fteCostCenterCodes]);
  const fteWorkdayCount = useMemo(() => weekdayDays.length, [weekdayDays]);
  const ftePeople = useMemo(
    () =>
      (attendanceData?.buk_people ?? []).filter((person) =>
        fteCostCenterCodeSet.has(person.cost_center_code),
      ),
    [attendanceData?.buk_people, fteCostCenterCodeSet],
  );
  const fteShiftDays = useMemo(
    () =>
      (attendanceData?.buk_person_shift_days ?? []).filter(
        (shift) => fteCostCenterCodeSet.has(shift.cost_center_code) && isWeekday(shift.date),
      ),
    [attendanceData?.buk_person_shift_days, fteCostCenterCodeSet],
  );
  const fteNetHoursByShiftKey = useMemo(() => {
    const totals = new Map<string, number>();
    for (const shift of fteShiftDays) {
      totals.set(
        `${shift.identifier}__${shift.date}`,
        estimateNetShiftHours(shift, fteStartTime, fteLunchMinutes, fteOtherMinutes),
      );
    }
    return totals;
  }, [fteLunchMinutes, fteOtherMinutes, fteShiftDays, fteStartTime]);
  const fteTotalNetHours = useMemo(
    () => [...fteNetHoursByShiftKey.values()].reduce((sum, value) => sum + value, 0),
    [fteNetHoursByShiftKey],
  );
  const ftePeopleByIdentifier = useMemo(
    () => new Map((attendanceData?.buk_people ?? []).map((person) => [person.identifier, person])),
    [attendanceData?.buk_people],
  );
  const fteDailyHours = Math.max(0.1, fteWeeklyHours / 5);
  const fteExtraHoursDetails = useMemo<FteExtraHoursDetail[]>(
    () =>
      fteShiftDays
        .map((shift) => {
          const netHours = fteNetHoursByShiftKey.get(`${shift.identifier}__${shift.date}`) ?? 0;
          return {
            shift,
            person: ftePeopleByIdentifier.get(shift.identifier) ?? null,
            netHours,
            extraHours: estimateExtraHours(netHours, fteDailyHours),
          };
        })
        .filter((item) => item.extraHours > 0)
        .sort((left, right) => {
          const dateOrder = right.shift.date.localeCompare(left.shift.date);
          if (dateOrder !== 0) {
            return dateOrder;
          }
          return right.extraHours - left.extraHours;
        }),
    [fteDailyHours, fteNetHoursByShiftKey, ftePeopleByIdentifier, fteShiftDays],
  );
  const fteTotalExtraHours = useMemo(
    () => fteExtraHoursDetails.reduce((sum, item) => sum + item.extraHours, 0),
    [fteExtraHoursDetails],
  );
  const fteTotalDays = fteTotalNetHours / fteDailyHours;
  const fteAverage = fteWorkdayCount > 0 ? fteTotalDays / fteWorkdayCount : 0;
  const fteRegularHours = Math.max(0, fteTotalNetHours - fteTotalExtraHours);
  const fteFormulaTooltip = `${formatDecimal(fteRegularHours)} h regulares + ${formatDecimal(
    fteTotalExtraHours,
  )} h extra / ${formatDecimal(fteDailyHours)} h dia / ${formatInteger(
    fteWorkdayCount,
  )} dias = ${formatDecimal(fteAverage)} FTE`;
  const fteCostCenterSummaries = useMemo<FteCostCenterSummary[]>(
    () =>
      visibleCostCenters
        .filter((costCenter) => fteCostCenterCodeSet.has(costCenter.cost_center_code))
        .map((costCenter) => {
          const shifts = fteShiftDays.filter(
            (shift) => shift.cost_center_code === costCenter.cost_center_code,
          );
          const netHours = shifts.reduce(
            (sum, shift) =>
              sum + (fteNetHoursByShiftKey.get(`${shift.identifier}__${shift.date}`) ?? 0),
            0,
          );
          const extraHours = shifts.reduce((sum, shift) => {
            const shiftNetHours =
              fteNetHoursByShiftKey.get(`${shift.identifier}__${shift.date}`) ?? 0;
            return sum + estimateExtraHours(shiftNetHours, fteDailyHours);
          }, 0);
          return {
            costCenter,
            peopleCount: ftePeople.filter(
              (person) => person.cost_center_code === costCenter.cost_center_code,
            ).length,
            presentDays: shifts.filter((shift) => shift.present).length,
            netHours,
            extraHours,
            fteDays: netHours / fteDailyHours,
            avgFte: fteWorkdayCount > 0 ? netHours / fteDailyHours / fteWorkdayCount : 0,
          };
        })
        .sort((left, right) => right.avgFte - left.avgFte),
    [
      fteCostCenterCodeSet,
      fteNetHoursByShiftKey,
      ftePeople,
      fteShiftDays,
      fteDailyHours,
      fteWorkdayCount,
      visibleCostCenters,
    ],
  );
  const activeFteCostCenter = useMemo(
    () =>
      visibleCostCenters.find((item) => item.cost_center_code === activeFteCostCenterCode) ?? null,
    [activeFteCostCenterCode, visibleCostCenters],
  );
  const activeFteCostCenterPeople = useMemo(
    () =>
      activeFteCostCenterCode
        ? (attendanceData?.buk_people ?? [])
            .filter((person) => person.cost_center_code === activeFteCostCenterCode)
            .sort((left, right) =>
              (left.person_name ?? left.identifier).localeCompare(
                right.person_name ?? right.identifier,
              ),
            )
        : [],
    [activeFteCostCenterCode, attendanceData?.buk_people],
  );
  const activeFtePerson = useMemo(
    () =>
      activeFtePersonIdentifier
        ? (attendanceData?.buk_people ?? []).find(
            (person) => person.identifier === activeFtePersonIdentifier,
          ) ?? null
        : null,
    [activeFtePersonIdentifier, attendanceData?.buk_people],
  );
  const activeFtePersonShifts = useMemo(
    () =>
      activeFtePersonIdentifier
        ? (attendanceData?.buk_person_shift_days ?? [])
            .filter((shift) => shift.identifier === activeFtePersonIdentifier && isWeekday(shift.date))
            .sort((left, right) => left.date.localeCompare(right.date))
        : [],
    [activeFtePersonIdentifier, attendanceData?.buk_person_shift_days],
  );

  const fallbackPendingCostCenterCount = useMemo(() => {
    const sanitizedMap = effectiveDashboard?.sanitizedMap ?? {};
    return (data?.buk_cost_centers ?? []).filter(
      (item) =>
        item.fallback_candidate_worker_count > 0 && !hasOwn(sanitizedMap, item.cost_center_code),
    ).length;
  }, [data?.buk_cost_centers, effectiveDashboard?.sanitizedMap]);

  const configurableCostCenters = useMemo(() => {
    const sanitizedMap = effectiveDashboard?.sanitizedMap ?? {};
    return [...visibleCostCenters].sort((left, right) => {
      const leftNeedsFallbackMapping =
        left.fallback_candidate_worker_count > 0 && !hasOwn(sanitizedMap, left.cost_center_code);
      const rightNeedsFallbackMapping =
        right.fallback_candidate_worker_count > 0 && !hasOwn(sanitizedMap, right.cost_center_code);
      if (leftNeedsFallbackMapping !== rightNeedsFallbackMapping) {
        return leftNeedsFallbackMapping ? -1 : 1;
      }

      const leftUnmapped = !hasOwn(sanitizedMap, left.cost_center_code);
      const rightUnmapped = !hasOwn(sanitizedMap, right.cost_center_code);
      if (leftUnmapped !== rightUnmapped) {
        return leftUnmapped ? -1 : 1;
      }

      if (left.buk_people_count !== right.buk_people_count) {
        return right.buk_people_count - left.buk_people_count;
      }

      return formatCostCenterLabel(left.cost_center_code, left.cost_center_name).localeCompare(
        formatCostCenterLabel(right.cost_center_code, right.cost_center_name),
      );
    });
  }, [effectiveDashboard?.sanitizedMap, visibleCostCenters]);

  const hiddenCostCenters = useMemo(
    () =>
      [...(data?.buk_cost_centers ?? [])]
        .filter(
          (item) =>
            effectiveDashboard?.sanitizedMap[item.cost_center_code] === HIDDEN_CECO_MAPPING_VALUE,
        )
        .sort((left, right) =>
          formatCostCenterLabel(left.cost_center_code, left.cost_center_name).localeCompare(
            formatCostCenterLabel(right.cost_center_code, right.cost_center_name),
          ),
        ),
    [data?.buk_cost_centers, effectiveDashboard?.sanitizedMap],
  );

  const unmappedVisibleCostCenterCount = useMemo(() => {
    const sanitizedMap = effectiveDashboard?.sanitizedMap ?? {};
    return visibleCostCenters.filter(
      (item) => !hasOwn(sanitizedMap, item.cost_center_code),
    ).length;
  }, [effectiveDashboard?.sanitizedMap, visibleCostCenters]);
  const mappingTabCostCenters = mappingTab === 'hidden' ? hiddenCostCenters : configurableCostCenters;
  const attendanceSeriesReady = Boolean(attendanceData) && !attendanceError;

  const warningText = warnings
    .map((warning) => WARNING_LABELS[warning] ?? warning)
    .filter(Boolean)
    .join('  ');

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-black/5 bg-white/90 px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-black/10 bg-[var(--paper)] px-3 py-1 text-xs text-[var(--ink-muted)]">
              Solo dias habiles
            </span>
            <span className="rounded-full border border-black/10 bg-[var(--paper)] px-3 py-1 text-xs text-[var(--ink-muted)]">
              {formatInteger(comparableDayCount)} dias comparables
            </span>
            <span className="rounded-full border border-black/10 bg-[var(--paper)] px-3 py-1 text-xs text-[var(--ink-muted)]">
              {coverage?.buk_available ? 'Fallback CECO activo' : 'Sin fallback CECO'}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-[var(--ink-muted)]">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.18em]">Desde</span>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <label className="text-sm text-[var(--ink-muted)]">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.18em]">Hasta</span>
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[auto_auto_minmax(260px,1fr)]">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Produccion</p>
            <div className="mt-2 inline-flex rounded-full border border-black/10 bg-[var(--paper)] p-1">
              <button
                type="button"
                onClick={() => setOutputFamily('panels')}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  outputFamily === 'panels'
                    ? 'bg-[var(--ink)] text-white shadow-sm'
                    : 'text-[var(--ink-muted)]'
                }`}
              >
                Paneles
              </button>
              <button
                type="button"
                onClick={() => setOutputFamily('modules')}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  outputFamily === 'modules'
                    ? 'bg-[var(--ink)] text-white shadow-sm'
                    : 'text-[var(--ink-muted)]'
                }`}
              >
                Modulos
              </button>
            </div>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Medida</p>
            {outputFamily === 'panels' ? (
              <div className="mt-2 inline-flex flex-wrap rounded-full border border-black/10 bg-[var(--paper)] p-1">
                {[
                  { value: 'count' as const, label: 'Cantidad' },
                  { value: 'area' as const, label: 'm2' },
                  { value: 'linear' as const, label: 'm lineales' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPanelMetric(option.value)}
                    className={`rounded-full px-4 py-2 text-sm transition ${
                      panelMetric === option.value
                        ? 'bg-white text-[var(--ink)] shadow-sm'
                        : 'text-[var(--ink-muted)]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-2 inline-flex rounded-full border border-black/10 bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)]">
                Cantidad de modulos
              </div>
            )}
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Cohorte</p>
            <label className="mt-2 block">
              <select
                value={selectedCohortOption?.value ?? 'all'}
                onChange={(event) => setSelectedCohort(event.target.value)}
                className="w-full rounded-2xl border border-black/10 bg-white px-3 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              >
                {cohortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.kind === 'supervisor'
                      ? `Supervisor: ${option.label}`
                      : option.kind === 'cost_center'
                        ? `CECO: ${option.label}`
                        : option.label}
                  </option>
                ))}
              </select>
            </label>
            {selectedCohortOption ? (
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
                {selectedCohortOption.helper}
                {attendanceLoading ? '  Cargando asistencia...' : ''}
              </p>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {!error && warningText ? (
          <div className="mt-4 inline-flex max-w-full items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/85 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{warningText}</span>
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Cohorte BUK"
          value={formatInteger(rangeSummary.cohortPeopleCount)}
          detail={selectedCohortOption?.label ?? 'Sin filtro'}
          tone="accent"
        />
        <SummaryCard
          label="Promedio asistencia"
          value={
            attendanceLoading
              ? '...'
              : attendanceError && !attendanceData
                ? '—'
                : formatInteger(rangeSummary.averageAttendance)
          }
          detail={`${formatInteger(comparableDayCount)} dias comparables`}
        />
        <SummaryCard
          label={`Total ${outputMetric.shortLabel}`}
          value={outputMetric.format(rangeSummary.totalOutput)}
          detail={`Promedio diario ${outputMetric.format(rangeSummary.averageOutput)}`}
        />
        <SummaryCard
          label="Sin resolver"
          value={formatInteger(coverage?.active_local_geo_linked_workers_unresolved_after_fallback)}
          detail={
            fallbackPendingCostCenterCount > 0
              ? `${formatInteger(fallbackPendingCostCenterCount)} CECOs pendientes para fallback`
              : 'Sin pendientes por fallback'
          }
          tone={
            Number(coverage?.active_local_geo_linked_workers_unresolved_after_fallback ?? 0) > 0
              ? 'warning'
              : 'default'
          }
        />
      </section>

      <div className="inline-flex rounded-full border border-black/10 bg-white/90 p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setAnalysisTab('correlation')}
          className={`rounded-full px-4 py-2 text-sm transition ${
            analysisTab === 'correlation'
              ? 'bg-[var(--ink)] text-white shadow-sm'
              : 'text-[var(--ink-muted)]'
          }`}
        >
          Correlacion
        </button>
        <button
          type="button"
          onClick={() => setAnalysisTab('fte')}
          className={`rounded-full px-4 py-2 text-sm transition ${
            analysisTab === 'fte'
              ? 'bg-[var(--ink)] text-white shadow-sm'
              : 'text-[var(--ink-muted)]'
          }`}
        >
          FTE
        </button>
      </div>

      {analysisTab === 'correlation' ? (
      <section className="rounded-3xl border border-black/5 bg-white/92 px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Correlacion diaria
            </p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">
              Asistencia vs {outputMetric.label.toLowerCase()}
            </h2>
            <div className="mt-4 inline-flex rounded-full border border-black/10 bg-[var(--paper)] p-1">
              <button
                type="button"
                onClick={() => setChartMode('timeline')}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  chartMode === 'timeline'
                    ? 'bg-[var(--ink)] text-white shadow-sm'
                    : 'text-[var(--ink-muted)]'
                }`}
              >
                Serie
              </button>
              <button
                type="button"
                onClick={() => setChartMode('scatter')}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  chartMode === 'scatter'
                    ? 'bg-[var(--ink)] text-white shadow-sm'
                    : 'text-[var(--ink-muted)]'
                }`}
              >
                Dispersion
              </button>
            </div>
          </div>
          {attendanceSeriesReady ? (
            <div className="flex flex-wrap items-stretch justify-end gap-3">
              {chartMode === 'scatter' ? (
                <div className="rounded-2xl border border-black/10 bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)]">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    Regresion
                  </div>
                  {regressionSummary ? (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      <span>pendiente {formatPreciseDecimal(regressionSummary.slope)}</span>
                      <span>R² {formatPreciseDecimal(regressionSummary.rSquared)}</span>
                    </div>
                  ) : (
                    <div className="mt-2 text-[var(--ink-muted)]">
                      Hace falta mas variacion para ajustar una recta.
                    </div>
                  )}
                </div>
              ) : null}

              {activePoint ? (
                <div className="rounded-2xl border border-black/10 bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)]">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    {formatLongDate(activePoint.date)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    <span>{formatInteger(activePoint.attendance)} en asistencia</span>
                    <span>{outputMetric.format(activePoint.output)} {outputMetric.shortLabel}</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {attendanceError ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/85 px-4 py-3 text-sm text-amber-900">
            {attendanceError}
          </div>
        ) : null}

        <div className="mt-6">
          {attendanceLoading && !attendanceData ? (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-8 text-sm text-[var(--ink-muted)]">
              Cargando asistencia del cohorte seleccionado.
            </div>
          ) : !attendanceSeriesReady ? (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-8 text-sm text-[var(--ink-muted)]">
              No hay asistencia disponible para este cohorte.
            </div>
          ) : chartMode === 'scatter' ? (
            <ScatterRegressionChart
              points={chartPoints}
              outputLabel={outputMetric.label}
              outputFormatter={outputMetric.format}
              regression={regressionSummary}
              activeDate={activeDate}
              onActiveDateChange={setActiveDate}
            />
          ) : (
            <ComparisonChart
              points={chartPoints}
              outputLabel={outputMetric.label}
              outputFormatter={outputMetric.format}
              activeDate={activeDate}
              onActiveDateChange={setActiveDate}
            />
          )}
        </div>
      </section>
      ) : (
      <section className="rounded-3xl border border-black/5 bg-white/92 px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              FTE estimado
            </p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">
              Jornadas por CECO
            </h2>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-[var(--ink-muted)]">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.18em]">Desde hora</span>
              <input
                type="time"
                value={fteStartTime}
                onChange={(event) => setFteStartTime(event.target.value)}
                className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <label className="text-sm text-[var(--ink-muted)]">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.18em]">Colacion min</span>
              <input
                type="number"
                min="0"
                value={fteLunchMinutes}
                onChange={(event) => setFteLunchMinutes(Math.max(0, Number(event.target.value) || 0))}
                className="w-28 rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <label className="text-sm text-[var(--ink-muted)]">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.18em]">Otros min</span>
              <input
                type="number"
                min="0"
                value={fteOtherMinutes}
                onChange={(event) => setFteOtherMinutes(Math.max(0, Number(event.target.value) || 0))}
                className="w-28 rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <label className="text-sm text-[var(--ink-muted)]">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.18em]">Horas semana</span>
              <input
                type="number"
                min="1"
                step="0.5"
                value={fteWeeklyHours}
                onChange={(event) => setFteWeeklyHours(Math.max(0.1, Number(event.target.value) || 42))}
                className="w-32 rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <SummaryCard
            label="FTE promedio"
            value={formatDecimal(fteAverage)}
            detail={`${formatDecimal(fteDailyHours)} h/dia base`}
            tone="accent"
            tooltip={fteFormulaTooltip}
          />
          <SummaryCard
            label="Horas netas"
            value={formatDecimal(fteTotalNetHours)}
            detail={`${formatDecimal(fteTotalDays)} jornadas FTE`}
          />
          <SummaryCard
            label="Horas extra"
            value={formatDecimal(fteTotalExtraHours)}
            detail={`${formatInteger(fteExtraHoursDetails.length)} marcas sobre ${formatDecimal(fteDailyHours)} h`}
            tone={fteTotalExtraHours > 0 ? 'warning' : 'default'}
            onClick={() => setShowExtraHoursDetails(true)}
          />
          <SummaryCard
            label="Personas"
            value={formatInteger(ftePeople.length)}
            detail={`${formatInteger(fteCostCenterCodes.length)} CECOs`}
          />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {fteEligibleCostCenters.map((item) => {
            const selected = fteCostCenterCodeSet.has(item.cost_center_code);
            return (
              <button
                key={item.cost_center_code}
                type="button"
                onClick={() =>
                  setFteCostCenterCodes((current) =>
                    selected
                      ? current.filter((code) => code !== item.cost_center_code)
                      : [...current, item.cost_center_code].sort(),
                  )
                }
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  selected
                    ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                    : 'border-black/10 bg-[var(--paper)] text-[var(--ink-muted)]'
                }`}
              >
                {formatCostCenterLabel(item.cost_center_code, item.cost_center_name)}
              </button>
            );
          })}
          {fteEligibleCostCenters.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-3 text-sm text-[var(--ink-muted)]">
              Asigna un supervisor local a un CECO para incluirlo en FTE.
            </div>
          ) : null}
        </div>

        <div className="mt-6">
          {attendanceLoading && !attendanceData ? (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-8 text-sm text-[var(--ink-muted)]">
              Cargando turnos del cohorte seleccionado.
            </div>
          ) : !attendanceData ? (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-8 text-sm text-[var(--ink-muted)]">
              No hay turnos disponibles para este cohorte.
            </div>
          ) : fteCostCenterSummaries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-8 text-sm text-[var(--ink-muted)]">
              Selecciona al menos un CECO.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-black/10">
                <div className="grid grid-cols-[minmax(180px,1fr)_repeat(5,minmax(84px,112px))] bg-[var(--paper)] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                <span>CECO</span>
                <span className="text-right">Personas</span>
                <span className="text-right">Presentes</span>
                <span className="text-right">Horas</span>
                <span className="text-right">Extra</span>
                <span className="text-right" title="FTE prom. = horas netas / horas base del dia / dias habiles">
                  FTE prom.
                </span>
              </div>
              {fteCostCenterSummaries.map((summary) => (
                <button
                  key={summary.costCenter.cost_center_code}
                  type="button"
                  onClick={() => setActiveFteCostCenterCode(summary.costCenter.cost_center_code)}
                  className="grid w-full grid-cols-[minmax(180px,1fr)_repeat(5,minmax(84px,112px))] border-t border-black/5 px-4 py-3 text-left text-sm transition hover:bg-[var(--paper)]"
                >
                  <span className="font-medium text-[var(--ink)]">
                    {formatCostCenterLabel(
                      summary.costCenter.cost_center_code,
                      summary.costCenter.cost_center_name,
                    )}
                  </span>
                  <span className="text-right text-[var(--ink-muted)]">{formatInteger(summary.peopleCount)}</span>
                  <span className="text-right text-[var(--ink-muted)]">{formatInteger(summary.presentDays)}</span>
                  <span className="text-right text-[var(--ink-muted)]">{formatDecimal(summary.netHours)}</span>
                  <span className="text-right text-[var(--ink-muted)]">{formatDecimal(summary.extraHours)}</span>
                  <span
                    className="text-right font-semibold text-[var(--ink)]"
                    title={`${formatDecimal(Math.max(0, summary.netHours - summary.extraHours))} h regulares + ${formatDecimal(
                      summary.extraHours,
                    )} h extra / ${formatDecimal(fteDailyHours)} h dia / ${formatInteger(
                      fteWorkdayCount,
                    )} dias = ${formatDecimal(summary.avgFte)} FTE`}
                  >
                    {formatDecimal(summary.avgFte)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
      )}

      <section className="rounded-3xl border border-black/5 bg-white/92 px-6 py-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              Vinculos CECO
            </p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">Cohorte y fallback</h2>
            <div className="mt-2 inline-flex rounded-full border border-black/10 bg-[var(--paper)] px-3 py-1 text-xs text-[var(--ink-muted)]">
              {outputFamily === 'modules' ? 'Mappings de modulos' : 'Mappings de paneles'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowMappings((current) => !current)}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-[var(--paper)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink)]"
          >
            <Link2 className="h-3.5 w-3.5" />
            {unmappedVisibleCostCenterCount > 0
              ? `${formatInteger(unmappedVisibleCostCenterCount)} sin vinculo`
              : 'Ver mappings'}
            <ChevronDown className={`h-4 w-4 transition ${showMappings ? 'rotate-180' : ''}`} />
          </button>
        </div>

        <div className="mt-3 text-sm text-[var(--ink-muted)]">
          {unmappedVisibleCostCenterCount > 0
            ? `${formatInteger(unmappedVisibleCostCenterCount)} CECOs visibles aun no tienen supervisor asignado. ${formatInteger(fallbackPendingCostCenterCount)} se necesitan para fallback local.`
            : coverage?.active_local_geo_linked_workers_resolved_by_ceco
              ? `${formatInteger(coverage.active_local_geo_linked_workers_resolved_by_ceco)} trabajadores ya entran por fallback CECO.`
              : 'Todos los CECOs visibles ya tienen supervisor asignado.'}
        </div>

        {showMappings ? (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-[var(--ink-muted)]">
                {formatInteger(effectiveDashboard?.hiddenCostCenterCount)} CECOs ocultos y{' '}
                {formatInteger(effectiveDashboard?.hiddenWorkerCount)} trabajadores fuera del analisis
              </div>
              <button
                type="button"
                onClick={() => updateActiveCecoSupervisorMap(() => ({}))}
                className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink)]"
              >
                Limpiar
              </button>
            </div>

            <div className="inline-flex rounded-full border border-black/10 bg-[var(--paper)] p-1">
              <button
                type="button"
                onClick={() => setMappingTab('visible')}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  mappingTab === 'visible'
                    ? 'bg-[var(--ink)] text-white shadow-sm'
                    : 'text-[var(--ink-muted)]'
                }`}
              >
                Visibles ({formatInteger(configurableCostCenters.length)})
              </button>
              <button
                type="button"
                onClick={() => setMappingTab('hidden')}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  mappingTab === 'hidden'
                    ? 'bg-[var(--ink)] text-white shadow-sm'
                    : 'text-[var(--ink-muted)]'
                }`}
              >
                Ocultos ({formatInteger(hiddenCostCenters.length)})
              </button>
            </div>

            {!data?.coverage.buk_available ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
                BUK no esta disponible en este entorno.
              </div>
            ) : mappingTabCostCenters.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
                {mappingTab === 'hidden'
                  ? 'No hay CECOs ocultos actualmente.'
                  : 'No hay CECOs visibles para este rango.'}
              </div>
            ) : (
              mappingTabCostCenters.map((item) => {
                const currentValue = effectiveDashboard?.sanitizedMap[item.cost_center_code] ?? '';
                const isUnmapped = !hasOwn(
                  effectiveDashboard?.sanitizedMap ?? {},
                  item.cost_center_code,
                );
                const needsFallbackMapping =
                  item.fallback_candidate_worker_count > 0 && isUnmapped;

                return (
                  <article
                    key={item.cost_center_code}
                    className={`rounded-2xl border px-4 py-4 ${
                      needsFallbackMapping
                        ? 'border-amber-200 bg-amber-50/70'
                        : isUnmapped
                          ? 'border-black/10 bg-white/90'
                        : 'border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(247,249,252,0.97))]'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[var(--ink)]">
                          {formatCostCenterLabel(item.cost_center_code, item.cost_center_name)}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
                          <span>{formatInteger(item.buk_people_count)} BUK</span>
                          <span>{formatInteger(item.matched_local_worker_count)} locales</span>
                          {item.fallback_candidate_worker_count > 0 ? (
                            <span>{formatInteger(item.fallback_candidate_worker_count)} sin supervisor</span>
                          ) : null}
                          {isUnmapped && !needsFallbackMapping ? <span>sin vinculo</span> : null}
                        </div>
                      </div>

                      <label className="min-w-[220px] text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                        Supervisor local
                        <select
                          className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                          value={currentValue}
                          onChange={(event) => {
                            const { value } = event.target;
                            updateActiveCecoSupervisorMap((current) => {
                              const next = { ...current };
                              if (!value) {
                                delete next[item.cost_center_code];
                                return next;
                              }
                              if (value === HIDDEN_CECO_MAPPING_VALUE) {
                                next[item.cost_center_code] = HIDDEN_CECO_MAPPING_VALUE;
                                return next;
                              }
                              next[item.cost_center_code] = Number(value);
                              return next;
                            });
                          }}
                        >
                          <option value="">Sin mapping</option>
                          <option value={HIDDEN_CECO_MAPPING_VALUE}>No incluir</option>
                          {(data?.supervisors ?? []).map((supervisor) => (
                            <option key={supervisor.id} value={supervisor.id}>
                              {supervisor.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        ) : null}
      </section>

      {activeFteCostCenter ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 px-4 py-6">
          <div className="max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-black/10 px-5 py-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                  CECO
                </p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--ink)]">
                  {formatCostCenterLabel(
                    activeFteCostCenter.cost_center_code,
                    activeFteCostCenter.cost_center_name,
                  )}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveFteCostCenterCode(null)}
                className="rounded-full border border-black/10 p-2 text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto px-5 py-4">
              {activeFteCostCenterPeople.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-black/10 px-4 py-8 text-sm text-[var(--ink-muted)]">
                  No hay personas BUK para este CECO.
                </div>
              ) : (
                <div className="divide-y divide-black/5 rounded-2xl border border-black/10">
                  {activeFteCostCenterPeople.map((person) => {
                    const shifts = (attendanceData?.buk_person_shift_days ?? []).filter(
                      (shift) => shift.identifier === person.identifier && isWeekday(shift.date),
                    );
                    const netHours = shifts.reduce(
                      (sum, shift) =>
                        sum +
                        estimateNetShiftHours(
                          shift,
                          fteStartTime,
                          fteLunchMinutes,
                          fteOtherMinutes,
                        ),
                      0,
                    );
                    const extraHours = shifts.reduce(
                      (sum, shift) =>
                        sum +
                        estimateExtraHours(
                          estimateNetShiftHours(
                            shift,
                            fteStartTime,
                            fteLunchMinutes,
                            fteOtherMinutes,
                          ),
                          fteDailyHours,
                        ),
                      0,
                    );
                    return (
                      <button
                        key={person.identifier}
                        type="button"
                        onClick={() => setActiveFtePersonIdentifier(person.identifier)}
                        className="grid w-full grid-cols-[minmax(180px,1fr)_90px_90px_90px] gap-3 px-4 py-3 text-left text-sm transition hover:bg-[var(--paper)]"
                      >
                        <span>
                          <span className="block font-medium text-[var(--ink)]">
                            {person.person_name ?? person.identifier}
                          </span>
                          <span className="text-xs text-[var(--ink-muted)]">{person.identifier}</span>
                        </span>
                        <span className="text-right text-[var(--ink-muted)]">
                          {formatInteger(shifts.filter((shift) => shift.present).length)} dias
                        </span>
                        <span className="text-right font-semibold text-[var(--ink)]">
                          {formatDecimal(netHours)} h
                        </span>
                        <span className="text-right text-[var(--ink-muted)]">
                          {formatDecimal(extraHours)} extra
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {activeFtePerson ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
          <div className="max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-black/10 px-5 py-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                  Persona
                </p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--ink)]">
                  {activeFtePerson.person_name ?? activeFtePerson.identifier}
                </h3>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  {formatCostCenterLabel(
                    activeFtePerson.cost_center_code,
                    activeFtePerson.cost_center_name,
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveFtePersonIdentifier(null)}
                className="rounded-full border border-black/10 p-2 text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto px-5 py-4">
              <div className="overflow-hidden rounded-2xl border border-black/10">
                <div className="grid grid-cols-[120px_repeat(4,minmax(80px,1fr))] bg-[var(--paper)] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  <span>Dia</span>
                  <span className="text-right">Entrada</span>
                  <span className="text-right">Salida</span>
                  <span className="text-right">Neto</span>
                  <span className="text-right">Estado</span>
                </div>
                {activeFtePersonShifts.map((shift) => {
                  const netHours = estimateNetShiftHours(
                    shift,
                    fteStartTime,
                    fteLunchMinutes,
                    fteOtherMinutes,
                  );
                  const extraHours = estimateExtraHours(netHours, fteDailyHours);
                  return (
                    <div
                      key={`${shift.identifier}-${shift.date}`}
                      className="grid grid-cols-[120px_repeat(4,minmax(80px,1fr))] border-t border-black/5 px-4 py-3 text-sm"
                    >
                      <span className="font-medium text-[var(--ink)]">{formatShortDate(shift.date)}</span>
                      <span className="text-right text-[var(--ink-muted)]">{formatClock(shift.first_entry)}</span>
                      <span className="text-right text-[var(--ink-muted)]">{formatClock(shift.last_exit)}</span>
                      <span className="text-right font-semibold text-[var(--ink)]">
                        {formatDecimal(netHours)} h
                        {extraHours > 0 ? ` / ${formatDecimal(extraHours)} extra` : ''}
                      </span>
                      <span className="text-right text-[var(--ink-muted)]">
                        {shift.present ? 'Presente' : 'Sin marca'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showExtraHoursDetails ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
          <div className="max-h-[86vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-black/10 px-5 py-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                  Horas extra
                </p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--ink)]">
                  {formatDecimal(fteTotalExtraHours)} h sobre {formatDecimal(fteDailyHours)} h/dia
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowExtraHoursDetails(false)}
                className="rounded-full border border-black/10 p-2 text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto px-5 py-4">
              {fteExtraHoursDetails.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-black/10 px-4 py-8 text-sm text-[var(--ink-muted)]">
                  No hay marcas con horas extra.
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-black/10">
                  <div className="grid grid-cols-[120px_minmax(180px,1fr)_minmax(140px,1fr)_repeat(4,minmax(74px,92px))] bg-[var(--paper)] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    <span>Dia</span>
                    <span>Persona</span>
                    <span>CECO</span>
                    <span className="text-right">Entrada</span>
                    <span className="text-right">Salida</span>
                    <span className="text-right">Neto</span>
                    <span className="text-right">Extra</span>
                  </div>
                  {fteExtraHoursDetails.map((item) => (
                    <button
                      key={`${item.shift.identifier}-${item.shift.date}`}
                      type="button"
                      onClick={() => setActiveFtePersonIdentifier(item.shift.identifier)}
                      className="grid w-full grid-cols-[120px_minmax(180px,1fr)_minmax(140px,1fr)_repeat(4,minmax(74px,92px))] border-t border-black/5 px-4 py-3 text-left text-sm transition hover:bg-[var(--paper)]"
                    >
                      <span className="font-medium text-[var(--ink)]">{formatShortDate(item.shift.date)}</span>
                      <span>
                        <span className="block font-medium text-[var(--ink)]">
                          {item.person?.person_name ?? item.shift.person_name ?? item.shift.identifier}
                        </span>
                        <span className="text-xs text-[var(--ink-muted)]">{item.shift.identifier}</span>
                      </span>
                      <span className="text-[var(--ink-muted)]">
                        {formatCostCenterLabel(item.shift.cost_center_code, item.shift.cost_center_name)}
                      </span>
                      <span className="text-right text-[var(--ink-muted)]">{formatClock(item.shift.first_entry)}</span>
                      <span className="text-right text-[var(--ink-muted)]">{formatClock(item.shift.last_exit)}</span>
                      <span className="text-right text-[var(--ink-muted)]">{formatDecimal(item.netHours)}</span>
                      <span className="text-right font-semibold text-[var(--ink)]">{formatDecimal(item.extraHours)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default DashboardLineAttendanceThroughput;
