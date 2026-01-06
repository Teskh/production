import React, { useEffect, useState, useContext } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  CalendarClock,
  LayoutGrid,
  LogOut,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import clsx from 'clsx';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type AdminSession = {
  id: number;
  first_name: string;
  last_name: string;
  role: string;
  active: boolean;
};

type QCLayoutStatus = {
  refreshIntervalMs?: number;
  lastUpdated?: Date;
};

const QCSessionContext = React.createContext<AdminSession | null>(null);
const QCLayoutStatusContext = React.createContext<{
  status: QCLayoutStatus;
  setStatus: React.Dispatch<React.SetStateAction<QCLayoutStatus>>;
} | null>(null);

export const useQCSession = (): AdminSession => {
  const context = useContext(QCSessionContext);
  if (!context) {
    throw new Error('useQCSession must be used within QCLayout.');
  }
  return context;
};

export const useOptionalQCSession = (): AdminSession | null => {
  return useContext(QCSessionContext);
};

export const useQCLayoutStatus = () => {
  const context = useContext(QCLayoutStatusContext);
  if (!context) {
    throw new Error('useQCLayoutStatus must be used within QCLayout.');
  }
  return context;
};

const formatTime = (date: Date): string =>
  date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

const QCLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [status, setStatus] = useState<QCLayoutStatus>({});
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginFirstName, setLoginFirstName] = useState('');
  const [loginLastName, setLoginLastName] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const navItems = [
    { name: 'Dashboard', path: '/qc', icon: LayoutGrid },
    { name: 'Biblioteca', path: '/qc/library', icon: BookOpen },
    ...(admin ? [{ name: 'Checks', path: '/qc/checks', icon: ShieldCheck }] : []),
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
          setAdmin(null);
          return;
        }
        if (!response.ok) {
          throw new Error('No se pudo verificar la sesion de QC.');
        }
        const data = (await response.json()) as AdminSession;
        setAdmin(data);
      } catch {
        if (active) {
          setAdmin(null);
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

  useEffect(() => {
    const state = location.state as { qcLogin?: boolean } | null;
    if (state?.qcLogin) {
      setLoginOpen(true);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/admin/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      setAdmin(null);
    }
  };

  const openLogin = () => {
    setLoginOpen(true);
    setLoginError(null);
  };

  const closeLogin = () => {
    setLoginOpen(false);
    setLoginError(null);
    setLoginSubmitting(false);
    setLoginFirstName('');
    setLoginLastName('');
    setLoginPin('');
  };

  const handleLogin = async () => {
    setLoginSubmitting(true);
    setLoginError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          first_name: loginFirstName.trim(),
          last_name: loginLastName.trim(),
          pin: loginPin,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Fallo el inicio de sesion de admin.');
      }
      const meResponse = await fetch(`${API_BASE_URL}/api/admin/me`, {
        credentials: 'include',
      });
      if (!meResponse.ok) {
        throw new Error('No se pudo verificar la sesion de QC.');
      }
      const data = (await meResponse.json()) as AdminSession;
      setAdmin(data);
      closeLogin();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Fallo el inicio de sesion de admin.';
      setLoginError(message);
    } finally {
      setLoginSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#fef6e7,_#f2eadb_50%,_#e9e0d0_100%)] flex items-center justify-center text-sm text-[var(--ink-muted)]">
        Verificando sesion...
      </div>
    );
  }

  const isAuthenticated = Boolean(admin);

  return (
    <QCSessionContext.Provider value={admin}>
      <QCLayoutStatusContext.Provider value={{ status, setStatus }}>
        <div className="relative min-h-screen bg-[radial-gradient(circle_at_top,_#fef6e7,_#f2eadb_50%,_#e9e0d0_100%)]">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-6 top-6 h-28 w-28 rounded-full bg-[rgba(242,98,65,0.18)] blur-2xl animate-drift" />
            <div className="absolute right-10 bottom-10 h-36 w-36 rounded-full bg-[rgba(15,27,45,0.12)] blur-3xl" />
            <div className="absolute inset-0 bg-grid opacity-[0.12]" />
          </div>
          <div className="relative flex min-h-screen flex-col">
            <header className="flex flex-wrap items-center gap-4 border-b border-black/5 bg-white/75 px-6 py-4 backdrop-blur">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--ink)] text-white">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                    Quality Control
                  </p>
                  <h1 className="font-display text-lg text-[var(--ink)]">Centro QC</h1>
                </div>
              </div>

              <nav className="flex flex-wrap items-center gap-2">
                {navItems.map((item) => {
                  const active =
                    item.path === '/qc'
                      ? location.pathname === '/qc'
                      : location.pathname.startsWith(item.path);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={clsx(
                        'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition',
                        active
                          ? 'bg-[var(--ink)] text-white shadow-sm'
                          : 'bg-white/70 text-[var(--ink)] hover:bg-white'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.name}
                    </Link>
                  );
                })}
              </nav>

              <div className="flex-1" />
              {isAuthenticated ? (
                <>
                  <div className="hidden sm:flex items-center gap-3 rounded-full border border-black/10 bg-white px-4 py-2 text-xs text-[var(--ink-muted)]">
                    Sesion: {admin?.first_name} {admin?.last_name}
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-sm"
                  >
                    <LogOut className="h-4 w-4" /> Salir
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={openLogin}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-sm"
                >
                  <LogOut className="h-4 w-4" /> Iniciar sesion
                </button>
              )}
            </header>
            {(status.refreshIntervalMs || status.lastUpdated) && (
              <div className="flex flex-wrap items-center justify-end gap-3 border-b border-black/5 bg-white/65 px-6 py-3 text-xs text-[var(--ink-muted)] backdrop-blur">
                {status.refreshIntervalMs ? (
                  <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Auto-refresco cada {Math.floor(status.refreshIntervalMs / 1000)}s
                  </div>
                ) : null}
                {status.lastUpdated ? (
                  <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2">
                    <CalendarClock className="h-3.5 w-3.5" />
                    Actualizado {formatTime(status.lastUpdated)}
                  </div>
                ) : null}
              </div>
            )}
            <main className="flex-1 px-6 py-8">
              <Outlet />
            </main>
          </div>
        </div>
        {loginOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md rounded-3xl border border-black/10 bg-white p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                    QC login
                  </p>
                  <h2 className="mt-2 font-display text-xl text-[var(--ink)]">
                    Iniciar sesion
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeLogin}
                  className="rounded-full border border-black/10 p-2 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-5 space-y-4">
                <label className="block text-sm text-[var(--ink-muted)]">
                  Nombre
                  <input
                    type="text"
                    value={loginFirstName}
                    onChange={(event) => setLoginFirstName(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-black/10 px-4 py-2 text-sm text-[var(--ink)]"
                  />
                </label>
                <label className="block text-sm text-[var(--ink-muted)]">
                  Apellido
                  <input
                    type="text"
                    value={loginLastName}
                    onChange={(event) => setLoginLastName(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-black/10 px-4 py-2 text-sm text-[var(--ink)]"
                  />
                </label>
                <label className="block text-sm text-[var(--ink-muted)]">
                  PIN
                  <input
                    type="password"
                    value={loginPin}
                    onChange={(event) => setLoginPin(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-black/10 px-4 py-2 text-sm text-[var(--ink)]"
                  />
                </label>
                {loginError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
                    {loginError}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={loginSubmitting}
                  className={clsx(
                    'w-full rounded-2xl px-4 py-2 text-sm font-semibold text-white transition',
                    loginSubmitting ? 'bg-slate-400' : 'bg-[var(--ink)] hover:bg-black'
                  )}
                >
                  {loginSubmitting ? 'Ingresando...' : 'Ingresar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </QCLayoutStatusContext.Provider>
    </QCSessionContext.Provider>
  );
};

export default QCLayout;
