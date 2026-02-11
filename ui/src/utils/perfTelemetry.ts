const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const PERF_ENDPOINT = `${API_BASE_URL}/api/performance/events`;
const PERF_ENABLED = (import.meta.env.VITE_PERF_TELEMETRY_ENABLED ?? 'true') !== 'false';
const PERF_SAMPLE_RATE = clampSampleRate(
  Number(import.meta.env.VITE_PERF_SAMPLE_RATE ?? '0.1')
);
const PERF_BATCH_SIZE = clampInt(Number(import.meta.env.VITE_PERF_BATCH_SIZE ?? '20'), 1, 200);
const PERF_FLUSH_INTERVAL_MS = clampInt(
  Number(import.meta.env.VITE_PERF_FLUSH_INTERVAL_MS ?? '15000'),
  1000,
  60000
);
const PERF_QUEUE_LIMIT = 1000;
const DEVICE_ID_KEY = 'perf.device.id';
const SESSION_ID_KEY = 'perf.session.id';
const SESSION_SAMPLED_KEY = 'perf.session.sampled';

type PerfEventType = 'api_request' | 'page_load';

type QueuedPerfEvent = {
  type: PerfEventType;
  duration_ms: number;
  page_path?: string;
  api_path?: string;
  method?: string;
  server_duration_ms?: number;
  status_code?: number;
  ok?: boolean;
  request_id?: string;
  device_id: string;
  device_name?: string;
  app_version?: string;
  session_id: string;
  sampled: boolean;
  recorded_at: string;
};

type IngestPayload = {
  events: QueuedPerfEvent[];
};

export type ApiPerfMetric = {
  pagePath?: string;
  apiPath: string;
  method: string;
  durationMs: number;
  serverDurationMs?: number | null;
  statusCode?: number | null;
  ok: boolean;
  requestId?: string;
};

export type PagePerfMetric = {
  pagePath: string;
  durationMs: number;
  ok: boolean;
};

const queue: QueuedPerfEvent[] = [];
let flushTimer: number | null = null;
let lifecycleBound = false;
let sampledSession: boolean | null = null;

function clampSampleRate(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.1;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

export const createRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

const cleanPath = (value: string | undefined, maxLength = 255): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, maxLength);
};

const cleanText = (value: string | undefined, maxLength: number): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, maxLength);
};

const getFromStorage = (
  storage: Storage | undefined,
  key: string
): string | null => {
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const setInStorage = (storage: Storage | undefined, key: string, value: string): void => {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage write failures.
  }
};

const getDeviceId = (): string => {
  if (typeof window === 'undefined') {
    return 'server';
  }
  const stored = getFromStorage(window.localStorage, DEVICE_ID_KEY);
  if (stored) {
    return stored;
  }
  const generated = createRequestId();
  setInStorage(window.localStorage, DEVICE_ID_KEY, generated);
  return generated;
};

const getSessionId = (): string => {
  if (typeof window === 'undefined') {
    return 'server';
  }
  const stored = getFromStorage(window.sessionStorage, SESSION_ID_KEY);
  if (stored) {
    return stored;
  }
  const generated = createRequestId();
  setInStorage(window.sessionStorage, SESSION_ID_KEY, generated);
  return generated;
};

const getSampledSession = (): boolean => {
  if (!PERF_ENABLED || PERF_SAMPLE_RATE <= 0) {
    return false;
  }
  if (sampledSession !== null) {
    return sampledSession;
  }
  if (typeof window === 'undefined') {
    sampledSession = false;
    return sampledSession;
  }
  const stored = getFromStorage(window.sessionStorage, SESSION_SAMPLED_KEY);
  if (stored === '1') {
    sampledSession = true;
    return sampledSession;
  }
  if (stored === '0') {
    sampledSession = false;
    return sampledSession;
  }
  sampledSession = Math.random() < PERF_SAMPLE_RATE;
  setInStorage(window.sessionStorage, SESSION_SAMPLED_KEY, sampledSession ? '1' : '0');
  return sampledSession;
};

