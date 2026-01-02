import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Filter,
  ListChecks,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type TaskScope = 'panel' | 'module' | 'aux';

type TaskDefinition = {
  id: number;
  name: string;
  scope: TaskScope;
  default_station_sequence: number | null;
  active: boolean;
  skippable: boolean;
  concurrent_allowed: boolean;
  dependencies_json: number[] | null;
  advance_trigger: boolean;
};

type TaskSpecialty = {
  skill_id: number | null;
};

type TaskAllowedWorkers = {
  worker_ids: number[] | null;
};

type TaskRegularCrew = {
  worker_ids: number[] | null;
};

type Skill = {
  id: number;
  name: string;
};

type Worker = {
  id: number;
  first_name: string;
  last_name: string;
  active: boolean;
  assigned_station_ids?: number[] | null;
};

type Station = {
  id: number;
  name: string;
  role: 'Panels' | 'Magazine' | 'Assembly' | 'AUX';
  line_type: '1' | '2' | '3' | null;
  sequence_order: number | null;
};

type TaskDraft = {
  id?: number;
  name: string;
  scope: TaskScope;
  active: boolean;
  skippable: boolean;
  concurrent_allowed: boolean;
  dependencies_json: number[];
  advance_trigger: boolean;
  station_sequence_order: string;
  skill_id: number | null;
  allow_all_workers: boolean;
  allowed_worker_ids: number[];
  regular_crew_worker_ids: number[];
};

const emptyTaskDraft = (): TaskDraft => ({
  name: '',
  scope: 'panel',
  active: true,
  skippable: false,
  concurrent_allowed: false,
  dependencies_json: [],
  advance_trigger: false,
  station_sequence_order: '',
  skill_id: null,
  allow_all_workers: true,
  allowed_worker_ids: [],
  regular_crew_worker_ids: [],
});

