import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ClipboardCheck, LayoutGrid, Wrench, X } from 'lucide-react';
import clsx from 'clsx';
import { useOptionalQCSession, useQCLayoutStatus } from '../../layouts/QCLayoutContext';

const REFRESH_INTERVAL_MS = 20000;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const QC_ROLE_VALUES = new Set(['Calidad', 'QC']);

type QCCheckOrigin = 'triggered' | 'manual';
type QCCheckStatus = 'Open' | 'Closed';
type TaskScope = 'panel' | 'module' | 'aux';
type QCReworkStatus = 'Open' | 'InProgress' | 'Done' | 'Canceled';

type QCCheckInstanceSummary = {
  id: number;
  check_definition_id: number | null;
  check_name: string | null;
  origin: QCCheckOrigin;
  scope: TaskScope;
  work_unit_id: number;
  panel_unit_id: number | null;
  station_id: number | null;
  station_name: string | null;
  current_station_id: number | null;
  current_station_name: string | null;
  module_number: number;
  project_name: string | null;
  house_type_name: string | null;
  house_identifier: string | null;
  panel_code: string | null;
  status: QCCheckStatus;
  opened_at: string;
};

type QCReworkTaskSummary = {
  id: number;
  check_instance_id: number;
  description: string;
  status: QCReworkStatus;
  check_status: QCCheckStatus | null;
  task_status: string | null;
  work_unit_id: number;
  panel_unit_id: number | null;
  station_id: number | null;
  station_name: string | null;
  current_station_id: number | null;
  current_station_name: string | null;
  module_number: number;
  project_name: string | null;
  house_type_name: string | null;
  house_identifier: string | null;
  panel_code: string | null;
  created_at: string;
};

type QCDashboardResponse = {
  pending_checks: QCCheckInstanceSummary[];
  rework_tasks: QCReworkTaskSummary[];
};

type StationSummary = {
  id: number;
  name: string;
  role: string;
  line_type: string | null;
  sequence_order: number | null;
};

const formatTimestamp = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const scopeLabels: Record<TaskScope, string> = {
  module: 'Modulo',
  panel: 'Panel',
  aux: 'Aux',
};

const reworkStatusLabels: Record<QCReworkStatus, string> = {
  Open: 'Abierto',
  InProgress: 'En progreso',
  Done: 'Finalizado',
  Canceled: 'Cancelado',
};

const reworkTaskStatusLabels: Record<string, string> = {
  NotStarted: 'Sin iniciar',
  InProgress: 'En trabajo',
  Paused: 'En pausa',
  Completed: 'Completado',
};

const buildWorkUnitLabel = (
  projectName: string | null,
  houseTypeName: string | null,
  houseIdentifier: string | null
): string => {
  const parts: string[] = [];
  if (projectName) parts.push(projectName);
  if (houseTypeName) parts.push(houseTypeName);
  if (houseIdentifier) parts.push(`Casa ${houseIdentifier}`);
  return parts.length ? parts.join(' · ') : '-';
};

const formatModulePanelLabel = (moduleNumber: number, panelCode: string | null): string => {
  const moduleLabel = `Modulo ${moduleNumber}`;
  if (panelCode) {
    return `${moduleLabel} · Panel ${panelCode}`;
  }
  return moduleLabel;
};

const resolveStationId = (stationId: number | null, currentId: number | null): number | null =>
  currentId ?? stationId;

