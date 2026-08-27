import React, { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ClipboardX,
  Factory,
  Loader2,
  RefreshCw,
  Repeat2,
  Wrench,
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type DateRange = { from: string; to: string };

type FailureRankingItem = {
  dimension_id: number | null;
  name: string;
  executions: number;
  failures: number;
  failure_rate: number;
};

type FailureAnalysisResponse = {
  range: { date_from: string; date_to: string; timezone: string };
  summary: {
    executions: number;
    failures: number;
    passes: number;
    waived: number;
    failure_rate: number;
    affected_modules: number;
    repeat_failure_checks: number;
    open_reworks: number;
    critical_checks: number;
  };
  tasks: FailureRankingItem[];
  stations: FailureRankingItem[];
  checks: FailureRankingItem[];
  failure_modes: Array<{
    failure_mode_definition_id: number | null;
    name: string;
    occurrences: number;
  }>;
  severities: Array<{ severity: string; failures: number }>;
  daily: Array<{
    date: string;
    executions: number;
    failures: number;
    failure_rate: number;
  }>;
};

const formatDateInput = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const activeWorkWeek = (now = new Date()): DateRange => {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  return { from: formatDateInput(monday), to: formatDateInput(friday) };
};

const percentage = (value: number): string =>
  new Intl.NumberFormat('es-CL', {
    style: 'percent',
    minimumFractionDigits: value > 0 && value < 0.1 ? 1 : 0,
    maximumFractionDigits: 1,
  }).format(value);

const formatRangeDate = (value: string): string => {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
};

const formatShortDate = (value: string): string => {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CL', {
    weekday: 'short',
    day: '2-digit',
  }).format(new Date(year, month - 1, day));
};

const severityLabels: Record<string, string> = {
  critica: 'Crítica',
  media: 'Media',
  baja: 'Baja',
  sin_severidad: 'Sin severidad',
};

type RankingColumnProps = {
  title: string;
  items: FailureRankingItem[];
  mode: 'absolute' | 'relative';
  minimumSamples: number;
};

