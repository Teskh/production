import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Filter,
  FlaskConical,
  RefreshCcw,
  Sliders,
  Users,
} from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';
import { formatDateTime, formatMinutesWithUnit } from '../../../utils/timeUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type HouseType = {
  id: number;
  name: string;
  number_of_modules: number;
};

type PanelDefinition = {
  id: number;
  house_type_id: number;
  module_sequence_number: number;
  panel_sequence_number: number | null;
  group: string;
  panel_code: string;
  panel_area?: number | null;
  panel_length_m?: number | null;
  applicable_task_ids: number[] | null;
};

type TaskScope = 'panel' | 'module' | 'aux';

type TaskDefinition = {
  id: number;
  name: string;
  scope: TaskScope;
  active: boolean;
  default_station_sequence: number | null;
};

type Worker = {
  id: number;
  first_name: string;
  last_name: string;
};

type Station = {
  id: number;
  name: string;
  sequence_order: number | null;
};

type TaskBreakdownRow = {
  task_definition_id?: number | null;
  task_name?: string | null;
  duration_minutes?: number | null;
  expected_minutes?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  worker_name?: string | null;
  pause_minutes?: number | null;
  pauses?: {
    paused_at?: string | null;
    resumed_at?: string | null;
    duration_minutes?: number | null;
    duration_seconds?: number | null;
    reason?: string | null;
  }[] | null;
};

type DataTableSortKey = 'plan' | 'duration' | 'expected' | 'ratio' | 'completed' | 'worker';
type DataTableSortDirection = 'asc' | 'desc';

type AnalysisPoint = {
  plan_id?: number | null;
  house_identifier?: string | null;
  module_number?: number | null;
  task_definition_id?: number | null;
  task_name?: string | null;
  duration_minutes?: number | null;
  expected_minutes?: number | null;
  completed_at?: string | null;
  worker_name?: string | null;
  task_breakdown?: TaskBreakdownRow[] | null;
};

type AnalysisStats = {
  average_duration?: number | null;
};

type TaskAnalysisResponse = {
  mode?: 'panel' | 'task' | 'station' | string;
  data_points?: AnalysisPoint[] | null;
  expected_reference_minutes?: number | null;
  stats?: AnalysisStats | null;
};

type StationPanelsFinishedPanel = {
  plan_id?: number | null;
  panel_definition_id?: number | null;
  panel_code?: string | null;
  panel_area?: number | null;
  station_finished_at?: string | null;
  finished_at?: string | null;
  actual_minutes?: number | null;
};

type StationPanelsFinishedModule = {
  module_number?: number | null;
  panels?: StationPanelsFinishedPanel[] | null;
};

type StationPanelsFinishedHouse = {
  house_identifier?: string | null;
  house_type_id?: number | null;
  house_type_name?: string | null;
  modules?: StationPanelsFinishedModule[] | null;
};

type StationPanelsFinishedResponse = {
  total_panels_finished?: number | null;
  houses?: StationPanelsFinishedHouse[] | null;
};

type NormalizedMetric = 'linear' | 'area';

type NormalizedCompletionRow = {
  id: string;
  panel_definition_id: number;
  house_type_id: number | null;
  house_type_name: string;
  panel_label: string;
  panel_group: string;
  panel_area: number;
  panel_length_m: number;
  actual_minutes: number;
  normalized_minutes: number;
  finished_at: string | null;
};

type PanelGroupOption = {
  id: string;
  label: string;
  count: number;
};

type HypothesisField = 'worker' | 'date';

type HypothesisOperator = '==' | '!=' | '>' | '>=' | '<' | '<=';

type HypothesisConfig = {
  field: HypothesisField;
  operator: HypothesisOperator;
  value: string;
};

type HypothesisFieldOption = {
  value: HypothesisField;
  label: string;
  operators: { value: HypothesisOperator; label: string }[];
};

type HistogramBin = {
  index: number;
  from: number;
  to: number;
  count: number;
  items: AnalysisPoint[];
  matchCount: number;
};

type HistogramSummary = {
  bins: HistogramBin[];
  maxCount: number;
  binSize: number;
  maxDuration: number;
  totalMatches: number;
};

type NormalizedHistogramBin = {
  index: number;
  from: number;
  to: number;
  count: number;
  items: NormalizedCompletionRow[];
};

type NormalizedHistogramSummary = {
  bins: NormalizedHistogramBin[];
  maxCount: number;
  binSize: number;
  maxValue: number;
};

type RegressionSample = {
  x: number;
  y: number;
};

type RegressionConfidencePoint = {
  x: number;
  predictedY: number;
  lowerY: number;
  upperY: number;
};

type LinearRegressionResult = {
  sampleCount: number;
  slope: number;
  intercept: number;
  correlation: number | null;
  rSquared: number | null;
  adjustedRSquared: number | null;
  rmse: number;
  mae: number;
  meanX: number;
  meanY: number;
  minX: number;
  maxX: number;
  startPredictedY: number;
  endPredictedY: number;
  confidenceBand: RegressionConfidencePoint[] | null;
};

const DEFAULT_BIN_SIZE = 2;
const DEFAULT_MIN_MULTIPLIER = 0.5;
const DEFAULT_MAX_MULTIPLIER = 2;
const DEFAULT_NORMALIZED_BIN_SIZE = 0.5;
const DEFAULT_HYPOTHESIS_FORM: HypothesisConfig = { field: 'worker', operator: '==', value: '' };

const HYPOTHESIS_FIELD_OPTIONS: HypothesisFieldOption[] = [
  {
    value: 'worker',
    label: 'Trabajador',
    operators: [{ value: '==', label: '=' }],
  },
  {
    value: 'date',
    label: 'Fecha',
    operators: [
      { value: '==', label: '=' },
      { value: '!=', label: '!=' },
      { value: '>', label: '>' },
      { value: '>=', label: '>=' },
      { value: '<', label: '<' },
      { value: '<=', label: '<=' },
    ],
  },
];

const getHypothesisFieldConfig = (field: HypothesisField) =>
  HYPOTHESIS_FIELD_OPTIONS.find((item) => item.value === field) || HYPOTHESIS_FIELD_OPTIONS[0];

const parseTaskIds = (raw: unknown): number[] | null => {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return raw.map((val) => Number(val)).filter((val) => Number.isFinite(val));
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((val) => Number(val)).filter((val) => Number.isFinite(val));
      }
    } catch {
      return raw
        .split(',')
        .map((val) => Number(val))
        .filter((val) => Number.isFinite(val));
    }
  }
  return null;
};

const formatRatio = (ratio: number | null | undefined): string => {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '-';
  return `${ratio.toFixed(2)}x`;
};

const parseOptionalNumberInput = (rawValue: string): number | null => {
  if (!rawValue) return null;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
};

const formatMinutesPerUnit = (value: number | null | undefined, unit: string) => {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value.toFixed(3)} ${unit}`;
};

const formatMeasure = (value: number | null | undefined, unit: string, digits = 2) => {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value.toFixed(digits)} ${unit}`;
};

const formatRegressionIndicator = (value: number | null | undefined, digits = 3) => {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toFixed(digits);
};

const normalizeDateToComparable = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const normalizePauseMinutes = (pause: {
  duration_minutes?: number | null;
  duration_seconds?: number | null;
} | null | undefined): number | null => {
  if (!pause) return null;
  const minutes = Number(pause.duration_minutes);
  if (Number.isFinite(minutes) && minutes >= 0) return minutes;
  const seconds = Number(pause.duration_seconds);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds / 60;
  return null;
};

const buildPanelLabel = (panel: PanelDefinition | null): string => {
  if (!panel) return '-';
  const module = panel.module_sequence_number ? `Modulo ${panel.module_sequence_number}` : 'Modulo';
  const group = panel.group || 'Grupo';
  return `${module} - ${group} - ${panel.panel_code || panel.id}`;
};

const normalizePanelGroup = (value: string | null | undefined): string => {
  if (typeof value !== 'string') return 'Sin grupo';
  const trimmed = value.trim();
  return trimmed || 'Sin grupo';
};

const normalizeText = (value: string) => value.trim().toLowerCase();

const collectPointWorkers = (point: AnalysisPoint): string[] => {
  const names: string[] = [];
  if (typeof point?.worker_name === 'string' && point.worker_name.trim()) {
    point.worker_name
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .forEach((name) => names.push(normalizeText(name)));
  }
  if (Array.isArray(point?.task_breakdown)) {
    point.task_breakdown
      .map((task) => (typeof task?.worker_name === 'string' ? task.worker_name.trim() : ''))
      .filter(Boolean)
      .forEach((name) => names.push(normalizeText(name)));
  }
  return Array.from(new Set(names)).filter(Boolean);
};

const toIsoDateString = (date: Date) => date.toISOString().slice(0, 10);

const parseDateOperand = (rawValue: string): { isoDate: string; timestamp: number } | null => {
  if (!rawValue) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    const timestamp = Date.parse(`${rawValue}T00:00:00Z`);
    if (Number.isNaN(timestamp)) return null;
    return { isoDate: rawValue, timestamp };
  }
  const parsed = Date.parse(rawValue);
  if (Number.isNaN(parsed)) return null;
  return { isoDate: toIsoDateString(new Date(parsed)), timestamp: parsed };
};

const buildHypothesisFromConfig = (config: HypothesisConfig | null) => {
  if (!config) {
    return { predicate: null, error: '', description: '' };
  }
  const { field, operator, value } = config;
  if (field === 'worker') {
    if (operator !== '==') {
      return {
        predicate: null,
        error: 'Para trabajador solo se permite el operador =.',
        description: '',
      };
    }
    if (!value) {
      return {
        predicate: null,
        error: 'Debe seleccionar un trabajador.',
        description: '',
      };
    }
    const target = normalizeText(value);
    const predicate = (point: AnalysisPoint) => {
      const participants = collectPointWorkers(point);
      if (!participants.length) return false;
      return participants.some((name) => name.includes(target));
    };
    return { predicate, error: '', description: `Trabajador = ${value}` };
  }
  if (field === 'date') {
    if (!['==', '!=', '>', '>=', '<', '<='].includes(operator)) {
      return { predicate: null, error: 'Operador no soportado para fecha.', description: '' };
    }
    if (!value) {
      return { predicate: null, error: 'Debe seleccionar una fecha.', description: '' };
    }
    const operand = parseDateOperand(value);
    if (!operand) {
      return { predicate: null, error: 'No se pudo interpretar la fecha seleccionada.', description: '' };
    }
    const predicate = (point: AnalysisPoint) => {
      if (!point?.completed_at) return false;
      const pointDate = new Date(point.completed_at);
      if (Number.isNaN(pointDate.getTime())) return false;
      const pointTimestamp = pointDate.getTime();
      const pointIsoDate = toIsoDateString(pointDate);
      switch (operator) {
        case '==':
          return pointIsoDate === operand.isoDate;
        case '!=':
          return pointIsoDate !== operand.isoDate;
        case '>':
          return pointTimestamp > operand.timestamp;
        case '>=':
          return pointTimestamp >= operand.timestamp;
        case '<':
          return pointTimestamp < operand.timestamp;
        case '<=':
          return pointTimestamp <= operand.timestamp;
        default:
          return false;
      }
    };
    const operatorLabel = operator === '==' ? '=' : operator;
    return { predicate, error: '', description: `Fecha ${operatorLabel} ${operand.isoDate}` };
  }
  return {
    predicate: null,
    error: 'Campo de hipotesis no soportado.',
    description: '',
  };
};

const buildHistogramData = (
  points: AnalysisPoint[],
  rawBinSize: number,
  predicate?: ((point: AnalysisPoint) => boolean) | null,
): HistogramSummary => {
  const step = Number(rawBinSize) > 0 ? Number(rawBinSize) : DEFAULT_BIN_SIZE;
  if (!points.length) {
    return { bins: [], maxCount: 0, binSize: step, maxDuration: 0, totalMatches: 0 };
  }
  const maxDuration = Math.max(...points.map((p) => p.duration_minutes || 0));
  if (!(maxDuration > 0)) {
    return { bins: [], maxCount: 0, binSize: step, maxDuration: 0, totalMatches: 0 };
  }
  const binCount = Math.max(1, Math.ceil(maxDuration / step));
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, index) => ({
    index,
    from: index * step,
    to: (index + 1) * step,
    count: 0,
    items: [],
    matchCount: 0,
  }));
  points.forEach((point) => {
    const value = point.duration_minutes || 0;
    const idx = Math.min(Math.floor(value / step), binCount - 1);
    bins[idx].count += 1;
    bins[idx].items.push(point);
    if (typeof predicate === 'function' && predicate(point)) {
      bins[idx].matchCount += 1;
    }
  });
  const maxCount = Math.max(...bins.map((bin) => bin.count));
  const totalMatches = typeof predicate === 'function'
    ? bins.reduce((sum, bin) => sum + bin.matchCount, 0)
    : 0;
  return { bins, maxCount, binSize: step, maxDuration: binCount * step, totalMatches };
};

