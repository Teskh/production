import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCcw } from 'lucide-react';
import { formatDateTimeShort } from '../../utils/timeUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

const statusMeta = {
  completed: {
    label: 'Completada',
    dot: 'bg-emerald-500',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  in_progress: {
    label: 'En progreso',
    dot: 'bg-amber-500',
    chip: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  paused: {
    label: 'Pausada',
    dot: 'bg-orange-500',
    chip: 'border-orange-200 bg-orange-50 text-orange-700',
  },
  skipped: {
    label: 'Omitida',
    dot: 'bg-rose-500',
    chip: 'border-rose-200 bg-rose-50 text-rose-700',
  },
  pending: {
    label: 'Pendiente',
    dot: 'bg-slate-400',
    chip: 'border-slate-200 bg-slate-50 text-slate-600',
  },
};

const moduleStatusLabels = {
  Planned: 'Planificado',
  Panels: 'Paneles',
  Magazine: 'Magazine',
  Assembly: 'Ensamble',
  Completed: 'Completado',
};

const lineOrder = ['1', '2', '3'];

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

const normalizeStatus = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return 'pending';
  const normalized = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'notstarted') return 'pending';
  if (normalized === 'inprogress') return 'in_progress';
  if (normalized === 'paused') return 'paused';
  if (normalized === 'completed') return 'completed';
  if (normalized === 'skipped') return 'skipped';
  return normalized;
};

const formatTimeRange = (start, end) => {
  const startLabel = formatDateTimeShort(start, { fallback: '-' });
  const endLabel = formatDateTimeShort(end, { fallback: '-' });
  if (startLabel === '-' && endLabel === '-') {
    return null;
  }
  if (endLabel === '-') {
    return startLabel;
  }
  return `${startLabel} -> ${endLabel}`;
};

const formatLineLabel = (value) => {
  if (!value) return 'Linea';
  const normalized = String(value).trim().toUpperCase();
  return `Linea ${normalized}`;
};

const parseLineKey = (value) => {
  if (!value) return null;
  const match = String(value).match(/\d+/);
  if (match) return match[0];
  return String(value).trim();
};

const formatModuleStatus = (value) => {
  if (!value) return 'Sin estado';
  return moduleStatusLabels[String(value)] || String(value);
};

const isMagazineStatus = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase() === 'magazine';

const sortStations = (a, b) => {
  const lineA = a.line_type ?? '';
  const lineB = b.line_type ?? '';
  if (lineA !== lineB) {
    return String(lineA).localeCompare(String(lineB), undefined, { numeric: true });
  }
  const seqA = a.sequence_order ?? Number.POSITIVE_INFINITY;
  const seqB = b.sequence_order ?? Number.POSITIVE_INFINITY;
  if (seqA !== seqB) {
    return seqA - seqB;
  }
  return String(a.name).localeCompare(String(b.name));
};

const getModuleKey = (item, stationId, index) =>
  item?.id ?? `${stationId}-${index}`;

