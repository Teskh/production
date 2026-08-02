import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  Eye,
  Gauge,
  LockKeyhole,
  Save,
  Star,
  TrendingDown,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { isSysadminUser } from '../../layouts/AdminLayoutContext';
import { useOptionalQCSession } from '../../layouts/QCLayoutContext';
import {
  canViewDashboard,
  dashboardApiRequest,
  type DashboardPermission,
  permissionsToMap,
} from '../admin/dashboards/dashboardVisibility';

type DashboardCard = {
  id: string;
  name: string;
  description: string;
  path: string;
  tags: string[];
  icon: React.ElementType;
};

type DashboardPermissionUpdate = {
  roles: string[];
};

const dashboards: DashboardCard[] = [
  {
    id: 'qc-quality-compliance',
    name: 'Cumplimiento de controles',
    description:
      'Revisa checks disparados sin ejecución y casos que continúan abiertos por módulo y rango de fechas.',
    path: '/qc/dashboards/quality-compliance',
    tags: ['Checks', 'Observaciones', 'Módulos'],
    icon: Gauge,
  },
  {
    id: 'qc-failure-analysis',
    name: 'Análisis de fallas',
    description:
      'Compara tareas, estaciones y controles por volumen de fallas y tasa sobre inspecciones ejecutadas.',
    path: '/qc/dashboards/failure-analysis',
    tags: ['Fallas', 'Tareas', 'Estaciones'],
    icon: TrendingDown,
  },
];

const FAVORITES_KEY = 'qc.dashboards.favorites';

const getStoredFavorites = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
};

