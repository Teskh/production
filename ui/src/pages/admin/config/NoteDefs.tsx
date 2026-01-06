import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, Search, Settings2, Trash2 } from 'lucide-react';
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

type CommentTemplate = {
  id: number;
  text: string;
  applicable_station_ids: number[] | null;
  active: boolean;
};

type TemplateDraft = {
  id?: number;
  text: string;
  active: boolean;
  all_stations: boolean;
  applicable_station_ids: number[];
};

const emptyDraft = (): TemplateDraft => ({
  text: '',
  active: true,
  all_stations: true,
  applicable_station_ids: [],
});

const buildDraftFromTemplate = (template: CommentTemplate): TemplateDraft => ({
  id: template.id,
  text: template.text,
  active: template.active,
  all_stations: template.applicable_station_ids === null,
  applicable_station_ids: template.applicable_station_ids ?? [],
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

const sortTemplates = (list: CommentTemplate[]) =>
  [...list].sort((a, b) => a.text.localeCompare(b.text));

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

type StationGroup = {
  sequence: number | null;
  label: string;
  subtitle: string | null;
  stations: Station[];
};

const NoteDefs: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [templates, setTemplates] = useState<CommentTemplate[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [search, setSearch] = useState('');
  const [stationFilterId, setStationFilterId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [stationDropdownOpen, setStationDropdownOpen] = useState(false);
  const [stationFilterOpen, setStationFilterOpen] = useState(false);
  const stationDropdownRef = useRef<HTMLDivElement | null>(null);
  const stationFilterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHeader({
      title: 'Plantillas de comentarios',
      kicker: 'Configuracion / Comentarios',
    });
  }, [setHeader]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setStatusMessage(null);
      try {
        const [templateData, stationData] = await Promise.all([
          apiRequest<CommentTemplate[]>('/api/comment-templates'),
          apiRequest<Station[]>('/api/stations'),
        ]);
        if (!active) {
          return;
        }
        const sortedTemplates = sortTemplates(templateData);
        setTemplates(sortedTemplates);
        setStations(sortStations(stationData));
        if (sortedTemplates.length > 0) {
          setSelectedTemplateId(sortedTemplates[0].id);
          setDraft(buildDraftFromTemplate(sortedTemplates[0]));
        } else {
          setSelectedTemplateId(null);
          setDraft(emptyDraft());
        }
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error
              ? error.message
              : 'No se pudieron cargar las plantillas de comentarios.';
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

  const stationGroups = useMemo<StationGroup[]>(() => {
    const entries = new Map<number | null, Station[]>();
    stations.forEach((station) => {
      const key = station.sequence_order ?? null;
      const existing = entries.get(key) ?? [];
      existing.push(station);
      entries.set(key, existing);
    });
    const sortKey = (sequence: number | null) => sequence ?? Number.POSITIVE_INFINITY;
    return Array.from(entries.entries())
      .sort(([a], [b]) => sortKey(a) - sortKey(b))
      .map(([sequence, groupStations]) => ({
        sequence,
        label: sequence === null ? 'Sin secuencia' : `Secuencia ${sequence}`,
        subtitle: groupStations.length ? groupStations[0].name : null,
        stations: [...groupStations].sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [stations]);

  const filteredTemplates = useMemo(() => {
    const query = normalizeSearch(search.trim());
    return templates.filter((template) => {
      if (stationFilterId !== null) {
        const scopedStationIds = template.applicable_station_ids;
        const matchesStation =
          scopedStationIds === null || scopedStationIds.includes(stationFilterId);
        if (!matchesStation) {
          return false;
        }
      }
      if (!query) {
        return true;
      }
      const stationsLabel =
        template.applicable_station_ids
          ?.map((id) => stationNameById.get(id) ?? '')
          .join(' ') ?? 'all';
      const haystack = normalizeSearch(`${template.text} ${stationsLabel} ${template.active}`);
      return haystack.includes(query);
    });
  }, [templates, search, stationFilterId, stationNameById]);

  const summaryLabel = useMemo(() => {
    const activeCount = templates.filter((template) => template.active).length;
    return `${templates.length} plantillas / ${activeCount} activas`;
  }, [templates]);

  const stationFilterLabel = useMemo(() => {
    if (stationFilterId === null) {
      return 'Todas las estaciones';
    }
    return stationNameById.get(stationFilterId) ?? `Estacion ${stationFilterId}`;
  }, [stationFilterId, stationNameById]);

  const handleStationFilterSelect = (stationId: number | null) => {
    setStationFilterId(stationId);
    setStationFilterOpen(false);
  };

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

  useEffect(() => {
    if (!stationFilterOpen) {
      return undefined;
    }
    const handleClick = (event: MouseEvent) => {
      if (!stationFilterRef.current) {
        return;
      }
      if (!stationFilterRef.current.contains(event.target as Node)) {
        setStationFilterOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setStationFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [stationFilterOpen]);

  const selectTemplate = (template: CommentTemplate) => {
    setSelectedTemplateId(template.id);
    setDraft(buildDraftFromTemplate(template));
    setStatusMessage(null);
  };

  const handleAddTemplate = () => {
    setSelectedTemplateId(null);
    setDraft(emptyDraft());
    setStatusMessage(null);
  };

  const updateDraft = (patch: Partial<TemplateDraft>) => {
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

  const buildPayload = (current: TemplateDraft) => {
    const text = current.text.trim();
    if (!text) {
      throw new Error('Se requiere el texto de la plantilla de comentario.');
    }
    const stationIds = current.all_stations ? null : current.applicable_station_ids;
    return {
      text,
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
      let saved: CommentTemplate;
      if (draft.id) {
        saved = await apiRequest<CommentTemplate>(`/api/comment-templates/${draft.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setTemplates((prev) =>
          sortTemplates(prev.map((template) => (template.id === saved.id ? saved : template)))
        );
      } else {
        saved = await apiRequest<CommentTemplate>('/api/comment-templates', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setTemplates((prev) => sortTemplates([...prev, saved]));
      }
      setSelectedTemplateId(saved.id);
      setDraft(buildDraftFromTemplate(saved));
      setStatusMessage('Plantilla de comentario guardada.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar la plantilla de comentario.';
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
      await apiRequest<void>(`/api/comment-templates/${draft.id}`, { method: 'DELETE' });
      const updated = templates.filter((template) => template.id !== draft.id);
      setTemplates(updated);
      if (updated.length > 0) {
        selectTemplate(updated[0]);
      } else {
        setSelectedTemplateId(null);
        setDraft(emptyDraft());
      }
      setStatusMessage('Plantilla de comentario eliminada.');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudo eliminar la plantilla de comentario.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const renderTemplateRow = (template: CommentTemplate) => {
    const isSelected = selectedTemplateId === template.id;
    return (
      <button
        key={template.id}
        onClick={() => selectTemplate(template)}
        className={`group flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${
          isSelected
            ? 'bg-blue-50/50'
            : 'bg-white hover:bg-gray-50'
        }`}
      >
        <div className="min-w-0 flex-1 pr-3">
          <p className={`truncate text-sm font-medium ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>{template.text}</p>
          <p className="truncate text-xs text-gray-500">
            {buildScopeLabel(template.applicable_station_ids)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              template.active ? 'bg-emerald-500' : 'bg-gray-300'
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
          onClick={handleAddTemplate}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[var(--accent)]/90"
        >
          <Plus className="h-4 w-4" /> Agregar plantilla
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] items-start">
        <section className="order-last rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden xl:order-none">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 px-4 py-3 bg-gray-50/50">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Plantillas actuales</h2>
              <p className="text-xs text-gray-500">{summaryLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 justify-end">
              <div className="relative" ref={stationFilterRef}>
                <button
                  type="button"
                  onClick={() => setStationFilterOpen((prev) => !prev)}
                  className="flex h-8 items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 text-left text-xs text-gray-700"
                >
                  <span className="max-w-[180px] truncate">{stationFilterLabel}</span>
                  <ChevronDown
                    className={`h-4 w-4 text-gray-400 transition ${
                      stationFilterOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {stationFilterOpen && (
                  <div className="absolute right-0 z-20 mt-2 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                    <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-700">
                      Filtrar por estacion
                    </div>
                    <div className="max-h-72 overflow-auto p-2 text-xs">
                      <button
                        type="button"
                        onClick={() => handleStationFilterSelect(null)}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-gray-50 ${
                          stationFilterId === null ? 'bg-blue-50/50 text-blue-900' : 'text-gray-700'
                        }`}
                      >
                        Todas las estaciones
                      </button>
                      {stationGroups.map((group) => (
                        <div key={String(group.sequence)} className="mt-2">
                          <div className="flex items-baseline gap-2 px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                            <span>{group.label}</span>
                            {group.subtitle && (
                              <span className="max-w-[160px] truncate font-normal normal-case text-gray-300">
                                {group.subtitle}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col">
                            {group.stations.map((station) => (
                              <button
                                key={station.id}
                                type="button"
                                onClick={() => handleStationFilterSelect(station.id)}
                                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-gray-50 ${
                                  stationFilterId === station.id
                                    ? 'bg-blue-50/50 text-blue-900'
                                    : 'text-gray-700'
                                }`}
                              >
                                <span className="truncate">{station.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
          </div>

          {loading && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              Cargando plantillas de comentarios...
            </div>
          )}
          {!loading && filteredTemplates.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              No hay plantillas que coincidan con esa busqueda.
            </div>
          )}

          <div className="divide-y divide-gray-100">
            {filteredTemplates.map((template) => renderTemplateRow(template))}
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
                  {draft?.id ? `Plantilla #${draft.id}` : 'Nueva plantilla de comentario'}
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
                Texto de plantilla
                <textarea
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  value={draft?.text ?? ''}
                  onChange={(event) => updateDraft({ text: event.target.value })}
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
                  {saving ? 'Guardando...' : 'Guardar plantilla'}
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

export default NoteDefs;
