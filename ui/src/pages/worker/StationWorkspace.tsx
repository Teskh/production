import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  CheckSquare,
  FastForward,
  MessageSquare,
  Pause,
  Play,
  Users,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import type { StationContext } from '../../utils/stationContext';
import {
  AUTOFOCUS_PREV_CONTEXT_KEY,
  SPECIFIC_STATION_ID_STORAGE_KEY,
  STATION_CONTEXT_STORAGE_KEY,
  formatStationContext,
  formatStationLabel,
  getAssemblySequenceOrders,
  getContextLabel,
  getStationsForContext,
  isStationInContext,
  parseStationContext,
} from '../../utils/stationContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const MAX_W1_PLANNED = 10;

type Worker = {
  id: number;
  first_name: string;
  last_name: string;
  active: boolean;
  login_required: boolean;
  assigned_station_ids?: number[] | null;
};

const firstNamePart = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.split(/\s+/)[0] ?? '';
};

const surnamePart = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return parts[0] ?? '';
  }
  return parts[parts.length - 2] ?? '';
};

const formatWorkerDisplayName = (worker: Pick<Worker, 'first_name' | 'last_name'>): string => {
  const first = firstNamePart(worker.first_name);
  const last = surnamePart(worker.last_name);
  return [first, last].filter(Boolean).join(' ');
};

const formatWorkerFullName = (worker: Pick<Worker, 'first_name' | 'last_name'>): string =>
  `${worker.first_name} ${worker.last_name}`.trim();

const normalizeQrValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

type Station = {
  id: number;
  name: string;
  role: string;
  line_type: string | null;
  sequence_order: number | null;
};

const formatStationRoleLabel = (role: Station['role']): string => {
  if (role === 'Panels') {
    return 'Paneles';
  }
  if (role === 'Assembly') {
    return 'Ensamble';
  }
  if (role === 'AUX') {
    return 'Auxiliares';
  }
  return role;
};

type StationPickerMode =
  | { kind: 'station_list' }
  | { kind: 'panel_line' }
  | { kind: 'aux' }
  | { kind: 'assembly_sequence'; sequenceOrder: number };

type PauseReason = {
  id: number;
  name: string;
  applicable_station_ids: number[] | null;
};

type CommentTemplate = {
  id: number;
  text: string;
  applicable_station_ids: number[] | null;
};

type StationTask = {
  task_definition_id: number;
  task_instance_id: number | null;
  name: string;
  scope: string;
  station_sequence_order: number | null;
  status: string;
  skippable: boolean;
  concurrent_allowed: boolean;
  advance_trigger: boolean;
  dependencies_satisfied?: boolean;
  dependencies_missing_names?: string[];
  worker_allowed?: boolean;
  allowed_worker_names?: string[];
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  current_worker_participating?: boolean;
  backlog?: boolean;
};

const buildTaskNameKey = (task: StationTask, workItemId: string): string =>
  `${workItemId}-${task.task_instance_id ?? `definition-${task.task_definition_id}`}`;

type StationWorkItem = {
  id: string;
  scope: string;
  work_unit_id: number;
  panel_unit_id: number | null;
  panel_definition_id: number | null;
  module_number: number;
  project_name: string;
  house_identifier: string;
  house_type_name: string;
  sub_type_name: string | null;
  panel_code: string | null;
  status: string;
  tasks: StationTask[];
  other_tasks: StationTask[];
  backlog_tasks: StationTask[];
  recommended: boolean;
};

type StationSnapshot = {
  station: Station;
  work_items: StationWorkItem[];
  planned_total_count?: number;
  pause_reasons: PauseReason[];
  comment_templates: CommentTemplate[];
  worker_active_nonconcurrent_task_instance_ids?: number[];
  qc_rework_tasks?: StationQCReworkTask[];
  qc_notification_count?: number;
};

type WorkerSessionResponse = {
  worker: Worker;
  station_id: number | null;
  require_pin_change: boolean;
  idle_timeout_seconds: number | null;
};

type TaskRegularCrewResponse = {
  worker_ids: number[];
};

type WorkerActiveTask = {
  task_instance_id: number;
  station_id: number;
  current_station_id: number | null;
  work_unit_id: number;
  panel_unit_id: number | null;
  module_number: number | null;
  panel_code: string | null;
  status: string;
  started_at: string | null;
};

type StationQCReworkTask = {
  id: number;
  check_instance_id: number;
  check_name: string | null;
  description: string;
  status: string;
  task_status: string | null;
  work_unit_id: number;
  panel_unit_id: number | null;
  module_number: number;
  panel_code: string | null;
  station_id: number | null;
  created_at: string;
  failure_notes: string | null;
  failure_modes: string[];
  evidence_uris: string[];
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

const parseStoredStationId = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  const id = Number(value);
  return Number.isNaN(id) ? null : id;
};

const modeFromContext = (context: StationContext | null): StationPickerMode => {
  if (!context) {
    return { kind: 'station_list' };
  }
  if (context.kind === 'panel_line') {
    return { kind: 'panel_line' };
  }
  if (context.kind === 'aux') {
    return { kind: 'aux' };
  }
  if (context.kind === 'assembly_sequence') {
    return { kind: 'assembly_sequence', sequenceOrder: context.sequenceOrder };
  }
  return { kind: 'station_list' };
};

const persistStationContext = (context: StationContext | null) => {
  if (!context) {
    localStorage.removeItem(STATION_CONTEXT_STORAGE_KEY);
    return;
  }
  localStorage.setItem(STATION_CONTEXT_STORAGE_KEY, formatStationContext(context));
};

const persistSpecificStationId = (stationId: number | null) => {
  if (stationId === null) {
    localStorage.removeItem(SPECIFIC_STATION_ID_STORAGE_KEY);
    return;
  }
  localStorage.setItem(SPECIFIC_STATION_ID_STORAGE_KEY, String(stationId));
};

const pickAutoFocusTarget = (tasks: WorkerActiveTask[]): WorkerActiveTask | null => {
  if (tasks.length === 0) {
    return null;
  }
  const inProgress = tasks.filter((task) => task.status === 'InProgress');
  const paused = tasks.filter((task) => task.status === 'Paused');
  const candidates = inProgress.length > 0 ? inProgress : paused;
  if (candidates.length === 0) {
    return null;
  }
  return candidates.sort((a, b) => {
    const aTime = a.started_at ? Date.parse(a.started_at) : 0;
    const bTime = b.started_at ? Date.parse(b.started_at) : 0;
    if (aTime !== bTime) {
      return bTime - aTime;
    }
    return b.task_instance_id - a.task_instance_id;
  })[0];
};

const resolveAutoFocusStationId = (task: WorkerActiveTask): number =>
  task.current_station_id ?? task.station_id;

const buildAutoFocusNotice = (station: Station | null, task: WorkerActiveTask): string => {
  const stationLabel = station ? formatStationLabel(station) : 'la estacion de tu tarea';
  const moduleLabel = task.module_number !== null ? ` Modulo ${task.module_number}` : '';
  const panelLabel = task.panel_code ? ` Panel ${task.panel_code}` : '';
  return `Redirigido automaticamente a ${stationLabel}${moduleLabel}${panelLabel} porque tiene una tarea a medio andar`;
};

