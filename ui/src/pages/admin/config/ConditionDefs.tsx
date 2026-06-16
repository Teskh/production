import React, { useEffect, useMemo, useState } from 'react';
import { Edit3, Plus, Trash2, X } from 'lucide-react';
import {
  assertAdminPageMutationAllowed,
  useAdminHeader,
  useAdminPageAccess,
} from '../../../layouts/AdminLayoutContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type ConditionValue = {
  id: number;
  condition_type_id: number;
  name: string;
};

type ConditionType = {
  id: number;
  name: string;
  active: boolean;
  values: ConditionValue[];
};

type TypeDraft = {
  id?: number;
  name: string;
  active: boolean;
};

const emptyDraft = (): TypeDraft => ({
  name: '',
  active: true,
});

const buildDraftFromType = (conditionType: ConditionType): TypeDraft => ({
  id: conditionType.id,
  name: conditionType.name,
  active: conditionType.active,
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

const sortTypes = (list: ConditionType[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

const ConditionDefs: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const { canEdit } = useAdminPageAccess();
  const pageApiRequest = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    assertAdminPageMutationAllowed(canEdit, options);
    return apiRequest<T>(path, options);
  };
  const [conditionTypes, setConditionTypes] = useState<ConditionType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [typeDraft, setTypeDraft] = useState<TypeDraft>(emptyDraft());
  const [newValueName, setNewValueName] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setHeader({
      title: 'Condiciones de produccion',
      kicker: 'Configuracion / Condiciones de produccion',
    });
  }, [setHeader]);

  const refreshTypes = async (selectId?: number | null) => {
    const data = await pageApiRequest<ConditionType[]>('/api/conditions/types');
    const sorted = sortTypes(data);
    setConditionTypes(sorted);
    const targetId = selectId !== undefined ? selectId : selectedTypeId;
    const target = sorted.find((item) => item.id === targetId) ?? sorted[0] ?? null;
    setSelectedTypeId(target?.id ?? null);
    setTypeDraft(target ? buildDraftFromType(target) : emptyDraft());
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setStatusMessage(null);
      try {
        const data = await pageApiRequest<ConditionType[]>('/api/conditions/types');
        if (!active) {
          return;
        }
        const sorted = sortTypes(data);
        setConditionTypes(sorted);
        const initial = sorted[0] ?? null;
        setSelectedTypeId(initial?.id ?? null);
        setTypeDraft(initial ? buildDraftFromType(initial) : emptyDraft());
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error ? error.message : 'No se pudieron cargar las condiciones.';
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

  const filteredTypes = useMemo(() => {
    const query = normalizeSearch(search.trim());
    if (!query) {
      return conditionTypes;
    }
    return conditionTypes.filter((conditionType) =>
      normalizeSearch(
        `${conditionType.name} ${conditionType.values.map((value) => value.name).join(' ')}`
      ).includes(query)
    );
  }, [conditionTypes, search]);

  const selectedType = useMemo(
    () => conditionTypes.find((conditionType) => conditionType.id === selectedTypeId) ?? null,
    [conditionTypes, selectedTypeId]
  );

  const handleSelectType = (conditionType: ConditionType) => {
    setSelectedTypeId(conditionType.id);
    setTypeDraft(buildDraftFromType(conditionType));
    setNewValueName('');
    setStatusMessage(null);
  };

  const handleAddType = () => {
    setSelectedTypeId(null);
    setTypeDraft(emptyDraft());
    setNewValueName('');
    setStatusMessage(null);
  };

  const handleSaveType = async () => {
    setSaving(true);
    setStatusMessage(null);
    try {
      const name = typeDraft.name.trim();
      if (!name) {
        throw new Error('Se requiere el nombre de la condicion.');
      }
      const payload = { name, active: typeDraft.active };
      let saved: ConditionType;
      if (typeDraft.id) {
        saved = await pageApiRequest<ConditionType>(`/api/conditions/types/${typeDraft.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        saved = await pageApiRequest<ConditionType>('/api/conditions/types', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      await refreshTypes(saved.id);
      setStatusMessage('Condicion guardada.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar la condicion.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteType = async () => {
    if (!typeDraft.id) {
      return;
    }
    if (!window.confirm('Eliminar esta condicion y todos sus valores?')) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      await pageApiRequest<void>(`/api/conditions/types/${typeDraft.id}`, { method: 'DELETE' });
      await refreshTypes(null);
      setStatusMessage('Condicion eliminada.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar la condicion.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddValue = async () => {
    if (!typeDraft.id) {
      setStatusMessage('Guarde la condicion antes de agregar valores.');
      return;
    }
    const name = newValueName.trim();
    if (!name) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      await pageApiRequest<ConditionValue>('/api/conditions/values', {
        method: 'POST',
        body: JSON.stringify({ condition_type_id: typeDraft.id, name }),
      });
      setNewValueName('');
      await refreshTypes(typeDraft.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo agregar el valor.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleRenameValue = async (value: ConditionValue) => {
    const nextName = window.prompt('Nuevo nombre del valor', value.name);
    if (nextName === null) {
      return;
    }
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === value.name) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      await pageApiRequest<ConditionValue>(`/api/conditions/values/${value.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: trimmed }),
      });
      await refreshTypes(value.condition_type_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo renombrar el valor.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteValue = async (value: ConditionValue) => {
    if (!window.confirm(`Eliminar el valor "${value.name}"?`)) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      await pageApiRequest<void>(`/api/conditions/values/${value.id}`, { method: 'DELETE' });
      await refreshTypes(value.condition_type_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar el valor.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={handleAddType}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Nueva condicion
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">Tipos de condicion</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {conditionTypes.length} condiciones definidas
              </p>
            </div>
            <input
              type="search"
              placeholder="Buscar condiciones"
              className="h-9 rounded-full border border-black/10 bg-white px-4 text-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {loading && (
            <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              Cargando condiciones...
            </div>
          )}

          {!loading && filteredTypes.length === 0 && (
            <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              Aun no hay condiciones. Cree una para empezar (por ejemplo: Piso, Nivel de
              terminacion, Paquete opcional).
            </div>
          )}

          <div className="mt-4 space-y-3">
            {filteredTypes.map((conditionType, index) => (
              <button
                key={conditionType.id}
                onClick={() => handleSelectType(conditionType)}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
                  selectedTypeId === conditionType.id
                    ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
                    : 'border-black/5 bg-white'
                }`}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div>
                  <p className="font-semibold text-[var(--ink)]">{conditionType.name}</p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {conditionType.values.length === 0
                      ? 'Sin valores'
                      : conditionType.values.map((value) => value.name).join(', ')}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    conditionType.active
                      ? 'border-black/10 text-[var(--ink-muted)]'
                      : 'border-amber-300 bg-amber-50 text-amber-700'
                  }`}
                >
                  {conditionType.active ? `${conditionType.values.length} valores` : 'Inactiva'}
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
                  Detalle
                </p>
                <h2 className="text-lg font-display text-[var(--ink)]">
                  {selectedType?.name || typeDraft.name || 'Nueva condicion'}
                </h2>
              </div>
              <Edit3 className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>

            <div className="mt-4 space-y-4">
              <label className="text-sm text-[var(--ink-muted)]">
                Nombre de la condicion
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  value={typeDraft.name}
                  onChange={(event) =>
                    setTypeDraft((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="Por ejemplo: Piso"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={typeDraft.active}
                  onChange={(event) =>
                    setTypeDraft((prev) => ({ ...prev, active: event.target.checked }))
                  }
                />
                Activa (las condiciones inactivas dejan de filtrar tareas)
              </label>

              <div>
                <p className="text-sm text-[var(--ink-muted)]">Valores</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(selectedType?.values ?? []).map((value) => (
                    <span
                      key={value.id}
                      className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-1 text-sm text-[var(--ink)]"
                    >
                      <button
                        type="button"
                        onClick={() => handleRenameValue(value)}
                        title="Renombrar valor"
                      >
                        {value.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteValue(value)}
                        className="text-[var(--ink-muted)] hover:text-red-600"
                        title="Eliminar valor"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                  {selectedType && selectedType.values.length === 0 && (
                    <span className="text-xs text-[var(--ink-muted)]">
                      Aun no hay valores para esta condicion.
                    </span>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    value={newValueName}
                    onChange={(event) => setNewValueName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleAddValue();
                      }
                    }}
                    placeholder="Nuevo valor (por ejemplo: Primero)"
                    disabled={!typeDraft.id}
                  />
                  <button
                    type="button"
                    onClick={handleAddValue}
                    disabled={saving || !typeDraft.id || !newValueName.trim()}
                    className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-[var(--ink-muted)] disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" /> Agregar
                  </button>
                </div>
                {!typeDraft.id && (
                  <p className="mt-2 text-xs text-[var(--ink-muted)]">
                    Guarde la condicion antes de agregar valores.
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
                  onClick={handleSaveType}
                  disabled={saving}
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saving ? 'Guardando...' : 'Guardar condicion'}
                </button>
                <button
                  onClick={handleDeleteType}
                  disabled={saving || !typeDraft.id}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink-muted)] disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" /> Eliminar
                </button>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default ConditionDefs;
