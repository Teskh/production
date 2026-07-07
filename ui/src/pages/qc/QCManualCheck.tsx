import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardPlus, FlaskConical, ListChecks, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useOptionalQCSession } from '../../layouts/QCLayoutContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const QC_ROLE_VALUES = new Set(['Calidad', 'QC']);

type TaskScope = 'panel' | 'module' | 'aux';
type QCCheckKind = 'triggered' | 'manual_template';

type QCCheckDefinition = {
  id: number;
  name: string;
  kind: QCCheckKind;
  active: boolean;
  archived_at: string | null;
};

type ProductionQueueItem = {
  id: number;
  project_name: string;
  house_identifier: string;
  module_number: number;
  house_type_name: string;
  status: string;
};

type PanelStatus = {
  panel_unit_id: number | null;
  panel_code: string | null;
  status: string;
  current_station_id: number | null;
  current_station_name: string | null;
};

type ManualCheckResponse = {
  id: number;
};

type ProductionQueueModuleStatus = {
  current_station_id: number | null;
  current_station_name: string | null;
  panels: PanelStatus[];
};

type ManualMode = 'ad_hoc' | 'definition';

const apiRequest = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Solicitud fallida (${response.status})`);
  }
  return (await response.json()) as T;
};

const QCManualCheck: React.FC = () => {
  const navigate = useNavigate();
  const qcSession = useOptionalQCSession();
  const canCreate = Boolean(qcSession?.role && QC_ROLE_VALUES.has(qcSession.role));

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [workUnits, setWorkUnits] = useState<ProductionQueueItem[]>([]);
  const [checkDefinitions, setCheckDefinitions] = useState<QCCheckDefinition[]>([]);
  const [moduleStatus, setModuleStatus] = useState<ProductionQueueModuleStatus | null>(null);
  const [panels, setPanels] = useState<PanelStatus[]>([]);
  const [moduleStatusLoading, setModuleStatusLoading] = useState(false);

  const [mode, setMode] = useState<ManualMode>('ad_hoc');
  const [scope, setScope] = useState<TaskScope>('module');
  const [workUnitId, setWorkUnitId] = useState<number | null>(null);
  const [panelUnitId, setPanelUnitId] = useState<number | null>(null);
  const [checkDefinitionId, setCheckDefinitionId] = useState<number | null>(null);
  const [adHocTitle, setAdHocTitle] = useState('');

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      setLoading(true);
      try {
        const [queue, defs] = await Promise.all([
          apiRequest<ProductionQueueItem[]>('/api/production-queue?include_completed=false'),
          apiRequest<QCCheckDefinition[]>('/api/qc/check-definitions'),
        ]);
        if (!active) {
          return;
        }
        setWorkUnits(queue);
        setCheckDefinitions(defs.filter((item) => item.active && !item.archived_at));
        setErrorMessage(null);
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'No se pudieron cargar datos.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void loadData();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!workUnitId) {
      setPanelUnitId(null);
      setModuleStatus(null);
      setPanels([]);
      return;
    }
    let active = true;
    const loadModuleStatus = async () => {
      setModuleStatusLoading(true);
      try {
        const status = await apiRequest<ProductionQueueModuleStatus>(
          `/api/production-queue/items/${workUnitId}/status`
        );
        if (!active) {
          return;
        }
        setModuleStatus(status);
        setPanels(status.panels.filter((panel) => panel.panel_unit_id !== null));
      } catch {
        if (active) {
          setModuleStatus(null);
          setPanels([]);
        }
      } finally {
        if (active) {
          setModuleStatusLoading(false);
        }
      }
    };
    void loadModuleStatus();
    return () => {
      active = false;
    };
  }, [workUnitId]);

  useEffect(() => {
    if (scope !== 'panel') {
      setPanelUnitId(null);
    }
  }, [scope]);

  const sortedDefinitions = useMemo(
    () => [...checkDefinitions].sort((a, b) => a.name.localeCompare(b.name)),
    [checkDefinitions]
  );
  const selectedPanel = useMemo(
    () => panels.find((panel) => panel.panel_unit_id === panelUnitId) ?? null,
    [panelUnitId, panels]
  );
  const currentStationName =
    scope === 'panel'
      ? selectedPanel?.current_station_name ?? moduleStatus?.current_station_name ?? null
      : moduleStatus?.current_station_name ?? null;

  const requiresPanel = scope === 'panel';
  const canSubmit =
    canCreate &&
    !submitting &&
    !!workUnitId &&
    (!requiresPanel || !!panelUnitId) &&
    (mode === 'definition' ? !!checkDefinitionId : adHocTitle.trim().length > 0);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !workUnitId) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        check_definition_id: mode === 'definition' ? checkDefinitionId : null,
        ad_hoc_title: mode === 'ad_hoc' ? adHocTitle.trim() : null,
        ad_hoc_guidance: null,
        scope,
        work_unit_id: workUnitId,
        panel_unit_id: scope === 'panel' ? panelUnitId : null,
        station_id: null,
      };
      const created = await apiRequest<ManualCheckResponse>('/api/qc/check-instances/manual', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      navigate(`/qc/execute?check=${created.id}`, { state: { checkId: created.id } });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'No se pudo crear la inspeccion.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">QC manual</p>
            <h2 className="mt-2 text-2xl font-display text-[var(--ink)]">Crear inspeccion manual</h2>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Abra una inspeccion fuera del flujo de triggers, sobre modulo o panel especifico.
            </p>
          </div>
          <Link
            to="/qc"
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-sm"
          >
            <ArrowLeft className="h-4 w-4" /> Volver al tablero
          </Link>
        </div>
      </section>

      {!canCreate ? (
        <section className="rounded-3xl border border-black/10 bg-white p-6 text-sm text-[var(--ink-muted)] shadow-sm">
          Tu sesion no tiene permisos QC para crear inspecciones manuales.
          <button
            type="button"
            onClick={() => navigate('/qc', { state: { qcLogin: true } })}
            className="ml-2 font-semibold text-[var(--ink)] underline"
          >
            Iniciar sesion QC
          </button>
        </section>
      ) : null}

      {(errorMessage || submitError) && (
        <section className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 shadow-sm">
          {submitError ?? errorMessage}
        </section>
      )}

      <form onSubmit={handleSubmit}>
        <section className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm">
          <div className="grid gap-5">
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Tipo</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode('ad_hoc');
                    setCheckDefinitionId(null);
                  }}
                  className={clsx(
                    'rounded-2xl border px-4 py-3 text-left transition',
                    mode === 'ad_hoc'
                      ? 'border-[var(--ink)] bg-[rgba(15,27,45,0.05)]'
                      : 'border-black/10 bg-white hover:bg-[rgba(15,27,45,0.03)]'
                  )}
                >
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                    <FlaskConical className="h-4 w-4" /> Libre
                  </span>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">Ad-hoc con titulo libre.</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('definition');
                    setAdHocTitle('');
                  }}
                  className={clsx(
                    'rounded-2xl border px-4 py-3 text-left transition',
                    mode === 'definition'
                      ? 'border-[var(--ink)] bg-[rgba(15,27,45,0.05)]'
                      : 'border-black/10 bg-white hover:bg-[rgba(15,27,45,0.03)]'
                  )}
                >
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                    <ListChecks className="h-4 w-4" /> Desde check
                  </span>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    Usa un check definido, aunque no se haya disparado.
                  </p>
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm text-[var(--ink)]">
                Alcance
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value as TaskScope)}
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                >
                  <option value="module">Modulo</option>
                  <option value="panel">Panel</option>
                  <option value="aux">Aux</option>
                </select>
              </label>

              <label className="grid gap-2 text-sm text-[var(--ink)]">
                Modulo objetivo
                <select
                  value={workUnitId ?? ''}
                  onChange={(event) => {
                    const next = Number(event.target.value) || null;
                    setWorkUnitId(next);
                    setPanelUnitId(null);
                  }}
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Seleccionar modulo...</option>
                  {workUnits.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.project_name} · Casa {item.house_identifier} · Modulo {item.module_number}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {scope === 'panel' ? (
              <label className="grid gap-2 text-sm text-[var(--ink)]">
                Panel objetivo
                <select
                  value={panelUnitId ?? ''}
                  onChange={(event) => setPanelUnitId(Number(event.target.value) || null)}
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  disabled={!workUnitId || moduleStatusLoading}
                >
                  <option value="">Seleccionar panel...</option>
                  {panels.map((panel) => (
                    <option key={panel.panel_unit_id ?? panel.panel_code} value={panel.panel_unit_id ?? ''}>
                      {panel.panel_code ?? 'Panel'} · {panel.status}
                    </option>
                  ))}
                </select>
                {moduleStatusLoading ? (
                  <span className="text-xs text-[var(--ink-muted)]">Cargando paneles del modulo...</span>
                ) : null}
              </label>
            ) : null}

            <div className="grid gap-2 text-sm text-[var(--ink)]">
              <span>Estacion actual</span>
              <div className="rounded-xl border border-black/10 bg-[rgba(15,27,45,0.03)] px-3 py-2 text-sm text-[var(--ink)]">
                {workUnitId
                  ? moduleStatusLoading
                    ? 'Cargando estacion...'
                    : currentStationName ?? 'Sin estacion actual'
                  : 'Seleccione un modulo'}
              </div>
            </div>

            {mode === 'definition' ? (
              <label className="grid gap-2 text-sm text-[var(--ink)]">
                Check predefinido
                <select
                  value={checkDefinitionId ?? ''}
                  onChange={(event) => setCheckDefinitionId(Number(event.target.value) || null)}
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Seleccionar check...</option>
                  {sortedDefinitions.map((definition) => (
                    <option key={definition.id} value={definition.id}>
                      {definition.name} · {definition.kind === 'triggered' ? 'Trigger' : 'Plantilla manual'}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="grid gap-2 text-sm text-[var(--ink)]">
                Titulo
                <input
                  value={adHocTitle}
                  onChange={(event) => setAdHocTitle(event.target.value)}
                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder="Ej: Verificacion dimensional especial"
                />
              </label>
            )}

            <button
              type="submit"
              disabled={!canSubmit || loading}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--ink)] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1b3552] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardPlus className="h-4 w-4" />}
              {submitting ? 'Creando...' : 'Crear e iniciar inspeccion'}
            </button>

            {loading ? (
              <p className="text-xs text-[var(--ink-muted)]">Cargando datos iniciales...</p>
            ) : null}
          </div>
        </section>
      </form>
    </div>
  );
};

export default QCManualCheck;
