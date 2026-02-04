import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';
import { formatMinutesDetailed } from '../../../utils/timeUtils';
import StationWideAssistanceTab from './StationWideAssistanceTab';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

const RANGE_OPTIONS = [7, 14, 30, 60, 90, 120];
const DEFAULT_RANGE = 30;
const REGULAR_END_MINUTES = 17 * 60 + 30;
const LUNCH_START_MINUTES = 13 * 60;
const LUNCH_END_MINUTES = 13 * 60 + 30;
const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
const DETAIL_TABS = [
  { id: 'timeline', label: 'Linea de tiempo' },
  { id: 'monthly', label: 'Asistencia mensual' },
  { id: 'range', label: 'Indicadores rango' },
];
const VIEW_TABS = [
  { id: 'worker', label: 'Por trabajador' },
  { id: 'station', label: 'Por estacion' },
];

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

const formatPercent = (value, digits = 0) => {
  if (!Number.isFinite(value)) return '-';
  const factor = 10 ** digits;
  return `${Math.round(value * 100 * factor) / factor}%`;
};

const firstNamePart = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] ?? '';
};

const surnamePart = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return parts[0] ?? '';
  return parts[parts.length - 2] ?? '';
};

const formatWorkerDisplayName = (worker) => {
  if (!worker) return '';
  const first = firstNamePart(worker.first_name ?? '');
  const last = surnamePart(worker.last_name ?? '');
  return [first, last].filter(Boolean).join(' ');
};

const formatNameFromString = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0] ?? '';
  const first = parts[0] ?? '';
  const last = surnamePart(parts.slice(1).join(' '));
  return [first, last].filter(Boolean).join(' ');
};

const formatWorkerName = (worker) => {
  if (!worker) return '';
  if (typeof worker === 'string') return formatNameFromString(worker);
  if (typeof worker === 'object') {
    if (worker.first_name || worker.last_name) {
      return formatWorkerDisplayName(worker);
    }
    if (typeof worker.name === 'string') {
      return formatNameFromString(worker.name);
    }
  }
  return '';
};

const useContainerWidth = () => {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => forceUpdate((n) => n + 1), 50);
    return () => clearTimeout(t);
  }, []);

  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const element = ref.current;
    const update = () => {
      const w = element.clientWidth || 0;
      if (w > 0) setWidth(w);
    };
    update();
    const frame = window.requestAnimationFrame(update);
    const t1 = window.setTimeout(update, 20);
    const t2 = window.setTimeout(update, 100);
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(element);
    }
    window.addEventListener('resize', update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      if (observer) observer.disconnect();
      window.removeEventListener('resize', update);
    };
  });

  return { ref, width };
};

const parseDateOnly = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const [year, month, day] = raw.split('-').map((part) => Number(part));
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

const minutesOf = (date) => date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;

const scopeLabel = (scope) => {
  const normalized = String(scope || '').toLowerCase();
  if (normalized === 'panel') return 'Panel';
  if (normalized === 'module') return 'Modulo';
  if (normalized === 'aux') return 'Aux';
  return '-';
};

const projectInitials = (value) => {
  if (!value) return '';
  const parts = String(value)
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!parts.length) return '';
  return parts
    .map((part) => part[0])
    .join('')
    .toUpperCase();
};

const normalizeHouseIdentifier = (value) => {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const match = raw.match(/\d+/g);
  if (!match) return raw;
  return match.join('');
};

const moduleShortLabel = (value) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '';
  return `MD${numberValue}`;
};

const buildProjectHouseModuleLabel = (task) => {
  const initials = projectInitials(task?.project_name);
  const houseIdentifier = normalizeHouseIdentifier(task?.house_identifier);
  const moduleLabel = moduleShortLabel(task?.module_number);
  const pieces = [];
  const projectHouse =
    initials || houseIdentifier ? `${initials}${houseIdentifier}`.trim() : '';
  if (projectHouse) pieces.push(projectHouse);
  if (moduleLabel) pieces.push(moduleLabel);
  return pieces.join(' ');
};

const normalizeStationName = (station) => {
  if (!station?.name) return '';
  const trimmed = String(station.name).trim();
  if (!station.line_type) {
    return trimmed;
  }
  const pattern = new RegExp(`^(Linea|Line)\\s*${station.line_type}\\s*-\\s*`, 'i');
  const normalized = trimmed.replace(pattern, '').trim();
  return normalized || trimmed;
};

const taskContextLabel = (task) => {
  const houseModule = buildProjectHouseModuleLabel(task);
  if (task?.panel_code) {
    return houseModule ? `${houseModule} · ${task.panel_code}` : task.panel_code;
  }
  if (houseModule) return houseModule;
  const scope = scopeLabel(task?.scope);
  return scope !== '-' ? scope : '-';
};

const truncateLabel = (text, maxLength = 40) => {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
};

const taskFullLabel = (task) => {
  const name = task?.task_definition_name || 'Tarea';
  const context = taskContextLabel(task);
  return context && context !== '-' ? `${name} · ${context}` : name;
};

const taskDisplayLabel = (task, maxLength = 28) => truncateLabel(taskFullLabel(task), maxLength);

const normalizeIntervals = (intervals) => {
  const sorted = intervals
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  sorted.forEach((interval) => {
    if (!merged.length) {
      merged.push(interval);
      return;
    }
    const last = merged[merged.length - 1];
    if (interval.start <= last.end) {
      last.end = interval.end > last.end ? interval.end : last.end;
    } else {
      merged.push(interval);
    }
  });
  return merged;
};

const clampToWindow = (value, windowStart, windowEnd) => {
  if (!value) return null;
  let result = value;
  if (windowStart && result < windowStart) result = windowStart;
  if (windowEnd && result > windowEnd) result = windowEnd;
  return result;
};

const buildDayBounds = (day) => {
  const baseDate = parseDateOnly(day?.date);
  if (!baseDate) return null;
  const baseKey = toDateOnly(baseDate);
  const firstTaskStart = parseDateTime(day?.activity?.firstTaskStart);
  const defaultStart = new Date(baseDate);
  defaultStart.setHours(8, 0, 0, 0);
  const dayStart = new Date(defaultStart);
  const defaultEnd = new Date(baseDate);
  defaultEnd.setHours(Math.floor(REGULAR_END_MINUTES / 60), REGULAR_END_MINUTES % 60, 0, 0);
  const logoff = parseDateTime(day?.attendance?.exit);
  const logoffSameDay = logoff && baseKey && toDateOnly(logoff) === baseKey;
  let dayEnd = logoffSameDay ? logoff : defaultEnd;
  if (firstTaskStart && dayEnd && dayEnd < firstTaskStart) {
    dayEnd = defaultEnd;
  }
  if (!dayEnd || dayEnd <= dayStart) {
    dayEnd = defaultEnd;
  }
  return { baseDate, dayStart, dayEnd, defaultStart, defaultEnd };
};

