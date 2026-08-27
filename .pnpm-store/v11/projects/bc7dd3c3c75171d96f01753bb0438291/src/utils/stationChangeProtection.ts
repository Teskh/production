export const STATION_CHANGE_PROTECTION_ENABLED_STORAGE_KEY =
  'station_change_protection_enabled';
export const STATION_CHANGE_AUTH_EXPIRES_AT_STORAGE_KEY =
  'station_change_auth_expires_at';
export const STATION_CHANGE_AUTH_WINDOW_MS = 60_000;

export const readStationChangeProtectionEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return true;
  }
  const stored = window.localStorage.getItem(
    STATION_CHANGE_PROTECTION_ENABLED_STORAGE_KEY
  );
  if (stored === null) {
    return true;
  }
  return stored === 'true';
};

export const writeStationChangeProtectionEnabled = (enabled: boolean): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(
    STATION_CHANGE_PROTECTION_ENABLED_STORAGE_KEY,
    String(enabled)
  );
};

export const readStationChangeAuthExpiresAt = (): number | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const stored = window.localStorage.getItem(
    STATION_CHANGE_AUTH_EXPIRES_AT_STORAGE_KEY
  );
  if (!stored) {
    return null;
  }
  const parsed = Number(stored);
  if (!Number.isFinite(parsed) || parsed <= Date.now()) {
    window.localStorage.removeItem(STATION_CHANGE_AUTH_EXPIRES_AT_STORAGE_KEY);
    return null;
  }
  return parsed;
};

export const writeStationChangeAuthExpiresAt = (expiresAt: number | null): void => {
  if (typeof window === 'undefined') {
    return;
  }
  if (expiresAt === null) {
    window.localStorage.removeItem(STATION_CHANGE_AUTH_EXPIRES_AT_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    STATION_CHANGE_AUTH_EXPIRES_AT_STORAGE_KEY,
    String(expiresAt)
  );
};

export const isStationChangeAuthUnlocked = (): boolean => {
  const expiresAt = readStationChangeAuthExpiresAt();
  return expiresAt !== null && expiresAt > Date.now();
};
