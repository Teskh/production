import React, { useState, useContext } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  Users,
  Calendar,
  Settings,
  FileText,
  Menu,
  X,
  Home,
  ClipboardList,
  CheckSquare,
  Layers,
  Database,
  BarChart3,
} from 'lucide-react';
import clsx from 'clsx';

type AdminHeaderState = {
  title: string;
  kicker?: string;
};

type AdminHeaderContextValue = {
  header: AdminHeaderState;
  setHeader: React.Dispatch<React.SetStateAction<AdminHeaderState>>;
};

const defaultHeader: AdminHeaderState = {
  title: 'Area de Administracion',
};

const AdminHeaderContext = React.createContext<AdminHeaderContextValue | null>(null);

export const useAdminHeader = (): AdminHeaderContextValue => {
  const context = useContext(AdminHeaderContext);
  if (!context) {
    throw new Error('useAdminHeader must be used within AdminLayout.');
  }
  return context;
};

const AdminLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [header, setHeader] = useState<AdminHeaderState>(defaultHeader);
  const location = useLocation();

  const menuItems = [
    {
      title: 'Analitica',
      items: [{ name: 'Dashboards', path: '/admin/dashboards', icon: BarChart3 }],
    },
    {
      title: 'Personal',
      items: [
        { name: 'Trabajadores', path: '/admin/workers', icon: Users },
        { name: 'Equipo de Administracion', path: '/admin/team', icon: Users },
        { name: 'Asistencia', path: '/admin/assistance', icon: Calendar },
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
        { name: 'Config. Modulo/panel', path: '/admin/house-config', icon: Home },
        { name: 'Parametros', path: '/admin/house-params', icon: Settings },
      ],
    },
    {
      title: 'Configuracion',
      items: [
        { name: 'Estaciones', path: '/admin/stations', icon: Settings },
        { name: 'Tareas', path: '/admin/task-defs', icon: ClipboardList },
        { name: 'Pausas', path: '/admin/pause-defs', icon: Settings },
        { name: 'Comentarios', path: '/admin/note-defs', icon: FileText },
        { name: 'Respaldos', path: '/admin/backups', icon: Database },
      ],
    },
    {
      title: 'Calidad',
      items: [{ name: 'Revisiones de QC', path: '/admin/qc-checks', icon: CheckSquare }],
    },
  ];

  return (
    <AdminHeaderContext.Provider value={{ header, setHeader }}>
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
                <div className="rounded-full border border-black/10 px-3 py-1 text-xs text-[var(--ink-muted)]">
                  Turno: Dia
                </div>
                <div className="text-sm text-[var(--ink)]">Usuario Admin</div>
              </div>
            </header>
            <main className="flex-1 overflow-auto px-6 py-8">
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </AdminHeaderContext.Provider>
  );
};

export default AdminLayout;
