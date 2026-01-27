import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Clock,
  Database,
  RefreshCcw,
  Timer,
  Users,
} from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';
import { formatMinutesShort } from '../../../utils/timeUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

const SHIFT_START_HOUR = 8;
const SHIFT_START_MINUTE = 20;

const DATE_STORAGE_KEY = 'dashboard.shiftEstimation.date';

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
  const today = todayStr();
  if (value >= today) return yesterdayStr();
  return value;
};

const getStoredDate = () => {
  if (typeof window === 'undefined') return yesterdayStr();
  const stored = window.localStorage.getItem(DATE_STORAGE_KEY);
  return clampDateToYesterday(stored || yesterdayStr());
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

type Station = {
  id: number;
  name: string;
  line_type?: string | null;
  sequence_order?: number | null;
  role: string;
};

type ShiftEstimate = {
  date: string;
  group_key: string;
  station_role: string;
  station_id?: number | null;
  sequence_order?: number | null;
  assigned_count: number;
  present_count: number;
  estimated_start?: string | null;
  estimated_end?: string | null;
  last_exit?: string | null;
  shift_minutes?: number | null;
  status: 'no-shift' | 'open' | 'review' | 'estimated';
  computed_at: string;
  algorithm_version: number;
};

type ShiftEstimateDay = {
  date: string;
  status: 'complete' | 'partial' | 'missing' | 'excluded';
  expected_count: number;
  cached_count: number;
  estimates: ShiftEstimate[];
};

type CoverageDay = {
  date: string;
  status: 'complete' | 'partial' | 'missing' | 'excluded';
  expected_count: number;
  cached_count: number;
};

type ComputeResponse = {
  from_date: string;
  to_date: string;
  processed_days: number;
  computed_count: number;
  skipped_existing: number;
  excluded_days: number;
  worker_errors: number;
};

const formatDateLabel = (value: string) => {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
};

const parseDateTime = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const formatTime = (value?: string | null) => {
  if (!value) return '-';
  const date = parseDateTime(value);
  if (!date) return '-';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatShiftMinutes = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '-';
  return formatMinutesShort(value);
};

const buildShiftStartLabel = () => `${pad(SHIFT_START_HOUR)}:${pad(SHIFT_START_MINUTE)} AM`;

const groupKeyForStation = (station: Station) => {
  if (station.role === 'Assembly' && station.sequence_order !== null && station.sequence_order !== undefined) {
    return `assembly:${station.sequence_order}`;
  }
  return `station:${station.id}`;
};

const groupLabelForStation = (station: Station) => {
  if (station.role === 'Assembly' && station.sequence_order !== null && station.sequence_order !== undefined) {
    return `Secuencia ${station.sequence_order} (compartido)`;
  }
  return 'Individual';
};

const statusStyles: Record<
  ShiftEstimate['status'] | 'no-cache',
  { label: string; className: string }
> = {
  'no-shift': {
    label: 'Sin turno',
    className: 'bg-black/5 text-[var(--ink-muted)]',
  },
  open: {
    label: 'Sin salida',
    className: 'bg-[var(--accent)]/10 text-[var(--accent)]',
  },
  review: {
    label: 'Revisar',
    className: 'bg-amber-100 text-amber-700',
  },
  estimated: {
    label: 'Estimado',
    className: 'bg-[var(--leaf)]/10 text-[var(--leaf)]',
  },
  'no-cache': {
    label: 'Sin cache',
    className: 'bg-black/5 text-[var(--ink-muted)]',
  },
};

const coverageStyles: Record<CoverageDay['status'], { label: string; className: string }> = {
  complete: { label: 'Completo', className: 'bg-[var(--leaf)]' },
  partial: { label: 'Parcial', className: 'bg-amber-400' },
  missing: { label: 'Sin cache', className: 'bg-black/10' },
  excluded: { label: 'Excluido', className: 'bg-black/5' },
};

const DashboardShiftEstimation: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const autoComputeRef = useRef<string | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedDate, setSelectedDate] = useState(getStoredDate);
  const [daySummary, setDaySummary] = useState<ShiftEstimateDay | null>(null);
  const [coverageDays, setCoverageDays] = useState<CoverageDay[]>([]);
  const [rangeStart, setRangeStart] = useState(isoDaysAgo(30));
  const [rangeEnd, setRangeEnd] = useState(yesterdayStr());
  const [loadingBase, setLoadingBase] = useState(false);
  const [loadingDay, setLoadingDay] = useState(false);
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [loadingCompute, setLoadingCompute] = useState(false);
  const [error, setError] = useState('');
  const [coverageError, setCoverageError] = useState('');
  const [computeMessage, setComputeMessage] = useState('');

  useEffect(() => {
    setHeader({
      title: 'Estimacion de turnos por estacion',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  useEffect(() => {
    autoComputeRef.current = null;
  }, [selectedDate]);

  useEffect(() => {
    let active = true;
    setLoadingBase(true);
    setError('');
    apiRequest<Station[]>('/api/stations')
      .then((stationData) => {
        if (!active) return;
        setStations(Array.isArray(stationData) ? stationData : []);
      })
      .catch((err) => {
        if (!active) return;
        setStations([]);
        setError(err instanceof Error ? err.message : 'Error cargando estaciones.');
      })
      .finally(() => {
        if (!active) return;
        setLoadingBase(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DATE_STORAGE_KEY, selectedDate);
  }, [selectedDate]);

  const stationsSorted = useMemo(
    () =>
      [...stations].sort((a, b) => {
        const orderA = a.sequence_order ?? 1_000_000;
        const orderB = b.sequence_order ?? 1_000_000;
        if (orderA !== orderB) return orderA - orderB;
        return (a.name || '').localeCompare(b.name || '');
      }),
    [stations]
  );

  const loadCoverage = useCallback(async () => {
    if (!rangeStart || !rangeEnd) return;
    setLoadingCoverage(true);
    setCoverageError('');
    try {
      const coverage = await apiRequest<CoverageDay[]>(
        `/api/shift-estimates/coverage?from_date=${rangeStart}&to_date=${rangeEnd}`
      );
      setCoverageDays(Array.isArray(coverage) ? coverage : []);
    } catch (err) {
      setCoverageDays([]);
      setCoverageError(
        err instanceof Error ? err.message : 'Error cargando la cobertura de cache.'
      );
    } finally {
      setLoadingCoverage(false);
    }
  }, [rangeEnd, rangeStart]);

  const computeRange = useCallback(
    async (fromDate: string, toDate: string, silent = false) => {
      if (!fromDate || !toDate) return null;
      setLoadingCompute(true);
      if (!silent) setComputeMessage('');
      try {
        const response = await apiRequest<ComputeResponse>('/api/shift-estimates/compute', {
          method: 'POST',
          body: JSON.stringify({ from_date: fromDate, to_date: toDate }),
        });
        if (!silent) {
          setComputeMessage(
            `Cache actualizado: +${response.computed_count} registros (${response.processed_days} dias).`
          );
        }
        return response;
      } catch (err) {
        if (!silent) {
          setComputeMessage(
            err instanceof Error ? err.message : 'No se pudo calcular el rango solicitado.'
          );
        }
        return null;
      } finally {
        setLoadingCompute(false);
      }
    },
    []
  );

  const loadDay = useCallback(async () => {
    if (!selectedDate) return;
    setLoadingDay(true);
    setError('');
    try {
      const day = await apiRequest<ShiftEstimateDay>(
        `/api/shift-estimates?date=${selectedDate}`
      );
      setDaySummary(day);
      if (
        (day.status === 'missing' || day.status === 'partial') &&
        autoComputeRef.current !== selectedDate
      ) {
        autoComputeRef.current = selectedDate;
        const computed = await computeRange(selectedDate, selectedDate, true);
        if (computed && computed.computed_count > 0) {
          const refreshed = await apiRequest<ShiftEstimateDay>(
            `/api/shift-estimates?date=${selectedDate}`
          );
          setDaySummary(refreshed);
          await loadCoverage();
        }
      }
    } catch (err) {
      setDaySummary(null);
      setError(err instanceof Error ? err.message : 'Error cargando el cache del dia.');
    } finally {
      setLoadingDay(false);
    }
  }, [computeRange, loadCoverage, selectedDate]);

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  useEffect(() => {
    loadCoverage();
  }, [loadCoverage]);

  const estimatesByGroupKey = useMemo(() => {
    const map = new Map<string, ShiftEstimate>();
    (daySummary?.estimates ?? []).forEach((estimate) => {
      map.set(estimate.group_key, estimate);
    });
    return map;
  }, [daySummary]);

  const groupSummaries = useMemo(() => {
    const map = new Map<
      string,
      { station: Station; stations: Station[]; estimate: ShiftEstimate | null }
    >();
    stationsSorted.forEach((station) => {
      const groupKey = groupKeyForStation(station);
      const estimate = estimatesByGroupKey.get(groupKey) ?? null;
      const existing = map.get(groupKey);
      if (existing) {
        existing.stations.push(station);
        return;
      }
      map.set(groupKey, { station, stations: [station], estimate });
    });
    return Array.from(map.values());
  }, [stationsSorted, estimatesByGroupKey]);

  const stats = useMemo(() => {
    const totalStations = groupSummaries.length;
    const stationsWithShift = groupSummaries.filter(
      (summary) => summary.estimate && summary.estimate.status !== 'no-shift'
    ).length;
    const stationsNoShift = groupSummaries.filter(
      (summary) => summary.estimate && summary.estimate.status === 'no-shift'
    ).length;
    const stationsOpen = groupSummaries.filter(
      (summary) => summary.estimate && summary.estimate.status === 'open'
    ).length;
    const latestExit = groupSummaries.reduce<Date | null>((latest, summary) => {
      if (!summary.estimate?.last_exit) return latest;
      const exitDate = parseDateTime(summary.estimate.last_exit);
      if (!exitDate) return latest;
      if (!latest || exitDate > latest) return exitDate;
      return latest;
    }, null);

    return {
      totalStations,
      stationsWithShift,
      stationsNoShift,
      stationsOpen,
      latestExit,
    };
  }, [groupSummaries]);

  const coverageLabel = daySummary
    ? `${daySummary.cached_count}/${daySummary.expected_count}`
    : '-';
  const coveragePercent = daySummary
    ? Math.round((daySummary.cached_count / Math.max(daySummary.expected_count, 1)) * 100)
    : 0;
  const shiftStartLabel = buildShiftStartLabel();
  const dateMax = yesterdayStr();
  const dayStatusLabel = daySummary ? coverageStyles[daySummary.status].label : '...';

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-black/5 bg-white/80 px-6 py-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
              Dashboards
            </p>
            <h1 className="font-display text-2xl text-[var(--ink)]">
              Estimacion de turnos por estacion
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
              Inferimos el horario de cada estacion usando los marcajes de su dotacion asignada.
              Si hay al menos un trabajador con marcaje, el inicio se fija a las {shiftStartLabel}{' '}
              y el cierre se estima con la ultima salida menos 30 minutos.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs text-[var(--ink-muted)]">
              <Calendar className="h-4 w-4 text-[var(--accent)]" />
              <span>{formatDateLabel(selectedDate)}</span>
            </div>
            <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--ink-muted)]">
              Fecha
              <input
                type="date"
                value={selectedDate}
                max={dateMax}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--ink)]"
              />
            </label>
            <button
              type="button"
              onClick={loadDay}
              disabled={loadingBase || loadingDay}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)] transition hover:border-black/20 disabled:opacity-60"
            >
              <RefreshCcw className={`h-4 w-4 ${loadingDay ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <Timer className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Turnos estimados
                </p>
                <p className="text-lg font-semibold text-[var(--ink)]">
                  {stats.stationsWithShift}/{stats.totalStations}
                </p>
                <p className="text-xs text-[var(--ink-muted)]">
                  {stats.stationsOpen} estaciones sin salida
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/5 text-[var(--ink)]">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Sin marcajes
                </p>
                <p className="text-lg font-semibold text-[var(--ink)]">{stats.stationsNoShift}</p>
                <p className="text-xs text-[var(--ink-muted)]">Estaciones sin turno</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Cobertura cache
                </p>
                <p className="text-lg font-semibold text-[var(--ink)]">{coverageLabel}</p>
                <p className="text-xs text-[var(--ink-muted)]">{coveragePercent}% cargado</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/5 text-[var(--ink)]">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Ultima salida
                </p>
                <p className="text-lg font-semibold text-[var(--ink)]">
                  {stats.latestExit ? stats.latestExit.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                </p>
                <p className="text-xs text-[var(--ink-muted)]">Salida global detectada</p>
              </div>
            </div>
          </div>
        </div>

        {loadingBase || loadingDay ? (
          <div className="mt-4 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Actualizando cache...
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-2xl border border-black/5 bg-white/80 px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Cache</p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">
              Cobertura y calculo de rangos
            </h2>
          </div>
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Rango activo: {formatDateLabel(rangeStart)} → {formatDateLabel(rangeEnd)}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--ink-muted)]">
              Desde
              <input
                type="date"
                value={rangeStart}
                max={dateMax}
                onChange={(event) => setRangeStart(event.target.value)}
                className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--ink)]"
              />
            </label>
            <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--ink-muted)]">
              Hasta
              <input
                type="date"
                value={rangeEnd}
                max={dateMax}
                onChange={(event) => setRangeEnd(event.target.value)}
                className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--ink)]"
              />
            </label>
            <button
              type="button"
              onClick={async () => {
                const response = await computeRange(rangeStart, rangeEnd);
                if (response) {
                  await loadCoverage();
                  if (selectedDate >= rangeStart && selectedDate <= rangeEnd) {
                    await loadDay();
                  }
                }
              }}
              disabled={loadingCompute}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)] transition hover:border-black/20 disabled:opacity-60"
            >
              <RefreshCcw className={`h-4 w-4 ${loadingCompute ? 'animate-spin' : ''}`} />
              Calcular rango
            </button>
          </div>
          <div className="text-xs text-[var(--ink-muted)]">
            {computeMessage || 'Calcula solo dias anteriores a hoy.'}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {coverageDays.map((day) => {
            const statusMeta = coverageStyles[day.status];
            return (
              <button
                key={day.date}
                type="button"
                onClick={() => setSelectedDate(clampDateToYesterday(day.date))}
                className="group flex items-center gap-2"
                title={`${formatDateLabel(day.date)} · ${statusMeta.label} (${day.cached_count}/${day.expected_count})`}
              >
                <span
                  className={`h-2 w-6 rounded-full transition group-hover:opacity-80 ${statusMeta.className}`}
                />
              </button>
            );
          })}
          {loadingCoverage ? (
            <span className="text-xs text-[var(--ink-muted)]">Cargando...</span>
          ) : null}
          {coverageError ? (
            <span className="text-xs text-red-600">{coverageError}</span>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--ink-muted)]">
          {Object.values(coverageStyles).map((item) => (
            <span key={item.label} className="inline-flex items-center gap-2">
              <span className={`h-2 w-4 rounded-full ${item.className}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/80 px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Reglas</p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">
              Logica de estimacion del turno
            </h2>
          </div>
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Fecha activa: {formatDateLabel(selectedDate)}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-black/5 bg-white/90 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Inicio fijo</p>
            <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{shiftStartLabel}</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Solo si existe al menos un marcaje en la estacion.
            </p>
          </div>
          <div className="rounded-2xl border border-black/5 bg-white/90 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Fin estimado</p>
            <p className="mt-2 text-lg font-semibold text-[var(--ink)]">Ultima salida - 30 min</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Descontamos el tiempo entre dejar el trabajo y marcar salida.
            </p>
          </div>
          <div className="rounded-2xl border border-black/5 bg-white/90 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Sin turno</p>
            <p className="mt-2 text-lg font-semibold text-[var(--ink)]">Sin marcajes</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Ningun trabajador asignado registra entrada o salida.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/80 px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Estaciones</p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">
              Turnos estimados por estacion
            </h2>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Estaciones paralelas agrupadas por secuencia.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-black/10 bg-white px-4 py-2 text-xs text-[var(--ink)]">
            <Clock className="h-4 w-4 text-[var(--accent)]" />
            Cache del dia: {dayStatusLabel}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1000px] w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                <th className="px-3 py-2">Estacion</th>
                <th className="px-3 py-2">Dotacion</th>
                <th className="px-3 py-2">Inicio</th>
                <th className="px-3 py-2">Ultima salida</th>
                <th className="px-3 py-2">Fin estimado</th>
                <th className="px-3 py-2">Duracion</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {groupSummaries.map((summary) => {
                const estimate = summary.estimate;
                const statusMeta = statusStyles[estimate?.status ?? 'no-cache'];
                const stationIds = summary.stations.map((station) => station.id);
                const uniqueLineTypes = Array.from(
                  new Set(
                    summary.stations
                      .map((station) => station.line_type)
                      .filter((lineType): lineType is string => Boolean(lineType))
                  )
                );
                const lineTypeLabel = uniqueLineTypes.length
                  ? ` · lineas ${uniqueLineTypes.join(', ')}`
                  : '';
                return (
                  <tr
                    key={groupKeyForStation(summary.station)}
                    className="border-b border-black/5 text-[var(--ink)]"
                  >
                    <td className="px-3 py-3 align-top">
                      <div className="font-semibold text-[var(--ink)]">
                        {summary.station.name || `Estacion ${summary.station.id}`}
                      </div>
                      <div className="text-xs text-[var(--ink-muted)]">
                        {stationIds.length > 1
                          ? `IDs ${stationIds.join(', ')}`
                          : `ID ${summary.station.id}`}
                        {lineTypeLabel}
                        {summary.station.role ? ` · ${summary.station.role}` : ''}
                        {` · ${groupLabelForStation(summary.station)}`}
                        {summary.stations.length > 1
                          ? ` · ${summary.stations.length} estaciones paralelas`
                          : ''}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="font-semibold">
                        {estimate ? `${estimate.present_count}/${estimate.assigned_count}` : '--'}
                      </div>
                      <div className="text-xs text-[var(--ink-muted)]">con marcaje</div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      {estimate?.estimated_start ? formatTime(estimate.estimated_start) : 'Sin turno'}
                    </td>
                    <td className="px-3 py-3 align-top">{formatTime(estimate?.last_exit)}</td>
                    <td className="px-3 py-3 align-top">
                      {estimate?.estimated_end ? formatTime(estimate.estimated_end) : '-'}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {estimate?.estimated_end ? formatShiftMinutes(estimate.shift_minutes) : '-'}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${statusMeta.className}`}
                      >
                        {statusMeta.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {groupSummaries.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-sm text-[var(--ink-muted)]"
                  >
                    No hay estaciones cargadas para estimar turnos.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DashboardShiftEstimation;
