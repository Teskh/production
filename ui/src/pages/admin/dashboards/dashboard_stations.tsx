import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Filter, RefreshCcw, RotateCcw } from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';
import { formatDateTime, formatMinutesWithUnit } from '../../../utils/timeUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type PanelTaskHistoryPause = {
  paused_at?: string | null;
  resumed_at?: string | null;
  duration_seconds?: number | null;
  reason?: string | null;
};

type HistoryScope = 'panel' | 'module';

type TaskHistoryRow = {
  task_instance_id: number;
  scope?: string | null;
  task_definition_id?: number | null;
  task_definition_name?: string | null;
  panel_definition_id?: number | null;
  panel_code?: string | null;
  house_type_id?: number | null;
  house_type_name?: string | null;
  house_sub_type_name?: string | null;
  house_identifier?: string | null;
  project_name?: string | null;
  module_number?: number | null;
  work_unit_status?: string | null;
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

type TaskCorrectionPreview = {
  task: {
    task_instance_id: number;
    task_definition_id: number;
    task_name: string;
    scope: string;
    status: string;
    work_unit_id: number;
    panel_unit_id?: number | null;
    station_id: number;
    started_at?: string | null;
    completed_at?: string | null;
  };
  eligible: boolean;
  correction_kind?: string | null;
  rollback_applied: boolean;
  blocked_reason?: string | null;
  warnings: string[];
  state_changes: string[];
  delete_counts: {
    participations: number;
    pauses: number;
    adherence_facts: number;
    qc_checks: number;
    qc_executions: number;
    qc_rework_tasks: number;
    qc_notifications: number;
  };
  correction_window_minutes: number;
};

type TaskCorrectionPreviewListResponse = {
  previews: TaskCorrectionPreview[];
};

type SortKey =
  | 'task_definition_name'
  | 'panel_code'
  | 'project_name'
  | 'house_type_name'
  | 'house_sub_type_name'
  | 'house_identifier'
  | 'module_number'
  | 'work_unit_status'
  | 'started_at'
  | 'completed_at'
  | 'duration_minutes'
  | 'expected_minutes'
  | 'station_name'
  | 'worker_name'
  | 'notes';

const HISTORY_FROM_DATE_KEY = 'stationHistoryFromDate';
const HISTORY_TO_DATE_KEY = 'stationHistoryToDate';
const HISTORY_SCOPE_KEY = 'stationHistoryScope';
const DEFAULT_FILTERS = {
  task_definition_name: '',
  panel_code: '',
  project_name: '',
  house_type_name: '',
  house_sub_type_name: '',
  house_identifier: '',
  module_number: '',
  work_unit_status: '',
  station_name: '',
  worker_name: '',
  notes: '',
};

const pad = (value: number) => String(value).padStart(2, '0');

const todayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const addDays = (dateStr: string, delta: number) => {
  const [y, m, d] = dateStr.split('-').map((value) => Number.parseInt(value, 10));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
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

const scopeLabel = (scope: HistoryScope) => (scope === 'panel' ? 'Paneles' : 'Modulos');

const dynamicColumnLabel = (scope: HistoryScope) => (scope === 'panel' ? 'Panel' : 'Proyecto');

const moduleStatusLabel = (value: string | null | undefined) => {
  switch (value) {
    case 'Planned':
      return 'Planificado';
    case 'Panels':
      return 'Paneles';
    case 'Magazine':
      return 'Magazine';
    case 'Assembly':
      return 'Terminaciones';
    case 'Completed':
      return 'Completado';
    default:
      return value || '-';
  }
};

const isEligibleForCorrectionButton = (
  row: TaskHistoryRow,
  scope: HistoryScope,
  preview: TaskCorrectionPreview | undefined
) =>
  scope === 'module' &&
  row.work_unit_status !== 'Completed' &&
  preview?.eligible === true;

const DashboardStations: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const requestIdRef = useRef(0);
  const [rows, setRows] = useState<TaskHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [correctionLoading, setCorrectionLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [correctionError, setCorrectionError] = useState('');
  const [actionError, setActionError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [applyingTaskId, setApplyingTaskId] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState(() => {
    const saved = localStorage.getItem(HISTORY_FROM_DATE_KEY);
    if (saved) return saved;
    return todayStr();
  });
  const [toDate, setToDate] = useState(() => {
    const saved = localStorage.getItem(HISTORY_TO_DATE_KEY);
    if (saved) return saved;
    const legacyDate = localStorage.getItem('panelHistorySelectedDate');
    if (legacyDate) return legacyDate;
    return todayStr();
  });
  const [selectedScope, setSelectedScope] = useState<HistoryScope>(() => {
    const saved = localStorage.getItem(HISTORY_SCOPE_KEY);
    return saved === 'module' ? 'module' : 'panel';
  });
  const [sortKey, setSortKey] = useState<SortKey>('started_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [correctionPreviews, setCorrectionPreviews] = useState<Record<number, TaskCorrectionPreview>>({});
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  useEffect(() => {
    setHeader({
      title: 'Historico por estaciones',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  useEffect(() => {
    localStorage.setItem(HISTORY_FROM_DATE_KEY, fromDate);
  }, [fromDate]);

  useEffect(() => {
    localStorage.setItem(HISTORY_TO_DATE_KEY, toDate);
  }, [toDate]);

  useEffect(() => {
    localStorage.setItem(HISTORY_SCOPE_KEY, selectedScope);
  }, [selectedScope]);

  const fetchCorrectionPreviews = useCallback(
    async (historyRows: TaskHistoryRow[], scope: HistoryScope, requestId: number) => {
      if (scope !== 'module') {
        if (requestId === requestIdRef.current) {
          setCorrectionPreviews({});
          setCorrectionLoading(false);
          setCorrectionError('');
        }
        return;
      }

      const candidateIds = historyRows
        .filter((row) => row.work_unit_status !== 'Completed')
        .map((row) => row.task_instance_id);

      if (requestId === requestIdRef.current) {
        setCorrectionLoading(candidateIds.length > 0);
        setCorrectionPreviews({});
        setCorrectionError('');
      }

      if (candidateIds.length === 0) {
        if (requestId === requestIdRef.current) {
          setCorrectionLoading(false);
        }
        return;
      }

      try {
        const data = await apiRequest<TaskCorrectionPreviewListResponse>('/api/task-corrections/previews', {
          method: 'POST',
          body: JSON.stringify({ task_instance_ids: candidateIds }),
        });
        if (requestId !== requestIdRef.current) {
          return;
        }
        const nextMap = Object.fromEntries(
          (data.previews ?? []).map((preview) => [preview.task.task_instance_id, preview])
        );
        setCorrectionPreviews(nextMap);
      } catch (err) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        const errorMessage =
          err instanceof Error ? err.message : 'No se pudo evaluar la correccion de tareas.';
        setCorrectionError(errorMessage);
      } finally {
        if (requestId === requestIdRef.current) {
          setCorrectionLoading(false);
        }
      }
    },
    []
  );

  const fetchData = useCallback(
    async (rangeStart: string, rangeEnd: string, scope: HistoryScope) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setError('');
      setExportError('');
      setActionError('');
      if (scope !== 'module') {
        setCorrectionError('');
      }

      try {
        const params = new URLSearchParams();
        if (rangeStart) {
          params.set('from_date', rangeStart);
        }
        if (rangeEnd) {
          params.set('to_date', rangeEnd);
        }
        params.set('scope', scope);
        params.set('limit', '2000');
        params.set('sort_by', 'started_at');
        params.set('sort_order', 'desc');

        const data = await apiRequest<TaskHistoryRow[]>(`/api/task-history?${params.toString()}`);
        if (requestId !== requestIdRef.current) {
          return;
        }
        const nextRows = Array.isArray(data) ? data : [];
        setRows(nextRows);
        await fetchCorrectionPreviews(nextRows, scope, requestId);
      } catch (err) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        const errorMessage = err instanceof Error ? err.message : 'Error cargando historico';
        setError(errorMessage);
        setRows([]);
        setCorrectionPreviews({});
        setCorrectionLoading(false);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [fetchCorrectionPreviews]
  );

  useEffect(() => {
    const normalizedStart = fromDate <= toDate ? fromDate : toDate;
    const normalizedEnd = fromDate <= toDate ? toDate : fromDate;
    fetchData(normalizedStart, normalizedEnd, selectedScope);
  }, [fetchData, fromDate, selectedScope, toDate]);

  const changeRange = (delta: number) => {
    setFromDate((prev) => addDays(prev, delta));
    setToDate((prev) => addDays(prev, delta));
  };

  const onFromDateChange = (value: string) => {
    setFromDate(value);
    if (value > toDate) {
      setToDate(value);
    }
  };

  const onToDateChange = (value: string) => {
    setToDate(value);
    if (value < fromDate) {
      setFromDate(value);
    }
  };

  const onScopeChange = (scope: HistoryScope) => {
    setSelectedScope(scope);
    setSortKey('started_at');
    setSortDir('desc');
    setActionError('');
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'started_at' || key === 'completed_at' ? 'desc' : 'asc');
  };

  const applyFilters = useCallback(
    (arr: TaskHistoryRow[]) => {
      const contains = (value: unknown, needle: string) =>
        String(value || '').toLowerCase().includes(needle.trim().toLowerCase());
      return arr.filter((row) => {
        return (
          contains(row.task_definition_name, filters.task_definition_name) &&
          contains(row.panel_code, filters.panel_code) &&
          contains(row.project_name, filters.project_name) &&
          contains(row.house_type_name, filters.house_type_name) &&
          contains(row.house_sub_type_name, filters.house_sub_type_name) &&
          contains(row.house_identifier, filters.house_identifier) &&
          contains(row.module_number, filters.module_number) &&
          contains(row.work_unit_status, filters.work_unit_status) &&
          contains(row.station_name, filters.station_name) &&
          contains(row.worker_name, filters.worker_name) &&
          contains(row.notes, filters.notes)
        );
      });
    },
    [filters]
  );

  const sortRows = useCallback(
    (arr: TaskHistoryRow[]) => {
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
    },
    [sortDir, sortKey]
  );

  const filteredRows = useMemo(() => applyFilters(rows), [rows, applyFilters]);
  const tableRows = useMemo(() => sortRows(filteredRows), [filteredRows, sortRows]);
  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((value) => value.trim().length > 0),
    [filters]
  );
  const visibleRecordsLabel =
    hasActiveFilters && rows.length > 0 ? `${tableRows.length} de ${rows.length} registros visibles` : `${tableRows.length} registros visibles`;
  const tableColumnCount = selectedScope === 'module' ? 15 : 14;

  const SortableTh: React.FC<{ label: string; col: SortKey }> = ({ label, col }) => (
    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
      <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort(col)}>
        {label}
        {sortKey === col && <span className="text-[9px]">{sortDir === 'asc' ? '^' : 'v'}</span>}
      </button>
    </th>
  );

  const handleApplyCorrection = async (row: TaskHistoryRow, preview: TaskCorrectionPreview) => {
    const summaryBits = [
      row.house_identifier || '-',
      row.module_number != null ? `MD${row.module_number}` : null,
      row.task_definition_name || preview.task.task_name,
    ].filter(Boolean);
    const messageLines = [
      preview.rollback_applied
        ? 'Esta correccion eliminara la tarea y revertira el movimiento del modulo.'
        : 'Esta correccion eliminara la tarea seleccionada.',
      summaryBits.join(' - '),
      ...preview.state_changes,
      preview.delete_counts.qc_checks > 0
        ? `Tambien se eliminaran ${preview.delete_counts.qc_checks} checks QC abiertos sin ejecutar.`
        : null,
      '¿Continuar?',
    ].filter(Boolean);

    if (!window.confirm(messageLines.join('\n\n'))) {
      return;
    }

    setApplyingTaskId(row.task_instance_id);
    setActionError('');
    try {
      await apiRequest(`/api/task-corrections/${row.task_instance_id}/apply`, {
        method: 'POST',
        body: JSON.stringify({ reason: null }),
      });
      const normalizedStart = fromDate <= toDate ? fromDate : toDate;
      const normalizedEnd = fromDate <= toDate ? toDate : fromDate;
      await fetchData(normalizedStart, normalizedEnd, selectedScope);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'No se pudo corregir la tarea.';
      setActionError(errorMessage);
    } finally {
      setApplyingTaskId(null);
    }
  };

  const handleExport = () => {
    setExportError('');
    setExporting(true);
    try {
      const headers = [
        'Tarea',
        dynamicColumnLabel(selectedScope),
        'Tipo vivienda',
        'Tipologia',
        'Identificador vivienda',
        'Modulo',
        ...(selectedScope === 'module' ? ['Estado modulo'] : []),
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
          selectedScope === 'panel' ? row.panel_code || '-' : row.project_name || '-',
          row.house_type_name || '-',
          row.house_sub_type_name || '-',
          row.house_identifier || '-',
          row.module_number ?? '-',
          ...(selectedScope === 'module' ? [moduleStatusLabel(row.work_unit_status)] : []),
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
      link.download = `${selectedScope}-history-${fromDate}-${toDate}.csv`;
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
      <div className="rounded-2xl border border-black/5 bg-white/80 px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
              {scopeLabel(selectedScope)}
            </p>
            <h1 className="font-display text-xl text-[var(--ink)]">Historico por estacion</h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              {selectedScope === 'panel'
                ? 'Revisa tareas de panel terminadas por estacion, trabajador y panel con sus pausas.'
                : 'Revisa tareas de modulo terminadas y corrige tareas elegibles mientras el modulo siga activo.'}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[var(--accent-soft)] bg-white/80 px-4 py-2 text-xs text-[var(--ink)]">
            <Filter className="h-4 w-4 text-[var(--accent)]" />
            {visibleRecordsLabel}
          </div>
        </div>

        <div className="mt-5 inline-flex rounded-full border border-black/10 bg-black/[0.03] p-1">
          {(['panel', 'module'] as HistoryScope[]).map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => onScopeChange(scope)}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                selectedScope === scope
                  ? 'bg-[var(--ink)] text-white shadow-sm'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              {scope === 'panel' ? 'Paneles' : 'Modulos'}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Filtros</p>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Seleccion de rango</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              const normalizedStart = fromDate <= toDate ? fromDate : toDate;
              const normalizedEnd = fromDate <= toDate ? toDate : fromDate;
              fetchData(normalizedStart, normalizedEnd, selectedScope);
            }}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-black"
            disabled={loading}
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? 'Cargando...' : 'Actualizar'}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Desde
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="rounded-full border border-black/10 px-3 py-2 text-xs text-[var(--ink)]"
                onClick={() => changeRange(-1)}
                disabled={loading}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input
                className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                type="date"
                value={fromDate}
                onChange={(event) => onFromDateChange(event.target.value)}
              />
              <button
                type="button"
                className="rounded-full border border-black/10 px-3 py-2 text-xs text-[var(--ink)]"
                onClick={() => changeRange(1)}
                disabled={loading}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </label>

          <label className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Hasta
            <div className="mt-2 flex items-center gap-2">
              <input
                className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                type="date"
                value={toDate}
                onChange={(event) => onToDateChange(event.target.value)}
              />
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

        {selectedScope === 'module' && correctionLoading && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Evaluando tareas corregibles...
          </div>
        )}
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
        {!error && !exportError && correctionError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {correctionError}
          </div>
        )}
        {!error && !exportError && !correctionError && actionError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {actionError}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="overflow-x-auto rounded-xl border border-black/5 bg-white/50">
          {loading && (
            <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">Cargando datos...</div>
          )}

          {!loading && rows.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">Sin datos</div>
          )}

          {!loading && rows.length > 0 && (
            <table className="w-full min-w-[1320px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-black/10 bg-black/[0.02]">
                  <SortableTh label="Tarea" col="task_definition_name" />
                  <SortableTh
                    label={dynamicColumnLabel(selectedScope)}
                    col={selectedScope === 'panel' ? 'panel_code' : 'project_name'}
                  />
                  <SortableTh label="Tipo vivienda" col="house_type_name" />
                  <SortableTh label="Tipologia" col="house_sub_type_name" />
                  <SortableTh label="Identificador" col="house_identifier" />
                  <SortableTh label="Modulo" col="module_number" />
                  {selectedScope === 'module' && (
                    <SortableTh label="Estado modulo" col="work_unit_status" />
                  )}
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
                      onChange={(event) =>
                        setFilters((prev) => ({ ...prev, task_definition_name: event.target.value }))
                      }
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-[var(--ink)]"
                      placeholder="Filtrar..."
                      value={selectedScope === 'panel' ? filters.panel_code : filters.project_name}
                      onChange={(event) =>
                        setFilters((prev) =>
                          selectedScope === 'panel'
                            ? { ...prev, panel_code: event.target.value }
                            : { ...prev, project_name: event.target.value }
                        )
                      }
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
                      onChange={(event) =>
                        setFilters((prev) => ({ ...prev, house_sub_type_name: event.target.value }))
                      }
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
                  {selectedScope === 'module' && (
                    <td className="px-2 py-2">
                      <input
                        className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-[var(--ink)]"
                        placeholder="Filtrar..."
                        value={filters.work_unit_status}
                        onChange={(event) =>
                          setFilters((prev) => ({ ...prev, work_unit_status: event.target.value }))
                        }
                      />
                    </td>
                  )}
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
                {tableRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={tableColumnCount}
                      className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]"
                    >
                      <div className="flex flex-col items-center gap-3">
                        <span>No hay resultados para los filtros actuales.</span>
                        {hasActiveFilters && (
                          <button
                            type="button"
                            onClick={() => setFilters(DEFAULT_FILTERS)}
                            className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)] transition hover:bg-black/[0.03]"
                          >
                            Limpiar filtros
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {tableRows.map((row) => {
                  const preview = correctionPreviews[row.task_instance_id];
                  const showCorrectionButton = isEligibleForCorrectionButton(row, selectedScope, preview);
                  const { text, title } = summarizePauses(row.pauses);
                  const isApplying = applyingTaskId === row.task_instance_id;

                  return (
                    <tr key={row.task_instance_id} className="border-b border-black/5">
                      <td className="px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <span>{row.task_definition_name || '-'}</span>
                          {showCorrectionButton && preview && (
                            <button
                              type="button"
                              onClick={() => handleApplyCorrection(row, preview)}
                              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-800 transition hover:bg-amber-100"
                              disabled={isApplying}
                              title={
                                preview.rollback_applied
                                  ? 'Eliminar tarea y revertir movimiento'
                                  : 'Eliminar tarea por correccion'
                              }
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              {isApplying ? 'Aplicando...' : 'Deshacer'}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col">
                          <span>{selectedScope === 'panel' ? row.panel_code || '-' : row.project_name || '-'}</span>
                          {selectedScope === 'panel' && row.module_number != null && (
                            <span className="text-[11px] text-[var(--ink-muted)]">MD{row.module_number}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">{row.house_type_name || '-'}</td>
                      <td className="px-3 py-2">{row.house_sub_type_name || '-'}</td>
                      <td className="px-3 py-2">{row.house_identifier || '-'}</td>
                      <td className="px-3 py-2">{row.module_number != null ? `MD${row.module_number}` : '-'}</td>
                      {selectedScope === 'module' && (
                        <td className="px-3 py-2">{moduleStatusLabel(row.work_unit_status)}</td>
                      )}
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
