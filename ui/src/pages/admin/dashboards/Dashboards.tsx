import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  ClipboardList,
  Clock,
  History,
  MapPin,
  Ruler,
  Star,
  Timer,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { isSysadminUser, useAdminHeader, useAdminSession } from '../../../layouts/AdminLayoutContext';

type DashboardCard = {
  id: string;
  name: string;
  description: string;
  path: string;
  status: 'ready' | 'planned';
  tags: string[];
  icon: React.ElementType;
  sysadminOnly?: boolean;
};

const dashboards: DashboardCard[] = [
  {
    id: 'plant-view',
    name: 'Vista de planta',
    description:
      'Mapa vivo del turno con estaciones, operarios y timeline interactivo.',
    path: '/admin/dashboards/plant-view',
    status: 'ready',
    tags: ['Planta', 'Tiempo', 'Operarios'],
    icon: MapPin,
    sysadminOnly: true,
  },
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
  {
    id: 'performance-rum',
    name: 'Performance (RUM)',
    description:
      'Monitorea p50/p95 de carga y APIs por dispositivo real desplegado.',
    path: '/admin/dashboards/performance',
    status: 'ready',
    tags: ['Rendimiento', 'Dispositivos', 'Latencia'],
    icon: Activity,
    sysadminOnly: true,
  },
  {
    id: 'assistance-activity',
    name: 'Asistencias y actividad',
    description:
      'Consulta marcajes de GeoVictoria y actividad registrada por trabajador.',
    path: '/admin/dashboards/assistance',
    status: 'ready',
    tags: ['Personal', 'GeoVictoria', 'Actividad'],
    icon: Clock,
    sysadminOnly: true,
  },
];

const FAVORITES_KEY = 'admin.dashboards.favorites';
const getStoredFavorites = (): string[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(FAVORITES_KEY);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
};

const Dashboards: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const admin = useAdminSession();
  const [favorites, setFavorites] = useState<string[]>(getStoredFavorites);
  const isSysadmin = isSysadminUser(admin);

  useEffect(() => {
    setHeader({
      title: 'Dashboards',
      kicker: 'Analitica',
    });
  }, [setHeader]);

  useEffect(() => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  const visibleDashboards = useMemo(
    () => dashboards.filter((dashboard) => !dashboard.sysadminOnly || isSysadmin),
    [isSysadmin],
  );

  const favoriteDashboards = useMemo(
    () => visibleDashboards.filter((dashboard) => favorites.includes(dashboard.id)),
    [favorites, visibleDashboards],
  );

  const nonFavoriteDashboards = useMemo(
    () => visibleDashboards.filter((dashboard) => !favorites.includes(dashboard.id)),
    [favorites, visibleDashboards],
  );

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => (prev.includes(id) ? prev.filter((fav) => fav !== id) : [...prev, id]));
  };

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
            {visibleDashboards.length} dashboards disponibles
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/80 px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Favoritos</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[var(--accent-soft)] bg-white/80 px-4 py-2 text-xs text-[var(--ink)]">
            <Star className="h-4 w-4 text-[var(--accent)]" />
            {favoriteDashboards.length} favoritos
          </div>
        </div>
        {favoriteDashboards.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-black/10 bg-white/70 px-5 py-6 text-sm text-[var(--ink-muted)]">
            Aun no tienes favoritos. Marca un dashboard con la estrella para fijarlo aqui.
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {favoriteDashboards.map((dashboard, index) => (
              <div
                key={dashboard.id}
                className="group rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm transition hover:-translate-y-1 hover:border-black/10"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                    <dashboard.icon className="h-5 w-5" />
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleFavorite(dashboard.id)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white text-[var(--accent)] transition hover:border-black/20"
                    aria-label="Quitar de favoritos"
                  >
                    <Star className="h-4 w-4 fill-[var(--accent)]" />
                  </button>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-[var(--ink)]">{dashboard.name}</h3>
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
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {nonFavoriteDashboards.map((dashboard, index) => (
          <div
            key={dashboard.id}
            className="group rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm transition hover:-translate-y-1 hover:border-black/10"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <dashboard.icon className="h-5 w-5" />
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={
                    dashboard.status === 'ready'
                      ? 'rounded-full bg-[var(--leaf)]/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--leaf)]'
                      : 'rounded-full bg-black/5 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]'
                  }
                >
                  {dashboard.status === 'ready' ? 'Disponible' : 'Planeado'}
                </span>
                <button
                  type="button"
                  onClick={() => toggleFavorite(dashboard.id)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white text-[var(--ink-muted)] transition hover:border-black/20 hover:text-[var(--accent)]"
                  aria-label="Agregar a favoritos"
                >
                  <Star className="h-4 w-4" />
                </button>
              </div>
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
