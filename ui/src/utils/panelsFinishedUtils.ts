import { toTs } from './timeUtils';

export type PanelsFinishedPause = {
  paused_at?: string | null;
  resumed_at?: string | null;
  duration_seconds?: number | null;
  reason?: string | null;
};

export type PanelsFinishedWorkerEntry = {
  worker_id?: number | null;
  worker_name?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  notes?: string | null;
  pauses?: PanelsFinishedPause[] | null;
};

export type PanelsFinishedTask = {
  task_definition_id?: number | null;
  task_name?: string | null;
  expected_minutes?: number | null;
  actual_minutes?: number | null;
  satisfied_at?: string | null;
  worker_entries?: PanelsFinishedWorkerEntry[] | null;
  panel_definition_id?: number | null;
  panel_code?: string | null;
  house_identifier?: string | null;
  module_number?: number | null;
  panel_area?: number | null;
  plan_id?: number | null;
};

export type PanelsFinishedPanel = {
  plan_id?: number | null;
  panel_definition_id?: number | null;
  panel_code?: string | null;
  panel_area?: number | null;
  available_at?: string | null;
  station_started_at?: string | null;
  station_finished_at?: string | null;
  finished_at?: string | null;
  expected_minutes?: number | null;
  actual_minutes?: number | null;
  paused_minutes?: number | null;
  pauses?: PanelsFinishedPause[] | null;
  tasks?: PanelsFinishedTask[] | null;
  house_identifier?: string | null;
  module_number?: number | null;
  project_name?: string | null;
};

export type PanelsFinishedModule = {
  module_number?: number | null;
  panels?: PanelsFinishedPanel[] | null;
};

export type PanelsFinishedHouse = {
  house_identifier?: string | null;
  modules?: PanelsFinishedModule[] | null;
};

export type PanelsFinishedResponse = {
  houses?: PanelsFinishedHouse[] | null;
};

export type FlattenedPanelsFinishedPanel = PanelsFinishedPanel & {
  id: string;
  project_name?: string | null;
};

const normalizeString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const toInitialsUpper = (value: string) => {
  const text = normalizeString(value);
  if (!text) return '';
  const initials = text
    .split(/[\s_-]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part[0].toUpperCase());
  return initials.join('');
};

export const formatCasaLabel = ({
  projectName,
  houseIdentifier,
  moduleNumber,
}: {
  projectName?: string | null;
  houseIdentifier?: string | null;
  moduleNumber?: number | string | null;
}) => {
  const initials = toInitialsUpper(projectName ?? '');
  const housePart = normalizeString(houseIdentifier);
  const modulePart = Number.isFinite(moduleNumber)
    ? String(moduleNumber)
    : normalizeString(moduleNumber);
  const pieces: string[] = [];

  if (initials) {
    pieces.push(initials);
  }
  if (housePart) {
    pieces.push(housePart);
  }

  const prefix = pieces.length > 0 ? pieces.join(' ') : '';
  if (!modulePart) {
    return prefix || '-';
  }
  return prefix ? `${prefix} - ${modulePart}` : modulePart;
};

export const flattenPanelsFinishedResponse = (
  data: PanelsFinishedResponse | null | undefined
): FlattenedPanelsFinishedPanel[] => {
  const result: FlattenedPanelsFinishedPanel[] = [];
  if (!data) return result;
  const houses = Array.isArray(data.houses) ? data.houses : [];

  houses.forEach((house) => {
    const modules = Array.isArray(house?.modules) ? house.modules : [];
    modules.forEach((moduleItem) => {
      const panels = Array.isArray(moduleItem?.panels) ? moduleItem.panels : [];
      panels.forEach((panel) => {
        if (!panel) return;
        const planId = panel.plan_id != null ? panel.plan_id : `plan-${result.length}`;
        const panelId =
          panel.panel_definition_id != null ? panel.panel_definition_id : panel.panel_code ?? `panel-${result.length}`;
        result.push({
          ...panel,
          id: `${planId}-${panelId}`,
          panel_code: panel.panel_code ?? String(panel.panel_definition_id ?? ''),
          house_identifier: panel.house_identifier ?? house?.house_identifier ?? null,
          module_number: panel.module_number ?? moduleItem?.module_number ?? null,
          project_name: panel.project_name ?? null,
        });
      });
    });
  });

  return result;
};

