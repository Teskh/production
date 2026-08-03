const MIGRATION_HASH_KEY = 'legacy-tablet';

const validators: Record<string, (value: string) => boolean> = {
  selectedStationContext: (value) =>
    /^(station:\d+|panel_line|aux|assembly_sequence:\d+)$/.test(value),
  selectedSpecificStationId: (value) => /^\d+$/.test(value),
  login_qr_scanning_enabled: (value) => value === 'true' || value === 'false',
  station_change_protection_enabled: (value) => value === 'true' || value === 'false',
  panel_daily_goal: (value) => /^\d{0,6}$/.test(value),
};

export const importLegacyTabletSettings = (): void => {
  if (!window.location.hash.startsWith('#')) return;

  const params = new URLSearchParams(window.location.hash.slice(1));
  const serialized = params.get(MIGRATION_HASH_KEY);
  if (!serialized) return;

  try {
    const values: unknown = JSON.parse(serialized);
    if (values && typeof values === 'object' && !Array.isArray(values)) {
      Object.entries(values).forEach(([key, rawValue]) => {
        const validator = validators[key];
        if (validator && typeof rawValue === 'string' && validator(rawValue)) {
          window.localStorage.setItem(key, rawValue);
        }
      });
    }
  } catch {
    // Invalid migration payloads are ignored and removed from the address bar.
  }

  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
};
