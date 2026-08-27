import React, { useEffect, useMemo, useState } from 'react';
import { Download, Eye, EyeOff, Filter, RefreshCcw, X } from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';
import { formatMinutesWithUnit } from '../../../utils/timeUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type HouseType = {
  id: number;
  name: string;
  number_of_modules: number;
};

type Station = {
  id: number;
  name: string;
  role: string;
  sequence_order: number | null;
};

type PanelLinearMetersStationStats = {
  station_id: number;
  station_name?: string | null;
  avg_time_minutes?: number | null;
  expected_avg_minutes?: number | null;
  avg_ratio?: number | null;
  lm_per_minute?: number | null;
  sample_count?: number | null;
};

type PanelLinearMetersRow = {
  panel_definition_id: number;
  house_type_id: number;
  house_type_name?: string | null;
  module_sequence_number?: number | null;
  panel_sequence_number?: number | null;
  panel_code?: string | null;
  panel_length_m?: number | null;
  stations?: Record<string, PanelLinearMetersStationStats> | null;
};

type PanelLinearMetersResponse = {
  rows: PanelLinearMetersRow[];
  total_panels?: number | null;
};

type PauseSummaryReason = {
  reason: string;
  total_duration_minutes: number;
  occurrence_count: number;
};

type PauseSummaryResponse = {
  from_date?: string | null;
  to_date?: string | null;
  total_pause_minutes?: number | null;
  pause_reasons?: PauseSummaryReason[] | null;
};

type PauseSummaryContribution = {
  pause_id: number;
  task_instance_id: number;
  task_definition_id?: number | null;
  task_name: string;
  station_id: number;
  station_name: string;
  project_name?: string | null;
  house_identifier?: string | null;
  module_number?: number | null;
  panel_code?: string | null;
  paused_at: string;
  resumed_at: string;
  duration_minutes: number;
};

type PauseSummaryDetailsResponse = {
  from_date?: string | null;
  to_date?: string | null;
  reason: string;
  station_id?: number | null;
  total_pause_minutes: number;
  occurrence_count: number;
  contributions: PauseSummaryContribution[];
};

type PauseDetailSelection = {
  reason: string;
  stationName: string;
};

const DEFAULT_MIN_MULTIPLIER = 0.5;
const DEFAULT_MAX_MULTIPLIER = 2.0;

const pad = (value: number) => String(value).padStart(2, '0');

const todayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const weekStartStr = (referenceDate: Date = new Date()) => {
  const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const day = date.getDay();
  const diffFromMonday = (day + 6) % 7;
  date.setDate(date.getDate() - diffFromMonday);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const parseMultiplierInput = (rawValue: string, fallbackValue: number) => {
  if (!rawValue) return fallbackValue;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return Math.max(0, parsed);
};

const formatDuration = (totalMinutes: number | null | undefined) => {
  if (totalMinutes == null || !Number.isFinite(totalMinutes)) return '-';
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
};

const dateTimeFormatter = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const formatDateTime = (value: string) => dateTimeFormatter.format(new Date(value));

const formatPanelLengthMeters = (value: number | null | undefined) => {
  if (value == null) return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '-';
  return numeric.toFixed(2);
};

const formatLmPerMinute = (value: number | null | undefined) => {
  if (value == null) return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '-';
  return numeric.toFixed(3);
};

const ratioToBackgroundColor = (ratio: number | null | undefined) => {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  if (ratio >= 1) {
    const t = Math.max(0, Math.min(1, (ratio - 1) / 1));
    const alpha = 0.06 + 0.28 * t;
    return `rgba(220, 53, 69, ${alpha})`;
  }
  const t = Math.max(0, Math.min(1, (1 - ratio) / 0.5));
  const alpha = 0.06 + 0.22 * t;
  return `rgba(40, 167, 69, ${alpha})`;
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

const roundNumber = (value: number | null | undefined, digits: number) => {
  if (value == null || !Number.isFinite(value)) return '';
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const escapeCsv = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const DashboardPanels: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [houseTypes, setHouseTypes] = useState<HouseType[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedHouseTypeId, setSelectedHouseTypeId] = useState('');
  const [fromDate, setFromDate] = useState(() => weekStartStr());
  const [toDate, setToDate] = useState(() => todayStr());
  const [minMultiplier, setMinMultiplier] = useState(String(DEFAULT_MIN_MULTIPLIER));
  const [maxMultiplier, setMaxMultiplier] = useState(String(DEFAULT_MAX_MULTIPLIER));

  const [tableData, setTableData] = useState<PanelLinearMetersResponse | null>(null);
  const [excludedRowIds, setExcludedRowIds] = useState<Set<number>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const [pauseData, setPauseData] = useState<PauseSummaryResponse | null>(null);
  const [pauseLoading, setPauseLoading] = useState(false);
  const [pauseError, setPauseError] = useState('');
  const [pauseStationData, setPauseStationData] = useState<Record<string, PauseSummaryResponse>>({});

  const [pauseDetailSelection, setPauseDetailSelection] = useState<PauseDetailSelection | null>(null);
  const [pauseDetails, setPauseDetails] = useState<PauseSummaryDetailsResponse | null>(null);
  const [pauseDetailsLoading, setPauseDetailsLoading] = useState(false);
  const [pauseDetailsError, setPauseDetailsError] = useState('');

  const effectiveDateRange = useMemo(() => {
    if (fromDate && toDate && fromDate > toDate) {
      return { from: toDate, to: fromDate };
    }
    return { from: fromDate, to: toDate };
  }, [fromDate, toDate]);

  useEffect(() => {
    setHeader({
      title: 'Metros lineales por panel',
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
        setError(err.message || 'Error cargando tipos de vivienda');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<Station[]>('/api/stations')
      .then((data) => {
        if (!active) return;
        setStations(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!active) return;
        setStations([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const stationNameById = useMemo(() => {
    const map = new Map<string, string>();
    stations.forEach((station) => {
      if (station?.id == null) return;
      map.set(String(station.id), station.name || `Estacion ${station.id}`);
    });
    return map;
  }, [stations]);

  const stationOrderById = useMemo(() => {
    const map = new Map<string, number>();
    stations.forEach((station) => {
      if (station?.id == null) return;
      const order = station.sequence_order ?? 1_000_000;
      map.set(String(station.id), order);
    });
    return map;
  }, [stations]);

  const stationFallbackNames = useMemo(() => {
    const fallback = new Map<string, string>();
    (tableData?.rows ?? []).forEach((row) => {
      if (!row?.stations) return;
      Object.entries(row.stations).forEach(([stationId, data]) => {
        if (fallback.has(stationId)) return;
        if (typeof data?.station_name === 'string' && data.station_name.trim()) {
          fallback.set(stationId, data.station_name.trim());
        }
      });
    });
    return fallback;
  }, [tableData?.rows]);

  const stationHeaderName = (stationId: string) => {
    return (
      stationNameById.get(stationId) ||
      stationFallbackNames.get(stationId) ||
      `Estacion ${stationId}`
    );
  };

  const panelStations = useMemo(() => {
    const filtered = stations.filter((station) => station.role === 'Panels');
    const sorted = [...filtered].sort((a, b) => {
      const orderA = stationOrderById.get(String(a.id)) ?? 1_000_000;
      const orderB = stationOrderById.get(String(b.id)) ?? 1_000_000;
      if (orderA !== orderB) return orderA - orderB;
      return (a.id ?? 0) - (b.id ?? 0);
    });
    return sorted;
  }, [stations, stationOrderById]);

  const fetchTableData = async () => {
    setLoading(true);
    setError('');
    try {
      const parsedMin = parseMultiplierInput(minMultiplier, DEFAULT_MIN_MULTIPLIER);
      const parsedMax = parseMultiplierInput(maxMultiplier, DEFAULT_MAX_MULTIPLIER);
      const effectiveMin = Math.min(parsedMin, parsedMax);
      const effectiveMax = Math.max(parsedMin, parsedMax);

      const params = new URLSearchParams();
      params.set('min_multiplier', String(effectiveMin));
      params.set('max_multiplier', String(effectiveMax));
      if (selectedHouseTypeId) params.set('house_type_id', selectedHouseTypeId);
      if (effectiveDateRange.from) params.set('from_date', effectiveDateRange.from);
      if (effectiveDateRange.to) params.set('to_date', effectiveDateRange.to);

      const result = await apiRequest<PanelLinearMetersResponse>(
        `/api/panel-linear-meters?${params.toString()}`
      );
      setTableData(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error cargando datos';
      setError(errorMessage);
      setTableData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTableData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHouseTypeId, effectiveDateRange.from, effectiveDateRange.to, minMultiplier, maxMultiplier]);

  const fetchPauseData = async () => {
    setPauseLoading(true);
    setPauseError('');
    setPauseDetailSelection(null);
    setPauseDetails(null);
    setPauseDetailsError('');
    setPauseDetailsLoading(false);
    try {
      const params = new URLSearchParams();
      if (effectiveDateRange.from) params.set('from_date', effectiveDateRange.from);
      if (effectiveDateRange.to) params.set('to_date', effectiveDateRange.to);
      if (selectedHouseTypeId) params.set('house_type_id', selectedHouseTypeId);

      const result = await apiRequest<PauseSummaryResponse>(
        `/api/pause-summary?${params.toString()}`
      );
      setPauseData(result);

      if (panelStations.length === 0) {
        setPauseStationData({});
        return;
      }

      const stationRequests = panelStations.map((station) => {
        const stationParams = new URLSearchParams(params);
        stationParams.set('station_id', String(station.id));
        return apiRequest<PauseSummaryResponse>(`/api/pause-summary?${stationParams.toString()}`);
      });

      const stationResults = await Promise.allSettled(stationRequests);
      const nextStationData: Record<string, PauseSummaryResponse> = {};
      let failedStations = 0;
      stationResults.forEach((stationResult, index) => {
        const station = panelStations[index];
        if (!station?.id) return;
        if (stationResult.status === 'fulfilled') {
          nextStationData[String(station.id)] = stationResult.value;
        } else {
          failedStations += 1;
        }
      });
      setPauseStationData(nextStationData);
      if (failedStations > 0) {
        setPauseError('No se pudo cargar el detalle de pausas por estacion.');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error cargando resumen de pausas';
      setPauseError(errorMessage);
      setPauseData(null);
      setPauseStationData({});
    } finally {
      setPauseLoading(false);
    }
  };

  useEffect(() => {
    fetchPauseData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveDateRange.from, effectiveDateRange.to, selectedHouseTypeId, panelStations]);

  const openPauseDetails = async (reason: string, station?: Station) => {
    setPauseDetailSelection({
      reason,
      stationName: station ? stationHeaderName(String(station.id)) : 'Todas las estaciones',
    });
    setPauseDetails(null);
    setPauseDetailsError('');
    setPauseDetailsLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('reason', reason);
      if (effectiveDateRange.from) params.set('from_date', effectiveDateRange.from);
      if (effectiveDateRange.to) params.set('to_date', effectiveDateRange.to);
      if (selectedHouseTypeId) params.set('house_type_id', selectedHouseTypeId);
      if (station) params.set('station_id', String(station.id));
      const result = await apiRequest<PauseSummaryDetailsResponse>(
        `/api/pause-summary/details?${params.toString()}`
      );
      setPauseDetails(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error cargando el detalle de pausas';
      setPauseDetailsError(message);
    } finally {
      setPauseDetailsLoading(false);
    }
  };

  const closePauseDetails = () => {
    setPauseDetailSelection(null);
    setPauseDetails(null);
    setPauseDetailsError('');
    setPauseDetailsLoading(false);
  };

  const allRows = useMemo(() => {
    if (!tableData?.rows) return [];
    return tableData.rows;
  }, [tableData]);

  useEffect(() => {
    if (!tableData?.rows) {
      setExcludedRowIds(new Set());
      return;
    }

    const currentRowIds = new Set(tableData.rows.map((row) => row.panel_definition_id));
    setExcludedRowIds((previous) => {
      const next = new Set<number>();
      previous.forEach((rowId) => {
        if (currentRowIds.has(rowId)) next.add(rowId);
      });
      return next.size === previous.size ? previous : next;
    });
  }, [tableData?.rows]);

  const processedRows = useMemo(() => {
    if (!allRows.length) return [];
    return allRows.filter((row) => !excludedRowIds.has(row.panel_definition_id));
  }, [allRows, excludedRowIds]);

  const toggleRowIncluded = (panelDefinitionId: number) => {
    setExcludedRowIds((previous) => {
      const next = new Set(previous);
      if (next.has(panelDefinitionId)) {
        next.delete(panelDefinitionId);
      } else {
        next.add(panelDefinitionId);
      }
      return next;
    });
  };

  const stationsWithData = useMemo(() => {
    const stationIds = new Set<string>();
    allRows.forEach((row) => {
      if (!row?.stations) return;
      Object.entries(row.stations).forEach(([stationId, data]) => {
        if (data?.avg_time_minutes != null && Number(data.avg_time_minutes) > 0) {
          stationIds.add(stationId);
        }
      });
    });
    const sorted = Array.from(stationIds);
    sorted.sort((a, b) => {
      const orderA = stationOrderById.get(a) ?? 1_000_000;
      const orderB = stationOrderById.get(b) ?? 1_000_000;
      if (orderA !== orderB) return orderA - orderB;
      return Number(a) - Number(b);
    });
    return sorted;
  }, [allRows, stationOrderById]);

  const averagesByStation = useMemo(() => {
    const averages: Record<string, { avg_time_minutes: number | null; lm_per_minute: number | null }> = {};
    if (!processedRows.length) return averages;

    const averageOf = (values: number[]) => {
      const valid = values.filter((value) => Number.isFinite(value) && value > 0);
      if (!valid.length) return null;
      const total = valid.reduce((sum, value) => sum + value, 0);
      return total / valid.length;
    };

    stationsWithData.forEach((stationId) => {
      const avgTimes = processedRows.map((row) => Number(row.stations?.[stationId]?.avg_time_minutes));
      const lmPerMinute = processedRows.map((row) => Number(row.stations?.[stationId]?.lm_per_minute));
      averages[stationId] = {
        avg_time_minutes: averageOf(avgTimes),
        lm_per_minute: averageOf(lmPerMinute),
      };
    });

    return averages;
  }, [processedRows, stationsWithData]);

  const pauseStationsWithData = useMemo(() => {
    if (!panelStations.length) return [];
    return panelStations.filter((station) => {
      const stationData = pauseStationData[String(station.id)];
      if (!stationData) return false;
      const totalMinutes = Number(stationData.total_pause_minutes);
      if (Number.isFinite(totalMinutes) && totalMinutes > 0) return true;
      return Array.isArray(stationData.pause_reasons) && stationData.pause_reasons.length > 0;
    });
  }, [panelStations, pauseStationData]);

  const pauseReasonsByStation = useMemo(() => {
    const mapped: Record<string, Record<string, PauseSummaryReason>> = {};
    pauseStationsWithData.forEach((station) => {
      const stationId = String(station.id);
      const stationReasons = pauseStationData[stationId]?.pause_reasons ?? [];
      const reasonMap: Record<string, PauseSummaryReason> = {};
      stationReasons.forEach((reason) => {
        reasonMap[reason.reason] = reason;
      });
      mapped[stationId] = reasonMap;
    });
    return mapped;
  }, [pauseStationsWithData, pauseStationData]);

  const averagePanelLength = useMemo(() => {
    const values = processedRows
      .map((row) => Number(row.panel_length_m))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }, [processedRows]);

  const resetFilters = () => {
    setSelectedHouseTypeId('');
    setFromDate(weekStartStr());
    setToDate(todayStr());
    setMinMultiplier(String(DEFAULT_MIN_MULTIPLIER));
    setMaxMultiplier(String(DEFAULT_MAX_MULTIPLIER));
  };

  const handleExport = () => {
    setExportError('');
    setExporting(true);
    try {
      const headers = [
        'Tipo Vivienda',
        'Modulo',
        'ML (m)',
        'Panel',
        ...stationsWithData.flatMap((stationId) => ([
          `${stationHeaderName(stationId)} Prom. (min)`,
          `${stationHeaderName(stationId)} ML/min`,
        ])),
      ];

      const rows = processedRows.map((row) => ([
        row.house_type_name || '-',
        row.module_sequence_number ?? '-',
        roundNumber(Number(row.panel_length_m), 2),
        row.panel_code || '-',
        ...stationsWithData.flatMap((stationId) => {
          const stationData = row.stations?.[stationId];
          const avgTime = stationData?.avg_time_minutes;
          const lmPerMin = stationData?.lm_per_minute;
          return [
            avgTime != null ? roundNumber(Number(avgTime), 2) : '',
            roundNumber(Number(lmPerMin), 3),
          ];
        }),
      ]));

      const avgRow = [
        'Promedio por panel',
        '',
        averagePanelLength != null ? roundNumber(Number(averagePanelLength), 2) : '',
        '',
        ...stationsWithData.flatMap((stationId) => {
          const stationAvg = averagesByStation[stationId] || {};
          return [
            stationAvg.avg_time_minutes != null ? roundNumber(Number(stationAvg.avg_time_minutes), 2) : '',
            roundNumber(Number(stationAvg.lm_per_minute), 3),
          ];
        }),
      ];

      const csvRows = [headers, ...rows, avgRow];
      const csvContent = csvRows.map((row) => row.map(escapeCsv).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `panel-linear-meters-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error exportando CSV';
      setExportError(errorMessage);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-black/5 bg-white/80 shadow-sm px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Paneles</p>
            <h1 className="font-display text-xl text-[var(--ink)]">Metros lineales por panel</h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Revisa el rendimiento por estacion y el tiempo promedio necesario para fabricar paneles.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[var(--accent-soft)] bg-white/80 px-4 py-2 text-xs text-[var(--ink)]">
            <Filter className="h-4 w-4 text-[var(--accent)]" />
            {processedRows.length} de {allRows.length} filas activas
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Filtros</p>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Rango y multiplicadores</h2>
          </div>
          <button
            type="button"
            onClick={fetchTableData}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-black"
            disabled={loading}
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? 'Cargando...' : 'Actualizar'}
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <label className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Tipo de vivienda
            <select
              className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
              value={selectedHouseTypeId}
              onChange={(event) => setSelectedHouseTypeId(event.target.value)}
            >
              <option value="">Todos</option>
              {houseTypes.map((houseType) => (
                <option key={houseType.id} value={houseType.id}>
                  {houseType.name || `Tipo ${houseType.id}`}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Desde
            <input
              className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </label>

          <label className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Hasta
            <input
              className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
          </label>

          <label className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Min. multiplicador
            <input
              className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
              type="number"
              step="0.1"
              min="0"
              value={minMultiplier}
              onChange={(event) => setMinMultiplier(event.target.value)}
            />
          </label>

          <label className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Max. multiplicador
            <input
              className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
              type="number"
              step="0.1"
              min="0"
              value={maxMultiplier}
              onChange={(event) => setMaxMultiplier(event.target.value)}
            />
          </label>

          <div className="flex flex-col justify-end gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]"
              onClick={resetFilters}
            >
              Restablecer
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)]"
              onClick={handleExport}
              disabled={loading || exporting || processedRows.length === 0}
            >
              <Download className="h-4 w-4" />
              {exporting ? 'Exportando...' : 'Exportar CSV'}
            </button>
          </div>
        </div>

        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {!error && exportError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {exportError}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Resumen</p>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Paneles con datos</h2>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-[var(--ink-muted)]">
            <span className="rounded-full border border-black/10 bg-white px-3 py-1">
              Total paneles: {tableData?.total_panels ?? allRows.length}
            </span>
            <span className="rounded-full border border-black/10 bg-white px-3 py-1">
              Incluidos: {processedRows.length}
            </span>
            <span className="rounded-full border border-black/10 bg-white px-3 py-1">
              ML promedio: {averagePanelLength != null ? formatPanelLengthMeters(averagePanelLength) : '-'}
            </span>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto border rounded-xl border-black/5 bg-white/50">
          {loading && <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">Cargando datos...</div>}

          {!loading && allRows.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
              No hay datos disponibles para el periodo seleccionado.
            </div>
          )}

          {!loading && allRows.length > 0 && (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)] border-b border-black/10 bg-black/[0.02]">
                  <th className="px-2 py-3">
                    <span className="inline-flex items-center gap-2">
                      <Eye className="h-3.5 w-3.5" />
                      Tipo vivienda
                    </span>
                  </th>
                  <th className="px-2 py-3 text-center">Modulo</th>
                  <th className="px-2 py-3 text-center">ML</th>
                  <th className="px-2 py-3">Panel</th>
                  {stationsWithData.map((stationId) => (
                    <React.Fragment key={stationId}>
                      <th className="px-2 py-3 text-center border-l border-black/5 whitespace-nowrap" title={stationId}>
                        {stationHeaderName(stationId)}<br/><span className="text-[9px] font-normal opacity-60">prom.</span>
                      </th>
                      <th className="px-2 py-3 text-center border-l border-black/5 whitespace-nowrap" title={stationId}>
                        {stationHeaderName(stationId)}<br/><span className="text-[9px] font-normal opacity-60">ML/min</span>
                      </th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allRows.map((row) => {
                  const isIncluded = !excludedRowIds.has(row.panel_definition_id);

                  return (
                    <tr
                      key={row.panel_definition_id}
                      className={`border-b border-black/5 transition-colors ${
                        isIncluded ? 'hover:bg-black/[0.02]' : 'bg-black/[0.035] text-[var(--ink-muted)]'
                      }`}
                    >
                      <td className="px-2 py-1.5 font-medium text-[var(--ink)]">
                        <div className="flex min-w-[180px] items-center gap-2">
                          <button
                            type="button"
                            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition ${
                              isIncluded
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'border-black/10 bg-white text-[var(--ink-muted)] hover:bg-black/[0.04]'
                            }`}
                            onClick={() => toggleRowIncluded(row.panel_definition_id)}
                            aria-label={
                              isIncluded
                                ? `Excluir ${row.house_type_name || row.panel_code || 'panel'} de los calculos`
                                : `Incluir ${row.house_type_name || row.panel_code || 'panel'} en los calculos`
                            }
                            aria-pressed={isIncluded}
                            title={isIncluded ? 'Incluido en calculos' : 'Excluido de calculos'}
                          >
                            {isIncluded ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          </button>
                          <span className={isIncluded ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)] line-through decoration-black/30'}>
                            {row.house_type_name || '-'}
                          </span>
                        </div>
                      </td>
                      <td className={`px-2 py-1.5 text-center tabular-nums ${isIncluded ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]'}`}>{row.module_sequence_number ?? '-'}</td>
                      <td className={`px-2 py-1.5 text-center tabular-nums ${isIncluded ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]'}`}>
                        {formatPanelLengthMeters(row.panel_length_m ?? null)}
                      </td>
                      <td className={`px-2 py-1.5 ${isIncluded ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]'}`}>{row.panel_code || '-'}</td>
                      {stationsWithData.map((stationId) => {
                        const stationData = row.stations?.[stationId];
                        const avgTime = stationData?.avg_time_minutes;
                        const avgRatio = stationData?.avg_ratio;
                        const expectedAvg = stationData?.expected_avg_minutes;
                        const lmPerMin = stationData?.lm_per_minute;
                        const sampleCount = stationData?.sample_count || 0;
                        const tooltipLines = [] as string[];
                        if (sampleCount > 0) tooltipLines.push(`Muestras: ${sampleCount}`);
                        if (expectedAvg != null) tooltipLines.push(`Esperado prom.: ${formatMinutesWithUnit(expectedAvg)}`);
                        if (avgRatio != null) tooltipLines.push(`Ratio prom.: ${avgRatio.toFixed(2)}x`);
                        const tooltip = tooltipLines.length ? tooltipLines.join(' | ') : 'Sin datos';
                        const avgTimeBg = ratioToBackgroundColor(avgRatio ?? null);

                        return (
                          <React.Fragment key={stationId}>
                            <td
                              className="px-2 py-1.5 text-center tabular-nums border-l border-black/[0.03]"
                              style={{
                                backgroundColor: isIncluded ? avgTimeBg || undefined : undefined,
                                color: isIncluded && avgTime != null ? 'var(--ink)' : 'var(--ink-muted)',
                              }}
                              title={tooltip}
                            >
                              {avgTime != null ? formatMinutesWithUnit(avgTime) : '-'}
                            </td>
                            <td
                              className="px-2 py-1.5 text-center tabular-nums border-l border-black/[0.03]"
                              style={{
                                color: isIncluded && lmPerMin != null && Number.isFinite(Number(lmPerMin)) && Number(lmPerMin) > 0
                                  ? 'var(--ink)'
                                  : 'var(--ink-muted)',
                              }}
                              title={tooltip}
                            >
                              {formatLmPerMinute(lmPerMin ?? null)}
                            </td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  );
                })}

                <tr className="bg-black/[0.03] font-semibold">
                  <td className="px-2 py-2 text-[var(--ink)]">
                    Promedio por panel
                  </td>
                  <td className="px-2 py-2 text-center text-[var(--ink)]">-</td>
                  <td className="px-2 py-2 text-center text-[var(--ink)] tabular-nums">
                    {averagePanelLength != null ? formatPanelLengthMeters(averagePanelLength) : '-'}
                  </td>
                  <td className="px-2 py-2 text-[var(--ink)]">-</td>
                  {stationsWithData.map((stationId) => {
                    const stationAvg = averagesByStation[stationId] || {};
                    return (
                      <React.Fragment key={stationId}>
                        <td className="px-2 py-2 text-center text-[var(--ink)] tabular-nums border-l border-black/10">
                          {stationAvg.avg_time_minutes != null
                            ? formatMinutesWithUnit(stationAvg.avg_time_minutes)
                            : '-'}
                        </td>
                        <td className="px-2 py-2 text-center text-[var(--ink)] tabular-nums border-l border-black/10">
                          {formatLmPerMinute(stationAvg.lm_per_minute ?? null)}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Pausas</p>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Resumen de pausas</h2>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)]"
            onClick={fetchPauseData}
            disabled={pauseLoading}
          >
            <RefreshCcw className="h-4 w-4" />
            {pauseLoading ? 'Cargando...' : 'Actualizar'}
          </button>
        </div>

        <div className="mt-3 text-xs text-[var(--ink-muted)]">
          Rango: {effectiveDateRange.from || '-'} al {effectiveDateRange.to || '-'}
        </div>

        {pauseError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {pauseError}
          </div>
        )}

        {pauseLoading && (
          <div className="mt-4 text-sm text-[var(--ink-muted)]">Cargando resumen de pausas...</div>
        )}

        {!pauseLoading && pauseData && (
          <div className="mt-4 space-y-3">
            <div className="text-sm text-[var(--ink-muted)]">
              Periodo: {pauseData.from_date || '-'} al {pauseData.to_date || '-'} | Total pausas:{' '}
              {formatDuration(pauseData.total_pause_minutes ?? null)}
            </div>
            <div className="text-xs text-[var(--ink-muted)]">
              Haz clic en un motivo o una cifra para ver las tareas que componen ese total.
            </div>
            <div className="overflow-x-auto border rounded-xl border-black/5 bg-white/50">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)] border-b border-black/10 bg-black/[0.02]">
                    <th className="px-3 py-2">Motivo de pausa</th>
                    <th className="px-3 py-2">Tiempo total</th>
                    <th className="px-3 py-2 text-center">Ocurrencias</th>
                    {pauseStationsWithData.map((station) => (
                      <React.Fragment key={station.id}>
                        <th
                          className="px-3 py-2 text-center border-l border-black/5 whitespace-nowrap"
                          title={String(station.id)}
                        >
                          {stationHeaderName(String(station.id))}<br />
                          <span className="text-[9px] font-normal opacity-60">tiempo</span>
                        </th>
                        <th
                          className="px-3 py-2 text-center border-l border-black/5 whitespace-nowrap"
                          title={String(station.id)}
                        >
                          {stationHeaderName(String(station.id))}<br />
                          <span className="text-[9px] font-normal opacity-60">pausas</span>
                        </th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(!pauseData.pause_reasons || pauseData.pause_reasons.length === 0) && (
                    <tr>
                      <td
                        className="px-4 py-8 text-center text-[var(--ink-muted)]"
                        colSpan={3 + pauseStationsWithData.length * 2}
                      >
                        No hay pausas registradas en este periodo.
                      </td>
                    </tr>
                  )}
                  {pauseData.pause_reasons?.map((pause, idx) => (
                    <tr key={`${pause.reason}-${idx}`} className="border-b border-black/5 hover:bg-black/[0.02] transition-colors">
                      <td className="p-0 text-[var(--ink)]">
                        <button
                          type="button"
                          className="w-full px-3 py-1.5 text-left transition hover:bg-[var(--accent)]/10 hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                          onClick={() => void openPauseDetails(pause.reason)}
                          title="Ver tareas que componen esta pausa"
                        >
                          {pause.reason}
                        </button>
                      </td>
                      <td className="p-0 text-[var(--ink)] tabular-nums">
                        <button
                          type="button"
                          className="w-full px-3 py-1.5 text-left transition hover:bg-[var(--accent)]/10 hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                          onClick={() => void openPauseDetails(pause.reason)}
                          title="Ver tareas que componen este tiempo"
                        >
                          {formatDuration(pause.total_duration_minutes)}
                        </button>
                      </td>
                      <td className="p-0 text-center text-[var(--ink)] tabular-nums">
                        <button
                          type="button"
                          className="w-full px-3 py-1.5 text-center transition hover:bg-[var(--accent)]/10 hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                          onClick={() => void openPauseDetails(pause.reason)}
                          title="Ver las ocurrencias de esta pausa"
                        >
                          {pause.occurrence_count}
                        </button>
                      </td>
                      {pauseStationsWithData.map((station) => {
                        const stationId = String(station.id);
                        const stationReason = pauseReasonsByStation[stationId]?.[pause.reason];
                        return (
                          <React.Fragment key={stationId}>
                            <td className="p-0 text-center text-[var(--ink)] tabular-nums border-l border-black/[0.03]">
                              {stationReason ? (
                                <button
                                  type="button"
                                  className="w-full px-3 py-1.5 text-center transition hover:bg-[var(--accent)]/10 hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                                  onClick={() => void openPauseDetails(pause.reason, station)}
                                  title={`Ver tareas en ${stationHeaderName(stationId)}`}
                                >
                                  {formatDuration(stationReason.total_duration_minutes)}
                                </button>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="p-0 text-center text-[var(--ink)] tabular-nums border-l border-black/[0.03]">
                              {stationReason ? (
                                <button
                                  type="button"
                                  className="w-full px-3 py-1.5 text-center transition hover:bg-[var(--accent)]/10 hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                                  onClick={() => void openPauseDetails(pause.reason, station)}
                                  title={`Ver ocurrencias en ${stationHeaderName(stationId)}`}
                                >
                                  {stationReason.occurrence_count}
                                </button>
                              ) : (
                                '-'
                              )}
                            </td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!pauseLoading && !pauseData && !pauseError && (
          <div className="mt-4 text-sm text-[var(--ink-muted)]">
            Seleccione un periodo para ver el resumen de pausas.
          </div>
        )}
      </div>

      {pauseDetailSelection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-detail-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePauseDetails();
          }}
        >
          <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-black/10 px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                  Detalle de pausas
                </p>
                <h2 id="pause-detail-title" className="mt-1 text-xl font-semibold text-[var(--ink)]">
                  {pauseDetailSelection.reason}
                </h2>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  {pauseDetailSelection.stationName} · {effectiveDateRange.from || '-'} al{' '}
                  {effectiveDateRange.to || '-'}
                </p>
              </div>
              <button
                type="button"
                onClick={closePauseDetails}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-[var(--ink-muted)] transition hover:border-black/20 hover:text-[var(--ink)]"
                aria-label="Cerrar detalle de pausas"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-5">
              {pauseDetailsLoading && (
                <div className="rounded-xl border border-black/5 bg-black/[0.02] px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                  Cargando tareas que componen la pausa...
                </div>
              )}

              {pauseDetailsError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {pauseDetailsError}
                </div>
              )}

              {!pauseDetailsLoading && pauseDetails && (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-sm">
                    <span className="rounded-full bg-black/[0.04] px-3 py-1 text-[var(--ink)]">
                      Tiempo: <strong>{formatDuration(pauseDetails.total_pause_minutes)}</strong>
                    </span>
                    <span className="rounded-full bg-black/[0.04] px-3 py-1 text-[var(--ink)]">
                      Ocurrencias: <strong>{pauseDetails.occurrence_count}</strong>
                    </span>
                  </div>

                  {pauseDetails.contributions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-black/10 px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                      No se encontraron tareas para esta celda con los filtros actuales.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-black/10">
                      <table className="w-full min-w-[980px] border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-black/10 bg-black/[0.02] text-left text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                            <th className="px-3 py-2">Tarea</th>
                            <th className="px-3 py-2">Proyecto / casa</th>
                            <th className="px-3 py-2">Módulo / panel</th>
                            <th className="px-3 py-2">Estación</th>
                            <th className="px-3 py-2">Inicio</th>
                            <th className="px-3 py-2">Fin</th>
                            <th className="px-3 py-2 text-right">Duración</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pauseDetails.contributions.map((contribution) => (
                            <tr
                              key={contribution.pause_id}
                              className="border-b border-black/5 last:border-b-0 hover:bg-black/[0.02]"
                            >
                              <td className="px-3 py-2 text-[var(--ink)]">
                                <div className="font-medium">{contribution.task_name}</div>
                                <div className="text-[11px] text-[var(--ink-muted)]">
                                  Tarea #{contribution.task_instance_id}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-[var(--ink)]">
                                <div>{contribution.project_name || '-'}</div>
                                {contribution.house_identifier && (
                                  <div className="text-[11px] text-[var(--ink-muted)]">
                                    {contribution.house_identifier}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-[var(--ink)]">
                                M{contribution.module_number ?? '-'} · {contribution.panel_code || '-'}
                              </td>
                              <td className="px-3 py-2 text-[var(--ink)]">{contribution.station_name}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-[var(--ink)]">
                                {formatDateTime(contribution.paused_at)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-[var(--ink)]">
                                {formatDateTime(contribution.resumed_at)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-[var(--ink)]">
                                {formatDuration(contribution.duration_minutes)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPanels;
