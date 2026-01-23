import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Clock,
  RefreshCcw,
  Timer,
  Users,
} from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';
import { formatMinutesShort } from '../../../utils/timeUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

const SHIFT_START_HOUR = 8;
const SHIFT_START_MINUTE = 20;
const SHIFT_END_OFFSET_MINUTES = 30;

const DATE_STORAGE_KEY = 'dashboard.shiftEstimation.date';

const DATE_KEYS = ['Fecha', 'fecha', 'Date', 'date', 'Dia', 'dia', 'Day', 'day'];
const ENTRY_KEYS = [
  'Entrada',
  'entrada',
  'Entry',
  'entry',
  'In',
  'ClockIn',
  'HoraEntrada',
  'Inicio',
  'Start',
];
const EXIT_KEYS = [
  'Salida',
  'salida',
  'Exit',
  'exit',
  'Out',
  'ClockOut',
  'HoraSalida',
  'Fin',
  'End',
];
const LUNCH_OUT_KEYS = [
  'SalidaColacion',
  'salida_colacion',
  'LunchOut',
  'LunchStart',
  'SalidaIntermedia',
  'salida_intermedia',
];
const LUNCH_IN_KEYS = [
  'EntradaColacion',
  'entrada_colacion',
  'LunchIn',
  'LunchEnd',
  'EntradaIntermedia',
  'entrada_intermedia',
];

type Station = {
  id: number;
  name: string;
  line_type?: string | null;
  sequence_order?: number | null;
  role: string;
};

type Worker = {
  id: number;
  first_name: string;
  last_name: string;
  geovictoria_identifier?: string | null;
  active?: boolean;
  assigned_station_ids?: number[] | null;
};

type AttendanceDay = {
  date: string;
  entry: Date | null;
  exit: Date | null;
  lunchStart?: Date | null;
  lunchEnd?: Date | null;
  punches?: { time: Date; type: string }[];
  workedMinutes?: number | null;
  delayMinutes?: number | null;
  worked?: boolean | null;
  absent?: boolean | null;
  raw?: unknown;
};

type WorkerAttendanceState = {
  status: 'ok' | 'missing' | 'unlinked' | 'error';
  entry: Date | null;
  exit: Date | null;
  message?: string;
};

type StationShiftSummary = {
  station: Station;
  workers: Worker[];
  workerAttendance: Array<{ worker: Worker; attendance: WorkerAttendanceState }>;
  assignedCount: number;
  presentCount: number;
  lastExit: Date | null;
  estimatedStart: Date | null;
  estimatedEnd: Date | null;
  shiftMinutes: number | null;
  status: 'no-shift' | 'open' | 'review' | 'estimated';
};

const pad = (value: number) => String(value).padStart(2, '0');

const todayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const getStoredDate = () => {
  if (typeof window === 'undefined') return todayStr();
  const stored = window.localStorage.getItem(DATE_STORAGE_KEY);
  return stored || todayStr();
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

const workerName = (worker: Worker) => {
  const name = `${worker.first_name ?? ''} ${worker.last_name ?? ''}`.trim();
  return name || `Trabajador ${worker.id}`;
};

const formatTime = (value: Date | null) => {
  if (!value) return '-';
  return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateLabel = (value: string) => {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
};

const formatShiftMinutes = (value: number | null) => {
  if (value === null) return '-';
  return formatMinutesShort(value);
};

const buildShiftStart = (dateStr: string) =>
  new Date(`${dateStr}T${pad(SHIFT_START_HOUR)}:${pad(SHIFT_START_MINUTE)}:00`);

const dateToUtcDay = (date: Date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

const daysBetween = (from: Date, to: Date) =>
  Math.floor((dateToUtcDay(to) - dateToUtcDay(from)) / 86_400_000);

const daysBackForDate = (dateStr: string) => {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  const diff = daysBetween(target, today);
  if (diff < 0) return null;
  return diff + 1;
};

const extractList = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const keys = [
    'Data',
    'data',
    'Records',
    'records',
    'Lista',
    'List',
    'Attendance',
    'attendance',
    'AttendanceBook',
    'attendanceBook',
  ];
  for (const key of keys) {
    const value = (payload as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value;
  }
  return [];
};

const pickField = (row: unknown, keys: string[]) => {
  if (!row || typeof row !== 'object') return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const value = (row as Record<string, unknown>)[key];
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        return value;
      }
    }
  }
  return null;
};

