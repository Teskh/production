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

export const AdminHeaderContext = React.createContext<AdminHeaderContextValue | null>(null);
export const AdminSessionContext = React.createContext<AdminSession | null>(null);

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

export const isSysadminUser = (admin: Pick<AdminSession, 'first_name' | 'last_name'>): boolean =>
  admin.first_name.trim().toLowerCase() === 'sysadmin' &&
  admin.last_name.trim().toLowerCase() === 'sysadmin';
