import type { AdminSession } from '../../../layouts/AdminLayoutContext';
import { isSysadminUser } from '../../../layouts/AdminLayoutContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export type DashboardPermission = {
  dashboard_id: string;
  roles: string[];
};

export type DashboardPermissionMap = Record<string, string[]>;

const buildHeaders = (options: RequestInit): Headers => {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
};

export const dashboardApiRequest = async <T,>(
  path: string,
  options: RequestInit = {},
): Promise<T> => {
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

export const permissionsToMap = (
  permissions: DashboardPermission[],
): DashboardPermissionMap =>
  permissions.reduce<DashboardPermissionMap>((acc, permission) => {
    acc[permission.dashboard_id] = permission.roles;
    return acc;
  }, {});

export const canViewDashboard = (
  admin: AdminSession,
  dashboardId: string,
  permissions: DashboardPermissionMap,
): boolean => {
  if (isSysadminUser(admin)) {
    return true;
  }

  const roles = permissions[dashboardId];
  if (!roles) {
    return true;
  }

  return roles.includes(admin.role.trim());
};
