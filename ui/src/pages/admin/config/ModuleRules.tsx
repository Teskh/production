import React, { useEffect, useMemo, useState } from 'react';
import { Check, Layers, Plus, RefreshCcw, Save } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type HouseType = {
  id: number;
  name: string;
  number_of_modules: number;
};

type Station = {
  id: number;
  name: string;
  role: 'Panels' | 'Magazine' | 'Assembly' | 'AUX';
  line_type: '1' | '2' | '3' | null;
  sequence_order: number | null;
};

type TaskScope = 'panel' | 'module';

type TaskDefinition = {
  id: number;
  name: string;
  scope: TaskScope;
  active: boolean;
};

type TaskApplicability = {
  id: number;
  task_definition_id: number;
  house_type_id: number | null;
  sub_type_id: number | null;
  module_number: number | null;
  panel_definition_id: number | null;
  applies: boolean;
  station_sequence_order: number | null;
};

type TaskExpectedDuration = {
  id: number;
  task_definition_id: number;
  house_type_id: number | null;
  sub_type_id: number | null;
  module_number: number | null;
  panel_definition_id: number | null;
  expected_minutes: number;
};

type ModuleTask = {
  id: number;
  name: string;
  station_sequence_order: number | null;
};

type TaskRuleState = {
  applies: boolean;
  expectedMinutes: string;
  applicabilityRowId: number | null;
  durationRowId: number | null;
};

type TaskRuleBaseline = {
  applies: boolean;
  expectedMinutes: string;
};

type StationGroup = {
  key: string;
  title: string;
  subtitle: string;
  sequence: number | null;
  tasks: ModuleTask[];
};

const buildHeaders = (options: RequestInit): Headers => {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
};

const apiRequest = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: buildHeaders(options),
    credentials: 'include',
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

const parseOptionalNumber = (value: string): number | null | 'invalid' => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 'invalid';
  }
  return parsed;
};

const areDurationValuesEqual = (left: string, right: string): boolean => {
  const leftParsed = parseOptionalNumber(left);
  const rightParsed = parseOptionalNumber(right);
  if (leftParsed === 'invalid' || rightParsed === 'invalid') {
    return false;
  }
  if (leftParsed === null && rightParsed === null) {
    return true;
  }
  if (leftParsed === null || rightParsed === null) {
    return false;
  }
  return leftParsed === rightParsed;
};

const pickRow = <T extends { id: number }>(
  rows: T[],
  predicate: (row: T) => boolean
): T | null => {
  let match: T | null = null;
  rows.forEach((row) => {
    if (!predicate(row)) {
      return;
    }
    if (!match || row.id < match.id) {
      match = row;
    }
  });
  return match;
};

const groupRowsByTask = <T extends { task_definition_id: number }>(
  rows: T[]
): Map<number, T[]> => {
  const map = new Map<number, T[]>();
  rows.forEach((row) => {
    const list = map.get(row.task_definition_id) ?? [];
    list.push(row);
    map.set(row.task_definition_id, list);
  });
  return map;
};

