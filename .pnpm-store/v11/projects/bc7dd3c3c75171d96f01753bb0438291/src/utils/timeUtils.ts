const fallbackValue = <T,>(value: T | null | undefined, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number' && Number.isNaN(value)) return fallback;
  return value;
};

type FormatOptions = {
  fallback?: string;
  preserveInvalid?: boolean;
  decimals?: number;
  unit?: string;
};

export const toFiniteNumber = (val: unknown): number | null => {
  if (val === null || val === undefined) return null;
  const num = typeof val === 'string' ? parseFloat(val) : Number(val);
  return Number.isFinite(num) ? num : null;
};

export const toTs = (value: unknown): number | null => {
  if (!value) return null;
  try {
    const raw = typeof value === 'string' ? value.replace(' ', 'T') : String(value);
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  } catch {
    return null;
  }
};

export const formatDateTime = (value: unknown, options?: FormatOptions): string => {
  const fallback = options?.fallback ?? '-';
  const normalized = fallbackValue(value, null);
  if (normalized === null) return fallback;
  try {
    const iso = String(normalized).includes('T')
      ? String(normalized)
      : String(normalized).replace(' ', 'T');
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      if (options?.preserveInvalid) return String(normalized);
      return typeof normalized === 'string' ? normalized : fallback;
    }
    return date.toLocaleString();
  } catch {
    if (options?.preserveInvalid) return String(normalized);
    return typeof normalized === 'string' ? normalized : fallback;
  }
};

export const formatDateTimeShort = (value: unknown, options?: FormatOptions): string => {
  const fallback = options?.fallback ?? '-';
  const normalized = fallbackValue(value, null);
  if (normalized === null) return fallback;
  try {
    const iso = String(normalized).includes('T')
      ? String(normalized)
      : String(normalized).replace(' ', 'T');
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return options?.preserveInvalid ? String(normalized) : fallback;
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${mi}`;
  } catch {
    return options?.preserveInvalid ? String(normalized) : fallback;
  }
};

export const formatGapDuration = (millis: number, options?: FormatOptions): string => {
  const fallback = options?.fallback ?? '-';
  if (!Number.isFinite(millis)) return fallback;
  const negative = millis < 0;
  const abs = Math.abs(millis);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1_000);

  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!hours && !minutes) parts.push(`${seconds}s`);
  if (hours || minutes) parts.push(`${seconds}s`);

  const body = parts.length ? parts.join(' ') : '0s';
  return negative ? `-${body}` : body;
};

export const formatMinutesDetailed = (minutes: unknown, options?: FormatOptions): string => {
  const fallback = options?.fallback ?? '-';
  const value = toFiniteNumber(minutes);
  if (value === null) return fallback;
  return formatGapDuration(Math.round(value * 60_000), options);
};

export const formatMinutesShort = (minutes: unknown, showSign = false, options?: FormatOptions): string => {
  const fallback = options?.fallback ?? '-';
  const value = toFiniteNumber(minutes);
  if (value === null) return fallback;
  const sign = value < 0 ? '-' : showSign && value > 0 ? '+' : '';
  const abs = Math.abs(value);

  if (abs >= 60) {
    const hours = Math.floor(abs / 60);
    const remainder = abs - hours * 60;
    const roundedMinutes = Math.round(remainder);
    return `${sign}${hours}h${roundedMinutes ? ` ${roundedMinutes}m` : ''}`;
  }
  if (abs >= 10) {
    return `${sign}${Math.round(abs)}m`;
  }
  const rounded = Math.round(abs * 10) / 10;
  const decimals = rounded % 1 === 0 ? 0 : 1;
  return `${sign}${rounded.toFixed(decimals)}m`;
};

export const formatMinutesWithUnit = (minutes: unknown, options?: FormatOptions): string => {
  const fallback = options?.fallback ?? '-';
  const value = toFiniteNumber(minutes);
  if (value === null) return fallback;
  const decimals = options?.decimals ?? 2;
  const unit = options?.unit ?? 'min';
  return `${value.toFixed(decimals)} ${unit}`;
};
