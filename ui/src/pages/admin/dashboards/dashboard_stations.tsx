import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Filter, RefreshCcw } from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';
import { formatDateTime, formatMinutesWithUnit } from '../../../utils/timeUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type PanelTaskHistoryPause = {
  paused_at?: string | null;
  resumed_at?: string | null;
  duration_seconds?: number | null;
  reason?: string | null;
};

type PanelTaskHistoryRow = {
  task_instance_id: number;
  task_definition_id?: number | null;
  task_definition_name?: string | null;
  panel_definition_id?: number | null;
  panel_code?: string | null;
  house_type_id?: number | null;
  house_type_name?: string | null;
  house_sub_type_name?: string | null;
  house_identifier?: string | null;
  module_number?: number | null;
  station_id?: number | null;
  station_name?: string | null;
  worker_name?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  duration_minutes?: number | null;
  expected_minutes?: number | null;
  notes?: string | null;
  pauses?: PanelTaskHistoryPause[] | null;
};

type SortKey =
  | 'task_definition_name'
  | 'panel_code'
  | 'house_type_name'
  | 'house_sub_type_name'
  | 'house_identifier'
  | 'module_number'
  | 'started_at'
  | 'completed_at'
  | 'duration_minutes'
  | 'expected_minutes'
  | 'station_name'
  | 'worker_name'
  | 'notes';

const HISTORY_DATE_KEY = 'panelHistorySelectedDate';

const pad = (value: number) => String(value).padStart(2, '0');

const todayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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

const formatMinutes = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return '-';
  return formatMinutesWithUnit(value);
};

const buildPausesTitle = (pauses: PanelTaskHistoryPause[] | null | undefined) => {
  if (!pauses || pauses.length === 0) return '';
  return pauses
    .map((pause) => {
      const start = pause.paused_at ? formatDateTime(pause.paused_at, { preserveInvalid: true }) : '-';
      const end = pause.resumed_at ? formatDateTime(pause.resumed_at, { preserveInvalid: true }) : '-';
      const minutes = pause.duration_seconds != null ? Math.floor(pause.duration_seconds / 60) : 0;
      const reason = pause.reason || '-';
      return `${start} -> ${end} (${minutes} min) - ${reason}`;
    })
    .join('\n');
};

const summarizePauses = (pauses: PanelTaskHistoryPause[] | null | undefined) => {
  if (!pauses || pauses.length === 0) {
    return { text: '-', title: '' };
  }
  if (pauses.length === 1) {
    const pause = pauses[0];
    const minutes = pause.duration_seconds != null ? Math.floor(pause.duration_seconds / 60) : 0;
    const reason = pause.reason || '-';
    return {
      text: `Motivo: ${reason} - ${minutes} min`,
      title: buildPausesTitle(pauses),
    };
  }
  return {
    text: 'Varias pausas',
    title: buildPausesTitle(pauses),
  };
};

