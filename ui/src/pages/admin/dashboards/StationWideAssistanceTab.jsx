import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { formatMinutesDetailed } from '../../../utils/timeUtils';
import { buildRangeIndicators, isAbsentNoDataDay } from './assistanceIndicators';

const RANGE_OPTIONS = [3, 7, 14];
const LOAD_CONCURRENCY = 3;
const GEO_REQUEST_DELAY_MS = 400;
const defaultFormatSeconds = (seconds) => {
  if (!Number.isFinite(seconds)) return '-';
  return formatMinutesDetailed(seconds / 60);
};

const buildCombinedDays = (attendanceResponse, activityRows, normalizeAttendance, buildActivityDays) => {
  const attendanceDays = normalizeAttendance(attendanceResponse?.attendance) || [];
  const activityDays = buildActivityDays(activityRows) || [];
  const map = new Map();
  attendanceDays.forEach((day) => {
    map.set(day.date, { date: day.date, attendance: day, activity: null });
  });
  activityDays.forEach((day) => {
    const existing = map.get(day.date) || { date: day.date, attendance: null, activity: null };
    map.set(day.date, { ...existing, activity: day });
  });
  return Array.from(map.values())
    .filter((day) => !isAbsentNoDataDay(day))
    .sort((a, b) => b.date.localeCompare(a.date));
};

const runWithLimit = async (items, limit, task) => {
  if (!items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;

  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      try {
        results[current] = await task(items[current], current);
      } catch (err) {
        results[current] = { error: err };
      }
    }
  });

  await Promise.all(runners);
  return results;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createThrottle = (delayMs) => {
  let chain = Promise.resolve();
  let lastStart = 0;
  return () => {
    const task = async () => {
      const now = Date.now();
      const wait = Math.max(0, lastStart + delayMs - now);
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
    };
    chain = chain.then(task, task);
    return chain;
  };
};

const pickLastFullDayRow = (rows, todayKey) => {
  if (!rows || !rows.length) return null;
  const sorted = rows.slice().sort((a, b) => a.key.localeCompare(b.key));
  const previousDay = sorted.slice().reverse().find((row) => row.key < todayKey);
  return previousDay || sorted[sorted.length - 1] || null;
};

const aggregateStationRows = (workerSummaries) => {
  const map = new Map();
  workerSummaries.forEach((summary) => {
    const rows = summary?.rangeIndicators?.rows || [];
    rows.forEach((row) => {
      if (!Number.isFinite(row.productiveRatio) || !Number.isFinite(row.expectedRatio)) return;
      const presenceWeightRaw = Number(row?.indicators?.presenceNetSeconds);
      const presenceWeight =
        Number.isFinite(presenceWeightRaw) && presenceWeightRaw > 0 ? presenceWeightRaw : 0;
      const entry = map.get(row.key) || {
        key: row.key,
        label: row.label,
        dateObj: row.dateObj,
        productiveWeighted: 0,
        expectedWeighted: 0,
        weightTotal: 0,
      };
      if (presenceWeight > 0) {
        entry.productiveWeighted += row.productiveRatio * presenceWeight;
        entry.expectedWeighted += row.expectedRatio * presenceWeight;
        entry.weightTotal += presenceWeight;
      }
      map.set(row.key, entry);
    });
  });

  return Array.from(map.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      dateObj: entry.dateObj,
      productiveRatio: entry.weightTotal ? entry.productiveWeighted / entry.weightTotal : null,
      expectedRatio: entry.weightTotal ? entry.expectedWeighted / entry.weightTotal : null,
    }));
};

const parseFilenameFromDisposition = (dispositionHeader, fallbackName) => {
  const fallback = fallbackName || 'reporte_asistencia_estaciones.pdf';
  if (!dispositionHeader) return fallback;
  const utf8Match = dispositionHeader.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim() || fallback;
    }
  }
  const basicMatch = dispositionHeader.match(/filename=\"?([^\";]+)\"?/i);
  return basicMatch?.[1]?.trim() || fallback;
};

const toFiniteOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const buildPdfPayload = ({
  reportDays,
  fromDate,
  toDate,
  includeWorkers,
  selectedGroupData,
}) => {
  let globalPresence = 0;
  let globalProductive = 0;
  let globalExpected = 0;
  let totalWorkers = 0;

  const stations = selectedGroupData.map((groupData) => {
    const summary = groupData.stationSummary || {};
    const workerSummaries = Array.isArray(groupData.workerSummaries) ? groupData.workerSummaries : [];
    totalWorkers += workerSummaries.length;

    workerSummaries.forEach((summaryItem) => {
      const totals = summaryItem?.rangeIndicators?.totals;
      const presence = Number(totals?.presenceNetSeconds);
      if (!Number.isFinite(presence) || presence <= 0) return;
      globalPresence += presence;
      globalProductive += Number(totals?.productiveSeconds) || 0;
      globalExpected += Number(totals?.expectedSecondsTotal) || 0;
    });

    return {
      key: groupData.group.key,
      label: groupData.group.label,
      workers_total: workerSummaries.length,
      workers_with_data: Number(summary?.workersWithData) || 0,
      average_productive: toFiniteOrNull(summary?.averageProductive),
      average_expected: toFiniteOrNull(summary?.averageExpected),
      rows: Array.isArray(summary?.rows)
        ? summary.rows.map((row) => ({
            key: row.key,
            productive_ratio: toFiniteOrNull(row.productiveRatio),
            expected_ratio: toFiniteOrNull(row.expectedRatio),
          }))
        : [],
      workers: includeWorkers
        ? workerSummaries.map((summaryRow) => {
            const range = summaryRow.rangeIndicators || {};
            return {
              label: summaryRow.workerLabel,
              productive_ratio: toFiniteOrNull(range.totalProductiveRatio),
              expected_ratio: toFiniteOrNull(range.totalExpectedRatio),
              days_with_data: Number(range.daysWithData) || 0,
              days_total: Number(range.daysTotal) || 0,
            };
          })
        : [],
    };
  });

  return {
    report_days: reportDays,
    from_date: fromDate,
    to_date: toDate,
    include_workers: includeWorkers,
    generated_at: new Date().toISOString(),
    global_productive: globalPresence > 0 ? globalProductive / globalPresence : null,
    global_expected: globalPresence > 0 ? globalExpected / globalPresence : null,
    total_workers: totalWorkers,
    stations,
  };
};