const RankingColumn: React.FC<RankingColumnProps> = ({
  title,
  items,
  mode,
  minimumSamples,
}) => {
  const ranked = useMemo(() => {
    const eligible = items.filter(
      (item) => item.failures > 0 && (mode === 'absolute' || item.executions >= minimumSamples),
    );
    return eligible
      .sort((left, right) =>
        mode === 'absolute'
          ? right.failures - left.failures || right.failure_rate - left.failure_rate
          : right.failure_rate - left.failure_rate || right.failures - left.failures,
      )
      .slice(0, 7);
  }, [items, minimumSamples, mode]);

  const maximum = Math.max(
    1,
    ...ranked.map((item) => (mode === 'absolute' ? item.failures : item.failure_rate)),
  );

  return (
    <div className="qc-failure-ranking-column">
      <div className="qc-failure-ranking-column__header">
        <h4>{title}</h4>
        <span>{mode === 'absolute' ? 'Fallas' : 'Tasa'}</span>
      </div>
      {ranked.length === 0 ? (
        <p className="qc-failure-empty">
          {mode === 'relative'
            ? `Sin elementos con al menos ${minimumSamples} controles y una falla.`
            : 'No hay fallas en el rango.'}
        </p>
      ) : (
        <ol className="qc-failure-ranking-list">
          {ranked.map((item, index) => {
            const magnitude = mode === 'absolute' ? item.failures : item.failure_rate;
            return (
              <li key={`${item.dimension_id ?? 'none'}-${item.name}`}>
                <span className="qc-failure-ranking-list__index">{index + 1}</span>
                <div className="qc-failure-ranking-list__body">
                  <div className="qc-failure-ranking-list__label">
                    <strong>{item.name}</strong>
                    <span>{item.failures} fallas / {item.executions} controles</span>
                  </div>
                  <div className="qc-failure-ranking-list__track" aria-hidden="true">
                    <span style={{ width: `${(magnitude / maximum) * 100}%` }} />
                  </div>
                </div>
                <b>{mode === 'absolute' ? item.failures : percentage(item.failure_rate)}</b>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};

type DualRankingProps = {
  eyebrow: string;
  title: string;
  description: string;
  items: FailureRankingItem[];
  minimumSamples: number;
};

const DualRanking: React.FC<DualRankingProps> = ({
  eyebrow,
  title,
  description,
  items,
  minimumSamples,
}) => (
  <section className="qc-card overflow-hidden">
    <div className="qc-failure-section-header">
      <div>
        <p className="qc-page__eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
    <div className="qc-failure-dual-grid">
      <RankingColumn
        title="Mayor volumen"
        items={items}
        mode="absolute"
        minimumSamples={minimumSamples}
      />
      <RankingColumn
        title="Mayor tasa"
        items={items}
        mode="relative"
        minimumSamples={minimumSamples}
      />
    </div>
  </section>
);

const DashboardFailureAnalysis: React.FC = () => {
  const initialRange = useMemo(() => activeWorkWeek(), []);
  const [draftRange, setDraftRange] = useState<DateRange>(initialRange);
  const [range, setRange] = useState<DateRange>(initialRange);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [minimumSamples, setMinimumSamples] = useState(3);
  const [data, setData] = useState<FailureAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: range.from, to: range.to });
    fetch(`${API_BASE_URL}/api/qc/dashboards/failure-analysis?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || `No se pudo cargar el dashboard (${response.status}).`);
        }
        return response.json() as Promise<FailureAnalysisResponse>;
      })
      .then(setData)
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'No se pudo cargar el análisis de fallas.',
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

  const maxDailyExecutions = Math.max(1, ...(data?.daily.map((item) => item.executions) ?? []));
  const maxFailureModeOccurrences = Math.max(
    1,
    ...(data?.failure_modes.map((item) => item.occurrences) ?? []),
  );

  return (
    <div className="qc-page qc-page--wide qc-quality-metrics qc-failure-analysis space-y-5">
      <header className="qc-page__header">
        <div>
          <p className="qc-page__eyebrow">Dashboard de calidad</p>
          <h2 className="qc-page__title">Análisis de fallas</h2>
          <p className="qc-page__intro">
            Ubica dónde se concentran las fallas y dónde representan una mayor proporción de los controles realizados.
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
        <button type="button" onClick={useActiveWeek} className="qc-btn">Semana activa</button>
      </form>

      <div className="qc-range-caption">
        {formatRangeDate(range.from)} — {formatRangeDate(range.to)}
        <label className="qc-failure-sample-filter">
          <span>Mínimo para tasa</span>
          <select value={minimumSamples} onChange={(event) => setMinimumSamples(Number(event.target.value))}>
            {[1, 3, 5, 10, 20].map((value) => (
              <option key={value} value={value}>{value} controles</option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="qc-notice qc-notice--error">{error}</div>}
      {loading && (
        <div className="qc-card flex items-center gap-3 p-6 text-sm text-[var(--qc-muted)]">
          <Loader2 className="h-5 w-5 animate-spin text-[#002FA7]" />
          Calculando fallas y tasas…
        </div>
      )}

      {data && !loading && (
        <>
          <section className="grid gap-px bg-[var(--qc-line)] sm:grid-cols-2 xl:grid-cols-5">
            <article className="qc-metric-tile">
              <Factory className="h-5 w-5 text-[#002FA7]" />
              <strong>{data.summary.executions}</strong>
              <h3>Controles ejecutados</h3>
              <p>{data.summary.passes} aprobados · {data.summary.waived} eximidos</p>
            </article>
            <article className="qc-metric-tile qc-metric-tile--alert">
              <ClipboardX className="h-5 w-5" />
              <strong>{data.summary.failures}</strong>
              <h3>Fallas</h3>
              <p>{data.summary.critical_checks} checks críticos</p>
            </article>
            <article className="qc-metric-tile">
              <AlertTriangle className="h-5 w-5 text-[#002FA7]" />
              <strong>{percentage(data.summary.failure_rate)}</strong>
              <h3>Tasa de falla</h3>
              <p>Fallas sobre controles ejecutados</p>
            </article>
            <article className="qc-metric-tile">
              <Repeat2 className="h-5 w-5 text-[#002FA7]" />
              <strong>{data.summary.repeat_failure_checks}</strong>
              <h3>Checks reincidentes</h3>
              <p>Dos o más fallas en el rango</p>
            </article>
            <article className="qc-metric-tile">
              <Wrench className="h-5 w-5 text-[#002FA7]" />
              <strong>{data.summary.open_reworks}</strong>
              <h3>Retrabajos abiertos</h3>
              <p>{data.summary.affected_modules} módulos con fallas</p>
            </article>
          </section>

          <DualRanking
            eyebrow="Origen productivo"
            title="Tareas que más fallan"
            description="Solo considera checks vinculados a una tarea de producción. La tasa usa los controles ejecutados para esa tarea."
            items={data.tasks}
            minimumSamples={minimumSamples}
          />

          <DualRanking
            eyebrow="Ubicación"
            title="Estaciones con más fallas"
            description="La estación corresponde a la registrada al abrir el check. Volumen y tasa se presentan por separado."
            items={data.stations}
            minimumSamples={minimumSamples}
          />

          <section className="qc-card overflow-hidden">
            <div className="qc-failure-section-header">
              <div>
                <p className="qc-page__eyebrow">Evolución</p>
                <h3>Fallas por día</h3>
                <p>La barra completa representa controles ejecutados; el tramo azul muestra fallas.</p>
              </div>
            </div>
            <div className="qc-failure-daily-chart">
              {data.daily.map((item) => (
                <div key={item.date} className="qc-failure-day" title={`${item.failures} fallas de ${item.executions} controles (${percentage(item.failure_rate)})`}>
                  <div className="qc-failure-day__plot">
                    <span
                      className="qc-failure-day__executions"
                      style={{ height: `${(item.executions / maxDailyExecutions) * 100}%` }}
                    />
                    <span
                      className="qc-failure-day__failures"
                      style={{ height: `${(item.failures / maxDailyExecutions) * 100}%` }}
                    />
                  </div>
                  <strong>{item.failures}</strong>
                  <span>{formatShortDate(item.date)}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-px bg-[var(--qc-line)] lg:grid-cols-2">
            <section className="qc-failure-breakdown bg-white">
              <div className="qc-failure-section-header">
                <div>
                  <p className="qc-page__eyebrow">Diagnóstico</p>
                  <h3>Modos de falla</h3>
                  <p>Ocurrencias registradas; una ejecución puede tener más de un modo.</p>
                </div>
              </div>
              {data.failure_modes.length === 0 ? (
                <p className="qc-failure-empty">No hay modos de falla registrados en el rango.</p>
              ) : (
                <ol className="qc-failure-mode-list">
                  {data.failure_modes.slice(0, 8).map((item) => (
                    <li key={`${item.failure_mode_definition_id ?? 'other'}-${item.name}`}>
                      <div><strong>{item.name}</strong><span>{item.occurrences}</span></div>
                      <span className="qc-failure-mode-list__track">
                        <i style={{ width: `${(item.occurrences / maxFailureModeOccurrences) * 100}%` }} />
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="qc-failure-breakdown bg-white">
              <div className="qc-failure-section-header">
                <div>
                  <p className="qc-page__eyebrow">Impacto</p>
                  <h3>Severidad de las fallas</h3>
                  <p>Checks fallidos únicos según su severidad actual.</p>
                </div>
              </div>
              <div className="qc-failure-severity-grid">
                {data.severities.map((item) => (
                  <div key={item.severity}>
                    <strong>{item.failures}</strong>
                    <span>{severityLabels[item.severity] ?? item.severity}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="qc-card overflow-hidden">
            <div className="qc-failure-section-header">
              <div>
                <p className="qc-page__eyebrow">Tipo de control</p>
                <h3>Checks con mayor recurrencia de fallas</h3>
                <p>Ayuda a distinguir problemas del proceso de controles particularmente exigentes.</p>
              </div>
            </div>
            {data.checks.filter((item) => item.failures > 0).length === 0 ? (
              <p className="qc-failure-empty">No hay checks fallidos en el rango.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="qc-metrics-table">
                  <thead><tr><th>Check</th><th>Controles</th><th>Fallas</th><th>Tasa</th></tr></thead>
                  <tbody>
                    {data.checks.filter((item) => item.failures > 0).slice(0, 12).map((item) => (
                      <tr key={`${item.dimension_id ?? 'manual'}-${item.name}`}>
                        <td><strong>{item.name}</strong></td>
                        <td className="qc-metrics-table__number">{item.executions}</td>
                        <td className="qc-metrics-table__number qc-metrics-table__alert">{item.failures}</td>
                        <td className="qc-metrics-table__number">{percentage(item.failure_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="qc-dashboard-definition">
            <strong>Lectura correcta</strong>
            <span><b>Volumen:</b> cantidad absoluta de ejecuciones con resultado Fallar.</span>
            <span><b>Tasa:</b> fallas divididas por todos los controles ejecutados en la misma tarea, estación o check. No usa producción total como denominador.</span>
          </aside>
        </>
      )}
    </div>
  );
};

export default DashboardFailureAnalysis;
