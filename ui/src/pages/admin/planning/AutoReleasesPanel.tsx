import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';

type PanelStatus = 'Planned' | 'InProgress' | 'Completed' | 'Consumed';
type ModuleStatus = 'Planned' | 'Panels' | 'Magazine' | 'Assembly' | 'Completed';

export type PanelAutoRelease = {
  id: number;
  created_at: string;
  trigger: string;
  reason: string | null;
  panel_unit_id: number;
  panel_code: string | null;
  work_unit_id: number;
  module_number: number | null;
  project_name: string | null;
  house_identifier: string | null;
  from_station_id: number;
  from_station_name: string | null;
  to_station_id: number | null;
  to_station_name: string | null;
  previous_panel_status: PanelStatus;
  new_panel_status: PanelStatus;
  previous_work_unit_status: ModuleStatus;
  new_work_unit_status: ModuleStatus;
  undone_at: string | null;
  undone_by_name: string | null;
  can_undo: boolean;
  undo_blocked_reason: string | null;
};

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

const moduleStatusLabels: Record<ModuleStatus, string> = {
  Planned: 'Planificado',
  Panels: 'Paneles',
  Magazine: 'Magazine',
  Assembly: 'Ensamblaje',
  Completed: 'Completado',
};

const triggerLabels: Record<string, string> = {
  routing_change: 'Cambio de configuración',
  script: 'Script de reparación',
};

// The API stores UTC without an offset; read it as UTC.
const parseUtc = (value: string): Date =>
  new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);

const formatDateTime = (value: string): string => {
  const date = parseUtc(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const errorDetail = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error) || !error.message) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(error.message) as { detail?: unknown };
    if (typeof parsed.detail === 'string') {
      return parsed.detail;
    }
  } catch {
    // Not JSON; show the raw message.
  }
  return error.message;
};

type AutoReleasesPanelProps = {
  apiRequest: ApiRequest;
  canUndo: boolean;
  onUndone?: () => void;
};

const AutoReleasesPanel: React.FC<AutoReleasesPanelProps> = ({
  apiRequest,
  canUndo,
  onUndone,
}) => {
  const [releases, setReleases] = useState<PanelAutoRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [undoingId, setUndoingId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const loadReleases = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await apiRequest<PanelAutoRelease[]>('/api/production-queue/auto-releases');
      setReleases(data);
    } catch (error) {
      setErrorMessage(errorDetail(error, 'No se pudieron cargar las liberaciones automáticas.'));
    } finally {
      setLoading(false);
    }
  }, [apiRequest]);

  useEffect(() => {
    void loadReleases();
  }, [loadReleases]);

  const handleUndo = async (release: PanelAutoRelease) => {
    const destination = release.to_station_name ?? 'completado';
    const confirmed = window.confirm(
      `¿Devolver el panel ${release.panel_code ?? release.panel_unit_id} de ${destination} a ${
        release.from_station_name ?? 'su estación anterior'
      }?\n\nSi la configuración que lo liberó sigue igual, la próxima edición de configuración lo volverá a liberar. Corrija la configuración primero.`
    );
    if (!confirmed) {
      return;
    }
    setUndoingId(release.id);
    setErrorMessage(null);
    try {
      const updated = await apiRequest<PanelAutoRelease>(
        `/api/production-queue/auto-releases/${release.id}/undo`,
        { method: 'POST' }
      );
      setReleases((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      onUndone?.();
      void loadReleases();
    } catch (error) {
      setErrorMessage(errorDetail(error, 'No se pudo deshacer la liberación.'));
      void loadReleases();
    } finally {
      setUndoingId(null);
    }
  };

  const pendingCount = releases.filter((item) => !item.undone_at).length;
  const visible = expanded ? releases : releases.slice(0, 5);

  return (
    <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-display text-[var(--ink)]">
            Liberaciones automáticas recientes
          </h2>
          <p className="text-sm text-[var(--ink-muted)]">
            Paneles que el sistema movió solo porque su estación quedó sin tareas pendientes
            tras un cambio de configuración (últimos 14 días).
            {pendingCount > 0 ? ` ${pendingCount} sin deshacer.` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadReleases()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-black/5 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </div>

      {errorMessage && (
        <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {!loading && releases.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)]">Sin liberaciones automáticas recientes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
                <th className="py-2 pr-4 font-semibold">Fecha</th>
                <th className="py-2 pr-4 font-semibold">Módulo</th>
                <th className="py-2 pr-4 font-semibold">Panel</th>
                <th className="py-2 pr-4 font-semibold">Movimiento</th>
                <th className="py-2 pr-4 font-semibold">Motivo</th>
                <th className="py-2 font-semibold text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((release) => {
                const moduleChanged =
                  release.previous_work_unit_status !== release.new_work_unit_status;
                return (
                  <tr key={release.id} className="border-t border-black/5 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap text-[var(--ink-muted)]">
                      {formatDateTime(release.created_at)}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="font-medium text-[var(--ink)]">
                        {release.project_name ?? '-'} · {release.house_identifier ?? '-'}
                      </div>
                      <div className="text-xs text-[var(--ink-muted)]">
                        MD{release.module_number ?? '?'}
                        {moduleChanged &&
                          ` · ${moduleStatusLabels[release.previous_work_unit_status]} → ${
                            moduleStatusLabels[release.new_work_unit_status]
                          }`}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-[var(--ink)]">
                      {release.panel_code ?? `#${release.panel_unit_id}`}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap text-[var(--ink)]">
                      {release.from_station_name ?? `#${release.from_station_id}`} →{' '}
                      {release.to_station_name ?? (
                        <span className="font-semibold text-[var(--leaf)]">Completado</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs text-[var(--ink-muted)]">
                      {release.reason ?? triggerLabels[release.trigger] ?? release.trigger}
                    </td>
                    <td className="py-2 text-right">
                      {release.undone_at ? (
                        <span className="text-xs text-[var(--ink-muted)]">
                          Deshecha {formatDateTime(release.undone_at)}
                          {release.undone_by_name ? ` por ${release.undone_by_name}` : ''}
                        </span>
                      ) : release.can_undo ? (
                        <button
                          type="button"
                          onClick={() => void handleUndo(release)}
                          disabled={!canUndo || undoingId !== null}
                          title={
                            canUndo ? 'Devolver el panel a su estación anterior' : 'Sin permiso'
                          }
                          className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {undoingId === release.id ? 'Deshaciendo...' : 'Deshacer'}
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--ink-muted)]">
                          {release.undo_blocked_reason ?? 'No se puede deshacer'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {releases.length > 5 && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="mt-3 text-xs font-semibold text-[var(--accent)] hover:underline"
            >
              {expanded ? 'Mostrar menos' : `Mostrar todas (${releases.length})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
};

export default AutoReleasesPanel;