const QCDashboards: React.FC = () => {
  const qcSession = useOptionalQCSession();
  const [favorites, setFavorites] = useState<string[]>(getStoredFavorites);
  const [permissions, setPermissions] = useState<DashboardPermission[]>([]);
  const [roleOptions, setRoleOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(qcSession));
  const [error, setError] = useState<string | null>(null);
  const [permissionDialogId, setPermissionDialogId] = useState<string | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const permissionMap = useMemo(() => permissionsToMap(permissions), [permissions]);
  const isSysadmin = Boolean(qcSession && isSysadminUser(qcSession));
  const selectedDashboard = dashboards.find((item) => item.id === permissionDialogId) ?? null;

  useEffect(() => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (!qcSession) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      dashboardApiRequest<DashboardPermission[]>('/api/admin/dashboard-permissions'),
      dashboardApiRequest<string[]>('/api/admin/roles'),
    ])
      .then(([nextPermissions, nextRoles]) => {
        if (!active) return;
        setPermissions(nextPermissions);
        setRoleOptions(nextRoles);
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'No se pudo cargar la visibilidad de dashboards.',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [qcSession]);

  const visibleDashboards = useMemo(
    () =>
      qcSession
        ? dashboards.filter((dashboard) =>
            canViewDashboard(qcSession, dashboard.id, permissionMap),
          )
        : [],
    [permissionMap, qcSession],
  );
  const orderedDashboards = useMemo(
    () =>
      [...visibleDashboards].sort(
        (left, right) =>
          Number(favorites.includes(right.id)) - Number(favorites.includes(left.id)),
      ),
    [favorites, visibleDashboards],
  );

  const toggleFavorite = (id: string) => {
    setFavorites((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const openPermissionDialog = (dashboard: DashboardCard) => {
    setPermissionDialogId(dashboard.id);
    setPermissionDraft(permissionMap[dashboard.id] ?? roleOptions);
    setError(null);
  };

  const togglePermissionRole = (role: string) => {
    setPermissionDraft((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role],
    );
  };

  const savePermissions = async () => {
    if (!permissionDialogId) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await dashboardApiRequest<DashboardPermissionUpdate>(
        `/api/admin/dashboard-permissions/${encodeURIComponent(permissionDialogId)}`,
        { method: 'PUT', body: JSON.stringify({ roles: permissionDraft }) },
      );
      setPermissions((current) => [
        ...current.filter((item) => item.dashboard_id !== permissionDialogId),
        { dashboard_id: permissionDialogId, roles: updated.roles },
      ]);
      setPermissionDialogId(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'No se pudieron guardar los permisos.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="qc-page qc-dashboard-catalog space-y-5">
      <header className="qc-page__header">
        <div>
          <p className="qc-page__eyebrow">Control de calidad</p>
          <h2 className="qc-page__title">Dashboards</h2>
          <p className="qc-page__intro">
            Accesos a indicadores de calidad. Los favoritos quedan fijados primero en este equipo.
          </p>
        </div>
        <div className="qc-dashboard-count">
          <BarChart3 className="h-5 w-5" />
          <strong>{visibleDashboards.length}</strong>
          <span>disponibles</span>
        </div>
      </header>

      {!qcSession && (
        <section className="qc-card border-l-4 border-l-[#002FA7] p-5">
          <div className="flex items-start gap-3">
            <LockKeyhole className="mt-0.5 h-5 w-5 text-[#002FA7]" />
            <div>
              <h3 className="font-semibold">Inicia sesión para ver los dashboards disponibles</h3>
              <p className="mt-1 text-sm text-[var(--qc-muted)]">
                La visibilidad se administra por rol desde este catálogo.
              </p>
              <Link
                to="/qc/dashboards"
                state={{ qcLogin: true }}
                className="qc-btn qc-btn--primary mt-4"
              >
                Iniciar sesión
              </Link>
            </div>
          </div>
        </section>
      )}

      {loading && <div className="qc-notice">Cargando visibilidad de dashboards…</div>}
      {error && !permissionDialogId && <div className="qc-notice qc-notice--error">{error}</div>}

      {qcSession && !loading && orderedDashboards.length === 0 && (
        <div className="qc-card p-6 text-sm text-[var(--qc-muted)]">
          Tu rol no tiene dashboards de calidad habilitados.
        </div>
      )}

      <div className="grid gap-px bg-[var(--qc-line)] md:grid-cols-2">
        {orderedDashboards.map((dashboard, index) => {
          const favorite = favorites.includes(dashboard.id);
          return (
            <article key={dashboard.id} className="qc-dashboard-card relative isolate bg-white p-5">
              <Link
                to={dashboard.path}
                className="qc-dashboard-card__link-overlay"
                aria-label={`Abrir dashboard ${dashboard.name}`}
              />
              <div className="flex items-start justify-between gap-4">
                <div className="qc-dashboard-card__index">{String(index + 1).padStart(2, '0')}</div>
                <div className="relative z-10 flex gap-2">
                  {isSysadmin && (
                    <button
                      type="button"
                      onClick={() => openPermissionDialog(dashboard)}
                      className="qc-dashboard-icon-button"
                      aria-label={`Configurar visibilidad de ${dashboard.name}`}
                      title="Configurar visibilidad"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleFavorite(dashboard.id)}
                    className="qc-dashboard-icon-button"
                    aria-label={favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  >
                    <Star className={`h-4 w-4 ${favorite ? 'fill-[#002FA7] text-[#002FA7]' : ''}`} />
                  </button>
                </div>
              </div>
              <dashboard.icon className="mt-7 h-7 w-7 text-[#002FA7]" />
              <h3 className="mt-3 text-xl font-semibold">{dashboard.name}</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--qc-muted)]">
                {dashboard.description}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {dashboard.tags.map((tag) => (
                  <span key={tag} className="qc-dashboard-tag">{tag}</span>
                ))}
              </div>
              <Link to={dashboard.path} className="qc-dashboard-open relative z-10 mt-6">
                Abrir dashboard
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </article>
          );
        })}
      </div>

      {selectedDashboard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md border border-[var(--qc-line)] bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--qc-line)] pb-4">
              <div>
                <p className="qc-page__eyebrow">Visibilidad</p>
                <h2 className="mt-1 text-lg font-semibold">{selectedDashboard.name}</h2>
              </div>
              <button type="button" onClick={() => setPermissionDialogId(null)} className="qc-dashboard-icon-button" aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {roleOptions.map((role) => (
                <label key={role} className="flex items-center justify-between border border-[var(--qc-line)] px-3 py-2 text-sm">
                  <span>{role}</span>
                  <input type="checkbox" checked={permissionDraft.includes(role)} onChange={() => togglePermissionRole(role)} className="h-4 w-4 accent-[#002FA7]" />
                </label>
              ))}
            </div>
            {error && <div className="qc-notice qc-notice--error mt-4">{error}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPermissionDialogId(null)} className="qc-btn">Cancelar</button>
              <button type="button" onClick={savePermissions} disabled={saving} className="qc-btn qc-btn--primary">
                <Save className="h-4 w-4" />
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QCDashboards;
