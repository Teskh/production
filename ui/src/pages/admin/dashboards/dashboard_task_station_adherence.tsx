import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type TaskScope = 'panel' | 'module' | 'aux';
type SequenceBehaviorFilter =
  | 'all'
  | 'ahead_of_plan'
  | 'late_start'
  | 'started_on_time_finished_late';

type Station = {
  id: number;
  name: string;
  sequence_order: number | null;
  line_type?: string | null;
};

type TaskDefinition = {
  id: number;
  name: string;
  scope: TaskScope;
  active: boolean;
};

type AdherenceSummary = {
  total_rows: number;
  kpi_rows: number;
  matched_rows: number;
  deviation_rows: number;
  adherence_rate: number | null;
};

type AdherenceRow = {
  task_instance_id: number;
  completed_at: string;
  task_definition_id: number;
  task_name: string | null;
  scope: TaskScope;
  project_name: string | null;
  house_identifier: string | null;
  module_number: number | null;
  panel_code: string | null;
  actual_station_id: number;
  actual_station_name: string | null;
  completed_station_id: number | null;
  completed_station_name: string | null;
  planned_station_id: number | null;
  planned_station_name: string | null;
  planned_station_sequence: number | null;
  resolution_code: string;
  included_in_kpi: boolean;
  is_deviation: boolean | null;
};

type AdherenceResponse = {
  from_date: string | null;
  to_date: string | null;
  summary: AdherenceSummary;
  rows: AdherenceRow[];
};

const apiRequest = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let message = 'No se pudo completar la solicitud.';
    try {
      const payload = await response.json();
      if (payload?.detail) {
        message = String(payload.detail);
      }
    } catch {
      // Keep default message.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
};

const toDateInputValue = (date: Date) => date.toISOString().slice(0, 10);