export const summarizePauses = (
  pauses: PanelsFinishedPause[] | null | undefined,
  fallbackEnd: string | null | undefined
) => {
  const entries = Array.isArray(pauses) ? pauses : [];
  if (!entries.length) {
    return {
      firstStartRaw: null,
      lastEndRaw: null,
      reasons: [] as string[],
      totalDurationMs: null as number | null,
    };
  }

  const normalized = entries
    .map((pause) => {
      if (!pause) return null;
      const startRaw = pause.paused_at ?? null;
      const endRaw = pause.resumed_at ?? null;
      const startTs = toTs(startRaw);
      let endTs = toTs(endRaw);
      let endValue = endRaw;
      if (endTs == null && fallbackEnd) {
        endTs = toTs(fallbackEnd);
        endValue = fallbackEnd;
      }
      if (startTs == null) return null;
      return {
        startRaw,
        endRaw: endValue,
        startTs,
        endTs,
        reason: normalizeString(pause.reason),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a?.startTs == null && b?.startTs == null) return 0;
      if (a?.startTs == null) return 1;
      if (b?.startTs == null) return -1;
      return a.startTs - b.startTs;
    });

  if (!normalized.length) {
    return {
      firstStartRaw: null,
      lastEndRaw: null,
      reasons: [] as string[],
      totalDurationMs: null as number | null,
    };
  }

  const firstStart = normalized[0]?.startRaw ?? null;
  const lastEntry = normalized.reduce((acc, entry) => {
    if (!acc) return entry;
    if (acc.endTs == null) return entry.endTs != null ? entry : acc;
    if (entry.endTs == null) return acc;
    return entry.endTs >= acc.endTs ? entry : acc;
  }, null as (typeof normalized)[number] | null);
  const lastEnd = lastEntry?.endRaw ?? null;

  let totalDurationMs = 0;
  normalized.forEach((entry) => {
    if (entry?.startTs == null || entry.endTs == null) return;
    if (entry.endTs <= entry.startTs) return;
    totalDurationMs += entry.endTs - entry.startTs;
  });

  const seenReasons = new Set<string>();
  const reasons: string[] = [];
  normalized.forEach((entry) => {
    if (!entry?.reason) return;
    if (seenReasons.has(entry.reason)) return;
    seenReasons.add(entry.reason);
    reasons.push(entry.reason);
  });

  return {
    firstStartRaw: firstStart,
    lastEndRaw: lastEnd,
    reasons,
    totalDurationMs,
  };
};

export const collectTaskNotes = (tasks: PanelsFinishedTask[] | null | undefined) => {
  const source = Array.isArray(tasks) ? tasks : [];
  const notes: string[] = [];
  const seen = new Set<string>();

  source.forEach((task) => {
    const workerEntries = Array.isArray(task?.worker_entries) ? task.worker_entries : [];
    workerEntries.forEach((entry) => {
      const workerName = normalizeString(entry?.worker_name);
      const raw = normalizeString(entry?.notes);
      if (!raw) return;

      raw.split(/\r?\n/).forEach((line) => {
        const trimmed = normalizeString(line);
        if (!trimmed) return;
        const display = trimmed.startsWith('[ex-post]')
          ? trimmed
          : workerName
            ? `${workerName}: ${trimmed}`
            : trimmed;
        if (!seen.has(display)) {
          seen.add(display);
          notes.push(display);
        }
      });
    });
  });

  return notes;
};
