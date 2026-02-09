const REGULAR_END_MINUTES = 17 * 60 + 30;
const LUNCH_START_MINUTES = 13 * 60;
const LUNCH_END_MINUTES = 13 * 60 + 30;

const pad = (value) => String(value).padStart(2, '0');

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

const parseDateOnly = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const [year, month, day] = raw.split('-').map((part) => Number(part));
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

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

export { buildDailyIndicators, buildRangeIndicators };