const toTimestamp = (value: string): number => {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const QCDashboard: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [dashboard, setDashboard] = useState<QCDashboardResponse>({
    pending_checks: [],
    rework_tasks: [],
  });
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState(false);
  const [stations, setStations] = useState<StationSummary[]>([]);
  const [stationsLoading, setStationsLoading] = useState(true);
  const [stationsError, setStationsError] = useState<string | null>(null);
  const [stationSelection, setStationSelection] = useState<{
    stationName: string;
    checks: QCCheckInstanceSummary[];
  } | null>(null);
  const qcSession = useOptionalQCSession();
  const { setStatus } = useQCLayoutStatus();
  const canExecuteChecks = Boolean(qcSession?.role && QC_ROLE_VALUES.has(qcSession.role));
  const blockedMessage =
    location.state?.blocked === 'qc-auth'
      ? 'Inicia sesion para ejecutar inspecciones QC.'
      : null;

  useEffect(() => {
    let isMounted = true;
    const loadDashboard = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/qc/dashboard`, {
          credentials: 'include',
        });
        if (!isMounted) {
          return;
        }
        if (response.status === 401) {
          setDashboard({ pending_checks: [], rework_tasks: [] });
          setIsUnauthorized(true);
          setErrorMessage(null);
          setLoading(false);
          return;
        }
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Solicitud fallida (${response.status})`);
        }
        const data = (await response.json()) as QCDashboardResponse;
        setDashboard(data);
        setIsUnauthorized(false);
        setErrorMessage(null);
        setLastUpdated(new Date());
      } catch (error) {
        if (!isMounted) {
          return;
        }
        const message =
          error instanceof Error ? error.message : 'No se pudo cargar el tablero QC.';
        setErrorMessage(message);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    loadDashboard();
    const intervalId = window.setInterval(loadDashboard, REFRESH_INTERVAL_MS);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadStations = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/stations`, {
          credentials: 'include',
        });
        if (!isMounted) {
          return;
        }
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Solicitud fallida (${response.status})`);
        }
        const data = (await response.json()) as StationSummary[];
        setStations(data);
        setStationsError(null);
      } catch (error) {
        if (!isMounted) {
          return;
        }
        const message =
          error instanceof Error ? error.message : 'No se pudo cargar estaciones.';
        setStationsError(message);
      } finally {
        if (isMounted) {
          setStationsLoading(false);
        }
      }
    };
    loadStations();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    setStatus((current) => ({ ...current, refreshIntervalMs: REFRESH_INTERVAL_MS }));
    return () => {
      setStatus({});
    };
  }, [setStatus]);

  useEffect(() => {
    setStatus((current) => ({ ...current, lastUpdated }));
  }, [lastUpdated, setStatus]);

  const pendingChecks = useMemo(() => dashboard.pending_checks, [dashboard.pending_checks]);
  const reworkTasks = useMemo(() => dashboard.rework_tasks, [dashboard.rework_tasks]);
  const stationActivity = useMemo(() => {
    const activity = new Map<
      number,
      { openChecks: QCCheckInstanceSummary[]; reworks: QCReworkTaskSummary[] }
    >();
    const ensureEntry = (stationId: number) => {
      const entry = activity.get(stationId);
      if (entry) {
        return entry;
      }
      const next = { openChecks: [], reworks: [] };
      activity.set(stationId, next);
      return next;
    };
    pendingChecks.forEach((check) => {
      const stationId = resolveStationId(check.station_id, check.current_station_id);
      if (stationId === null) {
        return;
      }
      ensureEntry(stationId).openChecks.push(check);
    });
    reworkTasks.forEach((task) => {
      const stationId = resolveStationId(task.station_id, task.current_station_id);
      if (stationId === null) {
        return;
      }
      ensureEntry(stationId).reworks.push(task);
    });
    activity.forEach((entry) => {
      entry.openChecks.sort((a, b) => toTimestamp(b.opened_at) - toTimestamp(a.opened_at));
      entry.reworks.sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at));
    });
    return activity;
  }, [pendingChecks, reworkTasks]);
  const stationGroups = useMemo(() => {
    const panels: StationSummary[] = [];
    const lines: Record<'1' | '2' | '3', StationSummary[]> = {
      '1': [],
      '2': [],
      '3': [],
    };
    stations.forEach((station) => {
      if (station.role === 'Panels') {
        panels.push(station);
        return;
      }
      if (station.role === 'Assembly' && station.line_type) {
        const bucket = lines[station.line_type as keyof typeof lines];
        if (bucket) {
          bucket.push(station);
        }
      }
    });
    const sortStations = (a: StationSummary, b: StationSummary) => {
      const left = a.sequence_order ?? Number.POSITIVE_INFINITY;
      const right = b.sequence_order ?? Number.POSITIVE_INFINITY;
      if (left !== right) {
        return left - right;
      }
      return a.name.localeCompare(b.name);
    };
    panels.sort(sortStations);
    Object.values(lines).forEach((group) => group.sort(sortStations));
    return [
      { id: 'panels', title: 'Paneles', stations: panels },
      { id: 'line-1', title: 'Linea 1', stations: lines['1'] },
      { id: 'line-2', title: 'Linea 2', stations: lines['2'] },
      { id: 'line-3', title: 'Linea 3', stations: lines['3'] },
    ];
  }, [stations]);
  const baseCardClass =
    'group rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md';
  const disabledCardClass = clsx(baseCardClass, 'pointer-events-none opacity-70');
  const locationLabel = (stationName: string | null, currentName: string | null) =>
    currentName ?? stationName ?? 'Sin estacion';
  const unauthorizedMessage = isUnauthorized
    ? 'Inicia sesion para ver inspecciones pendientes y re-trabajos.'
    : null;
  const hasStations = stations.length > 0;
  const getStationSummary = (stationId: number) => {
    const activity = stationActivity.get(stationId);
    if (!activity) {
      return { moduleLabel: 'Sin datos', workUnitLabel: '', openCheckCount: 0 };
    }
    const primary = activity.openChecks[0] ?? activity.reworks[0];
    const openCheckCount = activity.openChecks.length;
    if (!primary) {
      return { moduleLabel: 'Sin datos', workUnitLabel: '', openCheckCount };
    }
    const workUnitLabel = buildWorkUnitLabel(
      primary.project_name,
      primary.house_type_name,
      primary.house_identifier
    );
    return {
      moduleLabel: formatModulePanelLabel(primary.module_number, primary.panel_code),
      workUnitLabel: workUnitLabel === '-' ? '' : workUnitLabel,
      openCheckCount,
    };
  };
  const openStationChecks = (station: StationSummary) => {
    if (!canExecuteChecks) {
      return;
    }
    const checks = stationActivity.get(station.id)?.openChecks ?? [];
    if (!checks.length) {
      return;
    }
    if (checks.length === 1) {
      const check = checks[0];
      navigate(`/qc/execute?check=${check.id}`, { state: { checkId: check.id } });
      return;
    }
    setStationSelection({ stationName: station.name, checks });
  };
  const closeStationSelection = () => {
    setStationSelection(null);
  };
  const handleSelectCheck = (check: QCCheckInstanceSummary) => {
    setStationSelection(null);
    navigate(`/qc/execute?check=${check.id}`, { state: { checkId: check.id } });
  };

  return (
    <div className="space-y-6">
      {(unauthorizedMessage || blockedMessage) && (
        <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--ink-muted)]">
          {blockedMessage ?? unauthorizedMessage}
          {!canExecuteChecks ? (
            <button
              type="button"
              onClick={() => navigate('/qc', { state: { qcLogin: true } })}
              className="ml-2 font-semibold text-[var(--ink)] underline"
            >
              Iniciar sesion
            </button>
          ) : null}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--ink-muted)]">
          {errorMessage}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-black/5 bg-white/90 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                Revisiones pendientes
              </p>
              <h3 className="mt-2 text-lg font-display text-[var(--ink)]">
                {pendingChecks.length} inspecciones abiertas
              </h3>
            </div>
            <ClipboardCheck className="h-5 w-5 text-[var(--ink-muted)]" />
          </div>
          <div className="mt-4 grid gap-3">
            {loading && !pendingChecks.length ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)]">
                Cargando revisiones pendientes...
              </div>
            ) : null}
            {!loading && !pendingChecks.length ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)]">
                No hay revisiones abiertas en este momento.
              </div>
            ) : null}
            {pendingChecks.map((check) => {
              const workUnitLabel = buildWorkUnitLabel(
                check.project_name,
                check.house_type_name,
                check.house_identifier
              );
              const cardContent = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink)]">
                        {check.check_name ?? 'Inspeccion sin titulo'}
                      </p>
                      <p className="text-xs text-[var(--ink-muted)]">{workUnitLabel}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        {check.module_number}
                        {check.panel_code ? ` · Panel ${check.panel_code}` : ''} ·{' '}
                        en {locationLabel(check.station_name, check.current_station_name)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(242,98,65,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink)]">
                      {scopeLabels[check.scope]}
                    </span>
                    <span>Creado {formatTimestamp(check.opened_at)}</span>
                  </div>
                </>
              );
              if (!canExecuteChecks) {
                return (
                  <div key={check.id} className={disabledCardClass} aria-disabled="true">
                    {cardContent}
                  </div>
                );
              }
              return (
                <Link
                  key={check.id}
                  to={`/qc/execute?check=${check.id}`}
                  state={{ checkId: check.id }}
                  className={baseCardClass}
                >
                  {cardContent}
                </Link>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-black/5 bg-white/90 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                Re-trabajos activos
              </p>
              <h3 className="mt-2 text-lg font-display text-[var(--ink)]">
                {reworkTasks.length} re-trabajos abiertos
              </h3>
            </div>
            <Wrench className="h-5 w-5 text-[var(--ink-muted)]" />
          </div>
          <div className="mt-4 grid gap-3">
            {loading && !reworkTasks.length ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)]">
                Cargando re-trabajos...
              </div>
            ) : null}
            {!loading && !reworkTasks.length ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)]">
                No hay re-trabajos activos.
              </div>
            ) : null}
            {reworkTasks.map((task) => {
              const workUnitLabel = buildWorkUnitLabel(
                task.project_name,
                task.house_type_name,
                task.house_identifier
              );
              const taskStatusLabel = task.task_status
                ? reworkTaskStatusLabels[task.task_status] ?? task.task_status
                : 'Sin iniciar';
              const checkReady = task.status === 'Done' && task.check_status === 'Open';
              const statusLabel = `${reworkStatusLabels[task.status]} · ${taskStatusLabel}`;
              const detailLine = checkReady
                ? 'Retrabajo completado · Reinspeccion pendiente'
                : `${task.description || 'Retrabajo en seguimiento'} · ${statusLabel}`;
              const cardContent = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-[var(--ink-muted)]">{workUnitLabel}</p>
                      <p className="text-sm font-semibold text-[var(--ink)]">
                        {task.module_number}
                        {task.panel_code ? ` · Panel ${task.panel_code}` : ''} ·{' '}
                        en {locationLabel(task.station_name, task.current_station_name)}
                      </p>
                      <p className="text-xs text-[var(--ink-muted)]">{detailLine}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                    <span>Creado {formatTimestamp(task.created_at)}</span>
                  </div>
                </>
              );
              if (!checkReady) {
                return (
                  <div
                    key={task.id}
                    className="rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm opacity-70"
                  >
                    {cardContent}
                  </div>
                );
              }
              if (!canExecuteChecks) {
                return (
                  <div key={task.id} className={disabledCardClass} aria-disabled="true">
                    {cardContent}
                  </div>
                );
              }
              return (
                <Link
                  key={task.id}
                  to={`/qc/execute?check=${task.check_instance_id}`}
                  state={{ rework: task, checkId: task.check_instance_id }}
                  className={clsx(baseCardClass, 'border-emerald-200')}
                >
                  {cardContent}
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
              Vista de planta
            </p>
            <h3 className="mt-2 text-lg font-display text-[var(--ink)]">
              Estaciones con inspecciones abiertas
            </h3>
          </div>
          <LayoutGrid className="h-5 w-5 text-[var(--ink-muted)]" />
        </div>
        {stationsError ? (
          <div className="mt-4 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--ink-muted)]">
            {stationsError}
          </div>
        ) : null}
        {!hasStations && stationsLoading ? (
          <div className="mt-4 rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)]">
            Cargando estaciones...
          </div>
        ) : null}
        {!hasStations && !stationsLoading ? (
          <div className="mt-4 rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)]">
            No hay estaciones para mostrar.
          </div>
        ) : null}
        {hasStations ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {stationGroups.map((group) => (
              <div
                key={group.id}
                className="rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                    {group.title}
                  </p>
                  <span className="text-[10px] text-[var(--ink-muted)]">
                    {group.stations.length} est.
                  </span>
                </div>
                <div className="mt-3 grid gap-2">
                  {group.stations.length ? (
                    group.stations.map((station) => {
                      const summary = getStationSummary(station.id);
                      const hasOpenChecks = summary.openCheckCount > 0;
                      const openCheckLabel = `${summary.openCheckCount} inspeccion${
                        summary.openCheckCount === 1 ? '' : 'es'
                      } abierta${summary.openCheckCount === 1 ? '' : 's'}`;
                      return (
                        <button
                          key={station.id}
                          type="button"
                          onClick={() => openStationChecks(station)}
                          disabled={!canExecuteChecks || !hasOpenChecks}
                          className={clsx(
                            'w-full rounded-xl border px-3 py-2 text-left transition',
                            hasOpenChecks
                              ? 'border-[rgba(242,98,65,0.3)] bg-[rgba(242,98,65,0.08)]'
                              : 'border-black/10 bg-white',
                            canExecuteChecks && hasOpenChecks
                              ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-sm'
                              : 'opacity-70',
                            'disabled:cursor-not-allowed disabled:opacity-70'
                          )}
                          aria-label={
                            hasOpenChecks
                              ? `Abrir ${openCheckLabel} en ${station.name}`
                              : `Sin inspecciones abiertas en ${station.name}`
                          }
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-[var(--ink)]">
                                {station.name}
                              </p>
                              <p className="text-[11px] text-[var(--ink-muted)]">
                                {summary.moduleLabel}
                              </p>
                            </div>
                            {hasOpenChecks ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-[rgba(242,98,65,0.16)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink)]"
                                aria-label={openCheckLabel}
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                                {summary.openCheckCount}
                              </span>
                            ) : null}
                          </div>
                          {summary.workUnitLabel ? (
                            <p className="mt-1 truncate text-[10px] text-[var(--ink-muted)]">
                              {summary.workUnitLabel}
                            </p>
                          ) : null}
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-xl border border-dashed border-black/10 bg-[var(--canvas)] px-3 py-3 text-xs text-[var(--ink-muted)]">
                      Sin estaciones configuradas.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {stationSelection && stationSelection.checks.length > 1 ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeStationSelection} />
          <div className="relative w-full max-w-xl rounded-2xl border border-black/10 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Inspecciones abiertas
                </p>
                <h4 className="mt-1 text-base font-display text-[var(--ink)]">
                  {stationSelection.stationName}
                </h4>
              </div>
              <button
                type="button"
                onClick={closeStationSelection}
                className="rounded-full p-2 text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto px-4 py-4">
              {stationSelection.checks.map((check) => {
                const workUnitLabel = buildWorkUnitLabel(
                  check.project_name,
                  check.house_type_name,
                  check.house_identifier
                );
                return (
                  <button
                    key={check.id}
                    type="button"
                    onClick={() => handleSelectCheck(check)}
                    className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--ink)]">
                          {check.check_name ?? 'Inspeccion sin titulo'}
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          {formatModulePanelLabel(check.module_number, check.panel_code)}
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">{workUnitLabel}</p>
                      </div>
                      <span className="text-xs text-[var(--ink-muted)]">
                        {formatTimestamp(check.opened_at)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
};

export default QCDashboard;