const getDeviceName = (): string | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const host = cleanText(window.location.hostname || window.location.host, 60);
  const platform = cleanText(window.navigator.platform, 50);
  const combined = [host, platform].filter(Boolean).join(' / ');
  return cleanText(combined, 120);
};

function isFiniteDuration(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 120000;
}

async function postEvents(events: QueuedPerfEvent[], useBeacon: boolean): Promise<boolean> {
  if (events.length === 0) {
    return true;
  }
  const payload: IngestPayload = { events };
  const body = JSON.stringify(payload);
  if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const sent = navigator.sendBeacon(
      PERF_ENDPOINT,
      new Blob([body], { type: 'application/json' })
    );
    if (sent) {
      return true;
    }
  }
  try {
    const response = await fetch(PERF_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: useBeacon,
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function flushQueue(useBeacon: boolean): Promise<void> {
  if (queue.length === 0) {
    return;
  }
  const batch = queue.splice(0, PERF_BATCH_SIZE);
  const ok = await postEvents(batch, useBeacon);
  if (!ok) {
    queue.unshift(...batch);
    if (queue.length > PERF_QUEUE_LIMIT) {
      queue.splice(PERF_QUEUE_LIMIT);
    }
    return;
  }
  if (queue.length > 0 && !useBeacon) {
    scheduleFlush();
  }
}

function scheduleFlush(): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (flushTimer !== null) {
    return;
  }
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushQueue(false);
  }, PERF_FLUSH_INTERVAL_MS);
}

function bindLifecycleHandlers(): void {
  if (lifecycleBound || typeof window === 'undefined') {
    return;
  }
  lifecycleBound = true;
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushQueue(true);
    }
  });
  window.addEventListener('beforeunload', () => {
    void flushQueue(true);
  });
}

function enqueueEvent(event: Omit<QueuedPerfEvent, 'device_id' | 'device_name' | 'session_id'>): void {
  if (!getSampledSession()) {
    return;
  }
  if (queue.length >= PERF_QUEUE_LIMIT) {
    queue.shift();
  }
  queue.push({
    ...event,
    device_id: getDeviceId(),
    device_name: getDeviceName(),
    session_id: getSessionId(),
  });
  bindLifecycleHandlers();
  if (queue.length >= PERF_BATCH_SIZE) {
    void flushQueue(false);
    return;
  }
  scheduleFlush();
}

export const parseServerTimingDuration = (
  header: string | null,
  metricName = 'app'
): number | null => {
  if (!header) {
    return null;
  }
  const parts = header.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    if (!trimmed.startsWith(metricName)) {
      continue;
    }
    const match = trimmed.match(/dur=([0-9.]+)/);
    if (!match) {
      continue;
    }
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

export const trackApiPerformance = (metric: ApiPerfMetric): void => {
  if (!isFiniteDuration(metric.durationMs)) {
    return;
  }
  const serverDuration = metric.serverDurationMs;
  enqueueEvent({
    type: 'api_request',
    duration_ms: Number(metric.durationMs.toFixed(2)),
    page_path: cleanPath(metric.pagePath),
    api_path: cleanPath(metric.apiPath),
    method: cleanText(metric.method.toUpperCase(), 12),
    server_duration_ms:
      typeof serverDuration === 'number' && Number.isFinite(serverDuration)
        ? Number(serverDuration.toFixed(2))
        : undefined,
    status_code:
      typeof metric.statusCode === 'number' && Number.isFinite(metric.statusCode)
        ? metric.statusCode
        : undefined,
    ok: metric.ok,
    request_id: cleanText(metric.requestId, 64),
    app_version: cleanText(import.meta.env.VITE_APP_VERSION, 64),
    sampled: true,
    recorded_at: new Date().toISOString(),
  });
};

export const trackPageLoadPerformance = (metric: PagePerfMetric): void => {
  if (!isFiniteDuration(metric.durationMs)) {
    return;
  }
  enqueueEvent({
    type: 'page_load',
    duration_ms: Number(metric.durationMs.toFixed(2)),
    page_path: cleanPath(metric.pagePath),
    ok: metric.ok,
    app_version: cleanText(import.meta.env.VITE_APP_VERSION, 64),
    sampled: true,
    recorded_at: new Date().toISOString(),
  });
};
