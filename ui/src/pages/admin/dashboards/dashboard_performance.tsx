import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Monitor, RefreshCcw, Timer } from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type PerformanceMetricRow = {
  key: string;
  count: number;
  error_count: number;
  avg_ms?: number | null;
  p50_ms?: number | null;
  p95_ms?: number | null;
  server_p50_ms?: number | null;
  server_p95_ms?: number | null;
};

type PerformanceDeviceRow = {
  device_id: string;
  device_name?: string | null;
  count: number;
  p95_ms?: number | null;
};

type PerformanceSummaryResponse = {
  from_utc: string;
  to_utc: string;
  total_events: number;
  truncated?: boolean;
  api_requests: PerformanceMetricRow[];
  page_loads: PerformanceMetricRow[];
  devices: PerformanceDeviceRow[];
};

const buildHeaders = (options: RequestInit): Headers => {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
};

const apiRequest = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
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
    return undefined as T;
  }
  return (await response.json()) as T;
};

const formatMs = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }
  if (value < 1000) {
    return `${value.toFixed(0)} ms`;
  }
  return `${(value / 1000).toFixed(2)} s`;
};

const formatPct = (value: number): string => `${(value * 100).toFixed(1)}%`;

const HOURS_OPTIONS = [1, 6, 12, 24, 72, 168];

const DashboardPerformance: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [hours, setHours] = useState(24);
  const [limit, setLimit] = useState(20);
  const [summary, setSummary] = useState<PerformanceSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setHeader({
      title: 'Performance (RUM)',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        hours: String(hours),
        limit: String(limit),
      });
      const data = await apiRequest<PerformanceSummaryResponse>(
        `/api/performance/summary?${params.toString()}`
      );
      setSummary(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo cargar el dashboard.';
      setError(message);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [hours, limit]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const totals = useMemo(() => {
    const apiCount = summary?.api_requests.reduce((acc, row) => acc + row.count, 0) ?? 0;
    const apiErrors = summary?.api_requests.reduce((acc, row) => acc + row.error_count, 0) ?? 0;
    const pageCount = summary?.page_loads.reduce((acc, row) => acc + row.count, 0) ?? 0;
    return {
      apiCount,
      apiErrors,
      pageCount,
      apiErrorRate: apiCount > 0 ? apiErrors / apiCount : 0,
    };
  }, [summary]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-black/5 bg-white/85 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">
              Real User Monitoring
            </p>
            <h1 className="mt-1 font-display text-xl text-[var(--ink)]">Rendimiento por dispositivo</h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Mide tiempos reales de carga y API desde los equipos donde corre la app.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadSummary()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)] transition hover:bg-black/5 disabled:opacity-60"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refrescar
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
            Ventana
            <select
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
              className="rounded-lg border border-black/10 bg-white px-2 py-1 text-sm text-[var(--ink)]"
            >
              {HOURS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  Ultimas {value}h
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
            Top filas
            <input
              type="number"
              min={5}
              max={100}
              value={limit}
              onChange={(event) => setLimit(Math.max(5, Math.min(100, Number(event.target.value) || 20)))}
              className="w-20 rounded-lg border border-black/10 bg-white px-2 py-1 text-sm text-[var(--ink)]"
            />
          </label>
        </div>

        {summary && (
          <p className="mt-3 text-xs text-[var(--ink-muted)]">
            Rango: {new Date(summary.from_utc).toLocaleString()} - {new Date(summary.to_utc).toLocaleString()}
            {summary.truncated ? ' (muestra truncada para proteger rendimiento)' : ''}
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)]">Eventos</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{summary?.total_events ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)]">API</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{totals.apiCount}</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)]">Cargas de pagina</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{totals.pageCount}</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)]">Error API</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{formatPct(totals.apiErrorRate)}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-[var(--accent)]" />
          <h2 className="text-lg font-semibold text-[var(--ink)]">Paginas (page_load)</h2>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                <th className="px-2 py-2">Pagina</th>
                <th className="px-2 py-2">Muestras</th>
                <th className="px-2 py-2">p50</th>
                <th className="px-2 py-2">p95</th>
                <th className="px-2 py-2">Promedio</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.page_loads ?? []).map((row) => (
                <tr key={row.key} className="border-b border-black/5 text-[var(--ink)]">
                  <td className="px-2 py-2 font-mono text-xs">{row.key}</td>
                  <td className="px-2 py-2">{row.count}</td>
                  <td className="px-2 py-2">{formatMs(row.p50_ms)}</td>
                  <td className="px-2 py-2 font-semibold">{formatMs(row.p95_ms)}</td>
                  <td className="px-2 py-2">{formatMs(row.avg_ms)}</td>
                </tr>
              ))}
              {!loading && (summary?.page_loads.length ?? 0) === 0 && (
                <tr>
                  <td className="px-2 py-4 text-[var(--ink-muted)]" colSpan={5}>
                    Sin datos en este rango.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[var(--accent)]" />
          <h2 className="text-lg font-semibold text-[var(--ink)]">API (client + server timing)</h2>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                <th className="px-2 py-2">Endpoint</th>
                <th className="px-2 py-2">Muestras</th>
                <th className="px-2 py-2">Error</th>
                <th className="px-2 py-2">p50</th>
                <th className="px-2 py-2">p95</th>
                <th className="px-2 py-2">Srv p95</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.api_requests ?? []).map((row) => {
                const errorRate = row.count > 0 ? row.error_count / row.count : 0;
                return (
                  <tr key={row.key} className="border-b border-black/5 text-[var(--ink)]">
                    <td className="px-2 py-2 font-mono text-xs">{row.key}</td>
                    <td className="px-2 py-2">{row.count}</td>
                    <td className="px-2 py-2">{formatPct(errorRate)}</td>
                    <td className="px-2 py-2">{formatMs(row.p50_ms)}</td>
                    <td className="px-2 py-2 font-semibold">{formatMs(row.p95_ms)}</td>
                    <td className="px-2 py-2">{formatMs(row.server_p95_ms)}</td>
                  </tr>
                );
              })}
              {!loading && (summary?.api_requests.length ?? 0) === 0 && (
                <tr>
                  <td className="px-2 py-4 text-[var(--ink-muted)]" colSpan={6}>
                    Sin datos en este rango.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-[var(--accent)]" />
          <h2 className="text-lg font-semibold text-[var(--ink)]">Dispositivos</h2>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                <th className="px-2 py-2">Dispositivo</th>
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Muestras</th>
                <th className="px-2 py-2">p95</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.devices ?? []).map((row) => (
                <tr key={row.device_id} className="border-b border-black/5 text-[var(--ink)]">
                  <td className="px-2 py-2">{row.device_name || 'Sin nombre'}</td>
                  <td className="px-2 py-2 font-mono text-xs">{row.device_id}</td>
                  <td className="px-2 py-2">{row.count}</td>
                  <td className="px-2 py-2 font-semibold">{formatMs(row.p95_ms)}</td>
                </tr>
              ))}
              {!loading && (summary?.devices.length ?? 0) === 0 && (
                <tr>
                  <td className="px-2 py-4 text-[var(--ink-muted)]" colSpan={4}>
                    Sin datos en este rango.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default DashboardPerformance;
