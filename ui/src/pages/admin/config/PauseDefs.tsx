import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, PauseCircle, Plus, Search, Settings2, Trash2 } from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayout';

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

type PauseReason = {
  id: number;
  name: string;
  applicable_station_ids: number[] | null;
  active: boolean;
};

type PauseDraft = {
  id?: number;
  name: string;
  active: boolean;
  all_stations: boolean;
  applicable_station_ids: number[];
};

const emptyDraft = (): PauseDraft => ({
  name: '',
  active: true,
  all_stations: true,
  applicable_station_ids: [],
});

const buildDraftFromReason = (reason: PauseReason): PauseDraft => ({
  id: reason.id,
  name: reason.name,
  active: reason.active,
  all_stations: reason.applicable_station_ids === null,
  applicable_station_ids: reason.applicable_station_ids ?? [],
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

const sortReasons = (list: PauseReason[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

const sortStations = (list: Station[]) =>
  [...list].sort((a, b) => {
    const sequenceCompare =
      (a.sequence_order ?? Number.POSITIVE_INFINITY) -
      (b.sequence_order ?? Number.POSITIVE_INFINITY);
    if (sequenceCompare !== 0) {
      return sequenceCompare;
    }
    return a.name.localeCompare(b.name);
  });

const PauseDefs: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [reasons, setReasons] = useState<PauseReason[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedReasonId, setSelectedReasonId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PauseDraft | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [stationDropdownOpen, setStationDropdownOpen] = useState(false);
  const stationDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHeader({
      title: 'Motivos de pausa',
      kicker: 'Configuracion / Pausas',
    });
  }, [setHeader]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setStatusMessage(null);
      try {
        const [reasonData, stationData] = await Promise.all([
          apiRequest<PauseReason[]>('/api/pause-reasons'),
          apiRequest<Station[]>('/api/stations'),
        ]);
        if (!active) {
          return;
        }
        const sortedReasons = sortReasons(reasonData);
        setReasons(sortedReasons);
        setStations(sortStations(stationData));
        if (sortedReasons.length > 0) {
          setSelectedReasonId(sortedReasons[0].id);
          setDraft(buildDraftFromReason(sortedReasons[0]));
        } else {
          setSelectedReasonId(null);
          setDraft(emptyDraft());
        }
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error ? error.message : 'No se pudieron cargar los motivos de pausa.';
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

  const stationNameById = useMemo(
    () => new Map(stations.map((station) => [station.id, station.name])),
    [stations]
  );

  const filteredReasons = useMemo(() => {
    const query = normalizeSearch(search.trim());
    if (!query) {
      return reasons;
    }
    return reasons.filter((reason) => {
      const stationsLabel =
        reason.applicable_station_ids
          ?.map((id) => stationNameById.get(id) ?? '')
          .join(' ') ?? 'all';
      const haystack = normalizeSearch(`${reason.name} ${stationsLabel} ${reason.active}`);
      return haystack.includes(query);
    });
  }, [reasons, search, stationNameById]);

  const summaryLabel = useMemo(() => {
    const activeCount = reasons.filter((reason) => reason.active).length;
    return `${reasons.length} motivos / ${activeCount} activos`;
  }, [reasons]);

  useEffect(() => {
    if (!stationDropdownOpen) {
      return undefined;
    }
    const handleClick = (event: MouseEvent) => {
      if (!stationDropdownRef.current) {
        return;
      }
      if (!stationDropdownRef.current.contains(event.target as Node)) {
        setStationDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setStationDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [stationDropdownOpen]);

  const selectReason = (reason: PauseReason) => {
    setSelectedReasonId(reason.id);
    setDraft(buildDraftFromReason(reason));
    setStatusMessage(null);
  };

  const handleAddReason = () => {
    setSelectedReasonId(null);
    setDraft(emptyDraft());
    setStatusMessage(null);
  };

  const updateDraft = (patch: Partial<PauseDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const toggleAllStations = () => {
    setDraft((prev) => (prev ? { ...prev, all_stations: !prev.all_stations } : prev));
  };

  const toggleStation = (stationId: number) => {
    setDraft((prev) => {
      if (!prev) {
        return prev;
      }
      const selected = new Set(prev.applicable_station_ids);
      if (selected.has(stationId)) {
        selected.delete(stationId);
      } else {
        selected.add(stationId);
      }
      return { ...prev, applicable_station_ids: Array.from(selected) };
    });
  };

  const buildScopeLabel = (stationIds: number[] | null): string => {
    if (stationIds === null) {
      return 'Todas las estaciones';
    }
    if (stationIds.length === 0) {
      return 'No hay estaciones seleccionadas';
    }
    const names = stationIds.map((id) => stationNameById.get(id) ?? `Estacion ${id}`);
    if (names.length <= 2) {
      return names.join(', ');
    }
    return `${names[0]}, ${names[1]} +${names.length - 2}`;
  };

  const draftStationLabel = useMemo(() => {
    if (!draft) {
      return 'Todas las estaciones';
    }
    return draft.all_stations
      ? 'Todas las estaciones'
      : buildScopeLabel(draft.applicable_station_ids);
  }, [draft, stationNameById]);

  const buildPayload = (current: PauseDraft) => {
    const name = current.name.trim();
    if (!name) {
      throw new Error('Se requiere el nombre del motivo de pausa.');
    }
    const stationIds = current.all_stations ? null : current.applicable_station_ids;
    return {
      name,
      active: current.active,
      applicable_station_ids: stationIds,
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
      let saved: PauseReason;
      if (draft.id) {
        saved = await apiRequest<PauseReason>(`/api/pause-reasons/${draft.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setReasons((prev) =>
          sortReasons(prev.map((reason) => (reason.id === saved.id ? saved : reason)))
        );
      } else {
        saved = await apiRequest<PauseReason>('/api/pause-reasons', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setReasons((prev) => sortReasons([...prev, saved]));
      }
      setSelectedReasonId(saved.id);
      setDraft(buildDraftFromReason(saved));
      setStatusMessage('Motivo de pausa guardado.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar el motivo de pausa.';
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
      await apiRequest<void>(`/api/pause-reasons/${draft.id}`, { method: 'DELETE' });
      const updated = reasons.filter((reason) => reason.id !== draft.id);
      setReasons(updated);
      if (updated.length > 0) {
        selectReason(updated[0]);
      } else {
        setSelectedReasonId(null);
        setDraft(emptyDraft());
      }
      setStatusMessage('Motivo de pausa eliminado.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo eliminar el motivo de pausa.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const renderReasonRow = (reason: PauseReason) => {
    const isSelected = selectedReasonId === reason.id;
    return (
      <button
        key={reason.id}
        onClick={() => selectReason(reason)}
        className={`group flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${
          isSelected
            ? 'bg-blue-50/50'
            : 'bg-white hover:bg-gray-50'
        }`}
      >
        <div className="min-w-0 flex-1 pr-3">
          <div className="flex items-center gap-2">
            <p className={`truncate text-sm font-medium ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>{reason.name}</p>
            {!reason.active && (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                Inactivo
              </span>
            )}
          </div>
          <p className="truncate text-xs text-gray-500">
            {buildScopeLabel(reason.applicable_station_ids)}
          </p>
        </div>
        <div className="shrink-0">
          <span
             className={`inline-block h-2 w-2 rounded-full ${
               reason.active ? 'bg-emerald-500' : 'bg-gray-300'
             }`}
           />
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={handleAddReason}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[var(--accent)]/90"
        >
          <Plus className="h-4 w-4" /> Agregar motivo
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] items-start">
        <section className="order-last rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden xl:order-none">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 px-4 py-3 bg-gray-50/50">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Motivos actuales</h2>
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
              Cargando motivos de pausa...
            </div>
          )}
          {!loading && filteredReasons.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              No hay motivos de pausa que coincidan con esa busqueda.
            </div>
          )}

          <div className="divide-y divide-gray-100">
            {filteredReasons.map((reason) => renderReasonRow(reason))}
          </div>
        </section>

        <aside className="order-first space-y-6 xl:order-none">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Detalle
                </p>
                <h2 className="text-lg font-display text-[var(--ink)]">
                  {draft?.id ? `Motivo #${draft.id}` : 'Nuevo motivo de pausa'}
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
                Nombre del motivo
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  value={draft?.name ?? ''}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                Estado
                <select
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  value={draft?.active ? 'Activo' : 'Inactivo'}
                  onChange={(event) => updateDraft({ active: event.target.value === 'Activo' })}
                >
                  <option>Activo</option>
                  <option>Inactivo</option>
                </select>
              </label>

              <div>
                <p className="text-sm text-[var(--ink-muted)]">Alcance de estaciones</p>
                <div className="relative mt-2" ref={stationDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setStationDropdownOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-2 rounded-2xl border border-black/10 bg-white px-3 py-2 text-left text-sm text-[var(--ink)]"
                  >
                    <span className="truncate">{draftStationLabel}</span>
                    <ChevronDown
                      className={`h-4 w-4 text-[var(--ink-muted)] transition ${
                        stationDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {stationDropdownOpen && (
                    <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-lg">
                      <div className="border-b border-black/5 px-4 py-2 text-sm">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={draft?.all_stations ?? true}
                            onChange={toggleAllStations}
                          />
                          <span className="text-[var(--ink)]">Todas las estaciones</span>
                        </label>
                      </div>
                      {stations.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-[var(--ink-muted)]">
                          No hay estaciones disponibles.
                        </div>
                      ) : (
                        <div className="max-h-56 overflow-auto p-3 text-sm">
                          <div className="flex flex-col gap-2">
                            {stations.map((station) => (
                              <label
                                key={station.id}
                                className={`flex items-center gap-2 ${
                                  draft?.all_stations ? 'opacity-60' : ''
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={draft?.all_stations}
                                  checked={(draft?.applicable_station_ids ?? []).includes(
                                    station.id
                                  )}
                                  onChange={() => toggleStation(station.id)}
                                />
                                <span className="text-[var(--ink)]">{station.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !draft}
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saving ? 'Guardando...' : 'Guardar motivo'}
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
    </div>
  );
};

export default PauseDefs;
