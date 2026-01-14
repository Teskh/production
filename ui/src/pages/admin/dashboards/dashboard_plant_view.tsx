import React, { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  MapPin,
  Pause,
  Play,
  RefreshCcw,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';

type TimelineRow = {
  taskInstanceId: number;
  taskDefinitionId: number | null;
  taskName: string;
  taskScope: string;
  taskStatus: string;
  stationId: number;
  stationName: string;
  workerId: number;
  workerName: string;
  workOrderId: number | null;
  projectName: string;
  houseIdentifier: string;
  houseTypeId: number | null;
  houseTypeName: string;
  moduleNumber: number | null;
  workUnitId: number | null;
  panelUnitId: number | null;
  panelDefinitionId: number | null;
  panelCode: string;
  startedAt: Date;
  completedAt: Date;
  expectedMinutes: number | null;
  durationMinutes: number | null;
  pauseMinutes: number | null;
};

type StationData = {
  id: number;
  name: string;
  tasks: TimelineRow[];
  kind: StationKind;
};

type WorkerData = {
  id: number;
  name: string;
  tasks: TimelineRow[];
};

type StationKind = 'panel' | 'termination' | 'aux' | 'magazine' | 'other';

type StationView = StationData & {
  lineIndex?: number;
  lineLabel?: string;
};

type StationGroupView = {
  key: string;
  label: string;
  order: number;
  stations: StationView[];
};

const PLAYBACK_SPEEDS = [
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
  { label: '4x', value: 4 },
];

const PANEL_MATCHERS = [/framing/i, /mesa/i, /puente/i, /panel/i, /^w\d+/i];
const TERMINATION_MATCHERS = [/armado/i, /estacion/i, /^a\d+/i];
const AUX_MATCHERS = [/aux/i, /soporte/i, /support/i];
const MAG_MATCHERS = [/magazine/i];
const TERMINATION_GROUP_LABELS = [
  'Armado',
  'Estacion 1',
  'Estacion 2',
  'Estacion 3',
  'Estacion 4',
  'Estacion 5',
  'Estacion 6',
];
const TERMINATION_LINE_COUNT = 3;

const normalizeStationName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const getStationKind = (stationName: string): StationKind => {
  const normalized = normalizeStationName(stationName);
  if (AUX_MATCHERS.some((matcher) => matcher.test(normalized))) return 'aux';
  if (MAG_MATCHERS.some((matcher) => matcher.test(normalized))) return 'magazine';
  if (TERMINATION_MATCHERS.some((matcher) => matcher.test(normalized))) return 'termination';
  if (PANEL_MATCHERS.some((matcher) => matcher.test(normalized))) return 'panel';
  return 'other';
};

const getTerminationOrder = (stationName: string): number => {
  const normalized = normalizeStationName(stationName);
  if (normalized.includes('armado')) return 0;
  const match = normalized.match(/estacion\s*(\d+)/i);
  if (match) return Number(match[1]);
  return 99;
};

const formatLineLabel = (index: number) => `Linea ${index}`;

const parseNumber = (value: string | undefined): number | null => {
  if (value === undefined || value === null) return null;
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const csvLineToCells = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const next = line[index + 1];
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
};

const parseCsvText = (text: string): TimelineRow[] => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) return [];
  const headers = csvLineToCells(lines[0]).map((header) => header.trim());
  const rows: TimelineRow[] = [];

  for (const line of lines.slice(1)) {
    const values = csvLineToCells(line);
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? '';
    });
    const startedAt = parseDate(record.started_at);
    const completedAt = parseDate(record.completed_at);
    const stationId = parseNumber(record.station_id);
    const workerId = parseNumber(record.worker_id);
    const taskInstanceId = parseNumber(record.task_instance_id);

    if (!startedAt || !completedAt || !stationId || !workerId || !taskInstanceId) {
      continue;
    }

    rows.push({
      taskInstanceId,
      taskDefinitionId: parseNumber(record.task_definition_id),
      taskName: record.task_name || 'Tarea',
      taskScope: record.task_scope || '-',
      taskStatus: record.task_status || '-',
      stationId,
      stationName: record.station_name || `Estacion ${stationId}`,
      workerId,
      workerName: record.worker_name || `Operario ${workerId}`,
      workOrderId: parseNumber(record.work_order_id),
      projectName: record.project_name || '-',
      houseIdentifier: record.house_identifier || '-',
      houseTypeId: parseNumber(record.house_type_id),
      houseTypeName: record.house_type_name || '-',
      moduleNumber: parseNumber(record.module_number),
      workUnitId: parseNumber(record.work_unit_id),
      panelUnitId: parseNumber(record.panel_unit_id),
      panelDefinitionId: parseNumber(record.panel_definition_id),
      panelCode: record.panel_code || '',
      startedAt,
      completedAt,
      expectedMinutes: parseNumber(record.expected_minutes),
      durationMinutes: parseNumber(record.duration_minutes),
      pauseMinutes: parseNumber(record.pause_minutes),
    });
  }

  return rows;
};

