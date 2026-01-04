import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, LayoutGrid, LogOut, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';

const QCLayout: React.FC = () => {
  const location = useLocation();
  const navItems = [
    { name: 'Dashboard', path: '/qc', icon: LayoutGrid },
    { name: 'Biblioteca', path: '/qc/library', icon: BookOpen },
  ];

  return (
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
          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-sm"
          >
            <LogOut className="h-4 w-4" /> Salir
          </Link>
        </header>
        <main className="flex-1 px-6 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default QCLayout;
