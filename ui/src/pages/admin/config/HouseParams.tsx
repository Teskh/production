import React, { useEffect, useMemo, useState } from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';

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

type HouseParameter = {
  id: number;
  name: string;
  unit: string | null;
};

type HouseParameterValue = {
  id: number;
  house_type_id: number;
  parameter_id: number;
  module_sequence_number: number;
  sub_type_id: number | null;
  value: number;
};

type ParameterDraft = {
  id?: number;
  name: string;
  unit: string;
};

const emptyDraft = (): ParameterDraft => ({
  name: '',
  unit: '',
});

const buildDraftFromParameter = (parameter: HouseParameter): ParameterDraft => ({
  id: parameter.id,
  name: parameter.name,
  unit: parameter.unit ?? '',
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

const sortParameters = (list: HouseParameter[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

const sortHouseTypes = (list: HouseType[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

const sortSubtypes = (list: HouseSubType[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

const parseNumberInput = (value: string): number | 'invalid' => {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'invalid';
  }
  const normalized = trimmed.replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return 'invalid';
  }
  return parsed;
};

const HouseParams: React.FC = () => {
  const [parameters, setParameters] = useState<HouseParameter[]>([]);
  const [parameterDraft, setParameterDraft] = useState<ParameterDraft>(emptyDraft());
  const [selectedParameterId, setSelectedParameterId] = useState<number | null>(null);
  const [parameterValues, setParameterValues] = useState<HouseParameterValue[]>([]);
  const [houseTypes, setHouseTypes] = useState<HouseType[]>([]);
  const [subtypesByType, setSubtypesByType] = useState<Record<number, HouseSubType[]>>({});
  const [selectedHouseTypeId, setSelectedHouseTypeId] = useState<number | null>(null);
  const [selectedSubtypeId, setSelectedSubtypeId] = useState<number | null>(null);
  const [valueDrafts, setValueDrafts] = useState<Record<number, string>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingValues, setLoadingValues] = useState(false);
  const [loadingSubtypes, setLoadingSubtypes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [valueMessage, setValueMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setStatusMessage(null);
      try {
        const [parameterData, houseTypeData] = await Promise.all([
          apiRequest<HouseParameter[]>('/api/house-parameters'),
          apiRequest<HouseType[]>('/api/house-types'),
        ]);
        if (!active) {
          return;
        }
        const sortedParameters = sortParameters(parameterData);
        const sortedHouseTypes = sortHouseTypes(houseTypeData);
        setParameters(sortedParameters);
        setHouseTypes(sortedHouseTypes);
        const initialParameter = sortedParameters[0] ?? null;
        const initialHouseType = sortedHouseTypes[0] ?? null;
        setSelectedParameterId(initialParameter?.id ?? null);
        setParameterDraft(initialParameter ? buildDraftFromParameter(initialParameter) : emptyDraft());
        setSelectedHouseTypeId(initialHouseType?.id ?? null);
        setSelectedSubtypeId(null);
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error ? error.message : 'Failed to load house parameters.';
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

  const loadSubtypesForType = async (houseTypeId: number) => {
    setLoadingSubtypes(true);
    setValueMessage(null);
    try {
      const data = await apiRequest<HouseSubType[]>(`/api/house-types/${houseTypeId}/subtypes`);
      setSubtypesByType((prev) => ({ ...prev, [houseTypeId]: sortSubtypes(data) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load subtypes.';
      setValueMessage(message);
    } finally {
      setLoadingSubtypes(false);
    }
  };

  useEffect(() => {
    if (!selectedHouseTypeId) {
      return;
    }
    if (!subtypesByType[selectedHouseTypeId]) {
      void loadSubtypesForType(selectedHouseTypeId);
    }
  }, [selectedHouseTypeId, subtypesByType]);

  useEffect(() => {
    if (!selectedParameterId) {
      setParameterValues([]);
      setValueMessage(null);
      return;
    }
    let active = true;
    const loadValues = async () => {
      setLoadingValues(true);
      setValueMessage(null);
      try {
        const data = await apiRequest<HouseParameterValue[]>(
          `/api/house-parameters/${selectedParameterId}/values`
        );
        if (!active) {
          return;
        }
        setParameterValues(data);
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to load parameter values.';
          setValueMessage(message);
        }
      } finally {
        if (active) {
          setLoadingValues(false);
        }
      }
    };
    loadValues();
    return () => {
      active = false;
    };
  }, [selectedParameterId]);

  const filteredParameters = useMemo(() => {
    const query = normalizeSearch(search.trim());
    if (!query) {
      return parameters;
    }
    return parameters.filter((parameter) =>
      normalizeSearch(`${parameter.name} ${parameter.unit ?? ''}`).includes(query)
    );
  }, [parameters, search]);

  const selectedParameter = useMemo(
    () => parameters.find((parameter) => parameter.id === selectedParameterId) ?? null,
    [parameters, selectedParameterId]
  );

  const selectedHouseType = useMemo(
    () => houseTypes.find((type) => type.id === selectedHouseTypeId) ?? null,
    [houseTypes, selectedHouseTypeId]
  );

  const selectedSubtypes = useMemo(() => {
    if (!selectedHouseTypeId) {
      return [];
    }
    return subtypesByType[selectedHouseTypeId] ?? [];
  }, [selectedHouseTypeId, subtypesByType]);

  const filteredValues = useMemo(() => {
    if (!selectedHouseTypeId) {
      return [];
    }
    return parameterValues.filter(
      (value) =>
        value.house_type_id === selectedHouseTypeId && value.sub_type_id === selectedSubtypeId
    );
  }, [parameterValues, selectedHouseTypeId, selectedSubtypeId]);

  const valueByModule = useMemo(() => {
    const map = new Map<number, HouseParameterValue>();
    filteredValues.forEach((value) => {
      map.set(value.module_sequence_number, value);
    });
    return map;
  }, [filteredValues]);

  useEffect(() => {
    if (!selectedHouseType) {
      setValueDrafts({});
      return;
    }
    const nextDrafts: Record<number, string> = {};
    for (let index = 1; index <= selectedHouseType.number_of_modules; index += 1) {
      const existing = valueByModule.get(index);
      nextDrafts[index] = existing ? String(existing.value) : '';
    }
    setValueDrafts(nextDrafts);
  }, [selectedHouseType, selectedSubtypeId, valueByModule]);

  const handleSelectParameter = (parameter: HouseParameter) => {
    setSelectedParameterId(parameter.id);
    setParameterDraft(buildDraftFromParameter(parameter));
    setStatusMessage(null);
  };

  const handleAddParameter = () => {
    setSelectedParameterId(null);
    setParameterDraft(emptyDraft());
    setParameterValues([]);
    setStatusMessage(null);
  };

  const handleDraftChange = (patch: Partial<ParameterDraft>) => {
    setParameterDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleHouseTypeChange = (value: string) => {
    const houseTypeId = value ? Number(value) : null;
    setSelectedHouseTypeId(houseTypeId);
    setSelectedSubtypeId(null);
    setValueMessage(null);
    if (houseTypeId && !subtypesByType[houseTypeId]) {
      void loadSubtypesForType(houseTypeId);
    }
  };

  const handleToggleSubtype = (enabled: boolean) => {
    if (!enabled) {
      setSelectedSubtypeId(null);
      return;
    }
    const firstSubtypeId = selectedSubtypes[0]?.id ?? null;
    setSelectedSubtypeId(firstSubtypeId);
  };

  const handleSubtypeSelect = (subtypeId: number) => {
    setSelectedSubtypeId(subtypeId);
  };

  const handleValueChange = (moduleNumber: number, nextValue: string) => {
    setValueDrafts((prev) => ({ ...prev, [moduleNumber]: nextValue }));
  };

  const buildParameterPayload = (draft: ParameterDraft) => {
    const name = draft.name.trim();
    if (!name) {
      throw new Error('Parameter name is required.');
    }
    const unit = draft.unit.trim();
    return { name, unit: unit ? unit : null };
  };

  const saveValues = async (parameterId: number) => {
    if (!selectedHouseType) {
      setValueMessage('Select a house type to edit values.');
      return;
    }
    const operations: Promise<unknown>[] = [];
    for (let index = 1; index <= selectedHouseType.number_of_modules; index += 1) {
      const input = valueDrafts[index] ?? '';
      const trimmed = input.trim();
      const existing = valueByModule.get(index);
      if (!trimmed) {
        if (existing) {
          operations.push(
            apiRequest<void>(`/api/house-parameters/values/${existing.id}`, { method: 'DELETE' })
          );
        }
        continue;
      }
      const parsed = parseNumberInput(trimmed);
      if (parsed === 'invalid') {
        throw new Error(`Invalid value for module ${index}.`);
      }
      if (existing) {
        if (Number(existing.value) !== parsed) {
          operations.push(
            apiRequest<HouseParameterValue>(`/api/house-parameters/values/${existing.id}`, {
              method: 'PUT',
              body: JSON.stringify({ value: parsed }),
            })
          );
        }
        continue;
      }
      operations.push(
        apiRequest<HouseParameterValue>(`/api/house-parameters/${parameterId}/values`, {
          method: 'POST',
          body: JSON.stringify({
            house_type_id: selectedHouseType.id,
            parameter_id: parameterId,
            module_sequence_number: index,
            sub_type_id: selectedSubtypeId,
            value: parsed,
          }),
        })
      );
    }
    if (operations.length === 0) {
      setValueMessage('Values already up to date.');
      return;
    }
    await Promise.all(operations);
    const refreshed = await apiRequest<HouseParameterValue[]>(
      `/api/house-parameters/${parameterId}/values`
    );
    setParameterValues(refreshed);
    setValueMessage('Values saved.');
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMessage(null);
    setValueMessage(null);
    try {
      const payload = buildParameterPayload(parameterDraft);
      let saved: HouseParameter;
      if (parameterDraft.id) {
        saved = await apiRequest<HouseParameter>(`/api/house-parameters/${parameterDraft.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setParameters((prev) =>
          sortParameters(prev.map((item) => (item.id === saved.id ? saved : item)))
        );
      } else {
        saved = await apiRequest<HouseParameter>('/api/house-parameters', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setParameters((prev) => sortParameters([...prev, saved]));
      }
      setSelectedParameterId(saved.id);
      setParameterDraft(buildDraftFromParameter(saved));
      if (selectedHouseType) {
        await saveValues(saved.id);
      }
      setStatusMessage('Parameter saved.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save parameter.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!parameterDraft.id) {
      return;
    }
    if (!window.confirm('Delete this parameter?')) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      await apiRequest<void>(`/api/house-parameters/${parameterDraft.id}`, { method: 'DELETE' });
      const remaining = sortParameters(
        parameters.filter((parameter) => parameter.id !== parameterDraft.id)
      );
      setParameters(remaining);
      const next = remaining[0] ?? null;
      setSelectedParameterId(next?.id ?? null);
      setParameterDraft(next ? buildDraftFromParameter(next) : emptyDraft());
      setParameterValues([]);
      setStatusMessage('Parameter removed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove parameter.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const subtypeEnabled = selectedSubtypeId !== null;
  const subtypeDisabled = selectedSubtypes.length === 0 || loadingSubtypes;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Product Definition / House Parameters
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">House Parameters</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Maintain parameter definitions and per-module values for each house type.
          </p>
        </div>
        <button
          onClick={handleAddParameter}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> New parameter
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">Parameter list</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {parameters.length} parameters in the library
              </p>
            </div>
            <input
              type="search"
              placeholder="Search parameters"
              className="h-9 rounded-full border border-black/10 bg-white px-4 text-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {loading && (
            <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              Loading parameters...
            </div>
          )}

          {!loading && filteredParameters.length === 0 && (
            <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              No parameters yet.
            </div>
          )}

          <div className="mt-4 space-y-3">
            {filteredParameters.map((parameter, index) => (
              <button
                key={parameter.id}
                onClick={() => handleSelectParameter(parameter)}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
                  selectedParameterId === parameter.id
                    ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
                    : 'border-black/5 bg-white'
                }`}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div>
                  <p className="font-semibold text-[var(--ink)]">{parameter.name}</p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Unit: {parameter.unit ?? 'n/a'}
                  </p>
                </div>
                <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-[var(--ink-muted)]">
                  {parameter.unit ?? 'n/a'}
                </span>
              </button>
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Detail
                </p>
                <h2 className="text-lg font-display text-[var(--ink)]">
                  {selectedParameter?.name || parameterDraft.name || 'New parameter'}
                </h2>
              </div>
              <Edit3 className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>

            <div className="mt-4 space-y-4">
              <label className="text-sm text-[var(--ink-muted)]">
                Parameter name
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  value={parameterDraft.name}
                  onChange={(event) => handleDraftChange({ name: event.target.value })}
                />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                Unit
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  value={parameterDraft.unit}
                  onChange={(event) => handleDraftChange({ unit: event.target.value })}
                />
              </label>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-[var(--ink-muted)]">Per-module values</p>
                    {selectedHouseType && (
                      <p className="text-xs text-[var(--ink-muted)]">
                        {selectedHouseType.number_of_modules} modules •
                        {subtypeEnabled
                          ? ' subtype override'
                          : selectedSubtypes.length > 0
                            ? ' default values'
                            : ' no subtypes'}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-[var(--ink-muted)]">
                      House type
                      <select
                        className="ml-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs"
                        value={selectedHouseTypeId ?? ''}
                        onChange={(event) => handleHouseTypeChange(event.target.value)}
                        disabled={houseTypes.length === 0}
                      >
                        {houseTypes.length === 0 && <option value="">No house types</option>}
                        {houseTypes.length > 0 && !selectedHouseTypeId && (
                          <option value="">Select house type</option>
                        )}
                        {houseTypes.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={subtypeEnabled}
                        onChange={(event) => handleToggleSubtype(event.target.checked)}
                        disabled={subtypeDisabled}
                      />
                      Use subtype
                    </label>
                    {subtypeEnabled && (
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-2 text-xs"
                        value={selectedSubtypeId ?? ''}
                        onChange={(event) => handleSubtypeSelect(Number(event.target.value))}
                        disabled={selectedSubtypes.length === 0}
                      >
                        {selectedSubtypes.map((subtype) => (
                          <option key={subtype.id} value={subtype.id}>
                            {subtype.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {houseTypes.length === 0 && (
                  <div className="mt-3 rounded-2xl border border-dashed border-black/10 px-3 py-2 text-xs text-[var(--ink-muted)]">
                    Create a house type to add parameter values.
                  </div>
                )}

                {loadingValues && (
                  <div className="mt-3 rounded-2xl border border-dashed border-black/10 px-3 py-2 text-xs text-[var(--ink-muted)]">
                    Loading parameter values...
                  </div>
                )}

                {selectedHouseType && (
                  <div className="mt-3 overflow-hidden rounded-2xl border border-black/5">
                    <table className="w-full text-sm">
                      <thead className="bg-[rgba(201,215,245,0.4)] text-xs text-[var(--ink-muted)]">
                        <tr>
                          <th className="px-3 py-2 text-left">Module</th>
                          <th className="px-3 py-2 text-left">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from(
                          { length: selectedHouseType.number_of_modules },
                          (_, index) => index + 1
                        ).map((moduleNumber) => (
                          <tr key={moduleNumber} className="border-t border-black/5">
                            <td className="px-3 py-2 text-[var(--ink)]">{moduleNumber}</td>
                            <td className="px-3 py-2">
                              <input
                                className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm"
                                value={valueDrafts[moduleNumber] ?? ''}
                                onChange={(event) =>
                                  handleValueChange(moduleNumber, event.target.value)
                                }
                                disabled={houseTypes.length === 0}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {valueMessage && (
                <p className="rounded-2xl border border-black/5 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                  {valueMessage}
                </p>
              )}

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
                  {saving ? 'Saving...' : 'Save parameter'}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={saving || !parameterDraft.id}
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

export default HouseParams;
