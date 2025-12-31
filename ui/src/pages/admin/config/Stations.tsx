import React, { useEffect, useMemo, useState } from 'react';
import { MapPin, Plus, Search, Settings2, Trash2 } from 'lucide-react';

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
    throw new Error(text || `Request failed (${response.status})`);
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
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [draft, setDraft] = useState<StationDraft | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
          const message = error instanceof Error ? error.message : 'Failed to load stations.';
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
    return `${stations.length} stations • ${assemblyLines.size} assembly lines`;
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
      throw new Error('Sequence order is required for non-aux stations.');
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error('Sequence order must be a positive whole number.');
    }
    return parsed;
  };

  const buildPayload = (current: StationDraft) => {
    const name = current.name.trim();
    if (!name) {
      throw new Error('Station name is required.');
    }
    const role = current.role;
    const isAssembly = role === 'Assembly';
    const isAux = role === 'AUX';
    const lineType = isAssembly ? current.line_type : '';
    if (isAssembly && !lineType) {
      throw new Error('Assembly stations require a line type.');
    }
    if (!isAssembly && lineType) {
      throw new Error('Line type is only allowed for assembly stations.');
    }
    const sequenceOrder = isAux ? null : parseSequenceOrder(current.sequence_order, role);
    if (isAux && current.sequence_order.trim()) {
      throw new Error('Aux stations should not have a sequence order.');
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
      setStatusMessage('Station saved.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save station.';
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
      setStatusMessage('Station removed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove station.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const renderStationCard = (station: Station, index: number) => {
    const isSelected = selectedStationId === station.id;
    const sequenceLabel = station.sequence_order !== null ? `Seq ${station.sequence_order}` : 'Seq n/a';
    return (
      <button
        key={station.id}
        onClick={() => selectStation(station)}
        className={`flex flex-col gap-3 rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
          isSelected
            ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
            : 'border-black/5 bg-white'
        }`}
        style={{ animationDelay: `${index * 60}ms` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(201,215,245,0.6)] text-[var(--ink)]">
              <MapPin className="h-4 w-4" />
            </div>
            <div>
              <p className="text-lg font-semibold text-[var(--ink)]">{station.name}</p>
              <p className="text-xs text-[var(--ink-muted)]">#{station.id}</p>
            </div>
          </div>
          <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-[var(--ink-muted)]">
            {sequenceLabel}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Configuration / Stations
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">Station Builder</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Define the production flow and assembly lines that power task scheduling.
          </p>
        </div>
        <button
          onClick={handleAddStation}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add station
        </button>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="order-last rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm xl:order-none">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">Active stations</h2>
              <p className="text-sm text-[var(--ink-muted)]">{summaryLabel}</p>
            </div>
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
              <input
                type="search"
                placeholder="Search stations"
                className="h-9 rounded-full border border-black/10 bg-white pl-9 pr-4 text-sm"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          {loading && (
            <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              Loading stations…
            </div>
          )}
          {!loading && filteredStations.length === 0 && (
            <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              No stations match that search.
            </div>
          )}

          <div className="mt-6 space-y-8">
            {(groupedStations.panels.length > 0 || !search.trim()) && (
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Panels</h3>
                  <span className="text-xs text-[var(--ink-muted)]">{groupedStations.panels.length} stations</span>
                </div>
                {groupedStations.panels.length === 0 ? (
                  <div className="mt-3 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-4 text-sm text-[var(--ink-muted)]">
                    No panel stations yet.
                  </div>
                ) : (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {groupedStations.panels.map((station, index) => renderStationCard(station, index))}
                  </div>
                )}
              </div>
            )}

            {(groupedStations.magazine.length > 0 || !search.trim()) && (
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Magazine</h3>
                  <span className="text-xs text-[var(--ink-muted)]">{groupedStations.magazine.length} stations</span>
                </div>
                {groupedStations.magazine.length === 0 ? (
                  <div className="mt-3 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-4 text-sm text-[var(--ink-muted)]">
                    No magazine stations yet.
                  </div>
                ) : (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {groupedStations.magazine.map((station, index) => renderStationCard(station, index))}
                  </div>
                )}
              </div>
            )}

            {(groupedStations.assemblyLines['1'].length > 0 ||
              groupedStations.assemblyLines['2'].length > 0 ||
              groupedStations.assemblyLines['3'].length > 0 ||
              groupedStations.assemblyOther.length > 0 ||
              !search.trim()) && (
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Assembly</h3>
                  <span className="text-xs text-[var(--ink-muted)]">
                    {groupedStations.assemblyLines['1'].length +
                      groupedStations.assemblyLines['2'].length +
                      groupedStations.assemblyLines['3'].length +
                      groupedStations.assemblyOther.length}{' '}
                    stations
                  </span>
                </div>
                <div className="mt-3 grid gap-4 lg:grid-cols-3">
                  {(['1', '2', '3'] as StationLineType[]).map((line) => (
                    <div key={line} className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                        Line {line}
                      </p>
                      {groupedStations.assemblyLines[line].length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-4 text-sm text-[var(--ink-muted)]">
                          No stations on this line.
                        </div>
                      ) : (
                        <div className="grid gap-3">
                          {groupedStations.assemblyLines[line].map((station, index) =>
                            renderStationCard(station, index)
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {groupedStations.assemblyOther.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                      Assembly (Unassigned line)
                    </p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {groupedStations.assemblyOther.map((station, index) => renderStationCard(station, index))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {(groupedStations.aux.length > 0 || !search.trim()) && (
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">AUX</h3>
                  <span className="text-xs text-[var(--ink-muted)]">{groupedStations.aux.length} stations</span>
                </div>
                {groupedStations.aux.length === 0 ? (
                  <div className="mt-3 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-4 text-sm text-[var(--ink-muted)]">
                    No AUX stations yet.
                  </div>
                ) : (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {groupedStations.aux.map((station, index) => renderStationCard(station, index))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="order-first space-y-6 xl:order-none">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Detail</p>
                <h2 className="text-lg font-display text-[var(--ink)]">
                  {draft?.id ? `Station #${draft.id}` : 'New station'}
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
                Display name
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  value={draft?.name ?? ''}
                  onChange={(event) => handleDraftChange({ name: event.target.value })}
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-[var(--ink-muted)]">
                  Role
                  <select
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    value={draft?.role ?? 'Panels'}
                    onChange={(event) => handleRoleChange(event.target.value as StationRole)}
                  >
                    {['Panels', 'Magazine', 'Assembly', 'AUX'].map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-[var(--ink-muted)]">
                  Line type
                  <select
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    value={draft?.line_type ?? ''}
                    onChange={(event) => handleDraftChange({ line_type: event.target.value as StationLineType })}
                    disabled={draft?.role !== 'Assembly'}
                  >
                    <option value="">None</option>
                    {['1', '2', '3'].map((line) => (
                      <option key={line} value={line}>
                        Line {line}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="text-sm text-[var(--ink-muted)]">
                Sequence order
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder={draft?.role === 'AUX' ? 'Not used for AUX stations' : 'e.g. 11'}
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
                  {saving ? 'Saving…' : 'Save station'}
                </button>
                {draft?.id && (
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" /> Remove
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

export default Stations;
