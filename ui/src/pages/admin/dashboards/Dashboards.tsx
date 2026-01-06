import React, { useEffect } from 'react';
import { ArrowUpRight, BarChart3, ClipboardList, History, Ruler, Timer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAdminHeader } from '../../../layouts/AdminLayout';

type DashboardCard = {
  id: string;
  name: string;
  description: string;
  path: string;
  status: 'ready' | 'planned';
  tags: string[];
  icon: React.ElementType;
};

const dashboards: DashboardCard[] = [
  {
    id: 'panel-linear-meters',
    name: 'Metros lineales por panel',
    description:
      'Mide tiempos promedio por estacion y el rendimiento en ML/min por tipo de panel.',
    path: '/admin/dashboards/panels',
    status: 'ready',
    tags: ['Paneles', 'Estaciones', 'Pausas'],
    icon: Ruler,
  },
  {
    id: 'panel-production-history',
    name: 'Historico produccion paneles',
    description:
      'Consulta tareas terminadas, pausas y responsables por estacion y panel.',
    path: '/admin/dashboards/stations',
    status: 'ready',
    tags: ['Paneles', 'Estaciones', 'Historico'],
    icon: History,
  },
  {
    id: 'panel-analysis',
    name: 'Paneles finalizados por estacion',
    description:
      'Mide duraciones, pausas y tiempos ociosos para paneles que pasan por una estacion.',
    path: '/admin/dashboards/panel-analysis',
    status: 'ready',
    tags: ['Paneles', 'Estaciones', 'Tiempo'],
    icon: ClipboardList,
  },
  {
    id: 'tasks-analysis',
    name: 'Analisis de tiempos de tareas',
    description:
      'Explora duraciones reales vs esperadas por panel, estacion, tarea y trabajador.',
    path: '/admin/dashboards/tasks',
    status: 'ready',
    tags: ['Paneles', 'Estaciones', 'Tareas'],
    icon: Timer,
  },
];

const Dashboards: React.FC = () => {
  const { setHeader } = useAdminHeader();

  useEffect(() => {
    setHeader({
      title: 'Dashboards',
      kicker: 'Analitica',
    });
  }, [setHeader]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-black/5 bg-white/80 shadow-sm px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Panel de control</p>
            <h1 className="font-display text-xl text-[var(--ink)]">Catalogo de dashboards</h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Elige un tablero para profundizar en metricas operativas. Agrega nuevos paneles aqui
              a medida que se habiliten.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[var(--accent-soft)] bg-white/80 px-4 py-2 text-xs text-[var(--ink)]">
            <BarChart3 className="h-4 w-4 text-[var(--accent)]" />
            {dashboards.length} dashboards disponibles
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {dashboards.map((dashboard, index) => (
          <div
            key={dashboard.id}
            className="group rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm transition hover:-translate-y-1 hover:border-black/10"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <dashboard.icon className="h-5 w-5" />
              </div>
              <span
                className={
                  dashboard.status === 'ready'
                    ? 'rounded-full bg-[var(--leaf)]/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--leaf)]'
                    : 'rounded-full bg-black/5 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]'
                }
              >
                {dashboard.status === 'ready' ? 'Disponible' : 'Planeado'}
              </span>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-[var(--ink)]">{dashboard.name}</h2>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">{dashboard.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {dashboard.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-[11px] uppercase tracking-[0.15em] text-[var(--ink-muted)]"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="mt-5">
              {dashboard.status === 'ready' ? (
                <Link
                  to={dashboard.path}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-black"
                >
                  Abrir dashboard
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]"
                  disabled
                >
                  En camino
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Dashboards;
