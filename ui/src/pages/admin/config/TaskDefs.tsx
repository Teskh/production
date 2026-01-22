import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Filter,
  ListChecks,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';

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

type WorkerSkillAssignment = {
  worker_id: number;
  skill_id: number;
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

const formatScopeLabel = (scope: TaskScope): string => {
  if (scope === 'module') {
    return 'modulo';
  }
  return scope;
};

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
    throw new Error(text || `Solicitud fallida (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

const TaskDefs: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [tasks, setTasks] = useState<TaskDefinition[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [skillAssignments, setSkillAssignments] = useState<WorkerSkillAssignment[]>([]);
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
  const [scopeFilter, setScopeFilter] = useState<TaskScope | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const dependencyDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHeader({
      title: 'Estudio de definicion de tareas',
      kicker: 'Configuracion / Definiciones de tareas',
    });
  }, [setHeader]);

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
        const [taskData, skillData, workerData, stationData, assignmentData] =
          await Promise.all([
            apiRequest<TaskDefinition[]>('/api/task-definitions'),
            apiRequest<Skill[]>('/api/workers/skills'),
            apiRequest<Worker[]>('/api/workers'),
            apiRequest<Station[]>('/api/stations'),
            apiRequest<WorkerSkillAssignment[]>('/api/workers/skills/assignments'),
          ]);
        if (!active) {
          return;
        }
        const sortedTasks = sortTasks(taskData);
        setTasks(sortedTasks);
        setSkills(sortSkills(skillData));
        setWorkers(sortWorkers(workerData));
        setStations(stationData);
        setSkillAssignments(assignmentData);
        setSelectedTaskId(null);
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error
              ? error.message
              : 'No se pudieron cargar las definiciones de tareas.';
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
            error instanceof Error ? error.message : 'No se pudieron cargar los detalles de tareas.';
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
        names.size ? Array.from(names).join(' / ') : `Secuencia ${sequence}`
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
        label: names.size ? Array.from(names).join(' / ') : `Secuencia ${sequence}`,
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

  const workerSkillsMap = useMemo(() => {
    const map = new Map<number, number[]>();
    skillAssignments.forEach((assignment) => {
      const list = map.get(assignment.worker_id);
      if (list) {
        list.push(assignment.skill_id);
      } else {
        map.set(assignment.worker_id, [assignment.skill_id]);
      }
    });
    return map;
  }, [skillAssignments]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (scopeFilter !== 'all') {
      result = result.filter((task) => task.scope === scopeFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter((task) => (statusFilter === 'active' ? task.active : !task.active));
    }
    const needle = query.trim().toLowerCase();
    if (needle) {
      result = result.filter((task) => task.name.toLowerCase().includes(needle));
    }
    return result;
  }, [query, tasks, scopeFilter, statusFilter]);

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
      return 'Mostrando tareas aux. La asignacion de estacion no filtra dependencias.';
    }
    if (draftSequenceOrder === null) {
      return `Mostrando tareas ${formatScopeLabel(
        draft.scope
      )}. Establezca una secuencia de estacion para filtrar anteriores.`;
    }
    if (!hasSequenceData) {
      return `Mostrando tareas ${formatScopeLabel(draft.scope)}.`;
    }
    return `Mostrando tareas ${formatScopeLabel(
      draft.scope
    )} en o antes de la secuencia ${draftSequenceOrder}.`;
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
    if (crewPriorityStationIds.size === 0 && draft.skill_id === null) {
      return matching;
    }
    const prioritized: Worker[] = [];
    const skillMatches: Worker[] = [];
    const stationMatches: Worker[] = [];
    const others: Worker[] = [];
    matching.forEach((worker) => {
      const assigned = worker.assigned_station_ids ?? [];
      const matchesStation = assigned.some((stationId) =>
        crewPriorityStationIds.has(stationId)
      );
      const workerSkills = workerSkillsMap.get(worker.id) ?? [];
      const matchesSkill =
        draft.skill_id !== null ? workerSkills.includes(draft.skill_id) : false;
      if (matchesStation && (matchesSkill || draft.skill_id === null)) {
        prioritized.push(worker);
      } else if (matchesSkill) {
        skillMatches.push(worker);
      } else if (matchesStation) {
        stationMatches.push(worker);
      } else {
        others.push(worker);
      }
    });
    return [...prioritized, ...skillMatches, ...stationMatches, ...others];
  }, [crewQuery, crewPriorityStationIds, draft.skill_id, workerSkillsMap, workers]);

  const dependencySummaryLabel = useMemo(() => {
    if (draft.dependencies_json.length === 0) {
      return 'No hay dependencias seleccionadas';
    }
    const names = draft.dependencies_json.map(
      (id) => taskNameById.get(id) ?? `Tarea ${id}`
    );
    if (names.length <= 2) {
      return names.join(', ');
    }
    return `${names[0]}, ${names[1]} +${names.length - 2}`;
  }, [draft.dependencies_json, taskNameById]);

  const crewNames = useMemo(
    () =>
      draft.regular_crew_worker_ids.map(
        (id) => workerNameById.get(id) ?? `Trabajador ${id}`
      ),
    [draft.regular_crew_worker_ids, workerNameById]
  );

  const crewSummaryLabel = useMemo(() => {
    if (crewNames.length === 0) {
      return 'No hay equipo seleccionado';
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
            ? 'AUX - Sin asignar'
            : auxStationLabelById.get(stationId) ?? `Estacion AUX ${stationId}`;
        const badge = stationId === null ? 'Sin estacion' : `ID de estacion ${stationId}`;
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
          ? 'Sin asignar'
          : catalogSequenceLabelByOrder.get(sequence) ?? `Secuencia ${sequence}`;
      const badge = sequence === null ? 'Sin secuencia' : `Sec ${sequence}`;
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

  const toggleAllGroups = () => {
    const allOpen = catalogGroups.every((g) => catalogOpenGroups[g.key] !== false);
    const newState: Record<string, boolean> = {};
    catalogGroups.forEach((g) => {
      newState[g.key] = !allOpen;
    });
    setCatalogOpenGroups(newState);
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
      throw new Error('El orden de secuencia de estacion debe ser un numero entero positivo.');
    }
    return parsed;
  };

  const handleSave = async () => {
    const name = draft.name.trim();
    if (!name) {
      setStatusMessage('Se requiere el nombre de la tarea.');
      return;
    }
    if (!draft.allow_all_workers && draft.allowed_worker_ids.length === 0) {
      setStatusMessage('Seleccione trabajadores permitidos o habilite a todos.');
      return;
    }

    let stationSequence: number | null = null;
    try {
      stationSequence = parseStationSequence();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Orden de secuencia de estacion invalido.';
      setStatusMessage(message);
      return;
    }

    const payload = {
      name,
      scope: draft.scope,
      default_station_sequence: stationSequence,
      active: draft.active,
      skippable: draft.scope === 'panel' ? draft.skippable : false,
      concurrent_allowed: draft.scope === 'aux' ? false : draft.concurrent_allowed,
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
      setStatusMessage('Guardado.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar la definicion de tarea.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft.id) {
      return;
    }
    if (!window.confirm('Eliminar esta definicion de tarea?')) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      await apiRequest<void>(`/api/task-definitions/${draft.id}`, { method: 'DELETE' });
      await loadTasks();
      setStatusMessage('Eliminada.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo eliminar la definicion de tarea.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const totalTasks = tasks.length;
  const moduleTasks = tasks.filter((task) => task.scope === 'module').length;
  const panelTasks = tasks.filter((task) => task.scope === 'panel').length;
  const auxTasks = tasks.filter((task) => task.scope === 'aux').length;
  const allGroupsOpen = catalogGroups.every((g) => catalogOpenGroups[g.key] !== false);

  return (
    <div className="flex flex-col lg:h-[calc(100vh-8rem)]">
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] flex-1 min-h-0">
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm lg:overflow-auto">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">Catalogo de tareas</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {totalTasks} total - {panelTasks} panel - {moduleTasks} modulo - {auxTasks} aux
              </p>
            </div>
            <div className="flex gap-2">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
                <input
                  type="search"
                  placeholder="Buscar tareas"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-9 rounded-full border border-black/10 bg-white pl-9 pr-4 text-sm"
                />
              </label>
              <button
                onClick={() => setShowFilters((prev) => !prev)}
                className={`inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm ${showFilters ? 'ring-2 ring-[var(--accent)]' : ''}`}
              >
                <Filter className="h-4 w-4" /> Filtros
              </button>
            </div>
          </div>
          {showFilters && (
            <div className="mt-3 flex flex-wrap gap-3">
              <select
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value as TaskScope | 'all')}
                className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm"
              >
                <option value="all">Todos los alcances</option>
                <option value="panel">Panel</option>
                <option value="module">Modulo</option>
                <option value="aux">Aux</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm"
              >
                <option value="all">Todos los estados</option>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <button
              onClick={toggleAllGroups}
              className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              {allGroupsOpen ? 'Colapsar todos' : 'Expandir todos'}
            </button>
          </div>

          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
              Cargando definiciones de tareas...
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
                            {group.badge} - {group.tasks.length} tareas
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
                                <span className="uppercase tracking-wider">
                                  {formatScopeLabel(task.scope)}
                                </span>
                                {task.scope === 'panel' && (
                                  <>
                                    <span>-</span>
                                    <span>{task.skippable ? 'Se puede omitir' : 'Requerida'}</span>
                                  </>
                                )}
                                {task.scope === 'module' && task.advance_trigger && (
                                  <>
                                    <span>-</span>
                                    <span className="text-emerald-600 font-medium">Gatillante</span>
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
              No hay tareas que coincidan con esta busqueda.
            </div>
          )}
        </section>

        <aside className="space-y-6 lg:overflow-auto">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  {draft.id ? 'Editar' : 'Crear'}
                </p>
                <h2 className="text-lg font-display text-[var(--ink)]">
                  {draft.name || 'Nueva definicion de tarea'}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAddTask}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                >
                  <Plus className="h-4 w-4" /> Nueva tarea
                </button>
                <ListChecks className="h-5 w-5 text-[var(--ink-muted)]" />
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.2)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Definicion
                </p>
                <div className="mt-3 space-y-3">
                  <label className="text-sm text-[var(--ink-muted)]">
                    Nombre de tarea
                    <input
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={draft.name}
                      onChange={(event) => updateDraft({ name: event.target.value })}
                    />
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm text-[var(--ink-muted)]">
                      Alcance
                      <select
                        className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                        value={draft.scope}
                        onChange={(event) => {
                          const scope = event.target.value as TaskScope;
                          const isPanel = scope === 'panel';
                          const isModule = scope === 'module';
                          const allowsConcurrency = scope !== 'aux';
                          updateDraft({
                            scope,
                            advance_trigger: isModule ? draft.advance_trigger : false,
                            skippable: isPanel ? draft.skippable : false,
                            concurrent_allowed: allowsConcurrency
                              ? draft.concurrent_allowed
                              : false,
                          });
                        }}
                      >
                        <option value="panel">panel</option>
                        <option value="module">modulo</option>
                        <option value="aux">aux</option>
                      </select>
                    </label>
                    <label className="text-sm text-[var(--ink-muted)]">
                      Estado
                      <select
                        className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                        value={draft.active ? 'Activo' : 'Inactivo'}
                        onChange={(event) =>
                          updateDraft({ active: event.target.value === 'Activo' })
                        }
                      >
                        <option value="Activo">Activo</option>
                        <option value="Inactivo">Inactivo</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm text-[var(--ink-muted)]">
                      {draft.scope === 'aux' ? 'Estacion AUX' : 'Secuencia de estacion'}
                      <select
                        className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                        value={draft.station_sequence_order}
                        onChange={(event) =>
                          updateDraft({ station_sequence_order: event.target.value })
                        }
                      >
                        <option value="">Sin asignar</option>
                        {stationSequenceChoices.map((option) => (
                          <option key={option.sequence} value={String(option.sequence)}>
                            {draft.scope === 'aux'
                              ? `${option.label} (ID ${option.sequence})`
                              : `${option.label} (Sec ${option.sequence})`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm text-[var(--ink-muted)]">
                      Especialidad
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
                        <option value="">Ninguna</option>
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
                  Comportamiento
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
                        Omitible
                      </label>
                      <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                        <input
                          type="checkbox"
                          checked={draft.concurrent_allowed}
                          onChange={(event) =>
                            updateDraft({ concurrent_allowed: event.target.checked })
                          }
                        />{' '}
                        Concurrencia permitida
                      </label>
                    </>
                  )}
                  {draft.scope === 'module' && (
                    <>
                      <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                        <input
                          type="checkbox"
                          checked={draft.concurrent_allowed}
                          onChange={(event) =>
                            updateDraft({ concurrent_allowed: event.target.checked })
                          }
                        />{' '}
                        Concurrencia permitida
                      </label>
                      <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                        <input
                          type="checkbox"
                          checked={draft.advance_trigger}
                          onChange={(event) =>
                            updateDraft({ advance_trigger: event.target.checked })
                          }
                        />{' '}
                        Gatilla avance
                      </label>
                    </>
                  )}
                  {draft.scope === 'aux' && (
                    <p className="text-xs text-[var(--ink-muted)]">
                      No hay opciones de comportamiento para tareas AUX.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-black/5 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Dependencias
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
                            placeholder="Filtrar dependencias"
                            value={dependencyQuery}
                            onChange={(event) => setDependencyQuery(event.target.value)}
                            className="w-full bg-transparent text-xs outline-none"
                          />
                        </label>
                        <div className="mt-2 max-h-48 overflow-auto rounded-xl border border-black/5 bg-[rgba(201,215,245,0.15)] p-2 text-xs">
                          {availableDependencyTasks.length === 0 ? (
                            <p className="text-[var(--ink-muted)]">
                              No hay tareas elegibles para este alcance/secuencia.
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
                              No hay tareas que coincidan con esa busqueda.
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
                  Control de acceso
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
                    Todos pueden realizar esta tarea
                  </label>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Desactive para restringir la ejecucion a una lista especifica de trabajadores.
                  </p>
                  {draft.allow_all_workers && (
                    <p className="text-xs text-[var(--ink-muted)]">
                      La seleccion de trabajadores permitidos se ignora mientras todos estan permitidos.
                    </p>
                  )}
                  <div
                    className={`space-y-2 ${
                      draft.allow_all_workers ? 'pointer-events-none opacity-60' : ''
                    }`}
                  >
                    <p className="text-sm text-[var(--ink-muted)]">
                      Trabajadores permitidos ({draft.allowed_worker_ids.length})
                    </p>
                    <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                      <Search className="h-3.5 w-3.5" />
                      <input
                        placeholder="Buscar trabajadores"
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
                                  Inactivo
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[var(--ink-muted)]">No se encontraron trabajadores.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-black/5 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Cuadrilla habitual
                </p>
                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                  Lista de favoritos para inicios de grupo. Esto no restringe quien puede realizar la tarea.
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.15)] p-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                      Seleccionados ({draft.regular_crew_worker_ids.length})
                    </p>
                    <p className="text-sm font-medium text-[var(--ink)]">{crewSummaryLabel}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCrewModalOpen(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)] shadow-sm"
                  >
                    <Users className="h-3.5 w-3.5" /> Administrar
                  </button>
                </div>
              </div>

              {detailsLoading && (
                <p className="rounded-2xl border border-black/5 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                  Cargando detalles de tareas...
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
                  {saving ? 'Guardando...' : 'Guardar tarea'}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={saving || !draft.id}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink-muted)] disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" /> Eliminar
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
                  Cuadrilla habitual
                </p>
                <h3 className="text-lg font-display text-[var(--ink)]">
                  Seleccionar miembros del equipo
                </h3>
                <p className="text-xs text-[var(--ink-muted)]">
                  {draft.name || 'Nueva definicion de tarea'}
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
                  placeholder="Buscar equipo"
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
                            Inactivo
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-[var(--ink-muted)]">No se encontraron trabajadores.</p>
                )}
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setCrewModalOpen(false)}
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskDefs;
