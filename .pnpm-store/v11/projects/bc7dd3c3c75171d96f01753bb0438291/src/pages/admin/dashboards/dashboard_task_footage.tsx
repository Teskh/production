import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CircleAlert,
  Clock3,
  Film,
  RefreshCcw,
  Search,
  ShieldCheck,
  VideoOff,
} from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';
import { formatDateTime } from '../../../utils/timeUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type Station = {
  id: number;
  name: string;
  camera_feed_ip?: string | null;
};

type TaskFootageRow = {
  task_instance_id: number;
  scope?: string | null;
  task_definition_id?: number | null;
  task_definition_name?: string | null;
  panel_definition_id?: number | null;
  panel_code?: string | null;
  project_name?: string | null;
  house_identifier?: string | null;
  house_type_name?: string | null;
  house_sub_type_name?: string | null;
  module_number?: number | null;
  station_id?: number | null;
  station_name?: string | null;
  worker_name?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  duration_minutes?: number | null;
  notes?: string | null;
  camera_feed_ip?: string | null;
  footage_status: string;
  footage_status_label: string;
  requested_duration_seconds?: number | null;
  available_duration_seconds?: number | null;
  coverage_ratio?: number | null;
  segments_count: number;
  first_footage_at_utc?: string | null;
  last_footage_at_utc?: string | null;
};

type TaskFootageListResponse = {
  total_count: number;
  rows: TaskFootageRow[];
};

type TaskFootageSegmentSummary = {
  segment_id: number;
  file_name?: string | null;
  started_at_utc?: string | null;
  ended_at_utc?: string | null;
  overlap_started_at_utc?: string | null;
  overlap_ended_at_utc?: string | null;
};