const buildNormalizedHistogramData = (
  rows: NormalizedCompletionRow[],
  rawBinSize: number,
): NormalizedHistogramSummary => {
  const step = Number(rawBinSize) > 0 ? Number(rawBinSize) : DEFAULT_NORMALIZED_BIN_SIZE;
  if (!rows.length) {
    return { bins: [], maxCount: 0, binSize: step, maxValue: 0 };
  }
  const values = rows
    .map((row) => row.normalized_minutes)
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (!values.length) {
    return { bins: [], maxCount: 0, binSize: step, maxValue: 0 };
  }
  const maxValue = Math.max(...values);
  if (!(maxValue > 0)) {
    return { bins: [], maxCount: 0, binSize: step, maxValue: 0 };
  }
  const binCount = Math.max(1, Math.ceil(maxValue / step));
  const bins: NormalizedHistogramBin[] = Array.from({ length: binCount }, (_, index) => ({
    index,
    from: index * step,
    to: (index + 1) * step,
    count: 0,
    items: [],
  }));
  rows.forEach((row) => {
    const value = row.normalized_minutes;
    if (!Number.isFinite(value) || value < 0) return;
    const idx = Math.min(Math.floor(value / step), binCount - 1);
    bins[idx].count += 1;
    bins[idx].items.push(row);
  });
  const maxCount = Math.max(...bins.map((bin) => bin.count));
  return { bins, maxCount, binSize: step, maxValue: binCount * step };
};

const getTwoTailedCritical95 = (degreesOfFreedom: number): number => {
  if (degreesOfFreedom <= 0) return 1.96;
  const lookup = [
    0,
    12.706,
    4.303,
    3.182,
    2.776,
    2.571,
    2.447,
    2.365,
    2.306,
    2.262,
    2.228,
    2.201,
    2.179,
    2.160,
    2.145,
    2.131,
    2.120,
    2.110,
    2.101,
    2.093,
    2.086,
    2.080,
    2.074,
    2.069,
    2.064,
    2.060,
    2.056,
    2.052,
    2.048,
    2.045,
    2.042,
  ];
  if (degreesOfFreedom < lookup.length) return lookup[degreesOfFreedom];
  if (degreesOfFreedom <= 60) return 2;
  if (degreesOfFreedom <= 120) return 1.98;
  return 1.96;
};

