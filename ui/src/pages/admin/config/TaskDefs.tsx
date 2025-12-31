import React, { useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck,
  Filter,
  ListChecks,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type TaskScope = 'panel' | 'module';

type TaskDefinition = {
  id: number;
  name: string;
  scope: TaskScope;
  active: boolean;
  skippable: boolean;
  concurrent_allowed: boolean;
  dependencies_json: number[] | null;
  advance_trigger: boolean;
};

type TaskStationSequence = {
  station_sequence_order: number | null;
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
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(emptyTaskDraft());
  const [query, setQuery] = useState('');
  const [dependencyQuery, setDependencyQuery] = useState('');
  const [allowedQuery, setAllowedQuery] = useState('');
  const [crewQuery, setCrewQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
        return sorted[0].id;
      }
      return sorted.some((task) => task.id === prev) ? prev : sorted[0].id;
    });
  };

  useEffect(() => {
    let active = true;
    const init = async () => {
      setLoading(true);
      setStatusMessage(null);
      try {
        const [taskData, skillData, workerData] = await Promise.all([
          apiRequest<TaskDefinition[]>('/api/task-definitions'),
          apiRequest<Skill[]>('/api/workers/skills'),
          apiRequest<Worker[]>('/api/workers'),
        ]);
        if (!active) {
          return;
        }
        const sortedTasks = sortTasks(taskData);
        setTasks(sortedTasks);
        setSkills(sortSkills(skillData));
        setWorkers(sortWorkers(workerData));
        setSelectedTaskId(sortedTasks.length ? sortedTasks[0].id : null);
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
      station_sequence_order: '',
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
        const [stationData, specialtyData, allowedData, crewData] = await Promise.all([
          apiRequest<TaskStationSequence>(
            `/api/task-definitions/${selectedTaskId}/station-sequence-order`
          ),
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
          station_sequence_order:
            stationData.station_sequence_order !== null
              ? String(stationData.station_sequence_order)
              : '',
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

  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return tasks;
    }
    return tasks.filter((task) => task.name.toLowerCase().includes(needle));
  }, [query, tasks]);

  const dependencyOptions = useMemo(() => {
    const needle = dependencyQuery.trim().toLowerCase();
    return tasks.filter((task) => {
      if (task.id === draft.id) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return task.name.toLowerCase().includes(needle);
    });
  }, [dependencyQuery, draft.id, tasks]);

  const filteredAllowedWorkers = useMemo(() => {
    const needle = allowedQuery.trim().toLowerCase();
    if (!needle) {
      return workers;
    }
    return workers.filter((worker) => formatWorkerName(worker).toLowerCase().includes(needle));
  }, [allowedQuery, workers]);

  const filteredCrewWorkers = useMemo(() => {
    const needle = crewQuery.trim().toLowerCase();
    if (!needle) {
      return workers;
    }
    return workers.filter((worker) => formatWorkerName(worker).toLowerCase().includes(needle));
  }, [crewQuery, workers]);

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
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 1) {
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
      active: draft.active,
      skippable: draft.skippable,
      concurrent_allowed: draft.concurrent_allowed,
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
        apiRequest<TaskStationSequence>(
          `/api/task-definitions/${saved.id}/station-sequence-order`,
          {
            method: 'PUT',
            body: JSON.stringify({ station_sequence_order: stationSequence }),
          }
        ),
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
                {totalTasks} total · {panelTasks} panel · {moduleTasks} module
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
            <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
              Loading task definitions...
            </div>
          ) : filteredTasks.length ? (
            <div className="mt-6 grid gap-3">
              {filteredTasks.map((task, index) => (
                <button
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
                    selectedTaskId === task.id
                      ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
                      : 'border-black/5 bg-white'
                  }`}
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(201,215,245,0.55)] text-[var(--ink)]">
                      <ClipboardCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-[var(--ink)]">{task.name}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        Scope: {task.scope} · {task.skippable ? 'Skippable' : 'Required'} ·{' '}
                        {task.concurrent_allowed ? 'Concurrent' : 'Solo'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-[var(--ink-muted)]">
                      {task.active ? 'Active' : 'Inactive'}
                    </span>
                    {task.scope === 'module' && task.advance_trigger && (
                      <span className="rounded-full bg-[rgba(47,107,79,0.12)] px-2 py-0.5 text-xs text-[var(--leaf)]">
                        Advance trigger
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
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
                          updateDraft({
                            scope,
                            advance_trigger: scope === 'module' ? draft.advance_trigger : false,
                          });
                        }}
                      >
                        <option value="panel">panel</option>
                        <option value="module">module</option>
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
                      Station sequence
                      <input
                        type="number"
                        min={1}
                        className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                        value={draft.station_sequence_order}
                        onChange={(event) =>
                          updateDraft({ station_sequence_order: event.target.value })
                        }
                        placeholder="e.g. 1"
                      />
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
                  <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={draft.skippable}
                      onChange={(event) => updateDraft({ skippable: event.target.checked })}
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
                  <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={draft.advance_trigger}
                      disabled={draft.scope !== 'module'}
                      onChange={(event) =>
                        updateDraft({ advance_trigger: event.target.checked })
                      }
                    />{' '}
                    Advance trigger (module-only)
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-black/5 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Dependencies
                </p>
                <label className="mt-3 flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                  <Search className="h-3.5 w-3.5" />
                  <input
                    placeholder="Filter dependencies"
                    value={dependencyQuery}
                    onChange={(event) => setDependencyQuery(event.target.value)}
                    className="w-full bg-transparent text-xs outline-none"
                  />
                </label>
                <div className="mt-3 max-h-32 overflow-auto rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.2)] p-3 text-xs">
                  {dependencyOptions.length ? (
                    dependencyOptions.map((dep) => (
                      <label key={dep.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={draft.dependencies_json.includes(dep.id)}
                          onChange={() => toggleDependency(dep.id)}
                        />
                        {dep.name}
                      </label>
                    ))
                  ) : (
                    <p className="text-[var(--ink-muted)]">No tasks available.</p>
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
                    <div className="max-h-40 overflow-auto rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.2)] p-3 text-xs">
                      {filteredAllowedWorkers.length ? (
                        filteredAllowedWorkers.map((worker) => (
                          <label key={worker.id} className="flex items-center gap-2">
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
                        ))
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
                <label className="mt-3 flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                  <Search className="h-3.5 w-3.5" />
                  <input
                    placeholder="Search crew"
                    value={crewQuery}
                    onChange={(event) => setCrewQuery(event.target.value)}
                    className="w-full bg-transparent text-xs outline-none"
                  />
                </label>
                <div className="mt-2 max-h-40 overflow-auto rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.2)] p-3 text-xs">
                  {filteredCrewWorkers.length ? (
                    filteredCrewWorkers.map((worker) => (
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
                    ))
                  ) : (
                    <p className="text-[var(--ink-muted)]">No workers found.</p>
                  )}
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
    </div>
  );
};

export default TaskDefs;
