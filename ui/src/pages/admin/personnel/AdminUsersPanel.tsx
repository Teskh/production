import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Shield, Trash2 } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type AdminUser = {
  id: number;
  first_name: string;
  last_name: string;
  role: string;
  active: boolean;
};

type AdminUserDraft = {
  id?: number;
  first_name: string;
  last_name: string;
  role: string;
  active: boolean;
  pin: string;
};

const emptyDraft = (): AdminUserDraft => ({
  first_name: '',
  last_name: '',
  role: '',
  active: true,
  pin: '',
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

const normalizeSearchValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const isProtectedSysadmin = (user: Pick<AdminUser, 'first_name' | 'last_name'>): boolean =>
  user.first_name.trim().toLowerCase() === 'sysadmin' &&
  user.last_name.trim().toLowerCase() === 'sysadmin';

type Props = {
  query: string;
  setQuery: (value: string) => void;
};

const AdminUsersPanel: React.FC<Props> = ({ query, setQuery }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [roleSuggestions, setRoleSuggestions] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<AdminUserDraft>(emptyDraft());

  const selectedUser = useMemo(
    () => adminUsers.find((item) => item.id === selectedId) ?? null,
    [adminUsers, selectedId]
  );

  const filteredUsers = useMemo(() => {
    const needle = normalizeSearchValue(query.trim());
    if (!needle) {
      return adminUsers;
    }
    return adminUsers.filter((user) => {
      const haystack = normalizeSearchValue(
        `${user.first_name} ${user.last_name} ${user.role}`.trim()
      );
      return haystack.includes(needle);
    });
  }, [adminUsers, query]);

  const refresh = async (nextSelectedId?: number | null) => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const [users, roles] = await Promise.all([
        apiRequest<AdminUser[]>('/api/admin/users'),
        apiRequest<string[]>('/api/admin/roles'),
      ]);
      const sorted = [...users].sort((a, b) => {
        const lastCompare = a.last_name.localeCompare(b.last_name);
        if (lastCompare !== 0) {
          return lastCompare;
        }
        return a.first_name.localeCompare(b.first_name);
      });
      setAdminUsers(sorted);
      setRoleSuggestions(roles ?? []);
      const defaultSelection =
        nextSelectedId ??
        (sorted.length ? sorted[0].id : null);
      setSelectedId(defaultSelection);
      const found = sorted.find((item) => item.id === defaultSelection);
      if (found) {
        setDraft({
          id: found.id,
          first_name: found.first_name,
          last_name: found.last_name,
          role: found.role,
          active: found.active,
          pin: '',
        });
      } else {
        setDraft(emptyDraft());
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'No se pudo cargar admins.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh(null);
  }, []);

  useEffect(() => {
    if (!selectedUser) {
      return;
    }
    setDraft({
      id: selectedUser.id,
      first_name: selectedUser.first_name,
      last_name: selectedUser.last_name,
      role: selectedUser.role,
      active: selectedUser.active,
      pin: '',
    });
  }, [selectedUser]);

  const handleSelect = (user: AdminUser) => {
    setSelectedId(user.id);
  };

  const handleNew = () => {
    setSelectedId(null);
    setDraft(emptyDraft());
    setStatusMessage(null);
  };

  const handleSave = async () => {
    if (saving) {
      return;
    }
    const firstName = draft.first_name.trim();
    const lastName = draft.last_name.trim();
    const role = draft.role.trim();
    if (!firstName || !lastName) {
      setStatusMessage('Nombre y apellido son requeridos.');
      return;
    }
    if (!role) {
      setStatusMessage('Rol es requerido.');
      return;
    }
    if (!draft.id && !draft.pin.trim()) {
      setStatusMessage('Se requiere PIN para crear un admin.');
      return;
    }

    setSaving(true);
    setStatusMessage(null);
    try {
      if (draft.id) {
        await apiRequest<AdminUser>(`/api/admin/users/${draft.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastName,
            role,
            active: draft.active,
            ...(draft.pin.trim() ? { pin: draft.pin.trim() } : {}),
          }),
        });
        await refresh(draft.id);
        setStatusMessage('Admin actualizado.');
      } else {
        const created = await apiRequest<AdminUser>('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastName,
            role,
            active: draft.active,
            pin: draft.pin.trim(),
          }),
        });
        await refresh(created.id);
        setStatusMessage('Admin creado.');
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedUser || saving) {
      return;
    }
    if (isProtectedSysadmin(selectedUser)) {
      setStatusMessage('El sysadmin protegido no se puede eliminar.');
      return;
    }
    if (!confirm(`Eliminar admin ${selectedUser.first_name} ${selectedUser.last_name}?`)) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      await apiRequest<void>(`/api/admin/users/${selectedUser.id}`, { method: 'DELETE' });
      await refresh(null);
      setStatusMessage('Admin eliminado.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'No se pudo eliminar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {statusMessage && (
        <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-2 text-sm text-[var(--ink-muted)]">
          {statusMessage}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-black/5 bg-white/80 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-display text-[var(--ink)]">Equipo admin</h2>
              <p className="text-xs text-[var(--ink-muted)]">
                {loading ? 'Cargando admins...' : `${adminUsers.length} usuarios`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="relative">
                <input
                  type="search"
                  placeholder="Buscar admin"
                  className="h-9 rounded-full border border-black/10 bg-white px-4 text-sm"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={handleNew}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm"
              >
                <Plus className="h-4 w-4" /> Nuevo
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {!loading && filteredUsers.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                No se encontraron admins.
              </div>
            )}
            <div className="divide-y divide-gray-100">
              {filteredUsers.map((user) => {
                const isSelected = selectedUser?.id === user.id;
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleSelect(user)}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      isSelected ? 'bg-blue-50/50' : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            isSelected ? 'text-blue-900' : 'text-gray-900'
                          }`}
                        >
                          {user.first_name} {user.last_name}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{user.role}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {!user.active && (
                          <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-600">
                            Inactivo
                          </span>
                        )}
                        {isProtectedSysadmin(user) && (
                          <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">
                            Protegido
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-black/5 bg-white/80 p-5 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-display text-[var(--ink)]">Detalles</h3>
              <p className="text-xs text-[var(--ink-muted)]">
                {draft.id ? 'Editar admin' : 'Crear admin'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || loading || (selectedUser ? isProtectedSysadmin(selectedUser) : false)}
                className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-gray-400"
              >
                <Save className="h-4 w-4" /> Guardar
              </button>
              {selectedUser && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving || loading || isProtectedSysadmin(selectedUser)}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" /> Eliminar
                </button>
              )}
            </div>
          </div>

          {selectedUser && isProtectedSysadmin(selectedUser) && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              <div className="flex items-center gap-2 font-semibold">
                <Shield className="h-4 w-4" /> Sysadmin protegido
              </div>
              <div className="mt-1">
                La contraseña del sysadmin se maneja via <code>SYS_ADMIN_PASSWORD</code> en{' '}
                <code>.env</code>.
              </div>
            </div>
          )}

          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Nombre
              </span>
              <input
                className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm"
                value={draft.first_name}
                onChange={(event) => setDraft((prev) => ({ ...prev, first_name: event.target.value }))}
                disabled={selectedUser ? isProtectedSysadmin(selectedUser) : false}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Apellido
              </span>
              <input
                className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm"
                value={draft.last_name}
                onChange={(event) => setDraft((prev) => ({ ...prev, last_name: event.target.value }))}
                disabled={selectedUser ? isProtectedSysadmin(selectedUser) : false}
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Rol
              </span>
              <input
                list="admin-role-suggestions"
                className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm"
                value={draft.role}
                onChange={(event) => setDraft((prev) => ({ ...prev, role: event.target.value }))}
                disabled={selectedUser ? isProtectedSysadmin(selectedUser) : false}
              />
              <datalist id="admin-role-suggestions">
                {roleSuggestions.map((role) => (
                  <option key={role} value={role} />
                ))}
              </datalist>
            </label>

            <label className="flex items-center justify-between rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm">
              <span className="text-[var(--ink)]">Activo</span>
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) => setDraft((prev) => ({ ...prev, active: event.target.checked }))}
                disabled={selectedUser ? isProtectedSysadmin(selectedUser) : false}
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                {draft.id ? 'Nuevo PIN (opcional)' : 'PIN'}
              </span>
              <input
                type="password"
                className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm"
                value={draft.pin}
                onChange={(event) => setDraft((prev) => ({ ...prev, pin: event.target.value }))}
                disabled={selectedUser ? isProtectedSysadmin(selectedUser) : false}
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminUsersPanel;
