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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const MAX_W1_PLANNED = 10;

type Worker = {
  id: number;
  first_name: string;
  last_name: string;
  active: boolean;
  login_required: boolean;
};

type Station = {
  id: number;
  name: string;
  role: string;
  line_type: string | null;
  sequence_order: number | null;
};

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
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
};

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
  recommended: boolean;
};

type StationSnapshot = {
  station: Station;
  work_items: StationWorkItem[];
  pause_reasons: PauseReason[];
  comment_templates: CommentTemplate[];
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

const StationWorkspace: React.FC = () => {
  const navigate = useNavigate();
  const [worker, setWorker] = useState<Worker | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<StationSnapshot | null>(null);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idleTimeoutMs, setIdleTimeoutMs] = useState<number | null>(null);
  const [showStationPicker, setShowStationPicker] = useState(false);
  const [activeModal, setActiveModal] = useState<
    'pause' | 'skip' | 'comments' | 'crew' | 'other_tasks' | null
  >(null);
  const [selectedTask, setSelectedTask] = useState<StationTask | null>(null);
  const [selectedTaskWorkItem, setSelectedTaskWorkItem] = useState<StationWorkItem | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [crewWorkers, setCrewWorkers] = useState<Worker[]>([]);
  const [crewSelection, setCrewSelection] = useState<number[]>([]);
  const [crewQuery, setCrewQuery] = useState('');
  const [regularCrewByTaskId, setRegularCrewByTaskId] = useState<Record<number, number[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const idleTimerRef = useRef<number | null>(null);

  const selectedStation = useMemo(
    () => stations.find((station) => station.id === selectedStationId) ?? null,
    [stations, selectedStationId]
  );

  const selectedWorkItem = useMemo(
    () => snapshot?.work_items.find((item) => item.id === selectedWorkItemId) ?? null,
    [snapshot, selectedWorkItemId]
  );

  const workItems = snapshot?.work_items ?? [];
  const isW1 = selectedStation?.role === 'Panels' && selectedStation.sequence_order === 1;
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
        plannedTotalCount: plannedCount,
      };
    }, [isW1, workItems]);

  const pauseReasons = snapshot?.pause_reasons ?? [];
  const commentTemplates = snapshot?.comment_templates ?? [];

  const storeStationContext = useCallback((stationId: number | null) => {
    if (stationId === null) {
      localStorage.removeItem('selectedStationContext');
      localStorage.removeItem('selectedSpecificStationId');
      return;
    }
    localStorage.setItem('selectedStationContext', `station:${stationId}`);
    localStorage.setItem('selectedSpecificStationId', String(stationId));
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await apiRequest('/api/worker-sessions/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    storeStationContext(null);
    navigate('/login');
  }, [navigate, storeStationContext]);

  const loadSnapshot = useCallback(async (stationId: number) => {
    setSnapshotLoading(true);
    try {
      const data = await apiRequest<StationSnapshot>(`/api/worker-stations/${stationId}/snapshot`);
      setSnapshot(data);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load station.';
      setError(message);
    } finally {
      setSnapshotLoading(false);
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
        const savedStation = localStorage.getItem('selectedSpecificStationId');
        const stationId = savedStation ? Number(savedStation) : session.station_id;
        if (stationId && stationData.some((station) => station.id === stationId)) {
          setSelectedStationId(stationId);
        } else {
          setShowStationPicker(true);
        }
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Worker session expired.';
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
    storeStationContext(selectedStationId);
    apiRequest('/api/worker-sessions/station', {
      method: 'PUT',
      body: JSON.stringify({ station_id: selectedStationId }),
    }).catch(() => undefined);
    loadSnapshot(selectedStationId);
  }, [loadSnapshot, selectedStationId, storeStationContext]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    if (snapshot.work_items.length === 0) {
      setSelectedWorkItemId(null);
      return;
    }
    const exists = snapshot.work_items.some((item) => item.id === selectedWorkItemId);
    if (!exists) {
      setSelectedWorkItemId(snapshot.work_items.length === 1 ? snapshot.work_items[0].id : null);
    }
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

  const taskDefinitionIds = useMemo(() => {
    const ids = new Set<number>();
    snapshot?.work_items.forEach((item) => {
      item.tasks.forEach((task) => {
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
    };
    return (
      <span
        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
          styles[status] ?? 'bg-gray-100 text-gray-600 border-gray-200'
        }`}
      >
        {status === 'NotStarted' ? 'Pending' : status}
      </span>
    );
  };

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
    setReasonText('');
    setReasonError(null);
    setCommentDraft('');
    setCommentError(null);
    setCrewSelection([]);
  };

  const handleStart = async (task: StationTask, workItem: StationWorkItem, workerIds?: number[]) => {
    if (!selectedStationId) {
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
      const message = err instanceof Error ? err.message : 'Failed to start task.';
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
      const message = err instanceof Error ? err.message : 'Failed to pause task.';
      setReasonError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResume = async (task: StationTask) => {
    if (!task.task_instance_id) {
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
      const message = err instanceof Error ? err.message : 'Failed to resume task.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = async (task: StationTask) => {
    if (!task.task_instance_id) {
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
      const message = err instanceof Error ? err.message : 'Failed to complete task.';
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
      const message = err instanceof Error ? err.message : 'Failed to skip task.';
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
      setCommentError('Add a note before saving.');
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
      const message = err instanceof Error ? err.message : 'Failed to save note.';
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

  const filteredCrew = useMemo(() => {
    const query = crewQuery.trim().toLowerCase();
    if (!query) {
      return crewWorkers;
    }
    return crewWorkers.filter((item) => {
      const name = `${item.first_name} ${item.last_name}`.toLowerCase();
      return name.includes(query);
    });
  }, [crewQuery, crewWorkers]);

  const toggleCrewWorker = (workerId: number) => {
    setCrewSelection((prev) =>
      prev.includes(workerId) ? prev.filter((id) => id !== workerId) : [...prev, workerId]
    );
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
        Loading station workspace...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500 font-medium">
            Worker Station Workspace
          </p>
          <h1 className="text-2xl font-display text-gray-900">
            {selectedStation ? selectedStation.name : 'Station unassigned'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {selectedStation
              ? `${selectedStation.role}${
                  selectedStation.line_type ? ` - Line ${selectedStation.line_type}` : ''
                }`
              : 'Select a station to begin.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700">
            <span>
              {worker ? `${worker.first_name} ${worker.last_name}` : 'Worker'}
            </span>
            <button
              onClick={handleLogout}
              className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="h-4 w-4" /> Conclude
            </button>
          </div>
          <button
            onClick={() => setShowStationPicker(true)}
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
          >
            Change station
          </button>
          <button
            className="relative inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600"
            disabled
          >
            <Bell className="h-4 w-4" /> QC
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-rose-500" />
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        <aside className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Work list</h2>
            <button
              onClick={refreshSnapshot}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800"
            >
              Refresh
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {workItems.length} items queued
          </p>
          <div className="mt-4 space-y-3">
            {snapshotLoading && (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                Loading station queue...
              </div>
            )}
            {workItems.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-xs text-gray-500">
                No work assigned to this station yet.
              </div>
            ) : (
              <>
                {isW1 && recommendedItem && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-blue-500 font-semibold">
                      Recommended next panel
                    </p>
                    <button
                      key={recommendedItem.id}
                      onClick={() => setSelectedWorkItemId(recommendedItem.id)}
                      className={clsx(
                        'w-full rounded-xl border px-4 py-3 text-left transition-all',
                        selectedWorkItemId === recommendedItem.id
                          ? 'border-blue-500 bg-blue-50/70 shadow-sm'
                          : 'border-blue-200 bg-blue-50/40 hover:bg-blue-50'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold uppercase text-gray-400">
                          {recommendedItem.house_identifier} - M{recommendedItem.module_number}
                        </div>
                        {statusBadge(recommendedItem.status)}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-gray-900">
                        {recommendedItem.project_name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {recommendedItem.house_type_name}
                        {recommendedItem.sub_type_name ? ` - ${recommendedItem.sub_type_name}` : ''}
                        {recommendedItem.panel_code ? ` - ${recommendedItem.panel_code}` : ''}
                      </div>
                    </button>
                  </div>
                )}
                {isW1 && inProgressItems.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-gray-400 font-semibold">
                      Panels in progress
                    </p>
                    {inProgressItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setSelectedWorkItemId(item.id)}
                        className={clsx(
                          'w-full rounded-xl border px-4 py-3 text-left transition-all',
                          selectedWorkItemId === item.id
                            ? 'border-blue-500 bg-blue-50/70 shadow-sm'
                            : 'border-gray-200 hover:bg-gray-50'
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold uppercase text-gray-400">
                            {item.house_identifier} - M{item.module_number}
                          </div>
                          {statusBadge(item.status)}
                        </div>
                        <div className="mt-2 text-sm font-semibold text-gray-900">
                          {item.project_name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {item.house_type_name}
                          {item.sub_type_name ? ` - ${item.sub_type_name}` : ''}
                          {item.panel_code ? ` - ${item.panel_code}` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {isW1 && plannedItems.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-gray-400 font-semibold">
                      Panels available to start
                    </p>
                    {plannedTotalCount > plannedItems.length && (
                      <p className="text-[11px] text-gray-400">
                        Showing next {plannedItems.length} of {plannedTotalCount} panels.
                      </p>
                    )}
                    {plannedItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setSelectedWorkItemId(item.id)}
                        className={clsx(
                          'w-full rounded-xl border px-4 py-3 text-left transition-all',
                          selectedWorkItemId === item.id
                            ? 'border-blue-500 bg-blue-50/70 shadow-sm'
                            : 'border-gray-200 hover:bg-gray-50'
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold uppercase text-gray-400">
                            {item.house_identifier} - M{item.module_number}
                          </div>
                          {statusBadge(item.status)}
                        </div>
                        <div className="mt-2 text-sm font-semibold text-gray-900">
                          {item.project_name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {item.house_type_name}
                          {item.sub_type_name ? ` - ${item.sub_type_name}` : ''}
                          {item.panel_code ? ` - ${item.panel_code}` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {isW1 && otherItems.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-gray-400 font-semibold">
                      Other items
                    </p>
                    {otherItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setSelectedWorkItemId(item.id)}
                        className={clsx(
                          'w-full rounded-xl border px-4 py-3 text-left transition-all',
                          selectedWorkItemId === item.id
                            ? 'border-blue-500 bg-blue-50/70 shadow-sm'
                            : 'border-gray-200 hover:bg-gray-50'
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold uppercase text-gray-400">
                            {item.house_identifier} - M{item.module_number}
                          </div>
                          {statusBadge(item.status)}
                        </div>
                        <div className="mt-2 text-sm font-semibold text-gray-900">
                          {item.project_name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {item.house_type_name}
                          {item.sub_type_name ? ` - ${item.sub_type_name}` : ''}
                          {item.panel_code ? ` - ${item.panel_code}` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {!isW1 &&
                  workItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedWorkItemId(item.id)}
                      className={clsx(
                        'w-full rounded-xl border px-4 py-3 text-left transition-all',
                        selectedWorkItemId === item.id
                          ? 'border-blue-500 bg-blue-50/70 shadow-sm'
                          : 'border-gray-200 hover:bg-gray-50'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold uppercase text-gray-400">
                          {item.house_identifier} - M{item.module_number}
                        </div>
                        {statusBadge(item.status)}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-gray-900">
                        {item.project_name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {item.house_type_name}
                        {item.sub_type_name ? ` - ${item.sub_type_name}` : ''}
                        {item.panel_code ? ` - ${item.panel_code}` : ''}
                      </div>
                    </button>
                  ))}
              </>
            )}
          </div>
        </aside>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          {!selectedWorkItem ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
              Select a work item to view tasks.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Tasks for station</h2>
                  <p className="text-sm text-gray-500">
                    {selectedWorkItem.project_name} - {selectedWorkItem.house_identifier} -
                    Module {selectedWorkItem.module_number}
                  </p>
                </div>
                {selectedWorkItem.other_tasks.length > 0 && (
                  <button
                    onClick={() => setActiveModal('other_tasks')}
                    className="rounded-full border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Other tasks ({selectedWorkItem.other_tasks.length})
                  </button>
                )}
              </div>

              {selectedWorkItem.tasks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                  No station tasks assigned for this item.
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedWorkItem.tasks.map((task) => (
                    <div
                      key={task.task_definition_id}
                      className={clsx(
                        'rounded-xl border p-4 transition-all',
                        task.status === 'InProgress'
                          ? 'border-blue-200 bg-blue-50/50'
                          : task.status === 'Paused'
                          ? 'border-amber-200 bg-amber-50/50'
                          : 'border-gray-200 bg-white'
                      )}
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-semibold text-gray-900">{task.name}</h3>
                            {statusBadge(task.status)}
                          </div>
                          {task.notes && (
                            <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-gray-100 bg-white/70 px-2 py-1 text-xs text-gray-600">
                              <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
                              <span className="truncate max-w-md">{task.notes}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {task.status === 'InProgress' && (
                            <>
                              <button
                                onClick={() => openModal('comments', task, selectedWorkItem)}
                                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                              >
                                <MessageSquare className="h-4 w-4" /> Note
                              </button>
                              <button
                                onClick={() => openModal('pause', task, selectedWorkItem)}
                                className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                              >
                                <Pause className="h-4 w-4" /> Pause
                              </button>
                              <button
                                onClick={() => handleComplete(task)}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                              >
                                <CheckSquare className="h-4 w-4" /> Finish
                              </button>
                            </>
                          )}
                          {task.status === 'Paused' && (
                            <>
                              <button
                                onClick={() => handleResume(task)}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                              >
                                <Play className="h-4 w-4" /> Resume
                              </button>
                              <button
                                onClick={() => handleComplete(task)}
                                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                              >
                                <CheckSquare className="h-4 w-4" /> Finish
                              </button>
                            </>
                          )}
                          {task.status === 'NotStarted' && (
                            <>
                              {task.skippable && (
                                <button
                                  onClick={() => openModal('skip', task, selectedWorkItem)}
                                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50"
                                >
                                  <FastForward className="h-4 w-4" /> Skip
                                </button>
                              )}
                              <button
                                onClick={() => handleStart(task, selectedWorkItem)}
                                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800"
                              >
                                <Play className="h-4 w-4" /> Start
                              </button>
                            </>
                          )}
                          {(regularCrewByTaskId[task.task_definition_id]?.length ?? 0) > 0 && (
                            <button
                              onClick={() => handleCrewOpen(task, selectedWorkItem)}
                              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700"
                            >
                              <Users className="h-4 w-4" /> Crew
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {showStationPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40" onClick={() => setShowStationPicker(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <button
              onClick={() => setShowStationPicker(false)}
              className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-semibold text-gray-900">Select station</h3>
            <p className="mt-2 text-sm text-gray-500">
              Choose the station context for this session.
            </p>
            <div className="mt-4 space-y-2 max-h-[60vh] overflow-y-auto">
              {stations.map((station) => (
                <button
                  key={station.id}
                  onClick={() => {
                    setSelectedStationId(station.id);
                    setShowStationPicker(false);
                  }}
                  className="w-full rounded-lg border border-gray-200 px-4 py-3 text-left hover:border-blue-400 hover:bg-blue-50"
                >
                  <div className="font-semibold text-gray-900">{station.name}</div>
                  <div className="text-xs text-gray-500">
                    {station.role}
                    {station.line_type ? ` - Line ${station.line_type}` : ''}
                  </div>
                </button>
              ))}
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
            <h3 className="text-lg font-semibold text-gray-900">Pause task</h3>
            <p className="mt-1 text-sm text-gray-500">Select a reason to pause this task.</p>
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
              <label className="text-xs font-semibold text-gray-500">Custom reason</label>
              <input
                type="text"
                className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                value={reasonText}
                onChange={(event) => setReasonText(event.target.value)}
                placeholder="Add a custom reason"
              />
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const trimmed = reasonText.trim();
                  if (!trimmed) {
                    setReasonError('A reason is required.');
                    return;
                  }
                  handlePause(undefined, trimmed);
                }}
                className="flex-1 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white hover:bg-amber-600"
                disabled={submitting}
              >
                Pause task
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
            <h3 className="text-lg font-semibold text-gray-900">Skip task</h3>
            <p className="mt-1 text-sm text-gray-500">Provide a reason for skipping this task.</p>
            {reasonError && (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {reasonError}
              </div>
            )}
            <div className="mt-4 space-y-2">
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
              <label className="text-xs font-semibold text-gray-500">Custom reason</label>
              <input
                type="text"
                className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                value={reasonText}
                onChange={(event) => setReasonText(event.target.value)}
                placeholder="Add a custom reason"
              />
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const trimmed = reasonText.trim();
                  if (!trimmed) {
                    setReasonError('A reason is required.');
                    return;
                  }
                  handleSkip(trimmed);
                }}
                className="flex-1 rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-gray-800"
                disabled={submitting}
              >
                Skip task
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
            <h3 className="text-lg font-semibold text-gray-900">Task notes</h3>
            <p className="mt-1 text-sm text-gray-500">Add notes or observations for this task.</p>
            {commentError && (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {commentError}
              </div>
            )}
            {commentTemplates.length > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-2">
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
              placeholder="Write a note"
              value={commentDraft}
              onChange={(event) => setCommentDraft(event.target.value)}
            />
            <div className="mt-6 flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveComment}
                className="flex-1 rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-gray-800"
                disabled={submitting}
              >
                Save note
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
            <h3 className="text-lg font-semibold text-gray-900">Crew selection</h3>
            <p className="mt-1 text-sm text-gray-500">Pick teammates to start together.</p>
            <input
              className="mt-4 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Search workers"
              value={crewQuery}
              onChange={(event) => setCrewQuery(event.target.value)}
            />
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto">
              {filteredCrew.map((crewWorker) => (
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
                  {crewWorker.first_name} {crewWorker.last_name}
                </label>
              ))}
              {filteredCrew.length === 0 && (
                <div className="text-sm text-gray-500">No workers found.</div>
              )}
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={() => handleStart(selectedTask, selectedTaskWorkItem, crewSelection)}
                className="flex-1 rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-gray-800"
                disabled={submitting}
              >
                Start with crew
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
            <h3 className="text-lg font-semibold text-gray-900">Other tasks</h3>
            <p className="mt-1 text-sm text-gray-500">
              Unscheduled tasks available for this module/panel.
            </p>
            <div className="mt-4 space-y-3 max-h-[60vh] overflow-y-auto">
              {selectedWorkItem.other_tasks.map((task) => (
                <div key={task.task_definition_id} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-900">{task.name}</div>
                    {statusBadge(task.status)}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {task.status === 'NotStarted' && (
                      <button
                        onClick={() => handleStart(task, selectedWorkItem)}
                        className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white"
                      >
                        <Play className="h-4 w-4" /> Start
                      </button>
                    )}
                    {task.status === 'Paused' && (
                      <button
                        onClick={() => handleResume(task)}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
                      >
                        <Play className="h-4 w-4" /> Resume
                      </button>
                    )}
                    {task.status === 'InProgress' && (
                      <span className="text-xs text-gray-500">Task already in progress</span>
                    )}
                  </div>
                </div>
              ))}
              {selectedWorkItem.other_tasks.length === 0 && (
                <div className="text-sm text-gray-500">No other tasks available.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StationWorkspace;
