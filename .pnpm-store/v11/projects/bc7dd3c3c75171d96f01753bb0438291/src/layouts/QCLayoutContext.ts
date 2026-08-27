import React, { useContext } from 'react';

export type AdminSession = {
  id: number;
  first_name: string;
  last_name: string;
  role: string;
  active: boolean;
};

export type QCLayoutStatus = {
  refreshIntervalMs?: number;
  lastUpdated?: Date;
};

export const QCSessionContext = React.createContext<AdminSession | null>(null);
export const QCLayoutStatusContext = React.createContext<{
  status: QCLayoutStatus;
  setStatus: React.Dispatch<React.SetStateAction<QCLayoutStatus>>;
} | null>(null);

export const useQCSession = (): AdminSession => {
  const context = useContext(QCSessionContext);
  if (!context) {
    throw new Error('useQCSession must be used within QCLayout.');
  }
  return context;
};

export const useOptionalQCSession = (): AdminSession | null => {
  return useContext(QCSessionContext);
};

export const useQCLayoutStatus = () => {
  const context = useContext(QCLayoutStatusContext);
  if (!context) {
    throw new Error('useQCLayoutStatus must be used within QCLayout.');
  }
  return context;
};