const FloorStatus = () => {
  const [stations, setStations] = useState([]);
  const [snapshots, setSnapshots] = useState({});
  const [stationErrors, setStationErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [collapsedModules, setCollapsedModules] = useState({});

  const assemblyStations = useMemo(() => {
    if (!Array.isArray(stations)) return [];
    return stations.filter((station) => station.role === 'Assembly').sort(sortStations);
  }, [stations]);

  const stationsByLine = useMemo(() => {
    const grouped = {
      1: [],
      2: [],
      3: [],
    };
    assemblyStations.forEach((station) => {
      const lineKey = parseLineKey(station.line_type);
      const targetKey = lineOrder.includes(lineKey) ? lineKey : lineOrder[0];
      grouped[targetKey].push(station);
    });
    lineOrder.forEach((key) => {
      grouped[key].sort(sortStations);
    });
    return grouped;
  }, [assemblyStations]);

  const allModuleKeys = useMemo(() => {
    const keys = new Set();
    assemblyStations.forEach((station) => {
      const snapshot = snapshots[station.id];
      const workItems = Array.isArray(snapshot?.work_items) ? snapshot.work_items : [];
      const visibleItems = workItems.filter((item) => !isMagazineStatus(item?.status));
      visibleItems.forEach((item, index) => {
        keys.add(getModuleKey(item, station.id, index));
      });
    });
    return Array.from(keys);
  }, [assemblyStations, snapshots]);

  const allCollapsed =
    allModuleKeys.length > 0 &&
    allModuleKeys.every((key) => Boolean(collapsedModules[key]));

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const stationData = await apiRequest('/api/stations');
      const normalizedStations = Array.isArray(stationData) ? stationData : [];
      setStations(normalizedStations);
      const assembly = normalizedStations.filter((station) => station.role === 'Assembly');

      const settled = await Promise.all(
        assembly.map(async (station) => {
          try {
            const snapshot = await apiRequest(`/api/worker-stations/${station.id}/snapshot`);
            return { stationId: station.id, snapshot };
          } catch (err) {
            return {
              stationId: station.id,
              error: err instanceof Error ? err.message : 'No se pudo cargar la estacion.',
            };
          }
        })
      );

      const nextSnapshots = {};
      const nextErrors = {};
      settled.forEach((result) => {
        if (result.snapshot) {
          nextSnapshots[result.stationId] = result.snapshot;
        }
        if (result.error) {
          nextErrors[result.stationId] = result.error;
        }
      });
      setSnapshots(nextSnapshots);
      setStationErrors(nextErrors);
      setLastUpdated(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo cargar el estado.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const toggleAllModules = () => {
    const nextCollapsed = !allCollapsed;
    setCollapsedModules((prev) => {
      const next = { ...prev };
      allModuleKeys.forEach((key) => {
        next[key] = nextCollapsed;
      });
      return next;
    });
  };

  const toggleModule = (moduleKey) => {
    setCollapsedModules((prev) => ({
      ...prev,
      [moduleKey]: !prev[moduleKey],
    }));
  };

  const getTaskSummary = (item) => {
    const lists = [item?.tasks, item?.other_tasks, item?.backlog_tasks];
    const allTasks = lists.flatMap((list) => (Array.isArray(list) ? list : []));
    const completed = allTasks.filter(
      (task) => normalizeStatus(task?.status) === 'completed'
    ).length;
    return { total: allTasks.length, completed };
  };

  const renderTaskMeta = (task, variant) => {
    const timeLabel = formatTimeRange(task.started_at, task.completed_at);
    const dependencies =
      task.dependencies_satisfied === false && Array.isArray(task.dependencies_missing_names)
        ? task.dependencies_missing_names.filter(Boolean)
        : [];
    const sequence =
      variant === 'backlog' && task.station_sequence_order != null
        ? `Secuencia ${task.station_sequence_order}`
        : null;
    const meta = [];
    if (timeLabel) {
      meta.push({ label: `Tiempo: ${timeLabel}`, tone: 'text-slate-500' });
    }
    if (dependencies.length > 0) {
      meta.push({
        label: `Bloqueada: ${dependencies.join(', ')}`,
        tone: 'text-amber-700',
      });
    }
    if (sequence) {
      meta.push({
        label: `Debio completarse en ${sequence}`,
        tone: 'text-amber-700',
      });
    }
    if (!meta.length) {
      return null;
    }
    return (
      <div className="flex flex-wrap gap-2 text-xs">
        {meta.map((item) => (
          <span key={item.label} className={item.tone}>
            {item.label}
          </span>
        ))}
      </div>
    );
  };

  const renderTask = (task, index, variant = 'main') => {
    const statusKey = normalizeStatus(task?.status);
    const meta = statusMeta[statusKey] || statusMeta.pending;
    const key = task?.task_instance_id ?? task?.task_definition_id ?? `${task?.name}-${index}`;
    const taskName = task?.name || `Tarea ${task?.task_definition_id ?? ''}`;
    return (
      <li
        key={key}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-sm font-semibold text-slate-800" title={taskName}>
              {taskName}
            </p>
            {renderTaskMeta(task, variant)}
          </div>
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.chip}`}
          >
            <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
        </div>
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Vista de planta
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">
              Estado de ensamblaje
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Seguimiento en vivo de estaciones y modulos activos.
            </p>
          </div>
          <div className="flex flex-col gap-2 text-right text-xs text-slate-500">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Link
                to="/login"
                className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Volver a login
              </Link>
              <button
                type="button"
                onClick={toggleAllModules}
                disabled={allModuleKeys.length === 0}
                className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {allCollapsed ? 'Expandir todo' : 'Colapsar todo'}
              </button>
              <button
                type="button"
                onClick={() => fetchData()}
                disabled={loading}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-white transition ${
                  loading ? 'bg-slate-400' : 'bg-slate-900 hover:bg-slate-800'
                }`}
              >
                <RefreshCcw className="h-4 w-4" />
                {loading ? 'Actualizando' : 'Actualizar'}
              </button>
            </div>
            <span>
              Ultima actualizacion:{' '}
              {lastUpdated ? lastUpdated.toLocaleTimeString() : '-'}
            </span>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          {lineOrder.map((lineKey) => {
            const stationsForLine = stationsByLine[lineKey] || [];
            return (
              <div key={lineKey} className="flex flex-col gap-4">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Linea {lineKey}
                  </p>
                  <p className="text-sm text-slate-600">
                    {stationsForLine.length} estaciones
                  </p>
                </div>

                {stationsForLine.map((station) => {
                  const snapshot = snapshots[station.id];
                  const stationError = stationErrors[station.id];
                  const workItems = Array.isArray(snapshot?.work_items)
                    ? snapshot.work_items
                    : [];
                  const visibleItems = workItems.filter(
                    (item) => !isMagazineStatus(item?.status)
                  );
                  return (
                    <div
                      key={station.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold text-slate-900">
                            {station.name}
                          </h2>
                          <p className="text-xs text-slate-500">
                            Secuencia {station.sequence_order ?? '-'}
                          </p>
                        </div>
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                          {formatLineLabel(station.line_type)}
                        </span>
                      </div>

                      {stationError && (
                        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                          {stationError}
                        </div>
                      )}

                      {!stationError && visibleItems.length === 0 && (
                        <div className="mt-3 rounded-md border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                          Sin modulos activos en esta estacion.
                        </div>
                      )}

                      <div className="mt-4 space-y-4">
                        {visibleItems.map((item, index) => {
                          const moduleKey = getModuleKey(item, station.id, index);
                          const isCollapsed = Boolean(collapsedModules[moduleKey]);
                          const summary = getTaskSummary(item);
                          return (
                            <div
                              key={moduleKey}
                              className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <h3 className="text-sm font-semibold text-slate-800">
                                    {item.project_name || 'Proyecto'} · Casa{' '}
                                    {item.house_identifier || 'N/D'} ·{' '}
                                    {item.panel_code
                                      ? `Panel ${item.panel_code}`
                                      : `Modulo ${item.module_number ?? '-'}`}
                                  </h3>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {item.house_type_name}
                                    {item.sub_type_name
                                      ? ` · ${item.sub_type_name}`
                                      : ''}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                                    {formatModuleStatus(item.status)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => toggleModule(moduleKey)}
                                    className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                                  >
                                    {isCollapsed ? 'Expandir tareas' : 'Colapsar tareas'}
                                  </button>
                                </div>
                              </div>

                              {isCollapsed ? (
                                <div className="mt-3 rounded-md border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                                  {summary.total > 0
                                    ? `${summary.completed}/${summary.total} tareas completadas`
                                    : 'Sin tareas asociadas.'}
                                </div>
                              ) : (
                                <div className="mt-3 space-y-3">
                                  {item.tasks?.length > 0 ? (
                                    <div className="space-y-2">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                        Tareas en estacion
                                      </p>
                                      <ul className="space-y-2">
                                        {item.tasks.map((task, taskIndex) =>
                                          renderTask(task, taskIndex, 'main')
                                        )}
                                      </ul>
                                    </div>
                                  ) : (
                                    <div className="text-xs text-slate-500">
                                      Sin tareas en esta estacion.
                                    </div>
                                  )}

                                  {item.other_tasks?.length > 0 && (
                                    <div className="space-y-2">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                        Otras tareas
                                      </p>
                                      <ul className="space-y-2">
                                        {item.other_tasks.map((task, taskIndex) =>
                                          renderTask(task, taskIndex, 'other')
                                        )}
                                      </ul>
                                    </div>
                                  )}

                                  {item.backlog_tasks?.length > 0 && (
                                    <div className="space-y-2">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                                        Tareas pendientes de estaciones previas
                                      </p>
                                      <ul className="space-y-2">
                                        {item.backlog_tasks.map((task, taskIndex) =>
                                          renderTask(task, taskIndex, 'backlog')
                                        )}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {stationsForLine.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">
                    Sin estaciones configuradas en esta linea.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {assemblyStations.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">
            No hay estaciones de ensamble configuradas.
          </div>
        )}
      </div>
    </div>
  );
};

export default FloorStatus;
