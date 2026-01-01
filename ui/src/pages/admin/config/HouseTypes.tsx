import React, { useEffect, useMemo, useState } from 'react';
import { Home, Plus, Search, Sparkles, Trash2 } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type HouseType = {
  id: number;
  name: string;
  number_of_modules: number;
};

type HouseSubType = {
  id: number;
  house_type_id: number;
  name: string;
};

type HouseTypeDraft = {
  id?: number;
  name: string;
  number_of_modules: string;
};

const emptyDraft = (): HouseTypeDraft => ({
  name: '',
  number_of_modules: '',
});

const buildDraftFromHouseType = (houseType: HouseType): HouseTypeDraft => ({
  id: houseType.id,
  name: houseType.name,
  number_of_modules: String(houseType.number_of_modules),
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

const sortHouseTypes = (types: HouseType[]): HouseType[] =>
  [...types].sort((a, b) => a.name.localeCompare(b.name));

const sortSubtypes = (subtypes: HouseSubType[]): HouseSubType[] =>
  [...subtypes].sort((a, b) => a.name.localeCompare(b.name));

const HouseTypes: React.FC = () => {
  const [houseTypes, setHouseTypes] = useState<HouseType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [draft, setDraft] = useState<HouseTypeDraft>(emptyDraft());
  const [subtypesByType, setSubtypesByType] = useState<Record<number, HouseSubType[]>>({});
  const [subtypeDrafts, setSubtypeDrafts] = useState<Record<number, string>>({});
  const [newSubtypeName, setNewSubtypeName] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingSubtypes, setLoadingSubtypes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingSubtype, setSavingSubtype] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [subtypeMessage, setSubtypeMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setStatusMessage(null);
      try {
        const data = await apiRequest<HouseType[]>('/api/house-types');
        if (!active) {
          return;
        }
        const sorted = sortHouseTypes(data);
        setHouseTypes(sorted);
        if (sorted.length > 0) {
          setSelectedTypeId(sorted[0].id);
          setDraft(buildDraftFromHouseType(sorted[0]));
        } else {
          setSelectedTypeId(null);
          setDraft(emptyDraft());
        }
        if (sorted.length > 0) {
          setLoadingSubtypes(true);
          const results = await Promise.allSettled(
            sorted.map(async (houseType) => ({
              id: houseType.id,
              subtypes: await apiRequest<HouseSubType[]>(
                `/api/house-types/${houseType.id}/subtypes`
              ),
            }))
          );
          if (!active) {
            return;
          }
          const nextMap: Record<number, HouseSubType[]> = {};
          let failed = false;
          results.forEach((result) => {
            if (result.status === 'fulfilled') {
              nextMap[result.value.id] = sortSubtypes(result.value.subtypes);
            } else {
              failed = true;
            }
          });
          setSubtypesByType(nextMap);
          if (failed) {
            setSubtypeMessage('Some subtype lists failed to load.');
          }
        }
      } catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : 'Failed to load house types.';
          setStatusMessage(message);
        }
      } finally {
        if (active) {
          setLoading(false);
          setLoadingSubtypes(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const filteredHouseTypes = useMemo(() => {
    const query = normalizeSearch(search.trim());
    if (!query) {
      return houseTypes;
    }
    return houseTypes.filter((houseType) =>
      normalizeSearch(`${houseType.name} ${houseType.number_of_modules}`).includes(query)
    );
  }, [houseTypes, search]);

  const selectedType = useMemo(
    () => houseTypes.find((type) => type.id === selectedTypeId) ?? null,
    [selectedTypeId, houseTypes]
  );

  const selectedSubtypes = useMemo(() => {
    if (!selectedTypeId) {
      return [];
    }
    return subtypesByType[selectedTypeId] ?? [];
  }, [selectedTypeId, subtypesByType]);

  const loadSubtypesForType = async (houseTypeId: number) => {
    setLoadingSubtypes(true);
    setSubtypeMessage(null);
    try {
      const data = await apiRequest<HouseSubType[]>(`/api/house-types/${houseTypeId}/subtypes`);
      setSubtypesByType((prev) => ({ ...prev, [houseTypeId]: sortSubtypes(data) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load subtypes.';
      setSubtypeMessage(message);
    } finally {
      setLoadingSubtypes(false);
    }
  };

  const handleSelectType = (houseType: HouseType) => {
    setSelectedTypeId(houseType.id);
    setDraft(buildDraftFromHouseType(houseType));
    setStatusMessage(null);
    setSubtypeMessage(null);
    setSubtypeDrafts({});
    setNewSubtypeName('');
    if (!subtypesByType[houseType.id]) {
      void loadSubtypesForType(houseType.id);
    }
  };

  const handleAddHouseType = () => {
    setSelectedTypeId(null);
    setDraft(emptyDraft());
    setStatusMessage(null);
    setSubtypeMessage(null);
    setSubtypeDrafts({});
    setNewSubtypeName('');
  };

  const handleDraftChange = (patch: Partial<HouseTypeDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const buildPayload = (current: HouseTypeDraft) => {
    const name = current.name.trim();
    if (!name) {
      throw new Error('House type name is required.');
    }
    const modulesValue = current.number_of_modules.trim();
    const modules = Number(modulesValue);
    if (!modulesValue) {
      throw new Error('Number of modules is required.');
    }
    if (!Number.isInteger(modules) || modules <= 0) {
      throw new Error('Number of modules must be a positive whole number.');
    }
    return { name, number_of_modules: modules };
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMessage(null);
    try {
      const payload = buildPayload(draft);
      let saved: HouseType;
      if (draft.id) {
        saved = await apiRequest<HouseType>(`/api/house-types/${draft.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setHouseTypes((prev) => sortHouseTypes(prev.map((item) => (item.id === saved.id ? saved : item))));
      } else {
        saved = await apiRequest<HouseType>('/api/house-types', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setHouseTypes((prev) => sortHouseTypes([...prev, saved]));
        setSubtypesByType((prev) => ({ ...prev, [saved.id]: [] }));
      }
      setSelectedTypeId(saved.id);
      setDraft(buildDraftFromHouseType(saved));
      setStatusMessage('House type saved.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save house type.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft.id) {
      return;
    }
    if (!window.confirm('Delete this house type?')) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      await apiRequest<void>(`/api/house-types/${draft.id}`, { method: 'DELETE' });
      const remaining = sortHouseTypes(houseTypes.filter((item) => item.id !== draft.id));
      setHouseTypes(remaining);
      setSubtypesByType((prev) => {
        const next = { ...prev };
        delete next[draft.id as number];
        return next;
      });
      if (remaining.length > 0) {
        handleSelectType(remaining[0]);
      } else {
        setSelectedTypeId(null);
        setDraft(emptyDraft());
      }
      setStatusMessage('House type removed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove house type.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubtypeDraftChange = (id: number, value: string) => {
    setSubtypeDrafts((prev) => ({ ...prev, [id]: value }));
  };

  const handleAddSubtype = async () => {
    if (!selectedTypeId) {
      return;
    }
    const name = newSubtypeName.trim();
    if (!name) {
      setSubtypeMessage('Subtype name is required.');
      return;
    }
    setSavingSubtype(true);
    setSubtypeMessage(null);
    try {
      const created = await apiRequest<HouseSubType>(`/api/house-types/${selectedTypeId}/subtypes`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setSubtypesByType((prev) => ({
        ...prev,
        [selectedTypeId]: sortSubtypes([...(prev[selectedTypeId] ?? []), created]),
      }));
      setNewSubtypeName('');
      setSubtypeMessage('Subtype added.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add subtype.';
      setSubtypeMessage(message);
    } finally {
      setSavingSubtype(false);
    }
  };

  const handleSaveSubtype = async (subtype: HouseSubType) => {
    const draftName = (subtypeDrafts[subtype.id] ?? subtype.name).trim();
    if (!draftName) {
      setSubtypeMessage('Subtype name is required.');
      return;
    }
    if (draftName === subtype.name) {
      return;
    }
    setSavingSubtype(true);
    setSubtypeMessage(null);
    try {
      const updated = await apiRequest<HouseSubType>(`/api/house-types/subtypes/${subtype.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: draftName }),
      });
      setSubtypesByType((prev) => ({
        ...prev,
        [updated.house_type_id]: sortSubtypes(
          (prev[updated.house_type_id] ?? []).map((item) => (item.id === updated.id ? updated : item))
        ),
      }));
      setSubtypeDrafts((prev) => {
        const next = { ...prev };
        delete next[subtype.id];
        return next;
      });
      setSubtypeMessage('Subtype updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update subtype.';
      setSubtypeMessage(message);
    } finally {
      setSavingSubtype(false);
    }
  };

  const handleDeleteSubtype = async (subtype: HouseSubType) => {
    if (!window.confirm('Delete this subtype?')) {
      return;
    }
    setSavingSubtype(true);
    setSubtypeMessage(null);
    try {
      await apiRequest<void>(`/api/house-types/subtypes/${subtype.id}`, { method: 'DELETE' });
      setSubtypesByType((prev) => ({
        ...prev,
        [subtype.house_type_id]: (prev[subtype.house_type_id] ?? []).filter(
          (item) => item.id !== subtype.id
        ),
      }));
      setSubtypeDrafts((prev) => {
        const next = { ...prev };
        delete next[subtype.id];
        return next;
      });
      setSubtypeMessage('Subtype removed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove subtype.';
      setSubtypeMessage(message);
    } finally {
      setSavingSubtype(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Product Definition / House Types
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">House Type Library</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Define core product families and map module counts with subtype variations.
          </p>
        </div>
        <button
          onClick={handleAddHouseType}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> New house type
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">Active house types</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {houseTypes.length} house types in the library
              </p>
            </div>
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
              <input
                type="search"
                placeholder="Search house types"
                className="h-9 rounded-full border border-black/10 bg-white pl-9 pr-4 text-sm"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          {loading && (
            <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              Loading house types…
            </div>
          )}

          {!loading && filteredHouseTypes.length === 0 && (
            <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              No house types match this search.
            </div>
          )}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {filteredHouseTypes.map((type, index) => {
              const subtypes = subtypesByType[type.id];
              const preview = subtypes ? subtypes.slice(0, 3) : [];
              const remainingCount = subtypes ? subtypes.length - preview.length : 0;
              return (
                <button
                  key={type.id}
                  onClick={() => handleSelectType(type)}
                  className={`flex h-full flex-col justify-between rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
                    selectedTypeId === type.id
                      ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
                      : 'border-black/5 bg-white'
                  }`}
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(201,215,245,0.55)] text-[var(--ink)]">
                      <Home className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-[var(--ink)]">{type.name}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        {type.number_of_modules} modules
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {subtypes ? (
                      subtypes.length > 0 ? (
                        <>
                          {preview.map((subtype) => (
                            <span
                              key={subtype.id}
                              className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-[var(--ink-muted)]"
                            >
                              {subtype.name}
                            </span>
                          ))}
                          {remainingCount > 0 && (
                            <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-[var(--ink-muted)]">
                              +{remainingCount} more
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-[var(--ink-muted)]">No subtypes</span>
                      )
                    ) : (
                      <span className="text-xs text-[var(--ink-muted)]">
                        {loadingSubtypes ? 'Subtypes loading...' : 'Subtypes unavailable'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Detail</p>
                <h2 className="text-lg font-display text-[var(--ink)]">
                  {selectedType ? selectedType.name : 'New house type'}
                </h2>
              </div>
              <Sparkles className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>

            <div className="mt-4 space-y-4">
              <label className="text-sm text-[var(--ink-muted)]">
                House type name
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  value={draft.name}
                  onChange={(event) => handleDraftChange({ name: event.target.value })}
                />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                Number of modules
                <input
                  type="number"
                  min={1}
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  value={draft.number_of_modules}
                  onChange={(event) => handleDraftChange({ number_of_modules: event.target.value })}
                />
              </label>
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-[var(--ink-muted)]">Subtypes</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    className="min-w-[12rem] flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    placeholder="Subtype name"
                    value={newSubtypeName}
                    onChange={(event) => setNewSubtypeName(event.target.value)}
                    disabled={!selectedTypeId || savingSubtype}
                  />
                  <button
                    onClick={handleAddSubtype}
                    disabled={!selectedTypeId || savingSubtype}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-[var(--ink)] disabled:opacity-60"
                  >
                    <Plus className="h-3 w-3" /> Add subtype
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {!selectedTypeId && (
                    <div className="rounded-2xl border border-dashed border-black/10 px-3 py-2 text-xs text-[var(--ink-muted)]">
                      Save the house type to manage subtypes.
                    </div>
                  )}
                  {selectedTypeId && loadingSubtypes && selectedSubtypes.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-black/10 px-3 py-2 text-xs text-[var(--ink-muted)]">
                      Loading subtypes...
                    </div>
                  )}
                  {selectedTypeId && !loadingSubtypes && selectedSubtypes.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-black/10 px-3 py-2 text-xs text-[var(--ink-muted)]">
                      No subtypes configured.
                    </div>
                  )}
                  {selectedSubtypes.map((subtype) => {
                    const draftName = subtypeDrafts[subtype.id] ?? subtype.name;
                    const trimmed = draftName.trim();
                    const canSave = trimmed.length > 0 && trimmed !== subtype.name;
                    return (
                      <div
                        key={subtype.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-black/5 bg-white px-3 py-2"
                      >
                        <input
                          className="flex-1 rounded-lg border border-black/10 bg-white px-2 py-1 text-sm"
                          value={draftName}
                          onChange={(event) => handleSubtypeDraftChange(subtype.id, event.target.value)}
                          disabled={savingSubtype}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSaveSubtype(subtype)}
                            disabled={!canSave || savingSubtype}
                            className="text-xs font-semibold text-[var(--accent)] disabled:opacity-60"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => handleDeleteSubtype(subtype)}
                            disabled={savingSubtype}
                            className="text-xs text-[var(--ink-muted)] disabled:opacity-60"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {subtypeMessage && (
                  <p className="rounded-2xl border border-black/5 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                    {subtypeMessage}
                  </p>
                )}
              </div>

              {statusMessage && (
                <p className="rounded-2xl border border-black/5 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                  {statusMessage}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save house type'}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={saving || !draft.id}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink-muted)] disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default HouseTypes;
