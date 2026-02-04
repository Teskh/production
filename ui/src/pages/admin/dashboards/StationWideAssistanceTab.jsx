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

const MetricsSparkline = ({ rows }) => {
  if (!rows || !rows.length) return null;
  const width = 280;
  const height = 88;
  const padX = 10;
  const padY = 10;
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
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      height={height}
      role="img"
    >
      <rect x={padX} y={padY} width={innerWidth} height={innerHeight} fill="#f8fafc" />
      {productivePath && (
        <path d={productivePath} fill="none" stroke="#16a34a" strokeWidth={2} />
      )}
      {expectedPath && <path d={expectedPath} fill="none" stroke="#2563eb" strokeWidth={2} />}
      {rows.map((row, idx) => {
        const productY = yAt(row.productiveRatio);
        const expectedY = yAt(row.expectedRatio);
        const x = xAt(idx);
        const productValue = Number.isFinite(row.productiveRatio)
          ? Math.round(row.productiveRatio * 100)
          : null;
        const expectedValue = Number.isFinite(row.expectedRatio)
          ? Math.round(row.expectedRatio * 100)
          : null;
        const tooltip = `${row.key}: ${productValue != null ? `${productValue}%` : '—'} productivo · ${
          expectedValue != null ? `${expectedValue}%` : '—'
        } cobertura`;
        return (
          <g key={row.key}>
            <title>{tooltip}</title>
            {Number.isFinite(row.productiveRatio) && (
              <circle cx={x} cy={productY} r={2.8} fill="#16a34a" />
            )}
            {Number.isFinite(row.expectedRatio) && (
              <circle cx={x} cy={expectedY} r={2.8} fill="#2563eb" />
            )}
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
    <div className="space-y-6">
      <div className="rounded-2xl border border-black/5 bg-white/80 px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Estaciones</p>
            <h2 className="font-display text-xl text-[var(--ink)]">Vista por estación</h2>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Evolución de tiempo productivo y cobertura esperada por estación y trabajador.
            </p>
          </div>
          <div className="min-w-[180px]">
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
      </div>

      <div className="space-y-4">
        {groupedStations.map((group) => {
          const groupKey = group.key;
          const groupWorkers = workersByGroup.get(groupKey) || [];
          const groupWorkerCount = groupWorkers.length;
          const stationCount = (group.stationIds || []).length;
          const cache = groupCache[groupKey];
          const isOpen = !!expandedGroups[groupKey];
          const hasGroupWarnings =
            Array.isArray(cache?.workers) &&
            cache.workers.some(
              (summary) =>
                Array.isArray(summary.geovictoriaWarnings) &&
                summary.geovictoriaWarnings.length > 0
            );

          return (
            <div
              key={group.key}
              className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm"
            >
              <button
                type="button"
                onClick={() => toggleGroup(groupKey)}
                className="flex w-full items-center justify-between gap-3 text-left"
                aria-expanded={isOpen}
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    {group.sequence != null ? `Secuencia ${group.sequence}` : 'Sin secuencia'}
                  </p>
                  <h3 className="text-lg font-semibold text-[var(--ink)]">{group.label}</h3>
                </div>
                <div className="flex items-center gap-3 text-xs text-[var(--ink-muted)]">
                  <span>{stationCount} estaciones · {groupWorkerCount} trabajadores</span>
                  {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </button>

              {isOpen && (
                <div className="mt-4 rounded-xl border border-black/5 bg-[var(--accent-soft)]/40 px-4 py-4">
                  {cache?.loading && (
                    <p className="text-sm text-[var(--ink-muted)]">
                      Cargando datos del grupo...
                    </p>
                  )}
                  {!cache?.loading && cache?.stationSummary && (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-black/5 bg-white/80 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                              Promedio grupo
                            </p>
                            <p className="text-xs text-[var(--ink-muted)]">
                              {cache.stationSummary.workersWithData} de{' '}
                              {cache.stationSummary.workersTotal} trabajadores con datos
                            </p>
                          </div>
                          <div className="text-xs text-[var(--ink-muted)]">
                            Rango {rangeDays} dias
                          </div>
                        </div>
                        {cache.stationSummary.rows.length ? (
                          <div className="mt-3">
                            <MetricsSparkline rows={cache.stationSummary.rows} />
                            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-[var(--ink-muted)]">
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
                        ) : (
                          <p className="mt-3 text-sm text-[var(--ink-muted)]">
                            {hasGroupWarnings
                              ? 'Error en entrega de datos de GeoVictoria.'
                              : 'Sin datos para el rango de busqueda.'}
                          </p>
                        )}
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-black/5 bg-white/90 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                              Promedio productivo
                            </p>
                            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                              {formatPercent(cache.stationSummary.averageProductive)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-black/5 bg-white/90 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                              Promedio cobertura
                            </p>
                            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                              {formatPercent(cache.stationSummary.averageExpected)}
                            </p>
                          </div>
                        </div>
                        <p className="mt-3 text-xs text-[var(--ink-muted)]">
                          {cache.stationSummary.lastFullDay
                            ? `Ultimo dia completo ${
                                cache.stationSummary.lastFullDay.key
                              }: ${formatPercent(
                                cache.stationSummary.lastFullDay.productiveRatio
                              )} productivo · ${formatPercent(
                                cache.stationSummary.lastFullDay.expectedRatio
                              )} cobertura`
                            : 'Sin ultimo dia completo para mostrar.'}
                        </p>
                      </div>

                      <div className="space-y-3">
                        {cache.workers.map((summary) => {
                          const workerLabel = formatWorkerLabel(
                            summary.worker,
                            formatWorkerDisplayName
                          );
                          const rangeIndicators = summary.rangeIndicators;
                          const lastFullDay = summary.lastFullDay;
                          const hasRows = rangeIndicators.rows.length > 0;
                          const hasErrors = summary.attendanceError || summary.activityError;
                          const hasWarnings =
                            Array.isArray(summary.geovictoriaWarnings) &&
                            summary.geovictoriaWarnings.length > 0;

                          return (
                            <div
                              key={summary.worker.id}
                              className="rounded-xl border border-black/5 bg-white/90 p-4"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                                    Trabajador
                                  </p>
                                  <p className="text-sm font-semibold text-[var(--ink)]">
                                    {workerLabel}
                                  </p>
                                  <p className="text-xs text-[var(--ink-muted)]">
                                    {rangeIndicators.daysWithData} de {rangeIndicators.daysTotal}{' '}
                                    dias con datos
                                  </p>
                                </div>
                                <div className="text-xs text-[var(--ink-muted)]">
                                  {rangeIndicators.startDate && rangeIndicators.endDate
                                    ? `Rango ${rangeIndicators.startDate} → ${
                                        rangeIndicators.endDate
                                      }`
                                    : `Rango ${rangeDays} dias`}
                                </div>
                              </div>

                              {hasRows ? (
                                <div className="mt-3">
                                  <MetricsSparkline rows={rangeIndicators.rows} />
                                </div>
                              ) : (
                                <p className="mt-3 text-sm text-[var(--ink-muted)]">
                                  {hasWarnings
                                    ? 'Error en entrega de datos de GeoVictoria.'
                                    : 'Sin datos para el rango de busqueda.'}
                                </p>
                              )}

                              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <div className="rounded-lg border border-black/5 bg-white/90 px-3 py-2">
                                  <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                                    Promedio productivo
                                  </p>
                                  <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                                    {formatPercent(rangeIndicators.totalProductiveRatio)}
                                  </p>
                                </div>
                                <div className="rounded-lg border border-black/5 bg-white/90 px-3 py-2">
                                  <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                                    Promedio cobertura
                                  </p>
                                  <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                                    {formatPercent(rangeIndicators.totalExpectedRatio)}
                                  </p>
                                </div>
                              </div>
                              <p className="mt-3 text-xs text-[var(--ink-muted)]">
                                {lastFullDay
                                  ? `Ultimo dia completo ${lastFullDay.key}: ${formatPercent(
                                      lastFullDay.productiveRatio
                                    )} productivo · ${formatPercent(
                                      lastFullDay.expectedRatio
                                    )} cobertura`
                                  : 'Sin ultimo dia completo para mostrar.'}
                              </p>
                              {(hasErrors || hasWarnings) && (
                                <p className="mt-2 text-xs text-amber-700">
                                  {summary.attendanceError ? `GeoVictoria: ${summary.attendanceError}` : ''}
                                  {summary.attendanceError && summary.activityError ? ' · ' : ''}
                                  {summary.activityError ? `Actividad: ${summary.activityError}` : ''}
                                  {!summary.attendanceError && !summary.activityError && hasWarnings
                                    ? 'Error en entrega de datos de GeoVictoria.'
                                    : ''}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!cache?.loading && !cache?.stationSummary && (
                    <p className="text-sm text-[var(--ink-muted)]">
                      No hay trabajadores asignados o datos disponibles para este rango.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StationWideAssistanceTab;
