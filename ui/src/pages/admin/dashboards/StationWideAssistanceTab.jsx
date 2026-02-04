import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const RANGE_OPTIONS = [3, 7, 14];
const LOAD_CONCURRENCY = 3;
const GEO_REQUEST_DELAY_MS = 400;

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
  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
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

const average = (values) => {
  if (!values.length) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
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
      const entry = map.get(row.key) || {
        key: row.key,
        label: row.label,
        dateObj: row.dateObj,
        productiveTotal: 0,
        expectedTotal: 0,
        count: 0,
      };
      entry.productiveTotal += row.productiveRatio;
      entry.expectedTotal += row.expectedRatio;
      entry.count += 1;
      map.set(row.key, entry);
    });
  });

  return Array.from(map.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      dateObj: entry.dateObj,
      productiveRatio: entry.count ? entry.productiveTotal / entry.count : null,
      expectedRatio: entry.count ? entry.expectedTotal / entry.count : null,
    }));
};

const CompactSparkline = ({ rows, width = 140, height = 36 }) => {
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

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img">
      <rect x={padX} y={padY} width={innerWidth} height={innerHeight} fill="#f8fafc" rx={2} />
      {productivePath && <path d={productivePath} fill="none" stroke="#16a34a" strokeWidth={1.5} />}
      {expectedPath && <path d={expectedPath} fill="none" stroke="#2563eb" strokeWidth={1.5} />}
      {rows.map((row, idx) => {
        const x = xAt(idx);
        return (
          <g key={row.key}>
            <title>{`${row.key}: ${Number.isFinite(row.productiveRatio) ? Math.round(row.productiveRatio * 100) + '%' : '—'} prod · ${Number.isFinite(row.expectedRatio) ? Math.round(row.expectedRatio * 100) + '%' : '—'} cob`}</title>
            {Number.isFinite(row.productiveRatio) && <circle cx={x} cy={yAt(row.productiveRatio)} r={2} fill="#16a34a" />}
            {Number.isFinite(row.expectedRatio) && <circle cx={x} cy={yAt(row.expectedRatio)} r={2} fill="#2563eb" />}
          </g>
        );
      })}
    </svg>
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

const StationWideAssistanceTab = ({
  stations,
  stationGroups,
  workers,
  apiRequest,
  isoDaysAgo,
  todayIso,
  normalizeAttendance,
  buildActivityDays,
  buildRangeIndicators,
  formatWorkerDisplayName,
  formatPercent,
  toDateOnly,
}) => {
  const [rangeDays, setRangeDays] = useState(RANGE_OPTIONS[0]);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [groupCache, setGroupCache] = useState({});
  const loadTokensRef = useRef(new Map());
  const prevRangeRef = useRef(rangeDays);
  const geoThrottleRef = useRef(null);

  if (!geoThrottleRef.current) {
    geoThrottleRef.current = createThrottle(GEO_REQUEST_DELAY_MS);
  }

  const workersByStation = useMemo(() => {
    const map = new Map();
    workers.forEach((worker) => {
      if (!Array.isArray(worker.assigned_station_ids)) return;
      worker.assigned_station_ids.forEach((stationId) => {
        const entry = map.get(stationId) || [];
        entry.push(worker);
        map.set(stationId, entry);
      });
    });
    return map;
  }, [workers]);

  const groupedStations = useMemo(() => {
    return stationGroups.filter((group) => (group.stationIds || []).length > 0);
  }, [stationGroups]);

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
    async (worker) => {
      const fromDate = isoDaysAgo(rangeDays);
      const toDate = todayIso();
      let attendanceResponse = null;
      let attendanceError = '';
      if (worker.geovictoria_identifier) {
        try {
          await geoThrottleRef.current();
          attendanceResponse = await apiRequest(
            `/api/geovictoria/attendance?worker_id=${worker.id}&days=${rangeDays}`
          );
        } catch (err) {
          attendanceError = err instanceof Error ? err.message : 'Error cargando asistencia.';
        }
      }

      let activityRows = [];
      let activityError = '';
      try {
        const rows = await apiRequest(
          `/api/task-history?worker_id=${worker.id}&from_date=${fromDate}&to_date=${toDate}&limit=2000`
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

      return {
        worker,
        rangeIndicators,
        lastFullDay,
        attendanceError,
        activityError,
        geovictoriaWarnings: warnings,
      };
    },
    [
      apiRequest,
      isoDaysAgo,
      todayIso,
      rangeDays,
      normalizeAttendance,
      buildActivityDays,
      buildRangeIndicators,
      todayKey,
    ]
  );

  const buildStationSummary = useCallback(
    (workerSummaries) => {
      const productiveValues = workerSummaries
        .map((summary) => summary?.rangeIndicators?.totalProductiveRatio)
        .filter((value) => Number.isFinite(value));
      const expectedValues = workerSummaries
        .map((summary) => summary?.rangeIndicators?.totalExpectedRatio)
        .filter((value) => Number.isFinite(value));
      const rows = aggregateStationRows(workerSummaries);
      const lastFullDay = pickLastFullDayRow(rows, todayKey);
      return {
        averageProductive: average(productiveValues),
        averageExpected: average(expectedValues),
        rows,
        lastFullDay,
        workersTotal: workerSummaries.length,
        workersWithData: productiveValues.length || expectedValues.length,
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
                            <CompactSparkline rows={rangeIndicators.rows} />
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
    </div>
  );
};

export default StationWideAssistanceTab;