const parseCompactDateTime = (value: unknown) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!/^\d{8}(\d{6})?$/.test(raw)) return null;
  const year = raw.slice(0, 4);
  const month = raw.slice(4, 6);
  const day = raw.slice(6, 8);
  if (raw.length === 8) {
    return new Date(`${year}-${month}-${day}T00:00:00`);
  }
  const hour = raw.slice(8, 10);
  const minute = raw.slice(10, 12);
  const second = raw.slice(12, 14);
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
};

const parseDateTime = (value: unknown, dateHint?: string | null) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const compact = parseCompactDateTime(value);
  if (compact && !Number.isNaN(compact.getTime())) return compact;
  const raw = String(value).trim();
  if (!raw) return null;
  if (dateHint && /^\d{1,2}:\d{2}/.test(raw)) {
    const combined = new Date(`${dateHint}T${raw}`);
    return Number.isNaN(combined.getTime()) ? null : combined;
  }
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseTimeStringMinutes = (raw: unknown) => {
  if (!raw) return null;
  const parts = String(raw)
    .split(':')
    .map((part) => Number(part));
  if (parts.length < 2) return null;
  const [hours, minutes] = parts;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

const toDateOnly = (value: unknown) => {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const compact = parseCompactDateTime(raw);
  if (compact && !Number.isNaN(compact.getTime())) {
    return `${compact.getFullYear()}-${pad(compact.getMonth() + 1)}-${pad(
      compact.getDate(),
    )}`;
  }
  const parsed = parseDateTime(raw);
  if (!parsed) return null;
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
};

const normalizeAttendanceBook = (attendanceRaw: unknown): AttendanceDay[] | null => {
  if (!attendanceRaw || typeof attendanceRaw !== 'object') return null;
  const users = (attendanceRaw as Record<string, unknown>).Users;
  if (!Array.isArray(users) || users.length === 0) return null;
  const intervals = Array.isArray((users[0] as Record<string, unknown>)?.PlannedInterval)
    ? ((users[0] as Record<string, unknown>).PlannedInterval as unknown[])
    : [];
  if (!intervals.length) return [];

  return intervals
    .map((interval) => {
      const dateValue = toDateOnly((interval as Record<string, unknown>)?.Date);
      if (!dateValue) return null;
      const punches = Array.isArray((interval as Record<string, unknown>)?.Punches)
        ? ((interval as Record<string, unknown>).Punches as unknown[])
        : [];
      const normalizedPunches = punches
        .map((punch) => {
          const time =
            parseCompactDateTime((punch as Record<string, unknown>)?.Date) ||
            parseDateTime((punch as Record<string, unknown>)?.Date);
          if (!time) return null;
          return {
            time,
            type:
              String(
                (punch as Record<string, unknown>)?.ShiftPunchType ??
                  (punch as Record<string, unknown>)?.Type ??
                  '',
              ) || '',
          };
        })
        .filter((punch): punch is { time: Date; type: string } => Boolean(punch))
        .sort((a, b) => a.time.getTime() - b.time.getTime());
      const entry = normalizedPunches[0]?.time || null;
      const exit = normalizedPunches[normalizedPunches.length - 1]?.time || null;
      const workedMinutes = parseTimeStringMinutes(
        (interval as Record<string, unknown>)?.WorkedHours,
      );
      const delayMinutes = parseTimeStringMinutes(
        (interval as Record<string, unknown>)?.Delay,
      );
      const worked =
        (interval as Record<string, unknown>)?.Worked === true ||
        (interval as Record<string, unknown>)?.Worked === 'True';
      const absent =
        (interval as Record<string, unknown>)?.Absent === true ||
        (interval as Record<string, unknown>)?.Absent === 'True';

      return {
        date: dateValue,
        entry,
        exit,
        lunchStart: null,
        lunchEnd: null,
        workedMinutes,
        delayMinutes,
        worked,
        absent,
        punches: normalizedPunches,
        raw: interval,
      } as AttendanceDay;
    })
    .filter((item): item is AttendanceDay => Boolean(item));
};

const normalizeAttendance = (attendanceRaw: unknown): AttendanceDay[] => {
  const attendanceBook = normalizeAttendanceBook(attendanceRaw);
  const rows = extractList(attendanceRaw);
  const normalizedRows = rows
    .map((row) => {
      const dateValue =
        toDateOnly(pickField(row, DATE_KEYS)) ||
        toDateOnly(pickField(row, ENTRY_KEYS)) ||
        toDateOnly(pickField(row, EXIT_KEYS));
      const entryRaw = pickField(row, ENTRY_KEYS);
      const exitRaw = pickField(row, EXIT_KEYS);
      const lunchOutRaw = pickField(row, LUNCH_OUT_KEYS);
      const lunchInRaw = pickField(row, LUNCH_IN_KEYS);
      const entry = parseDateTime(entryRaw, dateValue);
      const exit = parseDateTime(exitRaw, dateValue);
      const lunchStart = parseDateTime(lunchOutRaw, dateValue);
      const lunchEnd = parseDateTime(lunchInRaw, dateValue);
      return {
        date: dateValue ?? '',
        entry,
        exit,
        lunchStart,
        lunchEnd,
        raw: row,
      } as AttendanceDay;
    })
    .filter((item) => item.date);
  if (attendanceBook && attendanceBook.length > 0) return attendanceBook;
  if (normalizedRows.length > 0) return normalizedRows;
  return attendanceBook ?? [];
};

const findAttendanceForDate = (days: AttendanceDay[], dateStr: string) => {
  if (!dateStr) return null;
  const direct = days.find((entry) => entry.date === dateStr);
  if (direct) return direct;
  return (
    days.find((entry) => {
      const entryDate = toDateOnly(entry.entry);
      if (entryDate === dateStr) return true;
      const exitDate = toDateOnly(entry.exit);
      return exitDate === dateStr;
    }) ?? null
  );
};

const buildAttendanceState = (
  attendanceRaw: unknown,
  dateStr: string,
): WorkerAttendanceState => {
  const days = normalizeAttendance(attendanceRaw);
  const day = findAttendanceForDate(days, dateStr);
  const entry = day?.entry ?? null;
  const exit = day?.exit ?? null;
  const hasPunch = Boolean(entry || exit);
  return {
    status: hasPunch ? 'ok' : 'missing',
    entry,
    exit,
    message: hasPunch ? undefined : 'Sin marcajes',
  };
};

const statusStyles: Record<StationShiftSummary['status'], { label: string; className: string }> = {
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
};

const workerStatusStyles: Record<
  WorkerAttendanceState['status'],
  { label: string; className: string }
> = {
  ok: { label: 'Marcado', className: 'bg-[var(--leaf)]/10 text-[var(--leaf)]' },
  missing: { label: 'Sin marcajes', className: 'bg-black/5 text-[var(--ink-muted)]' },
  unlinked: { label: 'Sin vinculo', className: 'bg-black/5 text-[var(--ink-muted)]' },
  error: { label: 'Error', className: 'bg-red-100 text-red-700' },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DashboardShiftEstimation: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const mountedRef = useRef(true);
  const [stations, setStations] = useState<Station[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedDate, setSelectedDate] = useState(getStoredDate);
  const [attendanceByWorker, setAttendanceByWorker] = useState<
    Record<number, WorkerAttendanceState>
  >({});
  const [loadingBase, setLoadingBase] = useState(false);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [error, setError] = useState('');
  const [attendanceError, setAttendanceError] = useState('');

  useEffect(() => {
    setHeader({
      title: 'Estimacion de turnos por estacion',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  useEffect(() => {
    let active = true;
    setLoadingBase(true);
    setError('');
    Promise.all([apiRequest<Station[]>('/api/stations'), apiRequest<Worker[]>('/api/workers')])
      .then(([stationData, workerData]) => {
        if (!active) return;
        setStations(Array.isArray(stationData) ? stationData : []);
        setWorkers(Array.isArray(workerData) ? workerData : []);
      })
      .catch((err) => {
        if (!active) return;
        setStations([]);
        setWorkers([]);
        setError(err instanceof Error ? err.message : 'Error cargando estaciones y trabajadores.');
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
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DATE_STORAGE_KEY, selectedDate);
  }, [selectedDate]);

  const assignedWorkers = useMemo(
    () =>
      workers.filter(
        (worker) =>
          worker.active !== false && (worker.assigned_station_ids?.length ?? 0) > 0,
      ),
    [workers],
  );

  const stationsSorted = useMemo(
    () =>
      [...stations].sort((a, b) => {
        const orderA = a.sequence_order ?? 1_000_000;
        const orderB = b.sequence_order ?? 1_000_000;
        if (orderA !== orderB) return orderA - orderB;
        return (a.name || '').localeCompare(b.name || '');
      }),
    [stations],
  );

  const workersByStation = useMemo(() => {
    const map = new Map<number, Worker[]>();
    assignedWorkers.forEach((worker) => {
      (worker.assigned_station_ids ?? []).forEach((stationId) => {
        const bucket = map.get(stationId) ?? [];
        bucket.push(worker);
        map.set(stationId, bucket);
      });
    });
    map.forEach((list) => list.sort((a, b) => workerName(a).localeCompare(workerName(b))));
    return map;
  }, [assignedWorkers]);

  const loadAttendance = useCallback(async () => {
    if (!assignedWorkers.length || !selectedDate) {
      setAttendanceByWorker({});
      setAttendanceError('');
      setLoadingAttendance(false);
      return;
    }
    setLoadingAttendance(true);
    setAttendanceError('');
    const daysBack = daysBackForDate(selectedDate);
    const useDaysRange =
      typeof daysBack === 'number' && daysBack >= 1 && daysBack <= 365;
    const results: Array<{ workerId: number; attendance: WorkerAttendanceState }> = [];
    for (const worker of assignedWorkers) {
      if (!mountedRef.current) return;
      if (!worker.geovictoria_identifier) {
        results.push({
          workerId: worker.id,
          attendance: {
            status: 'unlinked',
            entry: null,
            exit: null,
            message: 'Sin vinculo GeoVictoria',
          },
        });
        continue;
      }
      try {
        const encodedDate = encodeURIComponent(selectedDate);
        const requestPath = useDaysRange
          ? `/api/geovictoria/attendance?worker_id=${worker.id}&days=${daysBack}`
          : `/api/geovictoria/attendance?worker_id=${worker.id}&start_date=${encodedDate}&end_date=${encodedDate}`;
        const response = await apiRequest<{
          attendance?: unknown;
        }>(requestPath);
        const attendance = buildAttendanceState(response?.attendance, selectedDate);
        results.push({ workerId: worker.id, attendance });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error cargando asistencia';
        results.push({
          workerId: worker.id,
          attendance: {
            status: 'error',
            entry: null,
            exit: null,
            message,
          },
        });
      }
      await sleep(150);
    }

    if (!mountedRef.current) return;
    const nextAttendance: Record<number, WorkerAttendanceState> = {};
    let hasErrors = false;
    results.forEach((result) => {
      if (result.attendance.status === 'error') {
        hasErrors = true;
      }
      nextAttendance[result.workerId] = result.attendance;
    });
    setAttendanceByWorker(nextAttendance);
    setAttendanceError(hasErrors ? 'Algunos marcajes no se pudieron cargar.' : '');
    setLoadingAttendance(false);
  }, [assignedWorkers, selectedDate]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  const stationSummaries = useMemo<StationShiftSummary[]>(() => {
    return stationsSorted.map((station) => {
      const stationWorkers = workersByStation.get(station.id) ?? [];
      const workerAttendance = stationWorkers.map((worker) => {
        const attendance =
          attendanceByWorker[worker.id] ??
          ({
            status: worker.geovictoria_identifier ? 'missing' : 'unlinked',
            entry: null,
            exit: null,
            message: worker.geovictoria_identifier ? 'Sin marcajes' : 'Sin vinculo GeoVictoria',
          } as WorkerAttendanceState);
        return { worker, attendance };
      });

      const presentWorkers = workerAttendance.filter(
        ({ attendance }) => Boolean(attendance.entry || attendance.exit),
      );
      const lastExit = presentWorkers.reduce<Date | null>((latest, item) => {
        if (!item.attendance.exit) return latest;
        if (!latest || item.attendance.exit > latest) return item.attendance.exit;
        return latest;
      }, null);
      const hasAttendance = presentWorkers.length > 0;
      const estimatedStart = hasAttendance ? buildShiftStart(selectedDate) : null;
      const estimatedEnd = lastExit
        ? new Date(lastExit.getTime() - SHIFT_END_OFFSET_MINUTES * 60_000)
        : null;
      let shiftMinutes: number | null = null;
      if (estimatedStart && estimatedEnd) {
        const diff = (estimatedEnd.getTime() - estimatedStart.getTime()) / 60_000;
        if (diff > 0) shiftMinutes = Math.round(diff);
      }

      let status: StationShiftSummary['status'] = 'no-shift';
      if (hasAttendance && !lastExit) status = 'open';
      if (hasAttendance && lastExit && shiftMinutes === null) status = 'review';
      if (hasAttendance && lastExit && shiftMinutes !== null) status = 'estimated';

      return {
        station,
        workers: stationWorkers,
        workerAttendance,
        assignedCount: stationWorkers.length,
        presentCount: presentWorkers.length,
        lastExit,
        estimatedStart,
        estimatedEnd,
        shiftMinutes,
        status,
      };
    });
  }, [stationsSorted, workersByStation, attendanceByWorker, selectedDate]);

  const stats = useMemo(() => {
    const totalStations = stationSummaries.length;
    const stationsWithShift = stationSummaries.filter((summary) => summary.status !== 'no-shift')
      .length;
    const stationsNoShift = stationSummaries.filter((summary) => summary.status === 'no-shift')
      .length;
    const stationsOpen = stationSummaries.filter((summary) => summary.status === 'open').length;
    const assignedCount = assignedWorkers.length;
    const presentCount = assignedWorkers.filter((worker) => {
      const attendance = attendanceByWorker[worker.id];
      return attendance && (attendance.entry || attendance.exit);
    }).length;
    const unlinkedCount = assignedWorkers.filter((worker) => !worker.geovictoria_identifier)
      .length;
    const errorCount = assignedWorkers.filter(
      (worker) => attendanceByWorker[worker.id]?.status === 'error',
    ).length;
    const latestExit = stationSummaries.reduce<Date | null>((latest, summary) => {
      if (!summary.lastExit) return latest;
      if (!latest || summary.lastExit > latest) return summary.lastExit;
      return latest;
    }, null);

    return {
      totalStations,
      stationsWithShift,
      stationsNoShift,
      stationsOpen,
      assignedCount,
      presentCount,
      unlinkedCount,
      errorCount,
      latestExit,
    };
  }, [stationSummaries, assignedWorkers, attendanceByWorker]);

  const coverageLabel =
    stats.assignedCount > 0
      ? `${stats.presentCount}/${stats.assignedCount}`
      : '0/0';
  const coveragePercent =
    stats.assignedCount > 0
      ? Math.round((stats.presentCount / stats.assignedCount) * 100)
      : 0;
  const shiftStartLabel = `${pad(SHIFT_START_HOUR)}:${pad(SHIFT_START_MINUTE)} AM`;

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
              Inferimos el horario de cada estacion usando los marcajes de entrada y salida de su
              dotacion asignada. Si hay al menos un trabajador con marcaje, el inicio se fija a las{' '}
              {shiftStartLabel} y el cierre se estima con la ultima salida menos 30 minutos.
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
                onChange={(event) => setSelectedDate(event.target.value)}
                className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--ink)]"
              />
            </label>
            <button
              type="button"
              onClick={loadAttendance}
              disabled={loadingBase || loadingAttendance}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)] transition hover:border-black/20 disabled:opacity-60"
            >
              <RefreshCcw className={`h-4 w-4 ${loadingAttendance ? 'animate-spin' : ''}`} />
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
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Cobertura marcajes
                </p>
                <p className="text-lg font-semibold text-[var(--ink)]">{coverageLabel}</p>
                <p className="text-xs text-[var(--ink-muted)]">{coveragePercent}% detectado</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Datos incompletos
                </p>
                <p className="text-lg font-semibold text-[var(--ink)]">
                  {stats.unlinkedCount + stats.errorCount}
                </p>
                <p className="text-xs text-[var(--ink-muted)]">
                  {stats.unlinkedCount} sin vinculo · {stats.errorCount} con error
                </p>
              </div>
            </div>
          </div>
        </div>

        {loadingBase || loadingAttendance ? (
          <div className="mt-4 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Actualizando marcajes...
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {attendanceError ? (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {attendanceError}
        </div>
      ) : null}

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
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Fin estimado
            </p>
            <p className="mt-2 text-lg font-semibold text-[var(--ink)]">
              Ultima salida - 30 min
            </p>
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
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
              Estaciones
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">
              Turnos estimados por estacion
            </h2>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-black/10 bg-white px-4 py-2 text-xs text-[var(--ink)]">
            <Clock className="h-4 w-4 text-[var(--accent)]" />
            Ultima salida global: {formatTime(stats.latestExit)}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                <th className="px-3 py-2">Estacion</th>
                <th className="px-3 py-2">Dotacion</th>
                <th className="px-3 py-2">Inicio</th>
                <th className="px-3 py-2">Ultima salida</th>
                <th className="px-3 py-2">Fin estimado</th>
                <th className="px-3 py-2">Duracion</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {stationSummaries.map((summary) => {
                const statusMeta = statusStyles[summary.status];
                return (
                  <tr
                    key={summary.station.id}
                    className="border-b border-black/5 text-[var(--ink)]"
                  >
                    <td className="px-3 py-3 align-top">
                      <div className="font-semibold text-[var(--ink)]">
                        {summary.station.name || `Estacion ${summary.station.id}`}
                      </div>
                      <div className="text-xs text-[var(--ink-muted)]">
                        ID {summary.station.id}
                        {summary.station.line_type ? ` · linea ${summary.station.line_type}` : ''}
                        {summary.station.role ? ` · ${summary.station.role}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="font-semibold">
                        {summary.presentCount}/{summary.assignedCount}
                      </div>
                      <div className="text-xs text-[var(--ink-muted)]">con marcaje</div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      {summary.estimatedStart ? formatTime(summary.estimatedStart) : 'Sin turno'}
                    </td>
                    <td className="px-3 py-3 align-top">{formatTime(summary.lastExit)}</td>
                    <td className="px-3 py-3 align-top">
                      {summary.estimatedEnd ? formatTime(summary.estimatedEnd) : '-'}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {summary.estimatedEnd ? formatShiftMinutes(summary.shiftMinutes) : '-'}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${statusMeta.className}`}
                      >
                        {statusMeta.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-top">
                      {summary.workers.length === 0 ? (
                        <span className="text-xs text-[var(--ink-muted)]">
                          Sin personal asignado
                        </span>
                      ) : (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-[var(--ink-muted)]">
                            Ver marcajes
                          </summary>
                          <div className="mt-2 space-y-2">
                            {summary.workerAttendance.map(({ worker, attendance }) => {
                              const workerStatus = workerStatusStyles[attendance.status];
                              return (
                                <div
                                  key={worker.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/5 bg-white/90 px-3 py-2"
                                >
                                  <div className="min-w-[160px] text-[var(--ink)]">
                                    <p className="font-medium">{workerName(worker)}</p>
                                    <p className="text-[11px] text-[var(--ink-muted)]">
                                      {worker.geovictoria_identifier ? 'GeoVictoria' : 'Sin vinculo'}
                                    </p>
                                  </div>
                                  <div className="font-mono text-[11px] text-[var(--ink)]">
                                    {formatTime(attendance.entry)} → {formatTime(attendance.exit)}
                                  </div>
                                  <span
                                    className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${workerStatus.className}`}
                                    title={attendance.message}
                                  >
                                    {workerStatus.label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
              {stationSummaries.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
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
