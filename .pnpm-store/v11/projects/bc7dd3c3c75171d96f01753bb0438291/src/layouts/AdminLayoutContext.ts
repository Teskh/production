import React, { useContext } from 'react';

export type AdminHeaderState = {
  title: string;
  kicker?: string;
};

export type AdminHeaderContextValue = {
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

export type AdminPagePermissionRole = {
  role: string;
  can_view: boolean;
  can_edit: boolean;
};

export type AdminPagePermission = {
  page_id: string;
  permissions: AdminPagePermissionRole[];
};

export type AdminPagePermissionMap = Record<string, AdminPagePermissionRole[]>;

export type AdminPageAccessContextValue = {
  pageId: string | null;
  canEdit: boolean;
};

export const AdminHeaderContext = React.createContext<AdminHeaderContextValue | null>(null);
export const AdminSessionContext = React.createContext<AdminSession | null>(null);
export const AdminPageAccessContext = React.createContext<AdminPageAccessContextValue>({
  pageId: null,
  canEdit: true,
});

export const READ_ONLY_ADMIN_PAGE_MESSAGE = 'Tienes acceso de solo lectura en esta pagina.';

export const assertAdminPageMutationAllowed = (
  canEdit: boolean,
  options: RequestInit = {},
): void => {
  const method = (options.method ?? 'GET').toUpperCase();
  if (!canEdit && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    throw new Error(READ_ONLY_ADMIN_PAGE_MESSAGE);
  }
};

export const useAdminHeader = (): AdminHeaderContextValue => {
  const context = useContext(AdminHeaderContext);
  if (!context) {
    throw new Error('useAdminHeader must be used within AdminLayout.');
  }
  return context;
};

export const useOptionalAdminHeader = (): AdminHeaderContextValue | null => {
  return useContext(AdminHeaderContext);
};

export const useAdminSession = (): AdminSession => {
  const context = useContext(AdminSessionContext);
  if (!context) {
    throw new Error('useAdminSession must be used within AdminLayout.');
  }
  return context;
};

export const useAdminPageAccess = (): AdminPageAccessContextValue => {
  return useContext(AdminPageAccessContext);
};

export const isSysadminUser = (
  admin: Pick<AdminSession, 'first_name' | 'last_name'> & Partial<Pick<AdminSession, 'role'>>
): boolean =>
  admin.role?.trim() === 'SysAdmin' ||
  (admin.first_name.trim().toLowerCase() === 'sysadmin' &&
    admin.last_name.trim().toLowerCase() === 'sysadmin');

export const pagePermissionsToMap = (
  permissions: AdminPagePermission[],
): AdminPagePermissionMap =>
  permissions.reduce<AdminPagePermissionMap>((acc, permission) => {
    acc[permission.page_id] = permission.permissions;
    return acc;
  }, {});

export const canViewAdminPage = (
  admin: AdminSession,
  pageId: string,
  permissions: AdminPagePermissionMap,
): boolean => {
  if (isSysadminUser(admin)) {
    return true;
  }
  const pagePermissions = permissions[pageId];
  if (!pagePermissions) {
    return true;
  }
  const rolePermission = pagePermissions.find(
    (permission) => permission.role.trim() === admin.role.trim(),
  );
  return rolePermission?.can_view ?? false;
};

export const canEditAdminPage = (
  admin: AdminSession,
  pageId: string | null,
  permissions: AdminPagePermissionMap,
): boolean => {
  if (!pageId || isSysadminUser(admin)) {
    return true;
  }
  const pagePermissions = permissions[pageId];
  if (!pagePermissions) {
    return true;
  }
  const rolePermission = pagePermissions.find(
    (permission) => permission.role.trim() === admin.role.trim(),
  );
  return Boolean(rolePermission?.can_view && rolePermission.can_edit);
};

export const canManageProductionQueue = (
  admin: Pick<AdminSession, 'first_name' | 'last_name' | 'role'>
): boolean => {
  const normalizedRole = admin.role.trim().toLowerCase();
  return (
    isSysadminUser(admin) || normalizedRole === 'admin' || normalizedRole === 'mc senior'
  );
};
