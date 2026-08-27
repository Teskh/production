import React, { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  MessageSquareWarning,
  RefreshCw,
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type QCQualityMetrics = {
  range: {
    date_from: string;
    date_to: string;
    timezone: string;
  };
  checks: {
    total: number;
    triggered: number;
    not_performed: number;
    open: number;
  };
  observations: {
    total: number;
    open: number;
  };
  affected_modules: number;
  modules: Array<{
    work_unit_id: number;
    module_number: number;
    project_name: string | null;
    house_identifier: string | null;
    house_type_name: string | null;
    triggered_checks: number;
    not_performed_checks: number;
    open_checks: number;
    open_observations: number;
  }>;
};

type DateRange = { from: string; to: string };

const formatDateInput = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const activeWorkWeek = (now = new Date()): DateRange => {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayFromMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - dayFromMonday);
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  return { from: formatDateInput(monday), to: formatDateInput(friday) };
};

const formatRangeDate = (value: string): string => {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
};

const percentage = (value: number, total: number): string =>
  total > 0 ? `${Math.round((value / total) * 100)}%` : '—';

const DashboardQualityCompliance: React.FC = () => {
  const initialRange = useMemo(() => activeWorkWeek(), []);
  const [draftRange, setDraftRange] = useState<DateRange>(initialRange);
  const [range, setRange] = useState<DateRange>(initialRange);
  const [metrics, setMetrics] = useState<QCQualityMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: range.from, to: range.to });
    fetch(`${API_BASE_URL}/api/qc/dashboards/quality-compliance?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || `No se pudo cargar el dashboard (${response.status}).`);
        }
        return response.json() as Promise<QCQualityMetrics>;
      })
      .then(setMetrics)
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'No se pudo cargar el dashboard de calidad.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [range, refreshVersion]);

  const commitRange = (nextRange: DateRange) => {
    setLoading(true);
    setError(null);
    setRange(nextRange);
    setRefreshVersion((current) => current + 1);
  };

  const applyRange = (event: FormEvent) => {
    event.preventDefault();
    if (!draftRange.from || !draftRange.to) {
      setError('Selecciona ambas fechas.');
      return;
    }
    if (draftRange.from > draftRange.to) {
      setError('La fecha inicial no puede ser posterior a la fecha final.');
      return;
    }
    commitRange(draftRange);
  };

  const useActiveWeek = () => {
    const next = activeWorkWeek();
    setDraftRange(next);
    commitRange(next);
  };

  const riskModules = metrics?.modules.filter(
    (module) => module.not_performed_checks || module.open_checks || module.open_observations,
  ) ?? [];

  return (
    <div className="qc-page qc-page--wide qc-quality-metrics space-y-5">
      <header className="qc-page__header">
        <div>
          <p className="qc-page__eyebrow">Dashboard de calidad</p>
          <h2 className="qc-page__title">Cumplimiento de controles</h2>
          <p className="qc-page__intro">
            Checks abiertos en el rango, ejecuciones pendientes y observaciones que aún no cierran.
          </p>
        </div>
      </header>

      <form onSubmit={applyRange} className="qc-date-spine">
        <div className="qc-date-spine__label">
          <CalendarDays className="h-5 w-5" />
          <span>Rango</span>
        </div>
        <label>
          <span>Desde</span>
          <input
            type="date"
            value={draftRange.from}
            onChange={(event) => setDraftRange((current) => ({ ...current, from: event.target.value }))}
          />
        </label>
        <div className="qc-date-spine__rule" aria-hidden="true" />
        <label>
          <span>Hasta</span>
          <input
            type="date"
            value={draftRange.to}
            onChange={(event) => setDraftRange((current) => ({ ...current, to: event.target.value }))}
          />
        </label>
        <button type="submit" className="qc-btn qc-btn--primary">
          <RefreshCw className="h-4 w-4" />
          Aplicar
        </button>
        <button type="button" onClick={useActiveWeek} className="qc-btn">
          Semana activa
        </button>
      </form>

      <div className="qc-range-caption">
        {formatRangeDate(range.from)} — {formatRangeDate(range.to)}
        <span>Lunes a viernes para el atajo de semana activa</span>
      </div>

      {error && <div className="qc-notice qc-notice--error">{error}</div>}
      {loading && (
        <div className="qc-card flex items-center gap-3 p-6 text-sm text-[var(--qc-muted)]">
          <Loader2 className="h-5 w-5 animate-spin text-[#002FA7]" />
          Calculando indicadores…
        </div>
      )}

      {metrics && !loading && (
        <>
          <section className="grid gap-px bg-[var(--qc-line)] sm:grid-cols-2 xl:grid-cols-4">
            <article className="qc-metric-tile">
              <ClipboardCheck className="h-5 w-5 text-[#002FA7]" />
              <strong>{metrics.checks.triggered}</strong>
              <h3>Checks disparados</h3>
              <p>{metrics.checks.total} checks creados en el rango</p>
            </article>
            <article className="qc-metric-tile qc-metric-tile--alert">
              <AlertCircle className="h-5 w-5" />
              <strong>{metrics.checks.not_performed}</strong>
              <h3>Sin realizar</h3>
              <p>{percentage(metrics.checks.not_performed, metrics.checks.triggered)} de los checks disparados</p>
            </article>
            <article className="qc-metric-tile">
              <CheckCircle2 className="h-5 w-5 text-[#002FA7]" />
              <strong>{metrics.checks.open}</strong>
              <h3>Checks sin cerrar</h3>
              <p>Estado abierto al momento de la consulta</p>
            </article>
            <article className="qc-metric-tile">
              <MessageSquareWarning className="h-5 w-5 text-[#002FA7]" />
              <strong>{metrics.observations.open}</strong>
              <h3>Observaciones sin cerrar</h3>
              <p>De {metrics.observations.total} creadas en el rango</p>
            </article>
          </section>

          <section className="qc-card overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--qc-line)] bg-white px-5 py-4">
              <div>
                <p className="qc-page__eyebrow">Detalle por módulo</p>
                <h3 className="mt-1 text-lg font-semibold">Módulos con pendientes</h3>
              </div>
              <div className="qc-module-count">
                <strong>{metrics.affected_modules}</strong>
                <span>módulos afectados</span>
              </div>
            </div>

            {riskModules.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--qc-muted)]">
                No hay checks sin realizar ni casos abiertos en este rango.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="qc-metrics-table">
                  <thead>
                    <tr>
                      <th>Proyecto / vivienda</th>
                      <th>Módulo</th>
                      <th>Disparados</th>
                      <th>Sin realizar</th>
                      <th>Checks abiertos</th>
                      <th>Observaciones abiertas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riskModules.map((module) => (
                      <tr key={module.work_unit_id}>
                        <td>
                          <strong>{module.project_name || 'Sin proyecto'}</strong>
                          <span>{[module.house_identifier, module.house_type_name].filter(Boolean).join(' · ') || 'Sin identificación'}</span>
                        </td>
                        <td className="qc-metrics-table__number">{module.module_number}</td>
                        <td className="qc-metrics-table__number">{module.triggered_checks}</td>
                        <td className="qc-metrics-table__number qc-metrics-table__alert">{module.not_performed_checks}</td>
                        <td className="qc-metrics-table__number">{module.open_checks}</td>
                        <td className="qc-metrics-table__number">{module.open_observations}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="qc-dashboard-definition">
            <strong>Cómo se calculan</strong>
            <span><b>Sin realizar:</b> check automático disparado en el rango sin ninguna ejecución registrada.</span>
            <span><b>Sin cerrar:</b> check u observación creado en el rango cuyo estado actual todavía no es cerrado.</span>
          </aside>
        </>
      )}
    </div>
  );
};

export default DashboardQualityCompliance;
