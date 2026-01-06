import React, { useEffect, useState, useContext } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Users,
  Settings,
  FileText,
  LogIn,
  LogOut,
  Menu,
  X,
  Home,
  ClipboardList,
  Layers,
  Database,
  BarChart3,
} from 'lucide-react';
import clsx from 'clsx';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type AdminHeaderState = {
  title: string;
  kicker?: string;
};

type AdminHeaderContextValue = {
  header: AdminHeaderState;
  setHeader: React.Dispatch<React.SetStateAction<AdminHeaderState>>;
};

export type AdminSession = {
  id: number;
  first_name: string;
  last_name: string;
  role: string;
  active: boolean;
};

const defaultHeader: AdminHeaderState = {
  title: 'Area de Administracion',
};

const AdminHeaderContext = React.createContext<AdminHeaderContextValue | null>(null);
const AdminSessionContext = React.createContext<AdminSession | null>(null);

export const useAdminHeader = (): AdminHeaderContextValue => {
  const context = useContext(AdminHeaderContext);
  if (!context) {
    throw new Error('useAdminHeader must be used within AdminLayout.');
  }
  return context;
};

export const useAdminSession = (): AdminSession => {
  const context = useContext(AdminSessionContext);
  if (!context) {
    throw new Error('useAdminSession must be used within AdminLayout.');
  }
  return context;
};

export const isSysadminUser = (admin: Pick<AdminSession, 'first_name' | 'last_name'>): boolean =>
  admin.first_name.trim().toLowerCase() === 'sysadmin' &&
  admin.last_name.trim().toLowerCase() === 'sysadmin';

const AdminLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [header, setHeader] = useState<AdminHeaderState>(defaultHeader);
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const menuItems = [
    {
      title: 'Analitica',
      items: [{ name: 'Dashboards', path: '/admin/dashboards', icon: BarChart3 }],
    },
    {
      title: 'Equipo',
      items: [
        { name: 'Personal', path: '/admin/workers', icon: Users },
      ],
    },
    {
      title: 'Planeacion y Produccion',
      items: [
        { name: 'Estado de Linea', path: '/admin/line-status', icon: Home },
        { name: 'Plan de Produccion', path: '/admin/production-queue', icon: Layers },
      ],
    },
    {
      title: 'Definicion de Producto',
      items: [
        { name: 'Casa/Panel/Módulo', path: '/admin/house-config', icon: Home },
        { name: 'Parametros', path: '/admin/house-params', icon: Settings },
      ],
    },
    {
      title: 'Configuracion',
      items: [
        { name: 'Estaciones', path: '/admin/stations', icon: Settings },
        { name: 'Tareas', path: '/admin/task-defs', icon: ClipboardList },
        { name: 'Pausas y Comentarios', path: '/admin/pause-note-defs', icon: FileText },
        { name: 'Respaldos', path: '/admin/backups', icon: Database },
      ],
    },
  ];

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
          navigate('/login', { replace: true });
          return;
        }
        if (!response.ok) {
          throw new Error('No se pudo verificar la sesion de admin.');
        }
        const data = (await response.json()) as AdminSession;
        setAdmin(data);
      } catch {
        if (active) {
          navigate('/login', { replace: true });
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
  }, [navigate]);

  const handleGoToLogin = () => {
    navigate('/login');
  };

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

  return (
    <AdminHeaderContext.Provider value={{ header, setHeader }}>
      <AdminSessionContext.Provider value={admin}>
        <div className="relative min-h-screen bg-[radial-gradient(circle_at_top,_#fef9f2,_#f2ede1_45%,_#e7e2d8_100%)]">
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
                          <Link
                            key={item.path}
                            to={item.path}
                            className={clsx(
                              "flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                              location.pathname === item.path ||
                                location.pathname.startsWith(`${item.path}/`)
                                ? "bg-white/15 text-white"
                                : "text-white/70 hover:bg-white/10 hover:text-white"
                            )}
                          >
                            <item.icon size={18} className="mr-3" />
                            {item.name}
                          </Link>
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
                    onClick={handleGoToLogin}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-1 text-xs text-[var(--ink-muted)] hover:bg-black/5 transition"
                  >
                    <LogIn size={14} />
                    Login
                  </button>
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
              <main className="flex-1 overflow-auto px-6 py-8">
                <Outlet />
              </main>
            </div>
          </div>
        </div>
      </AdminSessionContext.Provider>
    </AdminHeaderContext.Provider>
  );
};

export default AdminLayout;
