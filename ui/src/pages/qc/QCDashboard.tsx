import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ClipboardCheck, RefreshCw, Wrench } from 'lucide-react';
import { useQCSession } from '../../layouts/QCLayout';

const REFRESH_INTERVAL_MS = 20000;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

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
  work_unit_id: number;
  panel_unit_id: number | null;
  station_id: number | null;
  station_name: string | null;
  module_number: number;
  panel_code: string | null;
  created_at: string;
};

type QCDashboardResponse = {
  pending_checks: QCCheckInstanceSummary[];
  rework_tasks: QCReworkTaskSummary[];
};

const formatTime = (date: Date): string =>
  date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

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

const originLabels: Record<QCCheckOrigin, string> = {
  triggered: 'Disparada',
  manual: 'Manual',
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

const apiRequest = async <T,>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Solicitud fallida (${response.status})`);
  }
  return (await response.json()) as T;
};

const QCDashboard: React.FC = () => {
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [dashboard, setDashboard] = useState<QCDashboardResponse>({
    pending_checks: [],
    rework_tasks: [],
  });
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const session = useQCSession();

  useEffect(() => {
    let isMounted = true;
    const loadDashboard = async () => {
      try {
        const data = await apiRequest<QCDashboardResponse>('/api/qc/dashboard');
        if (!isMounted) {
          return;
        }
        setDashboard(data);
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
    return () => window.clearInterval(intervalId);
  }, []);

  const pendingChecks = useMemo(() => dashboard.pending_checks, [dashboard.pending_checks]);
  const reworkTasks = useMemo(() => dashboard.rework_tasks, [dashboard.rework_tasks]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
          <RefreshCw className="h-3.5 w-3.5" />
          Auto-refresco cada {Math.floor(REFRESH_INTERVAL_MS / 1000)}s
        </div>
        <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
          <CalendarClock className="h-3.5 w-3.5" />
          Actualizado {formatTime(lastUpdated)}
        </div>
        <div className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[var(--ink-muted)]">
          {session.first_name} {session.last_name}
        </div>
      </header>

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
            {pendingChecks.map((check) => (
              <Link
                key={check.id}
                to={`/qc/execute?check=${check.id}`}
                state={{ checkId: check.id }}
                className="group rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--ink)]">
                      {check.check_name ?? 'Inspeccion sin titulo'}
                    </p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {check.module_number}
                      {check.panel_code ? ` · Panel ${check.panel_code}` : ''} ·{' '}
                      {check.station_name ?? 'Sin estacion'}
                    </p>
                  </div>
                  <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] text-[var(--ink-muted)]">
                    {originLabels[check.origin]}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(242,98,65,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink)]">
                    {scopeLabels[check.scope]}
                  </span>
                  <span>Creado {formatTimestamp(check.opened_at)}</span>
                </div>
              </Link>
            ))}
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
            {reworkTasks.map((task) => (
              <Link
                key={task.id}
                to={`/qc/execute?rework=${task.id}`}
                state={{ rework: task, checkId: task.check_instance_id }}
                className="group rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--ink)]">
                      {task.module_number}
                      {task.panel_code ? ` · Panel ${task.panel_code}` : ''} ·{' '}
                      {task.station_name ?? 'Sin estacion'}
                    </p>
                    <p className="text-xs text-[var(--ink-muted)]">{task.description}</p>
                  </div>
                  <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] text-[var(--ink-muted)]">
                    {reworkStatusLabels[task.status]}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                  <span>Creado {formatTimestamp(task.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>

    </div>
  );
};

export default QCDashboard;
