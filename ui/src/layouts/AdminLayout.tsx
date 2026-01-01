import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  Users,
  Calendar,
  Settings,
  FileText,
  BarChart,
  Menu,
  X,
  Home,
  ClipboardList,
  CheckSquare,
  Layers,
  Sparkles,
  Database,
} from 'lucide-react';
import clsx from 'clsx';

const AdminLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();

  const menuItems = [
    {
      title: 'Personnel',
      items: [
        { name: 'Workers', path: '/admin/workers', icon: Users },
        { name: 'Specialties', path: '/admin/specialties', icon: Settings },
        { name: 'Admin Team', path: '/admin/team', icon: Users },
        { name: 'Assistance', path: '/admin/assistance', icon: Calendar },
      ],
    },
    {
      title: 'Planning & Production',
      items: [
        { name: 'Line Status', path: '/admin/line-status', icon: Home },
        { name: 'Production Queue', path: '/admin/production-queue', icon: Layers },
        { name: 'Panel History', path: '/admin/panel-history', icon: FileText },
        { name: 'Station Finished', path: '/admin/station-finished', icon: CheckSquare },
        { name: 'Task Analysis', path: '/admin/task-analysis', icon: BarChart },
        { name: 'Panel Meters', path: '/admin/panel-meters', icon: BarChart },
      ],
    },
    {
      title: 'Product Definition',
      items: [
        { name: 'House Configuration', path: '/admin/house-config', icon: Home },
        { name: 'House Params', path: '/admin/house-params', icon: Settings },
      ],
    },
    {
      title: 'Configuration',
      items: [
        { name: 'Stations', path: '/admin/stations', icon: Settings },
        { name: 'Task Definitions', path: '/admin/task-defs', icon: ClipboardList },
        { name: 'Pause Definitions', path: '/admin/pause-defs', icon: Settings },
        { name: 'Note Definitions', path: '/admin/note-defs', icon: FileText },
        { name: 'Backups', path: '/admin/backups', icon: Database },
      ],
    },
    {
      title: 'Quality',
      items: [{ name: 'QC Checks', path: '/admin/qc-checks', icon: CheckSquare }],
    },
  ];

  return (
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
                <p className="text-[11px] uppercase tracking-[0.3em] text-white/60">SCP Control</p>
                <h1 className="text-lg font-display tracking-wide">Admin Console</h1>
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
                          location.pathname === item.path
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
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(242,98,65,0.18)]">
                <Sparkles className="h-5 w-5 text-[var(--accent)]" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Admin Workspace
                </p>
                <h2 className="font-display text-lg text-[var(--ink)]">Operations Control</h2>
              </div>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-3">
              <div className="rounded-full border border-black/10 px-3 py-1 text-xs text-[var(--ink-muted)]">
                Shift: Day
              </div>
              <div className="text-sm text-[var(--ink)]">Admin User</div>
            </div>
          </header>
          <main className="flex-1 overflow-auto px-6 py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
};

export default AdminLayout;