const buildTaskIntervals = (task, windowStart, windowEnd) => {
  const rawStart = parseDateTime(task?.started_at);
  if (!rawStart) return null;
  const rawEnd = parseDateTime(task?.completed_at);
  let end = rawEnd && rawEnd > rawStart ? rawEnd : null;
  if (!end && windowEnd && windowEnd > rawStart) {
    end = windowEnd;
  }
  if (!end || end <= rawStart) return null;

  const start = clampToWindow(rawStart, windowStart, windowEnd);
  const boundedEnd = clampToWindow(end, windowStart, windowEnd);
  if (!start || !boundedEnd || boundedEnd <= start) return null;
  const pauseSegments = (task?.pauses || [])
    .map((pause) => {
      const pauseStart = parseDateTime(pause?.paused_at);
      const pauseEnd = parseDateTime(pause?.resumed_at) || end;
      if (!pauseStart || !pauseEnd || pauseEnd <= pauseStart) return null;
      const boundedStart = pauseStart < start ? start : pauseStart;
      const boundedPauseEnd = pauseEnd > boundedEnd ? boundedEnd : pauseEnd;
      if (boundedPauseEnd <= boundedStart) return null;
      return {
        start: boundedStart,
        end: boundedPauseEnd,
        reason: pause?.reason ?? pause?.motivo ?? null,
        worker: formatWorkerName(pause?.worker ?? pause?.worker_name ?? null),
        rawStart: pauseStart,
        rawEnd: pauseEnd,
      };
    })
    .filter(Boolean);
  const mergedPauses = normalizeIntervals(
    pauseSegments.map((interval) => ({ start: interval.start, end: interval.end }))
  );
  const activeIntervals = [];
  let cursor = start;
  mergedPauses.forEach((pause) => {
    if (pause.start > cursor) {
      activeIntervals.push({ start: cursor, end: pause.start });
    }
    cursor = pause.end > cursor ? pause.end : cursor;
  });
  if (cursor < boundedEnd) {
    activeIntervals.push({ start: cursor, end: boundedEnd });
  }
  return {
    start,
    end: boundedEnd,
    pauses: pauseSegments,
    active: activeIntervals,
  };
};

const mergeIntervals = (intervals) => {
  if (!intervals.length) return [];
  const sorted = intervals.slice().sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = current.end > last.end ? current.end : last.end;
    } else {
      merged.push(current);
    }
  }
  return merged;
};

const sumIntervalsSeconds = (intervals) =>
  intervals.reduce((acc, interval) => {
    if (!interval?.start || !interval?.end) return acc;
    const span = (interval.end - interval.start) / 1000;
    if (!Number.isFinite(span) || span <= 0) return acc;
    return acc + span;
  }, 0);

const subtractInterval = (intervals, cut) => {
  if (!cut?.start || !cut?.end || cut.end <= cut.start) return intervals.slice();
  return intervals.flatMap((interval) => {
    if (!interval?.start || !interval?.end || interval.end <= interval.start) return [];
    if (interval.end <= cut.start || interval.start >= cut.end) return [interval];
    const output = [];
    if (interval.start < cut.start) {
      output.push({ start: interval.start, end: cut.start });
    }
    if (interval.end > cut.end) {
      output.push({ start: cut.end, end: interval.end });
    }
    return output;
  });
};

const buildIdleGaps = (intervals, windowStart, windowEnd) => {
  if (!windowStart || !windowEnd || windowEnd <= windowStart) return [];
  if (!intervals.length) return [{ start: windowStart, end: windowEnd }];
  const merged = mergeIntervals(intervals);
  const gaps = [];
  let cursor = windowStart;
  merged.forEach((interval) => {
    if (interval.start > cursor) {
      gaps.push({ start: cursor, end: interval.start });
    }
    cursor = interval.end > cursor ? interval.end : cursor;
  });
  if (cursor < windowEnd) {
    gaps.push({ start: cursor, end: windowEnd });
  }
  return gaps;
};

const buildLunchBreak = (baseDate, windowStart, windowEnd) => {
  if (!baseDate) return null;
  const start = new Date(baseDate);
  start.setHours(Math.floor(LUNCH_START_MINUTES / 60), LUNCH_START_MINUTES % 60, 0, 0);
  const end = new Date(baseDate);
  end.setHours(Math.floor(LUNCH_END_MINUTES / 60), LUNCH_END_MINUTES % 60, 0, 0);
  if (windowStart && end <= windowStart) return null;
  if (windowEnd && start >= windowEnd) return null;
  const boundedStart = windowStart && start < windowStart ? windowStart : start;
  const boundedEnd = windowEnd && end > windowEnd ? windowEnd : end;
  if (boundedEnd <= boundedStart) return null;
  return { start: boundedStart, end: boundedEnd };
};

const buildDailyIndicators = (day) => {
  if (!day) return null;
  const dayBounds = buildDayBounds(day);
  if (!dayBounds) return null;
  const { baseDate, dayStart, dayEnd } = dayBounds;
  const entry =
    parseDateTime(day?.attendance?.entry) || parseDateTime(day?.activity?.firstTaskStart);
  const exit =
    parseDateTime(day?.attendance?.exit) || parseDateTime(day?.activity?.lastTaskEnd);
  if (!entry || !exit || exit <= entry) return null;
  const presenceStart = entry < dayStart ? dayStart : entry;
  const presenceEnd = exit > dayEnd ? dayEnd : exit;
  if (!presenceStart || !presenceEnd || presenceEnd <= presenceStart) return null;

  const adjustedStart = new Date(presenceStart.getTime() + 30 * 60 * 1000);
  const adjustedEnd = new Date(presenceEnd.getTime() - 30 * 60 * 1000);
  if (adjustedEnd <= adjustedStart) return null;

  const lunchBreak = buildLunchBreak(baseDate, adjustedStart, adjustedEnd);
  const lunchSeconds = lunchBreak ? (lunchBreak.end - lunchBreak.start) / 1000 : 0;
  const presenceSeconds = Math.max(0, (adjustedEnd - adjustedStart) / 1000);
  const presenceNetSeconds = Math.max(0, presenceSeconds - lunchSeconds);

  const tasks = Array.isArray(day.activity?.tasks) ? day.activity.tasks : [];
  const activeIntervals = [];
  let overtimeSeconds = 0;
  let expectedSecondsTotal = 0;

  tasks.forEach((task) => {
    const intervals = buildTaskIntervals(task, adjustedStart, adjustedEnd);
    if (!intervals) return;
    const expectedMinutesValue = Number.isFinite(Number(task.expected_minutes))
      ? Number(task.expected_minutes)
      : null;
    const activeWithoutLunch = lunchBreak
      ? subtractInterval(intervals.active, lunchBreak)
      : intervals.active.slice();
    const activeSeconds = sumIntervalsSeconds(activeWithoutLunch);
    if (activeWithoutLunch.length) {
      activeIntervals.push(...activeWithoutLunch);
      if (expectedMinutesValue != null) {
        const expectedSeconds = expectedMinutesValue * 60;
        expectedSecondsTotal += expectedSeconds;
        overtimeSeconds += Math.max(0, activeSeconds - expectedSeconds);
      }
    }
  });

  const activeUnionSeconds = sumIntervalsSeconds(mergeIntervals(activeIntervals));
  const idleSeconds = Math.max(0, presenceNetSeconds - activeUnionSeconds);
  const idleOverrunSeconds = idleSeconds + overtimeSeconds;
  const productiveSeconds = Math.max(0, presenceNetSeconds - idleOverrunSeconds);

  return {
    presenceSeconds,
    presenceNetSeconds,
    lunchSeconds,
    idleSeconds,
    overtimeSeconds,
    expectedSecondsTotal,
    idleOverrunSeconds,
    productiveSeconds,
    idleOverrunRatio: presenceNetSeconds > 0 ? idleOverrunSeconds / presenceNetSeconds : null,
    productiveRatio: presenceNetSeconds > 0 ? productiveSeconds / presenceNetSeconds : null,
    expectedRatio: presenceNetSeconds > 0 ? expectedSecondsTotal / presenceNetSeconds : null,
  };
};