const sortHouseTypes = (list: HouseType[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

const sortTasks = (list: ModuleTask[]) =>
  [...list].sort((a, b) => {
    const aSeq = a.station_sequence_order ?? Number.POSITIVE_INFINITY;
    const bSeq = b.station_sequence_order ?? Number.POSITIVE_INFINITY;
    if (aSeq !== bSeq) {
      return aSeq - bSeq;
    }
    return a.name.localeCompare(b.name);
  });

const ModuleRules: React.FC = () => {
  const [houseTypes, setHouseTypes] = useState<HouseType[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [tasks, setTasks] = useState<ModuleTask[]>([]);
  const [applicabilityRows, setApplicabilityRows] = useState<TaskApplicability[]>([]);
  const [durationRows, setDurationRows] = useState<TaskExpectedDuration[]>([]);
  const [selectedHouseTypeId, setSelectedHouseTypeId] = useState<number | null>(null);
  const [selectedModuleNumber, setSelectedModuleNumber] = useState<number | null>(null);
  const [draftByTask, setDraftByTask] = useState<Record<number, TaskRuleState>>({});
  const [baselineByTask, setBaselineByTask] = useState<Record<number, TaskRuleBaseline>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setStatusMessage(null);
      try {
        const [
          houseResult,
          taskResult,
          applicabilityResult,
          durationResult,
          stationResult,
        ] = (await Promise.allSettled([
          apiRequest<HouseType[]>('/api/house-types'),
          apiRequest<TaskDefinition[]>('/api/task-definitions'),
          apiRequest<TaskApplicability[]>('/api/task-rules/applicability'),
          apiRequest<TaskExpectedDuration[]>('/api/task-rules/durations'),
          apiRequest<Station[]>('/api/stations'),
        ])) as [
          PromiseSettledResult<HouseType[]>,
          PromiseSettledResult<TaskDefinition[]>,
          PromiseSettledResult<TaskApplicability[]>,
          PromiseSettledResult<TaskExpectedDuration[]>,
          PromiseSettledResult<Station[]>,
        ];

        if (!active) {
          return;
        }

        const messageParts: string[] = [];

        if (houseResult.status === 'fulfilled') {
          const sorted = sortHouseTypes(houseResult.value);
          setHouseTypes(sorted);
          if (sorted.length > 0) {
            setSelectedHouseTypeId(sorted[0].id);
            setSelectedModuleNumber(1);
          } else {
            setSelectedHouseTypeId(null);
            setSelectedModuleNumber(null);
          }
        } else {
          setHouseTypes([]);
          setSelectedHouseTypeId(null);
          setSelectedModuleNumber(null);
          messageParts.push('House types failed to load.');
        }

        const defaultApplicability = new Map<number, TaskApplicability>();
        if (applicabilityResult.status === 'fulfilled') {
          applicabilityResult.value.forEach((row) => {
            if (
              row.house_type_id !== null ||
              row.sub_type_id !== null ||
              row.module_number !== null ||
              row.panel_definition_id !== null
            ) {
              return;
            }
            const existing = defaultApplicability.get(row.task_definition_id);
            if (!existing || row.id < existing.id) {
              defaultApplicability.set(row.task_definition_id, row);
            }
          });
          setApplicabilityRows(applicabilityResult.value);
        } else {
          setApplicabilityRows([]);
          messageParts.push('Task applicability rules failed to load.');
        }

        if (durationResult.status === 'fulfilled') {
          setDurationRows(durationResult.value);
        } else {
          setDurationRows([]);
          messageParts.push('Task duration rules failed to load.');
        }

        if (taskResult.status === 'fulfilled') {
          const moduleTasks = taskResult.value
            .filter((task) => task.scope === 'module' && task.active)
            .map((task) => ({
              id: task.id,
              name: task.name,
              station_sequence_order:
                defaultApplicability.get(task.id)?.station_sequence_order ?? null,
            }));
          setTasks(sortTasks(moduleTasks));
        } else {
          setTasks([]);
          messageParts.push('Task definitions failed to load.');
        }

        if (stationResult.status === 'fulfilled') {
          setStations(stationResult.value);
        } else {
          setStations([]);
          messageParts.push('Stations failed to load.');
        }

        if (messageParts.length > 0) {
          setStatusMessage(messageParts.join(' '));
        }
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error ? error.message : 'Failed to load module rules.';
          setStatusMessage(message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const selectedHouseType = useMemo(
    () => houseTypes.find((type) => type.id === selectedHouseTypeId) ?? null,
    [houseTypes, selectedHouseTypeId]
  );

  const availableModules = useMemo(() => {
    if (!selectedHouseType) {
      return [];
    }
    return Array.from({ length: selectedHouseType.number_of_modules }, (_, index) => index + 1);
  }, [selectedHouseType]);

  const applicabilityByTask = useMemo(
    () => groupRowsByTask(applicabilityRows),
    [applicabilityRows]
  );

  const durationByTask = useMemo(() => groupRowsByTask(durationRows), [durationRows]);

  const stationInfoBySequence = useMemo(() => {
    const map = new Map<number, { names: string[]; lineTypes: string[] }>();
    stations
      .filter((station) => station.role === 'Assembly')
      .forEach((station) => {
        if (station.sequence_order === null) {
          return;
        }
        const entry = map.get(station.sequence_order) ?? { names: [], lineTypes: [] };
        entry.names.push(station.name);
        if (station.line_type) {
          entry.lineTypes.push(station.line_type);
        }
        map.set(station.sequence_order, entry);
      });
    return map;
  }, [stations]);

  const stationGroups = useMemo(() => {
    const groups = new Map<string, StationGroup>();
    const buildGroupInfo = (sequence: number | null) => {
      if (sequence === null) {
        return {
          title: 'Other tasks',
          subtitle: 'Unscheduled or auxiliary work',
        };
      }
      const info = stationInfoBySequence.get(sequence);
      const names = info ? Array.from(new Set(info.names)) : [];
      const lineTypes = info ? Array.from(new Set(info.lineTypes)) : [];
      const title = names.length > 0 ? names.join(' / ') : `Sequence ${sequence}`;
      const subtitleParts = [`Seq ${sequence}`];
      if (lineTypes.length > 0) {
        subtitleParts.push(`Line ${lineTypes.join('/')}`);
      }
      return {
        title,
        subtitle: subtitleParts.join(' / '),
      };
    };

    tasks.forEach((task) => {
      const sequence = task.station_sequence_order;
      const key = sequence === null ? 'unscheduled' : `seq-${sequence}`;
      const existing = groups.get(key);
      if (existing) {
        existing.tasks.push(task);
        return;
      }
      const info = buildGroupInfo(sequence);
      groups.set(key, {
        key,
        sequence,
        title: info.title,
        subtitle: info.subtitle,
        tasks: [task],
      });
    });

    return Array.from(groups.values()).sort((a, b) => {
      const aSeq = a.sequence ?? Number.POSITIVE_INFINITY;
      const bSeq = b.sequence ?? Number.POSITIVE_INFINITY;
      if (aSeq !== bSeq) {
        return aSeq - bSeq;
      }
      return a.title.localeCompare(b.title);
    });
  }, [tasks, stationInfoBySequence]);

  useEffect(() => {
    if (!selectedHouseTypeId || !selectedModuleNumber) {
      setDraftByTask({});
      setBaselineByTask({});
      return;
    }

    const nextDraft: Record<number, TaskRuleState> = {};
    const nextBaseline: Record<number, TaskRuleBaseline> = {};

    tasks.forEach((task) => {
      const taskApplicabilityRows = applicabilityByTask.get(task.id) ?? [];
      const moduleRow = pickRow(
        taskApplicabilityRows,
        (row) =>
          row.house_type_id === selectedHouseTypeId &&
          row.module_number === selectedModuleNumber &&
          row.sub_type_id === null &&
          row.panel_definition_id === null
      );
      const houseRow = pickRow(
        taskApplicabilityRows,
        (row) =>
          row.house_type_id === selectedHouseTypeId &&
          row.module_number === null &&
          row.sub_type_id === null &&
          row.panel_definition_id === null
      );
      const defaultRow = pickRow(
        taskApplicabilityRows,
        (row) =>
          row.house_type_id === null &&
          row.module_number === null &&
          row.sub_type_id === null &&
          row.panel_definition_id === null
      );
      const resolvedApplicability = moduleRow ?? houseRow ?? defaultRow ?? null;
      const applies = resolvedApplicability ? resolvedApplicability.applies : false;

      const taskDurationRows = durationByTask.get(task.id) ?? [];
      const moduleDuration = pickRow(
        taskDurationRows,
        (row) =>
          row.house_type_id === selectedHouseTypeId &&
          row.module_number === selectedModuleNumber &&
          row.sub_type_id === null &&
          row.panel_definition_id === null
      );
      const houseDuration = pickRow(
        taskDurationRows,
        (row) =>
          row.house_type_id === selectedHouseTypeId &&
          row.module_number === null &&
          row.sub_type_id === null &&
          row.panel_definition_id === null
      );
      const defaultDuration = pickRow(
        taskDurationRows,
        (row) =>
          row.house_type_id === null &&
          row.module_number === null &&
          row.sub_type_id === null &&
          row.panel_definition_id === null
      );
      const resolvedDuration = moduleDuration ?? houseDuration ?? defaultDuration ?? null;
      const expectedMinutes = resolvedDuration ? String(resolvedDuration.expected_minutes) : '';

      nextDraft[task.id] = {
        applies,
        expectedMinutes,
        applicabilityRowId: moduleRow?.id ?? null,
        durationRowId: moduleDuration?.id ?? null,
      };
      nextBaseline[task.id] = { applies, expectedMinutes };
    });

    setDraftByTask(nextDraft);
    setBaselineByTask(nextBaseline);
    setSaveMessage(null);
  }, [
    applicabilityByTask,
    durationByTask,
    selectedHouseTypeId,
    selectedModuleNumber,
    tasks,
  ]);

  const hasChanges = useMemo(() => {
    return tasks.some((task) => {
      const draft = draftByTask[task.id];
      const baseline = baselineByTask[task.id];
      if (!draft || !baseline) {
        return false;
      }
      if (draft.applies !== baseline.applies) {
        return true;
      }
      return !areDurationValuesEqual(draft.expectedMinutes, baseline.expectedMinutes);
    });
  }, [baselineByTask, draftByTask, tasks]);

  const handleSelectHouseType = (value: number) => {
    const nextType = houseTypes.find((type) => type.id === value) ?? null;
    setSelectedHouseTypeId(nextType?.id ?? null);
    if (!nextType) {
      setSelectedModuleNumber(null);
      return;
    }
    setSelectedModuleNumber((prev) => {
      if (prev && prev <= nextType.number_of_modules) {
        return prev;
      }
      return 1;
    });
  };

  const handleReset = () => {
    setDraftByTask((prev) => {
      const next = { ...prev };
      tasks.forEach((task) => {
        const baseline = baselineByTask[task.id];
        if (!baseline) {
          return;
        }
        const current = next[task.id];
        if (!current) {
          next[task.id] = {
            applies: baseline.applies,
            expectedMinutes: baseline.expectedMinutes,
            applicabilityRowId: null,
            durationRowId: null,
          };
          return;
        }
        next[task.id] = {
          ...current,
          applies: baseline.applies,
          expectedMinutes: baseline.expectedMinutes,
        };
      });
      return next;
    });
    setSaveMessage(null);
  };

  const toggleApplies = (taskId: number) => {
    setDraftByTask((prev) => {
      const current = prev[taskId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [taskId]: {
          ...current,
          applies: !current.applies,
        },
      };
    });
    setSaveMessage(null);
  };

  const updateExpectedMinutes = (taskId: number, value: string) => {
    setDraftByTask((prev) => {
      const current = prev[taskId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [taskId]: {
          ...current,
          expectedMinutes: value,
        },
      };
    });
    setSaveMessage(null);
  };

  const refreshRules = async () => {
    const [applicabilityData, durationData] = await Promise.all([
      apiRequest<TaskApplicability[]>('/api/task-rules/applicability'),
      apiRequest<TaskExpectedDuration[]>('/api/task-rules/durations'),
    ]);
    setApplicabilityRows(applicabilityData);
    setDurationRows(durationData);
  };

  const handleSave = async () => {
    if (!selectedHouseTypeId || !selectedModuleNumber) {
      return;
    }
    setSaving(true);
    setSaveMessage(null);
    setSaveError(false);

    const moduleApplicability = new Map<number, TaskApplicability>();
    applicabilityRows.forEach((row) => {
      if (
        row.house_type_id === selectedHouseTypeId &&
        row.module_number === selectedModuleNumber &&
        row.sub_type_id === null &&
        row.panel_definition_id === null
      ) {
        moduleApplicability.set(row.task_definition_id, row);
      }
    });

    const moduleDurations = new Map<number, TaskExpectedDuration>();
    durationRows.forEach((row) => {
      if (
        row.house_type_id === selectedHouseTypeId &&
        row.module_number === selectedModuleNumber &&
        row.sub_type_id === null &&
        row.panel_definition_id === null
      ) {
        moduleDurations.set(row.task_definition_id, row);
      }
    });

    const requests: Promise<unknown>[] = [];

    for (const task of tasks) {
      const draft = draftByTask[task.id];
      const baseline = baselineByTask[task.id];
      if (!draft || !baseline) {
        continue;
      }

      if (draft.applies !== baseline.applies) {
        const existing = moduleApplicability.get(task.id);
        if (existing) {
          requests.push(
            apiRequest(`/api/task-rules/applicability/${existing.id}`, {
              method: 'PUT',
              body: JSON.stringify({ applies: draft.applies }),
            })
          );
        } else {
          requests.push(
            apiRequest('/api/task-rules/applicability', {
              method: 'POST',
              body: JSON.stringify({
                task_definition_id: task.id,
                house_type_id: selectedHouseTypeId,
                sub_type_id: null,
                module_number: selectedModuleNumber,
                panel_definition_id: null,
                applies: draft.applies,
                station_sequence_order: task.station_sequence_order,
              }),
            })
          );
        }
      }

      const durationChanged = !areDurationValuesEqual(
        draft.expectedMinutes,
        baseline.expectedMinutes
      );
      if (!durationChanged) {
        continue;
      }
      const parsed = parseOptionalNumber(draft.expectedMinutes);
      if (parsed === 'invalid') {
        setSaveMessage('Expected minutes must be a non-negative number.');
        setSaveError(true);
        setSaving(false);
        return;
      }
      const existingDuration = moduleDurations.get(task.id);
      if (parsed === null) {
        if (existingDuration) {
          requests.push(
            apiRequest(`/api/task-rules/durations/${existingDuration.id}`, {
              method: 'DELETE',
            })
          );
        }
        continue;
      }
      if (existingDuration) {
        requests.push(
          apiRequest(`/api/task-rules/durations/${existingDuration.id}`, {
            method: 'PUT',
            body: JSON.stringify({ expected_minutes: parsed }),
          })
        );
      } else {
        requests.push(
          apiRequest('/api/task-rules/durations', {
            method: 'POST',
            body: JSON.stringify({
              task_definition_id: task.id,
              house_type_id: selectedHouseTypeId,
              sub_type_id: null,
              module_number: selectedModuleNumber,
              panel_definition_id: null,
              expected_minutes: parsed,
            }),
          })
        );
      }
    }

    if (requests.length === 0) {
      setSaveMessage('No changes to save.');
      setSaveError(false);
      setSaving(false);
      return;
    }

    try {
      await Promise.all(requests);
      await refreshRules();
      setSaveMessage('Changes saved.');
      setSaveError(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save module rules.';
      setSaveMessage(message);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Product Definition / Module Rules
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">
            Module Task Applicability & Durations
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Configure module task applicability and expected minutes per house type module.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
            onClick={handleReset}
            disabled={!hasChanges || saving}
          >
            <RefreshCcw className="h-4 w-4" /> Reset
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={handleSave}
            disabled={!hasChanges || saving || !selectedHouseTypeId || !selectedModuleNumber}
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-3">
        <select
          className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm"
          value={selectedHouseTypeId ?? ''}
          onChange={(event) => handleSelectHouseType(Number(event.target.value))}
          disabled={houseTypes.length === 0}
        >
          {!selectedHouseTypeId && <option value="">Select house type</option>}
          {houseTypes.map((houseType) => (
            <option key={houseType.id} value={houseType.id}>
              {houseType.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm"
          value={selectedModuleNumber ?? ''}
          onChange={(event) => setSelectedModuleNumber(Number(event.target.value))}
          disabled={!selectedHouseTypeId}
        >
          {!selectedModuleNumber && <option value="">Select module</option>}
          {availableModules.map((moduleNumber) => (
            <option key={moduleNumber} value={moduleNumber}>
              Module {moduleNumber}
            </option>
          ))}
        </select>
        {selectedHouseType && selectedModuleNumber && (
          <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
            <Layers className="h-4 w-4" />
            {selectedHouseType.name} / Module {selectedModuleNumber}
          </div>
        )}
      </div>

      {statusMessage && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {statusMessage}
        </div>
      )}

      {saveMessage && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            saveError
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {saveMessage}
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
          Loading module task rules...
        </div>
      )}

      {!loading && !selectedHouseTypeId && (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm italic text-[var(--ink-muted)]">
          Select a house type to begin managing module task rules.
        </div>
      )}

      {!loading && selectedHouseTypeId && tasks.length === 0 && (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
          No active module tasks are defined yet.
        </div>
      )}

      {!loading && selectedHouseTypeId && tasks.length > 0 && (
        <div className="space-y-6">
          {stationGroups.map((group) => (
            <section
              key={group.key}
              className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm"
            >
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                    Station group
                  </p>
                  <h2 className="text-lg font-display text-[var(--ink)]">{group.title}</h2>
                  <p className="text-xs text-[var(--ink-muted)]">{group.subtitle}</p>
                </div>
                <span className="text-xs text-[var(--ink-muted)]">
                  {group.tasks.length} tasks
                </span>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[rgba(201,215,245,0.3)] text-xs text-[var(--ink-muted)]">
                    <tr>
                      <th className="px-4 py-3 text-left">Task</th>
                      <th className="px-4 py-3 text-left">Applies</th>
                      <th className="px-4 py-3 text-left">Expected minutes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.tasks.map((task) => {
                      const state = draftByTask[task.id];
                      if (!state) {
                        return null;
                      }
                      return (
                        <tr key={task.id} className="border-t border-black/5">
                          <td className="px-4 py-3 font-medium text-[var(--ink)]">
                            <div className="flex flex-col">
                              <span>{task.name}</span>
                              {task.station_sequence_order !== null && (
                                <span className="text-[10px] text-[var(--ink-muted)] font-mono">
                                  Seq {String(task.station_sequence_order).padStart(3, '0')}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => toggleApplies(task.id)}
                              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                state.applies
                                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                                  : 'border-black/10 bg-white text-[var(--ink-muted)]'
                              }`}
                            >
                              <span
                                className={`flex h-5 w-5 items-center justify-center rounded-full ${
                                  state.applies ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-400'
                                }`}
                              >
                                {state.applies ? (
                                  <Check className="h-3 w-3" strokeWidth={3} />
                                ) : (
                                  <Plus className="h-3 w-3" strokeWidth={3} />
                                )}
                              </span>
                              {state.applies ? 'Applies' : 'Not applicable'}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            {state.applies ? (
                              <div className="flex items-center gap-2">
                                <input
                                  className="w-24 rounded-lg border border-black/10 bg-white px-2 py-1 text-right text-sm"
                                  value={state.expectedMinutes}
                                  onChange={(event) =>
                                    updateExpectedMinutes(task.id, event.target.value)
                                  }
                                  placeholder="0"
                                />
                                <span className="text-xs text-[var(--ink-muted)]">min</span>
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--ink-muted)]">N/A</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModuleRules;