const CompactSparkline = ({ rows, width = 140, height = 36, onPointClick }) => {
  const [hovered, setHovered] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  if (!rows || !rows.length) return <div style={{ width, height }} className="bg-slate-50 rounded" />;
  const padX = 4;
  const padY = 4;
  const innerWidth = width - padX * 2;
  const innerHeight = height - padY * 2;
  const step = rows.length > 1 ? innerWidth / (rows.length - 1) : 0;
  const clampRatio = (value) => Math.max(0, Math.min(1, value ?? 0));
  const xAt = (idx) => (rows.length > 1 ? padX + step * idx : padX + innerWidth / 2);
  const yAt = (ratio) => padY + (1 - clampRatio(ratio)) * innerHeight;

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

  const handleMouseEnter = (row, idx, event) => {
    const rect = event.currentTarget.ownerSVGElement.getBoundingClientRect();
    setHovered(row);
    setTooltipPos({ x: rect.left + xAt(idx), y: rect.top });
  };

  const handleMouseLeave = () => setHovered(null);

  const handleClick = (row, event) => {
    event.stopPropagation();
    if (onPointClick) onPointClick(row);
  };

  return (
    <div className="relative inline-block">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img">
        <rect x={padX} y={padY} width={innerWidth} height={innerHeight} fill="#f8fafc" rx={2} />
        <line x1={padX} y1={padY} x2={padX + innerWidth} y2={padY} stroke="#cbd5e1" strokeWidth={0.5} />
        <line x1={padX} y1={padY + innerHeight} x2={padX + innerWidth} y2={padY + innerHeight} stroke="#cbd5e1" strokeWidth={0.5} />
        {productivePath && <path d={productivePath} fill="none" stroke="#16a34a" strokeWidth={1.5} />}
        {expectedPath && <path d={expectedPath} fill="none" stroke="#2563eb" strokeWidth={1.5} />}
        {rows.map((row, idx) => {
          const x = xAt(idx);
          const isHovered = hovered?.key === row.key;
          return (
            <g
              key={row.key}
              onMouseEnter={(e) => handleMouseEnter(row, idx, e)}
              onMouseLeave={handleMouseLeave}
              onClick={(e) => handleClick(row, e)}
              style={{ cursor: onPointClick ? 'pointer' : 'default' }}
            >
              <rect x={x - 6} y={padY} width={12} height={innerHeight} fill="transparent" />
              {Number.isFinite(row.productiveRatio) && (
                <circle cx={x} cy={yAt(row.productiveRatio)} r={isHovered ? 4 : 2} fill="#16a34a" />
              )}
              {Number.isFinite(row.expectedRatio) && (
                <circle cx={x} cy={yAt(row.expectedRatio)} r={isHovered ? 4 : 2} fill="#2563eb" />
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div
          className="fixed z-50 bg-white border border-black/10 rounded-lg shadow-lg px-3 py-2 text-xs pointer-events-none"
          style={{ left: tooltipPos.x, top: tooltipPos.y - 8, transform: 'translate(-50%, -100%)' }}
        >
          <div className="font-medium text-[var(--ink)]">{hovered.key}</div>
          <div className="flex gap-3 mt-1">
            <span className="text-[#16a34a]">
              Prod: {Number.isFinite(hovered.productiveRatio) ? Math.round(hovered.productiveRatio * 100) + '%' : '—'}
            </span>
            <span className="text-[#2563eb]">
              Cob: {Number.isFinite(hovered.expectedRatio) ? Math.round(hovered.expectedRatio * 100) + '%' : '—'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

const formatWorkerLabel = (worker, formatWorkerDisplayName) => {
  const formatted = formatWorkerDisplayName ? formatWorkerDisplayName(worker) : '';
  if (formatted) return formatted;
  const fallback = `${worker?.first_name || ''} ${worker?.last_name || ''}`.trim();
  if (fallback) return fallback;
  if (worker?.name) return worker.name;
  return worker?.id ? `Trabajador ${worker.id}` : 'Trabajador';
};

const normalizeReportWorkerSummaries = (summaries, formatWorkerDisplayName) =>
  (Array.isArray(summaries) ? summaries : [])
    .map((summary) => {
      if (!summary || !summary.worker) return null;
      return {
        ...summary,
        workerLabel: formatWorkerLabel(summary.worker, formatWorkerDisplayName),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.workerLabel.localeCompare(b.workerLabel, 'es'));

const isWorkerInactive = (worker) =>
  String(worker?.status ?? '')
    .trim()
    .toLowerCase() === 'inactive';

const DayDetailModal = ({ day, workerName, onClose, TaskTimeline, formatPercent, formatSeconds }) => {
  if (!day) return null;

  const indicators = day.indicators;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-[95vw] w-full mx-4 max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Detalle del dia</p>
            <h3 className="text-lg font-semibold text-[var(--ink)]">{day.key}{workerName ? ` - ${workerName}` : ''}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-full">
            <X className="h-5 w-5 text-[var(--ink-muted)]" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {indicators && (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div className="rounded-xl border border-black/5 bg-slate-50/50 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Tiempo productivo</p>
                <p className="mt-1 text-xl font-semibold text-[#16a34a]">{formatPercent(indicators.productiveRatio)}</p>
              </div>
              <div className="rounded-xl border border-black/5 bg-slate-50/50 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Cobertura esperada</p>
                <p className="mt-1 text-xl font-semibold text-[#2563eb]">{formatPercent(indicators.expectedRatio)}</p>
              </div>
              <div className="rounded-xl border border-black/5 bg-slate-50/50 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Tiempo ocioso</p>
                <p className="mt-1 text-lg font-semibold text-[var(--ink)]">{formatSeconds(indicators.idleSeconds)}</p>
              </div>
              <div className="rounded-xl border border-black/5 bg-slate-50/50 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Tiempo extra</p>
                <p className="mt-1 text-lg font-semibold text-[var(--ink)]">{formatSeconds(indicators.overtimeSeconds)}</p>
              </div>
            </div>
          )}

          {TaskTimeline && day.combinedDay && (
            <div className="rounded-xl border border-black/5 bg-white p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)] mb-3">Linea de tiempo</p>
              <TaskTimeline day={day.combinedDay} />
            </div>
          )}

          {!TaskTimeline && (
            <p className="text-sm text-[var(--ink-muted)]">
              Componente de linea de tiempo no disponible.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const StationWideAssistanceTab = ({
  stations,
  stationGroups,
  workers,
  apiBaseUrl,
  apiRequest,
  isoDaysAgo,
  todayIso,
  normalizeAttendance,
  buildActivityDays,
  formatWorkerDisplayName,
  formatPercent,
  formatSeconds,
  toDateOnly,
  TaskTimeline,
}) => {
  const [rangeDays, setRangeDays] = useState(RANGE_OPTIONS[0]);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [groupCache, setGroupCache] = useState({});
  const [modalData, setModalData] = useState(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportDays, setReportDays] = useState(RANGE_OPTIONS[0]);
  const [reportIncludeWorkers, setReportIncludeWorkers] = useState(false);
  const [reportSelection, setReportSelection] = useState({});
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportError, setReportError] = useState('');
  const loadTokensRef = useRef(new Map());
  const prevRangeRef = useRef(rangeDays);
  const geoThrottleRef = useRef(null);

  if (!geoThrottleRef.current) {
    geoThrottleRef.current = createThrottle(GEO_REQUEST_DELAY_MS);
  }

  const activeWorkers = useMemo(
    () => workers.filter((worker) => !isWorkerInactive(worker)),
    [workers]
  );

  const workersByStation = useMemo(() => {
    const map = new Map();
    activeWorkers.forEach((worker) => {
      if (!Array.isArray(worker.assigned_station_ids)) return;
      worker.assigned_station_ids.forEach((stationId) => {
        const entry = map.get(stationId) || [];
        entry.push(worker);
        map.set(stationId, entry);
      });
    });
    return map;
  }, [activeWorkers]);

  const groupedStations = useMemo(() => {
    return stationGroups.filter((group) => (group.stationIds || []).length > 0);
  }, [stationGroups]);

  useEffect(() => {
    setReportSelection((prev) => {
      const next = {};
      groupedStations.forEach((group) => {
        next[group.key] = prev[group.key] !== false;
      });
      return next;
    });
  }, [groupedStations]);

  const workersByGroup = useMemo(() => {
    const map = new Map();
    groupedStations.forEach((group) => {
      const uniqueWorkers = new Map();
      (group.stationIds || []).forEach((stationId) => {
        const stationWorkers = workersByStation.get(stationId) || [];
        stationWorkers.forEach((worker) => {
          if (worker?.id != null) {
            uniqueWorkers.set(worker.id, worker);
          }
        });
      });
      map.set(group.key, Array.from(uniqueWorkers.values()));
    });
    return map;
  }, [groupedStations, workersByStation]);

  const todayKey = useMemo(() => toDateOnly(new Date()), [toDateOnly]);

  const fetchWorkerSummary = useCallback(
    async (worker, customRangeDays = rangeDays) => {
      const safeRangeDays = Math.max(1, Math.round(Number(customRangeDays) || rangeDays));
      const fromDate = isoDaysAgo(safeRangeDays);
      const toDate = todayIso();
      let attendanceResponse = null;
      let attendanceError = '';
      if (worker.geovictoria_identifier) {
        try {
          await geoThrottleRef.current();
          attendanceResponse = await apiRequest(
            `/api/geovictoria/attendance?worker_id=${worker.id}&days=${safeRangeDays}`
          );
        } catch (err) {
          attendanceError = err instanceof Error ? err.message : 'Error cargando asistencia.';
        }
      }

      let activityRows = [];
      let activityError = '';
      try {
        const rows = await apiRequest(
          `/api/task-history?worker_id=${worker.id}&from_date=${fromDate}&to_date=${toDate}&limit=4000`
        );
        activityRows = Array.isArray(rows) ? rows : [];
      } catch (err) {
        activityError = err instanceof Error ? err.message : 'Error cargando actividad.';
        activityRows = [];
      }

      const combinedDays = buildCombinedDays(
        attendanceResponse,
        activityRows,
        normalizeAttendance,
        buildActivityDays
      );
      const rangeIndicators = buildRangeIndicators(combinedDays);
      const lastFullDay = pickLastFullDayRow(rangeIndicators.rows, todayKey);

      const warnings = Array.isArray(attendanceResponse?.warnings)
        ? attendanceResponse.warnings
        : [];

      const combinedDaysMap = new Map();
      combinedDays.forEach((day) => combinedDaysMap.set(day.date, day));

      return {
        worker,
        rangeIndicators,
        lastFullDay,
        attendanceError,
        activityError,
        geovictoriaWarnings: warnings,
        combinedDaysMap,
      };
    },
    [
      apiRequest,
      isoDaysAgo,
      todayIso,
      rangeDays,
      normalizeAttendance,
      buildActivityDays,
      todayKey,
    ]
  );

  const buildStationSummary = useCallback(
    (workerSummaries) => {
      let productiveWeightedTotal = 0;
      let expectedWeightedTotal = 0;
      let productiveWeight = 0;
      let expectedWeight = 0;
      let workersWithData = 0;

      workerSummaries.forEach((summary) => {
        const range = summary?.rangeIndicators;
        const workerPresence = Number(range?.totals?.presenceNetSeconds);
        if (!Number.isFinite(workerPresence) || workerPresence <= 0) return;
        const hasProductive = Number.isFinite(range?.totalProductiveRatio);
        const hasExpected = Number.isFinite(range?.totalExpectedRatio);
        if (hasProductive) {
          productiveWeightedTotal += range.totalProductiveRatio * workerPresence;
          productiveWeight += workerPresence;
        }
        if (hasExpected) {
          expectedWeightedTotal += range.totalExpectedRatio * workerPresence;
          expectedWeight += workerPresence;
        }
        if (hasProductive || hasExpected) {
          workersWithData += 1;
        }
      });

      const rows = aggregateStationRows(workerSummaries);
      const lastFullDay = pickLastFullDayRow(rows, todayKey);
      return {
        averageProductive: productiveWeight ? productiveWeightedTotal / productiveWeight : null,
        averageExpected: expectedWeight ? expectedWeightedTotal / expectedWeight : null,
        rows,
        lastFullDay,
        workersTotal: workerSummaries.length,
        workersWithData,
      };
    },
    [todayKey]
  );

  const loadGroupData = useCallback(
    async (groupKey, { force = false } = {}) => {
      const cached = groupCache[groupKey];
      if (!force && cached && cached.rangeDays === rangeDays && !cached.loading) {
        return;
      }

      const groupWorkers = workersByGroup.get(groupKey) || [];
      const token = (loadTokensRef.current.get(groupKey) || 0) + 1;
      loadTokensRef.current.set(groupKey, token);

      setGroupCache((prev) => ({
        ...prev,
        [groupKey]: {
          ...(prev[groupKey] || {}),
          loading: true,
          error: '',
          rangeDays,
        },
      }));

      if (!groupWorkers.length) {
        setGroupCache((prev) => ({
          ...prev,
          [groupKey]: {
            loading: false,
            error: '',
            rangeDays,
            workers: [],
            stationSummary: null,
          },
        }));
        return;
      }

      const summaries = await runWithLimit(groupWorkers, LOAD_CONCURRENCY, fetchWorkerSummary);
      if (loadTokensRef.current.get(groupKey) !== token) return;

      const workerSummaries = summaries
        .map((summary) => {
          if (!summary || summary.error) return null;
          return summary;
        })
        .filter(Boolean);

      const stationSummary = buildStationSummary(workerSummaries);

      setGroupCache((prev) => ({
        ...prev,
        [groupKey]: {
          loading: false,
          error: '',
          rangeDays,
          workers: workerSummaries,
          stationSummary,
        },
      }));
    },
    [
      groupCache,
      rangeDays,
      workersByGroup,
      fetchWorkerSummary,
      buildStationSummary,
    ]
  );

  const openReportModal = useCallback(() => {
    const defaults = {};
    groupedStations.forEach((group) => {
      defaults[group.key] = true;
    });
    setReportSelection(defaults);
    setReportDays(rangeDays);
    setReportIncludeWorkers(false);
    setReportError('');
    setReportModalOpen(true);
  }, [groupedStations, rangeDays]);

  const selectedReportGroups = useMemo(
    () => groupedStations.filter((group) => reportSelection[group.key] !== false),
    [groupedStations, reportSelection]
  );

  const toggleReportGroup = useCallback((groupKey) => {
    setReportSelection((prev) => ({
      ...prev,
      [groupKey]: !(prev[groupKey] !== false),
    }));
  }, []);

  const setReportSelectionAll = useCallback(
    (checked) => {
      const next = {};
      groupedStations.forEach((group) => {
        next[group.key] = checked;
      });
      setReportSelection(next);
    },
    [groupedStations]
  );

  const generateReport = useCallback(async () => {
    const safeReportDays = Math.max(1, Math.round(Number(reportDays) || rangeDays));
    const fromDate = isoDaysAgo(safeReportDays);
    const toDate = todayIso();
    const selectedGroups = groupedStations.filter((group) => reportSelection[group.key] !== false);
    if (!selectedGroups.length) {
      setReportError('Seleccione al menos una estacion para generar el reporte.');
      return;
    }

    setReportGenerating(true);
    setReportError('');

    try {
      const selectedGroupData = [];

      for (const group of selectedGroups) {
        const cached = groupCache[group.key];
        const canReuseCache =
          cached &&
          !cached.loading &&
          !cached.error &&
          cached.rangeDays === safeReportDays &&
          Array.isArray(cached.workers);

        let workerSummaries = [];
        let stationSummary = null;

        if (canReuseCache) {
          workerSummaries = normalizeReportWorkerSummaries(cached.workers, formatWorkerDisplayName);
          stationSummary = cached.stationSummary || buildStationSummary(workerSummaries);
        } else {
          const groupWorkers = workersByGroup.get(group.key) || [];
          const summaries = await runWithLimit(groupWorkers, LOAD_CONCURRENCY, (worker) =>
            fetchWorkerSummary(worker, safeReportDays)
          );

          workerSummaries = normalizeReportWorkerSummaries(
            summaries
              .map((summary) => {
                if (!summary || summary.error) return null;
                return summary;
              })
              .filter(Boolean),
            formatWorkerDisplayName
          );
          stationSummary = buildStationSummary(workerSummaries);
        }

        selectedGroupData.push({
          group,
          workerSummaries,
          stationSummary,
        });
      }

      const payload = buildPdfPayload({
        reportDays: safeReportDays,
        fromDate,
        toDate,
        includeWorkers: reportIncludeWorkers,
        selectedGroupData,
      });

      const response = await fetch(`${apiBaseUrl || ''}/api/reports/station-assistance-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const errorPayload = await response.json();
          detail = errorPayload?.detail ? String(errorPayload.detail) : '';
        } catch {
          const rawText = await response.text();
          detail = rawText || '';
        }
        throw new Error(detail || `Error generando reporte PDF (${response.status})`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition');
      const fallbackName = `reporte_asistencia_estaciones_${toDate}.pdf`;
      const filename = parseFilenameFromDisposition(disposition, fallbackName);
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl);
      }, 1000);
      setReportModalOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No fue posible generar el reporte.';
      setReportError(message);
    } finally {
      setReportGenerating(false);
    }
  }, [
    apiBaseUrl,
    reportDays,
    rangeDays,
    isoDaysAgo,
    todayIso,
    groupedStations,
    reportSelection,
    groupCache,
    workersByGroup,
    fetchWorkerSummary,
    formatWorkerDisplayName,
    buildStationSummary,
    reportIncludeWorkers,
  ]);

  useEffect(() => {
    if (prevRangeRef.current === rangeDays) return;
    prevRangeRef.current = rangeDays;
    setGroupCache({});
    Object.entries(expandedGroups).forEach(([groupKey, isOpen]) => {
      if (isOpen) loadGroupData(groupKey, { force: true });
    });
  }, [rangeDays, expandedGroups, loadGroupData]);

  const toggleGroup = useCallback(
    (groupKey) => {
      const isOpen = !!expandedGroups[groupKey];
      if (!isOpen) loadGroupData(groupKey);
      setExpandedGroups((prev) => ({
        ...prev,
        [groupKey]: !isOpen,
      }));
    },
    [expandedGroups, loadGroupData]
  );

  if (!stations.length) {
    return (
      <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <p className="text-sm text-[var(--ink-muted)]">No hay estaciones para mostrar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-black/5 bg-white/80 px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg text-[var(--ink)]">Vista por estación</h2>
            <p className="text-xs text-[var(--ink-muted)]">
              Tiempo productivo y cobertura esperada por estación y trabajador.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs text-[var(--ink-muted)]">
              <span className="inline-block h-2 w-3 rounded-sm bg-[#16a34a]" /> Productivo
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-[var(--ink-muted)]">
              <span className="inline-block h-2 w-3 rounded-sm bg-[#2563eb]" /> Cobertura
            </span>
            <select
              className="ml-3 rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-[var(--ink)]"
              value={rangeDays}
              onChange={(event) => setRangeDays(Number(event.target.value))}
            >
              {RANGE_OPTIONS.map((days) => (
                <option key={days} value={days}>{days} dias</option>
              ))}
            </select>
            <button
              type="button"
              onClick={openReportModal}
              className="ml-2 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-black/5"
            >
              Generar reporte
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/90 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/5 bg-slate-50/80">
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)]">Estación</th>
              <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)]">Grafico</th>
              <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)]">Productivo</th>
              <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)]">Cobertura</th>
              <th className="px-4 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {groupedStations.map((group) => {
              const groupKey = group.key;
              const groupWorkers = workersByGroup.get(groupKey) || [];
              const groupWorkerCount = groupWorkers.length;
              const cache = groupCache[groupKey];
              const isOpen = !!expandedGroups[groupKey];
              const summary = cache?.stationSummary;

              return (
                <React.Fragment key={group.key}>
                  <tr
                    className="border-b border-black/5 hover:bg-slate-50/50 cursor-pointer transition-colors"
                    onClick={() => toggleGroup(groupKey)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--ink)]">{group.label}</div>
                      <div className="text-xs text-[var(--ink-muted)]">{groupWorkerCount} trabajadores</div>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {cache?.loading ? (
                        <span className="text-xs text-[var(--ink-muted)]">...</span>
                      ) : summary?.rows?.length ? (
                        <CompactSparkline rows={summary.rows} />
                      ) : (
                        <div className="w-[140px] h-[36px] bg-slate-50 rounded inline-block" />
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className="font-semibold text-[var(--ink)]">
                        {cache?.loading ? '...' : formatPercent(summary?.averageProductive)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className="font-semibold text-[var(--ink)]">
                        {cache?.loading ? '...' : formatPercent(summary?.averageExpected)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {isOpen ? <ChevronUp className="h-4 w-4 text-[var(--ink-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--ink-muted)]" />}
                    </td>
                  </tr>
                  {isOpen && cache?.workers && cache.workers.map((workerSummary) => {
                    const workerLabel = formatWorkerLabel(workerSummary.worker, formatWorkerDisplayName);
                    const rangeIndicators = workerSummary.rangeIndicators;
                    const hasWarnings = Array.isArray(workerSummary.geovictoriaWarnings) && workerSummary.geovictoriaWarnings.length > 0;
                    const hasErrors = workerSummary.attendanceError || workerSummary.activityError;

                    const handlePointClick = (row) => {
                      const combinedDay = workerSummary.combinedDaysMap?.get(row.key);
                      setModalData({
                        key: row.key,
                        indicators: row.indicators,
                        combinedDay,
                        workerName: workerLabel,
                      });
                    };

                    return (
                      <tr key={workerSummary.worker.id} className="border-b border-black/5 bg-slate-50/30">
                        <td className="px-4 py-2 pl-8">
                          <div className="text-[var(--ink)]">{workerLabel}</div>
                          <div className="text-xs text-[var(--ink-muted)]">
                            {rangeIndicators.daysWithData}/{rangeIndicators.daysTotal} dias
                            {(hasErrors || hasWarnings) && <span className="ml-1 text-amber-600">⚠</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center">
                          {rangeIndicators.rows?.length ? (
                            <CompactSparkline rows={rangeIndicators.rows} onPointClick={handlePointClick} />
                          ) : (
                            <span className="text-xs text-[var(--ink-muted)]">Sin datos</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className="text-[var(--ink)]">{formatPercent(rangeIndicators.totalProductiveRatio)}</span>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className="text-[var(--ink)]">{formatPercent(rangeIndicators.totalExpectedRatio)}</span>
                        </td>
                        <td className="px-4 py-2"></td>
                      </tr>
                    );
                  })}
                  {isOpen && !cache?.loading && (!cache?.workers || !cache.workers.length) && (
                    <tr className="border-b border-black/5 bg-slate-50/30">
                      <td colSpan={5} className="px-4 py-2 pl-8 text-xs text-[var(--ink-muted)]">
                        No hay trabajadores asignados o datos disponibles.
                      </td>
                    </tr>
                  )}
                  {isOpen && cache?.loading && (
                    <tr className="border-b border-black/5 bg-slate-50/30">
                      <td colSpan={5} className="px-4 py-2 pl-8 text-xs text-[var(--ink-muted)]">
                        Cargando datos...
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {modalData && (
        <DayDetailModal
          day={modalData}
          workerName={modalData.workerName}
          onClose={() => setModalData(null)}
          TaskTimeline={TaskTimeline}
          formatPercent={formatPercent}
          formatSeconds={formatSeconds || defaultFormatSeconds}
        />
      )}

      {reportModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !reportGenerating && setReportModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-[92vw] w-full mx-4 md:max-w-2xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Reporte</p>
                <h3 className="text-lg font-semibold text-[var(--ink)]">Configurar reporte PDF</h3>
              </div>
              <button
                onClick={() => !reportGenerating && setReportModalOpen(false)}
                className="p-2 hover:bg-black/5 rounded-full"
                disabled={reportGenerating}
              >
                <X className="h-5 w-5 text-[var(--ink-muted)]" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)] mb-1">
                    Rango del reporte
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={reportDays}
                    onChange={(event) => setReportDays(Number(event.target.value))}
                    className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                  />
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">Se usa "ultimos N dias".</p>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)] mb-1">
                    Nivel de detalle
                  </label>
                  <button
                    type="button"
                    onClick={() => setReportIncludeWorkers((prev) => !prev)}
                    className={`inline-flex items-center justify-between w-full rounded-lg border px-3 py-2 text-sm ${
                      reportIncludeWorkers
                        ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                        : 'border-black/10 bg-white text-[var(--ink)]'
                    }`}
                  >
                    <span>
                      {reportIncludeWorkers
                        ? 'Incluir detalle por trabajador'
                        : 'Solo resumen por estacion'}
                    </span>
                    <span className="text-xs uppercase tracking-[0.15em]">
                      {reportIncludeWorkers ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    Estaciones incluidas ({selectedReportGroups.length}/{groupedStations.length})
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setReportSelectionAll(true)}
                      className="rounded-md border border-black/10 bg-white px-2 py-1 text-[11px] text-[var(--ink)] hover:bg-black/5"
                    >
                      Todas
                    </button>
                    <button
                      type="button"
                      onClick={() => setReportSelectionAll(false)}
                      className="rounded-md border border-black/10 bg-white px-2 py-1 text-[11px] text-[var(--ink)] hover:bg-black/5"
                    >
                      Ninguna
                    </button>
                  </div>
                </div>
                <div className="max-h-56 overflow-auto rounded-xl border border-black/10 bg-white p-2">
                  {groupedStations.map((group) => {
                    const checked = reportSelection[group.key] !== false;
                    const workersCount = (workersByGroup.get(group.key) || []).length;
                    return (
                      <label
                        key={group.key}
                        className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-slate-50/80 cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleReportGroup(group.key)}
                          />
                          <span className="text-sm text-[var(--ink)]">{group.label}</span>
                        </span>
                        <span className="text-xs text-[var(--ink-muted)]">{workersCount} trab.</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {reportError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {reportError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-black/5">
              <button
                type="button"
                className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm text-[var(--ink)] hover:bg-black/5"
                onClick={() => setReportModalOpen(false)}
                disabled={reportGenerating}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--ink)] bg-[var(--ink)] px-3 py-1.5 text-sm text-white disabled:opacity-60"
                onClick={generateReport}
                disabled={reportGenerating || selectedReportGroups.length === 0}
              >
                {reportGenerating ? 'Generando...' : 'Generar y descargar PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StationWideAssistanceTab;
