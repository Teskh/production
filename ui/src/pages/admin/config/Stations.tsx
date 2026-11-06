import React, { useEffect, useMemo, useState } from 'react';
import { Camera, Plus, Search, Settings2, Trash2, X } from 'lucide-react';
import {
  assertAdminPageMutationAllowed,
  useAdminHeader,
  useAdminPageAccess,
} from '../../../layouts/AdminLayoutContext';
import DashboardShiftEstimation from './dashboard_shift_estimation';
import {
  readStationChangeProtectionEnabled,
  writeStationChangeProtectionEnabled,
} from '../../../utils/stationChangeProtection';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type StationRole = 'Panels' | 'Magazine' | 'Assembly' | 'AUX';
type StationLineType = '1' | '2' | '3';

type Station = {
  id: number;
  name: string;
  role: StationRole;
  line_type: StationLineType | null;
  sequence_order: number | null;
  camera_feed_ip: string | null;
};

type StationDraft = {
  id?: number;
  name: string;
  role: StationRole;
  line_type: StationLineType | '';
  sequence_order: string;
};

type StationChangeImpact = {
  panels_at_station: number;
  modules_at_station: number;
  blocking_message: string | null;
  sequence_conflict_station: string | null;
  routed_task_count: number;
  routed_task_names: string[];
  missing_panel_start: boolean;
  warnings: string[];
};

type AdvanceCoverageStation = {
  station_id: number;
  station_name: string;
  line_type: string | null;
  sequence_order: number;
  advance_task_names: string[];
  house_types: { house_type_name: string; module_numbers: number[]; reason: string }[];
};

const emptyDraft = (): StationDraft => ({
  name: '',
  role: 'Panels',
  line_type: '',
  sequence_order: '',
});

