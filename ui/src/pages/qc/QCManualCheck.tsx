import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardPlus,
  Factory,
  FlaskConical,
  ListChecks,
  Loader2,
  Search,
} from 'lucide-react';
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
  status: string;
  current_station_id: number | null;
  current_station_name: string | null;
  panels: PanelStatus[];
};

type FinishedModule = {
  work_unit_id: number;
  module_number: number;
  project_name: string | null;
  house_type_name: string | null;
  house_identifier: string | null;
  completed_at: string | null;
};

type ManualMode = 'ad_hoc' | 'definition';
type ModuleSource = 'plant' | 'finished';

const FINISHED_RECENT_DAYS = 7;

const inspectionScopeForStatus = (status: string | null | undefined): TaskScope | null => {
  if (status === 'Panels') return 'panel';
  if (status === 'Magazine' || status === 'Assembly' || status === 'Completed') return 'module';
  return null;
};

// The API stores UTC without an offset; read it as UTC.
const parseUtc = (value: string): Date =>
  new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);

const formatFinishedAgo = (value: string | null): string => {
  if (!value) return 'Sin fecha de término';
  const finished = parseUtc(value);
  if (Number.isNaN(finished.getTime())) return 'Sin fecha de término';
  const minutes = Math.max(0, Math.round((Date.now() - finished.getTime()) / 60000));
  if (minutes < 60) return minutes <= 1 ? 'terminado recién' : `terminado hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `terminado hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'terminado ayer';
  if (days < 14) return `terminado hace ${days} días`;
  return `terminado el ${finished.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
};

const moduleLabel = (item: {
  project_name: string | null;
  house_identifier: string | null;
  module_number: number;
}): string =>
  `${item.project_name ?? 'Proyecto'} · Casa ${item.house_identifier ?? '—'} · Módulo ${item.module_number}`;

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

  const [source, setSource] = useState<ModuleSource>('plant');
  const [finishedModules, setFinishedModules] = useState<FinishedModule[]>([]);
  const [finishedSearch, setFinishedSearch] = useState('');
  const [finishedLoading, setFinishedLoading] = useState(false);
  const [finishedError, setFinishedError] = useState<string | null>(null);
  // Kept apart from the search results so the choice stays visible while searching.
  const [selectedFinished, setSelectedFinished] = useState<FinishedModule | null>(null);

  const [mode, setMode] = useState<ManualMode>('ad_hoc');
  const [workUnitId, setWorkUnitId] = useState<number | null>(null);
  const [panelUnitId, setPanelUnitId] = useState<number | null>(null);
  const [checkDefinitionId, setCheckDefinitionId] = useState<number | null>(null);
  const [adHocTitle, setAdHocTitle] = useState('');

  useEffect(() => {
    if (!canCreate) {
      setLoading(false);
      return;
    }
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
        setWorkUnits(queue.filter((item) => inspectionScopeForStatus(item.status) !== null));
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
  }, [canCreate]);

  useEffect(() => {
    if (!canCreate || source !== 'finished') {
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setFinishedLoading(true);
      try {
        const params = new URLSearchParams({ days: String(FINISHED_RECENT_DAYS) });
        const query = finishedSearch.trim();
        if (query) {
          params.set('q', query);
        }
        const rows = await apiRequest<FinishedModule[]>(`/api/qc/finished-modules?${params.toString()}`);
        if (!active) {
          return;
        }
        setFinishedModules(rows);
        setFinishedError(null);
      } catch (error) {
        if (active) {
          setFinishedError(
            error instanceof Error ? error.message : 'No se pudieron cargar los módulos terminados.'
          );
        }
      } finally {
        if (active) {
          setFinishedLoading(false);
        }
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [canCreate, source, finishedSearch]);

  useEffect(() => {
    if (!workUnitId) {
      setPanelUnitId(null);
      setModuleStatus(null);
      setPanels([]);
      return;
    }
    let active = true;
    const loadModuleStatus = async () => {
      setModuleStatus(null);
      setPanels([]);
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

  const sortedDefinitions = useMemo(
    () => [...checkDefinitions].sort((a, b) => a.name.localeCompare(b.name)),
    [checkDefinitions]
  );
  const selectedPanel = useMemo(
    () => panels.find((panel) => panel.panel_unit_id === panelUnitId) ?? null,
    [panelUnitId, panels]
  );
  const selectedWorkUnit = useMemo(
    () => workUnits.find((item) => item.id === workUnitId) ?? null,
    [workUnitId, workUnits]
  );
  const isFinished = source === 'finished';
  const scope = isFinished
    ? workUnitId
      ? 'module'
      : null
    : inspectionScopeForStatus(moduleStatus?.status ?? selectedWorkUnit?.status);
  const currentStationName =
    scope === 'panel'
      ? selectedPanel?.current_station_name ?? moduleStatus?.current_station_name ?? null
      : moduleStatus?.current_station_name ?? null;

  const handleSourceChange = (next: ModuleSource) => {
    if (next === source) {
      return;
    }
    setSource(next);
    setSelectedFinished(null);
    setWorkUnitId(null);
    setPanelUnitId(null);
    setSubmitError(null);
  };

  const requiresPanel = scope === 'panel';
  const canSubmit =
    canCreate &&
    !submitting &&
    !moduleStatusLoading &&
    !!workUnitId &&
    scope !== null &&
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
    <div className="qc-page space-y-5">
      <header className="qc-page__header">
        <div>
          <p className="qc-page__eyebrow">QC manual · Apertura controlada</p>
          <h2 className="qc-page__title">Nueva inspección</h2>
          <p className="qc-page__intro">
            Abra una revisión fuera del flujo automático y ubíquela en el módulo, panel y
            estación correctos antes de comenzar.
          </p>
        </div>
        <Link to="/qc" className="qc-btn shrink-0">
          <ArrowLeft className="h-4 w-4" /> Volver
        </Link>
      </header>

      {!canCreate ? (
        <section className="qc-card p-6">
          <div className="max-w-xl">
            <p className="qc-page__eyebrow">Acceso restringido</p>
            <h3 className="qc-page__title mt-2 text-[26px]">Se requiere una sesión QC</h3>
            <p className="qc-page__intro">
              La biblioteca y el tablero son públicos. Crear y ejecutar inspecciones requiere
              identificar al responsable de calidad.
            </p>
            <button
              type="button"
              onClick={() => navigate('/qc', { state: { qcLogin: true } })}
              className="qc-btn qc-btn--primary mt-5"
            >
              Iniciar sesión QC
            </button>
          </div>
        </section>
      ) : (
        <>
          {(errorMessage || submitError) && (
            <div className="qc-notice qc-notice--error">{submitError ?? errorMessage}</div>
          )}

          <form onSubmit={handleSubmit}>
            <section className="qc-card overflow-hidden">
              <div className="qc-card__header">
                <h3 className="qc-section-title">
                  <span className="qc-section-index">01</span>
                  Origen de la inspección
                </h3>
              </div>
              <div className="grid gap-6 p-5 sm:p-6">
                <div className="qc-segment">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('ad_hoc');
                      setCheckDefinitionId(null);
                    }}
                    className={clsx(
                      'qc-segment__option',
                      mode === 'ad_hoc' && 'qc-segment__option--active'
                    )}
                  >
                    <span className="inline-flex items-center gap-2 text-sm font-semibold">
                      <FlaskConical className="h-4 w-4" /> Revisión libre
                    </span>
                    <p className={clsx('mt-1 text-xs', mode === 'ad_hoc' ? 'text-white/70' : 'text-[var(--qc-muted)]')}>
                      Registre un control puntual con título propio.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('definition');
                      setAdHocTitle('');
                    }}
                    className={clsx(
                      'qc-segment__option',
                      mode === 'definition' && 'qc-segment__option--active'
                    )}
                  >
                    <span className="inline-flex items-center gap-2 text-sm font-semibold">
                      <ListChecks className="h-4 w-4" /> Check definido
                    </span>
                    <p className={clsx('mt-1 text-xs', mode === 'definition' ? 'text-white/70' : 'text-[var(--qc-muted)]')}>
                      Reutilice una pauta existente sin esperar su gatillante.
                    </p>
                  </button>
                </div>

                {mode === 'definition' ? (
                  <label className="qc-field">
                    Check predefinido
                    <select
                      value={checkDefinitionId ?? ''}
                      onChange={(event) => setCheckDefinitionId(Number(event.target.value) || null)}
                      className="qc-input"
                    >
                      <option value="">Seleccionar check…</option>
                      {sortedDefinitions.map((definition) => (
                        <option key={definition.id} value={definition.id}>
                          {definition.name} · {definition.kind === 'triggered' ? 'Trigger' : 'Plantilla manual'}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="qc-field">
                    Título de la revisión
                    <input
                      value={adHocTitle}
                      onChange={(event) => setAdHocTitle(event.target.value)}
                      className="qc-input"
                      placeholder="Ej: Verificación dimensional especial"
                      autoFocus
                    />
                  </label>
                )}
              </div>

              <div className="qc-card__header border-t border-[var(--qc-line)]">
                <h3 className="qc-section-title">
                  <span className="qc-section-index">02</span>
                  Módulo a inspeccionar
                </h3>
              </div>
              <div className="grid gap-5 p-5 sm:p-6">
                <div className="qc-segment">
                  <button
                    type="button"
                    onClick={() => handleSourceChange('plant')}
                    className={clsx(
                      'qc-segment__option',
                      !isFinished && 'qc-segment__option--active'
                    )}
                  >
                    <span className="inline-flex items-center gap-2 text-sm font-semibold">
                      <Factory className="h-4 w-4" /> En planta
                    </span>
                    <p className={clsx('mt-1 text-xs', !isFinished ? 'text-white/70' : 'text-[var(--qc-muted)]')}>
                      Módulos en paneles, magazine o armado.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSourceChange('finished')}
                    className={clsx(
                      'qc-segment__option',
                      isFinished && 'qc-segment__option--active'
                    )}
                  >
                    <span className="inline-flex items-center gap-2 text-sm font-semibold">
                      <CheckCircle2 className="h-4 w-4" /> Terminados
                    </span>
                    <p className={clsx('mt-1 text-xs', isFinished ? 'text-white/70' : 'text-[var(--qc-muted)]')}>
                      Revise un módulo que ya salió de la línea.
                    </p>
                  </button>
                </div>

                {isFinished ? (
                  <div className="grid gap-3">
                    <label className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--qc-muted)]" />
                      <input
                        value={finishedSearch}
                        onChange={(event) => setFinishedSearch(event.target.value)}
                        placeholder="Buscar proyecto, casa o tipo…"
                        className="qc-input qc-input--with-icon"
                        aria-label="Buscar módulos terminados"
                      />
                    </label>
                    <div className="qc-finished-list" role="listbox" aria-label="Módulos terminados">
                      {finishedError ? (
                        <p className="qc-finished-list__empty">{finishedError}</p>
                      ) : finishedLoading && finishedModules.length === 0 ? (
                        <p className="qc-finished-list__empty">Cargando módulos terminados…</p>
                      ) : finishedModules.length === 0 ? (
                        <p className="qc-finished-list__empty">
                          {finishedSearch.trim()
                            ? 'Ningún módulo terminado coincide con la búsqueda.'
                            : `No hay módulos terminados en los últimos ${FINISHED_RECENT_DAYS} días.`}
                        </p>
                      ) : (
                        finishedModules.map((item) => {
                          const selected = item.work_unit_id === workUnitId;
                          return (
                            <button
                              key={item.work_unit_id}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onClick={() => {
                                setSelectedFinished(item);
                                setWorkUnitId(item.work_unit_id);
                              }}
                              className={clsx(
                                'qc-finished-list__row',
                                selected && 'qc-finished-list__row--active'
                              )}
                            >
                              <span className="qc-finished-list__name">{moduleLabel(item)}</span>
                              <span className="qc-finished-list__when">
                                {formatFinishedAgo(item.completed_at)}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                    <p className="text-xs text-[var(--qc-muted)]">
                      {finishedSearch.trim()
                        ? 'Buscando en todos los módulos terminados.'
                        : `Últimos ${FINISHED_RECENT_DAYS} días, más reciente primero. Busque para ver módulos anteriores.`}
                    </p>
                  </div>
                ) : null}

                <div
                  className={clsx(
                    'grid gap-4',
                    !isFinished && 'sm:grid-cols-[180px_minmax(0,1fr)]'
                  )}
                >
                  <div className="qc-field">
                    Alcance
                    <div className="qc-readout">
                      {workUnitId
                        ? isFinished
                          ? 'Módulo completo · revisión post-término'
                          : scope === 'panel'
                            ? 'Panel · definido por estado Paneles'
                            : 'Módulo · definido por estado de producción'
                        : 'Se definirá al seleccionar un módulo'}
                    </div>
                  </div>

                  {!isFinished ? (
                  <label className="qc-field">
                    Módulo objetivo
                    <select
                      value={workUnitId ?? ''}
                      onChange={(event) => {
                        const next = Number(event.target.value) || null;
                        setWorkUnitId(next);
                        setPanelUnitId(null);
                      }}
                      className="qc-input"
                    >
                      <option value="">Seleccionar módulo…</option>
                      {workUnits.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.project_name} · Casa {item.house_identifier} · Módulo {item.module_number}
                        </option>
                      ))}
                    </select>
                  </label>
                  ) : null}
                </div>

                {scope === 'panel' ? (
                  <label className="qc-field">
                    Panel objetivo
                    <select
                      value={panelUnitId ?? ''}
                      onChange={(event) => setPanelUnitId(Number(event.target.value) || null)}
                      className="qc-input"
                      disabled={!workUnitId || moduleStatusLoading}
                    >
                      <option value="">Seleccionar panel…</option>
                      {panels.map((panel) => (
                        <option key={panel.panel_unit_id ?? panel.panel_code} value={panel.panel_unit_id ?? ''}>
                          {panel.panel_code ?? 'Panel'} · {panel.status}
                        </option>
                      ))}
                    </select>
                    {moduleStatusLoading ? <span>Cargando paneles del módulo…</span> : null}
                  </label>
                ) : null}

                {isFinished ? (
                  selectedFinished ? (
                    <div className="qc-field">
                      Módulo seleccionado
                      <div className="qc-readout">
                        {moduleLabel(selectedFinished)} · {formatFinishedAgo(selectedFinished.completed_at)}
                      </div>
                    </div>
                  ) : null
                ) : (
                  <div className="qc-field">
                    Estación detectada
                    <div className="qc-readout">
                      {workUnitId
                        ? moduleStatusLoading
                          ? 'Consultando ubicación…'
                          : currentStationName ?? 'Sin estación actual'
                        : 'Se mostrará al seleccionar un módulo'}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 border-t border-[var(--qc-line)] bg-[var(--qc-paper-raised)] p-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-[var(--qc-muted)]">
                  {isFinished
                    ? 'La inspección se abrirá en modo ejecución. Si falla, queda registrada sin generar retrabajo.'
                    : 'La inspección se abrirá directamente en modo ejecución.'}
                </p>
                <button type="submit" disabled={!canSubmit || loading} className="qc-btn qc-btn--primary sm:min-w-[230px]">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardPlus className="h-4 w-4" />}
                  {submitting ? 'Creando…' : 'Crear e iniciar'}
                </button>
              </div>
            </section>
          </form>
        </>
      )}
    </div>
  );
};

export default QCManualCheck;