const formatTime = (value: Date) =>
  value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatDate = (value: Date) =>
  value.toLocaleDateString([], { year: 'numeric', month: 'short', day: '2-digit' });

const formatWorkerName = (name: string, compact: boolean) => {
  if (!compact) return name;
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return name;
  if (tokens.length === 1) return tokens[0];
  if (tokens.length === 2) return `${tokens[0]} ${tokens[1]}`;
  return `${tokens[0]} ${tokens[tokens.length - 2]}`;
};

const getActiveTasks = (tasks: TimelineRow[], currentTime: Date | null) => {
  if (!currentTime) return [];
  return tasks.filter((task) => task.startedAt <= currentTime && task.completedAt > currentTime);
};

const getProgressDetails = (task: TimelineRow, currentTime: Date | null) => {
  if (!currentTime) {
    return { progress: 0, color: 'var(--leaf)', label: '--' };
  }
  const expected = Math.max(task.expectedMinutes ?? task.durationMinutes ?? 1, 1);
  const elapsedMinutes = Math.max(
    (currentTime.getTime() - task.startedAt.getTime()) / 60000,
    0
  );
  const rawLoops = elapsedMinutes / expected;
  let loopIndex = Math.floor(rawLoops);
  let loopProgress = rawLoops - loopIndex;
  if (loopProgress === 0 && rawLoops > 0) {
    loopIndex = Math.max(loopIndex - 1, 0);
    loopProgress = 1;
  }
  const color =
    loopIndex === 0 ? 'var(--leaf)' : loopIndex === 1 ? '#f59e0b' : '#dc2626';
  return {
    progress: Math.min(Math.max(loopProgress, 0), 1),
    color,
    label: `${rawLoops.toFixed(1)}x`,
  };
};