type TaskFootagePlaybackResponse = {
  task_instance_id: number;
  footage_status: string;
  footage_status_label: string;
  playback_mode: string;
  video_url?: string | null;
  playback_start_seconds?: number | null;
  playback_end_seconds?: number | null;
  requested_start_utc?: string | null;
  requested_end_utc?: string | null;
  available_start_utc?: string | null;
  available_end_utc?: string | null;
  requested_duration_seconds?: number | null;
  available_duration_seconds?: number | null;
  camera_feed_ip?: string | null;
  warning?: string | null;
  segments: TaskFootageSegmentSummary[];
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

const pad = (value: number) => String(value).padStart(2, '0');

const todayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const formatSeconds = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return '-';
  const total = Math.max(Math.round(value), 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

const statusTone: Record<string, string> = {
  available: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  partial: 'border-amber-200 bg-amber-50 text-amber-700',
  missing: 'border-rose-200 bg-rose-50 text-rose-700',
  unmapped: 'border-slate-200 bg-slate-100 text-slate-600',
  no_timeframe: 'border-slate-200 bg-slate-100 text-slate-600',
};

const DashboardTaskFootage: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [rows, setRows] = useState<TaskFootageRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [playback, setPlayback] = useState<TaskFootagePlaybackResponse | null>(null);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [selectedStationId, setSelectedStationId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    setHeader({
      title: 'Tareas con footage CCTV',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  useEffect(() => {
    let active = true;
    const loadStations = async () => {
      try {
        const stationData = await apiRequest<Station[]>('/api/stations');
        if (active) {
          setStations(Array.isArray(stationData) ? stationData : []);
        }
      } catch {
        if (active) {
          setStations([]);
        }
      }
    };
    void loadStations();
    return () => {
      active = false;
    };
  }, []);

  const fetchRows = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('from_date', selectedDate);
      params.set('to_date', selectedDate);
      params.set('limit', '200');
      if (selectedStationId) {
        params.set('station_id', selectedStationId);
      }
      const response = await apiRequest<TaskFootageListResponse>(
        `/api/task-footage/tasks?${params.toString()}`,
      );
      setRows(Array.isArray(response.rows) ? response.rows : []);
      setTotalCount(response.total_count ?? 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo cargar el footage';
      setError(message);
      setRows([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedStationId]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.footage_status !== statusFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const haystack = [
        row.task_instance_id,
        row.task_definition_name,
        row.project_name,
        row.house_identifier,
        row.house_type_name,
        row.house_sub_type_name,
        row.panel_code,
        row.station_name,
        row.worker_name,
        row.camera_feed_ip,
      ]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');
      return haystack.includes(normalizedSearch);
    });
  }, [rows, search, statusFilter]);

  useEffect(() => {
    if (!filteredRows.length) {
      setSelectedTaskId(null);
      setPlayback(null);
      return;
    }
    if (!filteredRows.some((row) => row.task_instance_id === selectedTaskId)) {
      setSelectedTaskId(filteredRows[0].task_instance_id);
    }
  }, [filteredRows, selectedTaskId]);

  const selectedTask = useMemo(
    () => filteredRows.find((row) => row.task_instance_id === selectedTaskId) ?? null,
    [filteredRows, selectedTaskId],
  );

  useEffect(() => {
    let active = true;
    const loadPlayback = async () => {
      if (!selectedTask) {
        setPlayback(null);
        setPlaybackError('');
        return;
      }
      setPlaybackLoading(true);
      setPlaybackError('');
      try {
        const data = await apiRequest<TaskFootagePlaybackResponse>(
          `/api/task-footage/tasks/${selectedTask.task_instance_id}/playback`,
        );
        if (active) {
          setPlayback(data);
        }
      } catch (err) {
        if (!active) {
          return;
        }
        const message = err instanceof Error ? err.message : 'No se pudo preparar la reproduccion';
        setPlayback(null);
        setPlaybackError(message);
      } finally {
        if (active) {
          setPlaybackLoading(false);
        }
      }
    };
    void loadPlayback();
    return () => {
      active = false;
    };
  }, [selectedTask]);

  const resolvedVideoUrl = useMemo(() => {
    if (!playback?.video_url) return '';
    return `${API_BASE_URL}${playback.video_url}`;
  }, [playback]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resolvedVideoUrl) {
      return;
    }

    const onLoadedMetadata = () => {
      if (
        playback?.playback_start_seconds != null &&
        Number.isFinite(playback.playback_start_seconds)
      ) {
        const target = Math.max(playback.playback_start_seconds, 0);
        if (Math.abs(video.currentTime - target) > 0.25) {
          video.currentTime = target;
        }
      }
    };

    const onTimeUpdate = () => {
      if (
        playback?.playback_end_seconds != null &&
        Number.isFinite(playback.playback_end_seconds) &&
        video.currentTime >= playback.playback_end_seconds
      ) {
        video.pause();
      }
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [playback, resolvedVideoUrl]);

  const statusCounts = useMemo(() => {
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.footage_status] = (acc[row.footage_status] || 0) + 1;
      return acc;
    }, {});
  }, [rows]);

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-black/5 bg-white/85 px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
              Seguimiento visual
            </p>
            <h1 className="mt-1 font-display text-2xl text-[var(--ink)]">
              Cruce entre tareas finalizadas y respaldo CCTV
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Revisa que tareas tienen footage completo, parcial o inexistente y abre el video
              asociado al rango real de ejecucion.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">Completo</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-800">
                {statusCounts.available ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-amber-700">Parcial</p>
              <p className="mt-1 text-2xl font-semibold text-amber-800">
                {statusCounts.partial ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-rose-700">Sin footage</p>
              <p className="mt-1 text-2xl font-semibold text-rose-800">
                {statusCounts.missing ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-600">Otros</p>
              <p className="mt-1 text-2xl font-semibold text-slate-700">
                {(statusCounts.unmapped ?? 0) + (statusCounts.no_timeframe ?? 0)}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-black/5 bg-white/85 px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Fecha
            </span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--ink)]"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Estacion
            </span>
            <select
              value={selectedStationId}
              onChange={(event) => setSelectedStationId(event.target.value)}
              className="min-w-56 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--ink)]"
            >
              <option value="">Todas</option>
              {stations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex-1 space-y-2">
            <span className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Buscar
            </span>
            <div className="flex items-center rounded-2xl border border-black/10 bg-white px-4 py-3">
              <Search className="mr-3 h-4 w-4 text-[var(--ink-muted)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tarea, casa, panel, operario, IP..."
                className="w-full border-none bg-transparent text-sm text-[var(--ink)] outline-none"
              />
            </div>
          </label>

          <button
            type="button"
            onClick={() => void fetchRows()}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-black"
          >
            <RefreshCcw className="h-4 w-4" />
            Recargar
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ['all', 'Todas'],
            ['available', 'Completo'],
            ['partial', 'Parcial'],
            ['missing', 'Sin footage'],
            ['unmapped', 'Sin camara'],
            ['no_timeframe', 'Sin tiempo'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                statusFilter === value
                  ? 'bg-[var(--accent)] text-white'
                  : 'border border-black/10 bg-white text-[var(--ink-muted)] hover:border-black/20'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 text-sm text-[var(--ink-muted)]">
          {loading ? 'Cargando tareas...' : `${filteredRows.length} filas visibles de ${totalCount} tareas`}
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[28px] border border-black/5 bg-white/85 shadow-sm">
          <div className="border-b border-black/5 px-6 py-4">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Tareas finalizadas
            </p>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-white/95 backdrop-blur">
                <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  <th className="px-4 py-3">Tarea</th>
                  <th className="px-4 py-3">Estacion</th>
                  <th className="px-4 py-3">Operario</th>
                  <th className="px-4 py-3">Inicio</th>
                  <th className="px-4 py-3">Footage</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const selected = row.task_instance_id === selectedTaskId;
                  return (
                    <tr
                      key={row.task_instance_id}
                      onClick={() => setSelectedTaskId(row.task_instance_id)}
                      className={`cursor-pointer border-t border-black/5 transition ${
                        selected ? 'bg-[var(--accent-soft)]/60' : 'hover:bg-black/[0.025]'
                      }`}
                    >
                      <td className="px-4 py-4 align-top">
                        <div className="font-semibold text-[var(--ink)]">
                          {row.task_definition_name || `Tarea ${row.task_instance_id}`}
                        </div>
                        <div className="mt-1 text-xs text-[var(--ink-muted)]">
                          #{row.task_instance_id}
                          {row.panel_code ? ` · Panel ${row.panel_code}` : ''}
                          {row.house_identifier ? ` · Casa ${row.house_identifier}` : ''}
                        </div>
                        {row.project_name && (
                          <div className="mt-1 text-xs text-[var(--ink-muted)]">
                            {row.project_name}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="text-[var(--ink)]">{row.station_name || '-'}</div>
                        <div className="mt-1 text-xs text-[var(--ink-muted)]">
                          {row.camera_feed_ip || 'Sin IP'}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top text-[var(--ink)]">
                        {row.worker_name || '-'}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="text-[var(--ink)]">{formatDateTime(row.started_at)}</div>
                        <div className="mt-1 text-xs text-[var(--ink-muted)]">
                          {formatSeconds(row.requested_duration_seconds)}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
                            statusTone[row.footage_status] ?? statusTone.missing
                          }`}
                        >
                          {row.footage_status_label}
                        </span>
                        <div className="mt-2 text-xs text-[var(--ink-muted)]">
                          {row.coverage_ratio != null
                            ? `${Math.round(row.coverage_ratio * 100)}% cubierto`
                            : '-'}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-[var(--ink-muted)]">
                      No hay tareas para los filtros seleccionados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-[28px] border border-black/5 bg-white/85 px-6 py-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Reproduccion
                </p>
                <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">
                  {selectedTask?.task_definition_name || 'Seleccione una tarea'}
                </h2>
              </div>
              {selectedTask && (
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
                    statusTone[selectedTask.footage_status] ?? statusTone.missing
                  }`}
                >
                  {selectedTask.footage_status_label}
                </span>
              )}
            </div>

            {!selectedTask && (
              <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-5 py-8 text-sm text-[var(--ink-muted)]">
                Seleccione una fila para revisar el detalle y cargar el video.
              </div>
            )}

            {selectedTask && (
              <div className="mt-5 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-black/5 bg-[rgba(15,27,45,0.04)] px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.15em] text-[var(--ink-muted)]">
                      Rango pedido
                    </div>
                    <div className="mt-2 text-sm text-[var(--ink)]">
                      {formatDateTime(selectedTask.started_at)}
                    </div>
                    <div className="text-sm text-[var(--ink)]">
                      {formatDateTime(selectedTask.completed_at)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-black/5 bg-[rgba(15,27,45,0.04)] px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.15em] text-[var(--ink-muted)]">
                      Cobertura disponible
                    </div>
                    <div className="mt-2 text-sm text-[var(--ink)]">
                      {formatSeconds(playback?.available_duration_seconds ?? selectedTask.available_duration_seconds)}
                    </div>
                    <div className="text-xs text-[var(--ink-muted)]">
                      {selectedTask.segments_count} segmentos encontrados
                    </div>
                  </div>
                </div>

                {playbackError && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {playbackError}
                  </div>
                )}

                {playback?.warning && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    {playback.warning}
                  </div>
                )}

                <div className="overflow-hidden rounded-[24px] border border-black/10 bg-[#101826]">
                  {playbackLoading ? (
                    <div className="flex min-h-72 items-center justify-center text-sm text-white/70">
                      Preparando reproduccion...
                    </div>
                  ) : resolvedVideoUrl ? (
                    <video
                      key={resolvedVideoUrl}
                      ref={videoRef}
                      controls
                      crossOrigin="use-credentials"
                      preload="metadata"
                      className="aspect-video w-full bg-black"
                      src={resolvedVideoUrl}
                    />
                  ) : (
                    <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-sm text-white/70">
                      {selectedTask.footage_status === 'available' ? (
                        <Film className="h-8 w-8" />
                      ) : selectedTask.footage_status === 'partial' ? (
                        <CircleAlert className="h-8 w-8" />
                      ) : (
                        <VideoOff className="h-8 w-8" />
                      )}
                      No hay un video reproducible para esta tarea.
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-black/5 bg-white px-4 py-3">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-[var(--ink-muted)]">
                      <Camera className="h-4 w-4" />
                      Camara
                    </div>
                    <div className="mt-2 text-sm text-[var(--ink)]">
                      {selectedTask.camera_feed_ip || playback?.camera_feed_ip || 'Sin mapping'}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-black/5 bg-white px-4 py-3">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-[var(--ink-muted)]">
                      <Clock3 className="h-4 w-4" />
                      Modo
                    </div>
                    <div className="mt-2 text-sm text-[var(--ink)]">
                      {playback?.playback_mode === 'generated'
                        ? 'Clip temporal generado'
                        : playback?.playback_mode === 'source'
                          ? 'Segmento fuente con recorte por tiempo'
                          : 'Sin reproduccion'}
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-black/5 bg-[rgba(15,27,45,0.03)] px-4 py-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-[var(--ink-muted)]">
                    <ShieldCheck className="h-4 w-4" />
                    Segmentos utilizados
                  </div>
                  <div className="mt-3 space-y-3">
                    {playback?.segments.length ? (
                      playback.segments.map((segment) => (
                        <div
                          key={`${segment.segment_id}-${segment.overlap_started_at_utc ?? ''}`}
                          className="rounded-2xl border border-black/5 bg-white px-4 py-3"
                        >
                          <div className="text-sm font-semibold text-[var(--ink)]">
                            {segment.file_name || `Segmento ${segment.segment_id}`}
                          </div>
                          <div className="mt-1 text-xs text-[var(--ink-muted)]">
                            Fuente: {formatDateTime(segment.started_at_utc)} -{' '}
                            {formatDateTime(segment.ended_at_utc)}
                          </div>
                          <div className="mt-1 text-xs text-[var(--ink-muted)]">
                            Overlap: {formatDateTime(segment.overlap_started_at_utc)} -{' '}
                            {formatDateTime(segment.overlap_ended_at_utc)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-4 text-sm text-[var(--ink-muted)]">
                        No hay segmentos disponibles para este rango.
                      </div>
                    )}
                  </div>
                </div>

                {selectedTask.notes && (
                  <div className="rounded-2xl border border-black/5 bg-white px-4 py-3 text-sm text-[var(--ink)]">
                    <div className="mb-2 text-xs uppercase tracking-[0.15em] text-[var(--ink-muted)]">
                      Notas
                    </div>
                    {selectedTask.notes}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
};

export default DashboardTaskFootage;