const StationWorkspace: React.FC = () => {
  const navigate = useNavigate();
  const [worker, setWorker] = useState<Worker | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [stationContext, setStationContext] = useState<StationContext | null>(null);
  const [snapshot, setSnapshot] = useState<StationSnapshot | null>(null);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idleTimeoutMs, setIdleTimeoutMs] = useState<number | null>(null);
  const [showContextPicker, setShowContextPicker] = useState(false);
  const [showStationPicker, setShowStationPicker] = useState(false);
  const [stationPickerMode, setStationPickerMode] = useState<StationPickerMode>({
    kind: 'station_list',
  });
  const [autoFocusTarget, setAutoFocusTarget] = useState<WorkerActiveTask | null>(null);
  const [autoFocusNotice, setAutoFocusNotice] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<
    'pause' | 'skip' | 'comments' | 'crew' | 'other_tasks' | 'rework_details' | null
  >(null);
  const [selectedTask, setSelectedTask] = useState<StationTask | null>(null);
  const [selectedTaskWorkItem, setSelectedTaskWorkItem] = useState<StationWorkItem | null>(null);
  const [selectedRework, setSelectedRework] = useState<StationQCReworkTask | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [crewWorkers, setCrewWorkers] = useState<Worker[]>([]);
  const [crewSelection, setCrewSelection] = useState<number[]>([]);
  const [expandedTaskNames, setExpandedTaskNames] = useState<Set<string>>(() => new Set());
  const [crewQuery, setCrewQuery] = useState('');
  const [regularCrewByTaskId, setRegularCrewByTaskId] = useState<Record<number, number[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const idleTimerRef = useRef<number | null>(null);
  const snapshotRequestIdRef = useRef(0);
  const autoFocusAppliedRef = useRef(false);
  const lastSelectedWorkItemRef = useRef<{
    work_unit_id: number;
    panel_unit_id: number | null;
    panel_definition_id: number | null;
  } | null>(null);

  const selectedStation = useMemo(
    () => stations.find((station) => station.id === selectedStationId) ?? null,
    [stations, selectedStationId]
  );

  const selectedWorkItem = useMemo(
    () => snapshot?.work_items.find((item) => item.id === selectedWorkItemId) ?? null,
    [snapshot, selectedWorkItemId]
  );

  useEffect(() => {
    if (!selectedWorkItem) {
      return;
    }
    lastSelectedWorkItemRef.current = {
      work_unit_id: selectedWorkItem.work_unit_id,
      panel_unit_id: selectedWorkItem.panel_unit_id,
      panel_definition_id: selectedWorkItem.panel_definition_id,
    };
  }, [selectedWorkItem]);

  const toggleTaskNameExpansion = useCallback((key: string) => {
    setExpandedTaskNames((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const assemblySequenceOrders = useMemo(
    () => getAssemblySequenceOrders(stations),
    [stations]
  );

  const contextOptions = useMemo(() => {
    const options: Array<{
      label: string;
      mode: StationPickerMode;
      context: StationContext | null;
    }> = [
      { label: 'Estacion especifica', mode: { kind: 'station_list' }, context: null },
    ];
    if (stations.some((station) => station.role === 'Panels')) {
      options.push({
        label: getContextLabel({ kind: 'panel_line' }, stations),
        mode: { kind: 'panel_line' },
        context: { kind: 'panel_line' },
      });
    }
    assemblySequenceOrders.forEach((order) => {
      options.push({
        label: getContextLabel({ kind: 'assembly_sequence', sequenceOrder: order }, stations),
        mode: { kind: 'assembly_sequence', sequenceOrder: order },
        context: { kind: 'assembly_sequence', sequenceOrder: order },
      });
    });
    if (stations.some((station) => station.role === 'AUX')) {
      options.push({
        label: getContextLabel({ kind: 'aux' }, stations),
        mode: { kind: 'aux' },
        context: { kind: 'aux' },
      });
    }
    return options;
  }, [assemblySequenceOrders, stations]);

  const stationPickerStations = useMemo(() => {
    if (stationPickerMode.kind === 'panel_line') {
      return getStationsForContext(stations, { kind: 'panel_line' });
    }
    if (stationPickerMode.kind === 'aux') {
      return getStationsForContext(stations, { kind: 'aux' });
    }
    if (stationPickerMode.kind === 'assembly_sequence') {
      return getStationsForContext(stations, {
        kind: 'assembly_sequence',
        sequenceOrder: stationPickerMode.sequenceOrder,
      });
    }
    return [...stations].sort((a, b) => a.id - b.id);
  }, [stationPickerMode, stations]);

  const stationSelectionRequired =
    stationContext !== null && stationContext.kind !== 'station' && !selectedStationId;
  const contextSelectionRequired = stationContext === null;

  const sessionStations = useMemo(() => {
    if (!stationContext || stationContext.kind === 'station') {
      return [];
    }
    return getStationsForContext(stations, stationContext);
  }, [stationContext, stations]);

  const workItems = useMemo(() => snapshot?.work_items ?? [], [snapshot?.work_items]);
  const isW1 = selectedStation?.role === 'Panels' && selectedStation.sequence_order === 1;
  const isMagazineStation = selectedStation?.role === 'Magazine';
  const plannedTotalOverride = snapshot?.planned_total_count;
  const { recommendedItem, inProgressItems, plannedItems, otherItems, plannedTotalCount } =
    useMemo(() => {
      if (!isW1) {
        return {
          recommendedItem: null,
          inProgressItems: workItems,
          plannedItems: [],
          otherItems: [],
          plannedTotalCount: 0,
        };
      }
      let recommended: StationWorkItem | null = null;
      const inProgress: StationWorkItem[] = [];
      const planned: StationWorkItem[] = [];
      const other: StationWorkItem[] = [];
      let plannedCount = 0;
      for (const item of workItems) {
        if (item.recommended && !recommended) {
          recommended = item;
          continue;
        }
        if (item.status === 'InProgress') {
          inProgress.push(item);
          continue;
        }
        if (item.status === 'Planned') {
          plannedCount += 1;
          if (planned.length < MAX_W1_PLANNED) {
            planned.push(item);
          }
          continue;
        }
        other.push(item);
      }
      return {
        recommendedItem: recommended,
        inProgressItems: inProgress,
        plannedItems: planned,
        otherItems: other,
        plannedTotalCount: plannedTotalOverride ?? plannedCount,
      };
    }, [isW1, plannedTotalOverride, workItems]);

  const pauseReasons = snapshot?.pause_reasons ?? [];
  const commentTemplates = snapshot?.comment_templates ?? [];
  const hasLongCommentTemplateList = commentTemplates.length > 6;
  const activeNonConcurrentTaskIds = useMemo(
    () => snapshot?.worker_active_nonconcurrent_task_instance_ids ?? [],
    [snapshot?.worker_active_nonconcurrent_task_instance_ids]
  );
  const qcReworkTasks = useMemo(() => snapshot?.qc_rework_tasks ?? [], [snapshot?.qc_rework_tasks]);
  const qcNotificationCount = snapshot?.qc_notification_count ?? 0;
  const selectedReworkTasks = useMemo(() => {
    if (!selectedWorkItem) {
      return [];
    }
    return qcReworkTasks.filter((rework) => {
      if (rework.work_unit_id !== selectedWorkItem.work_unit_id) {
        return false;
      }
      if (selectedWorkItem.panel_unit_id) {
        return rework.panel_unit_id === selectedWorkItem.panel_unit_id;
      }
      return rework.panel_unit_id === null;
    });
  }, [qcReworkTasks, selectedWorkItem]);

  const formatReworkStatus = (status: string) => {
    switch (status) {
      case 'Open':
        return 'Abierto';
      case 'InProgress':
        return 'En curso';
      case 'Done':
        return 'Completado';
      case 'Canceled':
        return 'Cancelado';
      default:
        return status;
    }
  };

  const reworkStatusClass = (status: string) => {
    switch (status) {
      case 'Open':
        return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'InProgress':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Done':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'Canceled':
        return 'bg-gray-100 text-gray-600 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  };

  const hasBlockingNonConcurrent = useCallback(
    (taskInstanceId?: number | null) => {
      if (activeNonConcurrentTaskIds.length === 0) {
        return false;
      }
      if (!taskInstanceId) {
        return true;
      }
      return activeNonConcurrentTaskIds.some((id) => id !== taskInstanceId);
    },
    [activeNonConcurrentTaskIds]
  );

  const canStartTask = useCallback(
    (task: StationTask, taskInstanceId?: number | null) => {
      if (task.concurrent_allowed) {
        return true;
      }
      return !hasBlockingNonConcurrent(taskInstanceId);
    },
    [hasBlockingNonConcurrent]
  );

  const isDependenciesSatisfied = (task: StationTask) => task.dependencies_satisfied ?? true;

  const isWorkerAllowed = (task: StationTask, workerParticipating: boolean) =>
    (task.worker_allowed ?? true) || workerParticipating;

  const dependencyBlockedLabel = (task: StationTask) => {
    if (isDependenciesSatisfied(task)) {
      return '';
    }
    const missing = task.dependencies_missing_names ?? [];
    if (missing.length === 0) {
      return 'Falta terminar tareas requeridas.';
    }
    return `Falta terminar ${missing.join(', ')}`;
  };

  const workerRestrictionLabel = (task: StationTask) => {
    if (task.worker_allowed ?? true) {
      return '';
    }
    const names = task.allowed_worker_names ?? [];
    if (names.length === 0) {
      return 'Restringido a trabajadores asignados.';
    }
    return `Restringido a ${names.join(', ')}`;
  };

  const buildBlockReason = ({
    dependencyMessage,
    workerMessage,
    concurrencyBlocked,
    concurrencyAction,
  }: {
    dependencyMessage?: string;
    workerMessage?: string;
    concurrencyBlocked?: boolean;
    concurrencyAction?: string;
  }) => {
    const reasons: string[] = [];
    const actionLabelMap: Record<string, string> = {
      starting: 'iniciar',
      resuming: 'reanudar',
      joining: 'unirse',
    };
    const actionLabel = concurrencyAction ? actionLabelMap[concurrencyAction] ?? 'iniciar' : 'iniciar';
    if (dependencyMessage) {
      reasons.push(dependencyMessage);
    }
    if (workerMessage) {
      reasons.push(workerMessage);
    }
    if (concurrencyBlocked) {
      reasons.push(`Termina tu tarea actual antes de ${actionLabel} otra.`);
    }
    return reasons.join(' ');
  };

  const handleLogout = useCallback(async () => {
    try {
      await apiRequest('/api/worker-sessions/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    const prevContext = localStorage.getItem(AUTOFOCUS_PREV_CONTEXT_KEY);
    if (prevContext) {
      localStorage.setItem(STATION_CONTEXT_STORAGE_KEY, prevContext);
      localStorage.removeItem(AUTOFOCUS_PREV_CONTEXT_KEY);
    }
    persistSpecificStationId(null);
    navigate('/login');
  }, [navigate]);

  const loadSnapshot = useCallback(async (stationId: number) => {
    const requestId = snapshotRequestIdRef.current + 1;
    snapshotRequestIdRef.current = requestId;
    setSnapshotLoading(true);
    try {
      const data = await apiRequest<StationSnapshot>(
        `/api/worker-stations/${stationId}/snapshot?planned_limit=${MAX_W1_PLANNED}`
      );
      if (snapshotRequestIdRef.current !== requestId) {
        return;
      }
      setSnapshot(data);
      setError(null);
    } catch (err) {
      if (snapshotRequestIdRef.current !== requestId) {
        return;
      }
      const message = err instanceof Error ? err.message : 'No se pudo cargar la estacion.';
      setError(message);
    } finally {
      if (snapshotRequestIdRef.current === requestId) {
        setSnapshotLoading(false);
      }
    }
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!selectedStationId) {
      return;
    }
    await loadSnapshot(selectedStationId);
  }, [loadSnapshot, selectedStationId]);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      try {
        const session = await apiRequest<WorkerSessionResponse>('/api/worker-sessions/me');
        setWorker(session.worker);
        setIdleTimeoutMs(
          session.idle_timeout_seconds ? session.idle_timeout_seconds * 1000 : null
        );
        const stationData = await apiRequest<Station[]>('/api/stations');
        setStations(stationData);
        const storedContext = parseStationContext(
          localStorage.getItem(STATION_CONTEXT_STORAGE_KEY)
        );
        const storedStationId = parseStoredStationId(
          localStorage.getItem(SPECIFIC_STATION_ID_STORAGE_KEY)
        );
        let resolvedContext = storedContext;
        if (!resolvedContext) {
          const fallbackStationId = session.station_id ?? storedStationId;
          if (fallbackStationId && stationData.some((station) => station.id === fallbackStationId)) {
            resolvedContext = { kind: 'station', stationId: fallbackStationId };
            persistStationContext(resolvedContext);
          }
        }
        let normalizedContext = resolvedContext;
        if (normalizedContext && normalizedContext.kind === 'station') {
          const stationId = normalizedContext.stationId;
          const exists = stationData.some((station) => station.id === stationId);
          if (!exists) {
            normalizedContext = null;
          }
        }
        setStationContext(normalizedContext);
        setStationPickerMode(modeFromContext(normalizedContext));
        let resolvedStationId: number | null = null;
        if (normalizedContext && normalizedContext.kind === 'station') {
          resolvedStationId = normalizedContext.stationId;
        } else if (normalizedContext) {
          const candidateId = session.station_id ?? storedStationId;
          if (candidateId) {
            const station = stationData.find((item) => item.id === candidateId);
            if (station && isStationInContext(station, normalizedContext)) {
              resolvedStationId = candidateId;
            }
          }
        }
        setSelectedStationId(resolvedStationId);
        if (!normalizedContext) {
          setShowContextPicker(true);
        } else if (normalizedContext.kind !== 'station' && !resolvedStationId) {
          setShowStationPicker(true);
        }
        if (
          normalizedContext &&
          normalizedContext.kind !== 'station' &&
          storedStationId &&
          !resolvedStationId
        ) {
          persistSpecificStationId(null);
        }
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sesion de trabajador expirada.';
        setError(message);
        navigate('/login');
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, [navigate]);

  useEffect(() => {
    if (!selectedStationId) {
      return;
    }
    apiRequest('/api/worker-sessions/station', {
      method: 'PUT',
      body: JSON.stringify({ station_id: selectedStationId }),
    }).catch(() => undefined);
    loadSnapshot(selectedStationId);
  }, [loadSnapshot, selectedStationId]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    if (snapshot.work_items.length === 0) {
      setSelectedWorkItemId(null);
      return;
    }
    if (!selectedWorkItemId) {
      if (snapshot.work_items.length === 1) {
        setSelectedWorkItemId(snapshot.work_items[0].id);
      }
      return;
    }
    const exists = snapshot.work_items.some((item) => item.id === selectedWorkItemId);
    if (exists) {
      return;
    }
    const lastSelected = lastSelectedWorkItemRef.current;
    if (lastSelected) {
      const fallback = snapshot.work_items.find((item) => {
        if (lastSelected.panel_unit_id) {
          return item.panel_unit_id === lastSelected.panel_unit_id;
        }
        if (
          lastSelected.panel_definition_id &&
          item.panel_definition_id === lastSelected.panel_definition_id &&
          item.work_unit_id === lastSelected.work_unit_id
        ) {
          return true;
        }
        return (
          item.work_unit_id === lastSelected.work_unit_id &&
          item.panel_unit_id === lastSelected.panel_unit_id
        );
      });
      if (fallback) {
        setSelectedWorkItemId(fallback.id);
        return;
      }
    }
    setSelectedWorkItemId(snapshot.work_items.length === 1 ? snapshot.work_items[0].id : null);
  }, [snapshot, selectedWorkItemId]);

  useEffect(() => {
    if (!worker || !idleTimeoutMs) {
      return;
    }
    const resetTimer = () => {
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current);
      }
      idleTimerRef.current = window.setTimeout(() => {
        handleLogout();
      }, idleTimeoutMs);
    };
    resetTimer();
    const events = ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'];
    events.forEach((event) => window.addEventListener(event, resetTimer));
    return () => {
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current);
      }
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [handleLogout, idleTimeoutMs, worker]);

  useEffect(() => {
    if (!worker || loading) {
      return;
    }
    let active = true;
    const loadActiveTasks = async () => {
      try {
        const tasks = await apiRequest<WorkerActiveTask[]>('/api/worker-tasks/active');
        if (!active) {
          return;
        }
        setAutoFocusTarget(pickAutoFocusTarget(tasks));
      } catch {
        if (!active) {
          return;
        }
        setAutoFocusTarget(null);
      }
    };
    loadActiveTasks();
    return () => {
      active = false;
    };
  }, [loading, worker]);

  useEffect(() => {
    if (loading || !autoFocusTarget || autoFocusAppliedRef.current) {
      return;
    }
    const targetStationId = resolveAutoFocusStationId(autoFocusTarget);
    if (selectedStationId !== targetStationId) {
      const prevContext = localStorage.getItem(STATION_CONTEXT_STORAGE_KEY);
      if (prevContext && !localStorage.getItem(AUTOFOCUS_PREV_CONTEXT_KEY)) {
        localStorage.setItem(AUTOFOCUS_PREV_CONTEXT_KEY, prevContext);
      }
      const context: StationContext = {
        kind: 'station',
        stationId: targetStationId,
      };
      setStationContext(context);
      persistStationContext(context);
      persistSpecificStationId(targetStationId);
      setSelectedStationId(targetStationId);
      setSelectedWorkItemId(null);
      setShowStationPicker(false);
      const station = stations.find((item) => item.id === targetStationId) ?? null;
      setAutoFocusNotice(buildAutoFocusNotice(station, autoFocusTarget));
    }
    autoFocusAppliedRef.current = true;
  }, [autoFocusTarget, loading, selectedStationId, stations]);

  useEffect(() => {
    if (!autoFocusTarget || !snapshot) {
      return;
    }
    const targetStationId = resolveAutoFocusStationId(autoFocusTarget);
    if (!targetStationId) {
      return;
    }
    if (selectedWorkItemId || selectedStationId !== targetStationId) {
      return;
    }
    const targetItem = snapshot.work_items.find((item) => {
      if (autoFocusTarget.panel_unit_id) {
        return item.panel_unit_id === autoFocusTarget.panel_unit_id;
      }
      return item.work_unit_id === autoFocusTarget.work_unit_id && item.panel_unit_id === null;
    });
    if (targetItem) {
      setSelectedWorkItemId(targetItem.id);
    }
  }, [autoFocusTarget, selectedStationId, selectedWorkItemId, snapshot]);

  const taskDefinitionIds = useMemo(() => {
    const ids = new Set<number>();
    snapshot?.work_items.forEach((item) => {
      item.tasks.forEach((task) => {
        ids.add(task.task_definition_id);
      });
      item.backlog_tasks.forEach((task) => {
        ids.add(task.task_definition_id);
      });
      item.other_tasks.forEach((task) => {
        ids.add(task.task_definition_id);
      });
    });
    return Array.from(ids);
  }, [snapshot]);

  useEffect(() => {
    if (taskDefinitionIds.length === 0) {
      return;
    }
    const missingIds = taskDefinitionIds.filter(
      (id) => regularCrewByTaskId[id] === undefined
    );
    if (missingIds.length === 0) {
      return;
    }
    let active = true;
    const loadRegularCrew = async () => {
      const results = await Promise.all(
        missingIds.map(async (id) => {
          try {
            const data = await apiRequest<TaskRegularCrewResponse>(
              `/api/task-definitions/${id}/regular-crew`
            );
            return { id, crew: data.worker_ids ?? [] };
          } catch {
            return { id, crew: [] };
          }
        })
      );
      if (!active) {
        return;
      }
      setRegularCrewByTaskId((prev) => {
        const next = { ...prev };
        results.forEach(({ id, crew }) => {
          next[id] = crew;
        });
        return next;
      });
    };
    loadRegularCrew();
    return () => {
      active = false;
    };
  }, [taskDefinitionIds, regularCrewByTaskId]);

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      NotStarted: 'bg-gray-100 text-gray-600 border-gray-200',
      InProgress: 'bg-blue-100 text-blue-700 border-blue-200',
      Paused: 'bg-amber-100 text-amber-700 border-amber-200',
      Completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      Skipped: 'bg-slate-100 text-slate-600 border-slate-200',
      Planned: 'bg-slate-100 text-slate-600 border-slate-200',
    };
    const labels: Record<string, string> = {
      NotStarted: 'Pendiente',
      InProgress: 'En progreso',
      Paused: 'En pausa',
      Completed: 'Completada',
      Skipped: 'Omitida',
      Planned: 'Sin comenzar',
      Assembly: 'Armado',
    };
    return (
      <span
        className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase border ${
          styles[status] ?? 'bg-gray-100 text-gray-600 border-gray-200'
        }`}
      >
        {labels[status] ?? status}
      </span>
    );
  };

  const renderWorkItemDetails = (item: StationWorkItem) => {
    const hasPanel = Boolean(item.panel_code);
    return (
      <>
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold uppercase tracking-wide text-gray-700">
            <span className="text-blue-600">{item.house_identifier}</span>
            <span className="mx-1 text-gray-400">-</span>
            <span className="text-emerald-600">M{item.module_number}</span>
          </div>
          {statusBadge(item.status)}
        </div>
        {hasPanel ? (
          <>
            <div className="mt-2 text-base font-semibold text-gray-900">
              {item.panel_code}
            </div>
            <div className="text-xs text-gray-600">{item.project_name}</div>
          </>
        ) : (
          <div className="mt-2 text-sm font-semibold text-gray-900">{item.project_name}</div>
        )}
        <div className="mt-1 text-xs text-gray-500">
          {item.house_type_name}
          {item.sub_type_name ? ` - ${item.sub_type_name}` : ''}
        </div>
      </>
    );
  };

  const sortTasksForDisplay = (tasks: StationTask[]) => {
    return [...tasks].sort((a, b) => {
      const aCompleted = a.status === 'Completed';
      const bCompleted = b.status === 'Completed';
      if (aCompleted !== bCompleted) {
        return aCompleted ? 1 : -1;
      }
      return 0;
    });
  };

  const renderTaskCard = (task: StationTask, workItem: StationWorkItem) => {
    const isCompleted = task.status === 'Completed';
    const workerParticipating = task.current_worker_participating ?? false;
    const dependencyBlocked = !isDependenciesSatisfied(task);
    const workerRestricted = !isWorkerAllowed(task, workerParticipating);
    const dependencyMessage = dependencyBlockedLabel(task);
    const workerMessage = workerRestrictionLabel(task);
    const joinConcurrencyBlocked = !canStartTask(task, task.task_instance_id);
    const startConcurrencyBlocked = !canStartTask(task);
    const joinBlocked = workerRestricted || joinConcurrencyBlocked;
    const startBlocked = dependencyBlocked || workerRestricted || startConcurrencyBlocked;
    const resumeBlocked = dependencyBlocked || workerRestricted || joinConcurrencyBlocked;
    const restrictionNote = [dependencyMessage || null, workerMessage || null]
      .filter(Boolean)
      .join(' - ');
    const startBlockTitle = buildBlockReason({
      dependencyMessage,
      workerMessage,
      concurrencyBlocked: startConcurrencyBlocked,
      concurrencyAction: 'starting',
    });
    const resumeBlockTitle = buildBlockReason({
      dependencyMessage,
      workerMessage,
      concurrencyBlocked: joinConcurrencyBlocked,
      concurrencyAction: 'resuming',
    });
    const joinBlockTitle = buildBlockReason({
      workerMessage,
      concurrencyBlocked: joinConcurrencyBlocked,
      concurrencyAction: 'joining',
    });
    const completeLabel = task.advance_trigger ? 'Terminar y avanzar' : 'Terminar';
    const taskNameKey = buildTaskNameKey(task, workItem.id);
    const isTaskNameExpanded = expandedTaskNames.has(taskNameKey);
    return (
      <div
        key={task.task_definition_id}
        className={clsx(
          'rounded-xl border p-4 transition-all',
          isCompleted
            ? 'border-gray-200 bg-gray-50/70 opacity-70'
            : task.status === 'InProgress'
            ? 'border-blue-200 bg-blue-50/50'
            : task.status === 'Paused'
            ? 'border-amber-200 bg-amber-50/50'
            : 'border-gray-200 bg-white'
        )}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => toggleTaskNameExpansion(taskNameKey)}
                title={task.name}
                aria-expanded={isTaskNameExpanded}
                className={clsx(
                  'min-w-0 flex-1 text-left text-lg font-semibold text-gray-900',
                  isTaskNameExpanded ? 'whitespace-normal break-words' : 'truncate'
                )}
              >
                {task.name}
              </button>
              <div className="shrink-0">{statusBadge(task.status)}</div>
              {task.advance_trigger && (
                <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-slate-100 text-slate-600 border-slate-200">
                  Avanza estacion
                </span>
              )}
            </div>
            {restrictionNote &&
              (task.status === 'NotStarted' ||
                task.status === 'Paused' ||
                (!workerParticipating && task.status === 'InProgress')) && (
                <div className="mt-1 text-xs font-semibold text-rose-600">
                  {restrictionNote}
                </div>
              )}
            {task.notes && (
              <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-gray-100 bg-white/70 px-2 py-1 text-xs text-gray-600">
                <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
                <span className="truncate max-w-md">{task.notes}</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {task.status === 'InProgress' &&
              (workerParticipating ? (
                <>
                  <button
                    onClick={() => openModal('comments', task, workItem)}
                    className="inline-flex items-center gap-2.5 rounded-lg border border-gray-200 px-5 py-3 text-base font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    <MessageSquare className="h-5 w-5" /> Nota
                  </button>
                  <button
                    onClick={() => openModal('pause', task, workItem)}
                    className="inline-flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-5 py-3 text-base font-semibold text-amber-700 hover:bg-amber-100"
                  >
                    <Pause className="h-5 w-5" /> Pausa
                  </button>
                  <button
                    onClick={() => handleComplete(task)}
                    className="inline-flex items-center gap-2.5 rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white hover:bg-blue-700"
                  >
                    <CheckSquare className="h-5 w-5" /> {completeLabel}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleJoin(task)}
                  disabled={joinBlocked || submitting}
                  title={joinBlocked ? joinBlockTitle : 'Unete a esta tarea para ayudar.'}
                  className={clsx(
                    'inline-flex items-center gap-2.5 rounded-lg px-6 py-3 text-base font-semibold text-white',
                    joinBlocked
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700'
                  )}
                >
                  <Users className="h-5 w-5" /> Unirse
                </button>
              ))}
            {task.status === 'Paused' &&
              (workerParticipating ? (
                <>
                  <button
                    onClick={() => handleResume(task)}
                    disabled={resumeBlocked || submitting}
                    title={resumeBlocked ? resumeBlockTitle : undefined}
                    className={clsx(
                      'inline-flex items-center gap-2.5 rounded-lg px-6 py-3 text-base font-semibold text-white',
                      resumeBlocked
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700'
                    )}
                  >
                    <Play className="h-5 w-5" /> Reanudar
                  </button>
                  <button
                    onClick={() => handleComplete(task)}
                    className="inline-flex items-center gap-2.5 rounded-lg border border-gray-200 px-5 py-3 text-base font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    <CheckSquare className="h-5 w-5" /> {completeLabel}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleJoin(task)}
                  disabled={joinBlocked || submitting}
                  title={joinBlocked ? joinBlockTitle : 'Unete a esta tarea para ayudar.'}
                  className={clsx(
                    'inline-flex items-center gap-2.5 rounded-lg px-6 py-3 text-base font-semibold text-white',
                    joinBlocked
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700'
                  )}
                >
                  <Users className="h-5 w-5" /> Unirse
                </button>
              ))}
            {task.status === 'NotStarted' && (
              <>
                {task.skippable && (
                  <button
                    onClick={() => openModal('skip', task, workItem)}
                    className="inline-flex items-center gap-2.5 rounded-lg border border-gray-200 px-5 py-3 text-base font-semibold text-gray-500 hover:bg-gray-50"
                  >
                    <FastForward className="h-5 w-5" /> Omitir
                  </button>
                )}
                <button
                  onClick={() => handleStart(task, workItem)}
                  disabled={startBlocked || submitting}
                  title={startBlocked ? startBlockTitle : undefined}
                  className={clsx(
                    'inline-flex items-center gap-2.5 rounded-lg px-6 py-3 text-base font-semibold text-white',
                    startBlocked
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-gray-900 hover:bg-gray-800'
                  )}
                >
                  <Play className="h-5 w-5" /> Iniciar
                </button>
              </>
            )}
            {(regularCrewByTaskId[task.task_definition_id]?.length ?? 0) > 0 && (
              <button
                onClick={() => handleCrewOpen(task, workItem)}
                className="inline-flex items-center gap-2.5 rounded-lg border border-gray-200 px-5 py-3 text-base font-semibold text-gray-500 hover:text-gray-700"
              >
                <Users className="h-5 w-5" /> Equipo
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderReworkCard = (rework: StationQCReworkTask) => {
    const statusStyles: Record<string, string> = {
      Open: 'border-amber-200 bg-amber-50/50',
      InProgress: 'border-blue-200 bg-blue-50/50',
      Done: 'border-gray-200 bg-gray-50/70 opacity-70',
      Canceled: 'border-gray-200 bg-gray-50/70 opacity-70',
    };
    const isPaused = rework.task_status === 'Paused';
    const isActive = rework.task_status === 'InProgress';
    return (
      <div
        key={rework.id}
        className={clsx(
          'rounded-xl border p-4 transition-all',
          statusStyles[rework.status] ?? 'border-gray-200 bg-white'
        )}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-gray-900">Rework QC</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-amber-100 text-amber-700 border-amber-200">
                Rework
              </span>
              <span
                className={clsx(
                  'px-2 py-0.5 rounded-full text-xs font-bold uppercase border',
                  reworkStatusClass(rework.status)
                )}
              >
                {formatReworkStatus(rework.status)}
              </span>
              {isPaused && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-amber-100 text-amber-700 border-amber-200">
                  Pausado
                </span>
              )}
            </div>
            {rework.check_name && (
              <p className="mt-1 text-xs text-gray-500">Check: {rework.check_name}</p>
            )}
            <p className="mt-2 text-sm text-gray-700">{rework.description}</p>
            {rework.failure_modes.length > 0 && (
              <p className="mt-2 text-xs text-gray-600">
                <span className="font-semibold text-gray-700">Fallas:</span>{' '}
                {rework.failure_modes.join(', ')}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => openReworkDetails(rework)}
              className="inline-flex items-center gap-2.5 rounded-lg border border-gray-200 px-5 py-3 text-base font-semibold text-gray-600 hover:bg-gray-50"
            >
              <MessageSquare className="h-5 w-5" /> Detalles
            </button>
            {rework.status === 'Open' && (
              <button
                onClick={() => handleReworkStart(rework)}
                className="inline-flex items-center gap-2.5 rounded-lg bg-amber-600 px-6 py-3 text-base font-semibold text-white hover:bg-amber-700"
                disabled={submitting}
              >
                <Play className="h-5 w-5" /> Iniciar
              </button>
            )}
            {rework.status === 'InProgress' && (
              <>
                {isPaused && (
                  <button
                    onClick={() => handleReworkStart(rework)}
                    className="inline-flex items-center gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-5 py-3 text-base font-semibold text-blue-700 hover:bg-blue-100"
                    disabled={submitting}
                  >
                    <Play className="h-5 w-5" /> Continuar
                  </button>
                )}
                {isActive && (
                  <button
                    onClick={() => handleReworkPause(rework)}
                    className="inline-flex items-center gap-2.5 rounded-lg border border-gray-200 px-5 py-3 text-base font-semibold text-gray-600 hover:bg-gray-50"
                    disabled={submitting}
                  >
                    <Pause className="h-5 w-5" /> Pausa
                  </button>
                )}
                <button
                  onClick={() => handleReworkComplete(rework)}
                  className="inline-flex items-center gap-2.5 rounded-lg bg-emerald-600 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-700"
                  disabled={submitting}
                >
                  <CheckSquare className="h-5 w-5" /> Completar
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderWorkItemButton = (item: StationWorkItem, className: string) => (
    <button
      key={item.id}
      onClick={() => setSelectedWorkItemId(item.id)}
      className={clsx('w-full rounded-xl border px-4 py-3 text-left transition-all', className)}
    >
      {renderWorkItemDetails(item)}
    </button>
  );

  const openModal = (
    modal: 'pause' | 'skip' | 'comments' | 'crew',
    task: StationTask,
    workItem: StationWorkItem
  ) => {
    setSelectedTask(task);
    setSelectedTaskWorkItem(workItem);
    setReasonText('');
    setReasonError(null);
    setCommentDraft(modal === 'comments' ? task.notes ?? '' : '');
    setCommentError(null);
    setActiveModal(modal);
  };

  const closeModal = () => {
    setActiveModal(null);
    setSelectedTask(null);
    setSelectedTaskWorkItem(null);
    setSelectedRework(null);
    setReasonText('');
    setReasonError(null);
    setCommentDraft('');
    setCommentError(null);
    setCrewSelection([]);
  };

  const openReworkDetails = (rework: StationQCReworkTask) => {
    setSelectedRework(rework);
    setActiveModal('rework_details');
  };

  const handleContextModeSelect = (mode: StationPickerMode, context: StationContext | null) => {
    setStationPickerMode(mode);
    if (!context) {
      return;
    }
    setStationContext(context);
    persistStationContext(context);
    setSelectedStationId(null);
    setSelectedWorkItemId(null);
    persistSpecificStationId(null);
    setShowContextPicker(false);
    setShowStationPicker(true);
  };

  const handleConfigStationSelect = (stationId: number) => {
    const context: StationContext = { kind: 'station', stationId };
    setStationContext(context);
    persistStationContext(context);
    setStationPickerMode(modeFromContext(context));
    setSelectedStationId(stationId);
    setSelectedWorkItemId(null);
    setAutoFocusNotice(null);
    persistSpecificStationId(stationId);
    setShowContextPicker(false);
    setShowStationPicker(false);
  };

  const handleSessionStationSelect = (stationId: number) => {
    setSelectedStationId(stationId);
    setSelectedWorkItemId(null);
    setAutoFocusNotice(null);
    persistSpecificStationId(stationId);
    setShowStationPicker(false);
  };

  const handleStart = async (task: StationTask, workItem: StationWorkItem, workerIds?: number[]) => {
    if (!selectedStationId) {
      return;
    }
    const dependencyBlocked = !isDependenciesSatisfied(task);
    const workerParticipating = task.current_worker_participating ?? false;
    const workerRestricted = !isWorkerAllowed(task, workerParticipating);
    const dependencyMessage = dependencyBlockedLabel(task);
    const workerMessage = workerRestrictionLabel(task);
    const concurrencyBlocked = !canStartTask(task, task.task_instance_id);
    if (dependencyBlocked || workerRestricted || concurrencyBlocked) {
      setError(
        buildBlockReason({
          dependencyMessage,
          workerMessage,
          concurrencyBlocked,
          concurrencyAction: 'starting',
        })
      );
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/api/worker-tasks/start', {
        method: 'POST',
        body: JSON.stringify({
          task_definition_id: task.task_definition_id,
          scope: task.scope,
          work_unit_id: workItem.work_unit_id,
          panel_unit_id: workItem.panel_unit_id,
          panel_definition_id: workItem.panel_unit_id ? null : workItem.panel_definition_id,
          station_id: selectedStationId,
          worker_ids: workerIds ?? undefined,
        }),
      });
      await refreshSnapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo iniciar la tarea.';
      setError(message);
    } finally {
      setSubmitting(false);
      closeModal();
    }
  };

  const handlePause = async (reasonId?: number, customReason?: string) => {
    if (!selectedTask?.task_instance_id) {
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/api/worker-tasks/pause', {
        method: 'POST',
        body: JSON.stringify({
          task_instance_id: selectedTask.task_instance_id,
          reason_id: reasonId ?? null,
          reason_text: customReason ?? null,
        }),
      });
      await refreshSnapshot();
      closeModal();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo pausar la tarea.';
      setReasonError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResume = async (task: StationTask) => {
    if (!task.task_instance_id) {
      return;
    }
    const workerParticipating = task.current_worker_participating ?? false;
    const dependencyBlocked = !isDependenciesSatisfied(task);
    const workerRestricted = !isWorkerAllowed(task, workerParticipating);
    const dependencyMessage = dependencyBlockedLabel(task);
    const workerMessage = workerRestrictionLabel(task);
    const concurrencyBlocked = !canStartTask(task, task.task_instance_id);
    if (dependencyBlocked || workerRestricted || concurrencyBlocked) {
      setError(
        buildBlockReason({
          dependencyMessage,
          workerMessage,
          concurrencyBlocked,
          concurrencyAction: 'resuming',
        })
      );
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/api/worker-tasks/resume', {
        method: 'POST',
        body: JSON.stringify({ task_instance_id: task.task_instance_id }),
      });
      await refreshSnapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo reanudar la tarea.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoin = async (task: StationTask) => {
    if (!task.task_instance_id) {
      return;
    }
    const workerParticipating = task.current_worker_participating ?? false;
    const workerRestricted = !isWorkerAllowed(task, workerParticipating);
    const workerMessage = workerRestrictionLabel(task);
    const concurrencyBlocked = !canStartTask(task, task.task_instance_id);
    if (workerRestricted || concurrencyBlocked) {
      setError(
        buildBlockReason({
          workerMessage,
          concurrencyBlocked,
          concurrencyAction: 'joining',
        })
      );
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/api/worker-tasks/join', {
        method: 'POST',
        body: JSON.stringify({ task_instance_id: task.task_instance_id }),
      });
      await refreshSnapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo unir a la tarea.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = async (task: StationTask) => {
    if (!task.task_instance_id) {
      return;
    }
    if (!task.current_worker_participating) {
      setError('Unete a la tarea antes de terminarla.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/api/worker-tasks/complete', {
        method: 'POST',
        body: JSON.stringify({
          task_instance_id: task.task_instance_id,
          notes: null,
        }),
      });
      await refreshSnapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo completar la tarea.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReworkStart = async (rework: StationQCReworkTask) => {
    if (!worker?.id) {
      setError('Necesitas iniciar sesion para iniciar el rework.');
      return;
    }
    if (!selectedStationId) {
      setError('Selecciona una estacion antes de iniciar el rework.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest(`/api/qc/rework-tasks/${rework.id}/start`, {
        method: 'POST',
        body: JSON.stringify({
          worker_ids: [worker.id],
          station_id: selectedStationId,
        }),
      });
      await refreshSnapshot();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo iniciar el rework.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReworkPause = async (rework: StationQCReworkTask) => {
    setSubmitting(true);
    try {
      await apiRequest(`/api/qc/rework-tasks/${rework.id}/pause`, {
        method: 'POST',
        body: JSON.stringify({ reason_id: null, reason_text: null }),
      });
      await refreshSnapshot();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo pausar el rework.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReworkComplete = async (rework: StationQCReworkTask) => {
    setSubmitting(true);
    try {
      await apiRequest(`/api/qc/rework-tasks/${rework.id}/complete`, {
        method: 'POST',
      });
      await refreshSnapshot();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo completar el rework.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async (customReason?: string) => {
    if (!selectedTask || !selectedTaskWorkItem || !selectedStationId) {
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/api/worker-tasks/skip', {
        method: 'POST',
        body: JSON.stringify({
          task_definition_id: selectedTask.task_definition_id,
          scope: selectedTask.scope,
          work_unit_id: selectedTaskWorkItem.work_unit_id,
          panel_unit_id: selectedTaskWorkItem.panel_unit_id,
          station_id: selectedStationId,
          reason_text: customReason ?? null,
        }),
      });
      await refreshSnapshot();
      closeModal();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo omitir la tarea.';
      setReasonError(message);
      return;
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveComment = async () => {
    if (!selectedTask?.task_instance_id) {
      return;
    }
    if (!commentDraft.trim()) {
      setCommentError('Agrega una nota antes de guardar.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/api/worker-tasks/notes', {
        method: 'POST',
        body: JSON.stringify({
          task_instance_id: selectedTask.task_instance_id,
          notes: commentDraft.trim(),
        }),
      });
      await refreshSnapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo guardar la nota.';
      setCommentError(message);
      return;
    } finally {
      setSubmitting(false);
    }
    closeModal();
  };

  const handleCrewOpen = async (task: StationTask, workItem: StationWorkItem) => {
    const regularCrew = regularCrewByTaskId[task.task_definition_id];
    if (!regularCrew || regularCrew.length === 0) {
      return;
    }
    openModal('crew', task, workItem);
    if (crewWorkers.length === 0) {
      try {
        const data = await apiRequest<Worker[]>('/api/workers');
        setCrewWorkers(data.filter((item) => item.active));
      } catch {
        setCrewWorkers([]);
      }
    }
    const baseSelection = new Set([worker?.id, ...regularCrew].filter(Boolean));
    setCrewSelection(Array.from(baseSelection) as number[]);
  };

  const crewGroups = useMemo(() => {
    const taskCrewIds = selectedTask
      ? regularCrewByTaskId[selectedTask.task_definition_id] ?? []
      : [];
    const regularCrewIdSet = new Set<number>(taskCrewIds);
    const stationAssignedIdSet = new Set<number>();

    if (selectedStationId) {
      crewWorkers.forEach((item) => {
        if (item.assigned_station_ids?.includes(selectedStationId)) {
          stationAssignedIdSet.add(item.id);
        }
      });
    }

    const normalizedQuery = normalizeQrValue(crewQuery);
    const matchesQuery = (item: Worker) => {
      if (!normalizedQuery) {
        return true;
      }
      const terms = normalizedQuery.split(' ').filter(Boolean);
      const haystack = normalizeQrValue(
        `${formatWorkerFullName(item)} ${formatWorkerDisplayName(item)}`
      );
      return terms.every((term) => haystack.includes(term));
    };

    const compare = (a: Worker, b: Worker) =>
      formatWorkerDisplayName(a).localeCompare(formatWorkerDisplayName(b));

    const regularCrew = crewWorkers
      .filter((item) => regularCrewIdSet.has(item.id))
      .filter(matchesQuery)
      .sort(compare);

    const stationAssigned = crewWorkers
      .filter((item) => !regularCrewIdSet.has(item.id))
      .filter((item) => stationAssignedIdSet.has(item.id))
      .filter(matchesQuery)
      .sort(compare);

    const others = crewWorkers
      .filter((item) => !regularCrewIdSet.has(item.id))
      .filter((item) => !stationAssignedIdSet.has(item.id))
      .filter(matchesQuery)
      .sort(compare);

    return { regularCrew, stationAssigned, others };
  }, [crewQuery, crewWorkers, regularCrewByTaskId, selectedStationId, selectedTask]);

  const toggleCrewWorker = (workerId: number) => {
    setCrewSelection((prev) =>
      prev.includes(workerId) ? prev.filter((id) => id !== workerId) : [...prev, workerId]
    );
  };

  const crewStartDependencyBlocked = selectedTask
    ? !isDependenciesSatisfied(selectedTask)
    : false;
  const crewStartWorkerParticipating = selectedTask
    ? selectedTask.current_worker_participating ?? false
    : false;
  const crewStartWorkerRestricted = selectedTask
    ? !isWorkerAllowed(selectedTask, crewStartWorkerParticipating)
    : false;
  const crewStartConcurrencyBlocked = selectedTask
    ? !canStartTask(selectedTask, selectedTask.task_instance_id)
    : false;
  const crewStartDependencyMessage = selectedTask ? dependencyBlockedLabel(selectedTask) : '';
  const crewStartWorkerMessage = selectedTask ? workerRestrictionLabel(selectedTask) : '';
  const crewStartBlocked =
    crewStartDependencyBlocked || crewStartWorkerRestricted || crewStartConcurrencyBlocked;
  const crewStartBlockTitle = selectedTask
    ? buildBlockReason({
        dependencyMessage: crewStartDependencyMessage,
        workerMessage: crewStartWorkerMessage,
        concurrencyBlocked: crewStartConcurrencyBlocked,
        concurrencyAction: 'starting',
      })
    : '';

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
        Cargando area de trabajo de estacion...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500 font-medium">
            Area de Trabajo de Estacion
          </p>
          <h1 className="text-2xl font-display text-gray-900">
            {selectedStation ? selectedStation.name : 'Estacion sin asignar'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {selectedStation
              ? `${formatStationRoleLabel(selectedStation.role)}${
                  selectedStation.line_type ? ` - Línea ${selectedStation.line_type}` : ''
                }`
              : 'Selecciona una estacion para comenzar.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700">
            <span>
              {worker ? formatWorkerDisplayName(worker) : 'Trabajador'}
            </span>
            <button
              onClick={handleLogout}
              className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="h-4 w-4" /> Concluir
            </button>
          </div>
          {!selectedStationId && (
            <button
              onClick={() => {
                setStationPickerMode(modeFromContext(stationContext));
                setShowContextPicker(true);
              }}
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Configurar estacion
            </button>
          )}
          <button
            className="relative inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600"
            disabled
          >
            <Bell className="h-4 w-4" /> QC
            {qcNotificationCount > 0 && (
              <>
                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-rose-500" />
                <span className="absolute -top-2 -right-3 min-w-[16px] rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                  {qcNotificationCount}
                </span>
              </>
            )}
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {autoFocusNotice && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {autoFocusNotice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        <aside className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Lista de trabajo</h2>
            <button
              onClick={refreshSnapshot}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800"
            >
              Actualizar
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {snapshotLoading && (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                Cargando cola de estacion...
              </div>
            )}
            {workItems.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-xs text-gray-500">
                Aun no hay trabajo asignado a esta estacion.
              </div>
            ) : (
              <>
                {isW1 && recommendedItem && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-blue-500 font-semibold">
                      Siguiente panel planeado
                    </p>
                    {renderWorkItemButton(
                      recommendedItem,
                      selectedWorkItemId === recommendedItem.id
                        ? 'border-blue-500 bg-blue-50/70 shadow-sm'
                        : 'border-blue-200 bg-blue-50/40 hover:bg-blue-50'
                    )}
                  </div>
                )}
                {isW1 && inProgressItems.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-gray-400 font-semibold">
                      Paneles en progreso
                    </p>
                    {inProgressItems.map((item) =>
                      renderWorkItemButton(
                        item,
                        selectedWorkItemId === item.id
                          ? 'border-blue-500 bg-blue-50/70 shadow-sm'
                          : 'border-gray-200 hover:bg-gray-50'
                      )
                    )}
                  </div>
                )}
                {isW1 && plannedItems.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-gray-400 font-semibold">
                      Paneles disponibles para iniciar
                    </p>
                    {plannedTotalCount > plannedItems.length && (
                      <p className="text-[11px] text-gray-400">
                        Mostrando siguientes {plannedItems.length} paneles.
                      </p>
                    )}
                    {plannedItems.map((item) =>
                      renderWorkItemButton(
                        item,
                        selectedWorkItemId === item.id
                          ? 'border-blue-500 bg-blue-50/70 shadow-sm'
                          : 'border-gray-200 hover:bg-gray-50'
                      )
                    )}
                  </div>
                )}
                {isW1 && otherItems.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-gray-400 font-semibold">
                      Otros elementos
                    </p>
                    {otherItems.map((item) =>
                      renderWorkItemButton(
                        item,
                        selectedWorkItemId === item.id
                          ? 'border-blue-500 bg-blue-50/70 shadow-sm'
                          : 'border-gray-200 hover:bg-gray-50'
                      )
                    )}
                  </div>
                )}
                {!isW1 &&
                  workItems.map((item) =>
                    renderWorkItemButton(
                      item,
                      selectedWorkItemId === item.id
                        ? 'border-blue-500 bg-blue-50/70 shadow-sm'
                        : 'border-gray-200 hover:bg-gray-50'
                    )
                  )}
              </>
            )}
          </div>
        </aside>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          {!selectedWorkItem ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
              Selecciona un elemento de trabajo para ver tareas.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Tareas de la estacion</h2>
                  {selectedWorkItem.panel_code && (
                    <div className="mt-1 text-lg font-semibold text-gray-900">
                      {selectedWorkItem.panel_code}
                    </div>
                  )}
                  <p className="text-sm text-gray-500">
                    {selectedWorkItem.project_name} - {selectedWorkItem.house_identifier} -
                    Modulo {selectedWorkItem.module_number}
                  </p>
                </div>
                {!isMagazineStation && selectedWorkItem.other_tasks.length > 0 && (
                  <button
                    onClick={() => setActiveModal('other_tasks')}
                    className="rounded-full border border-gray-200 px-5 py-3 text-base font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Otras tareas ({selectedWorkItem.other_tasks.length})
                  </button>
                )}
              </div>

              {selectedWorkItem.tasks.length === 0 &&
              selectedWorkItem.backlog_tasks.length === 0 &&
              (!isMagazineStation || selectedWorkItem.other_tasks.length === 0) ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                  No hay tareas de estacion asignadas para este elemento.
                </div>
              ) : (
                <div className="space-y-6">
                  {selectedWorkItem.tasks.length > 0 && (
                    <div className="space-y-3">
                      {selectedReworkTasks.map((rework) => renderReworkCard(rework))}
                      {sortTasksForDisplay(selectedWorkItem.tasks).map((task) =>
                        renderTaskCard(task, selectedWorkItem)
                      )}
                    </div>
                  )}
                  {isMagazineStation && selectedWorkItem.other_tasks.length > 0 && (
                    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
                      <p className="text-[11px] uppercase tracking-[0.3em] text-gray-400 font-semibold">
                        Otras tareas
                      </p>
                      {sortTasksForDisplay(selectedWorkItem.other_tasks).map((task) =>
                        renderTaskCard(task, selectedWorkItem)
                      )}
                    </div>
                  )}
                  {selectedWorkItem.backlog_tasks.length > 0 && (
                    <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3">
                      <p className="text-[11px] uppercase tracking-[0.3em] text-gray-400 font-semibold">
                        Pendientes de estaciones previas
                      </p>
                      {sortTasksForDisplay(selectedWorkItem.backlog_tasks).map((task) =>
                        renderTaskCard(task, selectedWorkItem)
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {showContextPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-gray-900/40"
            onClick={
              contextSelectionRequired ? undefined : () => setShowContextPicker(false)
            }
          />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            {!contextSelectionRequired && (
              <button
                onClick={() => setShowContextPicker(false)}
                className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            )}
            <h3 className="text-lg font-semibold text-gray-900">Contexto de estacion</h3>
            <p className="mt-2 text-sm text-gray-500">
              Define la estación del tablet.
            </p>
            <div className="mt-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="space-y-2">
	                {contextOptions.map((option) => {
	                  const isActive =
	                    option.mode.kind === stationPickerMode.kind &&
	                    (option.mode.kind !== 'assembly_sequence' ||
	                      (stationPickerMode.kind === 'assembly_sequence' &&
	                        option.mode.sequenceOrder === stationPickerMode.sequenceOrder));
	                  const key =
	                    option.mode.kind === 'assembly_sequence'
	                      ? `assembly-${option.mode.sequenceOrder}`
	                      : option.label;
                  return (
                    <button
                      key={key}
                      onClick={() => handleContextModeSelect(option.mode, option.context)}
                      className={clsx(
                        'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                        isActive
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-blue-400 hover:bg-blue-50'
                      )}
                    >
                      <div className="font-semibold text-gray-900">{option.label}</div>
                    </button>
                  );
                })}
              </div>
              {stationPickerMode.kind === 'station_list' ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Estaciones
                  </p>
                  {stationPickerStations.map((station) => (
                    <button
                      key={station.id}
                      onClick={() => handleConfigStationSelect(station.id)}
                      className={clsx(
                        'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                        selectedStationId === station.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-blue-400 hover:bg-blue-50'
                      )}
                    >
                      <div className="font-semibold text-gray-900">{station.name}</div>
                      <div className="text-xs text-gray-500">
                        {formatStationRoleLabel(station.role)}
                        {station.line_type ? ` - Línea ${station.line_type}` : ''}
                      </div>
                    </button>
                  ))}
                  {stationPickerStations.length === 0 && (
                    <div className="rounded-md border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500">
                      No hay estaciones disponibles para este contexto.
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500">
                  La seleccion de estacion ocurre despues de elegir el contexto.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showStationPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-gray-900/40"
            onClick={
              stationSelectionRequired ? undefined : () => setShowStationPicker(false)
            }
          />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            {!stationSelectionRequired && (
              <button
                onClick={() => setShowStationPicker(false)}
                className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            )}
            <h3 className="text-lg font-semibold text-gray-900">Seleccionar estacion</h3>
            <p className="mt-2 text-sm text-gray-500">
              Elige la estacion para esta sesion.
            </p>
            <div className="mt-4 space-y-2 max-h-[60vh] overflow-y-auto">
              {sessionStations.map((station) => (
                <button
                  key={station.id}
                  onClick={() => handleSessionStationSelect(station.id)}
                  className="w-full rounded-lg border border-gray-200 px-4 py-3 text-left hover:border-blue-400 hover:bg-blue-50"
                >
                  <div className="font-semibold text-gray-900">{station.name}</div>
                  <div className="text-xs text-gray-500">
                    {formatStationRoleLabel(station.role)}
                    {station.line_type ? ` - Línea ${station.line_type}` : ''}
                  </div>
                </button>
              ))}
              {sessionStations.length === 0 && (
                <div className="rounded-md border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500">
                  No hay estaciones disponibles para este contexto.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeModal === 'pause' && selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40" onClick={closeModal} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <button onClick={closeModal} className="absolute right-4 top-4 text-gray-400">
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-semibold text-gray-900">Pausar tarea</h3>
            <p className="mt-1 text-sm text-gray-500">Selecciona un motivo para pausar esta tarea.</p>
            {reasonError && (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {reasonError}
              </div>
            )}
            <div className="mt-4 space-y-2">
              {pauseReasons.map((reason) => (
                <button
                  key={reason.id}
                  onClick={() => handlePause(reason.id)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-700 hover:border-amber-400 hover:bg-amber-50"
                >
                  {reason.name}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <label className="text-xs font-semibold text-gray-500">Motivo personalizado</label>
              <input
                type="text"
                className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                value={reasonText}
                onChange={(event) => setReasonText(event.target.value)}
                placeholder="Agrega un motivo personalizado"
              />
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const trimmed = reasonText.trim();
                  if (!trimmed) {
                    setReasonError('Se requiere un motivo.');
                    return;
                  }
                  handlePause(undefined, trimmed);
                }}
                className="flex-1 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white hover:bg-amber-600"
                disabled={submitting}
              >
                Pausar tarea
              </button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'skip' && selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40" onClick={closeModal} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <button onClick={closeModal} className="absolute right-4 top-4 text-gray-400">
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-semibold text-gray-900">Omitir tarea</h3>
            <p className="mt-1 text-sm text-gray-500">Proporciona un motivo para omitir esta tarea.</p>
            {reasonError && (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {reasonError}
              </div>
            )}
            <div className="mt-4 max-h-[40vh] space-y-2 overflow-y-auto pr-1">
              {pauseReasons.map((reason) => (
                <button
                  key={reason.id}
                  onClick={() => handleSkip(reason.name)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-700 hover:border-blue-400 hover:bg-blue-50"
                >
                  {reason.name}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <label className="text-xs font-semibold text-gray-500">Motivo personalizado</label>
              <input
                type="text"
                className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                value={reasonText}
                onChange={(event) => setReasonText(event.target.value)}
                placeholder="Agrega un motivo personalizado"
              />
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const trimmed = reasonText.trim();
                  if (!trimmed) {
                    setReasonError('Se requiere un motivo.');
                    return;
                  }
                  handleSkip(trimmed);
                }}
                className="flex-1 rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-gray-800"
                disabled={submitting}
              >
                Omitir tarea
              </button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'comments' && selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40" onClick={closeModal} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <button onClick={closeModal} className="absolute right-4 top-4 text-gray-400">
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-semibold text-gray-900">Notas de tarea</h3>
            <p className="mt-1 text-sm text-gray-500">Agrega notas u observaciones para esta tarea.</p>
            {commentError && (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {commentError}
              </div>
            )}
            {commentTemplates.length > 0 && (
              <div
                className={clsx(
                  'mt-4 grid gap-2',
                  hasLongCommentTemplateList ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'
                )}
              >
                {commentTemplates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => setCommentDraft(template.text)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-700 hover:border-blue-400 hover:bg-blue-50"
                  >
                    {template.text}
                  </button>
                ))}
              </div>
            )}
            <textarea
              className="mt-4 w-full h-32 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Escribe una nota"
              value={commentDraft}
              onChange={(event) => setCommentDraft(event.target.value)}
            />
            <div className="mt-6 flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveComment}
                className="flex-1 rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-gray-800"
                disabled={submitting}
              >
                Guardar nota
              </button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'crew' && selectedTask && selectedTaskWorkItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40" onClick={closeModal} />
          <div className="relative w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <button onClick={closeModal} className="absolute right-4 top-4 text-gray-400">
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-semibold text-gray-900">Seleccion de equipo</h3>
            <p className="mt-1 text-sm text-gray-500">Elige companeros para iniciar juntos.</p>
            {crewStartBlocked && (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {crewStartBlockTitle}
              </div>
            )}
            <input
              className="mt-4 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Buscar trabajadores"
              value={crewQuery}
              onChange={(event) => setCrewQuery(event.target.value)}
            />
            <div className="mt-4 max-h-60 overflow-y-auto space-y-4">
              {crewGroups.regularCrew.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Equipo regular
                  </p>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {crewGroups.regularCrew.map((crewWorker) => (
                      <label
                        key={crewWorker.id}
                        className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/40 px-3 py-2 text-sm font-semibold text-gray-700 hover:border-blue-200"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-blue-600"
                          checked={crewSelection.includes(crewWorker.id)}
                          onChange={() => toggleCrewWorker(crewWorker.id)}
                        />
                        {formatWorkerDisplayName(crewWorker)}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {crewGroups.stationAssigned.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Asignados a la estacion
                  </p>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {crewGroups.stationAssigned.map((crewWorker) => (
                      <label
                        key={crewWorker.id}
                        className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:border-blue-200"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-blue-600"
                          checked={crewSelection.includes(crewWorker.id)}
                          onChange={() => toggleCrewWorker(crewWorker.id)}
                        />
                        {formatWorkerDisplayName(crewWorker)}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {crewGroups.others.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Otros trabajadores
                  </p>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {crewGroups.others.map((crewWorker) => (
                      <label
                        key={crewWorker.id}
                        className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:border-blue-200"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-blue-600"
                          checked={crewSelection.includes(crewWorker.id)}
                          onChange={() => toggleCrewWorker(crewWorker.id)}
                        />
                        {formatWorkerDisplayName(crewWorker)}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {crewGroups.regularCrew.length === 0 &&
                crewGroups.stationAssigned.length === 0 &&
                crewGroups.others.length === 0 && (
                  <div className="text-sm text-gray-500">No se encontraron trabajadores.</div>
                )}
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleStart(selectedTask, selectedTaskWorkItem, crewSelection)}
                className={clsx(
                  'flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white',
                  crewStartBlocked
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-gray-900 hover:bg-gray-800'
                )}
                disabled={crewStartBlocked || submitting}
                title={crewStartBlocked ? crewStartBlockTitle : undefined}
              >
                Iniciar con equipo
              </button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'rework_details' && selectedRework && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40" onClick={closeModal} />
          <div className="relative w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <button onClick={closeModal} className="absolute right-4 top-4 text-gray-400">
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-semibold text-gray-900">Detalle de rework QC</h3>
            <p className="mt-1 text-sm text-gray-500">
              Modulo {selectedRework.module_number}
              {selectedRework.panel_code ? ` • ${selectedRework.panel_code}` : ''}
            </p>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">
                    Rework
                  </span>
                  <span
                    className={clsx(
                      'px-2 py-0.5 rounded-full text-xs font-bold uppercase border',
                      reworkStatusClass(selectedRework.status)
                    )}
                  >
                    {formatReworkStatus(selectedRework.status)}
                  </span>
                  {selectedRework.task_status === 'Paused' && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-amber-100 text-amber-700 border-amber-200">
                      Pausado
                    </span>
                  )}
                </div>
                {selectedRework.check_name && (
                  <p className="mt-2 text-xs text-gray-500">
                    Check: {selectedRework.check_name}
                  </p>
                )}
                <p className="mt-2 text-sm text-gray-700">{selectedRework.description}</p>
              </div>
              {selectedRework.failure_modes.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500">Fallas detectadas</p>
                  <p className="mt-1 text-sm text-gray-700">
                    {selectedRework.failure_modes.join(', ')}
                  </p>
                </div>
              )}
              {selectedRework.failure_notes && (
                <div>
                  <p className="text-xs font-semibold text-gray-500">Notas del inspector</p>
                  <p className="mt-1 text-sm text-gray-700">{selectedRework.failure_notes}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-gray-500">Registro</p>
                {selectedRework.evidence_uris.length > 0 ? (
                  <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {selectedRework.evidence_uris.map((uri) => (
                      <img
                        key={uri}
                        src={`${API_BASE_URL}${uri}`}
                        alt="Registro Calidad"
                        className="h-28 w-full rounded-xl border border-gray-200 object-cover"
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-gray-500">No hay registros adjuntos.</p>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={closeModal}
                className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-600"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'other_tasks' && selectedWorkItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40" onClick={closeModal} />
          <div className="relative w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <button onClick={closeModal} className="absolute right-4 top-4 text-gray-400">
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-semibold text-gray-900">Otras tareas</h3>
            <p className="mt-1 text-sm text-gray-500">
              Tareas no programadas disponibles para este modulo/panel.
            </p>
            <div className="mt-4 space-y-3 max-h-[60vh] overflow-y-auto">
              {sortTasksForDisplay(selectedWorkItem.other_tasks).map((task) => {
                const isCompleted = task.status === 'Completed';
                const workerParticipating = task.current_worker_participating ?? false;
                const dependencyBlocked = !isDependenciesSatisfied(task);
                const workerRestricted = !isWorkerAllowed(task, workerParticipating);
                const dependencyMessage = dependencyBlockedLabel(task);
                const workerMessage = workerRestrictionLabel(task);
                const startConcurrencyBlocked = !canStartTask(task);
                const resumeConcurrencyBlocked = !canStartTask(task, task.task_instance_id);
                const startBlocked =
                  dependencyBlocked || workerRestricted || startConcurrencyBlocked;
                const resumeBlocked =
                  dependencyBlocked || workerRestricted || resumeConcurrencyBlocked;
                const restrictionNote = [
                  dependencyMessage || null,
                  workerMessage || null,
                ]
                  .filter(Boolean)
                  .join(' - ');
                const startBlockTitle = buildBlockReason({
                  dependencyMessage,
                  workerMessage,
                  concurrencyBlocked: startConcurrencyBlocked,
                  concurrencyAction: 'starting',
                });
                const resumeBlockTitle = buildBlockReason({
                  dependencyMessage,
                  workerMessage,
                  concurrencyBlocked: resumeConcurrencyBlocked,
                  concurrencyAction: 'resuming',
                });
                const taskNameKey = buildTaskNameKey(task, selectedWorkItem.id);
                const isTaskNameExpanded = expandedTaskNames.has(taskNameKey);
                return (
                  <div
                    key={task.task_definition_id}
                    className={clsx(
                      'rounded-xl border border-gray-200 p-4',
                      isCompleted && 'bg-gray-50/70 opacity-70'
                    )}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => toggleTaskNameExpansion(taskNameKey)}
                        title={task.name}
                        aria-expanded={isTaskNameExpanded}
                        className={clsx(
                          'min-w-0 flex-1 text-left text-sm font-semibold text-gray-900',
                          isTaskNameExpanded ? 'whitespace-normal break-words' : 'truncate'
                        )}
                      >
                        {task.name}
                      </button>
                      <div className="shrink-0">{statusBadge(task.status)}</div>
                    </div>
                    {restrictionNote &&
                      (task.status === 'NotStarted' || task.status === 'Paused') && (
                        <div className="mt-1 text-xs font-semibold text-rose-600">
                          {restrictionNote}
                        </div>
                      )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {task.status === 'NotStarted' && (
                        <button
                          onClick={() => handleStart(task, selectedWorkItem)}
                          disabled={startBlocked || submitting}
                          title={startBlocked ? startBlockTitle : undefined}
                          className={clsx(
                            'inline-flex items-center gap-2.5 rounded-lg px-6 py-3 text-base font-semibold text-white',
                            startBlocked
                              ? 'bg-gray-400 cursor-not-allowed'
                              : 'bg-gray-900 hover:bg-gray-800'
                          )}
                        >
                          <Play className="h-5 w-5" /> Iniciar
                        </button>
                      )}
                      {task.status === 'Paused' && (
                        <button
                          onClick={() => handleResume(task)}
                          disabled={resumeBlocked || submitting}
                          title={resumeBlocked ? resumeBlockTitle : undefined}
                          className={clsx(
                            'inline-flex items-center gap-2.5 rounded-lg px-6 py-3 text-base font-semibold text-white',
                            resumeBlocked
                              ? 'bg-gray-400 cursor-not-allowed'
                              : 'bg-blue-600 hover:bg-blue-700'
                          )}
                        >
                          <Play className="h-5 w-5" /> Reanudar
                        </button>
                      )}
                      {task.status === 'InProgress' && (
                        <span className="text-xs text-gray-500">Tarea ya en progreso</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {selectedWorkItem.other_tasks.length === 0 && (
                <div className="text-sm text-gray-500">No hay otras tareas disponibles.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StationWorkspace;