const escapeCsv = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const DashboardStations: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [rows, setRows] = useState<PanelTaskHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    const saved = localStorage.getItem(HISTORY_DATE_KEY);
    if (saved) return saved;
    return todayStr();
  });
  const [sortKey, setSortKey] = useState<SortKey>('started_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filters, setFilters] = useState({
    task_definition_name: '',
    panel_code: '',
    house_type_name: '',
    house_sub_type_name: '',
    house_identifier: '',
    module_number: '',
    station_name: '',
    worker_name: '',
    notes: '',
  });

  useEffect(() => {
    setHeader({
      title: 'Historico de produccion de paneles',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  const fetchData = async (dateStr = selectedDate) => {
    setLoading(true);
    setError('');
    setExportError('');
    try {
      const params = new URLSearchParams();
      if (dateStr) {
        params.set('from_date', dateStr);
        params.set('to_date', dateStr);
      }
      params.set('limit', '500');
      params.set('sort_by', 'started_at');
      params.set('sort_order', 'desc');

      const data = await apiRequest<PanelTaskHistoryRow[]>(
        `/api/panel-task-history?${params.toString()}`
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error cargando historico';
      setError(errorMessage);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeDay = (delta: number) => {
    const [y, m, d] = selectedDate.split('-').map((value) => Number.parseInt(value, 10));
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    const next = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    setSelectedDate(next);
    localStorage.setItem(HISTORY_DATE_KEY, next);
    fetchData(next);
  };

  const onDateChange = (value: string) => {
    setSelectedDate(value);
    localStorage.setItem(HISTORY_DATE_KEY, value);
    fetchData(value);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'started_at' || key === 'completed_at' ? 'desc' : 'asc');
  };

  const applyFilters = useCallback((arr: PanelTaskHistoryRow[]) => {
    const contains = (value: unknown, needle: string) =>
      String(value || '').toLowerCase().includes(needle.trim().toLowerCase());
    return arr.filter((row) => {
      return (
        contains(row.task_definition_name, filters.task_definition_name) &&
        contains(row.panel_code, filters.panel_code) &&
        contains(row.house_type_name, filters.house_type_name) &&
        contains(row.house_sub_type_name, filters.house_sub_type_name) &&
        contains(row.house_identifier, filters.house_identifier) &&
        contains(row.module_number, filters.module_number) &&
        contains(row.station_name, filters.station_name) &&
        contains(row.worker_name, filters.worker_name) &&
        contains(row.notes, filters.notes)
      );
    });
  }, [filters]);

  const sortRows = useCallback((arr: PanelTaskHistoryRow[]) => {
    const multiplier = sortDir === 'asc' ? 1 : -1;
    const toDate = (value: unknown) => {
      if (!value) return null;
      try {
        const parsed = new Date(String(value).replace(' ', 'T'));
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      } catch {
        return null;
      }
    };
    return [...arr].sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      const rawA: unknown = a[sortKey];
      const rawB: unknown = b[sortKey];
      if (sortKey === 'started_at' || sortKey === 'completed_at') {
        va = toDate(rawA)?.getTime() ?? 0;
        vb = toDate(rawB)?.getTime() ?? 0;
      } else if (
        sortKey === 'duration_minutes' ||
        sortKey === 'expected_minutes' ||
        sortKey === 'module_number'
      ) {
        va = Number(rawA ?? -1);
        vb = Number(rawB ?? -1);
      } else {
        va = String(rawA ?? '').toLowerCase();
        vb = String(rawB ?? '').toLowerCase();
      }
      if (va < vb) return -1 * multiplier;
      if (va > vb) return 1 * multiplier;
      return 0;
    });
  }, [sortDir, sortKey]);

  const filteredRows = useMemo(() => applyFilters(rows), [rows, applyFilters]);
  const tableRows = useMemo(() => sortRows(filteredRows), [filteredRows, sortRows]);

  const SortableTh: React.FC<{ label: string; col: SortKey }> = ({ label, col }) => (
    <th
      className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]"
    >
      <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort(col)}>
        {label}
        {sortKey === col && (
          <span className="text-[9px]">{sortDir === 'asc' ? '^' : 'v'}</span>
        )}
      </button>
    </th>
  );

  const handleExport = () => {
    setExportError('');
    setExporting(true);
    try {
      const headers = [
        'Tarea',
        'Panel',
        'Tipo vivienda',
        'Tipologia',
        'Identificador vivienda',
        'Modulo',
        'Inicio',
        'Fin',
        'Duracion',
        'Duracion esperada',
        'Estacion',
        'Trabajador',
        'Pausas',
        'Notas',
      ];
      const rowsForExport = tableRows.map((row) => {
        const pausesTitle = buildPausesTitle(row.pauses);
        return [
          row.task_definition_name || '-',
          row.panel_code || '-',
          row.house_type_name || '-',
          row.house_sub_type_name || '-',
          row.house_identifier || '-',
          row.module_number ?? '-',
          row.started_at || '-',
          row.completed_at || '-',
          row.duration_minutes ?? '',
          row.expected_minutes ?? '',
          row.station_name || '-',
          row.worker_name || '-',
          pausesTitle || '-',
          row.notes || '-',
        ];
      });
      const csvRows = [headers, ...rowsForExport];
      const csvContent = csvRows.map((row) => row.map(escapeCsv).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `panel-history-${selectedDate || todayStr()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error exportando CSV';
      setExportError(errorMessage);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-black/5 bg-white/80 shadow-sm px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Paneles</p>
            <h1 className="font-display text-xl text-[var(--ink)]">Historico de produccion de paneles</h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Revisa tareas completadas por estacion, trabajador y panel con sus pausas.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[var(--accent-soft)] bg-white/80 px-4 py-2 text-xs text-[var(--ink)]">
            <Filter className="h-4 w-4 text-[var(--accent)]" />
            {tableRows.length} registros visibles
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Filtros</p>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Seleccion de dia</h2>
          </div>
          <button
            type="button"
            onClick={() => fetchData(selectedDate)}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-black"
            disabled={loading}
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? 'Cargando...' : 'Actualizar'}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Dia
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="rounded-full border border-black/10 px-3 py-2 text-xs text-[var(--ink)]"
                onClick={() => changeDay(-1)}
                disabled={loading}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input
                className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                type="date"
                value={selectedDate}
                onChange={(event) => onDateChange(event.target.value)}
              />
              <button
                type="button"
                className="rounded-full border border-black/10 px-3 py-2 text-xs text-[var(--ink)]"
                onClick={() => changeDay(1)}
                disabled={loading}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </label>

          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)]"
            onClick={handleExport}
            disabled={loading || exporting || tableRows.length === 0}
          >
            <Download className="h-4 w-4" />
            {exporting ? 'Exportando...' : 'Exportar CSV'}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {!error && exportError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {exportError}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="overflow-x-auto border rounded-xl border-black/5 bg-white/50">
          {loading && (
            <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">Cargando datos...</div>
          )}

          {!loading && tableRows.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">Sin datos</div>
          )}

          {!loading && tableRows.length > 0 && (
            <table className="w-full min-w-[1200px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-black/10 bg-black/[0.02]">
                  <SortableTh label="Tarea" col="task_definition_name" />
                  <SortableTh label="Panel" col="panel_code" />
                  <SortableTh label="Tipo vivienda" col="house_type_name" />
                  <SortableTh label="Tipologia" col="house_sub_type_name" />
                  <SortableTh label="Identificador" col="house_identifier" />
                  <SortableTh label="Modulo" col="module_number" />
                  <SortableTh label="Inicio" col="started_at" />
                  <SortableTh label="Fin" col="completed_at" />
                  <SortableTh label="Duracion" col="duration_minutes" />
                  <SortableTh label="Esperado" col="expected_minutes" />
                  <SortableTh label="Estacion" col="station_name" />
                  <SortableTh label="Trabajador" col="worker_name" />
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                    Pausas
                  </th>
                  <SortableTh label="Notas" col="notes" />
                </tr>
                <tr className="border-b border-black/10 text-[11px]">
                  <td className="px-2 py-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-[var(--ink)]"
                      placeholder="Filtrar..."
                      value={filters.task_definition_name}
                      onChange={(event) => setFilters((prev) => ({ ...prev, task_definition_name: event.target.value }))}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-[var(--ink)]"
                      placeholder="Filtrar..."
                      value={filters.panel_code}
                      onChange={(event) => setFilters((prev) => ({ ...prev, panel_code: event.target.value }))}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-[var(--ink)]"
                      placeholder="Filtrar..."
                      value={filters.house_type_name}
                      onChange={(event) => setFilters((prev) => ({ ...prev, house_type_name: event.target.value }))}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-[var(--ink)]"
                      placeholder="Filtrar..."
                      value={filters.house_sub_type_name}
                      onChange={(event) => setFilters((prev) => ({ ...prev, house_sub_type_name: event.target.value }))}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-[var(--ink)]"
                      placeholder="Filtrar..."
                      value={filters.house_identifier}
                      onChange={(event) => setFilters((prev) => ({ ...prev, house_identifier: event.target.value }))}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-[var(--ink)]"
                      placeholder="Filtrar..."
                      value={filters.module_number}
                      onChange={(event) => setFilters((prev) => ({ ...prev, module_number: event.target.value }))}
                    />
                  </td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-[var(--ink)]"
                      placeholder="Filtrar..."
                      value={filters.station_name}
                      onChange={(event) => setFilters((prev) => ({ ...prev, station_name: event.target.value }))}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-[var(--ink)]"
                      placeholder="Filtrar..."
                      value={filters.worker_name}
                      onChange={(event) => setFilters((prev) => ({ ...prev, worker_name: event.target.value }))}
                    />
                  </td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-[var(--ink)]"
                      placeholder="Filtrar..."
                      value={filters.notes}
                      onChange={(event) => setFilters((prev) => ({ ...prev, notes: event.target.value }))}
                    />
                  </td>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => {
                  const { text, title } = summarizePauses(row.pauses);
                  return (
                    <tr key={row.task_instance_id} className="border-b border-black/5">
                      <td className="px-3 py-2">{row.task_definition_name || '-'}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col">
                          <span>{row.panel_code || '-'}</span>
                          {row.module_number != null && (
                            <span className="text-[11px] text-[var(--ink-muted)]">MD{row.module_number}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">{row.house_type_name || '-'}</td>
                      <td className="px-3 py-2">{row.house_sub_type_name || '-'}</td>
                      <td className="px-3 py-2">{row.house_identifier || '-'}</td>
                      <td className="px-3 py-2">{row.module_number != null ? `MD${row.module_number}` : '-'}</td>
                      <td className="px-3 py-2">{formatDateTime(row.started_at)}</td>
                      <td className="px-3 py-2">{formatDateTime(row.completed_at)}</td>
                      <td className="px-3 py-2">{formatMinutes(row.duration_minutes)}</td>
                      <td className="px-3 py-2">{formatMinutes(row.expected_minutes)}</td>
                      <td className="px-3 py-2">{row.station_name || '-'}</td>
                      <td className="px-3 py-2">{row.worker_name || '-'}</td>
                      <td className="px-3 py-2 text-xs" title={title}>
                        {text}
                      </td>
                      <td className="px-3 py-2">{(row.notes || '').trim() || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardStations;
