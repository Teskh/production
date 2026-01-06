import React, { useEffect, useState, useContext } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, LayoutGrid, LogOut, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const QC_ROLE_VALUES = new Set(['Calidad', 'QC']);

type AdminSession = {
  id: number;
  first_name: string;
  last_name: string;
  role: string;
  active: boolean;
};

const QCSessionContext = React.createContext<AdminSession | null>(null);

export const useQCSession = (): AdminSession => {
  const context = useContext(QCSessionContext);
  if (!context) {
    throw new Error('useQCSession must be used within QCLayout.');
  }
  return context;
};

const QCLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const navItems = [
    { name: 'Dashboard', path: '/qc', icon: LayoutGrid },
    { name: 'Biblioteca', path: '/qc/library', icon: BookOpen },
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
          throw new Error('No se pudo verificar la sesion de QC.');
        }
        const data = (await response.json()) as AdminSession;
        if (!QC_ROLE_VALUES.has(data.role)) {
          navigate('/login', { replace: true });
          return;
        }
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

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/admin/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      navigate('/login', { replace: true });
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#fef6e7,_#f2eadb_50%,_#e9e0d0_100%)] flex items-center justify-center text-sm text-[var(--ink-muted)]">
        Verificando sesion...
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#fef6e7,_#f2eadb_50%,_#e9e0d0_100%)] flex items-center justify-center text-sm text-[var(--ink-muted)]">
        Sesion invalida.
      </div>
    );
  }

  return (
    <QCSessionContext.Provider value={admin}>
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
            <div className="hidden sm:flex items-center gap-3 rounded-full border border-black/10 bg-white px-4 py-2 text-xs text-[var(--ink-muted)]">
              Sesion: {admin.first_name} {admin.last_name}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-sm"
            >
              <LogOut className="h-4 w-4" /> Salir
            </button>
          </header>
          <main className="flex-1 px-6 py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </QCSessionContext.Provider>
  );
};

export default QCLayout;
