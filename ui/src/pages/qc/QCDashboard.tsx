import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from 'lucide-react';

import {
  CHECK_DEFINITIONS,
  PENDING_CHECKS,
  REWORK_TASKS,
} from '../../services/qcMockData';

const REFRESH_INTERVAL_MS = 20000;

const formatTime = (date: Date): string =>
  date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

const QCDashboard: React.FC = () => {
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [loginOpen, setLoginOpen] = useState(false);
  const [qcUser, setQcUser] = useState<{ name: string } | null>(null);
  const [loginDraft, setLoginDraft] = useState({
    firstName: '',
    lastName: '',
    pin: '',
  });

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLastUpdated(new Date());
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  const checkDefinitionById = useMemo(
    () =>
      new Map(Object.values(CHECK_DEFINITIONS).map((check) => [check.id, check])),
    []
  );

  const stationSummary = useMemo(() => {
    const summary = new Map<
      string,
      { stationName: string; pendingCount: number; reworkCount: number }
    >();
    PENDING_CHECKS.forEach((check) => {
      const entry = summary.get(check.stationName) ?? {
        stationName: check.stationName,
        pendingCount: 0,
        reworkCount: 0,
      };
      entry.pendingCount += 1;
      summary.set(check.stationName, entry);
    });
    REWORK_TASKS.forEach((task) => {
      const entry = summary.get(task.stationName) ?? {
        stationName: task.stationName,
        pendingCount: 0,
        reworkCount: 0,
      };
      entry.reworkCount += 1;
      summary.set(task.stationName, entry);
    });
    return Array.from(summary.values()).sort(
      (a, b) => b.pendingCount + b.reworkCount - (a.pendingCount + a.reworkCount)
    );
  }, []);

  const handleLoginSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fullName = `${loginDraft.firstName} ${loginDraft.lastName}`.trim();
    if (!fullName) {
      return;
    }
    setQcUser({ name: fullName });
    setLoginOpen(false);
    setLoginDraft({ firstName: '', lastName: '', pin: '' });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-black/5 bg-white/80 p-6 shadow-sm">
        <div className="flex flex-wrap items-start gap-6">
          <div className="min-w-[220px]">
            <p className="text-[11px] uppercase tracking-[0.35em] text-[var(--ink-muted)]">
              Control de calidad
            </p>
            <h2 className="mt-2 text-2xl font-display text-[var(--ink)]">
              Tablero operativo QC
            </h2>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Revisa inspecciones pendientes, re-trabajos activos y la concentracion por
              estacion.
            </p>
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.25)] px-4 py-3">
              <ShieldCheck className="h-5 w-5 text-[var(--ink)]" />
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Operador QC
                </p>
                <p className="text-sm font-medium text-[var(--ink)]">
                  {qcUser ? qcUser.name : 'Sesion sin iniciar'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                <RefreshCw className="h-3.5 w-3.5" />
                Auto-refresco cada {Math.floor(REFRESH_INTERVAL_MS / 1000)}s
              </div>
              <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                <CalendarClock className="h-3.5 w-3.5" />
                Actualizado {formatTime(lastUpdated)}
              </div>
              <button
                onClick={() => setLoginOpen(true)}
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm"
              >
                {qcUser ? 'Cambiar usuario' : 'Iniciar sesion'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Revisiones pendientes
                </p>
                <h3 className="mt-2 text-lg font-display text-[var(--ink)]">
                  {PENDING_CHECKS.length} inspecciones abiertas
                </h3>
              </div>
              <ClipboardCheck className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>
            <div className="mt-4 grid gap-3">
              {PENDING_CHECKS.map((check) => {
                const definition = checkDefinitionById.get(check.checkDefinitionId);
                return (
                  <Link
                    key={check.id}
                    to={`/qc/execute?check=${check.id}`}
                    className="group rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--ink)]">
                          {definition?.name ?? 'Inspeccion sin titulo'}
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          {check.moduleNumber}
                          {check.panelCode ? ` · Panel ${check.panelCode}` : ''} ·{' '}
                          {check.stationName}
                        </p>
                      </div>
                      <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] text-[var(--ink-muted)]">
                        {check.samplingType}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(242,98,65,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink)]">
                        {check.scope}
                      </span>
                      <span>Creado {check.createdAt}</span>
                    </div>
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
                  {REWORK_TASKS.length} re-trabajos abiertos
                </h3>
              </div>
              <Wrench className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>
            <div className="mt-4 grid gap-3">
              {REWORK_TASKS.map((task) => (
                <Link
                  key={task.id}
                  to={`/qc/execute?rework=${task.id}`}
                  className="group rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink)]">
                        {task.moduleNumber} · {task.stationName}
                      </p>
                      <p className="text-xs text-[var(--ink-muted)]">{task.description}</p>
                    </div>
                    <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] text-[var(--ink-muted)]">
                      {task.status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                    <span className="rounded-full bg-[rgba(47,107,79,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink)]">
                      Prioridad {task.priority}
                    </span>
                    <span>Creado {task.createdAt}</span>
                    {task.assignedWorker && <span>Asignado a {task.assignedWorker}</span>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Concentracion de hallazgos
                </p>
                <h3 className="mt-2 text-lg font-display text-[var(--ink)]">
                  Estaciones con mas carga
                </h3>
              </div>
              <AlertTriangle className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>
            <div className="mt-4 space-y-3">
              {stationSummary.map((station) => (
                <div
                  key={station.stationName}
                  className="rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.2)] px-4 py-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-[var(--ink)]">
                      {station.stationName}
                    </p>
                    <span className="text-xs text-[var(--ink-muted)]">
                      {station.pendingCount + station.reworkCount} total
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[var(--ink)]">
                      {station.pendingCount} pendientes
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[var(--ink)]">
                      {station.reworkCount} re-trabajos
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {loginOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                Acceso QC
              </p>
              <h3 className="mt-2 text-lg font-display text-[var(--ink)]">
                Iniciar sesion de control
              </h3>
            </div>
            <form className="mt-4 space-y-3" onSubmit={handleLoginSubmit}>
              <label className="text-sm text-[var(--ink-muted)]">
                Nombre
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                  value={loginDraft.firstName}
                  onChange={(event) =>
                    setLoginDraft((prev) => ({ ...prev, firstName: event.target.value }))
                  }
                />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                Apellido
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                  value={loginDraft.lastName}
                  onChange={(event) =>
                    setLoginDraft((prev) => ({ ...prev, lastName: event.target.value }))
                  }
                />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                PIN
                <input
                  type="password"
                  className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                  value={loginDraft.pin}
                  onChange={(event) =>
                    setLoginDraft((prev) => ({ ...prev, pin: event.target.value }))
                  }
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setLoginOpen(false)}
                  className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                >
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default QCDashboard;
