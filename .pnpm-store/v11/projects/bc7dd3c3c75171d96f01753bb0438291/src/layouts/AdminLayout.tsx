import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Users,
  Settings,
  FileText,
  LogOut,
  Menu,
  X,
  Home,
  ClipboardList,
  Layers,
  Database,
  BarChart3,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
} from 'lucide-react';
import clsx from 'clsx';
import {
  AdminHeaderContext,
  AdminPageAccessContext,
  AdminSessionContext,
  canEditAdminPage,
  canViewAdminPage,
  isSysadminUser,
  pagePermissionsToMap,
  type AdminPagePermission,
  type AdminPagePermissionRole,
  type AdminHeaderState,
  type AdminSession,
} from './AdminLayoutContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

const defaultHeader: AdminHeaderState = {
  title: 'Area de Administracion',
};

const FALLBACK_ADMIN_ROLES = ['Supervisor', 'Admin', 'SysAdmin', 'QC', 'Prevencionista'];
const ADMIN_PAGE_PATH_ALIASES: Record<string, string> = {
  '/admin/specialties': 'workers',
  '/admin/admin-users': 'workers',
};

type AdminMenuItem = {
  id: string;
  name: string;
  path: string;
  icon: React.ElementType;
  sysadminOnly?: boolean;
};

type AdminMenuGroup = {
  title: string;
  items: AdminMenuItem[];
};

const buildHeaders = (options: RequestInit): Headers => {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
};

const adminApiRequest = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
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

const AdminLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [header, setHeader] = useState<AdminHeaderState>(defaultHeader);
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [roleOptions, setRoleOptions] = useState<string[]>([]);
  const [pagePermissions, setPagePermissions] = useState<AdminPagePermission[]>([]);
  const [pagePermissionsLoading, setPagePermissionsLoading] = useState(true);
  const [permissionDialogId, setPermissionDialogId] = useState<string | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<AdminPagePermissionRole[]>([]);
  const [permissionsSaving, setPermissionsSaving] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const lastTapRef = useRef(0);
  const location = useLocation();
  const navigate = useNavigate();

  const isSysadmin = admin ? isSysadminUser(admin) : false;
  const permissionMap = useMemo(() => pagePermissionsToMap(pagePermissions), [pagePermissions]);
  const baseMenuItems: AdminMenuGroup[] = [
    {
      title: 'Analitica',
      items: [{ id: 'dashboards', name: 'Dashboards', path: '/admin/dashboards', icon: BarChart3 }],
    },
    {
      title: 'Equipo',
      items: [
        { id: 'workers', name: 'Personal', path: '/admin/workers', icon: Users },
      ],
    },
    {
      title: 'Planeacion y Produccion',
      items: [
        {
          id: 'production-queue',
          name: 'Plan de Produccion',
          path: '/admin/production-queue',
          icon: Layers,
        },
      ],
    },
    {
      title: 'Definicion de Producto',
      items: [
        { id: 'house-config', name: 'Casa/Panel/Módulo', path: '/admin/house-config', icon: Home },
        {
          id: 'house-params',
          name: 'Parametros',
          path: '/admin/house-params',
          icon: Settings,
          sysadminOnly: true,
        },
      ],
    },
    {
      title: 'Configuracion',
      items: [
        { id: 'stations', name: 'Estaciones', path: '/admin/stations', icon: Settings, sysadminOnly: true },
        { id: 'task-defs', name: 'Tareas', path: '/admin/task-defs', icon: ClipboardList },
        {
          id: 'condition-defs',
          name: 'Condiciones',
          path: '/admin/condition-defs',
          icon: SlidersHorizontal,
        },
        { id: 'pause-note-defs', name: 'Pausas y Comentarios', path: '/admin/pause-note-defs', icon: FileText },
        { id: 'backups', name: 'Respaldos', path: '/admin/backups', icon: Database, sysadminOnly: true },
        { id: 'labels', name: 'Etiquetas', path: '/admin/labels', icon: Tags, sysadminOnly: true },
      ],
    },
  ];

  const allMenuItems = useMemo(() => baseMenuItems.flatMap((group) => group.items), [baseMenuItems]);
  const currentPage = useMemo(
    () => {
      const aliasPageId = Object.entries(ADMIN_PAGE_PATH_ALIASES).find(
        ([path]) => location.pathname === path || location.pathname.startsWith(`${path}/`),
      )?.[1];
      if (aliasPageId) {
        return allMenuItems.find((item) => item.id === aliasPageId) ?? null;
      }
      return allMenuItems.find(
        (item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`),
      ) ?? null;
    },
    [allMenuItems, location.pathname],
  );
  const canEditCurrentPage = admin
    ? canEditAdminPage(admin, currentPage?.id ?? null, permissionMap)
    : true;
  const menuItems = useMemo(
    () =>
      baseMenuItems
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            if (item.sysadminOnly && !isSysadmin) {
              return false;
            }
            return !admin || canViewAdminPage(admin, item.id, permissionMap);
          }),
        }))
        .filter((group) => group.items.length > 0),
    [admin, baseMenuItems, isSysadmin, permissionMap],
  );
  const permissionDialogPage = useMemo(
    () => allMenuItems.find((item) => item.id === permissionDialogId) ?? null,
    [allMenuItems, permissionDialogId],
  );
  const loginRedirectTarget = useMemo(() => {
    const authError = new URLSearchParams(location.search).get('auth_error');
    if (!authError) {
      return '/login';
    }
    return `/login?${new URLSearchParams({ auth_error: authError }).toString()}`;
  }, [location.search]);

  useEffect(() => {
    let active = true;
    const loadMe = async () => {
      setAuthLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/api/admin/me`, {
          credentials: 'include',
        });
        if (!active) {
          return;
        }
        if (response.status === 401) {
          navigate(loginRedirectTarget, { replace: true });
          return;
        }
        if (!response.ok) {
          throw new Error('No se pudo verificar la sesion de admin.');
        }
        const data = (await response.json()) as AdminSession;
        setAdmin(data);
      } catch {
        if (active) {
          navigate(loginRedirectTarget, { replace: true });
        }
      } finally {
        if (active) {
          setAuthLoading(false);
        }
      }
    };
    void loadMe();
    return () => {
      active = false;
    };
  }, [loginRedirectTarget, navigate]);

  useEffect(() => {
    if (!admin) {
      return;
    }
    let active = true;
    const loadPermissions = async () => {
      setPagePermissionsLoading(true);
      setPermissionError(null);
      try {
        const [permissionResult, roleResult] = await Promise.allSettled([
          adminApiRequest<AdminPagePermission[]>('/api/admin/page-permissions'),
          adminApiRequest<string[]>('/api/admin/roles'),
        ]);
        if (!active) {
          return;
        }
        if (permissionResult.status === 'fulfilled') {
          setPagePermissions(permissionResult.value);
        } else {
          setPagePermissions([]);
          setPermissionError(
            permissionResult.reason instanceof Error
              ? permissionResult.reason.message
              : 'No se pudo cargar permisos.',
          );
        }
        if (roleResult.status === 'fulfilled') {
          setRoleOptions(roleResult.value?.length ? roleResult.value : FALLBACK_ADMIN_ROLES);
        } else {
          setRoleOptions(FALLBACK_ADMIN_ROLES);
          setPermissionError(
            roleResult.reason instanceof Error
              ? roleResult.reason.message
              : 'No se pudieron cargar los roles admin.',
          );
        }
      } finally {
        if (active) {
          setPagePermissionsLoading(false);
        }
      }
    };
    void loadPermissions();
    return () => {
      active = false;
    };
  }, [admin]);

  useEffect(() => {
    if (!admin || pagePermissionsLoading || !currentPage) {
      return;
    }
    if (currentPage.sysadminOnly && !isSysadmin) {
      navigate('/admin/dashboards', { replace: true });
      return;
    }
    if (!canViewAdminPage(admin, currentPage.id, permissionMap)) {
      const firstVisible = menuItems.flatMap((group) => group.items)[0];
      navigate(firstVisible?.path ?? '/admin/dashboards', { replace: true });
    }
  }, [admin, currentPage, isSysadmin, menuItems, navigate, pagePermissionsLoading, permissionMap]);

  const handleLogout = async () => {
    setLogoutLoading(true);
    try {
      await fetch(`${API_BASE_URL}/api/admin/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore logout errors and still redirect to login.
    } finally {
      navigate('/login', { replace: true });
    }
  };

  const openPermissionDialog = (item: AdminMenuItem) => {
    const existing = permissionMap[item.id] ?? [];
    setPermissionDialogId(item.id);
    setPermissionDraft(
      (roleOptions.length ? roleOptions : FALLBACK_ADMIN_ROLES).map((role) => {
        const found = existing.find((permission) => permission.role === role);
        return found ?? { role, can_view: true, can_edit: true };
      }),
    );
    setPermissionError(null);
  };

  const updateDraftRole = (
    role: string,
    key: 'can_view' | 'can_edit',
    value: boolean,
  ) => {
    setPermissionDraft((prev) =>
      prev.map((permission) => {
        if (permission.role !== role) {
          return permission;
        }
        if (key === 'can_view') {
          return {
            ...permission,
            can_view: value,
            can_edit: value ? permission.can_edit : false,
          };
        }
        return {
          ...permission,
          can_view: value ? true : permission.can_view,
          can_edit: value,
        };
      }),
    );
  };

  const savePermissionDraft = async () => {
    if (!permissionDialogId) {
      return;
    }
    setPermissionsSaving(true);
    setPermissionError(null);
    try {
      const updated = await adminApiRequest<AdminPagePermission>(
        `/api/admin/page-permissions/${encodeURIComponent(permissionDialogId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ permissions: permissionDraft }),
        },
      );
      setPagePermissions((prev) => {
        const next = prev.filter((item) => item.page_id !== permissionDialogId);
        next.push(updated);
        return next;
      });
      setPermissionDialogId(null);
    } catch (error) {
      setPermissionError(error instanceof Error ? error.message : 'No se pudo guardar permisos.');
    } finally {
      setPermissionsSaving(false);
    }
  };

  const handleReadOnlySubmit = (event: React.SyntheticEvent<HTMLElement>) => {
    if (canEditCurrentPage) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center text-sm text-gray-600">
        Verificando sesion...
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center text-sm text-gray-600">
        Sesion invalida.
      </div>
    );
  }

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const root = document.documentElement;
    if (!root?.requestFullscreen || document.fullscreenElement) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select, a')) {
      return;
    }
    const now = Date.now();
    const lastTap = lastTapRef.current;
    lastTapRef.current = now;
    if (now - lastTap < 300) {
      root.requestFullscreen();
      lastTapRef.current = 0;
    }
  };

  return (
    <AdminHeaderContext.Provider value={{ header, setHeader }}>
      <AdminSessionContext.Provider value={admin}>
        <AdminPageAccessContext.Provider
          value={{ pageId: currentPage?.id ?? null, canEdit: canEditCurrentPage }}
        >
        <div
          className="relative min-h-screen bg-[radial-gradient(circle_at_top,_#fef9f2,_#f2ede1_45%,_#e7e2d8_100%)]"
          onTouchEnd={handleTouchEnd}
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute right-12 top-10 h-32 w-32 rounded-full bg-[rgba(242,98,65,0.2)] blur-2xl animate-drift" />
            <div className="absolute left-10 bottom-16 h-40 w-40 rounded-full bg-[rgba(47,107,79,0.15)] blur-3xl" />
          </div>
          <div className="relative flex min-h-screen">
            {sidebarOpen && (
              <div
                className="fixed inset-0 bg-black/50 z-20 lg:hidden"
                onClick={() => setSidebarOpen(false)}
              />
            )}

            <aside
              className={clsx(
                "fixed lg:static inset-y-0 left-0 z-30 w-72 text-white transition-transform duration-300 transform",
                sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
                "lg:translate-x-0"
              )}
            >
              <div className="h-full bg-[linear-gradient(160deg,_#0f1b2d_0%,_#1e2f4a_45%,_#132234_100%)] shadow-xl">
                <div className="flex items-center justify-between p-5 border-b border-white/10">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.3em] text-white/60">Control SCP</p>
                    <h1 className="text-lg font-display tracking-wide">Consola de Administracion</h1>
                  </div>
                  <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="lg:hidden p-1 hover:bg-white/10 rounded"
                  >
                    <X size={20} />
                  </button>
                </div>

                <nav className="p-5 space-y-6 overflow-y-auto h-[calc(100vh-96px)]">
                  {menuItems.map((group) => (
                    <div key={group.title}>
                      <h3 className="text-[11px] font-semibold text-white/50 uppercase tracking-[0.2em] mb-3">
                        {group.title}
                      </h3>
                      <div className="space-y-1">
                        {group.items.map((item) => (
                          <div key={item.path} className="flex items-center gap-1">
                            <Link
                              to={item.path}
                              className={clsx(
                                "flex min-w-0 flex-1 items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                                location.pathname === item.path ||
                                  location.pathname.startsWith(`${item.path}/`)
                                  ? "bg-white/15 text-white"
                                  : "text-white/70 hover:bg-white/10 hover:text-white"
                              )}
                            >
                              <item.icon size={18} className="mr-3 shrink-0" />
                              <span className="truncate">{item.name}</span>
                            </Link>
                            {isSysadmin && (
                              <button
                                type="button"
                                onClick={() => openPermissionDialog(item)}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
                                aria-label={`Configurar permisos de ${item.name}`}
                                title="Configurar permisos"
                              >
                                <ShieldCheck className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </nav>
              </div>
            </aside>

            <div className="flex-1 flex flex-col overflow-hidden">
              <header className="bg-white/80 backdrop-blur border-b border-black/5 h-16 flex items-center px-6">
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="lg:hidden mr-4 text-slate-700"
                >
                  <Menu size={24} />
                </button>
                <div>
                  {header.kicker && (
                    <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                      {header.kicker}
                    </p>
                  )}
                  <h2 className="font-display text-lg text-[var(--ink)]">{header.title}</h2>
                </div>
                <div className="flex-1" />
                <div className="flex items-center gap-3">
                  <div className="text-sm text-[var(--ink)]">
                    {[admin.first_name, admin.last_name].filter(Boolean).join(' ')}
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={logoutLoading}
                    className={clsx(
                      "inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-1 text-xs text-[var(--ink-muted)] hover:bg-black/5 transition",
                      logoutLoading && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    <LogOut size={14} />
                    {logoutLoading ? 'Saliendo...' : 'Salir'}
                  </button>
                </div>
              </header>
              <main
                className="flex-1 overflow-auto px-6 py-8"
                onSubmitCapture={handleReadOnlySubmit}
              >
                {!canEditCurrentPage && (
                  <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Tienes acceso de solo lectura en esta pagina.
                  </div>
                )}
                <Outlet />
              </main>
            </div>
          </div>
          {permissionDialogPage && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-8"
              role="dialog"
              aria-modal="true"
            >
              <div className="w-full max-w-xl rounded-2xl border border-black/10 bg-white p-5 shadow-xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                      Permisos de pagina
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">
                      {permissionDialogPage.name}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPermissionDialogId(null)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white text-[var(--ink-muted)] transition hover:border-black/20 hover:text-[var(--ink)]"
                    aria-label="Cerrar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-5 overflow-hidden rounded-xl border border-black/10">
                  <div className="grid grid-cols-[1fr_90px_90px] bg-black/[0.03] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    <span>Rol</span>
                    <span className="text-center">Ver</span>
                    <span className="text-center">Editar</span>
                  </div>
                  {permissionDraft.map((permission) => (
                    <div
                      key={permission.role}
                      className="grid grid-cols-[1fr_90px_90px] items-center border-t border-black/10 px-3 py-2 text-sm text-[var(--ink)]"
                    >
                      <span>{permission.role}</span>
                      <label className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={permission.can_view}
                          onChange={(event) =>
                            updateDraftRole(permission.role, 'can_view', event.target.checked)
                          }
                          className="h-4 w-4 accent-[var(--accent)]"
                        />
                      </label>
                      <label className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={permission.can_edit}
                          onChange={(event) =>
                            updateDraftRole(permission.role, 'can_edit', event.target.checked)
                          }
                          className="h-4 w-4 accent-[var(--accent)]"
                        />
                      </label>
                    </div>
                  ))}
                  {permissionDraft.length === 0 && (
                    <div className="px-3 py-4 text-sm text-[var(--ink-muted)]">
                      No hay roles admin disponibles para configurar.
                    </div>
                  )}
                </div>

                {permissionError && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {permissionError}
                  </div>
                )}

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPermissionDialogId(null)}
                    className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={savePermissionDraft}
                    disabled={permissionsSaving}
                    className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Save className="h-4 w-4" />
                    {permissionsSaving ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        </AdminPageAccessContext.Provider>
      </AdminSessionContext.Provider>
    </AdminHeaderContext.Provider>
  );
};

export default AdminLayout;
