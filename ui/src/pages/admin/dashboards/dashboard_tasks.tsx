import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
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
  completed_at?: string | null;
  worker_name?: string | null;
};

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

const DEFAULT_BIN_SIZE = 2;
const DEFAULT_MIN_MULTIPLIER = 0.5;
const DEFAULT_MAX_MULTIPLIER = 2;
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

  const [analysisData, setAnalysisData] = useState<TaskAnalysisResponse | null>(null);
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

  const sequenceByStationId = useMemo(() => {
    const map = new Map<string, number>();
    stations.forEach((station) => {
      if (station && station.id != null && station.sequence_order != null) {
        map.set(String(station.id), Number(station.sequence_order));
      }
    });
    return map;
  }, [stations]);

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

  const selectionReady = Boolean(selectedHouseTypeId && effectiveSelectedPanelId && selectedStationId);
  const displayAnalysisData = selectionReady ? analysisData : null;
  const displayError = selectionErrorMessage || (selectionReady ? error : '');
  const displayLoading = selectionReady && loading;

  const panelLabel = (panel: PanelDefinition | null): string => {
    if (!panel) return '-';
    const module = panel.module_sequence_number ? `Modulo ${panel.module_sequence_number}` : 'Modulo';
    const group = panel.group || 'Grupo';
    return `${module} - ${group} - ${panel.panel_code || panel.id}`;
  };

  const workerLabel = (worker: Worker): string =>
    `${worker.first_name || ''} ${worker.last_name || ''}`.trim() || `Trabajador ${worker.id}`;

  const stationLabel = (station: Station): string => {
    const code = station.id ? String(station.id) : '';
    const name = station.name || '';
    if (!code && !name) return '-';
    return name ? `${code} - ${name}` : code;
  };

  const effectiveBinSize = Number(binSize) > 0 ? Number(binSize) : DEFAULT_BIN_SIZE;
  const effectiveMinMultiplier = Number(minMultiplier) || 0;
  const effectiveMaxMultiplier = Number(maxMultiplier) || Number.POSITIVE_INFINITY;

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
    selectedHouseTypeId,
    effectiveSelectedPanelId,
    effectiveSelectedTaskId,
    selectedStationId,
    selectedWorkerId,
    fromDate,
    toDate,
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
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2">Duracion</th>
              <th className="px-3 py-2">Esperado</th>
              <th className="px-3 py-2">Ratio</th>
              <th className="px-3 py-2">Completado</th>
              <th className="px-3 py-2">Trabajador</th>
              <th className="px-3 py-2">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
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
                            <li key={`${row.plan_id}-${task.task_definition_id ?? task.task_name}-${task.completed_at ?? ''}`}>
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

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-black/5 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Filtro principal</p>
            <h1 className="font-display text-xl text-[var(--ink)]">Analisis de tiempos de tareas</h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Combina tipo de casa, panel y estacion para comparar duraciones reales contra lo esperado.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)]"
              onClick={resetFilters}
            >
              <RefreshCcw className="h-4 w-4" />
              Restablecer filtros
            </button>
          </div>
        </div>

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
      </section>

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
    </div>
  );
};

export default DashboardTasks;
