import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';
import { formatMinutesDetailed } from '../../../utils/timeUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

const RANGE_OPTIONS = [7, 14, 30, 60, 90, 120];
const DEFAULT_RANGE = 30;

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

const buildHeaders = (options) => {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
};

const apiRequest = async (path, options = {}) => {
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
    return undefined;
  }
  return response.json();
};

const pad = (value) => String(value).padStart(2, '0');

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const isoDaysAgo = (days) => {
  const now = new Date();
  now.setDate(now.getDate() - days);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const extractList = (payload) => {
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
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  return [];
};

const pickField = (row, keys) => {
  if (!row || typeof row !== 'object') return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const value = row[key];
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        return value;
      }
    }
  }
  return null;
};

const parseCompactDateTime = (value) => {
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

const parseDateTime = (value, dateHint) => {
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

const parseTimeStringMinutes = (raw) => {
  if (!raw) return null;
  const parts = String(raw).split(':').map((part) => Number(part));
  if (parts.length < 2) return null;
  const [hours, minutes] = parts;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

const toDateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const compact = parseCompactDateTime(raw);
  if (compact && !Number.isNaN(compact.getTime())) {
    return `${compact.getFullYear()}-${pad(compact.getMonth() + 1)}-${pad(compact.getDate())}`;
  }
  const parsed = parseDateTime(raw);
  if (!parsed) return null;
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
};

const formatTime = (value) => {
  if (!value) return '-';
  const date = value instanceof Date ? value : parseDateTime(value);
  if (!date || Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatSeconds = (seconds) => {
  if (!Number.isFinite(seconds)) return '-';
  return formatMinutesDetailed(seconds / 60);
};

const sumPauseSeconds = (pauses) => {
  if (!Array.isArray(pauses)) return 0;
  return pauses.reduce((acc, pause) => {
    const raw = pause?.duration_seconds;
    const value = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
    if (!Number.isFinite(value)) return acc;
    return acc + value;
  }, 0);
};

const attendancePresenceSeconds = (attendance) => {
  if (!attendance) return null;
  if (attendance.entry && attendance.exit && attendance.exit > attendance.entry) {
    return (attendance.exit - attendance.entry) / 1000;
  }
  if (Number.isFinite(attendance.workedMinutes) && attendance.workedMinutes > 0) {
    return attendance.workedMinutes * 60;
  }
  return null;
};

const buildActivityDays = (rows) => {
  const map = new Map();
  if (!Array.isArray(rows)) return [];
  rows.forEach((row) => {
    const dateKey = toDateOnly(row?.completed_at || row?.started_at);
    if (!dateKey) return;
    const entry = map.get(dateKey) || {
      date: dateKey,
      tasks: [],
      activeSeconds: 0,
      pausedSeconds: 0,
      firstTaskStart: null,
      lastTaskEnd: null,
    };
    const startedAt = parseDateTime(row?.started_at);
    const completedAt = parseDateTime(row?.completed_at);
    if (startedAt && (!entry.firstTaskStart || startedAt < entry.firstTaskStart)) {
      entry.firstTaskStart = startedAt;
    }
    if (completedAt && (!entry.lastTaskEnd || completedAt > entry.lastTaskEnd)) {
      entry.lastTaskEnd = completedAt;
    }
    const durationMinutes = row?.duration_minutes;
    const durationValue =
      typeof durationMinutes === 'string'
        ? parseFloat(durationMinutes)
        : Number(durationMinutes);
    if (Number.isFinite(durationValue)) {
      entry.activeSeconds += durationValue * 60;
    } else if (startedAt && completedAt && completedAt > startedAt) {
      entry.activeSeconds += (completedAt - startedAt) / 1000;
    }
    entry.pausedSeconds += sumPauseSeconds(row?.pauses);
    entry.tasks.push(row);
    map.set(dateKey, entry);
  });
  return Array.from(map.values());
};

const normalizeAttendanceBook = (attendanceRaw) => {
  if (!attendanceRaw || typeof attendanceRaw !== 'object') return null;
  const users = attendanceRaw.Users;
  if (!Array.isArray(users) || !users.length) return null;
  const intervals = Array.isArray(users[0]?.PlannedInterval) ? users[0].PlannedInterval : [];
  if (!intervals.length) return [];

  return intervals
    .map((interval) => {
      const dateValue = toDateOnly(interval?.Date);
      if (!dateValue) return null;
      const punches = Array.isArray(interval?.Punches) ? interval.Punches : [];
      const normalizedPunches = punches
        .map((punch) => {
          const time = parseCompactDateTime(punch?.Date) || parseDateTime(punch?.Date);
          if (!time) return null;
          return {
            time,
            type: punch?.ShiftPunchType || punch?.Type || '',
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.time - b.time);
      const entry = normalizedPunches[0]?.time || null;
      const exit = normalizedPunches[normalizedPunches.length - 1]?.time || null;
      const workedMinutes = parseTimeStringMinutes(interval?.WorkedHours);
      const delayMinutes = parseTimeStringMinutes(interval?.Delay);
      const worked = interval?.Worked === true || interval?.Worked === 'True';
      const absent = interval?.Absent === true || interval?.Absent === 'True';

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
      };
    })
    .filter(Boolean);
};

const normalizeAttendance = (attendanceRaw) => {
  const attendanceBook = normalizeAttendanceBook(attendanceRaw);
  if (attendanceBook) return attendanceBook;
  const rows = extractList(attendanceRaw);
  return rows
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
        date: dateValue,
        entry,
        exit,
        lunchStart,
        lunchEnd,
        raw: row,
      };
    })
    .filter((item) => item.date);
};

const DashboardAssistance = () => {
  const { setHeader } = useAdminHeader();
  const [workers, setWorkers] = useState([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [attendanceResponse, setAttendanceResponse] = useState(null);
  const [activityRows, setActivityRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attendanceError, setAttendanceError] = useState('');
  const [activityError, setActivityError] = useState('');
  const [dayIndex, setDayIndex] = useState(0);
  const [rangeDays, setRangeDays] = useState(DEFAULT_RANGE);

  useEffect(() => {
    setHeader({
      title: 'Asistencias y actividad',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  useEffect(() => {
    let active = true;
    apiRequest('/api/workers')
      .then((result) => {
        if (!active) return;
        setWorkers(Array.isArray(result) ? result : []);
      })
      .catch((err) => {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Error cargando trabajadores.';
        setError(message);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedWorker = useMemo(
    () => workers.find((worker) => String(worker.id) === String(selectedWorkerId)),
    [selectedWorkerId, workers]
  );

  const fetchData = async (worker, days) => {
    if (!worker) return;
    setLoading(true);
    setError('');
    setAttendanceError('');
    setActivityError('');
    const fromDate = isoDaysAgo(days);
    const toDate = todayIso();

    const attendancePromise = worker.geovictoria_identifier
      ? apiRequest(`/api/geovictoria/attendance?worker_id=${worker.id}&days=${days}`)
          .then((payload) => {
            setAttendanceResponse(payload);
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : 'Error cargando asistencia.';
            setAttendanceError(message);
            setAttendanceResponse(null);
          })
      : Promise.resolve(setAttendanceResponse(null));

    const activityPromise = apiRequest(
      `/api/panel-task-history?worker_id=${worker.id}&from_date=${fromDate}&to_date=${toDate}&limit=2000`
    )
      .then((rows) => {
        setActivityRows(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Error cargando actividad.';
        setActivityError(message);
        setActivityRows([]);
      });

    await Promise.allSettled([attendancePromise, activityPromise]);
    setDayIndex(0);
    setLoading(false);
  };

  useEffect(() => {
    if (!selectedWorker) {
      setAttendanceResponse(null);
      setActivityRows([]);
      setDayIndex(0);
      return;
    }
    fetchData(selectedWorker, rangeDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkerId, rangeDays]);

  const attendanceDays = useMemo(
    () => normalizeAttendance(attendanceResponse?.attendance),
    [attendanceResponse]
  );

  const activityDays = useMemo(() => buildActivityDays(activityRows), [activityRows]);

  const combinedDays = useMemo(() => {
    const map = new Map();
    attendanceDays.forEach((day) => {
      map.set(day.date, { date: day.date, attendance: day, activity: null });
    });
    activityDays.forEach((day) => {
      const existing = map.get(day.date) || { date: day.date, attendance: null, activity: null };
      map.set(day.date, { ...existing, activity: day });
    });
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [attendanceDays, activityDays]);

  const selectedDay = combinedDays[dayIndex] || null;

  const minDate = combinedDays.length ? combinedDays[combinedDays.length - 1].date : '';
  const maxDate = combinedDays.length ? combinedDays[0].date : '';

  const totals = useMemo(() => {
    return combinedDays.reduce(
      (acc, day) => {
        const attendanceSeconds = attendancePresenceSeconds(day.attendance);
        if (attendanceSeconds !== null) {
          acc.presenceSeconds += attendanceSeconds;
          acc.presenceDays += 1;
        } else if (day.activity?.firstTaskStart && day.activity?.lastTaskEnd) {
          const activeSpan = Math.max(
            0,
            (day.activity.lastTaskEnd - day.activity.firstTaskStart) / 1000
          );
          if (activeSpan > 0) {
            acc.presenceSeconds += activeSpan;
            acc.presenceDays += 1;
          }
        }
        if (day.activity) {
          acc.activeSeconds += day.activity.activeSeconds || 0;
          acc.pausedSeconds += day.activity.pausedSeconds || 0;
          acc.activityDays += 1;
        }
        return acc;
      },
      {
        presenceSeconds: 0,
        activeSeconds: 0,
        pausedSeconds: 0,
        presenceDays: 0,
        activityDays: 0,
      }
    );
  }, [combinedDays]);

  const goToDate = (dateValue) => {
    if (!dateValue) return;
    const targetIndex = combinedDays.findIndex((day) => day.date === dateValue);
    if (targetIndex >= 0) {
      setDayIndex(targetIndex);
    }
  };

  const entrySource = (day) => {
    if (day?.attendance?.entry) return 'GeoVictoria';
    if (day?.activity?.firstTaskStart) return 'Actividad';
    return '-';
  };
  const exitSource = (day) => {
    if (day?.attendance?.exit) return 'GeoVictoria';
    if (day?.activity?.lastTaskEnd) return 'Actividad';
    return '-';
  };
  const dayPresenceSeconds = (day) => {
    const fromAttendance = attendancePresenceSeconds(day?.attendance);
    if (fromAttendance !== null) return fromAttendance;
    if (day?.activity?.firstTaskStart && day?.activity?.lastTaskEnd) {
      return Math.max(0, (day.activity.lastTaskEnd - day.activity.firstTaskStart) / 1000);
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-black/5 bg-white/80 shadow-sm px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
              Asistencia
            </p>
            <h1 className="font-display text-xl text-[var(--ink)]">Resumen de asistencia</h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Consulta marcajes de GeoVictoria y actividad registrada en la linea.
            </p>
          </div>
          <button
            type="button"
            onClick={() => selectedWorker && fetchData(selectedWorker, rangeDays)}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)]"
          >
            <RefreshCcw className="h-4 w-4" />
            Recargar
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[220px]">
              <label className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Trabajador
              </label>
              <select
                className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                value={selectedWorkerId}
                onChange={(event) => setSelectedWorkerId(event.target.value)}
              >
                <option value="">Seleccione</option>
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.first_name} {worker.last_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[160px]">
              <label className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Rango
              </label>
              <select
                className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                value={rangeDays}
                onChange={(event) => setRangeDays(Number(event.target.value))}
              >
                {RANGE_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    Ultimos {days} dias
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedWorker && !selectedWorker.geovictoria_identifier && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Este trabajador no esta vinculado a GeoVictoria. Asigne un identificador (RUT) en{' '}
              <Link to="/admin/workers" className="font-semibold underline">
                Personal
              </Link>{' '}
              para ver sus marcajes.
            </div>
          )}

          {attendanceError && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {attendanceError}
            </div>
          )}
          {activityError && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {activityError}
            </div>
          )}
        </div>

        <div className="grid gap-3">
          <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Dias con presencia
            </p>
            <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
              {totals.presenceDays}
            </p>
            <p className="text-xs text-[var(--ink-muted)]">
              {formatSeconds(totals.presenceSeconds)} totales
            </p>
          </div>
          <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Actividad registrada
            </p>
            <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
              {totals.activityDays}
            </p>
            <p className="text-xs text-[var(--ink-muted)]">
              {formatSeconds(totals.activeSeconds)} activas · {formatSeconds(totals.pausedSeconds)}
              pausas
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-black/10 px-3 py-1.5 text-xs text-[var(--ink)]"
              disabled={dayIndex <= 0}
              onClick={() => setDayIndex((prev) => Math.max(0, prev - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-black/10 px-3 py-1.5 text-xs text-[var(--ink)]"
              disabled={dayIndex >= combinedDays.length - 1}
              onClick={() => setDayIndex((prev) => Math.min(combinedDays.length - 1, prev + 1))}
            >
              Siguiente
              <ChevronRight className="h-4 w-4" />
            </button>
            <p className="text-xs text-[var(--ink-muted)]">
              Dia {combinedDays.length ? dayIndex + 1 : 0} de {combinedDays.length}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
            <label htmlFor="assistance-date-picker">Ir a fecha</label>
            <input
              id="assistance-date-picker"
              type="date"
              className="rounded-full border border-black/10 px-3 py-1.5 text-xs text-[var(--ink)]"
              value={selectedDay?.date || ''}
              min={minDate || undefined}
              max={maxDate || undefined}
              onChange={(event) => goToDate(event.target.value)}
            />
          </div>
        </div>

        {loading && <p className="mt-4 text-sm text-[var(--ink-muted)]">Cargando...</p>}

        {!loading && !selectedWorker && (
          <p className="mt-4 text-sm text-[var(--ink-muted)]">
            Seleccione un trabajador para revisar sus datos.
          </p>
        )}

        {!loading && selectedWorker && !combinedDays.length && (
          <p className="mt-4 text-sm text-[var(--ink-muted)]">
            No hay registros recientes para este trabajador.
          </p>
        )}

        {!loading && selectedDay && (
          <div className="mt-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-xl border border-black/5 bg-[var(--accent-soft)]/60 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Entrada
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--ink)]">
                  {formatTime(selectedDay.attendance?.entry || selectedDay.activity?.firstTaskStart)}
                </p>
                <p className="text-xs text-[var(--ink-muted)]">
                  Fuente: {entrySource(selectedDay)}
                </p>
              </div>
              <div className="rounded-xl border border-black/5 bg-[var(--accent-soft)]/60 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Salida
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--ink)]">
                  {formatTime(selectedDay.attendance?.exit || selectedDay.activity?.lastTaskEnd)}
                </p>
                <p className="text-xs text-[var(--ink-muted)]">Fuente: {exitSource(selectedDay)}</p>
              </div>
              <div className="rounded-xl border border-black/5 bg-[var(--accent-soft)]/60 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Presencia
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--ink)]">
                  {formatSeconds(dayPresenceSeconds(selectedDay))}
                </p>
                <p className="text-xs text-[var(--ink-muted)]">
                  Colacion: {formatSeconds(
                    selectedDay.attendance?.lunchStart && selectedDay.attendance?.lunchEnd
                      ? (selectedDay.attendance.lunchEnd - selectedDay.attendance.lunchStart) / 1000
                      : null
                  )}
                </p>
                {Number.isFinite(selectedDay.attendance?.delayMinutes) &&
                  selectedDay.attendance.delayMinutes > 0 && (
                  <p className="text-xs text-[var(--ink-muted)]">
                    Retraso: {Math.round(selectedDay.attendance.delayMinutes)}m
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-black/5 bg-[var(--accent-soft)]/60 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Actividad
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--ink)]">
                  {formatSeconds(selectedDay.activity?.activeSeconds)}
                </p>
                <p className="text-xs text-[var(--ink-muted)]">
                  Pausas: {formatSeconds(selectedDay.activity?.pausedSeconds)}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    Actividad del dia
                  </p>
                  <p className="text-sm text-[var(--ink)]">{selectedDay.date}</p>
                </div>
                <p className="text-xs text-[var(--ink-muted)]">
                  {selectedDay.activity?.tasks?.length || 0} tareas
                </p>
              </div>

              {selectedDay.activity?.tasks?.length ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="text-[var(--ink-muted)]">
                      <tr>
                        <th className="pb-2 pr-4 font-semibold uppercase tracking-[0.2em]">
                          Panel
                        </th>
                        <th className="pb-2 pr-4 font-semibold uppercase tracking-[0.2em]">
                          Tarea
                        </th>
                        <th className="pb-2 pr-4 font-semibold uppercase tracking-[0.2em]">
                          Estacion
                        </th>
                        <th className="pb-2 pr-4 font-semibold uppercase tracking-[0.2em]">
                          Inicio
                        </th>
                        <th className="pb-2 pr-4 font-semibold uppercase tracking-[0.2em]">
                          Fin
                        </th>
                        <th className="pb-2 pr-4 font-semibold uppercase tracking-[0.2em]">
                          Duracion
                        </th>
                        <th className="pb-2 font-semibold uppercase tracking-[0.2em]">Pausas</th>
                      </tr>
                    </thead>
                    <tbody className="text-[var(--ink)]">
                      {selectedDay.activity.tasks
                        .slice()
                        .sort((a, b) => {
                          const aStart = parseDateTime(a?.started_at)?.getTime() || 0;
                          const bStart = parseDateTime(b?.started_at)?.getTime() || 0;
                          return aStart - bStart;
                        })
                        .map((task) => {
                          const pauseSeconds = sumPauseSeconds(task?.pauses);
                          return (
                            <tr key={task.task_instance_id} className="border-t border-black/5">
                              <td className="py-2 pr-4">{task.panel_code || '-'}</td>
                              <td className="py-2 pr-4">{task.task_definition_name || '-'}</td>
                              <td className="py-2 pr-4">{task.station_name || '-'}</td>
                              <td className="py-2 pr-4">{formatTime(task.started_at)}</td>
                              <td className="py-2 pr-4">{formatTime(task.completed_at)}</td>
                              <td className="py-2 pr-4">
                                {formatSeconds(
                                  Number.isFinite(Number(task.duration_minutes))
                                    ? Number(task.duration_minutes) * 60
                                    : null
                                )}
                              </td>
                              <td className="py-2">{formatSeconds(pauseSeconds)}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 text-sm text-[var(--ink-muted)]">
                  No se registraron tareas en este dia.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardAssistance;