const DashboardPlantView: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [dataError, setDataError] = useState('');
  const [dataSource, setDataSource] = useState('Sin archivo cargado');
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [timeOffsetMinutes, setTimeOffsetMinutes] = useState(0);
  const [loadingSample, setLoadingSample] = useState(false);
  const [activeTab, setActiveTab] = useState<'paneles' | 'terminaciones'>('paneles');
  const [plantViewOpen, setPlantViewOpen] = useState(false);

  useEffect(() => {
    setHeader({
      title: 'Vista de planta',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  const stations = useMemo<StationData[]>(() => {
    const stationMap = new Map<number, StationData>();
    rows.forEach((row) => {
      if (!stationMap.has(row.stationId)) {
        const kind = getStationKind(row.stationName);
        stationMap.set(row.stationId, {
          id: row.stationId,
          name: row.stationName,
          tasks: [],
          kind,
        });
      }
      stationMap.get(row.stationId)?.tasks.push(row);
    });
    return Array.from(stationMap.values())
      .map((station) => ({
        ...station,
        tasks: station.tasks.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime()),
      }))
      .sort((a, b) => a.id - b.id);
  }, [rows]);

  const workers = useMemo<WorkerData[]>(() => {
    const workerMap = new Map<number, WorkerData>();
    rows.forEach((row) => {
      if (!workerMap.has(row.workerId)) {
        workerMap.set(row.workerId, { id: row.workerId, name: row.workerName, tasks: [] });
      }
      workerMap.get(row.workerId)?.tasks.push(row);
    });
    return Array.from(workerMap.values())
      .map((worker) => ({
        ...worker,
        tasks: worker.tasks.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime()),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const { minTime, maxTime } = useMemo(() => {
    if (rows.length === 0) {
      return { minTime: null as Date | null, maxTime: null as Date | null };
    }
    let min = rows[0].startedAt.getTime();
    let max = rows[0].completedAt.getTime();
    rows.forEach((row) => {
      min = Math.min(min, row.startedAt.getTime());
      max = Math.max(max, row.completedAt.getTime());
    });
    return { minTime: new Date(min), maxTime: new Date(max) };
  }, [rows]);

  const totalMinutes = useMemo(() => {
    if (!minTime || !maxTime) return 0;
    const diff = Math.max(maxTime.getTime() - minTime.getTime(), 0);
    return Math.max(1, Math.ceil(diff / 60000));
  }, [minTime, maxTime]);

  const stepMinutes = totalMinutes > 600 ? 10 : totalMinutes > 240 ? 5 : 1;

  useEffect(() => {
    setTimeOffsetMinutes(0);
    setPlaying(false);
  }, [rows]);

  useEffect(() => {
    if (!playing || totalMinutes === 0) return;
    const intervalMs = Math.max(200, 900 / playbackRate);
    const timer = window.setInterval(() => {
      setTimeOffsetMinutes((prev) => {
        const next = prev + stepMinutes;
        if (next >= totalMinutes) {
          setPlaying(false);
          return totalMinutes;
        }
        return next;
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [playing, playbackRate, stepMinutes, totalMinutes]);

  const currentTime = useMemo(() => {
    if (!minTime) return null;
    return new Date(minTime.getTime() + timeOffsetMinutes * 60000);
  }, [minTime, timeOffsetMinutes]);

  const panelGroups = useMemo<StationGroupView[]>(() => {
    return stations
      .filter((station) => station.kind === 'panel')
      .map((station) => ({
        key: `panel-${station.id}`,
        label: station.name,
        order: station.id,
        stations: [station],
      }))
      .sort((a, b) => a.order - b.order);
  }, [stations]);

  const terminationGroups = useMemo<StationGroupView[]>(() => {
    const groupedStations = new Map<string, StationData[]>();
    stations
      .filter((station) => station.kind === 'termination')
      .forEach((station) => {
        const normalized = normalizeStationName(station.name);
        if (!groupedStations.has(normalized)) {
          groupedStations.set(normalized, []);
        }
        groupedStations.get(normalized)?.push(station);
      });

    return TERMINATION_GROUP_LABELS.map((label, groupIndex) => {
      const normalized = normalizeStationName(label);
      const orderedStations = [...(groupedStations.get(normalized) ?? [])].sort(
        (a, b) => a.id - b.id
      );
      const stationsWithLine: StationView[] = Array.from(
        { length: TERMINATION_LINE_COUNT },
        (_, idx) => {
          const lineIndex = idx + 1;
          const existing = orderedStations[idx];
          if (existing) {
            return {
              ...existing,
              lineIndex,
              lineLabel: formatLineLabel(lineIndex),
            };
          }
          return {
            id: -(groupIndex * 10 + lineIndex),
            name: label,
            tasks: [] as TimelineRow[],
            kind: 'termination',
            lineIndex,
            lineLabel: formatLineLabel(lineIndex),
          };
        }
      );
      return {
        key: normalized,
        label,
        order: getTerminationOrder(label),
        stations: stationsWithLine,
      };
    });
  }, [stations]);

  const visibleGroups = activeTab === 'paneles' ? panelGroups : terminationGroups;
  const visibleStationCount = visibleGroups.reduce(
    (sum, group) => sum + group.stations.length,
    0
  );

  const stats = useMemo(() => {
    if (!currentTime || !minTime || !maxTime) {
      return null;
    }
    const activeStations = stations.filter((station) =>
      station.tasks.some(
        (task) => task.startedAt <= currentTime && task.completedAt > currentTime
      )
    ).length;
    const activeWorkers = workers.filter((worker) =>
      worker.tasks.some((task) => task.startedAt <= currentTime && task.completedAt > currentTime)
    ).length;
    const rangeHours = Math.max(1, Math.round((maxTime.getTime() - minTime.getTime()) / 3_600_000));
    return {
      activeStations,
      activeWorkers,
      rangeHours,
    };
  }, [currentTime, minTime, maxTime, stations, workers]);

  const loadRowsFromText = (text: string, sourceLabel: string) => {
    setDataError('');
    const parsed = parseCsvText(text);
    if (parsed.length === 0) {
      setDataError('No se encontraron registros validos en el CSV.');
      setRows([]);
      return;
    }
    setRows(parsed);
    setDataSource(sourceLabel);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        setDataError('No se pudo leer el archivo.');
        return;
      }
      loadRowsFromText(result, file.name);
    };
    reader.onerror = () => {
      setDataError('No se pudo leer el archivo.');
    };
    reader.readAsText(file);
  };

  const loadSample = async () => {
    setLoadingSample(true);
    setDataError('');
    try {
      const response = await fetch('/synthetic_task_timeline.csv');
      if (!response.ok) {
        throw new Error('No se encontro /synthetic_task_timeline.csv');
      }
      const text = await response.text();
      loadRowsFromText(text, 'synthetic_task_timeline.csv');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo cargar el CSV';
      setDataError(message);
    } finally {
      setLoadingSample(false);
    }
  };

  const openPlantView = () => {
    setPlantViewOpen(true);
    setPlaying(true);
  };

  const closePlantView = () => {
    setPlantViewOpen(false);
    setPlaying(false);
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-black/5 bg-white/80 p-6 shadow-sm">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.65),_rgba(246,242,234,0.4)_50%,_rgba(244,236,224,0.6)_100%)]" />
        <div className="pointer-events-none absolute -right-10 top-8 h-44 w-44 rounded-full bg-[var(--sky)]/45 blur-3xl" />
        <div className="pointer-events-none absolute -left-12 bottom-4 h-40 w-40 rounded-full bg-[var(--accent-soft)]/60 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
              Seguimiento en planta
            </p>
            <h1 className="font-display text-2xl text-[var(--ink)]">
              Mapa vivo del turno
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Carga el CSV sintetico y revisa estaciones, operarios y flujo en el tiempo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-black/10 bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)] shadow-sm">
              <UploadCloud className="h-4 w-4 text-[var(--accent)]" />
              Subir CSV
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
            <button
              type="button"
              onClick={loadSample}
              disabled={loadingSample}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)] shadow-sm transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCcw className="h-4 w-4 text-[var(--ink-muted)]" />
              {loadingSample ? 'Cargando' : 'Cargar demo'}
            </button>
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap items-center gap-3 text-xs text-[var(--ink-muted)]">
          <span className="rounded-full border border-black/10 bg-white/70 px-3 py-1 uppercase tracking-[0.2em]">
            Fuente: {dataSource}
          </span>
          {dataError ? (
            <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-red-700">
              {dataError}
            </span>
          ) : null}
        </div>
      </div>

      <div className="rounded-3xl border border-black/5 bg-white/85 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
              Reproduccion
            </p>
            <h2 className="font-display text-xl text-[var(--ink)]">Vista de planta</h2>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Abre la vista completa para recorrer el turno y ver el flujo en tiempo real.
            </p>
          </div>
          <button
            type="button"
            onClick={openPlantView}
            disabled={!currentTime}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play className="h-4 w-4" />
            Play
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
          <span className="rounded-full border border-black/10 bg-white px-3 py-1">
            Registros {rows.length}
          </span>
          <span className="rounded-full border border-black/10 bg-white px-3 py-1">
            Estaciones {stations.length}
          </span>
          <span className="rounded-full border border-black/10 bg-white px-3 py-1">
            Operarios {workers.length}
          </span>
        </div>
      </div>

      {plantViewOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={closePlantView}
        >
          <div
            className="relative flex h-[92vh] w-[96vw] flex-col overflow-hidden rounded-3xl border border-black/10 bg-white/95 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 bg-white/80 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Vista de planta
                </p>
                <h2 className="font-display text-lg text-[var(--ink)]">
                  Mapa vivo del turno
                </h2>
              </div>
              <button
                type="button"
                onClick={closePlantView}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)] transition hover:border-black/20"
              >
                <X className="h-4 w-4" />
                Cerrar
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-5">
                <div className="rounded-3xl border border-black/5 bg-white/85 p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                        Tiempo
                      </p>
                      <h2 className="font-display text-xl text-[var(--ink)]">
                        Linea temporal del turno
                      </h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPlaying((prev) => !prev)}
                        disabled={!currentTime}
                        className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        {playing ? 'Pausa' : 'Play'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTimeOffsetMinutes(0)}
                        disabled={!currentTime}
                        className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)] transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Reiniciar
                      </button>
                    </div>
                  </div>
                  <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--ink-muted)]">
                        <span>
                          {currentTime && minTime
                            ? `${formatDate(minTime)} - ${formatDate(currentTime)}`
                            : 'Sin datos'}
                        </span>
                        <span>
                          {currentTime ? `${formatTime(currentTime)}` : '--:--'}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={totalMinutes}
                        step={stepMinutes}
                        value={timeOffsetMinutes}
                        onChange={(event) => setTimeOffsetMinutes(Number(event.target.value))}
                        className="mt-3 w-full accent-[var(--accent)]"
                        disabled={!currentTime}
                      />
                      <div className="mt-2 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                        <span>{minTime ? formatTime(minTime) : '--:--'}</span>
                        <span>{maxTime ? formatTime(maxTime) : '--:--'}</span>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-black/5 bg-white/70 p-4">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                        Velocidad
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {PLAYBACK_SPEEDS.map((speed) => (
                          <button
                            key={speed.value}
                            type="button"
                            onClick={() => setPlaybackRate(speed.value)}
                            className={
                              speed.value === playbackRate
                                ? 'rounded-lg bg-[var(--ink)] px-2 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white'
                                : 'rounded-lg border border-black/10 bg-white px-2 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]'
                            }
                          >
                            {speed.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {stats ? (
                    <div className="mt-6 grid gap-3 sm:grid-cols-3">
                      {[
                        { label: 'Estaciones activas', value: stats.activeStations, icon: MapPin },
                        { label: 'Operarios activos', value: stats.activeWorkers, icon: Users },
                        { label: 'Horas simuladas', value: stats.rangeHours, icon: Clock },
                      ].map((card) => (
                        <div
                          key={card.label}
                          className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white/70 px-4 py-3"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                            <card.icon className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                              {card.label}
                            </p>
                            <p className="text-lg font-semibold text-[var(--ink)]">{card.value}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-3xl border border-black/5 bg-white/85 p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                        Planta
                      </p>
                      <h2 className="font-display text-xl text-[var(--ink)]">
                        Mapa de estaciones
                      </h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-black/10 bg-white px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                        {visibleStationCount} estaciones
                      </span>
                      <span className="rounded-full border border-black/10 bg-white px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                        {activeTab === 'paneles' ? 'Paneles' : 'Terminaciones'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {[
                      { key: 'paneles', label: 'Paneles' },
                      { key: 'terminaciones', label: 'Terminaciones' },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() =>
                          setActiveTab(tab.key === 'paneles' ? 'paneles' : 'terminaciones')
                        }
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
                  <div className="mt-5 space-y-5">
                    {visibleGroups.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
                        No hay estaciones disponibles para este tab.
                      </div>
                    ) : (
                      visibleGroups.map((group) => {
                        const groupWorkerIds = new Set<number>();
                        group.stations.forEach((station) => {
                          station.tasks.forEach((task) => groupWorkerIds.add(task.workerId));
                        });
                        const groupWorkers = workers.filter((worker) => groupWorkerIds.has(worker.id));
                        const activeWorkerIds = new Set<number>();
                        if (currentTime) {
                          group.stations.forEach((station) => {
                            getActiveTasks(station.tasks, currentTime).forEach((task) =>
                              activeWorkerIds.add(task.workerId)
                            );
                          });
                        }
                        const idleWorkers = groupWorkers.filter(
                          (worker) => !activeWorkerIds.has(worker.id)
                        );
                        const compactNames = activeTab === 'terminaciones';
                        const workerChipClass = compactNames
                          ? 'rounded-full border border-black/10 bg-white px-2 py-1 text-[10px] font-semibold text-[var(--ink)]'
                          : 'rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[var(--ink)]';
                        const workerChipGap = compactNames ? 'gap-1' : 'gap-2';
                        return (
                          <div
                            key={group.key}
                            className="rounded-3xl border border-black/10 bg-white/75 p-5 shadow-sm"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-4">
                              <div>
                                <p className="text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)]">
                                  {activeTab === 'paneles' ? 'Estacion' : 'Grupo'}
                                </p>
                                <h3 className="text-lg font-semibold text-[var(--ink)]">{group.label}</h3>
                                {activeTab === 'terminaciones' ? (
                                  <p className="text-xs text-[var(--ink-muted)]">
                                    Lineas 1-3 · {group.stations.length} estaciones
                                  </p>
                                ) : (
                                  <p className="text-xs text-[var(--ink-muted)]">Secuencia {group.order}</p>
                                )}
                              </div>
                              <div className={`flex flex-wrap items-center ${workerChipGap}`}>
                                <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                                  Equipo asignado
                                </span>
                                {idleWorkers.length === 0 ? (
                                  <span className="rounded-full border border-dashed border-black/10 bg-white px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                                    Sin operarios libres
                                  </span>
                                ) : (
                                  idleWorkers.map((worker) => (
                                    <span
                                      key={worker.id}
                                      className={workerChipClass}
                                    >
                                      {formatWorkerName(worker.name, compactNames)}
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                            <div
                              className={`mt-4 grid gap-4 ${
                                activeTab === 'paneles'
                                  ? 'sm:grid-cols-2 xl:grid-cols-3'
                                  : 'lg:grid-cols-3'
                              }`}
                            >
                              {group.stations.map((station) => {
                                const activeTasks = getActiveTasks(station.tasks, currentTime);
                                const activeTask = activeTasks[0];
                                const extraActive = Math.max(activeTasks.length - 1, 0);
                                const hasActive = Boolean(activeTask);
                                const lastTask = currentTime
                                  ? [...station.tasks]
                                      .reverse()
                                      .find((task) => task.completedAt <= currentTime)
                                  : null;
                                const nextTask = currentTime
                                  ? station.tasks.find((task) => task.startedAt > currentTime)
                                  : null;
                                const activeWorkerLabels = Array.from(
                                  new Set(
                                    activeTasks.map((task) =>
                                      formatWorkerName(task.workerName, compactNames)
                                    )
                                  )
                                );
                                const progressDetails =
                                  activeTask && currentTime
                                    ? getProgressDetails(activeTask, currentTime)
                                    : { progress: 0, color: 'var(--leaf)', label: '--' };
                                const expectedMinutes = activeTask?.expectedMinutes ?? activeTask?.durationMinutes;
                                const elapsedMinutes =
                                  activeTask && currentTime
                                    ? Math.max(
                                        (currentTime.getTime() - activeTask.startedAt.getTime()) / 60000,
                                        0
                                      )
                                    : 0;
                                const ringDegrees = Math.round(progressDetails.progress * 360);
                                return (
                                  <div
                                    key={station.id}
                                    className={`rounded-2xl border ${
                                      hasActive ? 'border-[var(--leaf)]/40' : 'border-black/10'
                                    } bg-white/90 p-5 shadow-sm`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        {station.lineLabel ? (
                                          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                                            {station.lineLabel}
                                          </p>
                                        ) : null}
                                        <h4 className="text-base font-semibold text-[var(--ink)]">
                                          {station.name}
                                        </h4>
                                      </div>
                                      <span
                                        className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${
                                          hasActive
                                            ? 'bg-[var(--leaf)]/15 text-[var(--leaf)]'
                                            : 'bg-black/5 text-[var(--ink-muted)]'
                                        }`}
                                      >
                                        {hasActive ? 'Trabajando' : 'Idle'}
                                      </span>
                                    </div>

                                    {hasActive && activeTask ? (
                                      <div className="mt-4 space-y-3 text-sm">
                                        <div className="flex items-start gap-3">
                                          <div className="relative h-12 w-12">
                                            <div
                                              className="absolute inset-0 rounded-full"
                                              style={{
                                                background: `conic-gradient(${progressDetails.color} 0deg ${ringDegrees}deg, rgba(15,27,45,0.12) ${ringDegrees}deg 360deg)`,
                                              }}
                                            />
                                            <div className="absolute inset-1 rounded-full bg-white" />
                                            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-[var(--ink)]">
                                              {progressDetails.label}
                                            </div>
                                          </div>
                                          <div className="flex-1">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                              <div
                                                className={`flex flex-wrap items-center ${workerChipGap}`}
                                              >
                                                {activeWorkerLabels.map((name) => (
                                                  <span
                                                    key={name}
                                                    className={workerChipClass}
                                                  >
                                                    {name}
                                                  </span>
                                                ))}
                                                {extraActive ? (
                                                  <span className="rounded-full border border-black/10 bg-white px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                                                    +{extraActive} tareas
                                                  </span>
                                                ) : null}
                                              </div>
                                              <span className="text-xs text-[var(--ink-muted)]">
                                                {formatTime(activeTask.startedAt)} -{' '}
                                                {formatTime(activeTask.completedAt)}
                                              </span>
                                            </div>
                                            <p className="mt-2 text-sm text-[var(--ink-muted)]">
                                              {activeTask.taskName} · Modulo{' '}
                                              {activeTask.moduleNumber ?? '-'}
                                              {activeTask.panelCode ? ` · Panel ${activeTask.panelCode}` : ''}
                                            </p>
                                            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                                              <span>
                                                Esperado {expectedMinutes ? `${expectedMinutes.toFixed(1)}m` : '--'}
                                              </span>
                                              <span>Transcurrido {elapsedMinutes.toFixed(1)}m</span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="mt-4 space-y-2 text-xs text-[var(--ink-muted)]">
                                        <div className="flex items-center justify-between">
                                          <span>Ultima tarea</span>
                                          <span>{lastTask ? formatTime(lastTask.completedAt) : '--:--'}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span>Proxima tarea</span>
                                          <span>{nextTask ? formatTime(nextTask.startedAt) : '--:--'}</span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default DashboardPlantView;
