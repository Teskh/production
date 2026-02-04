import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Settings2, Trash2 } from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';
import DashboardShiftEstimation from './dashboard_shift_estimation';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type StationRole = 'Panels' | 'Magazine' | 'Assembly' | 'AUX';
type StationLineType = '1' | '2' | '3';

type Station = {
  id: number;
  name: string;
  role: StationRole;
  line_type: StationLineType | null;
  sequence_order: number | null;
};

type StationDraft = {
  id?: number;
  name: string;
  role: StationRole;
  line_type: StationLineType | '';
  sequence_order: string;
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
    throw new Error(text || `Solicitud fallida (${response.status})`);
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
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [draft, setDraft] = useState<StationDraft | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'builder' | 'shift-estimation'>('builder');

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
        const data = await apiRequest<Station[]>('/api/stations');
        if (!active) {
          return;
        }
        setStations(data);
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
      let saved: Station;
      if (draft.id) {
        saved = await apiRequest<Station>(`/api/stations/${draft.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setStations((prev) => prev.map((station) => (station.id === saved.id ? saved : station)));
      } else {
        saved = await apiRequest<Station>('/api/stations', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setStations((prev) => [...prev, saved]);
      }
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
      await apiRequest<void>(`/api/stations/${draft.id}`, { method: 'DELETE' });
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

  const renderStationRow = (station: Station) => {
    const isSelected = selectedStationId === station.id;
    const sequenceLabel = station.sequence_order !== null ? `Sec ${station.sequence_order}` : 'Sec n/a';
    
    return (
      <button
        key={station.id}
        onClick={() => selectStation(station)}
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
           {station.role !== 'AUX' && (
            <span className="text-xs text-gray-500 font-mono">
              {sequenceLabel}
            </span>
           )}
           {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
        </div>
      </button>
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
    </div>
  );
};

export default Stations;