const DashboardTaskStationAdherence: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [stations, setStations] = useState<Station[]>([]);
  const [taskDefinitions, setTaskDefinitions] = useState<TaskDefinition[]>([]);
  const [scope, setScope] = useState<TaskScope | ''>('');
  const [actualStationId, setActualStationId] = useState<string>('');
  const [sequenceBehaviorFilter, setSequenceBehaviorFilter] =
    useState<SequenceBehaviorFilter>('all');
  const [taskDefinitionId, setTaskDefinitionId] = useState<string>('');
  const [includeNonKpi, setIncludeNonKpi] = useState(false);
  const [fromDate, setFromDate] = useState<string>(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - 30);
    return toDateInputValue(start);
  });
  const [toDate, setToDate] = useState<string>(() => toDateInputValue(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<AdherenceResponse | null>(null);

  useEffect(() => {
    setHeader({
      title: 'Adherencia de estacion',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  useEffect(() => {
    let active = true;
    const loadFilters = async () => {
      try {
        const [stationsResponse, tasksResponse] = await Promise.all([
          apiRequest<Station[]>('/api/stations'),
          apiRequest<TaskDefinition[]>('/api/task-definitions'),
        ]);
        if (!active) {
          return;
        }
        setStations(Array.isArray(stationsResponse) ? stationsResponse : []);
        setTaskDefinitions(
          (Array.isArray(tasksResponse) ? tasksResponse : []).filter((task) => task.active),
        );
      } catch {
        if (!active) {
          return;
        }
        setStations([]);
        setTaskDefinitions([]);
      }
    };
    void loadFilters();
    return () => {
      active = false;
    };
  }, []);

  const taskOptions = useMemo(() => {
    if (!scope) {
      return taskDefinitions;
    }
    return taskDefinitions.filter((task) => task.scope === scope);
  }, [scope, taskDefinitions]);

  useEffect(() => {
    if (!actualStationId) {
      return;
    }
    const exists = stations.some((station) => String(station.id) === actualStationId);
    if (!exists) {
      setActualStationId('');
    }
  }, [actualStationId, stations]);

  const groupedStationOptions = useMemo(() => {
    const sequenceEntries = new Map<number, { stations: Station[] }>();
    const unsequenced: Station[] = [];

    stations.forEach((station) => {
      if (station.sequence_order == null) {
        unsequenced.push(station);
        return;
      }
      const entry = sequenceEntries.get(station.sequence_order);
      if (entry) {
        entry.stations.push(station);
        return;
      }
      sequenceEntries.set(station.sequence_order, {
        stations: [station],
      });
    });

    const sequenced = Array.from(sequenceEntries.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([sequence, entry]) => {
        const stationsInGroup = [...entry.stations].sort((a, b) => a.name.localeCompare(b.name));
        return {
          key: `sequence-${sequence}`,
          label: `Orden ${sequence}`,
          stations: stationsInGroup,
        };
      });

    return {
      sequenced,
      unsequenced: [...unsequenced].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [stations]);

  const sequenceByStationId = useMemo(() => {
    const map = new Map<number, number>();
    stations.forEach((station) => {
      if (station.sequence_order == null) {
        return;
      }
      map.set(station.id, station.sequence_order);
    });
    return map;
  }, [stations]);

  const filteredRows = useMemo(() => {
    const rows = data?.rows ?? [];
    if (sequenceBehaviorFilter === 'all') {
      return rows;
    }
    return rows.filter((row) => {
      if (row.planned_station_sequence == null) {
        return false;
      }
      const actualSequence = sequenceByStationId.get(row.actual_station_id);
      if (actualSequence == null) {
        return false;
      }
      if (sequenceBehaviorFilter === 'ahead_of_plan') {
        return actualSequence < row.planned_station_sequence;
      }
      if (sequenceBehaviorFilter === 'late_start') {
        return actualSequence > row.planned_station_sequence;
      }
      if (actualSequence !== row.planned_station_sequence) {
        return false;
      }
      if (row.completed_station_id == null) {
        return false;
      }
      const completedSequence = sequenceByStationId.get(row.completed_station_id);
      return completedSequence != null && completedSequence > row.planned_station_sequence;
    });
  }, [data?.rows, sequenceBehaviorFilter, sequenceByStationId]);

  const summary = useMemo(() => {
    if (!data) {
      return null;
    }
    if (sequenceBehaviorFilter === 'all') {
      return data.summary;
    }
    const totalRows = filteredRows.length;
    const kpiRows = filteredRows.filter((row) => row.included_in_kpi).length;
    const matchedRows = filteredRows.filter(
      (row) => row.included_in_kpi && row.is_deviation === false,
    ).length;
    const deviationRows = filteredRows.filter(
      (row) => row.included_in_kpi && row.is_deviation === true,
    ).length;
    return {
      total_rows: totalRows,
      kpi_rows: kpiRows,
      matched_rows: matchedRows,
      deviation_rows: deviationRows,
      adherence_rate: kpiRows > 0 ? (matchedRows / kpiRows) * 100 : null,
    };
  }, [data, filteredRows, sequenceBehaviorFilter]);

  useEffect(() => {
    if (!taskDefinitionId) {
      return;
    }
    const exists = taskOptions.some((task) => String(task.id) === taskDefinitionId);
    if (!exists) {
      setTaskDefinitionId('');
    }
  }, [taskDefinitionId, taskOptions]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (fromDate) {
        params.set('from_date', fromDate);
      }
      if (toDate) {
        params.set('to_date', toDate);
      }
      if (scope) {
        params.set('scope', scope);
      }
      if (actualStationId) {
        params.set('actual_station_id', actualStationId);
      }
      if (taskDefinitionId) {
        params.set('task_definition_id', taskDefinitionId);
      }
      if (includeNonKpi) {
        params.set('include_non_kpi', 'true');
      }
      params.set('limit', '500');
      const response = await apiRequest<AdherenceResponse>(
        `/api/task-station-adherence?${params.toString()}`,
      );
      setData(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo cargar la adherencia.';
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [actualStationId, fromDate, includeNonKpi, scope, taskDefinitionId, toDate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Desde
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Hasta
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Alcance
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as TaskScope | '')}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
            >
              <option value="">Todos</option>
              <option value="panel">Panel</option>
              <option value="module">Modulo</option>
              <option value="aux">Aux</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Estacion real
            <select
              value={actualStationId}
              onChange={(event) => setActualStationId(event.target.value)}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
            >
              <option value="">Todas</option>
              {groupedStationOptions.sequenced.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.stations.map((station) => (
                    <option key={station.id} value={station.id}>
                      {station.name}
                    </option>
                  ))}
                </optgroup>
              ))}
              {groupedStationOptions.unsequenced.length > 0 ? (
                <optgroup label="Sin secuencia">
                  {groupedStationOptions.unsequenced.map((station) => (
                    <option key={station.id} value={station.id}>
                      {station.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Tipo de desfase
            <select
              value={sequenceBehaviorFilter}
              onChange={(event) => setSequenceBehaviorFilter(event.target.value as SequenceBehaviorFilter)}
              className="max-w-[280px] rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
            >
              <option value="all">Todos</option>
              <option value="ahead_of_plan">Adelantada (inicio antes del plan)</option>
              <option value="late_start">Tardia (inicio despues del plan)</option>
              <option value="started_on_time_finished_late">
                Inicio correcto, fin en secuencia posterior
              </option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Tarea
            <select
              value={taskDefinitionId}
              onChange={(event) => setTaskDefinitionId(event.target.value)}
              className="max-w-[280px] rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
            >
              <option value="">Todas</option>
              {taskOptions.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ml-auto flex items-center gap-2 text-sm text-[var(--ink)]">
            <input
              type="checkbox"
              checked={includeNonKpi}
              onChange={(event) => setIncludeNonKpi(event.target.checked)}
            />
            Incluir no-KPI
          </label>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white"
            disabled={loading}
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refrescar
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Adherencia</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
            {summary?.adherence_rate != null ? `${summary.adherence_rate.toFixed(2)}%` : '-'}
          </p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">KPI filas</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{summary?.kpi_rows ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Coinciden</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">{summary?.matched_rows ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Desviaciones</p>
          <p className="mt-2 text-2xl font-semibold text-amber-700">{summary?.deviation_rows ?? 0}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : null}
        {!error && data && filteredRows.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">No hay registros para los filtros seleccionados.</p>
        ) : null}
        {!error && data && filteredRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  <th className="px-2 py-2">Fecha</th>
                  <th className="px-2 py-2">Tarea</th>
                  <th className="px-2 py-2">Contexto</th>
                  <th className="px-2 py-2">Estacion plan</th>
                  <th className="px-2 py-2">Estacion inicio</th>
                  <th className="px-2 py-2">Estacion fin</th>
                  <th className="px-2 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const when = new Date(row.completed_at);
                  const context = [
                    row.house_identifier,
                    row.module_number != null ? `M${row.module_number}` : null,
                    row.panel_code,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  const statusLabel =
                    row.is_deviation == null
                      ? row.resolution_code
                      : row.is_deviation
                      ? 'Desviacion'
                      : 'Coincide';
                  return (
                    <tr key={row.task_instance_id} className="border-b border-black/5 text-[var(--ink)]">
                      <td className="px-2 py-2">{when.toLocaleString()}</td>
                      <td className="px-2 py-2">{row.task_name ?? `Tarea ${row.task_definition_id}`}</td>
                      <td className="px-2 py-2">{context || '-'}</td>
                      <td className="px-2 py-2">{row.planned_station_name ?? '-'}</td>
                      <td className="px-2 py-2">{row.actual_station_name ?? `#${row.actual_station_id}`}</td>
                      <td className="px-2 py-2">
                        {row.completed_station_name ??
                          (row.completed_station_id != null ? `#${row.completed_station_id}` : '-')}
                      </td>
                      <td className="px-2 py-2">{statusLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default DashboardTaskStationAdherence;