const buildRangeIndicators = (combinedDays) => {
  const empty = {
    rows: [],
    totals: {
      presenceNetSeconds: 0,
      productiveSeconds: 0,
      expectedSecondsTotal: 0,
      idleOverrunSeconds: 0,
      idleSeconds: 0,
      overtimeSeconds: 0,
    },
    totalProductiveRatio: null,
    totalExpectedRatio: null,
    startDate: '',
    endDate: '',
    daysWithData: 0,
    daysTotal: combinedDays.length,
  };
  if (!combinedDays.length) return empty;

  const entries = combinedDays
    .map((day) => ({ day, dateObj: parseDateOnly(day.date) }))
    .filter((item) => item.dateObj)
    .sort((a, b) => a.dateObj - b.dateObj);
  if (!entries.length) return empty;

  const totals = { ...empty.totals };
  const rows = [];

  entries.forEach(({ day, dateObj }) => {
    const indicators = buildDailyIndicators(day);
    if (!indicators || !Number.isFinite(indicators.productiveRatio)) return;
    rows.push({
      key: day.date,
      label: dateObj.getDate(),
      dateObj,
      productiveRatio: indicators.productiveRatio,
      expectedRatio: indicators.expectedRatio,
      indicators,
    });
    totals.presenceNetSeconds += indicators.presenceNetSeconds || 0;
    totals.productiveSeconds += indicators.productiveSeconds || 0;
    totals.expectedSecondsTotal += indicators.expectedSecondsTotal || 0;
    totals.idleOverrunSeconds += indicators.idleOverrunSeconds || 0;
    totals.idleSeconds += indicators.idleSeconds || 0;
    totals.overtimeSeconds += indicators.overtimeSeconds || 0;
  });

  if (!rows.length) return empty;

  const totalProductiveRatio =
    totals.presenceNetSeconds > 0 ? totals.productiveSeconds / totals.presenceNetSeconds : null;
  const totalExpectedRatio =
    totals.presenceNetSeconds > 0
      ? totals.expectedSecondsTotal / totals.presenceNetSeconds
      : null;

  return {
    rows,
    totals,
    totalProductiveRatio,
    totalExpectedRatio,
    startDate: rows[0].key,
    endDate: rows[rows.length - 1].key,
    daysWithData: rows.length,
    daysTotal: combinedDays.length,
  };
};

const buildMonthlyDataset = (combinedDays, anchorDate) => {
  const empty = {
    data: [],
    range: { startMinutes: 8 * 60, endMinutes: 18 * 60 },
    meta: { monthLabel: '', totalOvertimeMinutes: 0, endDayLabel: '' },
  };
  if (!combinedDays.length) return empty;

  const entries = combinedDays
    .map((day) => ({ day, dateObj: parseDateOnly(day.date) }))
    .filter((item) => item.dateObj);
  if (!entries.length) return empty;

  const anchor = parseDateOnly(anchorDate) || entries[0].dateObj;
  const reference = anchor || entries[0].dateObj;
  const month = reference.getMonth();
  const year = reference.getFullYear();

  const monthEntries = entries.filter(
    (item) => item.dateObj.getMonth() === month && item.dateObj.getFullYear() === year
  );
  if (!monthEntries.length) return empty;

  const anchorFloor = anchor
    ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
    : null;
  let filteredEntries = anchorFloor
    ? monthEntries.filter((item) => item.dateObj <= anchorFloor)
    : monthEntries.slice();
  if (!filteredEntries.length) {
    filteredEntries = monthEntries.slice();
  }
  filteredEntries.sort((a, b) => a.dateObj - b.dateObj);

  let cumulative = 0;
  const data = filteredEntries
    .map(({ day, dateObj }) => {
      const attendanceEntry = day.attendance?.entry || null;
      const attendanceExit = day.attendance?.exit || null;
      const activityEntry = day.activity?.firstTaskStart || null;
      const activityExit = day.activity?.lastTaskEnd || null;
      const entry = attendanceEntry || activityEntry;
      const exit = attendanceExit || activityExit;
      if (!entry || !exit || exit <= entry) return null;
      const entryMinutes = minutesOf(entry);
      const exitMinutes = minutesOf(exit);
      const overtimeMinutes =
        exitMinutes > REGULAR_END_MINUTES ? exitMinutes - REGULAR_END_MINUTES : 0;
      cumulative += overtimeMinutes;
      return {
        key: day.date,
        label: dateObj.getDate(),
        entry,
        exit,
        entryMinutes,
        exitMinutes,
        overtimeMinutes,
        cumulativeOvertimeMinutes: cumulative,
        isEstimated: !attendanceEntry || !attendanceExit,
      };
    })
    .filter(Boolean);

  if (!data.length) return empty;

  const entryValues = data.map((item) => item.entryMinutes);
  const exitValues = data.map((item) => item.exitMinutes);
  const minMinutes = Math.min(...entryValues);
  const maxMinutes = Math.max(...exitValues);
  const startMinutes = Math.max(0, Math.min(minMinutes, 7 * 60) - 30);
  const endMinutes = Math.min(24 * 60, Math.max(maxMinutes, REGULAR_END_MINUTES) + 60);

  return {
    data,
    range: { startMinutes, endMinutes },
    meta: {
      monthLabel: `${MONTH_NAMES[month]} ${year}`,
      totalOvertimeMinutes: cumulative,
      endDayLabel: data[data.length - 1]?.label ?? '',
    },
  };
};

const buildGridTicks = (windowStart, windowEnd) => {
  if (!windowStart || !windowEnd || windowEnd <= windowStart) {
    return { majors: [], minors: [] };
  }
  const majors = [];
  const minors = [];
  const cursor = new Date(windowStart);
  cursor.setMinutes(0, 0, 0);
  if (cursor < windowStart) {
    cursor.setHours(cursor.getHours() + 1);
  }
  while (cursor <= windowEnd) {
    majors.push(new Date(cursor));
    const half = new Date(cursor);
    half.setMinutes(30, 0, 0);
    if (half > windowStart && half < windowEnd) {
      minors.push(half);
    }
    cursor.setHours(cursor.getHours() + 1);
  }
  return { majors, minors };
};