const calculateLinearRegression = (samples: RegressionSample[]): LinearRegressionResult | null => {
  const regressionSamples = samples.filter((sample) =>
    Number.isFinite(sample.x) && Number.isFinite(sample.y) && sample.x > 0 && sample.y > 0
  );
  if (regressionSamples.length < 2) {
    return null;
  }

  const sampleCount = regressionSamples.length;
  const sumX = regressionSamples.reduce((sum, item) => sum + item.x, 0);
  const sumY = regressionSamples.reduce((sum, item) => sum + item.y, 0);
  const meanX = sumX / sampleCount;
  const meanY = sumY / sampleCount;

  let sumSquaredXDeviation = 0;
  let sumCrossDeviation = 0;
  let totalYDeviationSquared = 0;

  regressionSamples.forEach((item) => {
    const xDeviation = item.x - meanX;
    const yDeviation = item.y - meanY;
    sumSquaredXDeviation += xDeviation * xDeviation;
    sumCrossDeviation += xDeviation * yDeviation;
    totalYDeviationSquared += yDeviation * yDeviation;
  });

  if (!(sumSquaredXDeviation > 0)) {
    return null;
  }

  const slope = sumCrossDeviation / sumSquaredXDeviation;
  const intercept = meanY - slope * meanX;

  let sumSquaredError = 0;
  let sumAbsoluteError = 0;
  regressionSamples.forEach((item) => {
    const predictedY = intercept + slope * item.x;
    const residual = item.y - predictedY;
    sumSquaredError += residual * residual;
    sumAbsoluteError += Math.abs(residual);
  });

  const rmse = Math.sqrt(sumSquaredError / sampleCount);
  const mae = sumAbsoluteError / sampleCount;

  const correlation = totalYDeviationSquared > 0
    ? sumCrossDeviation / Math.sqrt(sumSquaredXDeviation * totalYDeviationSquared)
    : null;
  const rSquared = totalYDeviationSquared > 0
    ? 1 - sumSquaredError / totalYDeviationSquared
    : null;
  const adjustedRSquared = rSquared != null && sampleCount > 2
    ? 1 - (1 - rSquared) * ((sampleCount - 1) / (sampleCount - 2))
    : null;

  const minX = Math.min(...regressionSamples.map((item) => item.x));
  const maxX = Math.max(...regressionSamples.map((item) => item.x));
  const startPredictedY = intercept + slope * minX;
  const endPredictedY = intercept + slope * maxX;

  let confidenceBand: RegressionConfidencePoint[] | null = null;
  if (sampleCount > 2) {
    const residualStdError = Math.sqrt(sumSquaredError / (sampleCount - 2));
    const tCritical = getTwoTailedCritical95(sampleCount - 2);
    if (Number.isFinite(residualStdError) && Number.isFinite(tCritical)) {
      const pointsCount = Math.max(24, Math.min(60, sampleCount * 2));
      confidenceBand = Array.from({ length: pointsCount }, (_, index) => {
        const ratio = pointsCount > 1 ? index / (pointsCount - 1) : 0;
        const x = minX + (maxX - minX) * ratio;
        const predictedY = intercept + slope * x;
        const standardErrorMean =
          residualStdError * Math.sqrt((1 / sampleCount) + ((x - meanX) ** 2) / sumSquaredXDeviation);
        const margin = tCritical * standardErrorMean;
        return {
          x,
          predictedY,
          lowerY: predictedY - margin,
          upperY: predictedY + margin,
        };
      });
    }
  }

  return {
    sampleCount,
    slope,
    intercept,
    correlation,
    rSquared,
    adjustedRSquared,
    rmse,
    mae,
    meanX,
    meanY,
    minX,
    maxX,
    startPredictedY,
    endPredictedY,
    confidenceBand,
  };
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

const DashboardTasks: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [houseTypes, setHouseTypes] = useState<HouseType[]>([]);
  const [panelDefinitions, setPanelDefinitions] = useState<PanelDefinition[]>([]);
  const [taskDefinitions, setTaskDefinitions] = useState<TaskDefinition[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [stations, setStations] = useState<Station[]>([]);

  const [selectedHouseTypeId, setSelectedHouseTypeId] = useState('');
  const [selectedPanelId, setSelectedPanelId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedStationId, setSelectedStationId] = useState('');
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [hypothesisForm, setHypothesisForm] = useState<HypothesisConfig>({ ...DEFAULT_HYPOTHESIS_FORM });
  const [activeHypothesisConfig, setActiveHypothesisConfig] = useState<HypothesisConfig | null>(null);
  const [hypothesisEditorOpen, setHypothesisEditorOpen] = useState(false);
  const [hypothesisError, setHypothesisError] = useState('');

  const [binSize, setBinSize] = useState(String(DEFAULT_BIN_SIZE));
  const [minMultiplier, setMinMultiplier] = useState(String(DEFAULT_MIN_MULTIPLIER));
  const [maxMultiplier, setMaxMultiplier] = useState(String(DEFAULT_MAX_MULTIPLIER));

  const [activeTab, setActiveTab] = useState<'panel' | 'normalized'>('panel');
  const [normalizedStationId, setNormalizedStationId] = useState('');
  const [normalizedMetric, setNormalizedMetric] = useState<NormalizedMetric>('linear');
  const [normalizedHouseTypeIds, setNormalizedHouseTypeIds] = useState<number[]>([]);
  const [normalizedPanelGroups, setNormalizedPanelGroups] = useState<string[]>([]);
  const [normalizedFromDate, setNormalizedFromDate] = useState('');
  const [normalizedToDate, setNormalizedToDate] = useState('');
  const [normalizedMinMinutes, setNormalizedMinMinutes] = useState('');
  const [normalizedMaxMinutes, setNormalizedMaxMinutes] = useState('');
  const [normalizedBinSize, setNormalizedBinSize] = useState(String(DEFAULT_NORMALIZED_BIN_SIZE));
  const [normalizedView, setNormalizedView] = useState<'histogram' | 'scatter'>('histogram');
  const [normalizedScatterDisplay, setNormalizedScatterDisplay] = useState<'all' | 'averages'>('all');
  const [showNormalizedRegression, setShowNormalizedRegression] = useState(false);
  const [normalizedData, setNormalizedData] = useState<StationPanelsFinishedResponse | null>(null);
  const [normalizedLoading, setNormalizedLoading] = useState(false);
  const [normalizedError, setNormalizedError] = useState('');
  const [houseTypeDropdownOpen, setHouseTypeDropdownOpen] = useState(false);
  const [panelTypeDropdownOpen, setPanelTypeDropdownOpen] = useState(false);
  const houseTypeDropdownRef = useRef<HTMLDivElement | null>(null);
  const panelTypeDropdownRef = useRef<HTMLDivElement | null>(null);

  const [analysisData, setAnalysisData] = useState<TaskAnalysisResponse | null>(null);
  const [showHistogramMethodologyModal, setShowHistogramMethodologyModal] = useState(false);
  const [dataTableSort, setDataTableSort] = useState<{ key: DataTableSortKey; direction: DataTableSortDirection }>({
    key: 'duration',
    direction: 'desc',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [panelsError, setPanelsError] = useState('');
  const [panelsLoading, setPanelsLoading] = useState(true);
  const [stationsError, setStationsError] = useState('');
  const [stationsLoading, setStationsLoading] = useState(true);

  useEffect(() => {
    setHeader({
      title: 'Analisis de tiempos de tareas',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  useEffect(() => {
    let active = true;
    apiRequest<HouseType[]>('/api/house-types')
      .then((data) => {
        if (!active) return;
        setHouseTypes(Array.isArray(data) ? data : []);
      })
      .catch((err: Error) => {
        if (!active) return;
        setHouseTypes([]);
        setError(err.message || 'Error cargando tipos de casa');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadPanels = async () => {
      try {
        const data = await apiRequest<PanelDefinition[]>('/api/panel-definitions');
        if (!active) return;
        setPanelDefinitions(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Error cargando paneles';
        setPanelDefinitions([]);
        setPanelsError(message);
      } finally {
        if (active) setPanelsLoading(false);
      }
    };
    void loadPanels();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<TaskDefinition[]>('/api/task-definitions')
      .then((data) => {
        if (!active) return;
        setTaskDefinitions(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!active) return;
        setTaskDefinitions([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<Worker[]>('/api/workers')
      .then((data) => {
        if (!active) return;
        setWorkers(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!active) return;
        setWorkers([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadStations = async () => {
      try {
        const data = await apiRequest<Station[]>('/api/stations');
        if (!active) return;
        setStations(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Error cargando estaciones';
        setStations([]);
        setStationsError(message);
      } finally {
        if (active) setStationsLoading(false);
      }
    };
    void loadStations();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!houseTypeDropdownOpen) {
      return undefined;
    }
    const handleClick = (event: MouseEvent) => {
      if (!houseTypeDropdownRef.current) return;
      if (!houseTypeDropdownRef.current.contains(event.target as Node)) {
        setHouseTypeDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHouseTypeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [houseTypeDropdownOpen]);

  useEffect(() => {
    if (!panelTypeDropdownOpen) {
      return undefined;
    }
    const handleClick = (event: MouseEvent) => {
      if (!panelTypeDropdownRef.current) return;
      if (!panelTypeDropdownRef.current.contains(event.target as Node)) {
        setPanelTypeDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPanelTypeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [panelTypeDropdownOpen]);

  useEffect(() => {
    if (activeTab === 'normalized') return;
    setHouseTypeDropdownOpen(false);
    setPanelTypeDropdownOpen(false);
  }, [activeTab]);

  useEffect(() => {
    if (!showHistogramMethodologyModal) {
      return undefined;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowHistogramMethodologyModal(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showHistogramMethodologyModal]);

  const selectedHouseType = useMemo(
    () => houseTypes.find((item) => String(item.id) === String(selectedHouseTypeId)) || null,
    [houseTypes, selectedHouseTypeId],
  );

  const panelsForHouse = useMemo(() => {
    if (!selectedHouseType) return [] as PanelDefinition[];
    return panelDefinitions
      .filter((panel) => panel.house_type_id === selectedHouseType.id)
      .sort((a, b) => {
        const moduleDiff = (a.module_sequence_number || 0) - (b.module_sequence_number || 0);
        if (moduleDiff !== 0) return moduleDiff;
        if (a.panel_sequence_number != null && b.panel_sequence_number != null) {
          return a.panel_sequence_number - b.panel_sequence_number;
        }
        if (a.panel_sequence_number != null) return -1;
        if (b.panel_sequence_number != null) return 1;
        return (a.panel_code || '').localeCompare(b.panel_code || '');
      });
  }, [panelDefinitions, selectedHouseType]);

  const effectiveSelectedPanelId = useMemo(() => {
    if (!selectedHouseTypeId || !panelsForHouse.length) {
      return '';
    }
    const exists = panelsForHouse.some((panel) => String(panel.id) === String(selectedPanelId));
    return exists ? selectedPanelId : String(panelsForHouse[0]?.id ?? '');
  }, [panelsForHouse, selectedHouseTypeId, selectedPanelId]);

  const selectedPanel = useMemo(
    () => panelsForHouse.find((panel) => String(panel.id) === String(effectiveSelectedPanelId)) || null,
    [panelsForHouse, effectiveSelectedPanelId],
  );

  const houseTypeNameById = useMemo(() => {
    const map = new Map<number, string>();
    houseTypes.forEach((houseType) => {
      map.set(houseType.id, houseType.name || `Tipo ${houseType.id}`);
    });
    return map;
  }, [houseTypes]);

  const panelDefinitionById = useMemo(() => {
    const map = new Map<number, PanelDefinition>();
    panelDefinitions.forEach((panel) => {
      map.set(panel.id, panel);
    });
    return map;
  }, [panelDefinitions]);

  const sequenceByStationId = useMemo(() => {
    const map = new Map<string, number>();
    stations.forEach((station) => {
      if (station && station.id != null && station.sequence_order != null) {
        map.set(String(station.id), Number(station.sequence_order));
      }
    });
    return map;
  }, [stations]);

  const selectedNormalizedStation = useMemo(
    () => stations.find((station) => String(station.id) === String(normalizedStationId)) || null,
    [stations, normalizedStationId],
  );

  const normalizedDateRange = useMemo(() => {
    if (normalizedFromDate && normalizedToDate && normalizedFromDate > normalizedToDate) {
      return { from: normalizedToDate, to: normalizedFromDate };
    }
    return { from: normalizedFromDate, to: normalizedToDate };
  }, [normalizedFromDate, normalizedToDate]);

  const panelGroupOptions = useMemo(() => {
    const houseTypeSet = new Set(normalizedHouseTypeIds);
    const groupMap = new Map<string, PanelGroupOption>();
    panelDefinitions.forEach((panel) => {
      if (houseTypeSet.size && !houseTypeSet.has(panel.house_type_id)) return;
      const groupLabel = normalizePanelGroup(panel.group);
      const current = groupMap.get(groupLabel);
      if (current) {
        current.count += 1;
      } else {
        groupMap.set(groupLabel, { id: groupLabel, label: groupLabel, count: 1 });
      }
    });
    return Array.from(groupMap.values()).sort((a, b) =>
      a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }),
    );
  }, [panelDefinitions, normalizedHouseTypeIds]);

  const normalizedHouseTypeLabel = useMemo(() => {
    if (!normalizedHouseTypeIds.length) return 'Todos los tipos de casa';
    if (normalizedHouseTypeIds.length === 1) {
      const id = normalizedHouseTypeIds[0];
      return houseTypeNameById.get(id) ?? `Tipo ${id}`;
    }
    return `${normalizedHouseTypeIds.length} tipos seleccionados`;
  }, [normalizedHouseTypeIds, houseTypeNameById]);

  const normalizedPanelTypeLabel = useMemo(() => {
    if (!normalizedPanelGroups.length) return 'Todos los grupos';
    if (normalizedPanelGroups.length === 1) {
      return normalizedPanelGroups[0];
    }
    return `${normalizedPanelGroups.length} grupos seleccionados`;
  }, [normalizedPanelGroups]);

  useEffect(() => {
    const availableGroups = new Set(panelGroupOptions.map((option) => option.id));
    setNormalizedPanelGroups((prev) => {
      if (!prev.length) return prev;
      const next = prev.filter((group) => availableGroups.has(group));
      return next.length === prev.length ? prev : next;
    });
  }, [panelGroupOptions]);

  const candidatePanelTasks = useMemo(() => {
    if (!selectedHouseType) return [] as TaskDefinition[];
    return taskDefinitions
      .filter((task) => task.scope === 'panel' && task.active)
      .sort((a, b) => {
        const seqA = a.default_station_sequence ?? 0;
        const seqB = b.default_station_sequence ?? 0;
        if (seqA !== seqB) return seqA - seqB;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }, [selectedHouseType, taskDefinitions]);

  const tasksForPanel = useMemo(() => {
    if (!selectedPanel) return candidatePanelTasks;
    const ids = parseTaskIds(selectedPanel.applicable_task_ids);
    if (!ids) return candidatePanelTasks;
    const idSet = new Set(ids.map((id) => Number(id)));
    return candidatePanelTasks.filter((task) => idSet.has(Number(task.id)));
  }, [candidatePanelTasks, selectedPanel]);

  const filteredTasksForSelection = useMemo(() => {
    if (!selectedPanel) return tasksForPanel;
    if (!selectedStationId) return tasksForPanel;
    const seq = sequenceByStationId.get(String(selectedStationId));
    if (typeof seq !== 'number') return tasksForPanel;
    return tasksForPanel.filter((task) => Number(task.default_station_sequence ?? NaN) === seq);
  }, [tasksForPanel, selectedPanel, selectedStationId, sequenceByStationId]);

  const effectiveSelectedTaskId = useMemo(() => {
    if (!selectedTaskId) return '';
    const exists = filteredTasksForSelection.some((task) => String(task.id) === String(selectedTaskId));
    return exists ? selectedTaskId : '';
  }, [filteredTasksForSelection, selectedTaskId]);

  const selectionErrorMessage = useMemo(() => {
    if (!selectedHouseTypeId || !effectiveSelectedPanelId) {
      return '';
    }
    if (!selectedStationId) {
      return 'Debe seleccionar una estacion para ver el analisis.';
    }
    return '';
  }, [selectedHouseTypeId, effectiveSelectedPanelId, selectedStationId]);

  const panelSelectionReady = Boolean(selectedHouseTypeId && effectiveSelectedPanelId && selectedStationId);
  const displayAnalysisData = activeTab === 'panel' && panelSelectionReady ? analysisData : null;
  const displayError = activeTab === 'panel'
    ? selectionErrorMessage || (panelSelectionReady ? error : '')
    : '';
  const displayLoading = activeTab === 'panel' && panelSelectionReady && loading;

  const panelLabel = (panel: PanelDefinition | null): string => buildPanelLabel(panel);

  const workerLabel = (worker: Worker): string =>
    `${worker.first_name || ''} ${worker.last_name || ''}`.trim() || `Trabajador ${worker.id}`;

  const stationLabel = (station: Station): string => {
    const code = station.id ? String(station.id) : '';
    const name = station.name || '';
    if (!code && !name) return '-';
    return name ? `${code} - ${name}` : code;
  };

  const normalizedMetricLabel = normalizedMetric === 'area' ? 'Minutos / m2' : 'Minutos / m';
  const normalizedMetricUnit = normalizedMetric === 'area' ? 'min/m2' : 'min/m';

  const toggleNormalizedHouseType = (houseTypeId: number) => {
    setNormalizedHouseTypeIds((prev) => {
      if (!prev.length) return [houseTypeId];
      if (prev.includes(houseTypeId)) {
        return prev.filter((id) => id !== houseTypeId);
      }
      return [...prev, houseTypeId];
    });
  };

  const toggleNormalizedPanelGroup = (groupLabel: string) => {
    setNormalizedPanelGroups((prev) => {
      if (!prev.length) return [groupLabel];
      if (prev.includes(groupLabel)) {
        return prev.filter((id) => id !== groupLabel);
      }
      return [...prev, groupLabel];
    });
  };

  const effectiveBinSize = Number(binSize) > 0 ? Number(binSize) : DEFAULT_BIN_SIZE;
  const effectiveMinMultiplier = Number(minMultiplier) || 0;
  const effectiveMaxMultiplier = Number(maxMultiplier) || Number.POSITIVE_INFINITY;
  const normalizedMinValue = parseOptionalNumberInput(normalizedMinMinutes);
  const normalizedMaxValue = parseOptionalNumberInput(normalizedMaxMinutes);
  const normalizedBinValue = parseOptionalNumberInput(normalizedBinSize);
  const effectiveNormalizedMin =
    normalizedMinValue != null && normalizedMaxValue != null
      ? Math.min(normalizedMinValue, normalizedMaxValue)
      : normalizedMinValue;
  const effectiveNormalizedMax =
    normalizedMinValue != null && normalizedMaxValue != null
      ? Math.max(normalizedMinValue, normalizedMaxValue)
      : normalizedMaxValue;
  const effectiveNormalizedBinSize =
    normalizedBinValue != null && normalizedBinValue > 0 ? normalizedBinValue : DEFAULT_NORMALIZED_BIN_SIZE;

  const hypothesis = useMemo(
    () => buildHypothesisFromConfig(activeHypothesisConfig),
    [activeHypothesisConfig],
  );

  const analysisSummary = useMemo(() => {
    const predicate = hypothesis.predicate;
    const points = Array.isArray(displayAnalysisData?.data_points)
      ? displayAnalysisData?.data_points ?? []
      : [];
    if (!points.length) {
      return {
        included: [] as AnalysisPoint[],
        excluded: [] as AnalysisPoint[],
        histogram: buildHistogramData([], effectiveBinSize, predicate),
        average: null as number | null,
        expectedReference: displayAnalysisData?.expected_reference_minutes ?? null,
        hypothesisMatches: predicate ? 0 : null,
        hypothesisMatchAverage: null as number | null,
      };
    }
    const minVal = Math.min(effectiveMinMultiplier, effectiveMaxMultiplier);
    const maxVal = Math.max(effectiveMinMultiplier, effectiveMaxMultiplier);
    const included: AnalysisPoint[] = [];
    const excluded: AnalysisPoint[] = [];
    const hypothesisDurations: number[] | null = predicate ? [] : null;
    points.forEach((point) => {
      const duration = Number(point.duration_minutes) || 0;
      const expected = Number(point.expected_minutes);
      const ratio = expected > 0 ? duration / expected : null;
      const pointWithRatio = { ...point, duration_minutes: duration, ratio } as AnalysisPoint & {
        ratio: number | null;
      };
      if (ratio !== null && (ratio < minVal || ratio > maxVal)) {
        excluded.push(pointWithRatio);
      } else {
        included.push(pointWithRatio);
        if (hypothesisDurations && predicate && predicate(pointWithRatio)) {
          hypothesisDurations.push(duration);
        }
      }
    });
    const histogram = buildHistogramData(included, effectiveBinSize, predicate);
    const average = included.length
      ? Number((included.reduce((sum, item) => sum + (item.duration_minutes || 0), 0) / included.length).toFixed(2))
      : null;
    const hypothesisMatchAverage = hypothesisDurations && hypothesisDurations.length
      ? Number(
          (
            hypothesisDurations.reduce((sum, duration) => sum + duration, 0) / hypothesisDurations.length
          ).toFixed(2),
        )
      : null;
    return {
      included,
      excluded,
      histogram,
      average,
      expectedReference: displayAnalysisData?.expected_reference_minutes ?? null,
      hypothesisMatches: predicate ? histogram.totalMatches : null,
      hypothesisMatchAverage: predicate ? hypothesisMatchAverage : null,
    };
  }, [
    displayAnalysisData,
    effectiveBinSize,
    effectiveMaxMultiplier,
    effectiveMinMultiplier,
    hypothesis.predicate,
  ]);

  const normalizedReport = useMemo(() => {
    const emptySummary = {
      totalMatching: 0,
      included: 0,
      missingMetric: 0,
      missingTime: 0,
      averageMinutes: null as number | null,
      sampleCount: 0,
      bestRow: null as NormalizedCompletionRow | null,
      worstRow: null as NormalizedCompletionRow | null,
    };
    if (!normalizedData?.houses || !normalizedStationId) {
      return { rows: [] as NormalizedCompletionRow[], summary: emptySummary };
    }
    const houseTypeSet = new Set(normalizedHouseTypeIds);
    const groupSet = new Set(normalizedPanelGroups);
    const rows: NormalizedCompletionRow[] = [];
    let totalMatching = 0;
    let missingMetric = 0;
    let missingTime = 0;
    let bestRow: NormalizedCompletionRow | null = null;
    let worstRow: NormalizedCompletionRow | null = null;

    normalizedData.houses.forEach((house, houseIndex) => {
      const houseTypeId = house.house_type_id != null ? Number(house.house_type_id) : null;
      if (houseTypeSet.size) {
        if (!houseTypeId || !houseTypeSet.has(houseTypeId)) return;
      }
      const houseName = house.house_type_name || (houseTypeId != null ? `Tipo ${houseTypeId}` : 'Tipo');
      const modules = Array.isArray(house.modules) ? house.modules : [];
      modules.forEach((moduleItem, moduleIndex) => {
        const panels = Array.isArray(moduleItem?.panels) ? moduleItem.panels : [];
        panels.forEach((panel, panelIndex) => {
          const panelDefinitionId =
            panel.panel_definition_id != null ? Number(panel.panel_definition_id) : NaN;
          if (!Number.isFinite(panelDefinitionId)) return;
          const panelMeta = panelDefinitionById.get(panelDefinitionId);
          const groupLabel = normalizePanelGroup(panelMeta?.group);
          if (groupSet.size && !groupSet.has(groupLabel)) return;
          totalMatching += 1;

          const actualMinutes = Number(panel.actual_minutes);
          if (!Number.isFinite(actualMinutes) || actualMinutes <= 0) {
            missingTime += 1;
            return;
          }

          const panelArea = panel.panel_area ?? panelMeta?.panel_area ?? null;
          const panelLength = panelMeta?.panel_length_m ?? null;
          const hasArea = panelArea != null && Number(panelArea) > 0;
          const hasLength = panelLength != null && Number(panelLength) > 0;
          if (!hasArea || !hasLength) {
            missingMetric += 1;
            return;
          }
          const measure = normalizedMetric === 'area' ? Number(panelArea) : Number(panelLength);
          if (!(measure > 0)) {
            missingMetric += 1;
            return;
          }
          const normalizedMinutes = actualMinutes / measure;
          if (effectiveNormalizedMin != null && normalizedMinutes < effectiveNormalizedMin) {
            return;
          }
          if (effectiveNormalizedMax != null && normalizedMinutes > effectiveNormalizedMax) {
            return;
          }
          const panelLabelText = panelMeta
            ? buildPanelLabel(panelMeta)
            : panel.panel_code
              ? `Panel ${panel.panel_code}`
              : `Panel ${panelDefinitionId}`;
          const entry: NormalizedCompletionRow = {
            id: `${panelDefinitionId}-${panel.plan_id ?? houseIndex}-${panel.finished_at ?? panel.station_finished_at ?? `${moduleIndex}-${panelIndex}`}`,
            panel_definition_id: panelDefinitionId,
            house_type_id: houseTypeId ?? panelMeta?.house_type_id ?? null,
            house_type_name: houseName,
            panel_label: panelLabelText,
            panel_group: groupLabel,
            panel_area: Number(panelArea),
            panel_length_m: Number(panelLength),
            actual_minutes: actualMinutes,
            normalized_minutes: normalizedMinutes,
            finished_at: panel.finished_at ?? panel.station_finished_at ?? null,
          };
          rows.push(entry);
          if (!bestRow || entry.normalized_minutes < bestRow.normalized_minutes) {
            bestRow = entry;
          }
          if (!worstRow || entry.normalized_minutes > worstRow.normalized_minutes) {
            worstRow = entry;
          }
        });
      });
    });

    rows.sort((a, b) => b.normalized_minutes - a.normalized_minutes);

    const averageMinutes = rows.length
      ? Number((rows.reduce((sum, item) => sum + item.normalized_minutes, 0) / rows.length).toFixed(3))
      : null;
    const sampleCount = rows.length;
    return {
      rows,
      summary: {
        totalMatching,
        included: rows.length,
        missingMetric,
        missingTime,
        averageMinutes,
        sampleCount,
        bestRow,
        worstRow,
      },
    };
  }, [
    normalizedData,
    normalizedStationId,
    normalizedHouseTypeIds,
    normalizedPanelGroups,
    normalizedMetric,
    effectiveNormalizedMin,
    effectiveNormalizedMax,
    panelDefinitionById,
  ]);

  const normalizedHistogram = useMemo(
    () => buildNormalizedHistogramData(normalizedReport.rows, effectiveNormalizedBinSize),
    [normalizedReport.rows, effectiveNormalizedBinSize],
  );

  const workerNamesFromAnalysis = useMemo(() => {
    if (!displayAnalysisData || !Array.isArray(displayAnalysisData.data_points)) return [] as string[];
    const names = new Set<string>();
    displayAnalysisData.data_points.forEach((point) => {
      if (typeof point?.worker_name === 'string' && point.worker_name.trim()) {
        point.worker_name
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
          .forEach((name) => names.add(name));
      }
      if (Array.isArray(point?.task_breakdown)) {
        point.task_breakdown
          .map((task) => (typeof task?.worker_name === 'string' ? task.worker_name.trim() : ''))
          .filter(Boolean)
          .forEach((name) => names.add(name));
      }
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [displayAnalysisData]);

  const workerOptionsForHypothesis = useMemo(() => {
    if (workerNamesFromAnalysis.length) return workerNamesFromAnalysis;
    const labels = new Set<string>();
    workers.forEach((worker) => {
      const label = workerLabel(worker);
      if (label) labels.add(label);
    });
    return Array.from(labels).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [workerNamesFromAnalysis, workers]);

  const openHypothesisEditor = () => {
    setHypothesisEditorOpen(true);
    setHypothesisError('');
    setHypothesisForm(activeHypothesisConfig ? { ...activeHypothesisConfig } : { ...DEFAULT_HYPOTHESIS_FORM });
  };

  const handleHypothesisFieldChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newField = event.target.value as HypothesisField;
    const fieldConfig = getHypothesisFieldConfig(newField);
    const nextOperator = fieldConfig.operators.some((item) => item.value === hypothesisForm.operator)
      ? hypothesisForm.operator
      : fieldConfig.operators[0]?.value || '==';
    setHypothesisForm({
      field: newField,
      operator: nextOperator,
      value: '',
    });
    setHypothesisError('');
  };

  const handleHypothesisOperatorChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newOperator = event.target.value as HypothesisOperator;
    setHypothesisForm((prev) => ({
      ...prev,
      operator: newOperator,
    }));
    setHypothesisError('');
  };

  const handleHypothesisValueChange = (value: string) => {
    setHypothesisForm((prev) => ({
      ...prev,
      value,
    }));
    setHypothesisError('');
  };

  const handleApplyHypothesis = () => {
    if (hypothesisForm.field === 'worker' && !workerOptionsForHypothesis.length) {
      setHypothesisError('No hay trabajadores disponibles para aplicar la hipotesis.');
      return;
    }
    const result = buildHypothesisFromConfig(hypothesisForm);
    if (result.error) {
      setHypothesisError(result.error);
      return;
    }
    setActiveHypothesisConfig({ ...hypothesisForm });
    setHypothesisEditorOpen(false);
    setHypothesisError('');
  };

  const handleCancelHypothesis = () => {
    setHypothesisError('');
    setHypothesisEditorOpen(false);
    setHypothesisForm(activeHypothesisConfig ? { ...activeHypothesisConfig } : { ...DEFAULT_HYPOTHESIS_FORM });
  };

  const handleRemoveHypothesis = () => {
    setActiveHypothesisConfig(null);
    setHypothesisForm({ ...DEFAULT_HYPOTHESIS_FORM });
    setHypothesisError('');
    setHypothesisEditorOpen(false);
  };

  useEffect(() => {
    if (activeTab !== 'panel') {
      return undefined;
    }
    if (!selectedHouseTypeId || !effectiveSelectedPanelId || !selectedStationId) {
      return undefined;
    }
    let cancelled = false;
    const loadAnalysis = async () => {
      setLoading(true);
      setError('');

      const params = new URLSearchParams();
      params.append('house_type_id', String(selectedHouseTypeId));
      params.append('panel_definition_id', String(effectiveSelectedPanelId));
      if (effectiveSelectedTaskId) params.append('task_definition_id', String(effectiveSelectedTaskId));
      if (selectedStationId) params.append('station_id', String(selectedStationId));
      if (selectedWorkerId) params.append('worker_id', String(selectedWorkerId));
      if (fromDate) params.append('from_date', `${fromDate} 00:00:00`);
      if (toDate) params.append('to_date', `${toDate} 23:59:59`);

      apiRequest<TaskAnalysisResponse>(`/api/task-analysis?${params.toString()}`)
        .then((result) => {
          if (!cancelled) {
            setAnalysisData(result);
          }
        })
        .catch((err: Error) => {
          if (!cancelled) {
            setAnalysisData(null);
            setError(err.message || 'Error obteniendo analisis');
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    };

    void loadAnalysis();

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    selectedHouseTypeId,
    effectiveSelectedPanelId,
    effectiveSelectedTaskId,
    selectedStationId,
    selectedWorkerId,
    fromDate,
    toDate,
  ]);

  useEffect(() => {
    if (activeTab !== 'normalized') {
      return undefined;
    }
    if (!normalizedStationId) {
      setNormalizedData(null);
      setNormalizedError('');
      setNormalizedLoading(false);
      return undefined;
    }
    let cancelled = false;
    const loadNormalized = async () => {
      setNormalizedLoading(true);
      setNormalizedError('');
      const params = new URLSearchParams();
      params.append('station_id', String(normalizedStationId));
      if (normalizedDateRange.from) params.append('from_date', `${normalizedDateRange.from} 00:00:00`);
      if (normalizedDateRange.to) params.append('to_date', `${normalizedDateRange.to} 23:59:59`);
      try {
        const result = await apiRequest<StationPanelsFinishedResponse>(
          `/api/station-panels-finished?${params.toString()}`,
        );
        if (!cancelled) {
          setNormalizedData(result);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Error obteniendo analisis';
          setNormalizedData(null);
          setNormalizedError(message);
        }
      } finally {
        if (!cancelled) {
          setNormalizedLoading(false);
        }
      }
    };

    void loadNormalized();

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    normalizedStationId,
    normalizedDateRange.from,
    normalizedDateRange.to,
  ]);

  const resetFilters = () => {
    setSelectedTaskId('');
    setSelectedStationId('');
    setSelectedWorkerId('');
    setFromDate('');
    setToDate('');
    setHypothesisForm({ ...DEFAULT_HYPOTHESIS_FORM });
    setActiveHypothesisConfig(null);
    setHypothesisEditorOpen(false);
    setHypothesisError('');
    setBinSize(String(DEFAULT_BIN_SIZE));
    setMinMultiplier(String(DEFAULT_MIN_MULTIPLIER));
    setMaxMultiplier(String(DEFAULT_MAX_MULTIPLIER));
    setAnalysisData(null);
    setError('');
  };

  const resetNormalizedFilters = () => {
    setNormalizedStationId('');
    setNormalizedMetric('linear');
    setNormalizedHouseTypeIds([]);
    setNormalizedPanelGroups([]);
    setHouseTypeDropdownOpen(false);
    setPanelTypeDropdownOpen(false);
    setNormalizedFromDate('');
    setNormalizedToDate('');
    setNormalizedMinMinutes('');
    setNormalizedMaxMinutes('');
    setNormalizedBinSize(String(DEFAULT_NORMALIZED_BIN_SIZE));
    setNormalizedView('histogram');
    setNormalizedScatterDisplay('all');
    setShowNormalizedRegression(false);
    setNormalizedData(null);
    setNormalizedError('');
  };

  const buildDataPointSummary = (row: AnalysisPoint): string => {
    const house = row.house_identifier || '-';
    const date = formatDateTime(row.completed_at);
    const duration = formatMinutesWithUnit(row.duration_minutes);
    let workersSummary = row.worker_name || '';
    if (Array.isArray(row.task_breakdown) && row.task_breakdown.length) {
      const workerNames = Array.from(
        new Set(row.task_breakdown.map((task) => task.worker_name).filter(Boolean) as string[]),
      );
      if (workerNames.length) {
        workersSummary = workerNames.join(', ');
      }
    }
    const workersLabel = workersSummary || '-';
    return `Casa ${house} - Fecha ${date} - Duracion ${duration} - Trabajador(es) ${workersLabel}`;
  };

  const buildTaskBreakdownTooltip = (task: TaskBreakdownRow): string => {
    const taskLabel = task.task_name || String(task.task_definition_id || 'Tarea');
    const durationLabel = formatMinutesWithUnit(task.duration_minutes);
    const expectedLabel = formatMinutesWithUnit(task.expected_minutes);
    const startedLabel = formatDateTime(task.started_at);
    const completedLabel = formatDateTime(task.completed_at);
    const workersLabel = task.worker_name || '-';
    const totalPauseLabel = formatMinutesWithUnit(task.pause_minutes);
    const pauseLines = Array.isArray(task.pauses)
      ? task.pauses.map((pause, index) => {
          const pausedAt = formatDateTime(pause.paused_at);
          const resumedAt = formatDateTime(pause.resumed_at);
          const pauseMinutes = normalizePauseMinutes(pause);
          const duration = pauseMinutes != null ? formatMinutesWithUnit(pauseMinutes) : '-';
          const reason = pause.reason ? ` / Motivo: ${pause.reason}` : '';
          return `Pausa ${index + 1}: ${pausedAt} -> ${resumedAt} / Duracion ${duration}${reason}`;
        })
      : [];
    const pausesSummary = pauseLines.length ? pauseLines.join('\n') : 'Pausas: Sin pausas';
    return [
      `Tarea: ${taskLabel}`,
      `Inicio: ${startedLabel}`,
      `Fin: ${completedLabel}`,
      `Duracion activa: ${durationLabel}`,
      `Esperado: ${expectedLabel}`,
      `Trabajador(es): ${workersLabel}`,
      `Pausas totales: ${totalPauseLabel}`,
      pausesSummary,
    ].join('\n');
  };

  const compareRowsBySort = (a: AnalysisPoint, b: AnalysisPoint, key: DataTableSortKey): number => {
    const ratioA = (a as AnalysisPoint & { ratio?: number | null }).ratio ?? null;
    const ratioB = (b as AnalysisPoint & { ratio?: number | null }).ratio ?? null;
    switch (key) {
      case 'plan': {
        const planA = `${a.house_identifier || ''}-${a.module_number || ''}`;
        const planB = `${b.house_identifier || ''}-${b.module_number || ''}`;
        return planA.localeCompare(planB, 'es', { sensitivity: 'base' });
      }
      case 'duration':
        return (Number(a.duration_minutes) || 0) - (Number(b.duration_minutes) || 0);
      case 'expected':
        return (Number(a.expected_minutes) || 0) - (Number(b.expected_minutes) || 0);
      case 'ratio':
        return (ratioA ?? Number.NEGATIVE_INFINITY) - (ratioB ?? Number.NEGATIVE_INFINITY);
      case 'completed':
        return (normalizeDateToComparable(a.completed_at) ?? Number.NEGATIVE_INFINITY)
          - (normalizeDateToComparable(b.completed_at) ?? Number.NEGATIVE_INFINITY);
      case 'worker':
        return (a.worker_name || '').localeCompare(b.worker_name || '', 'es', { sensitivity: 'base' });
      default:
        return 0;
    }
  };

  const handleDataTableSort = (key: DataTableSortKey) => {
    setDataTableSort((prev) => {
      if (prev.key === key) {
        return {
          key,
          direction: prev.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        key,
        direction: key === 'plan' || key === 'worker' ? 'asc' : 'desc',
      };
    });
  };

  const renderHistogram = () => {
    const { bins, maxCount, binSize: size, maxDuration } = analysisSummary.histogram;
    if (!bins.length || !maxCount) {
      return <div className="text-sm text-[var(--ink-muted)]">No hay datos suficientes para el histograma.</div>;
    }
    const chartHeight = 260;
    const averageGuideOvershoot = 12;
    const expectedGuideOvershoot = 24;
    const hypothesisGuideOvershoot = 36;
    const showHypothesis = Boolean(hypothesis.predicate);
    const topGuideOvershoot = showHypothesis
      ? Math.max(expectedGuideOvershoot, averageGuideOvershoot, hypothesisGuideOvershoot)
      : Math.max(expectedGuideOvershoot, averageGuideOvershoot);
    const margin = { top: 16 + topGuideOvershoot, right: 16, bottom: 60, left: 56 };
    const chartWidth = Math.max(bins.length, 1) * 60;
    const svgWidth = chartWidth + margin.left + margin.right;
    const svgHeight = chartHeight + margin.top + margin.bottom;
    const minutesPerPixel = maxDuration > 0 ? maxDuration / chartWidth : 1;
    const barFullWidth = size / minutesPerPixel;
    const barWidth = barFullWidth * 0.72;
    const gap = (barFullWidth - barWidth) / 2;
    const expectedX = analysisSummary.expectedReference != null
      ? Math.min(chartWidth, Math.max(0, analysisSummary.expectedReference / minutesPerPixel))
      : null;
    const averageX = analysisSummary.average != null
      ? Math.min(chartWidth, Math.max(0, analysisSummary.average / minutesPerPixel))
      : null;
    const hypothesisAverageX = showHypothesis && analysisSummary.hypothesisMatchAverage != null
      ? Math.min(chartWidth, Math.max(0, analysisSummary.hypothesisMatchAverage / minutesPerPixel))
      : null;
    const axisBaseY = margin.top + chartHeight;

    return (
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <svg width={svgWidth} height={svgHeight} role="img" aria-label="Histograma de tiempos">
            <line
              x1={margin.left}
              y1={axisBaseY}
              x2={margin.left + chartWidth}
              y2={axisBaseY}
              stroke="#374151"
              strokeWidth={1}
            />
            <line x1={margin.left} y1={margin.top} x2={margin.left} y2={axisBaseY} stroke="#374151" />
            {bins.map((bin) => {
              const totalCount = bin.count;
              const matchCount = showHypothesis ? bin.matchCount : 0;
              const nonMatchCount = showHypothesis ? Math.max(0, totalCount - matchCount) : 0;
              const barHeight = (totalCount / maxCount) * chartHeight;
              const matchHeight = showHypothesis ? (matchCount / maxCount) * chartHeight : 0;
              const nonMatchHeight = showHypothesis ? (nonMatchCount / maxCount) * chartHeight : 0;
              const x = margin.left + bin.index * barFullWidth + gap;
              const barTopY = axisBaseY - barHeight;
              const tooltipLines: string[] = [];
              if (showHypothesis) {
                tooltipLines.push(`Coinciden: ${matchCount}`);
                tooltipLines.push(`No coinciden: ${nonMatchCount}`);
              }
              if (bin.items && bin.items.length) {
                tooltipLines.push(...bin.items.map((point) => buildDataPointSummary(point)));
              } else {
                tooltipLines.push('Sin muestras en este rango');
              }
              const tooltip = tooltipLines.join('\n');
              const renderFallbackRect = showHypothesis && matchHeight <= 0 && nonMatchHeight <= 0;
              return (
                <g key={bin.index}>
                  <title>{tooltip}</title>
                  {showHypothesis ? (
                    <>
                      {matchHeight > 0 && (
                        <rect
                          x={x}
                          y={axisBaseY - matchHeight}
                          width={barWidth}
                          height={matchHeight}
                          fill="var(--accent)"
                          aria-label={tooltip}
                        />
                      )}
                      {nonMatchHeight > 0 && (
                        <rect
                          x={x}
                          y={axisBaseY - matchHeight - nonMatchHeight}
                          width={barWidth}
                          height={nonMatchHeight}
                          fill="#3b82f6"
                          aria-label={tooltip}
                        />
                      )}
                      {renderFallbackRect && (
                        <rect
                          x={x}
                          y={axisBaseY - 1}
                          width={barWidth}
                          height={1}
                          fill="transparent"
                          aria-label={tooltip}
                        />
                      )}
                    </>
                  ) : (
                    <rect
                      x={x}
                      y={barTopY}
                      width={barWidth}
                      height={barHeight}
                      fill="#3b82f6"
                      aria-label={tooltip}
                    />
                  )}
                  <text x={x + barWidth / 2} y={axisBaseY + 16} textAnchor="middle" fontSize="10" fill="#4b5563">
                    {`${bin.from.toFixed(0)}-${bin.to.toFixed(0)}`}
                  </text>
                  <text x={x + barWidth / 2} y={barTopY - 6} textAnchor="middle" fontSize="11" fill="#111827">
                    {bin.count}
                  </text>
                </g>
              );
            })}
            {expectedX !== null && (
              <g>
                <line
                  x1={margin.left + expectedX}
                  y1={margin.top - expectedGuideOvershoot}
                  x2={margin.left + expectedX}
                  y2={axisBaseY}
                  stroke="var(--accent)"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                />
                <text
                  x={margin.left + expectedX}
                  y={margin.top - expectedGuideOvershoot - 4}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--accent)"
                >
                  {`Esperado ${formatMinutesWithUnit(analysisSummary.expectedReference)}`}
                </text>
              </g>
            )}
            {averageX !== null && (
              <g>
                <line
                  x1={margin.left + averageX}
                  y1={margin.top - averageGuideOvershoot}
                  x2={margin.left + averageX}
                  y2={axisBaseY}
                  stroke="var(--leaf)"
                  strokeDasharray="6 3"
                  strokeWidth={2}
                />
                <text
                  x={margin.left + averageX}
                  y={margin.top - averageGuideOvershoot - 4}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--leaf)"
                >
                  {`Promedio filtrado ${formatMinutesWithUnit(analysisSummary.average)}`}
                </text>
              </g>
            )}
            {hypothesisAverageX !== null && (
              <g>
                <line
                  x1={margin.left + hypothesisAverageX}
                  y1={margin.top - hypothesisGuideOvershoot}
                  x2={margin.left + hypothesisAverageX}
                  y2={axisBaseY}
                  stroke="#f59e0b"
                  strokeDasharray="3 3"
                  strokeWidth={2}
                />
                <text
                  x={margin.left + hypothesisAverageX}
                  y={margin.top - hypothesisGuideOvershoot - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#f59e0b"
                >
                  {`Promedio hipotesis ${formatMinutesWithUnit(analysisSummary.hypothesisMatchAverage)}`}
                </text>
              </g>
            )}
          </svg>
        </div>
        {showHypothesis && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--ink-muted)]">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-[var(--accent)]" />
              <span>Coincide con la hipotesis</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-blue-500" />
              <span>No coincide</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderDataTable = (rows: AnalysisPoint[], emptyLabel: string) => {
    if (!rows.length) {
      return <div className="text-sm text-[var(--ink-muted)]">{emptyLabel}</div>;
    }
    const sortedRows = [...rows].sort((a, b) => {
      const comparison = compareRowsBySort(a, b, dataTableSort.key);
      return dataTableSort.direction === 'asc' ? comparison : -comparison;
    });
    const renderSortableHeader = (label: string, key: DataTableSortKey) => {
      const isActive = dataTableSort.key === key;
      const indicator = isActive ? (dataTableSort.direction === 'asc' ? '▲' : '▼') : '↕';
      return (
        <button
          type="button"
          onClick={() => handleDataTableSort(key)}
          className="inline-flex items-center gap-1 text-left hover:text-[var(--ink)]"
          title={`Ordenar por ${label.toLowerCase()}`}
        >
          <span>{label}</span>
          <span aria-hidden="true" className="text-[10px]">{indicator}</span>
        </button>
      );
    };
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              <th className="px-3 py-2">{renderSortableHeader('Plan', 'plan')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Duracion', 'duration')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Esperado', 'expected')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Ratio', 'ratio')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Completado', 'completed')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Trabajador', 'worker')}</th>
              <th className="px-3 py-2">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={`${row.plan_id}-${row.task_definition_id || 'panel'}-${row.completed_at || row.worker_name || ''}`}
                className="border-b border-black/5 text-[var(--ink)]"
              >
                <td className="px-3 py-2">
                  {row.house_identifier || '-'}
                  {row.module_number ? ` / Modulo ${row.module_number}` : ''}
                </td>
                <td className="px-3 py-2">{formatMinutesWithUnit(row.duration_minutes)}</td>
                <td className="px-3 py-2">{formatMinutesWithUnit(row.expected_minutes)}</td>
                <td className="px-3 py-2">{formatRatio((row as AnalysisPoint & { ratio?: number | null }).ratio ?? null)}</td>
                <td className="px-3 py-2">{formatDateTime(row.completed_at)}</td>
                <td className="px-3 py-2">{row.worker_name || '-'}</td>
                <td className="px-3 py-2">
                  {displayAnalysisData?.mode === 'panel' ? (
                    row.task_breakdown && row.task_breakdown.length ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-[var(--ink-muted)]">Ver tareas</summary>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-[var(--ink)]">
                          {row.task_breakdown.map((task) => (
                            <li
                              key={`${row.plan_id}-${task.task_definition_id ?? task.task_name}-${task.completed_at ?? ''}`}
                              title={buildTaskBreakdownTooltip(task)}
                              className="cursor-help"
                            >
                              <strong>{task.task_name || task.task_definition_id}</strong>
                              {` - ${formatMinutesWithUnit(task.duration_minutes)}`}
                              {task.expected_minutes !== null && task.expected_minutes !== undefined
                                ? ` / Esperado ${formatMinutesWithUnit(task.expected_minutes)}`
                                : ''}
                              {task.worker_name ? ` - ${task.worker_name}` : ''}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      '-'
                    )
                  ) : (
                    row.task_name || '-'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderNormalizedHistogram = () => {
    const { bins, maxCount, binSize: size, maxValue } = normalizedHistogram;
    if (!bins.length || !maxCount) {
      return (
        <div className="text-sm text-[var(--ink-muted)]">
          No hay datos suficientes para la distribucion.
        </div>
      );
    }
    const chartHeight = 240;
    const margin = { top: 16, right: 16, bottom: 56, left: 56 };
    const chartWidth = Math.max(bins.length, 1) * 56;
    const svgWidth = chartWidth + margin.left + margin.right;
    const svgHeight = chartHeight + margin.top + margin.bottom;
    const valuePerPixel = maxValue > 0 ? maxValue / chartWidth : 1;
    const barFullWidth = size / valuePerPixel;
    const barWidth = barFullWidth * 0.72;
    const gap = (barFullWidth - barWidth) / 2;
    const axisBaseY = margin.top + chartHeight;
    const labelDigits = size < 1 ? 2 : size < 10 ? 1 : 0;

    return (
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <svg width={svgWidth} height={svgHeight} role="img" aria-label="Distribucion de tiempos normalizados">
            <line
              x1={margin.left}
              y1={axisBaseY}
              x2={margin.left + chartWidth}
              y2={axisBaseY}
              stroke="#374151"
              strokeWidth={1}
            />
            <line x1={margin.left} y1={margin.top} x2={margin.left} y2={axisBaseY} stroke="#374151" />
            {bins.map((bin) => {
              const barHeight = (bin.count / maxCount) * chartHeight;
              const x = margin.left + bin.index * barFullWidth + gap;
              const barTopY = axisBaseY - barHeight;
              const previewItems = bin.items.slice(0, 6);
              const tooltipLines = [
                `Rango: ${bin.from.toFixed(labelDigits)}-${bin.to.toFixed(labelDigits)} ${normalizedMetricUnit}`,
                `Muestras: ${bin.count}`,
                ...previewItems.map(
                  (item) => {
                    const measureValue = normalizedMetric === 'area' ? item.panel_area : item.panel_length_m;
                    const measureUnit = normalizedMetric === 'area' ? 'm2' : 'm';
                    return `${item.panel_label} / ${item.house_type_name} - ${formatMinutesWithUnit(
                      item.actual_minutes,
                    )} - ${formatMeasure(measureValue, measureUnit)} - ${formatMinutesPerUnit(
                      item.normalized_minutes,
                      normalizedMetricUnit,
                    )}`;
                  },
                ),
              ];
              if (bin.items.length > previewItems.length) {
                tooltipLines.push(`+${bin.items.length - previewItems.length} mas`);
              }
              const tooltip = tooltipLines.join('\n');
              return (
                <g key={bin.index}>
                  <title>{tooltip}</title>
                  <rect
                    x={x}
                    y={barTopY}
                    width={barWidth}
                    height={barHeight}
                    fill="#3b82f6"
                    aria-label={tooltip}
                  />
                  <text x={x + barWidth / 2} y={axisBaseY + 16} textAnchor="middle" fontSize="10" fill="#4b5563">
                    {`${bin.from.toFixed(labelDigits)}-${bin.to.toFixed(labelDigits)}`}
                  </text>
                  <text x={x + barWidth / 2} y={barTopY - 6} textAnchor="middle" fontSize="11" fill="#111827">
                    {bin.count}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <p className="text-xs text-[var(--ink-muted)]">
          Distribucion de {normalizedMetricLabel.toLowerCase()} por panel completado.
        </p>
      </div>
    );
  };

  const renderNormalizedScatter = () => {
    if (!normalizedReport.rows.length) {
      return <div className="text-sm text-[var(--ink-muted)]">No hay paneles para comparar con los filtros actuales.</div>;
    }
    const points = normalizedReport.rows
      .map((row) => {
        const measure = normalizedMetric === 'area' ? row.panel_area : row.panel_length_m;
        return { row, measure };
      })
      .filter((item) => Number.isFinite(item.measure) && item.measure > 0 && item.row.actual_minutes > 0);
    if (!points.length) {
      return (
        <div className="text-sm text-[var(--ink-muted)]">
          No hay datos suficientes para la dispersion.
        </div>
      );
    }
    const maxMeasure = Math.max(...points.map((item) => item.measure));
    const maxActualMinutesBase = Math.max(...points.map((item) => item.row.actual_minutes));
    if (!(maxMeasure > 0) || !(maxActualMinutesBase > 0)) {
      return (
        <div className="text-sm text-[var(--ink-muted)]">
          No hay datos suficientes para la dispersion.
        </div>
      );
    }
    const chartHeight = 280;
    const chartWidth = 720;
    const margin = { top: 16, right: 24, bottom: 64, left: 64 };
    const svgWidth = chartWidth + margin.left + margin.right;
    const svgHeight = chartHeight + margin.top + margin.bottom;
    const axisBaseY = margin.top + chartHeight;
    const measureUnit = normalizedMetric === 'area' ? 'm2' : 'm';
    const measureLabel = normalizedMetric === 'area' ? 'Area' : 'Largo';
    const regressionSamples: RegressionSample[] = points.map((item) => ({
      x: item.measure,
      y: item.row.actual_minutes,
    }));
    const showRegression = showNormalizedRegression;
    const regressionResult = showRegression ? calculateLinearRegression(regressionSamples) : null;
    const maxRegressionMinutes = regressionResult
      ? Math.max(
          regressionResult.startPredictedY,
          regressionResult.endPredictedY,
          ...(regressionResult.confidenceBand || []).map((point) => point.upperY),
        )
      : 0;
    const maxMinutesForAxis = Math.max(maxActualMinutesBase, maxRegressionMinutes);
    if (!(maxMinutesForAxis > 0)) {
      return (
        <div className="text-sm text-[var(--ink-muted)]">
          No hay datos suficientes para la dispersion.
        </div>
      );
    }
    const toXPosition = (measureValue: number) => margin.left + (measureValue / maxMeasure) * chartWidth;
    const toYPosition = (minutesValue: number) =>
      margin.top + chartHeight - (minutesValue / maxMinutesForAxis) * chartHeight;
    const clampToChartArea = (coordinate: number) =>
      Math.min(axisBaseY, Math.max(margin.top, Number.isFinite(coordinate) ? coordinate : axisBaseY));
    const averageByMeasure = Array.from(
      points
        .reduce((accumulator, item) => {
          const key = item.measure.toFixed(3);
          const current = accumulator.get(key);
          if (current) {
            current.totalMinutes += item.row.actual_minutes;
            current.count += 1;
          } else {
            accumulator.set(key, {
              measure: item.measure,
              totalMinutes: item.row.actual_minutes,
              count: 1,
            });
          }
          return accumulator;
        }, new Map<string, { measure: number; totalMinutes: number; count: number }>())
        .values(),
    )
      .map((entry) => ({
        measure: entry.measure,
        count: entry.count,
        averageMinutes: entry.totalMinutes / entry.count,
      }))
      .sort((a, b) => a.measure - b.measure);
    const showRawPoints = normalizedScatterDisplay === 'all';
    const regressionLine = regressionResult && regressionResult.maxX > regressionResult.minX
      ? {
          startX: toXPosition(regressionResult.minX),
          endX: toXPosition(regressionResult.maxX),
          startY: clampToChartArea(toYPosition(regressionResult.startPredictedY)),
          endY: clampToChartArea(toYPosition(regressionResult.endPredictedY)),
        }
      : null;
    const regressionBandPath = regressionResult?.confidenceBand && regressionResult.confidenceBand.length > 1
      ? (() => {
          const upper = regressionResult.confidenceBand.map((point) =>
            `${toXPosition(point.x)},${clampToChartArea(toYPosition(point.upperY))}`
          );
          const lower = [...regressionResult.confidenceBand]
            .reverse()
            .map((point) => `${toXPosition(point.x)},${clampToChartArea(toYPosition(point.lowerY))}`);
          return `M ${upper.join(' L ')} L ${lower.join(' L ')} Z`;
        })()
      : null;

    return (
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <svg width={svgWidth} height={svgHeight} role="img" aria-label="Dispersion tiempo vs medida">
            <line
              x1={margin.left}
              y1={axisBaseY}
              x2={margin.left + chartWidth}
              y2={axisBaseY}
              stroke="#374151"
              strokeWidth={1}
            />
            <line x1={margin.left} y1={margin.top} x2={margin.left} y2={axisBaseY} stroke="#374151" />
            {showRegression && regressionBandPath && (
              <path d={regressionBandPath} fill="rgba(185, 28, 28, 0.14)" stroke="none">
                <title>Banda de confianza al 95% para la media estimada.</title>
              </path>
            )}
            {showRawPoints && points.map((item, index) => {
              const xPosition = toXPosition(item.measure);
              const yPosition = toYPosition(item.row.actual_minutes);
              const tooltip = [
                `${item.row.panel_label} / ${item.row.house_type_name}`,
                `Grupo: ${item.row.panel_group}`,
                `Medida: ${formatMeasure(item.measure, measureUnit)}`,
                `Tiempo: ${formatMinutesWithUnit(item.row.actual_minutes)}`,
                `Normalizado: ${formatMinutesPerUnit(item.row.normalized_minutes, normalizedMetricUnit)}`,
              ].join('\n');
              return (
                <circle
                  key={`${item.row.id}-${index}`}
                  cx={xPosition}
                  cy={yPosition}
                  r={3}
                  fill="rgba(59,130,246,0.45)"
                >
                  <title>{tooltip}</title>
                </circle>
              );
            })}
            {averageByMeasure.map((entry, index) => {
              const xPosition = toXPosition(entry.measure);
              const yPosition = toYPosition(entry.averageMinutes);
              const tooltip = [
                `Promedio por medida: ${formatMeasure(entry.measure, measureUnit)}`,
                `Muestras: ${entry.count}`,
                `Tiempo promedio: ${formatMinutesWithUnit(entry.averageMinutes)}`,
              ].join('\n');
              return (
                <g key={`avg-${entry.measure}-${index}`}>
                  <title>{tooltip}</title>
                  <line
                    x1={xPosition - 5}
                    y1={yPosition - 5}
                    x2={xPosition + 5}
                    y2={yPosition + 5}
                    stroke="rgba(220, 38, 38, 0.55)"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                  <line
                    x1={xPosition - 5}
                    y1={yPosition + 5}
                    x2={xPosition + 5}
                    y2={yPosition - 5}
                    stroke="rgba(220, 38, 38, 0.55)"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
            {showRegression && regressionLine && regressionResult && (
              <line
                x1={regressionLine.startX}
                y1={regressionLine.startY}
                x2={regressionLine.endX}
                y2={regressionLine.endY}
                stroke="rgba(185, 28, 28, 0.82)"
                strokeWidth={2}
                strokeDasharray="6 5"
              >
                <title>
                  {`Regresion lineal - pendiente: ${formatRegressionIndicator(regressionResult.slope)} min/${measureUnit}, intercepto: ${formatRegressionIndicator(regressionResult.intercept)} min, R2: ${formatRegressionIndicator(regressionResult.rSquared, 4)}`}
                </title>
              </line>
            )}
            <text x={margin.left} y={svgHeight - 18} fontSize="11" fill="#4b5563">
              {`Medida (${measureUnit})`}
            </text>
            <text
              x={16}
              y={margin.top}
              fontSize="11"
              fill="#4b5563"
              transform={`rotate(-90 16 ${margin.top})`}
            >
              Tiempo (min)
            </text>
          </svg>
        </div>
        <p className="text-xs text-[var(--ink-muted)]">
          Eje X: {measureUnit}. Eje Y: tiempo de estacion (min).
        </p>
        {!showRawPoints && (
          <p className="text-xs text-[var(--ink-muted)]">Mostrando solo promedios por medida.</p>
        )}
        <p className="text-xs text-[var(--ink-muted)]">Cruces rojas: promedio de tiempo por cada medida unica.</p>
        {showRegression && regressionBandPath && (
          <p className="text-xs text-[var(--ink-muted)]">Franja roja: banda de confianza del 95%.</p>
        )}
        {showRegression && (
          <div className="rounded-xl border border-black/10 bg-white/80 px-4 py-3 text-sm text-[var(--ink)]">
            {!regressionResult ? (
              <p className="text-xs text-[var(--ink-muted)]">
                Se necesitan al menos dos paneles con medida y tiempo validos para calcular la regresion.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  {`Regresion tiempo vs ${measureLabel.toLowerCase()}`}
                </p>
                <p className="text-xs text-[var(--ink)]">
                  {`Tiempo (min) = ${formatRegressionIndicator(regressionResult.slope)} * ${measureLabel} (${measureUnit}) + ${formatRegressionIndicator(regressionResult.intercept)}`}
                </p>
                <div className="grid gap-2 text-xs text-[var(--ink-muted)] md:grid-cols-2 xl:grid-cols-4">
                  <span>
                    <strong>Muestras:</strong> {regressionResult.sampleCount}
                  </span>
                  <span>
                    <strong>R2:</strong> {formatRegressionIndicator(regressionResult.rSquared, 4)}
                  </span>
                  <span>
                    <strong>R2 ajustado:</strong> {formatRegressionIndicator(regressionResult.adjustedRSquared, 4)}
                  </span>
                  <span>
                    <strong>Correlacion (r):</strong> {formatRegressionIndicator(regressionResult.correlation, 4)}
                  </span>
                  <span>
                    <strong>RMSE:</strong> {formatRegressionIndicator(regressionResult.rmse)} min
                  </span>
                  <span>
                    <strong>MAE:</strong> {formatRegressionIndicator(regressionResult.mae)} min
                  </span>
                  <span>
                    <strong>Promedio medida:</strong> {formatRegressionIndicator(regressionResult.meanX)} {measureUnit}
                  </span>
                  <span>
                    <strong>Promedio tiempo:</strong> {formatRegressionIndicator(regressionResult.meanY)} min
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-black/5 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Filtro principal</p>
            <h1 className="font-display text-xl text-[var(--ink)]">Analisis de tiempos de tareas</h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              {activeTab === 'panel'
                ? 'Combina tipo de casa, panel y estacion para comparar duraciones reales contra lo esperado.'
                : 'Compara tiempos normalizados por area o largo entre paneles dentro de una misma estacion.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)]"
              onClick={activeTab === 'panel' ? resetFilters : resetNormalizedFilters}
            >
              <RefreshCcw className="h-4 w-4" />
              Restablecer filtros
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {[
            { key: 'panel', label: 'Panel especifico' },
            { key: 'normalized', label: 'Tiempo normalizado' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key === 'panel' ? 'panel' : 'normalized')}
              className={
                activeTab === tab.key
                  ? 'rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white'
                  : 'rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]'
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'panel' && (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Tipo de casa
            <select
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              value={selectedHouseTypeId}
              onChange={(event) => {
                const value = event.target.value;
                setSelectedHouseTypeId(value);
                setSelectedPanelId('');
                setSelectedTaskId('');
                setSelectedStationId('');
                setSelectedWorkerId('');
                setAnalysisData(null);
              }}
            >
              <option value="">Seleccione...</option>
              {houseTypes.map((houseType) => (
                <option key={houseType.id} value={houseType.id}>
                  {houseType.name || `Tipo ${houseType.id}`}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Panel
            <select
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              value={effectiveSelectedPanelId}
              onChange={(event) => {
                setSelectedPanelId(event.target.value);
                setSelectedTaskId('');
                setAnalysisData(null);
              }}
              disabled={!selectedHouseTypeId || panelsLoading}
            >
              <option value="">Seleccione...</option>
              {panelsForHouse.map((panel) => (
                <option key={panel.id} value={panel.id}>
                  {panelLabel(panel)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Estacion
            <select
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              value={selectedStationId}
              onChange={(event) => {
                const value = event.target.value;
                setSelectedStationId(value);
                setSelectedTaskId('');
                setAnalysisData(null);
              }}
            >
              <option value="">{stationsLoading ? 'Cargando...' : 'Seleccione...'}</option>
              {stations.map((station) => (
                <option key={station.id} value={station.id}>
                  {stationLabel(station)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Tarea (opcional)
            <select
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              value={effectiveSelectedTaskId}
              onChange={(event) => {
                setSelectedTaskId(event.target.value);
                setAnalysisData(null);
              }}
              disabled={!effectiveSelectedPanelId}
            >
              <option value="">Todas las tareas del panel</option>
              {filteredTasksForSelection.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Trabajador (opcional)
            <select
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              value={selectedWorkerId}
              onChange={(event) => {
                setSelectedWorkerId(event.target.value);
                setAnalysisData(null);
              }}
            >
              <option value="">Todos</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {workerLabel(worker)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Desde (opcional)
            <input
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              type="date"
              value={fromDate}
              onChange={(event) => {
                setFromDate(event.target.value);
                setAnalysisData(null);
              }}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Hasta (opcional)
            <input
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              type="date"
              value={toDate}
              onChange={(event) => {
                setToDate(event.target.value);
                setAnalysisData(null);
              }}
            />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            <Sliders className="h-4 w-4" />
            Ajustes del histograma
          </div>
          <div className="grid flex-1 gap-4 md:grid-cols-3">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Tamano de barra (min)
              <input
                className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                type="number"
                min="1"
                step="1"
                value={binSize}
                onChange={(event) => setBinSize(event.target.value)}
              />
            </label>

            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Min. multiplicador
              <input
                className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                type="number"
                step="0.1"
                value={minMultiplier}
                onChange={(event) => setMinMultiplier(event.target.value)}
              />
            </label>

            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Max. multiplicador
              <input
                className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                type="number"
                step="0.1"
                value={maxMultiplier}
                onChange={(event) => setMaxMultiplier(event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/60 p-4">
          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            <FlaskConical className="h-4 w-4" />
            Hipotesis de filtrado
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            {hypothesisEditorOpen ? (
              <>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Campo
                  <select
                    className="mt-2 w-full min-w-[160px] rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm"
                    value={hypothesisForm.field}
                    onChange={handleHypothesisFieldChange}
                  >
                    {HYPOTHESIS_FIELD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Condicion
                  <select
                    className="mt-2 w-full min-w-[120px] rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm"
                    value={hypothesisForm.operator}
                    onChange={handleHypothesisOperatorChange}
                  >
                    {getHypothesisFieldConfig(hypothesisForm.field).operators.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {hypothesisForm.field === 'date' ? (
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    Fecha
                    <input
                      className="mt-2 w-full min-w-[180px] rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm"
                      type="date"
                      value={hypothesisForm.value}
                      onChange={(event) => handleHypothesisValueChange(event.target.value)}
                    />
                  </label>
                ) : (
                  <div className="min-w-[220px]">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                      Trabajador
                      <select
                        className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm"
                        value={hypothesisForm.value}
                        onChange={(event) => handleHypothesisValueChange(event.target.value)}
                        disabled={!workerOptionsForHypothesis.length}
                      >
                        <option value="">Seleccione...</option>
                        {workerOptionsForHypothesis.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!workerOptionsForHypothesis.length && (
                      <p className="mt-2 text-xs text-[var(--ink-muted)]">
                        No hay trabajadores registrados con los filtros actuales.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white"
                    onClick={handleApplyHypothesis}
                    disabled={
                      (hypothesisForm.field === 'worker' && !hypothesisForm.value) ||
                      (hypothesisForm.field === 'worker' && !workerOptionsForHypothesis.length) ||
                      (hypothesisForm.field === 'date' && !hypothesisForm.value)
                    }
                  >
                    Aplicar
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]"
                    onClick={handleCancelHypothesis}
                  >
                    Cancelar
                  </button>
                </div>
              </>
            ) : activeHypothesisConfig ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm text-[var(--ink)]">
                  <strong>Hipotesis activa:</strong> {hypothesis.description || '-'}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)]"
                    onClick={openHypothesisEditor}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full bg-red-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-red-600"
                    onClick={handleRemoveHypothesis}
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)]"
                onClick={openHypothesisEditor}
              >
                Agregar hipotesis
              </button>
            )}
          </div>
          {hypothesisError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {hypothesisError}
            </div>
          )}
        </div>

        {panelsLoading && <p className="mt-4 text-sm text-[var(--ink-muted)]">Cargando paneles...</p>}
        {stationsLoading && <p className="mt-2 text-sm text-[var(--ink-muted)]">Cargando estaciones...</p>}
        {panelsError && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4" />
            {panelsError}
          </div>
        )}
            {!panelsError && stationsError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                <AlertTriangle className="h-4 w-4" />
                {stationsError}
              </div>
            )}
          </>
        )}

        {activeTab === 'normalized' && (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Tipo de casa
                <div className="relative mt-2" ref={houseTypeDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setHouseTypeDropdownOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-left text-sm text-[var(--ink)] shadow-sm"
                  >
                    <span className="truncate">{normalizedHouseTypeLabel}</span>
                    <ChevronDown
                      className={`h-4 w-4 text-[var(--ink-muted)] transition ${
                        houseTypeDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {houseTypeDropdownOpen && (
                    <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-lg">
                      <div className="border-b border-black/5 px-4 py-2 text-sm">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!normalizedHouseTypeIds.length}
                            onChange={() => setNormalizedHouseTypeIds([])}
                          />
                          <span className="text-[var(--ink)]">Todos los tipos de casa</span>
                        </label>
                      </div>
                      {houseTypes.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-[var(--ink-muted)]">
                          No hay tipos de casa disponibles.
                        </div>
                      ) : (
                        <div className="max-h-56 overflow-auto p-3 text-sm">
                          <div className="flex flex-col gap-2">
                            {houseTypes.map((houseType) => (
                              <label key={houseType.id} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={normalizedHouseTypeIds.includes(houseType.id)}
                                  onChange={() => toggleNormalizedHouseType(houseType.id)}
                                />
                                <span className="text-[var(--ink)]">
                                  {houseType.name || `Tipo ${houseType.id}`}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Grupo de panel
                <div className="relative mt-2" ref={panelTypeDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setPanelTypeDropdownOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-left text-sm text-[var(--ink)] shadow-sm"
                  >
                    <span className="truncate">{normalizedPanelTypeLabel}</span>
                    <ChevronDown
                      className={`h-4 w-4 text-[var(--ink-muted)] transition ${
                        panelTypeDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {panelTypeDropdownOpen && (
                    <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-lg">
                      <div className="border-b border-black/5 px-4 py-2 text-sm">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!normalizedPanelGroups.length}
                            onChange={() => setNormalizedPanelGroups([])}
                          />
                          <span className="text-[var(--ink)]">Todos los grupos</span>
                        </label>
                      </div>
                      {panelGroupOptions.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-[var(--ink-muted)]">
                          No hay grupos disponibles.
                        </div>
                      ) : (
                        <div className="max-h-56 overflow-auto p-3 text-sm">
                          <div className="flex flex-col gap-2">
                            {panelGroupOptions.map((panel) => (
                              <label key={panel.id} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={normalizedPanelGroups.includes(panel.id)}
                                  onChange={() => toggleNormalizedPanelGroup(panel.id)}
                                />
                                <span className="text-[var(--ink)]">
                                  {panel.label}
                                  <span className="text-[var(--ink-muted)]"> ({panel.count})</span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Estacion
                <select
                  className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                  value={normalizedStationId}
                  onChange={(event) => setNormalizedStationId(event.target.value)}
                >
                  <option value="">{stationsLoading ? 'Cargando...' : 'Seleccione...'}</option>
                  {stations.map((station) => (
                    <option key={station.id} value={station.id}>
                      {stationLabel(station)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Metrica
                <select
                  className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                  value={normalizedMetric}
                  onChange={(event) => setNormalizedMetric(event.target.value as NormalizedMetric)}
                >
                  <option value="linear">Tiempo por metro lineal</option>
                  <option value="area">Tiempo por area</option>
                </select>
              </label>

              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Desde (opcional)
                <input
                  className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                  type="date"
                  value={normalizedFromDate}
                  onChange={(event) => setNormalizedFromDate(event.target.value)}
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Hasta (opcional)
                <input
                  className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                  type="date"
                  value={normalizedToDate}
                  onChange={(event) => setNormalizedToDate(event.target.value)}
                />
              </label>
            </div>

            <div className="mt-6 flex flex-wrap gap-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                <Sliders className="h-4 w-4" />
                Rango de tiempo normalizado
              </div>
              <div className="grid flex-1 gap-4 md:grid-cols-3">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Min. tiempo ({normalizedMetricUnit})
                  <input
                    className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="5"
                    value={normalizedMinMinutes}
                    onChange={(event) => setNormalizedMinMinutes(event.target.value)}
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Max. tiempo ({normalizedMetricUnit})
                  <input
                    className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="20"
                    value={normalizedMaxMinutes}
                    onChange={(event) => setNormalizedMaxMinutes(event.target.value)}
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Tamano de bin ({normalizedMetricUnit})
                  <input
                    className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder={String(DEFAULT_NORMALIZED_BIN_SIZE)}
                    value={normalizedBinSize}
                    onChange={(event) => setNormalizedBinSize(event.target.value)}
                  />
                </label>
              </div>
            </div>

            <p className="mt-3 text-xs text-[var(--ink-muted)]">
              Solo se consideran paneles con area y largo definidos (mayores a 0). El rango filtra por{' '}
              {normalizedMetricUnit}. El bin aplica solo al histograma.
            </p>

            {panelsLoading && <p className="mt-4 text-sm text-[var(--ink-muted)]">Cargando paneles...</p>}
            {stationsLoading && <p className="mt-2 text-sm text-[var(--ink-muted)]">Cargando estaciones...</p>}
            {panelsError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                <AlertTriangle className="h-4 w-4" />
                {panelsError}
              </div>
            )}
            {!panelsError && stationsError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                <AlertTriangle className="h-4 w-4" />
                {stationsError}
              </div>
            )}
          </>
        )}
      </section>

      {activeTab === 'panel' && (
        <>
          {displayError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {displayError}
            </div>
          )}

          {displayLoading && !displayError && (
            <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm text-[var(--ink-muted)]">
              Actualizando analisis...
            </div>
          )}

          {displayAnalysisData && (
            <section className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Total</p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                    {displayAnalysisData.data_points?.length || 0}
                  </p>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Incluidas</p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{analysisSummary.included.length}</p>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Excluidas</p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{analysisSummary.excluded.length}</p>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Promedio bruto</p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                    {formatMinutesWithUnit(displayAnalysisData.stats?.average_duration)}
                  </p>
                </div>
              </div>

              {hypothesis.description && (
                <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm text-[var(--ink)]">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-2 rounded-full bg-black/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                      <Users className="h-3 w-3" />
                      Hipotesis
                    </span>
                    <span className="font-semibold">{hypothesis.description}</span>
                    {analysisSummary.hypothesisMatches !== null && (
                      <span className="text-sm text-[var(--ink-muted)]">
                        Coinciden: {analysisSummary.hypothesisMatches}
                      </span>
                    )}
                    {analysisSummary.hypothesisMatches !== null && (
                      <span className="text-sm text-[var(--ink-muted)]">
                        No coinciden: {Math.max(analysisSummary.included.length - analysisSummary.hypothesisMatches, 0)}
                      </span>
                    )}
                    {analysisSummary.hypothesisMatchAverage !== null && (
                      <span className="text-sm text-[var(--ink-muted)]">
                        Promedio hipotesis: {formatMinutesWithUnit(analysisSummary.hypothesisMatchAverage)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  <Filter className="h-4 w-4" />
                  Histograma
                  <button
                    type="button"
                    onClick={() => setShowHistogramMethodologyModal(true)}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-black/20 bg-white text-[10px] font-bold normal-case tracking-normal text-[var(--ink-muted)] transition hover:border-black/40 hover:text-[var(--ink)]"
                    title="Como se calcula la duracion"
                    aria-label="Como se calcula la duracion"
                  >
                    i
                  </button>
                </div>
                <div className="mt-4">{renderHistogram()}</div>
              </div>

              <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
                <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Muestras incluidas
                </h2>
                <div className="mt-4">
                  {renderDataTable(analysisSummary.included, 'No se encontraron muestras dentro del rango seleccionado.')}
                </div>
              </div>

              <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
                <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Muestras excluidas
                </h2>
                <div className="mt-4">
                  {renderDataTable(
                    analysisSummary.excluded,
                    'No se excluyeron muestras con los multiplicadores actuales.',
                  )}
                </div>
              </div>
            </section>
          )}

          {!displayAnalysisData && !displayLoading && !displayError && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              Seleccione tipo de casa, panel y estacion para ver el analisis.
            </div>
          )}
        </>
      )}

      {activeTab === 'normalized' && (
        <>
          {normalizedError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {normalizedError}
            </div>
          )}

          {normalizedLoading && !normalizedError && (
            <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm text-[var(--ink-muted)]">
              Actualizando analisis...
            </div>
          )}

          {!normalizedStationId && !normalizedLoading && !normalizedError && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              Seleccione una estacion para comparar paneles por {normalizedMetricLabel.toLowerCase()}.
            </div>
          )}

          {normalizedStationId && !normalizedLoading && !normalizedError && (
            <section className="space-y-6">
              <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-3 text-sm text-[var(--ink)]">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full bg-black/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    Estacion
                  </span>
                  <span className="font-semibold">
                    {selectedNormalizedStation ? stationLabel(selectedNormalizedStation) : normalizedStationId}
                  </span>
                  <span className="text-xs text-[var(--ink-muted)]">Metrica: {normalizedMetricLabel}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    Vista
                  </span>
                  {[
                    { key: 'histogram', label: 'Histograma' },
                    { key: 'scatter', label: 'Dispersion' },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setNormalizedView(option.key as 'histogram' | 'scatter')}
                      className={
                        normalizedView === option.key
                          ? 'rounded-full bg-[var(--ink)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white'
                          : 'rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]'
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {normalizedView === 'scatter' && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-xs text-[var(--ink)]">
                      <input
                        type="checkbox"
                        checked={normalizedScatterDisplay === 'all'}
                        onChange={(event) =>
                          setNormalizedScatterDisplay(event.target.checked ? 'all' : 'averages')
                        }
                      />
                      <span>Mostrar puntos individuales</span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-[var(--ink)]">
                      <input
                        type="checkbox"
                        checked={showNormalizedRegression}
                        onChange={(event) => setShowNormalizedRegression(event.target.checked)}
                      />
                      <span>Mostrar regresion lineal + banda 95%</span>
                    </label>
                  </div>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Completados filtrados</p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                    {normalizedReport.summary.totalMatching}
                  </p>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Incluidos</p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{normalizedReport.summary.included}</p>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Promedio</p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                    {formatMinutesPerUnit(normalizedReport.summary.averageMinutes, normalizedMetricUnit)}
                  </p>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Muestras</p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                    {normalizedReport.summary.sampleCount}
                  </p>
                </div>
              </div>

              {(normalizedReport.summary.missingMetric > 0 || normalizedReport.summary.missingTime > 0) && (
                <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm text-[var(--ink-muted)]">
                  {normalizedReport.summary.missingMetric > 0 && (
                    <span>Sin area/largo valido: {normalizedReport.summary.missingMetric}. </span>
                  )}
                  {normalizedReport.summary.missingTime > 0 && (
                    <span>Sin tiempo registrado: {normalizedReport.summary.missingTime}.</span>
                  )}
                </div>
              )}

              {(normalizedReport.summary.bestRow || normalizedReport.summary.worstRow) && (
                <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-3 text-sm text-[var(--ink)]">
                  <div className="flex flex-wrap items-center gap-3">
                    {normalizedReport.summary.bestRow && (
                      <span>
                        <strong>Mas rapido:</strong> {normalizedReport.summary.bestRow.panel_label} (
                        {formatMinutesPerUnit(
                          normalizedReport.summary.bestRow.normalized_minutes,
                          normalizedMetricUnit,
                        )}
                        )
                      </span>
                    )}
                    {normalizedReport.summary.worstRow && (
                      <span>
                        <strong>Mas lento:</strong> {normalizedReport.summary.worstRow.panel_label} (
                        {formatMinutesPerUnit(
                          normalizedReport.summary.worstRow.normalized_minutes,
                          normalizedMetricUnit,
                        )}
                        )
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
                <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  {normalizedView === 'histogram' ? 'Distribucion' : 'Dispersion'} por panel
                </h2>
                <div className="mt-4">
                  {normalizedView === 'histogram' ? renderNormalizedHistogram() : renderNormalizedScatter()}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {showHistogramMethodologyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="Metodologia de calculo de duraciones"
          onClick={() => setShowHistogramMethodologyModal(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-black/10 bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Como se calculan las duraciones
              </h3>
              <button
                type="button"
                onClick={() => setShowHistogramMethodologyModal(false)}
                className="rounded-full border border-black/10 px-2 py-1 text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm text-[var(--ink)]">
              <p>
                <strong>Unidad base:</strong> minutos.
              </p>
              <p>
                <strong>Modo panel (sin tarea seleccionada):</strong> cada muestra es un panel terminado. La duracion
                del panel se calcula uniendo los intervalos de tiempo de sus tareas y restando pausas.
              </p>
              <p>
                <strong>Modo tarea (con tarea seleccionada):</strong> cada muestra es una ejecucion de esa tarea.
                No se suman otras tareas.
              </p>
              <p>
                <strong>Pausas:</strong> se descuentan del tiempo activo. El tooltip de "Ver tareas" muestra inicio,
                fin, pausa total y detalle por pausa.
              </p>
              <p>
                <strong>Solapamientos entre tareas:</strong> no se duplican minutos. Se usa tiempo de pared (union de
                intervalos), no suma ciega de duraciones.
              </p>
              <p className="rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2 text-[13px]">
                Ejemplo: Tarea A dura 10 min (00:00-00:10). Tarea B dura 10 min y empieza al minuto 5
                (00:05-00:15). El total del panel es <strong>15 min</strong>, no 20 min, porque hay 5 min de
                traslape.
              </p>
              <p>
                <strong>Incluidas vs excluidas:</strong> el histograma usa solo "Muestras incluidas", definidas por el
                rango [esperado x min multiplicador, esperado x max multiplicador]. Las demas aparecen en "Muestras
                excluidas".
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardTasks;