const buildDraftFromStation = (station: Station): StationDraft => ({
  id: station.id,
  name: station.name,
  role: station.role,
  line_type: station.line_type ?? '',
  sequence_order: station.sequence_order !== null ? String(station.sequence_order) : '',
});

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
    let message = text;
    if (text) {
      try {
        const data = JSON.parse(text) as { detail?: unknown };
        if (typeof data?.detail === 'string') {
          message = data.detail;
        }
      } catch {
        // Fall through to the raw text.
      }
    }
    throw new Error(message || `Solicitud fallida (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

const normalizeSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const Stations: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const { canEdit } = useAdminPageAccess();
  const pageApiRequest = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    assertAdminPageMutationAllowed(canEdit, options);
    return apiRequest<T>(path, options);
  };
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [draft, setDraft] = useState<StationDraft | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'builder' | 'shift-estimation'>('builder');
  const [cameraModalStation, setCameraModalStation] = useState<Station | null>(null);
  const [advanceCoverage, setAdvanceCoverage] = useState<AdvanceCoverageStation[]>([]);
  const [stationChangeProtectionEnabled, setStationChangeProtectionEnabled] = useState(
    () => readStationChangeProtectionEnabled()
  );

  useEffect(() => {
    setHeader({
      title: 'Constructor de estaciones',
      kicker: 'Configuracion / Estaciones',
    });
  }, [setHeader]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setStatusMessage(null);
      try {
        const data = await pageApiRequest<Station[]>('/api/stations');
        if (!active) {
          return;
        }
        setStations(data);
        void loadAdvanceCoverage();
        if (data.length > 0) {
          setSelectedStationId(data[0].id);
          setDraft(buildDraftFromStation(data[0]));
        } else {
          setSelectedStationId(null);
          setDraft(emptyDraft());
        }
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error ? error.message : 'No se pudieron cargar las estaciones.';
          setStatusMessage(message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const loadAdvanceCoverage = async () => {
    try {
      const coverage = await pageApiRequest<AdvanceCoverageStation[]>(
        '/api/task-definitions/advance-trigger-coverage'
      );
      setAdvanceCoverage(coverage);
    } catch {
      // Advisory only.
      setAdvanceCoverage([]);
    }
  };

  const fetchChangeImpact = (stationId: number, params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString();
    return pageApiRequest<StationChangeImpact>(
      `/api/stations/${stationId}/change-impact${query ? `?${query}` : ''}`
    );
  };

  const filteredStations = useMemo(() => {
    const query = normalizeSearch(search.trim());
    if (!query) {
      return stations;
    }
    return stations.filter((station) => {
      const haystack = normalizeSearch(
        `${station.name} ${station.role} ${station.line_type ?? ''} ${station.sequence_order ?? ''}`
      );
      return haystack.includes(query);
    });
  }, [search, stations]);

  const groupedStations = useMemo(() => {
    const bySequenceThenName = (a: Station, b: Station) => {
      const sequenceCompare = (a.sequence_order ?? 9999) - (b.sequence_order ?? 9999);
      if (sequenceCompare !== 0) {
        return sequenceCompare;
      }
      return a.name.localeCompare(b.name);
    };
    const panels: Station[] = [];
    const magazine: Station[] = [];
    const aux: Station[] = [];
    const assemblyLines: Record<StationLineType, Station[]> = {
      '1': [],
      '2': [],
      '3': [],
    };
    const assemblyOther: Station[] = [];
    filteredStations.forEach((station) => {
      if (station.role === 'Panels') {
        panels.push(station);
        return;
      }
      if (station.role === 'Magazine') {
        magazine.push(station);
        return;
      }
      if (station.role === 'AUX') {
        aux.push(station);
        return;
      }
      if (station.role === 'Assembly') {
        const lineType = station.line_type;
        if (lineType && assemblyLines[lineType]) {
          assemblyLines[lineType].push(station);
        } else {
          assemblyOther.push(station);
        }
      }
    });
    panels.sort(bySequenceThenName);
    magazine.sort(bySequenceThenName);
    aux.sort(bySequenceThenName);
    (Object.keys(assemblyLines) as StationLineType[]).forEach((line) => {
      assemblyLines[line].sort(bySequenceThenName);
    });
    assemblyOther.sort(bySequenceThenName);
    return {
      panels,
      magazine,
      aux,
      assemblyLines,
      assemblyOther,
    };
  }, [filteredStations]);

  const advanceCoverageSummary = useMemo(() => {
    const bySequence = new Map<number, { names: Set<string>; lines: Set<string>; houses: Set<string> }>();
    advanceCoverage.forEach((entry) => {
      const group = bySequence.get(entry.sequence_order) ?? {
        names: new Set<string>(),
        lines: new Set<string>(),
        houses: new Set<string>(),
      };
      group.names.add(entry.station_name.trim());
      if (entry.line_type) {
        group.lines.add(entry.line_type);
      }
      entry.house_types.forEach((houseType) => group.houses.add(houseType.house_type_name.trim()));
      bySequence.set(entry.sequence_order, group);
    });
    return Array.from(bySequence.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([sequence, group]) => {
        const lines = Array.from(group.lines).sort();
        const lineLabel = lines.length ? `, L${lines.join('/')}` : '';
        const houses = Array.from(group.houses);
        const houseLabel =
          houses.length > 3 ? `${houses.slice(0, 3).join(', ')} +${houses.length - 3}` : houses.join(', ');
        return `${Array.from(group.names).join(' / ')} (Sec ${sequence}${lineLabel}: ${houseLabel})`;
      });
  }, [advanceCoverage]);

  const summaryLabel = useMemo(() => {
    const assemblyLines = new Set(
      stations.filter((station) => station.role === 'Assembly' && station.line_type).map((s) => s.line_type)
    );
    return `${stations.length} estaciones - ${assemblyLines.size} lineas de ensamblaje`;
  }, [stations]);

  const selectStation = (station: Station) => {
    setSelectedStationId(station.id);
    setDraft(buildDraftFromStation(station));
    setStatusMessage(null);
  };

  const handleAddStation = () => {
    setSelectedStationId(null);
    setDraft(emptyDraft());
    setStatusMessage(null);
  };

  const handleDraftChange = (patch: Partial<StationDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleRoleChange = (role: StationRole) => {
    setDraft((prev) => {
      if (!prev) {
        return prev;
      }
      let lineType = prev.line_type;
      let sequence = prev.sequence_order;
      if (role === 'Assembly' && !lineType) {
        lineType = '1';
      }
      if (role !== 'Assembly') {
        lineType = '';
      }
      if (role === 'AUX') {
        sequence = '';
      }
      return { ...prev, role, line_type: lineType, sequence_order: sequence };
    });
  };

  const parseSequenceOrder = (value: string, role: StationRole): number | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      if (role === 'AUX') {
        return null;
      }
      throw new Error('Se requiere orden de secuencia para estaciones no AUX.');
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error('El orden de secuencia debe ser un numero entero positivo.');
    }
    return parsed;
  };

  const buildPayload = (current: StationDraft) => {
    const name = current.name.trim();
    if (!name) {
      throw new Error('Se requiere el nombre de la estacion.');
    }
    const role = current.role;
    const isAssembly = role === 'Assembly';
    const isAux = role === 'AUX';
    const lineType = isAssembly ? current.line_type : '';
    if (isAssembly && !lineType) {
      throw new Error('Las estaciones de ensamblaje requieren un tipo de linea.');
    }
    if (!isAssembly && lineType) {
      throw new Error('El tipo de linea solo se permite en estaciones de ensamblaje.');
    }
    const sequenceOrder = isAux ? null : parseSequenceOrder(current.sequence_order, role);
    if (isAux && current.sequence_order.trim()) {
      throw new Error('Las estaciones AUX no deben tener orden de secuencia.');
    }
    return {
      name,
      role,
      line_type: isAssembly ? lineType : null,
      sequence_order: sequenceOrder,
    };
  };

  const handleSave = async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      const payload = buildPayload(draft);
      const current = draft.id ? stations.find((station) => station.id === draft.id) : null;
      const placementChanged =
        current != null &&
        (current.role !== payload.role ||
          (current.line_type ?? null) !== (payload.line_type || null) ||
          current.sequence_order !== payload.sequence_order);
      if (current && placementChanged) {
        const params: Record<string, string> = { role: payload.role };
        if (payload.line_type) {
          params.line_type = payload.line_type;
        }
        if (payload.sequence_order !== null) {
          params.sequence_order = String(payload.sequence_order);
        }
        const impact = await fetchChangeImpact(current.id, params);
        if (impact.blocking_message) {
          setStatusMessage(impact.blocking_message);
          return;
        }
        if (impact.sequence_conflict_station) {
          setStatusMessage(impact.warnings[0] ?? 'La secuencia ya esta en uso.');
          return;
        }
        if (
          impact.warnings.length > 0 &&
          !window.confirm(
            `${impact.warnings.join('\n\n')}\n\n¿Guardar los cambios de ${current.name}?`
          )
        ) {
          return;
        }
      }
      let saved: Station;
      if (draft.id) {
        saved = await pageApiRequest<Station>(`/api/stations/${draft.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setStations((prev) => prev.map((station) => (station.id === saved.id ? saved : station)));
      } else {
        saved = await pageApiRequest<Station>('/api/stations', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setStations((prev) => [...prev, saved]);
      }
      void loadAdvanceCoverage();
      setSelectedStationId(saved.id);
      setDraft(buildDraftFromStation(saved));
      setStatusMessage('Estacion guardada.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar la estacion.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft?.id) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      const impact = await fetchChangeImpact(draft.id, { delete: 'true' });
      if (impact.blocking_message) {
        setStatusMessage(impact.blocking_message);
        return;
      }
      const warningText = impact.warnings.length ? `${impact.warnings.join('\n\n')}\n\n` : '';
      if (
        !window.confirm(
          `${warningText}¿Eliminar la estacion ${draft.name}? Esta accion no se puede deshacer.`
        )
      ) {
        return;
      }
      await pageApiRequest<void>(`/api/stations/${draft.id}`, { method: 'DELETE' });
      void loadAdvanceCoverage();
      setStations((prev) => prev.filter((station) => station.id !== draft.id));
      const next = stations.find((station) => station.id !== draft.id) ?? null;
      if (next) {
        selectStation(next);
      } else {
        setSelectedStationId(null);
        setDraft(emptyDraft());
      }
      setStatusMessage('Estacion eliminada.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar la estacion.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const openCameraModal = (station: Station) => {
    if (!station.camera_feed_ip) {
      return;
    }
    setCameraModalStation(station);
  };

  const closeCameraModal = () => {
    setCameraModalStation(null);
  };

  const handleStationChangeProtectionToggle = () => {
    setStationChangeProtectionEnabled((prev) => {
      const next = !prev;
      writeStationChangeProtectionEnabled(next);
      return next;
    });
  };

  const cameraStreamUrl = useMemo(
    () =>
      cameraModalStation?.id
        ? `${API_BASE_URL}/api/camera-feed/live.mjpeg?station_id=${encodeURIComponent(String(cameraModalStation.id))}`
        : null,
    [cameraModalStation]
  );

  const renderStationRow = (station: Station) => {
    const isSelected = selectedStationId === station.id;
    const sequenceLabel = station.sequence_order !== null ? `Sec ${station.sequence_order}` : 'Sec n/a';
    const hasCameraFeed = Boolean(station.camera_feed_ip?.trim());
    
    return (
      <div
        key={station.id}
        role="button"
        tabIndex={0}
        onClick={() => selectStation(station)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectStation(station);
          }
        }}
        className={`group flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors ${
          isSelected
            ? 'bg-blue-50/50'
            : 'bg-white hover:bg-gray-50'
        }`}
      >
        <div className="flex items-center gap-3">
          <p className={`text-sm font-medium ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>{station.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openCameraModal(station);
            }}
            disabled={!hasCameraFeed}
            className={`rounded-md p-1.5 transition-colors ${
              hasCameraFeed
                ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                : 'cursor-not-allowed text-gray-300'
            }`}
            title={
              hasCameraFeed
                ? `Ver camara de ${station.name}`
                : `${station.name} no tiene feed de camara asignado`
            }
            aria-label={
              hasCameraFeed
                ? `Ver camara de ${station.name}`
                : `${station.name} no tiene feed de camara asignado`
            }
          >
            <Camera className="h-4 w-4" />
          </button>
           {station.role !== 'AUX' && (
            <span className="text-xs text-gray-500 font-mono">
              {sequenceLabel}
            </span>
           )}
           {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2 rounded-full border border-black/10 bg-white/80 p-1">
          {[
            { id: 'builder', label: 'Constructor' },
            { id: 'shift-estimation', label: 'Turnos estimados' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as 'builder' | 'shift-estimation')}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                activeTab === tab.id
                  ? 'bg-[var(--ink)] text-white'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {activeTab === 'builder' && (
          <button
            onClick={handleAddStation}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[var(--accent)]/90"
          >
            <Plus className="h-4 w-4" /> Agregar estacion
          </button>
        )}
      </div>

      {activeTab === 'builder' ? (
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] items-start">
          <section className="order-last rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden xl:order-none">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 px-4 py-3 bg-gray-50/50">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Estaciones activas</h2>
                <p className="text-xs text-gray-500">{summaryLabel}</p>
              </div>
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="search"
                  placeholder="Buscar..."
                  className="h-8 rounded-md border border-gray-200 bg-white pl-9 pr-3 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            </div>

            {advanceCoverageSummary.length > 0 && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                <span className="font-semibold">Modulos pueden quedar detenidos:</span> ninguna
                tarea que gatille avance aplica para algunos tipos de casa en{' '}
                {advanceCoverageSummary.join('; ')}. Revise Definiciones de tareas.
              </div>
            )}

            {loading && (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                Cargando estaciones...
              </div>
            )}
            {!loading && filteredStations.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                No hay estaciones que coincidan con esa busqueda.
              </div>
            )}

            {!loading && (
              <div className="divide-y divide-gray-100">
                {(groupedStations.panels.length > 0 || !search.trim()) && (
                  <div>
                    <div className="bg-gray-50 px-4 py-2 border-y border-gray-100 first:border-t-0">
                      <h3 className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Paneles</h3>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {groupedStations.panels.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-gray-400 italic">
                          Aun no hay estaciones de paneles.
                        </div>
                      ) : (
                        groupedStations.panels.map(renderStationRow)
                      )}
                    </div>
                  </div>
                )}

                {(groupedStations.magazine.length > 0 || !search.trim()) && (
                  <div>
                    <div className="bg-gray-50 px-4 py-2 border-y border-gray-100">
                      <h3 className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                        Magazine
                      </h3>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {groupedStations.magazine.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-gray-400 italic">
                          Aun no hay estaciones de magazine.
                        </div>
                      ) : (
                        groupedStations.magazine.map(renderStationRow)
                      )}
                    </div>
                  </div>
                )}

                {(groupedStations.assemblyLines['1'].length > 0 ||
                  groupedStations.assemblyLines['2'].length > 0 ||
                  groupedStations.assemblyLines['3'].length > 0 ||
                  groupedStations.assemblyOther.length > 0 ||
                  !search.trim()) && (
                  <div>
                    <div className="bg-gray-50 px-4 py-2 border-y border-gray-100">
                      <h3 className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                        Ensamblaje
                      </h3>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {(['1', '2', '3'] as StationLineType[]).map((line) => (
                        <div key={line} className="divide-y divide-gray-100">
                          {groupedStations.assemblyLines[line].length > 0 && (
                            <div className="bg-gray-50/50 px-4 py-1.5 border-y border-gray-50">
                              <span className="text-[10px] font-medium text-gray-400">
                                Linea {line}
                              </span>
                            </div>
                          )}
                          {groupedStations.assemblyLines[line].map(renderStationRow)}
                        </div>
                      ))}
                      {groupedStations.assemblyOther.length > 0 && (
                        <div className="divide-y divide-gray-100">
                          <div className="bg-gray-50/50 px-4 py-1.5 border-y border-gray-50">
                            <span className="text-[10px] font-medium text-gray-400">
                              Linea sin asignar
                            </span>
                          </div>
                          {groupedStations.assemblyOther.map(renderStationRow)}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {(groupedStations.aux.length > 0 || !search.trim()) && (
                  <div>
                    <div className="bg-gray-50 px-4 py-2 border-y border-gray-100">
                      <h3 className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">AUX</h3>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {groupedStations.aux.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-gray-400 italic">No AUX stations yet.</div>
                      ) : (
                        groupedStations.aux.map(renderStationRow)
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="order-first space-y-6 xl:order-none">
            <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Detalle</p>
                  <h2 className="text-lg font-display text-[var(--ink)]">
                    {draft?.id ? `Estacion #${draft.id}` : 'Nueva estacion'}
                  </h2>
                </div>
                <Settings2 className="h-5 w-5 text-[var(--ink-muted)]" />
              </div>

              {statusMessage && (
                <div className="mt-4 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--ink)]">
                  {statusMessage}
                </div>
              )}

              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-black/10 bg-black/5 px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                        Dispositivo
                      </p>
                      <h3 className="mt-1 text-sm font-semibold text-[var(--ink)]">
                        Proteger cambio de estacion
                      </h3>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        Cuando esta activo, cambiar la estacion desde login requiere validacion de
                        admin. Solo afecta ese dispositivo.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={stationChangeProtectionEnabled}
                      onClick={handleStationChangeProtectionToggle}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition ${
                        stationChangeProtectionEnabled
                          ? 'border-[var(--ink)] bg-[var(--ink)]'
                          : 'border-black/10 bg-black/10'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                          stationChangeProtectionEnabled ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        stationChangeProtectionEnabled ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                    />
                    {stationChangeProtectionEnabled
                      ? 'Activo por defecto en este dispositivo'
                      : 'Desactivado para desarrollo en este dispositivo'}
                  </div>
                </div>

                <label className="text-sm text-[var(--ink-muted)]">
                  Nombre visible
                  <input
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    value={draft?.name ?? ''}
                    onChange={(event) => handleDraftChange({ name: event.target.value })}
                  />
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-[var(--ink-muted)]">
                    Rol
                    <select
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={draft?.role ?? 'Panels'}
                      onChange={(event) => handleRoleChange(event.target.value as StationRole)}
                    >
                      {(['Panels', 'Magazine', 'Assembly', 'AUX'] as StationRole[]).map((role) => {
                        const label =
                          role === 'Panels'
                            ? 'Paneles'
                            : role === 'Magazine'
                              ? 'Magazine'
                              : role === 'Assembly'
                                ? 'Ensamblaje'
                                : 'AUX';
                        return (
                          <option key={role} value={role}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label className="text-sm text-[var(--ink-muted)]">
                    Tipo de linea
                    <select
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={draft?.line_type ?? ''}
                      onChange={(event) => handleDraftChange({ line_type: event.target.value as StationLineType })}
                      disabled={draft?.role !== 'Assembly'}
                    >
                      <option value="">Ninguno</option>
                      {['1', '2', '3'].map((line) => (
                        <option key={line} value={line}>
                          Linea {line}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="text-sm text-[var(--ink-muted)]">
                  Orden de secuencia
                  <input
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    placeholder={
                      draft?.role === 'AUX' ? 'No se usa para estaciones AUX' : 'ej. 11'
                    }
                    value={draft?.sequence_order ?? ''}
                    onChange={(event) => handleDraftChange({ sequence_order: event.target.value })}
                    disabled={draft?.role === 'AUX'}
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleSave}
                    disabled={saving || !draft}
                    className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {saving ? 'Guardando...' : 'Guardar estacion'}
                  </button>
                  {draft?.id && (
                    <button
                      onClick={handleDelete}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-60"
                    >
                      <Trash2 className="h-4 w-4" /> Eliminar
                    </button>
                  )}
                </div>
              </div>
            </section>
          </aside>
        </div>
      ) : (
        <DashboardShiftEstimation />
      )}

      {cameraModalStation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Camara en vivo de ${cameraModalStation.name}`}
          onClick={closeCameraModal}
        >
          <div
            className="w-full max-w-4xl rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Vista en vivo</p>
                <h3 className="text-lg font-semibold text-[var(--ink)]">{cameraModalStation.name}</h3>
                <p className="text-xs text-[var(--ink-muted)]">
                  Stream IP: {cameraModalStation.camera_feed_ip}
                </p>
              </div>
              <button
                type="button"
                onClick={closeCameraModal}
                className="rounded-md p-2 text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)]"
                aria-label="Cerrar modal de camara"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {cameraStreamUrl ? (
              <div className="overflow-hidden rounded-xl bg-black">
                <img
                  src={cameraStreamUrl}
                  alt={`Stream en vivo de ${cameraModalStation.name}`}
                  className="max-h-[72vh] w-full object-contain"
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-black/10 bg-black/5 px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                Esta estacion no tiene feed de camara asignado.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Stations;