const sortTasks = (list: TaskDefinition[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

const sortSkills = (list: Skill[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

const sortWorkers = (list: Worker[]) =>
  [...list].sort((a, b) => {
    const lastCompare = a.last_name.localeCompare(b.last_name);
    if (lastCompare !== 0) {
      return lastCompare;
    }
    return a.first_name.localeCompare(b.first_name);
  });

const formatWorkerName = (worker: Worker) => `${worker.first_name} ${worker.last_name}`;

const normalizeStationName = (station: Station) => {
  const trimmed = station.name.trim();
  if (!station.line_type) {
    return trimmed;
  }
  const pattern = new RegExp(`^(Linea|Line)\\s*${station.line_type}\\s*-\\s*`, 'i');
  const normalized = trimmed.replace(pattern, '').trim();
  return normalized || trimmed;
};

const parseSequenceValue = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
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

const TaskDefs: React.FC = () => {
  const [tasks, setTasks] = useState<TaskDefinition[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(emptyTaskDraft());
  const [query, setQuery] = useState('');
  const [dependencyQuery, setDependencyQuery] = useState('');
  const [allowedQuery, setAllowedQuery] = useState('');
  const [crewQuery, setCrewQuery] = useState('');
  const [dependencyDropdownOpen, setDependencyDropdownOpen] = useState(false);
  const [crewModalOpen, setCrewModalOpen] = useState(false);
  const [catalogOpenGroups, setCatalogOpenGroups] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const dependencyDropdownRef = useRef<HTMLDivElement | null>(null);

  const loadTasks = async () => {
    const taskData = await apiRequest<TaskDefinition[]>('/api/task-definitions');
    const sorted = sortTasks(taskData);
    setTasks(sorted);
    if (!sorted.length) {
      setSelectedTaskId(null);
      return;
    }
    setSelectedTaskId((prev) => {
      if (!prev) {
        return null;
      }
      return sorted.some((task) => task.id === prev) ? prev : null;
    });
  };

  useEffect(() => {
    let active = true;
    const init = async () => {
      setLoading(true);
      setStatusMessage(null);
      try {
        const [taskData, skillData, workerData, stationData] = await Promise.all([
          apiRequest<TaskDefinition[]>('/api/task-definitions'),
          apiRequest<Skill[]>('/api/workers/skills'),
          apiRequest<Worker[]>('/api/workers'),
          apiRequest<Station[]>('/api/stations'),
        ]);
        if (!active) {
          return;
        }
        const sortedTasks = sortTasks(taskData);
        setTasks(sortedTasks);
        setSkills(sortSkills(skillData));
        setWorkers(sortWorkers(workerData));
        setStations(stationData);
        setSelectedTaskId(null);
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error ? error.message : 'Failed to load task definitions.';
          setStatusMessage(message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    init();
    return () => {
      active = false;
    };
  }, []);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  );

  useEffect(() => {
    if (!selectedTask) {
      setDraft(emptyTaskDraft());
      return;
    }
    setDraft({
      id: selectedTask.id,
      name: selectedTask.name,
      scope: selectedTask.scope,
      active: selectedTask.active,
      skippable: selectedTask.skippable,
      concurrent_allowed: selectedTask.concurrent_allowed,
      dependencies_json: selectedTask.dependencies_json ?? [],
      advance_trigger: selectedTask.advance_trigger,
      station_sequence_order:
        selectedTask.default_station_sequence !== null
          ? String(selectedTask.default_station_sequence)
          : '',
      skill_id: null,
      allow_all_workers: true,
      allowed_worker_ids: [],
      regular_crew_worker_ids: [],
    });
  }, [selectedTask]);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }
    let active = true;
    const loadDetails = async () => {
      setDetailsLoading(true);
      setStatusMessage(null);
      try {
        const [specialtyData, allowedData, crewData] = await Promise.all([
          apiRequest<TaskSpecialty>(`/api/task-definitions/${selectedTaskId}/specialty`),
          apiRequest<TaskAllowedWorkers>(
            `/api/task-definitions/${selectedTaskId}/allowed-workers`
          ),
          apiRequest<TaskRegularCrew>(`/api/task-definitions/${selectedTaskId}/regular-crew`),
        ]);
        if (!active) {
          return;
        }
        const allowedWorkerIds = allowedData.worker_ids ?? [];
        const regularCrewIds = crewData.worker_ids ?? [];
        setDraft((prev) => ({
          ...prev,
          skill_id: specialtyData.skill_id,
          allow_all_workers: allowedData.worker_ids === null,
          allowed_worker_ids: allowedWorkerIds,
          regular_crew_worker_ids: regularCrewIds,
        }));
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error ? error.message : 'Failed to load task details.';
          setStatusMessage(message);
        }
      } finally {
        if (active) {
          setDetailsLoading(false);
        }
      }
    };
    loadDetails();
    return () => {
      active = false;
    };
  }, [selectedTaskId]);

  const catalogSequenceLabelByOrder = useMemo(() => {
    const entries = new Map<number, Set<string>>();
    stations.forEach((station) => {
      if (station.sequence_order === null) {
        return;
      }
      const normalized = normalizeStationName(station);
      const existing = entries.get(station.sequence_order) ?? new Set<string>();
      existing.add(normalized);
      entries.set(station.sequence_order, existing);
    });
    const map = new Map<number, string>();
    entries.forEach((names, sequence) => {
      map.set(
        sequence,
        names.size ? Array.from(names).join(' / ') : `Sequence ${sequence}`
      );
    });
    return map;
  }, [stations]);

  const auxStationLabelById = useMemo(() => {
    const map = new Map<number, string>();
    stations.forEach((station) => {
      if (station.role !== 'AUX') {
        return;
      }
      map.set(station.id, station.name);
    });
    return map;
  }, [stations]);

  const stationSequenceOptions = useMemo(() => {
    if (draft.scope === 'aux') {
      return stations
        .filter((station) => station.role === 'AUX')
        .map((station) => ({
          sequence: station.id,
          label: station.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    const allowedRoles =
      draft.scope === 'panel'
        ? new Set<Station['role']>(['Panels'])
        : new Set<Station['role']>(['Assembly', 'AUX']);
    const entries = new Map<number, Set<string>>();
    stations.forEach((station) => {
      if (station.sequence_order === null) {
        return;
      }
      if (!allowedRoles.has(station.role)) {
        return;
      }
      const normalized = normalizeStationName(station);
      const existing = entries.get(station.sequence_order) ?? new Set<string>();
      existing.add(normalized);
      entries.set(station.sequence_order, existing);
    });
    return Array.from(entries.entries())
      .map(([sequence, names]) => ({
        sequence,
        label: names.size ? Array.from(names).join(' / ') : `Sequence ${sequence}`,
      }))
      .sort((a, b) => a.sequence - b.sequence);
  }, [draft.scope, stations]);

  const taskSequenceById = useMemo(() => {
    const map = new Map<number, number | null>();
    tasks.forEach((task) => {
      map.set(task.id, task.default_station_sequence ?? null);
    });
    return map;
  }, [tasks]);

  const taskNameById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task.name])),
    [tasks]
  );

  const workerNameById = useMemo(
    () => new Map(workers.map((worker) => [worker.id, formatWorkerName(worker)])),
    [workers]
  );

  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return tasks;
    }
    return tasks.filter((task) => task.name.toLowerCase().includes(needle));
  }, [query, tasks]);

  const draftSequenceOrder = useMemo(
    () => parseSequenceValue(draft.station_sequence_order),
    [draft.station_sequence_order]
  );

  const hasSequenceData = tasks.some((task) => task.default_station_sequence !== null);

  const availableDependencyTasks = useMemo(() => {
    const canFilterBySequence =
      draft.scope !== 'aux' && draftSequenceOrder !== null && hasSequenceData;
    return tasks
      .filter((task) => {
        if (task.id === draft.id) {
          return false;
        }
        if (task.scope !== draft.scope) {
          return false;
        }
        if (!canFilterBySequence) {
          return true;
        }
        const taskSequence = taskSequenceById.get(task.id) ?? null;
        if (taskSequence === null) {
          return false;
        }
        return taskSequence <= draftSequenceOrder;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [draft.id, draft.scope, draftSequenceOrder, hasSequenceData, taskSequenceById, tasks]);

  const dependencyOptions = useMemo(() => {
    const needle = dependencyQuery.trim().toLowerCase();
    if (!needle) {
      return availableDependencyTasks;
    }
    return availableDependencyTasks.filter((task) =>
      task.name.toLowerCase().includes(needle)
    );
  }, [availableDependencyTasks, dependencyQuery]);

  const dependencyHint = useMemo(() => {
    if (draft.scope === 'aux') {
      return 'Showing aux tasks. Station assignment does not filter dependencies.';
    }
    if (draftSequenceOrder === null) {
      return `Showing ${draft.scope} tasks. Set a station sequence to filter upstream.`;
    }
    if (!hasSequenceData) {
      return `Showing ${draft.scope} tasks.`;
    }
    return `Showing ${draft.scope} tasks at or before sequence ${draftSequenceOrder}.`;
  }, [draft.scope, draftSequenceOrder, hasSequenceData]);

  const filteredAllowedWorkers = useMemo(() => {
    const needle = allowedQuery.trim().toLowerCase();
    if (!needle) {
      return workers;
    }
    return workers.filter((worker) => formatWorkerName(worker).toLowerCase().includes(needle));
  }, [allowedQuery, workers]);

  const crewPriorityStationIds = useMemo(() => {
    const parsed = parseSequenceValue(draft.station_sequence_order);
    if (!parsed) {
      return new Set<number>();
    }
    if (draft.scope === 'aux') {
      return new Set<number>([parsed]);
    }
    const allowedRoles =
      draft.scope === 'panel'
        ? new Set<Station['role']>(['Panels'])
        : new Set<Station['role']>(['Assembly', 'AUX']);
    const matches = stations.filter(
      (station) => station.sequence_order === parsed && allowedRoles.has(station.role)
    );
    return new Set(matches.map((station) => station.id));
  }, [draft.scope, draft.station_sequence_order, stations]);

  const filteredCrewWorkers = useMemo(() => {
    const activeWorkers = workers.filter((worker) => worker.active);
    const needle = crewQuery.trim().toLowerCase();
    const matching = needle
      ? activeWorkers.filter((worker) =>
          formatWorkerName(worker).toLowerCase().includes(needle)
        )
      : activeWorkers;
    if (crewPriorityStationIds.size === 0) {
      return matching;
    }
    const prioritized: Worker[] = [];
    const others: Worker[] = [];
    matching.forEach((worker) => {
      const assigned = worker.assigned_station_ids ?? [];
      if (assigned.some((stationId) => crewPriorityStationIds.has(stationId))) {
        prioritized.push(worker);
      } else {
        others.push(worker);
      }
    });
    return [...prioritized, ...others];
  }, [crewQuery, crewPriorityStationIds, workers]);

  const dependencySummaryLabel = useMemo(() => {
    if (draft.dependencies_json.length === 0) {
      return 'No dependencies selected';
    }
    const names = draft.dependencies_json.map(
      (id) => taskNameById.get(id) ?? `Task ${id}`
    );
    if (names.length <= 2) {
      return names.join(', ');
    }
    return `${names[0]}, ${names[1]} +${names.length - 2}`;
  }, [draft.dependencies_json, taskNameById]);

  const crewNames = useMemo(
    () =>
      draft.regular_crew_worker_ids.map(
        (id) => workerNameById.get(id) ?? `Worker ${id}`
      ),
    [draft.regular_crew_worker_ids, workerNameById]
  );

  const crewSummaryLabel = useMemo(() => {
    if (crewNames.length === 0) {
      return 'No crew selected';
    }
    if (crewNames.length <= 2) {
      return crewNames.join(', ');
    }
    return `${crewNames[0]}, ${crewNames[1]} +${crewNames.length - 2}`;
  }, [crewNames]);

  const stationSequenceChoices = useMemo(
    () => stationSequenceOptions,
    [stationSequenceOptions]
  );

  const catalogGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; sequence: number | null; name: string; badge: string; tasks: TaskDefinition[] }
    >();
    filteredTasks.forEach((task) => {
      if (task.scope === 'aux') {
        const stationId = taskSequenceById.get(task.id) ?? null;
        const key = stationId === null ? 'aux-unassigned' : `aux-${stationId}`;
        const name =
          stationId === null
            ? 'AUX - Unassigned'
            : auxStationLabelById.get(stationId) ?? `AUX Station ${stationId}`;
        const badge = stationId === null ? 'No station' : `Station ID ${stationId}`;
        const group = groups.get(key);
        if (group) {
          group.tasks.push(task);
          return;
        }
        groups.set(key, { key, sequence: stationId, name, badge, tasks: [task] });
        return;
      }
      const sequence = taskSequenceById.get(task.id) ?? null;
      const key = sequence === null ? 'unscheduled' : `seq-${sequence}`;
      const name =
        sequence === null
          ? 'Unassigned'
          : catalogSequenceLabelByOrder.get(sequence) ?? `Sequence ${sequence}`;
      const badge = sequence === null ? 'No sequence' : `Seq ${sequence}`;
      const group = groups.get(key);
      if (group) {
        group.tasks.push(task);
      } else {
        groups.set(key, { key, sequence, name, badge, tasks: [task] });
      }
    });
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        tasks: sortTasks(group.tasks),
      }))
      .sort((a, b) => {
        const aSeq = a.sequence ?? Number.POSITIVE_INFINITY;
        const bSeq = b.sequence ?? Number.POSITIVE_INFINITY;
        if (aSeq !== bSeq) {
          return aSeq - bSeq;
        }
        return a.name.localeCompare(b.name);
      });
  }, [auxStationLabelById, catalogSequenceLabelByOrder, filteredTasks, taskSequenceById]);

  useEffect(() => {
    setCatalogOpenGroups((prev) => {
      const next = { ...prev };
      let changed = false;
      catalogGroups.forEach((group) => {
        if (!(group.key in next)) {
          next[group.key] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [catalogGroups]);

  useEffect(() => {
    if (!dependencyDropdownOpen) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      if (!dependencyDropdownRef.current) {
        return;
      }
      if (!dependencyDropdownRef.current.contains(event.target as Node)) {
        setDependencyDropdownOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDependencyDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [dependencyDropdownOpen]);

  useEffect(() => {
    if (stations.length === 0) {
      return;
    }
    const current = parseSequenceValue(draft.station_sequence_order);
    if (current === null) {
      return;
    }
    const allowed = stationSequenceOptions.some((option) => option.sequence === current);
    if (!allowed) {
      setDraft((prev) => ({ ...prev, station_sequence_order: '' }));
    }
  }, [draft.station_sequence_order, stationSequenceOptions, stations.length]);

  useEffect(() => {
    const allowedIds = new Set(availableDependencyTasks.map((task) => task.id));
    if (allowedIds.size === 0 && draft.dependencies_json.length === 0) {
      return;
    }
    const filtered = draft.dependencies_json.filter((id) => allowedIds.has(id));
    if (filtered.length === draft.dependencies_json.length) {
      return;
    }
    setDraft((prev) => ({ ...prev, dependencies_json: filtered }));
  }, [availableDependencyTasks, draft.dependencies_json]);

  const updateDraft = (patch: Partial<TaskDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const toggleDependency = (taskId: number) => {
    setDraft((prev) => {
      const next = new Set(prev.dependencies_json);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return { ...prev, dependencies_json: Array.from(next) };
    });
  };

  const toggleAllowedWorker = (workerId: number) => {
    setDraft((prev) => {
      const next = new Set(prev.allowed_worker_ids);
      if (next.has(workerId)) {
        next.delete(workerId);
      } else {
        next.add(workerId);
      }
      return { ...prev, allowed_worker_ids: Array.from(next) };
    });
  };

  const toggleRegularCrew = (workerId: number) => {
    setDraft((prev) => {
      const next = new Set(prev.regular_crew_worker_ids);
      if (next.has(workerId)) {
        next.delete(workerId);
      } else {
        next.add(workerId);
      }
      return { ...prev, regular_crew_worker_ids: Array.from(next) };
    });
  };

  const toggleCatalogGroup = (key: string) => {
    setCatalogOpenGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleAddTask = () => {
    setStatusMessage(null);
    setSelectedTaskId(null);
    setDraft(emptyTaskDraft());
  };

  const parseStationSequence = () => {
    const trimmed = draft.station_sequence_order.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = parseSequenceValue(trimmed);
    if (parsed === null) {
      throw new Error('Station sequence order must be a positive whole number.');
    }
    return parsed;
  };

  const handleSave = async () => {
    const name = draft.name.trim();
    if (!name) {
      setStatusMessage('Task name is required.');
      return;
    }
    if (!draft.allow_all_workers && draft.allowed_worker_ids.length === 0) {
      setStatusMessage('Select allowed workers or enable everyone.');
      return;
    }

    let stationSequence: number | null = null;
    try {
      stationSequence = parseStationSequence();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid station sequence order.';
      setStatusMessage(message);
      return;
    }

    const payload = {
      name,
      scope: draft.scope,
      default_station_sequence: stationSequence,
      active: draft.active,
      skippable: draft.scope === 'panel' ? draft.skippable : false,
      concurrent_allowed: draft.scope === 'panel' ? draft.concurrent_allowed : false,
      dependencies_json: draft.dependencies_json,
      advance_trigger: draft.scope === 'module' ? draft.advance_trigger : false,
    };

    setSaving(true);
    setStatusMessage(null);
    try {
      const saved = draft.id
        ? await apiRequest<TaskDefinition>(`/api/task-definitions/${draft.id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await apiRequest<TaskDefinition>('/api/task-definitions', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      const allowedWorkerIds = draft.allow_all_workers ? null : draft.allowed_worker_ids;
      await Promise.all([
        apiRequest<TaskSpecialty>(`/api/task-definitions/${saved.id}/specialty`, {
          method: 'PUT',
          body: JSON.stringify({ skill_id: draft.skill_id }),
        }),
        apiRequest<TaskAllowedWorkers>(`/api/task-definitions/${saved.id}/allowed-workers`, {
          method: 'PUT',
          body: JSON.stringify({ worker_ids: allowedWorkerIds }),
        }),
        apiRequest<TaskRegularCrew>(`/api/task-definitions/${saved.id}/regular-crew`, {
          method: 'PUT',
          body: JSON.stringify({ worker_ids: draft.regular_crew_worker_ids }),
        }),
      ]);

      await loadTasks();
      setSelectedTaskId(saved.id);
      setStatusMessage('Saved.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save task definition.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft.id) {
      return;
    }
    if (!window.confirm('Delete this task definition?')) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      await apiRequest<void>(`/api/task-definitions/${draft.id}`, { method: 'DELETE' });
      await loadTasks();
      setStatusMessage('Deleted.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete task definition.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const totalTasks = tasks.length;
  const moduleTasks = tasks.filter((task) => task.scope === 'module').length;
  const panelTasks = tasks.filter((task) => task.scope === 'panel').length;
  const auxTasks = tasks.filter((task) => task.scope === 'aux').length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Configuration / Task Definitions
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">Task Definition Studio</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Build task templates, dependencies, and crew constraints.
          </p>
        </div>
        <button
          onClick={handleAddTask}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> New task
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">Task catalog</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {totalTasks} total · {panelTasks} panel · {moduleTasks} module · {auxTasks} aux
              </p>
            </div>
            <div className="flex gap-2">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
                <input
                  type="search"
                  placeholder="Search tasks"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-9 rounded-full border border-black/10 bg-white pl-9 pr-4 text-sm"
                />
              </label>
              <button className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm">
                <Filter className="h-4 w-4" /> Filters
              </button>
            </div>
          </div>

          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
              Loading task definitions...
            </div>
          ) : catalogGroups.length ? (
            <div className="space-y-4">
              {catalogGroups.map((group) => {
                const isOpen = catalogOpenGroups[group.key] ?? true;
                return (
                  <div
                    key={group.key}
                    className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                  >
                    <button
                      type="button"
                      onClick={() => toggleCatalogGroup(group.key)}
                      className="flex w-full items-center justify-between bg-gray-50/50 px-4 py-2 text-left hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-5 w-5 items-center justify-center rounded text-gray-400">
                          {isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{group.name}</p>
                          <p className="text-[10px] text-gray-500">
                            {group.badge} · {group.tasks.length} tasks
                          </p>
                        </div>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="divide-y divide-gray-100">
                        {group.tasks.map((task) => (
                          <button
                            key={task.id}
                            onClick={() => setSelectedTaskId(task.id)}
                            className={`flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors ${
                              selectedTaskId === task.id
                                ? 'bg-blue-50/50'
                                : 'bg-white hover:bg-gray-50'
                            }`}
                          >
                            <div className="min-w-0 flex-1 pr-3">
                              <p className={`truncate text-sm font-medium ${selectedTaskId === task.id ? 'text-blue-900' : 'text-gray-900'}`}>{task.name}</p>
                              <div className="flex items-center gap-2 text-[10px] text-gray-500">
                                <span className="uppercase tracking-wider">{task.scope}</span>
                                {task.scope === 'panel' && (
                                  <>
                                    <span>•</span>
                                    <span>{task.skippable ? 'Skip OK' : 'Required'}</span>
                                  </>
                                )}
                                {task.scope === 'module' && task.advance_trigger && (
                                  <>
                                    <span>•</span>
                                    <span className="text-emerald-600 font-medium">Trigger</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="shrink-0">
                               <span
                                className={`inline-block h-1.5 w-1.5 rounded-full ${
                                  task.active ? 'bg-emerald-500' : 'bg-gray-300'
                                }`}
                              />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
              No tasks match this search.
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  {draft.id ? 'Edit' : 'Create'}
                </p>
                <h2 className="text-lg font-display text-[var(--ink)]">
                  {draft.name || 'New task definition'}
                </h2>
              </div>
              <ListChecks className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Definition
                </p>
                <div className="mt-3 space-y-3">
                  <label className="text-sm text-[var(--ink-muted)]">
                    Task name
                    <input
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={draft.name}
                      onChange={(event) => updateDraft({ name: event.target.value })}
                    />
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm text-[var(--ink-muted)]">
                      Scope
                      <select
                        className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                        value={draft.scope}
                        onChange={(event) => {
                          const scope = event.target.value as TaskScope;
                          const isPanel = scope === 'panel';
                          const isModule = scope === 'module';
                          updateDraft({
                            scope,
                            advance_trigger: isModule ? draft.advance_trigger : false,
                            skippable: isPanel ? draft.skippable : false,
                            concurrent_allowed: isPanel ? draft.concurrent_allowed : false,
                          });
                        }}
                      >
                        <option value="panel">panel</option>
                        <option value="module">module</option>
                        <option value="aux">aux</option>
                      </select>
                    </label>
                    <label className="text-sm text-[var(--ink-muted)]">
                      Status
                      <select
                        className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                        value={draft.active ? 'Active' : 'Inactive'}
                        onChange={(event) =>
                          updateDraft({ active: event.target.value === 'Active' })
                        }
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm text-[var(--ink-muted)]">
                      {draft.scope === 'aux' ? 'AUX station' : 'Station sequence'}
                      <select
                        className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                        value={draft.station_sequence_order}
                        onChange={(event) =>
                          updateDraft({ station_sequence_order: event.target.value })
                        }
                      >
                        <option value="">Unassigned</option>
                        {stationSequenceChoices.map((option) => (
                          <option key={option.sequence} value={String(option.sequence)}>
                            {draft.scope === 'aux'
                              ? `${option.label} (ID ${option.sequence})`
                              : `${option.label} (Seq ${option.sequence})`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm text-[var(--ink-muted)]">
                      Specialty
                      <select
                        className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                        value={draft.skill_id ?? ''}
                        onChange={(event) =>
                          updateDraft({
                            skill_id: event.target.value
                              ? Number(event.target.value)
                              : null,
                          })
                        }
                      >
                        <option value="">None</option>
                        {skills.map((skill) => (
                          <option key={skill.id} value={skill.id}>
                            {skill.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-black/5 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Behavior
                </p>
                <div className="mt-3 grid gap-2">
                  {draft.scope === 'panel' && (
                    <>
                      <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                        <input
                          type="checkbox"
                          checked={draft.skippable}
                          onChange={(event) =>
                            updateDraft({ skippable: event.target.checked })
                          }
                        />{' '}
                        Skippable
                      </label>
                      <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                        <input
                          type="checkbox"
                          checked={draft.concurrent_allowed}
                          onChange={(event) =>
                            updateDraft({ concurrent_allowed: event.target.checked })
                          }
                        />{' '}
                        Concurrent allowed
                      </label>
                    </>
                  )}
                  {draft.scope === 'module' && (
                    <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                      <input
                        type="checkbox"
                        checked={draft.advance_trigger}
                        onChange={(event) =>
                          updateDraft({ advance_trigger: event.target.checked })
                        }
                      />{' '}
                      Advance trigger
                    </label>
                  )}
                  {draft.scope === 'aux' && (
                    <p className="text-xs text-[var(--ink-muted)]">
                      No behavior toggles for AUX tasks.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-black/5 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Dependencies
                </p>
                <p className="mt-2 text-xs text-[var(--ink-muted)]">{dependencyHint}</p>
                <div className="relative mt-3" ref={dependencyDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setDependencyDropdownOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-2 rounded-2xl border border-black/10 bg-white px-3 py-2 text-left text-sm text-[var(--ink)]"
                  >
                    <span className="truncate">{dependencySummaryLabel}</span>
                    <ChevronDown
                      className={`h-4 w-4 text-[var(--ink-muted)] transition ${
                        dependencyDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {dependencyDropdownOpen && (
                    <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-lg">
                      <div className="p-3">
                        <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                          <Search className="h-3.5 w-3.5" />
                          <input
                            placeholder="Filter dependencies"
                            value={dependencyQuery}
                            onChange={(event) => setDependencyQuery(event.target.value)}
                            className="w-full bg-transparent text-xs outline-none"
                          />
                        </label>
                        <div className="mt-2 max-h-48 overflow-auto rounded-xl border border-black/5 bg-[rgba(201,215,245,0.15)] p-2 text-xs">
                          {availableDependencyTasks.length === 0 ? (
                            <p className="text-[var(--ink-muted)]">
                              No eligible tasks for this scope/sequence.
                            </p>
                          ) : dependencyOptions.length ? (
                            <div className="flex flex-col gap-1.5">
                              {dependencyOptions.map((dep) => (
                                <label key={dep.id} className="flex items-center gap-2 py-0.5">
                                  <input
                                    type="checkbox"
                                    checked={draft.dependencies_json.includes(dep.id)}
                                    onChange={() => toggleDependency(dep.id)}
                                  />
                                  <span className="text-[var(--ink)]">{dep.name}</span>
                                </label>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[var(--ink-muted)]">
                              No tasks match that search.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-black/5 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Access control
                </p>
                <div className="mt-3 space-y-3">
                  <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={draft.allow_all_workers}
                      onChange={(event) =>
                        updateDraft({ allow_all_workers: event.target.checked })
                      }
                    />
                    Everyone can perform this task
                  </label>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Disable to restrict execution to a specific list of workers.
                  </p>
                  {draft.allow_all_workers && (
                    <p className="text-xs text-[var(--ink-muted)]">
                      Allowed worker selections are ignored while everyone is allowed.
                    </p>
                  )}
                  <div
                    className={`space-y-2 ${
                      draft.allow_all_workers ? 'pointer-events-none opacity-60' : ''
                    }`}
                  >
                    <p className="text-sm text-[var(--ink-muted)]">
                      Allowed workers ({draft.allowed_worker_ids.length})
                    </p>
                    <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                      <Search className="h-3.5 w-3.5" />
                      <input
                        placeholder="Search workers"
                        value={allowedQuery}
                        onChange={(event) => setAllowedQuery(event.target.value)}
                        className="w-full bg-transparent text-xs outline-none"
                      />
                    </label>
                    <div className="max-h-40 overflow-auto rounded-xl border border-black/5 bg-[rgba(201,215,245,0.15)] p-2 text-xs">
                      {filteredAllowedWorkers.length ? (
                        <div className="flex flex-col gap-1.5">
                          {filteredAllowedWorkers.map((worker) => (
                            <label key={worker.id} className="flex items-center gap-2 py-0.5">
                              <input
                                type="checkbox"
                                checked={draft.allowed_worker_ids.includes(worker.id)}
                                onChange={() => toggleAllowedWorker(worker.id)}
                              />
                              <span className="flex-1">{formatWorkerName(worker)}</span>
                              {!worker.active && (
                                <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] text-[var(--ink-muted)]">
                                  Inactive
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[var(--ink-muted)]">No workers found.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-black/5 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Regular crew
                </p>
                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                  Favorites list for group starts. This does not restrict who can perform the task.
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.15)] p-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                      Selected ({draft.regular_crew_worker_ids.length})
                    </p>
                    <p className="text-sm font-medium text-[var(--ink)]">{crewSummaryLabel}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCrewModalOpen(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)] shadow-sm"
                  >
                    <Users className="h-3.5 w-3.5" /> Manage
                  </button>
                </div>
              </div>

              {detailsLoading && (
                <p className="rounded-2xl border border-black/5 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                  Loading task details...
                </p>
              )}
              {statusMessage && (
                <p className="rounded-2xl border border-black/5 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                  {statusMessage}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save task'}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={saving || !draft.id}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink-muted)] disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            </div>
          </section>
        </aside>
      </div>

      {crewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Regular crew
                </p>
                <h3 className="text-lg font-display text-[var(--ink)]">
                  Select crew members
                </h3>
                <p className="text-xs text-[var(--ink-muted)]">
                  {draft.name || 'New task definition'}
                </p>
              </div>
              <button type="button" onClick={() => setCrewModalOpen(false)}>
                <X className="h-5 w-5 text-[var(--ink-muted)]" />
              </button>
            </div>

            <div className="mt-4">
              <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                <Search className="h-3.5 w-3.5" />
                <input
                  placeholder="Search crew"
                  value={crewQuery}
                  onChange={(event) => setCrewQuery(event.target.value)}
                  className="w-full bg-transparent text-xs outline-none"
                />
              </label>
              <div className="mt-3 max-h-64 overflow-auto rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.2)] p-3 text-xs">
                {filteredCrewWorkers.length ? (
                  <div className="flex flex-col gap-2">
                    {filteredCrewWorkers.map((worker) => (
                      <label key={worker.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={draft.regular_crew_worker_ids.includes(worker.id)}
                          onChange={() => toggleRegularCrew(worker.id)}
                        />
                        <span className="flex-1">{formatWorkerName(worker)}</span>
                        {!worker.active && (
                          <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] text-[var(--ink-muted)]">
                            Inactive
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-[var(--ink-muted)]">No workers found.</p>
                )}
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setCrewModalOpen(false)}
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskDefs;