const computeExpectedOverlays = (activeIntervals, expectedSeconds) => {
  if (!expectedSeconds || expectedSeconds <= 0 || !activeIntervals.length) {
    return { overrun: [], saved: [] };
  }
  const totalActive = activeIntervals.reduce(
    (acc, interval) => acc + (interval.end - interval.start) / 1000,
    0
  );
  if (totalActive < expectedSeconds) {
    const lastEnd = activeIntervals[activeIntervals.length - 1].end;
    const savedEnd = new Date(lastEnd.getTime() + (expectedSeconds - totalActive) * 1000);
    return { overrun: [], saved: [{ start: lastEnd, end: savedEnd }] };
  }
  if (totalActive === expectedSeconds) {
    return { overrun: [], saved: [] };
  }

  let remaining = expectedSeconds;
  let threshold = null;
  for (const interval of activeIntervals) {
    const duration = (interval.end - interval.start) / 1000;
    if (duration >= remaining) {
      threshold = new Date(interval.start.getTime() + remaining * 1000);
      break;
    }
    remaining -= duration;
  }
  if (!threshold) return { overrun: [], saved: [] };

  const overrun = [];
  activeIntervals.forEach((interval) => {
    if (interval.end <= threshold) return;
    const start = interval.start < threshold ? threshold : interval.start;
    if (interval.end > start) {
      overrun.push({ start, end: interval.end });
    }
  });
  return { overrun, saved: [] };
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

const MonthlyAssistanceChart = ({ combinedDays, anchorDate }) => {
  const { ref, width } = useContainerWidth();
  const dataset = useMemo(
    () => buildMonthlyDataset(combinedDays, anchorDate),
    [combinedDays, anchorDate]
  );
  const { data, range, meta } = dataset;

  if (!data.length) {
    return (
      <p className="mt-4 text-sm text-[var(--ink-muted)]">
        No hay marcajes con entrada y salida registrados para este mes.
      </p>
    );
  }

  const chartWidth = Math.max(360, width || 900);
  const chartHeight = 200;
  const topPad = 24;
  const bottomPad = 56;
  const leftPad = 50;
  const rightPad = 36;
  const innerWidth = Math.max(1, chartWidth - leftPad - rightPad);
  const axisY = topPad + chartHeight;
  const rangeSpan = Math.max(1, range.endMinutes - range.startMinutes);
  const step = innerWidth / data.length;
  const barWidth = Math.min(36, Math.max(10, step * 0.6));
  const centerX = (index) => leftPad + step * index + step / 2;
  const timeToY = (minutes) =>
    topPad + ((range.endMinutes - minutes) / rangeSpan) * chartHeight;

  const startHour = Math.ceil(range.startMinutes / 60);
  const endHour = Math.floor(range.endMinutes / 60);
  const hourTicks = [];
  for (let hour = startHour; hour <= endHour; hour += 1) {
    hourTicks.push(hour);
  }

  return (
    <div className="mt-4">
      {meta.monthLabel && (
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
          {meta.monthLabel}
        </p>
      )}
      <div ref={ref} className="w-full">
        <svg width={chartWidth} height={topPad + chartHeight + bottomPad} role="img">
          <rect
            x={leftPad}
            y={topPad}
            width={innerWidth}
            height={chartHeight}
            fill="#f8fafc"
          />
          <line x1={leftPad} y1={axisY} x2={chartWidth - rightPad} y2={axisY} stroke="#e5e7eb" />
          <line x1={leftPad} y1={topPad} x2={leftPad} y2={axisY} stroke="#e5e7eb" />
          {hourTicks.map((hour) => {
            const y = timeToY(hour * 60);
            return (
              <g key={`hr-${hour}`}>
                <line
                  x1={leftPad}
                  y1={y}
                  x2={chartWidth - rightPad}
                  y2={y}
                  stroke="#eef2f7"
                />
                <text x={leftPad - 6} y={y + 4} textAnchor="end" fontSize={11} fill="#64748b">
                  {`${String(hour).padStart(2, '0')}:00`}
                </text>
              </g>
            );
          })}
          {REGULAR_END_MINUTES >= range.startMinutes && REGULAR_END_MINUTES <= range.endMinutes && (
            <g>
              <line
                x1={leftPad}
                y1={timeToY(REGULAR_END_MINUTES)}
                x2={chartWidth - rightPad}
                y2={timeToY(REGULAR_END_MINUTES)}
                stroke="#f97316"
                strokeDasharray="4 4"
              />
              <text
                x={chartWidth - rightPad + 4}
                y={timeToY(REGULAR_END_MINUTES) + 4}
                fontSize={11}
                fill="#f97316"
              >
                17:30 limite
              </text>
            </g>
          )}
          {data.map((item, idx) => {
            const xCenter = centerX(idx);
            const x = xCenter - barWidth / 2;
            const entryY = timeToY(item.entryMinutes);
            const exitY = timeToY(item.exitMinutes);
            const regularStop = Math.min(item.exitMinutes, REGULAR_END_MINUTES);
            const regularStopY = timeToY(regularStop);
            const regularHeight = Math.max(0, entryY - regularStopY);
            const overtimeStart = Math.max(REGULAR_END_MINUTES, item.entryMinutes);
            const overtimeStartY = timeToY(overtimeStart);
            const overtimeHeight =
              item.exitMinutes > overtimeStart ? Math.max(0, overtimeStartY - exitY) : 0;
            const opacity = item.isEstimated ? 0.55 : 0.85;
            const tooltip = `${item.key}: ${formatTime(item.entry)} → ${formatTime(item.exit)}${
              item.isEstimated ? ' (est.)' : ''
            }`;
            return (
              <g key={item.key}>
                <title>{tooltip}</title>
                {regularHeight > 0 && (
                  <rect
                    x={x}
                    y={regularStopY}
                    width={barWidth}
                    height={regularHeight}
                    fill="#3b82f6"
                    opacity={opacity}
                    stroke={item.isEstimated ? '#475569' : 'none'}
                    strokeDasharray={item.isEstimated ? '4 3' : undefined}
                  />
                )}
                {overtimeHeight > 0 && (
                  <rect
                    x={x}
                    y={exitY}
                    width={barWidth}
                    height={overtimeHeight}
                    fill="#ef4444"
                    opacity={opacity}
                    stroke={item.isEstimated ? '#475569' : 'none'}
                    strokeDasharray={item.isEstimated ? '4 3' : undefined}
                  />
                )}
                <circle cx={xCenter} cy={entryY} r={3} fill="#1d4ed8" />
                <circle cx={xCenter} cy={exitY} r={3} fill="#0f172a" />
                <text x={xCenter} y={axisY + 16} textAnchor="middle" fontSize={11} fill="#334155">
                  {item.label}
                </text>
                {item.overtimeMinutes > 0 && (
                  <text
                    x={xCenter}
                    y={overtimeStartY - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#ef4444"
                  >
                    +{Math.round(item.overtimeMinutes)}m
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 text-xs text-[var(--ink-muted)]">
        Horas extra acumuladas: {formatMinutesDetailed(meta.totalOvertimeMinutes)}
        {meta.endDayLabel ? ` · Hasta el dia ${meta.endDayLabel}` : ''}
      </div>
    </div>
  );
};

const RangeIndicatorsChart = ({ combinedDays }) => {
  const { ref, width } = useContainerWidth();
  const dataset = useMemo(() => buildRangeIndicators(combinedDays), [combinedDays]);
  const {
    rows,
    totals,
    totalProductiveRatio,
    totalExpectedRatio,
    startDate,
    endDate,
    daysWithData,
    daysTotal,
  } = dataset;

  if (!rows.length) {
    return (
      <p className="mt-4 text-sm text-[var(--ink-muted)]">
        No hay suficientes dias con presencia para calcular indicadores en este rango.
      </p>
    );
  }

  const chartWidth = Math.max(360, width || 900);
  const chartHeight = 160;
  const topPad = 18;
  const bottomPad = 40;
  const leftPad = 48;
  const rightPad = 16;
  const innerWidth = Math.max(1, chartWidth - leftPad - rightPad);
  const axisY = topPad + chartHeight;
  const step = rows.length > 1 ? innerWidth / (rows.length - 1) : 0;
  const clampRatio = (value) => Math.max(0, Math.min(1, value ?? 0));
  const xAt = (idx) => (rows.length > 1 ? leftPad + step * idx : leftPad + innerWidth / 2);
  const yAt = (ratio) => topPad + (1 - clampRatio(ratio)) * chartHeight;

  const buildPath = (key) => {
    let path = '';
    rows.forEach((row, idx) => {
      const ratio = row[key];
      if (!Number.isFinite(ratio)) return;
      const x = xAt(idx);
      const y = yAt(ratio);
      path += path ? ` L ${x} ${y}` : `M ${x} ${y}`;
    });
    return path;
  };

  const productivePath = buildPath('productiveRatio');
  const expectedPath = buildPath('expectedRatio');
  const labelStep = rows.length > 10 ? Math.ceil(rows.length / 8) : 1;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
        <span>{startDate && endDate ? `Rango ${startDate} → ${endDate}` : 'Rango'}</span>
        <span>
          {daysWithData} de {daysTotal} dias con datos
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div
          className="rounded-xl border border-black/5 bg-white/80 px-4 py-3"
          title="(Presencia sin colacion - (ocioso + extra)) / presencia sin colacion"
        >
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Tiempo productivo (rango)
          </p>
          <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
            {formatPercent(totalProductiveRatio)}
          </p>
          <p className="text-xs text-[var(--ink-muted)]">
            Improductivo: {formatSeconds(totals.idleOverrunSeconds)} · Ocioso:{' '}
            {formatSeconds(totals.idleSeconds)} · Extra: {formatSeconds(totals.overtimeSeconds)}
          </p>
          <p className="text-xs text-[var(--ink-muted)]">
            Sobre {formatSeconds(totals.presenceNetSeconds)} sin colacion
          </p>
        </div>
        <div
          className="rounded-xl border border-black/5 bg-white/80 px-4 py-3"
          title="Suma de tiempos esperados / presencia sin colacion"
        >
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Cobertura esperada (rango)
          </p>
          <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
            {formatPercent(totalExpectedRatio)}
          </p>
          <p className="text-xs text-[var(--ink-muted)]">
            Esperado: {formatSeconds(totals.expectedSecondsTotal)}
          </p>
          <p className="text-xs text-[var(--ink-muted)]">
            Sobre {formatSeconds(totals.presenceNetSeconds)} sin colacion
          </p>
        </div>
      </div>
      <div ref={ref} className="w-full">
        <svg width={chartWidth} height={topPad + chartHeight + bottomPad} role="img">
          <rect x={leftPad} y={topPad} width={innerWidth} height={chartHeight} fill="#f8fafc" />
          {[0, 0.5, 1].map((tick) => {
            const y = yAt(tick);
            return (
              <g key={`tick-${tick}`}>
                <line
                  x1={leftPad}
                  y1={y}
                  x2={chartWidth - rightPad}
                  y2={y}
                  stroke={tick === 0 || tick === 1 ? '#e5e7eb' : '#eef2f7'}
                />
                <text x={leftPad - 6} y={y + 4} textAnchor="end" fontSize={11} fill="#64748b">
                  {Math.round(tick * 100)}%
                </text>
              </g>
            );
          })}
          {productivePath && (
            <path d={productivePath} fill="none" stroke="#16a34a" strokeWidth={2} />
          )}
          {expectedPath && (
            <path d={expectedPath} fill="none" stroke="#2563eb" strokeWidth={2} />
          )}
          {rows.map((row, idx) => {
            const productY = yAt(row.productiveRatio);
            const expectedY = yAt(row.expectedRatio);
            const x = xAt(idx);
            const tooltip = `${row.key}: ${formatPercent(row.productiveRatio)} productivo · ${formatPercent(
              row.expectedRatio
            )} cobertura`;
            return (
              <g key={row.key}>
                <title>{tooltip}</title>
                <circle cx={x} cy={productY} r={3} fill="#16a34a" />
                <circle cx={x} cy={expectedY} r={3} fill="#2563eb" />
                {idx % labelStep === 0 && (
                  <text
                    x={x}
                    y={axisY + 16}
                    textAnchor="middle"
                    fontSize={11}
                    fill="#334155"
                  >
                    {row.label}
                  </text>
                )}
              </g>
            );
          })}
          <line
            x1={leftPad}
            y1={axisY}
            x2={chartWidth - rightPad}
            y2={axisY}
            stroke="#e5e7eb"
          />
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--ink-muted)]">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-4 rounded-sm bg-[#16a34a]" />
          Tiempo productivo
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-4 rounded-sm bg-[#2563eb]" />
          Cobertura esperada
        </span>
      </div>
    </div>
  );
};

const TaskTimeline = ({ day }) => {
  const { ref, width } = useContainerWidth();
  const [tooltip, setTooltip] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  useEffect(() => {
    setTooltip(null);
  }, [day]);
  const timeline = useMemo(() => {
    if (!day) return null;
    const dayBounds = buildDayBounds(day);
    if (!dayBounds) return null;
    const { baseDate, dayStart, dayEnd, defaultStart, defaultEnd } = dayBounds;
    const tasksRaw = Array.isArray(day.activity?.tasks) ? day.activity.tasks : [];
    const taskRows = tasksRaw
      .map((task, index) => {
        const intervals = buildTaskIntervals(task, dayStart, dayEnd);
        if (!intervals) return null;
        const expectedMinutes = Number.isFinite(Number(task.expected_minutes))
          ? Number(task.expected_minutes)
          : null;
        const overlays = computeExpectedOverlays(
          intervals.active,
          expectedMinutes != null ? expectedMinutes * 60 : null
        );
        return {
          id: task.task_instance_id || index,
          label: taskDisplayLabel(task),
          context: taskContextLabel(task),
          active: intervals.active,
          pauses: intervals.pauses,
          overlays,
          expectedMinutes,
          raw: task,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aStart = a.active[0]?.start?.getTime() || 0;
        const bStart = b.active[0]?.start?.getTime() || 0;
        return aStart - bStart;
      });

    const allActive = taskRows.flatMap((row) => row.active);
    const minStart = allActive.length
      ? new Date(Math.min(...allActive.map((interval) => interval.start.getTime())))
      : null;
    const maxEnd = allActive.length
      ? new Date(Math.max(...allActive.map((interval) => interval.end.getTime())))
      : null;

    const startCandidates = [
      day.attendance?.entry,
      day.activity?.firstTaskStart,
      minStart,
      defaultStart,
    ]
      .map((value) => parseDateTime(value))
      .filter(Boolean);
    let windowStart = startCandidates.length
      ? new Date(Math.min(...startCandidates.map((value) => value.getTime())))
      : defaultStart;
    if (windowStart < dayStart) {
      windowStart = dayStart;
    }

    const endCandidates = [day.attendance?.exit, day.activity?.lastTaskEnd, maxEnd, defaultEnd]
      .map((value) => parseDateTime(value))
      .filter(Boolean);
    let windowEnd = endCandidates.length
      ? new Date(Math.max(...endCandidates.map((value) => value.getTime())))
      : dayEnd;

    if (maxEnd && maxEnd > windowEnd) {
      windowEnd = maxEnd;
    }

    taskRows.forEach((row) => {
      row.overlays.saved.forEach((interval) => {
        if (interval.end > windowEnd) {
          windowEnd = interval.end;
        }
      });
    });

    if (dayEnd && windowEnd > dayEnd) {
      windowEnd = dayEnd;
    }

    if (!windowStart || !windowEnd || windowEnd <= windowStart) {
      windowStart = defaultStart < dayEnd ? defaultStart : dayStart;
      windowEnd = dayEnd;
    }

    if (!windowStart || !windowEnd || windowEnd <= windowStart) {
      return null;
    }

    const grid = buildGridTicks(windowStart, windowEnd);
    const lunchBreak = buildLunchBreak(baseDate, windowStart, windowEnd);
    const idleGaps = buildIdleGaps(
      lunchBreak ? [...allActive, lunchBreak] : allActive,
      windowStart,
      windowEnd
    );

    return {
      tasks: taskRows,
      windowStart,
      windowEnd,
      grid,
      lunchBreak,
      idleGaps,
    };
  }, [day]);

  const showTooltip = (payload) => (event) => {
    setTooltip(payload);
    setTooltipPosition({ x: event.clientX, y: event.clientY });
  };

  const moveTooltip = (event) => {
    setTooltipPosition({ x: event.clientX, y: event.clientY });
  };

  const hideTooltip = () => {
    setTooltip(null);
  };

  if (!timeline || !timeline.tasks.length) {
    return (
      <p className="mt-4 text-sm text-[var(--ink-muted)]">
        No se registraron tareas en este dia.
      </p>
    );
  }

  const chartWidth = Math.max(360, width || 900);
  const rowHeight = 16;
  const rowGap = 10;
  const padLeft = 230;
  const padRight = 24;
  const padTop = 18;
  const padBottom = 24;
  const innerWidth = Math.max(1, chartWidth - padLeft - padRight);
  const spanMs = Math.max(1, timeline.windowEnd - timeline.windowStart);
  const xAt = (date) =>
    padLeft + Math.max(0, Math.min(innerWidth, ((date - timeline.windowStart) / spanMs) * innerWidth));
  const svgHeight =
    padTop + padBottom + timeline.tasks.length * (rowHeight + rowGap);
  const axisY = svgHeight - padBottom;
  const rowY = (index) => padTop + index * (rowHeight + rowGap);
  const tooltipLabelMap = {
    active: 'Trabajo activo',
    pause: 'Pausa',
    overrun: 'Minutos extra',
    saved: 'Minutos ahorrados',
    idle: 'Tiempo ocioso',
    lunch: 'Colación',
  };
  const tooltipDurationSeconds =
    tooltip?.start && tooltip?.end ? Math.max(0, Math.round((tooltip.end - tooltip.start) / 1000)) : null;
  const tooltipTitle =
    tooltip?.title || tooltip?.taskName || tooltipLabelMap[tooltip?.type] || 'Detalle';

  return (
    <div className="mt-4">
      <div ref={ref} className="w-full">
        <svg width={chartWidth} height={svgHeight} role="img">
          <rect x={0} y={0} width={padLeft - 1} height={svgHeight} fill="#f8fafc" />
          <line x1={padLeft - 0.5} y1={0} x2={padLeft - 0.5} y2={svgHeight} stroke="#e2e8f0" />
          <line x1={padLeft} y1={padTop} x2={padLeft} y2={axisY} stroke="#e2e8f0" />
          <line x1={padLeft} y1={axisY} x2={chartWidth - padRight} y2={axisY} stroke="#e2e8f0" />

          {timeline.lunchBreak && (
            <g>
              <rect
                x={xAt(timeline.lunchBreak.start)}
                y={padTop}
                width={Math.max(1, xAt(timeline.lunchBreak.end) - xAt(timeline.lunchBreak.start))}
                height={axisY - padTop}
                fill="#fde68a"
                opacity={0.3}
                onMouseEnter={showTooltip({
                  type: 'lunch',
                  title: 'Colación',
                  start: timeline.lunchBreak.start,
                  end: timeline.lunchBreak.end,
                })}
                onMouseMove={moveTooltip}
                onMouseLeave={hideTooltip}
              />
              <text
                x={
                  xAt(timeline.lunchBreak.start) +
                  (xAt(timeline.lunchBreak.end) - xAt(timeline.lunchBreak.start)) / 2
                }
                y={padTop + 12}
                textAnchor="middle"
                fontSize={11}
                fill="#92400e"
              >
                Colación
              </text>
            </g>
          )}

          {timeline.idleGaps.map((gap, idx) => {
            const x1 = xAt(gap.start);
            const x2 = xAt(gap.end);
            const widthGap = Math.max(0, x2 - x1);
            const durationSeconds = Math.max(0, Math.floor((gap.end - gap.start) / 1000));
            const label = formatSeconds(durationSeconds);
            return (
              <g key={`gap-${idx}`}>
                <rect
                  x={x1}
                  y={padTop}
                  width={widthGap}
                  height={axisY - padTop}
                  fill="#94a3b8"
                  opacity={0.15}
                  onMouseEnter={showTooltip({
                    type: 'idle',
                    title: 'Tiempo ocioso',
                    start: gap.start,
                    end: gap.end,
                  })}
                  onMouseMove={moveTooltip}
                  onMouseLeave={hideTooltip}
                />
                {widthGap > 30 && (
                  <text
                    x={x1 + widthGap / 2}
                    y={padTop + 12}
                    textAnchor="middle"
                    fontSize={11}
                    fill="#64748b"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}

          {timeline.grid.minors.map((tick, idx) => (
            <line
              key={`minor-${idx}`}
              x1={xAt(tick)}
              y1={padTop}
              x2={xAt(tick)}
              y2={axisY}
              stroke="#f1f5f9"
            />
          ))}
          {timeline.grid.majors.map((tick, idx) => (
            <line
              key={`major-${idx}`}
              x1={xAt(tick)}
              y1={padTop}
              x2={xAt(tick)}
              y2={axisY}
              stroke="#e2e8f0"
            />
          ))}
          {timeline.grid.majors.map((tick, idx) => (
            <text
              key={`label-${idx}`}
              x={xAt(tick)}
              y={axisY + 14}
              textAnchor="middle"
              fontSize={11}
              fill="#64748b"
            >
              {formatTime(tick)}
            </text>
          ))}

          {timeline.tasks.map((task, idx) => {
            const y = rowY(idx);
            const fullLabel = taskFullLabel(task.raw);
            const basePayload = {
              title: fullLabel,
              context: task.context,
              stationName: task.raw?.station_name,
              taskName: task.raw?.task_definition_name,
              expectedMinutes: task.expectedMinutes,
            };
            return (
              <g key={task.id}>
                <text
                  x={12}
                  y={y + rowHeight - 4}
                  fontSize={12}
                  fill="#0f172a"
                  onMouseEnter={showTooltip({ ...basePayload, type: 'label' })}
                  onMouseMove={moveTooltip}
                  onMouseLeave={hideTooltip}
                  style={{ cursor: 'help' }}
                >
                  {task.label}
                  <title>{fullLabel}</title>
                </text>
                {task.active.map((interval, j) => {
                  const x1 = xAt(interval.start);
                  const x2 = xAt(interval.end);
                  return (
                    <rect
                      key={`active-${task.id}-${j}`}
                      x={x1}
                      y={y}
                      width={Math.max(1, x2 - x1)}
                      height={rowHeight}
                      fill="#3b82f6"
                      opacity={0.85}
                      onMouseEnter={showTooltip({
                        ...basePayload,
                        type: 'active',
                        start: interval.start,
                        end: interval.end,
                      })}
                      onMouseMove={moveTooltip}
                      onMouseLeave={hideTooltip}
                    />
                  );
                })}
                {task.pauses.map((interval, j) => {
                  const x1 = xAt(interval.start);
                  const x2 = xAt(interval.end);
                  const pauseWidth = Math.max(1, x2 - x1);
                  return (
                    <rect
                      key={`pause-${task.id}-${j}`}
                      x={x1}
                      y={y}
                      width={pauseWidth}
                      height={rowHeight}
                      fill="#f59e0b"
                      opacity={0.7}
                      onMouseEnter={showTooltip({
                        ...basePayload,
                        type: 'pause',
                        start: interval.start,
                        end: interval.end,
                        pauseReason: interval.reason,
                        pauseWorker: interval.worker,
                      })}
                      onMouseMove={moveTooltip}
                      onMouseLeave={hideTooltip}
                    />
                  );
                })}
                {task.overlays.overrun.map((interval, j) => {
                  const x1 = xAt(interval.start);
                  const x2 = xAt(interval.end);
                  return (
                    <rect
                      key={`over-${task.id}-${j}`}
                      x={x1}
                      y={y}
                      width={Math.max(1, x2 - x1)}
                      height={rowHeight}
                      fill="#ef4444"
                      opacity={0.5}
                      onMouseEnter={showTooltip({
                        ...basePayload,
                        type: 'overrun',
                        start: interval.start,
                        end: interval.end,
                      })}
                      onMouseMove={moveTooltip}
                      onMouseLeave={hideTooltip}
                    />
                  );
                })}
                {task.overlays.saved.map((interval, j) => {
                  const x1 = xAt(interval.start);
                  const x2 = xAt(interval.end);
                  return (
                    <rect
                      key={`saved-${task.id}-${j}`}
                      x={x1}
                      y={y}
                      width={Math.max(1, x2 - x1)}
                      height={rowHeight}
                      fill="#22c55e"
                      opacity={0.35}
                      onMouseEnter={showTooltip({
                        ...basePayload,
                        type: 'saved',
                        start: interval.start,
                        end: interval.end,
                      })}
                      onMouseMove={moveTooltip}
                      onMouseLeave={hideTooltip}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            top: Math.max(tooltipPosition.y - 12, 24),
            left: tooltipPosition.x,
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 6,
            boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
            padding: 12,
            width: 260,
            maxWidth: '90vw',
            zIndex: 30,
            pointerEvents: 'none',
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            {tooltipLabelMap[tooltip.type] || 'Detalle'}
          </div>
          <div className="mt-1 text-sm font-semibold text-[var(--ink)]">{tooltipTitle}</div>
          {tooltip.context && (
            <div className="mt-1 text-xs text-[var(--ink)]">Contexto: {tooltip.context}</div>
          )}
          {tooltip.stationName && (
            <div className="text-xs text-[var(--ink)]">Estación: {tooltip.stationName}</div>
          )}
          {tooltip.start && tooltip.end && (
            <div className="mt-1 text-xs text-[var(--ink)]">
              {formatTime(tooltip.start)} → {formatTime(tooltip.end)}
            </div>
          )}
          <div className="text-xs text-[var(--ink)]">
            Duración: {formatSeconds(tooltipDurationSeconds)}
          </div>
          {tooltip.type === 'pause' && (tooltip.pauseReason || tooltip.pauseWorker) && (
            <div className="text-xs text-[var(--ink)]">
              {tooltip.pauseWorker ? `Responsable: ${tooltip.pauseWorker}` : ''}
              {tooltip.pauseWorker && tooltip.pauseReason ? ' · ' : ''}
              {tooltip.pauseReason ? `Motivo: ${tooltip.pauseReason}` : ''}
            </div>
          )}
          {Number.isFinite(tooltip.expectedMinutes) && (
            <div className="text-xs text-[var(--ink)]">
              Esperado: {formatMinutesDetailed(tooltip.expectedMinutes)}
            </div>
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-[var(--ink-muted)]">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-4 rounded-sm bg-[#3b82f6]" />
          Trabajo activo
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-4 rounded-sm bg-[#f59e0b] opacity-70" />
          Pausas
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-4 rounded-sm bg-[#ef4444] opacity-70" />
          Minutos extra
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-4 rounded-sm bg-[#22c55e] opacity-60" />
          Minutos ahorrados
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-4 rounded-sm bg-[#fde68a]" />
          Colación 13:00-13:30
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-4 rounded-sm bg-[#94a3b8] opacity-40" />
          Tiempos ociosos
        </span>
      </div>
    </div>
  );
};

const DashboardAssistance = () => {
  const { setHeader } = useAdminHeader();
  const [stations, setStations] = useState([]);
  const [selectedStationKey, setSelectedStationKey] = useState('');
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
  const [detailTab, setDetailTab] = useState(DETAIL_TABS[0].id);
  const [viewTab, setViewTab] = useState(VIEW_TABS[0].id);

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

  useEffect(() => {
    let active = true;
    apiRequest('/api/stations')
      .then((result) => {
        if (!active) return;
        setStations(Array.isArray(result) ? result : []);
      })
      .catch((err) => {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Error cargando estaciones.';
        setError(message);
      });
    return () => {
      active = false;
    };
  }, []);

  const stationGroups = useMemo(() => {
    const grouped = new Map();
    const unsequenced = [];

    stations.forEach((station) => {
      if (station.sequence_order === null || station.sequence_order === undefined) {
        unsequenced.push({
          key: `station-${station.id}`,
          label: station.name,
          stationIds: [station.id],
          sequence: null,
        });
        return;
      }
      const normalized = normalizeStationName(station);
      const entry = grouped.get(station.sequence_order) || {
        names: new Set(),
        stationIds: new Set(),
      };
      entry.names.add(normalized || station.name);
      entry.stationIds.add(station.id);
      grouped.set(station.sequence_order, entry);
    });

    const sequenced = Array.from(grouped.entries())
      .map(([sequence, entry]) => ({
        key: `seq-${sequence}`,
        label:
          entry.names.size > 0
            ? Array.from(entry.names).join(' / ')
            : `Secuencia ${sequence}`,
        stationIds: Array.from(entry.stationIds),
        sequence,
      }))
      .sort((a, b) => a.sequence - b.sequence);

    const unsequencedSorted = unsequenced.sort((a, b) =>
      String(a.label).localeCompare(String(b.label))
    );

    return [...sequenced, ...unsequencedSorted];
  }, [stations]);

  const selectedStationGroup = useMemo(
    () => stationGroups.find((group) => group.key === selectedStationKey) || null,
    [selectedStationKey, stationGroups]
  );

  const filteredWorkers = useMemo(() => {
    if (!selectedStationGroup) return [];
    const allowed = new Set(selectedStationGroup.stationIds);
    return workers.filter((worker) =>
      Array.isArray(worker.assigned_station_ids)
        ? worker.assigned_station_ids.some((id) => allowed.has(id))
        : false
    );
  }, [selectedStationGroup, workers]);

  const selectedWorker = useMemo(
    () => filteredWorkers.find((worker) => String(worker.id) === String(selectedWorkerId)),
    [selectedWorkerId, filteredWorkers]
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
      `/api/task-history?worker_id=${worker.id}&from_date=${fromDate}&to_date=${toDate}&limit=2000`
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
    setSelectedWorkerId('');
    setAttendanceResponse(null);
    setActivityRows([]);
    setDayIndex(0);
  }, [selectedStationKey]);

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
  const geovictoriaWarnings = useMemo(
    () => (Array.isArray(attendanceResponse?.warnings) ? attendanceResponse.warnings : []),
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

  const monthLabel = useMemo(() => {
    const anchor =
      parseDateOnly(selectedDay?.date) || parseDateOnly(combinedDays[0]?.date);
    if (!anchor) return '';
    return `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`;
  }, [selectedDay?.date, combinedDays]);

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

  const dailyIndicators = useMemo(
    () => buildDailyIndicators(selectedDay),
    [selectedDay]
  );

  const rangeIndicators = useMemo(
    () => buildRangeIndicators(combinedDays),
    [combinedDays]
  );

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
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-full border border-black/10 bg-white p-1">
              {VIEW_TABS.map((tab) => {
                const isActive = viewTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setViewTab(tab.id)}
                    className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                      isActive ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink)] hover:bg-black/5'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
            {viewTab === 'worker' && (
              <button
                type="button"
                onClick={() => selectedWorker && fetchData(selectedWorker, rangeDays)}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)]"
              >
                <RefreshCcw className="h-4 w-4" />
                Recargar
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {viewTab === 'worker' ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
            <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[220px]">
                  <label className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    Estacion
                  </label>
                  <select
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                    value={selectedStationKey}
                    onChange={(event) => setSelectedStationKey(event.target.value)}
                  >
                    <option value="">Seleccione</option>
                    {stationGroups.map((group) => (
                      <option key={group.key} value={group.key}>
                        {group.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[220px]">
                  <label className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    Trabajador
                  </label>
                  <select
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                    value={selectedWorkerId}
                    onChange={(event) => setSelectedWorkerId(event.target.value)}
                    disabled={!selectedStationKey}
                  >
                    <option value="">
                      {selectedStationKey ? 'Seleccione' : 'Seleccione estacion'}
                    </option>
                    {filteredWorkers.map((worker) => (
                      <option key={worker.id} value={worker.id}>
                        {formatWorkerDisplayName(worker) || `${worker.first_name} ${worker.last_name}`}
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
                  Error en entrega de datos de GeoVictoria.
                  <span className="ml-2 text-xs text-red-500">{attendanceError}</span>
                </div>
              )}
              {!attendanceError && geovictoriaWarnings.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  Error en entrega de datos de GeoVictoria.
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

            {!loading &&
              selectedWorker &&
              !combinedDays.length &&
              !attendanceError &&
              geovictoriaWarnings.length === 0 && (
              <p className="mt-4 text-sm text-[var(--ink-muted)]">
                Sin datos para el rango de busqueda.
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

                <div className="grid gap-4 md:grid-cols-2">
                  <div
                    className="rounded-xl border border-black/5 bg-white/80 px-4 py-3"
                    title="(Presencia sin colacion - (ocioso + extra)) / presencia sin colacion"
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                      Tiempo productivo
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                      {formatPercent(dailyIndicators?.productiveRatio)}
                    </p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      Improductivo: {formatSeconds(dailyIndicators?.idleOverrunSeconds)} · Ocioso:{' '}
                      {formatSeconds(dailyIndicators?.idleSeconds)} · Extra:{' '}
                      {formatSeconds(dailyIndicators?.overtimeSeconds)}
                    </p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      Sobre {formatSeconds(dailyIndicators?.presenceNetSeconds)} sin colacion
                    </p>
                  </div>
                  <div
                    className="rounded-xl border border-black/5 bg-white/80 px-4 py-3"
                    title="Suma de tiempos esperados / presencia sin colacion"
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                      Cobertura esperada
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                      {formatPercent(dailyIndicators?.expectedRatio)}
                    </p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      Esperado: {formatSeconds(dailyIndicators?.expectedSecondsTotal)}
                    </p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      Sobre {formatSeconds(dailyIndicators?.presenceNetSeconds)} sin colacion
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                        {detailTab === 'monthly'
                          ? 'Asistencia mensual'
                          : detailTab === 'range'
                            ? 'Indicadores del rango'
                            : 'Actividad del dia'}
                      </p>
                      <p className="text-sm text-[var(--ink)]">
                        {detailTab === 'monthly'
                          ? monthLabel || selectedDay.date
                          : detailTab === 'range'
                            ? rangeIndicators.startDate && rangeIndicators.endDate
                              ? `${rangeIndicators.startDate} → ${rangeIndicators.endDate}`
                              : selectedDay.date
                            : selectedDay.date}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {detailTab === 'timeline' && (
                        <p className="text-xs text-[var(--ink-muted)]">
                          {selectedDay.activity?.tasks?.length || 0} tareas
                        </p>
                      )}
                      {detailTab === 'range' && (
                        <p className="text-xs text-[var(--ink-muted)]">
                          {rangeIndicators.daysWithData} dias con datos
                        </p>
                      )}
                      <div className="flex rounded-full border border-black/10 bg-white p-1">
                        {DETAIL_TABS.map((tab) => {
                          const isActive = detailTab === tab.id;
                          return (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setDetailTab(tab.id)}
                              className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                                isActive
                                  ? 'bg-[var(--ink)] text-white'
                                  : 'text-[var(--ink)] hover:bg-black/5'
                              }`}
                            >
                              {tab.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {detailTab === 'monthly' ? (
                    <MonthlyAssistanceChart
                      key="monthly"
                      combinedDays={combinedDays}
                      anchorDate={selectedDay.date}
                    />
                  ) : detailTab === 'range' ? (
                    <RangeIndicatorsChart key="range" combinedDays={combinedDays} />
                  ) : (
                    <>
                      <TaskTimeline key="timeline" day={selectedDay} />
                      {selectedDay.activity?.tasks?.length ? (
                        <div className="mt-6 overflow-x-auto">
                          <table className="min-w-full text-left text-xs">
                            <thead className="text-[var(--ink-muted)]">
                              <tr>
                                <th className="pb-2 pr-4 font-semibold uppercase tracking-[0.2em]">
                                  Contexto
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
                                <th className="pb-2 font-semibold uppercase tracking-[0.2em]">
                                  Pausas
                                </th>
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
                                      <td className="py-2 pr-4">{taskContextLabel(task)}</td>
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
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <StationWideAssistanceTab
          stations={stations}
          stationGroups={stationGroups}
          workers={workers}
          apiRequest={apiRequest}
          isoDaysAgo={isoDaysAgo}
          todayIso={todayIso}
          normalizeAttendance={normalizeAttendance}
          buildActivityDays={buildActivityDays}
          buildRangeIndicators={buildRangeIndicators}
          formatWorkerDisplayName={formatWorkerDisplayName}
          formatPercent={formatPercent}
          formatSeconds={formatSeconds}
          toDateOnly={toDateOnly}
          TaskTimeline={TaskTimeline}
        />
      )}
    </div>
  );
};

export default DashboardAssistance;
