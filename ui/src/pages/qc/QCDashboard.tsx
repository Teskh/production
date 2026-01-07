import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ClipboardCheck, Wrench } from 'lucide-react';
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
  panel_code: string | null;
  created_at: string;
};

type QCDashboardResponse = {
  pending_checks: QCCheckInstanceSummary[];
  rework_tasks: QCReworkTaskSummary[];
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
  const baseCardClass =
    'group rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md';
  const disabledCardClass = clsx(baseCardClass, 'pointer-events-none opacity-70');
  const locationLabel = (stationName: string | null, currentName: string | null) =>
    currentName ?? stationName ?? 'Sin estacion';
  const unauthorizedMessage = isUnauthorized
    ? 'Inicia sesion para ver inspecciones pendientes y re-trabajos.'
    : null;

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
              const cardContent = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink)]">
                        {check.check_name ?? 'Inspeccion sin titulo'}
                      </p>
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

    </div>
  );
};

export default QCDashboard;
