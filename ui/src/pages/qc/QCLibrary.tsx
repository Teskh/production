import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock,
  Eye,
  FileImage,
  Filter,
  Search,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import { useOptionalQCSession } from '../../layouts/QCLayoutContext';
import { formatDateTimeShort } from '../../utils/timeUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const PAGE_SIZE = 50;

type QCExecutionOutcome = 'Pass' | 'Fail' | 'Waive' | 'Skip';
type QCCheckStatus = 'Open' | 'Closed';
type TaskScope = 'panel' | 'module' | 'aux';
type QCReworkStatus = 'Open' | 'InProgress' | 'Done' | 'Canceled';
type TaskStatus = 'NotStarted' | 'InProgress' | 'Paused' | 'Completed';

type AdminUserRead = {
  id: number;
  first_name: string;
  last_name: string;
  role: string;
  active: boolean;
};

type QCLibraryWorkUnitSummary = {
  work_unit_id: number;
  module_number: number;
  house_identifier: string | null;
  project_name: string;
  house_type_name: string;
  status: string;
  open_checks: number;
  open_rework: number;
  last_outcome: QCExecutionOutcome | null;
  last_outcome_at: string | null;
};

type QCCheckInstanceSummary = {
  id: number;
  check_definition_id: number | null;
  check_name: string | null;
  origin: 'triggered' | 'manual';
  scope: TaskScope;
  work_unit_id: number;
  panel_unit_id: number | null;
  related_task_instance_id: number | null;
  station_id: number | null;
  station_name: string | null;
  current_station_id: number | null;
  current_station_name: string | null;
  module_number: number;
  panel_code: string | null;
  status: QCCheckStatus;
  severity_level: 'baja' | 'media' | 'critica' | null;
  opened_by_user_id: number | null;
  opened_at: string;
  closed_at: string | null;
};

type QCExecutionRead = {
  id: number;
  check_instance_id: number;
  outcome: QCExecutionOutcome;
  notes: string | null;
  performed_by_user_id: number;
  performed_at: string;
  failure_modes: Array<{
    id: number;
    failure_mode_definition_id: number | null;
    failure_mode_name: string | null;
    other_text: string | null;
    measurement_json: Record<string, unknown> | null;
    notes: string | null;
  }>;
};

type QCReworkTaskSummary = {
  id: number;
  check_instance_id: number;
  description: string;
  status: QCReworkStatus;
  check_status: QCCheckStatus | null;
  task_status: TaskStatus | null;
  work_unit_id: number;
  panel_unit_id: number | null;
  station_id: number | null;
  station_name: string | null;
  current_station_id: number | null;
  current_station_name: string | null;
  module_number: number;
  panel_code: string | null;
  created_at: string;
};

type QCEvidenceSummary = {
  id: number;
  execution_id: number;
  media_asset_id: number;
  uri: string;
  mime_type: string | null;
  captured_at: string;
};

type QCLibraryWorkUnitDetail = {
  work_unit_id: number;
  module_number: number;
  house_identifier: string | null;
  project_name: string;
  house_type_name: string;
  status: string;
  checks: QCCheckInstanceSummary[];
  executions: QCExecutionRead[];
  rework_tasks: QCReworkTaskSummary[];
  evidence: QCEvidenceSummary[];
};

type QCTaskInstanceWithWorkersSummary = {
  task_instance_id: number;
  task_definition_id: number;
  task_name: string;
  station_id: number | null;
  station_name: string | null;
  status: TaskStatus;
  started_at: string | null;
  completed_at: string | null;
  workers: Array<{ worker_id: number; worker_name: string }>;
};

type QCReworkAttemptSummary = {
  rework_task_id: number;
  task_instance_id: number;
  station_id: number | null;
  station_name: string | null;
  status: TaskStatus;
  started_at: string | null;
  completed_at: string | null;
  workers: Array<{ worker_id: number; worker_name: string }>;
};

type QCFailureModeSummary = {
  id: number;
  check_definition_id: number | null;
  name: string;
  description: string | null;
  default_severity_level: 'baja' | 'media' | 'critica' | null;
  default_rework_description: string | null;
};

type QCCheckInstanceDetail = {
  check_instance: QCCheckInstanceSummary;
  failure_modes: QCFailureModeSummary[];
  executions: QCExecutionRead[];
  rework_tasks: QCReworkTaskSummary[];
  rework_attempts: QCReworkAttemptSummary[];
  evidence: QCEvidenceSummary[];
  trigger_task: QCTaskInstanceWithWorkersSummary | null;
};

const apiRequest = async <T,>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Solicitud fallida (${response.status})`);
  }
  return (await response.json()) as T;
};

const resolveMediaUri = (uri: string): string => {
  if (!uri) return uri;
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  if (uri.startsWith('/')) return `${API_BASE_URL}${uri}`;
  return `${API_BASE_URL}/${uri}`;
};

const outcomeLabel: Record<QCExecutionOutcome, string> = {
  Pass: 'Aprobado',
  Fail: 'Fallido',
  Waive: 'Dispensado',
  Skip: 'Omitido',
};

const checkStatusLabel: Record<QCCheckStatus, string> = {
  Open: 'Abierto',
  Closed: 'Cerrado',
};

const reworkStatusLabel: Record<QCReworkStatus, string> = {
  Open: 'Abierto',
  InProgress: 'En progreso',
  Done: 'Finalizado',
  Canceled: 'Cancelado',
};

const taskStatusLabel: Record<TaskStatus, string> = {
  NotStarted: 'Sin iniciar',
  InProgress: 'En trabajo',
  Paused: 'En pausa',
  Completed: 'Completado',
};

const scopeLabel: Record<TaskScope, string> = {
  panel: 'Panel',
  module: 'Modulo',
  aux: 'Aux',
};

const classForOutcome = (outcome: QCExecutionOutcome | null | undefined) => {
  if (outcome === 'Pass') return 'bg-emerald-50 text-emerald-800 border-emerald-100';
  if (outcome === 'Fail') return 'bg-rose-50 text-rose-800 border-rose-100';
  if (outcome === 'Waive') return 'bg-amber-50 text-amber-800 border-amber-100';
  if (outcome === 'Skip') return 'bg-slate-50 text-slate-700 border-slate-100';
  return 'bg-white text-[var(--ink-muted)] border-black/10';
};

const classForCheckStatus = (status: QCCheckStatus) => {
  if (status === 'Open') return 'bg-sky-50 text-sky-800 border-sky-100';
  return 'bg-white text-[var(--ink-muted)] border-black/10';
};

const manualSubtypeLabel = (check: QCCheckInstanceSummary): string | null => {
  if (check.origin !== 'manual') return null;
  return check.check_definition_id === null ? 'Ad-hoc' : 'Manual desde check';
};

const QCLibrary: React.FC = () => {
  const qcSession = useOptionalQCSession();
  const [searchParams, setSearchParams] = useSearchParams();

  const [workUnits, setWorkUnits] = useState<QCLibraryWorkUnitSummary[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [loadingMoreUnits, setLoadingMoreUnits] = useState(false);
  const [hasMoreUnits, setHasMoreUnits] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState(false);

  const [adminUsers, setAdminUsers] = useState<AdminUserRead[]>([]);

  const [searchTerm, setSearchTerm] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('__all__');
  const [statusFilter, setStatusFilter] = useState<string>('__all__');
  const [unfulfilledOnly, setUnfulfilledOnly] = useState(false);

  const selectedWorkUnitId = Number(searchParams.get('module') ?? '') || null;
  const selectedCheckId = Number(searchParams.get('check') ?? '') || null;

  const [workUnitDetail, setWorkUnitDetail] = useState<QCLibraryWorkUnitDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [checkDetail, setCheckDetail] = useState<QCCheckInstanceDetail | null>(null);
  const [loadingCheckDetail, setLoadingCheckDetail] = useState(false);
  const [checkDetailError, setCheckDetailError] = useState<string | null>(null);

  const [mediaViewer, setMediaViewer] = useState<{
    uri: string;
    mimeType: string | null;
    title: string;
  } | null>(null);

  const closeModuleOverlay = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('module');
    next.delete('check');
    setSearchParams(next, { replace: true });
    setWorkUnitDetail(null);
    setDetailError(null);
  }, [searchParams, setSearchParams]);

  const openModuleOverlay = (workUnitId: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('module', String(workUnitId));
    next.delete('check');
    setSearchParams(next, { replace: true });
  };

  const closeCheckOverlay = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('check');
    setSearchParams(next, { replace: true });
    setCheckDetail(null);
    setCheckDetailError(null);
  }, [searchParams, setSearchParams]);

  const openCheckOverlay = (checkId: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('check', String(checkId));
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    let mounted = true;
    if (!qcSession) {
      setWorkUnits([]);
      setLoadingUnits(false);
      setLoadingMoreUnits(false);
      setHasMoreUnits(false);
      setIsUnauthorized(true);
      return () => {
        mounted = false;
      };
    }

    const loadUnits = async () => {
      setLoadingUnits(true);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: '0',
          include_planned: 'false',
          sort: 'newest',
        });
        const response = await fetch(`${API_BASE_URL}/api/qc/library/work-units?${params.toString()}`, {
          credentials: 'include',
        });
        if (!mounted) return;
        if (response.status === 401) {
          setWorkUnits([]);
          setHasMoreUnits(false);
          setIsUnauthorized(true);
          setUnitsError(null);
          return;
        }
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Solicitud fallida (${response.status})`);
        }
        const data = (await response.json()) as QCLibraryWorkUnitSummary[];
        setWorkUnits(data);
        setHasMoreUnits(data.length === PAGE_SIZE);
        setUnitsError(null);
        setIsUnauthorized(false);
      } catch (error) {
        if (!mounted) return;
        const message =
          error instanceof Error ? error.message : 'No se pudo cargar la biblioteca QC.';
        setUnitsError(message);
      } finally {
        if (mounted) setLoadingUnits(false);
      }
    };

    void loadUnits();
    return () => {
      mounted = false;
    };
  }, [qcSession]);

  const loadMoreUnits = async () => {
    if (!qcSession) return;
    if (loadingUnits || loadingMoreUnits || !hasMoreUnits) return;
    setLoadingMoreUnits(true);
    try {
      const offset = workUnits.length;
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        include_planned: 'false',
        sort: 'newest',
      });
      const response = await fetch(`${API_BASE_URL}/api/qc/library/work-units?${params.toString()}`, {
        credentials: 'include',
      });
      if (response.status === 401) {
        setWorkUnits([]);
        setHasMoreUnits(false);
        setIsUnauthorized(true);
        setUnitsError(null);
        return;
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Solicitud fallida (${response.status})`);
      }
      const data = (await response.json()) as QCLibraryWorkUnitSummary[];
      setWorkUnits((prev) => {
        const next = [...prev];
        const existing = new Set(prev.map((unit) => unit.work_unit_id));
        for (const unit of data) {
          if (existing.has(unit.work_unit_id)) continue;
          next.push(unit);
        }
        return next;
      });
      setHasMoreUnits(data.length === PAGE_SIZE);
      setUnitsError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo cargar mas modulos.';
      setUnitsError(message);
    } finally {
      setLoadingMoreUnits(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    if (!qcSession) {
      setAdminUsers([]);
      return () => {
        mounted = false;
      };
    }
    const loadAdminUsers = async () => {
      try {
        const users = await apiRequest<AdminUserRead[]>('/api/admin/users');
        if (!mounted) return;
        setAdminUsers(users);
      } catch {
        if (mounted) setAdminUsers([]);
      }
    };
    void loadAdminUsers();
    return () => {
      mounted = false;
    };
  }, [qcSession]);

  const adminNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const user of adminUsers) {
      map.set(user.id, `${user.first_name} ${user.last_name}`.trim());
    }
    return map;
  }, [adminUsers]);

  const projectOptions = useMemo(() => {
    const uniq = new Set<string>();
    for (const unit of workUnits) {
      if (unit.project_name) uniq.add(unit.project_name);
    }
    return Array.from(uniq).sort((a, b) => a.localeCompare(b));
  }, [workUnits]);

  const statusOptions = useMemo(() => {
    const uniq = new Set<string>();
    for (const unit of workUnits) {
      if (unit.status) uniq.add(unit.status);
    }
    return Array.from(uniq).sort((a, b) => a.localeCompare(b));
  }, [workUnits]);

  const filteredUnits = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return workUnits.filter((unit) => {
      if (unit.status === 'Planned') return false;
      if (projectFilter !== '__all__' && unit.project_name !== projectFilter) return false;
      if (statusFilter !== '__all__' && unit.status !== statusFilter) return false;
      if (unfulfilledOnly && unit.open_checks + unit.open_rework === 0) return false;
      if (!needle) return true;
      return (
        String(unit.module_number).toLowerCase().includes(needle) ||
        unit.project_name.toLowerCase().includes(needle) ||
        unit.house_type_name.toLowerCase().includes(needle)
      );
    });
  }, [projectFilter, searchTerm, statusFilter, unfulfilledOnly, workUnits]);

  const summaryCounts = useMemo(() => {
    const totals = {
      modules: filteredUnits.length,
      openChecks: filteredUnits.reduce((acc, unit) => acc + unit.open_checks, 0),
      openRework: filteredUnits.reduce((acc, unit) => acc + unit.open_rework, 0),
    };
    return totals;
  }, [filteredUnits]);

  useEffect(() => {
    let mounted = true;
    if (!selectedWorkUnitId) {
      setWorkUnitDetail(null);
      setDetailError(null);
      return () => {
        mounted = false;
      };
    }
    const loadDetail = async () => {
      setLoadingDetail(true);
      try {
        const detail = await apiRequest<QCLibraryWorkUnitDetail>(
          `/api/qc/library/work-units/${selectedWorkUnitId}`
        );
        if (!mounted) return;
        setWorkUnitDetail(detail);
        setDetailError(null);
      } catch (error) {
        if (!mounted) return;
        const message =
          error instanceof Error ? error.message : 'No se pudo cargar el detalle del modulo.';
        setDetailError(message);
        setWorkUnitDetail(null);
      } finally {
        if (mounted) setLoadingDetail(false);
      }
    };
    void loadDetail();
    return () => {
      mounted = false;
    };
  }, [selectedWorkUnitId]);

  useEffect(() => {
    let mounted = true;
    if (!selectedCheckId) {
      setCheckDetail(null);
      setCheckDetailError(null);
      return () => {
        mounted = false;
      };
    }
    const loadCheck = async () => {
      setLoadingCheckDetail(true);
      try {
        const detail = await apiRequest<QCCheckInstanceDetail>(`/api/qc/check-instances/${selectedCheckId}`);
        if (!mounted) return;
        setCheckDetail(detail);
        setCheckDetailError(null);
      } catch (error) {
        if (!mounted) return;
        const message =
          error instanceof Error ? error.message : 'No se pudo cargar el detalle de la inspeccion.';
        setCheckDetailError(message);
        setCheckDetail(null);
      } finally {
        if (mounted) setLoadingCheckDetail(false);
      }
    };
    void loadCheck();
    return () => {
      mounted = false;
    };
  }, [selectedCheckId]);

  const workUnitById = useMemo(() => {
    const map = new Map<number, QCLibraryWorkUnitSummary>();
    for (const unit of workUnits) map.set(unit.work_unit_id, unit);
    return map;
  }, [workUnits]);

  const selectedWorkUnitSummary = selectedWorkUnitId ? workUnitById.get(selectedWorkUnitId) : null;

  const groupedChecks = useMemo(() => {
    const checks = workUnitDetail?.checks ?? [];
    const byPanel = new Map<string, QCCheckInstanceSummary[]>();
    const moduleChecks: QCCheckInstanceSummary[] = [];
    const auxChecks: QCCheckInstanceSummary[] = [];
    for (const check of checks) {
      if (check.scope === 'panel' && check.panel_code) {
        const list = byPanel.get(check.panel_code) ?? [];
        list.push(check);
        byPanel.set(check.panel_code, list);
      } else if (check.scope === 'module') {
        moduleChecks.push(check);
      } else {
        auxChecks.push(check);
      }
    }
    for (const list of byPanel.values()) {
      list.sort((a, b) => (b.opened_at ?? '').localeCompare(a.opened_at ?? ''));
    }
    moduleChecks.sort((a, b) => (b.opened_at ?? '').localeCompare(a.opened_at ?? ''));
    auxChecks.sort((a, b) => (b.opened_at ?? '').localeCompare(a.opened_at ?? ''));
    return {
      byPanel: Array.from(byPanel.entries()).sort(([a], [b]) => a.localeCompare(b)),
      moduleChecks,
      auxChecks,
    };
  }, [workUnitDetail]);

  type TimelineEvent = {
    id: string;
    ts: string | null;
    kind: 'check-opened' | 'execution' | 'rework';
    title: string;
    subtitle: string;
    outcome?: QCExecutionOutcome | null;
    checkId?: number;
    executionId?: number;
  };

  const timeline = useMemo(() => {
    if (!workUnitDetail) return [];
    const checkNameById = new Map<number, string>();
    for (const check of workUnitDetail.checks) {
      checkNameById.set(check.id, check.check_name ?? `Check #${check.id}`);
    }
    const events: TimelineEvent[] = [];
    for (const check of workUnitDetail.checks) {
      events.push({
        id: `check-opened:${check.id}`,
        ts: check.opened_at,
        kind: 'check-opened',
        title: check.check_name ?? `Check #${check.id}`,
        subtitle: `${scopeLabel[check.scope]}${check.panel_code ? ` ${check.panel_code}` : ''} · ${checkStatusLabel[check.status]}`,
        checkId: check.id,
      });
      if (check.closed_at) {
        events.push({
          id: `check-closed:${check.id}:${check.closed_at}`,
          ts: check.closed_at,
          kind: 'check-opened',
          title: `Cierre: ${check.check_name ?? `Check #${check.id}`}`,
          subtitle: `${scopeLabel[check.scope]}${check.panel_code ? ` ${check.panel_code}` : ''}`,
          checkId: check.id,
        });
      }
    }
    for (const exec of workUnitDetail.executions) {
      events.push({
        id: `exec:${exec.id}`,
        ts: exec.performed_at,
        kind: 'execution',
        title: `${outcomeLabel[exec.outcome]} · ${checkNameById.get(exec.check_instance_id) ?? `Check #${exec.check_instance_id}`}`,
        subtitle: `${adminNameById.get(exec.performed_by_user_id) ?? `Usuario #${exec.performed_by_user_id}`}`,
        outcome: exec.outcome,
        checkId: exec.check_instance_id,
        executionId: exec.id,
      });
    }
    for (const rework of workUnitDetail.rework_tasks) {
      events.push({
        id: `rework:${rework.id}`,
        ts: rework.created_at,
        kind: 'rework',
        title: `Rework: ${reworkStatusLabel[rework.status]}`,
        subtitle: `${rework.description}${rework.panel_code ? ` · Panel ${rework.panel_code}` : ''}`,
        checkId: rework.check_instance_id,
      });
    }
    return events.sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''));
  }, [adminNameById, workUnitDetail]);

  const closeOnEscapeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeOnEscapeRef.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    closeOnEscapeRef.current = () => {
      if (mediaViewer) return setMediaViewer(null);
      if (selectedCheckId) return closeCheckOverlay();
      if (selectedWorkUnitId) return closeModuleOverlay();
    };
  }, [closeCheckOverlay, closeModuleOverlay, mediaViewer, selectedCheckId, selectedWorkUnitId]);

  if (isUnauthorized) {
    return (
      <div className="rounded-3xl border border-black/10 bg-white/80 p-6 text-sm text-[var(--ink-muted)] shadow-sm">
        Inicia sesion como QC para ver la biblioteca.
        <Link className="ml-2 font-semibold text-[var(--ink)] underline" to="/login">
          Iniciar sesion
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-black/10 bg-white/80 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
              Historial y trazabilidad
            </p>
            <h2 className="mt-2 font-display text-2xl text-[var(--ink)]">Biblioteca QC</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-xs text-[var(--ink-muted)]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Modulos: <span className="font-semibold text-[var(--ink)]">{summaryCounts.modules}</span>
              </div>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
              Revisiones abiertas:{' '}
              <span className="font-semibold text-emerald-900">{summaryCounts.openChecks}</span>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Rework abierto:{' '}
              <span className="font-semibold text-amber-900">{summaryCounts.openRework}</span>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_220px_auto]">
          <label className="relative">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar por modulo, proyecto o tipo..."
              className="w-full rounded-2xl border border-black/10 bg-white px-10 py-3 text-sm text-[var(--ink)] shadow-sm outline-none focus:ring-2 focus:ring-black/10"
            />
          </label>

          <label className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--ink-muted)] shadow-sm">
            <Filter className="h-4 w-4" />
            <select
              className="w-full bg-transparent text-sm text-[var(--ink)] outline-none"
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
            >
              <option value="__all__">Todos los proyectos</option>
              {projectOptions.map((project) => (
                <option key={project} value={project}>
                  {project}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--ink-muted)] shadow-sm">
            <Filter className="h-4 w-4" />
            <select
              className="w-full bg-transparent text-sm text-[var(--ink)] outline-none"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="__all__">Todos los estados</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--ink)] shadow-sm">
            <span className="text-sm font-medium">Solo pendientes</span>
            <input
              type="checkbox"
              checked={unfulfilledOnly}
              onChange={(event) => setUnfulfilledOnly(event.target.checked)}
              className="h-4 w-4"
            />
          </label>
        </div>
        {unitsError ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {unitsError}
          </div>
        ) : null}
      </header>

      <section className="rounded-3xl border border-black/10 bg-white/80 shadow-sm overflow-hidden">
        <div className="border-b border-black/5 bg-white/70 px-5 py-4 text-sm text-[var(--ink-muted)]">
          {loadingUnits
            ? 'Cargando modulos...'
            : `Mostrando ${filteredUnits.length} de ${workUnits.length} modulos cargados`}
        </div>
        <div className="divide-y divide-black/5">
          {loadingUnits && !filteredUnits.length ? (
            <div className="px-5 py-6 text-sm text-[var(--ink-muted)]">Cargando biblioteca...</div>
          ) : null}
          {!loadingUnits && !filteredUnits.length ? (
            <div className="px-5 py-6 text-sm text-[var(--ink-muted)]">Sin resultados.</div>
          ) : null}
          {filteredUnits.map((unit) => (
            <button
              key={unit.work_unit_id}
              type="button"
              onClick={() => openModuleOverlay(unit.work_unit_id)}
              className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-white"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--ink)] text-white">
                <span className="text-sm font-semibold">
                  {unit.house_identifier ?? '-'}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--ink)]">
                    {unit.project_name}
                  </span>
                  <span className="text-xs text-[var(--ink-muted)]">·</span>
                  <span className="text-sm text-[var(--ink-muted)]">
                    {unit.house_type_name} MD {unit.module_number}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                  Estado: <span className="font-medium text-[var(--ink)]">{unit.status}</span>
                  {unit.last_outcome ? (
                    <>
                      <span className="text-[var(--ink-muted)]">·</span>
                      <span
                        className={clsx(
                          'inline-flex items-center rounded-full border px-2 py-0.5 font-semibold',
                          classForOutcome(unit.last_outcome)
                        )}
                      >
                        {outcomeLabel[unit.last_outcome]}
                        {unit.last_outcome_at ? ` · ${formatDateTimeShort(unit.last_outcome_at)}` : ''}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
                  {unit.open_checks} checks
                </span>
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                  {unit.open_rework} rework
                </span>
              </div>
              <ChevronRight className="h-5 w-5 text-[var(--ink-muted)]" />
            </button>
          ))}
        </div>
        {hasMoreUnits ? (
          <div className="border-t border-black/5 bg-white/60 px-5 py-4">
            <button
              type="button"
              onClick={loadMoreUnits}
              disabled={loadingMoreUnits}
              className="inline-flex items-center justify-center rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMoreUnits ? `Cargando ${PAGE_SIZE}...` : `Cargar ${PAGE_SIZE} mas`}
            </button>
          </div>
        ) : null}
      </section>

      {selectedWorkUnitId ? (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40 px-4 py-6">
          <div className="absolute inset-0" onClick={closeModuleOverlay} />
          <div className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-black/10 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-black/5 bg-white/70 px-6 py-5 backdrop-blur">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Detalle del modulo
                </p>
                <h3 className="mt-2 text-xl font-display text-[var(--ink)]">
                  Modulo {selectedWorkUnitSummary?.house_identifier ?? workUnitDetail?.house_identifier ?? '-'}{' '}
                  <span className="text-[var(--ink-muted)]">
                    · {selectedWorkUnitSummary?.project_name ?? 'Proyecto'}
                  </span>
                </h3>
                <div className="mt-1 text-sm text-[var(--ink-muted)]">
                  {selectedWorkUnitSummary?.house_type_name ?? workUnitDetail?.house_type_name ?? '-'} MD{' '}
                  {selectedWorkUnitSummary?.module_number ??
                    workUnitDetail?.module_number ??
                    selectedWorkUnitId}{' '}
                  ·{' '}
                  {selectedWorkUnitSummary?.status ?? workUnitDetail?.status ?? '-'}
                </div>
              </div>
              <button
                type="button"
                onClick={closeModuleOverlay}
                className="rounded-full border border-black/10 p-2 text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white">
              {loadingDetail ? (
                <div className="px-6 py-6 text-sm text-[var(--ink-muted)]">Cargando detalle...</div>
              ) : null}
              {detailError ? (
                <div className="px-6 py-6 text-sm text-rose-800">{detailError}</div>
              ) : null}

              {!loadingDetail && workUnitDetail ? (
                <div className="space-y-6 px-6 py-6">
                  <section className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                        Checks abiertos
                      </p>
                      <p className="mt-3 text-2xl font-semibold text-[var(--ink)]">
                        {selectedWorkUnitSummary?.open_checks ?? 0}
                      </p>
                    </div>
                    <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                        Rework abierto
                      </p>
                      <p className="mt-3 text-2xl font-semibold text-[var(--ink)]">
                        {selectedWorkUnitSummary?.open_rework ?? 0}
                      </p>
                    </div>
                    <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                        Ultimo resultado
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {selectedWorkUnitSummary?.last_outcome ? (
                          <span
                            className={clsx(
                              'inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold',
                              classForOutcome(selectedWorkUnitSummary.last_outcome)
                            )}
                          >
                            {outcomeLabel[selectedWorkUnitSummary.last_outcome]}
                          </span>
                        ) : (
                          <span className="text-sm text-[var(--ink-muted)]">-</span>
                        )}
                        {selectedWorkUnitSummary?.last_outcome_at ? (
                          <span className="text-sm text-[var(--ink-muted)]">
                            {formatDateTimeShort(selectedWorkUnitSummary.last_outcome_at)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </section>

                  <section className="rounded-3xl border border-black/10 bg-white shadow-sm">
                    <div className="border-b border-black/5 px-5 py-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                        <Clock className="h-4 w-4 text-[var(--ink-muted)]" />
                        Timeline QC
                      </div>
                    </div>
                    <div className="divide-y divide-black/5">
                      {!timeline.length ? (
                        <div className="px-5 py-6 text-sm text-[var(--ink-muted)]">
                          No hay eventos QC para este modulo.
                        </div>
                      ) : null}
                      {timeline.map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => (event.checkId ? openCheckOverlay(event.checkId) : null)}
                          className="flex w-full items-start gap-4 px-5 py-4 text-left hover:bg-white"
                        >
                          <div
                            className={clsx(
                              'mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl border',
                              event.kind === 'rework'
                                ? 'border-amber-200 bg-amber-50 text-amber-800'
                                : event.kind === 'execution'
                                ? classForOutcome(event.outcome)
                                : 'border-sky-200 bg-sky-50 text-sky-800'
                            )}
                          >
                            {event.kind === 'rework' ? (
                              <Wrench className="h-4 w-4" />
                            ) : event.kind === 'execution' ? (
                              event.outcome === 'Pass' ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : event.outcome === 'Fail' ? (
                                <AlertTriangle className="h-4 w-4" />
                              ) : (
                                <CircleDot className="h-4 w-4" />
                              )
                            ) : (
                              <CircleDot className="h-4 w-4" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-[var(--ink)]">
                                  {event.title}
                                </div>
                                <div className="mt-1 text-xs text-[var(--ink-muted)]">
                                  {event.subtitle}
                                </div>
                              </div>
                              <div className="text-xs text-[var(--ink-muted)]">
                                {event.ts ? formatDateTimeShort(event.ts) : '-'}
                              </div>
                            </div>
                          </div>
                          <ChevronRight className="mt-2 h-4 w-4 text-[var(--ink-muted)]" />
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="grid gap-6 lg:grid-cols-2">
                    <div className="rounded-3xl border border-black/10 bg-white shadow-sm">
                      <div className="border-b border-black/5 px-5 py-4">
                        <div className="text-sm font-semibold text-[var(--ink)]">Checks por panel</div>
                      </div>
                      <div className="divide-y divide-black/5">
                        {!groupedChecks.byPanel.length ? (
                          <div className="px-5 py-6 text-sm text-[var(--ink-muted)]">
                            No hay checks asociados a paneles para este modulo.
                          </div>
                        ) : null}
                        {groupedChecks.byPanel.map(([panelCode, checks]) => (
                          <div key={panelCode} className="px-5 py-4">
                            <div className="mb-3 text-sm font-semibold text-[var(--ink)]">
                              Panel {panelCode}
                            </div>
                            <div className="space-y-2">
                              {checks.map((check) => (
                                <button
                                  key={check.id}
                                  type="button"
                                  onClick={() => openCheckOverlay(check.id)}
                                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-left hover:bg-[rgba(15,27,45,0.02)]"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-[var(--ink)]">
                                      {check.check_name ?? `Check #${check.id}`}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                                      {manualSubtypeLabel(check) ? (
                                        <span className="rounded-full border border-black/10 bg-white px-2 py-0.5">
                                          {manualSubtypeLabel(check)}
                                        </span>
                                      ) : null}
                                      <span className={clsx('rounded-full border px-2 py-0.5', classForCheckStatus(check.status))}>
                                        {checkStatusLabel[check.status]}
                                      </span>
                                      <span>
                                        {formatDateTimeShort(check.opened_at)}
                                        {check.closed_at ? ` → ${formatDateTimeShort(check.closed_at)}` : ''}
                                      </span>
                                    </div>
                                  </div>
                                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                                    <Eye className="h-4 w-4 text-[var(--ink-muted)]" />
                                    Ver
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-3xl border border-black/10 bg-white shadow-sm">
                      <div className="border-b border-black/5 px-5 py-4">
                        <div className="text-sm font-semibold text-[var(--ink)]">Checks de modulo</div>
                      </div>
                      <div className="px-5 py-4">
                        {!groupedChecks.moduleChecks.length && !groupedChecks.auxChecks.length ? (
                          <div className="text-sm text-[var(--ink-muted)]">
                            No hay checks de modulo/aux para este modulo.
                          </div>
                        ) : null}
                        <div className="space-y-2">
                          {[...groupedChecks.moduleChecks, ...groupedChecks.auxChecks].map((check) => (
                            <button
                              key={check.id}
                              type="button"
                              onClick={() => openCheckOverlay(check.id)}
                              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-left hover:bg-[rgba(15,27,45,0.02)]"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-[var(--ink)]">
                                  {check.check_name ?? `Check #${check.id}`}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                                  <span className="rounded-full border border-black/10 bg-white px-2 py-0.5">
                                    {scopeLabel[check.scope]}
                                  </span>
                                  {manualSubtypeLabel(check) ? (
                                    <span className="rounded-full border border-black/10 bg-white px-2 py-0.5">
                                      {manualSubtypeLabel(check)}
                                    </span>
                                  ) : null}
                                  <span className={clsx('rounded-full border px-2 py-0.5', classForCheckStatus(check.status))}>
                                    {checkStatusLabel[check.status]}
                                  </span>
                                  <span>
                                    {formatDateTimeShort(check.opened_at)}
                                    {check.closed_at ? ` → ${formatDateTimeShort(check.closed_at)}` : ''}
                                  </span>
                                </div>
                              </div>
                              <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                                <Eye className="h-4 w-4 text-[var(--ink-muted)]" />
                                Ver
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {selectedCheckId ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="absolute inset-0" onClick={closeCheckOverlay} />
          <div className="relative max-h-full w-full max-w-4xl overflow-hidden rounded-3xl border border-black/10 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-black/5 bg-white/70 px-6 py-5 backdrop-blur">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Inspeccion QC
                </p>
                <h3 className="mt-2 text-xl font-display text-[var(--ink)]">
                  {checkDetail?.check_instance.check_name ?? `Check #${selectedCheckId}`}
                </h3>
                {checkDetail?.check_instance ? (
                  <div className="mt-1 text-sm text-[var(--ink-muted)]">
                    Modulo {checkDetail.check_instance.module_number}
                    {checkDetail.check_instance.panel_code
                      ? ` · Panel ${checkDetail.check_instance.panel_code}`
                      : ''}
                    {checkDetail.check_instance.station_name
                      ? ` · ${checkDetail.check_instance.station_name}`
                      : ''}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={closeCheckOverlay}
                className="rounded-full border border-black/10 p-2 text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(100vh-9rem)] overflow-y-auto px-6 py-6">
              {loadingCheckDetail ? (
                <div className="text-sm text-[var(--ink-muted)]">Cargando inspeccion...</div>
              ) : null}
              {checkDetailError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {checkDetailError}
                </div>
              ) : null}

              {!loadingCheckDetail && checkDetail ? (
                <div className="space-y-6">
                  <section className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Estado</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className={clsx('rounded-full border px-3 py-1 text-sm font-semibold', classForCheckStatus(checkDetail.check_instance.status))}>
                          {checkStatusLabel[checkDetail.check_instance.status]}
                        </span>
                        <span className="text-sm text-[var(--ink-muted)]">
                          {formatDateTimeShort(checkDetail.check_instance.opened_at)}
                          {checkDetail.check_instance.closed_at
                            ? ` → ${formatDateTimeShort(checkDetail.check_instance.closed_at)}`
                            : ''}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Contexto</p>
                      <div className="mt-3 text-sm text-[var(--ink)]">
                        {scopeLabel[checkDetail.check_instance.scope]}
                        {checkDetail.check_instance.panel_code ? ` · Panel ${checkDetail.check_instance.panel_code}` : ''}
                      </div>
                      <div className="mt-2 text-xs text-[var(--ink-muted)]">
                        Origen: {checkDetail.check_instance.origin === 'triggered' ? 'Trigger' : 'Manual'}
                      </div>
                      {manualSubtypeLabel(checkDetail.check_instance) ? (
                        <div className="mt-2 text-xs text-[var(--ink-muted)]">
                          Tipo manual: {manualSubtypeLabel(checkDetail.check_instance)}
                        </div>
                      ) : null}
                    </div>
                    <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Acciones</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          to={`/qc/execute?check=${checkDetail.check_instance.id}`}
                          className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-sm"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          Abrir ejecucion
                        </Link>
                      </div>
                    </div>
                  </section>

                  {checkDetail.trigger_task ? (
                    <section className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                        Tarea verificada (origen)
                      </p>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div>
                          <div className="text-sm font-semibold text-[var(--ink)]">
                            {checkDetail.trigger_task.task_name}
                          </div>
                          <div className="mt-1 text-xs text-[var(--ink-muted)]">
                            {checkDetail.trigger_task.station_name ?? 'Sin estacion'} ·{' '}
                            {checkDetail.trigger_task.completed_at
                              ? `Completada ${formatDateTimeShort(checkDetail.trigger_task.completed_at)}`
                              : taskStatusLabel[checkDetail.trigger_task.status]}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-[var(--ink)]">Realizada por</div>
                          <div className="mt-1 text-sm text-[var(--ink-muted)]">
                            {checkDetail.trigger_task.workers.length
                              ? checkDetail.trigger_task.workers.map((w) => w.worker_name).join(', ')
                              : '-'}
                          </div>
                        </div>
                      </div>
                    </section>
                  ) : null}

                  <section className="rounded-3xl border border-black/10 bg-white shadow-sm">
                    <div className="border-b border-black/5 px-5 py-4">
                      <div className="text-sm font-semibold text-[var(--ink)]">Ejecuciones</div>
                    </div>
                    <div className="divide-y divide-black/5">
                      {!checkDetail.executions.length ? (
                        <div className="px-5 py-6 text-sm text-[var(--ink-muted)]">
                          Sin ejecuciones registradas.
                        </div>
                      ) : null}
                      {checkDetail.executions.map((exec) => {
                        const evidence = checkDetail.evidence.filter((e) => e.execution_id === exec.id);
                        return (
                          <div key={exec.id} className="px-5 py-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={clsx('inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold', classForOutcome(exec.outcome))}>
                                    {outcomeLabel[exec.outcome]}
                                  </span>
                                  <span className="text-xs text-[var(--ink-muted)]">
                                    {formatDateTimeShort(exec.performed_at)}
                                  </span>
                                </div>
                                <div className="mt-2 text-xs text-[var(--ink-muted)]">
                                  QC: {adminNameById.get(exec.performed_by_user_id) ?? `Usuario #${exec.performed_by_user_id}`}
                                </div>
                                {exec.notes ? (
                                  <div className="mt-2 text-sm text-[var(--ink)]">{exec.notes}</div>
                                ) : null}
                                {exec.failure_modes.length ? (
                                  <div className="mt-3 text-xs text-[var(--ink-muted)]">
                                    Fallas:{' '}
                                    <span className="font-medium text-[var(--ink)]">
                                      {exec.failure_modes
                                        .map((mode) => mode.failure_mode_name ?? mode.other_text ?? 'Otro')
                                        .join(', ')}
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                              <div className="text-xs text-[var(--ink-muted)]">#{exec.id}</div>
                            </div>

                            {evidence.length ? (
                              <div className="mt-4">
                                <div className="mb-2 text-xs font-semibold text-[var(--ink)]">
                                  Evidencia ({evidence.length})
                                </div>
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                                  {evidence.map((item) => (
                                    <button
                                      key={item.id}
                                      type="button"
                                      onClick={() =>
                                        setMediaViewer({
                                          uri: resolveMediaUri(item.uri),
                                          mimeType: item.mime_type,
                                          title: `Evidencia #${item.id}`,
                                        })
                                      }
                                      className="group relative overflow-hidden rounded-2xl border border-black/10 bg-[rgba(15,27,45,0.02)]"
                                    >
                                      {item.mime_type?.startsWith('image/') ? (
                                        <img
                                          src={resolveMediaUri(item.uri)}
                                          alt={`Evidencia ${item.id}`}
                                          className="h-28 w-full object-cover transition group-hover:scale-[1.02]"
                                          loading="lazy"
                                        />
                                      ) : (
                                        <div className="flex h-28 w-full items-center justify-center text-[var(--ink-muted)]">
                                          <FileImage className="h-6 w-6" />
                                        </div>
                                      )}
                                      <div className="absolute inset-x-0 bottom-0 bg-black/40 px-2 py-1 text-[10px] text-white">
                                        {formatDateTimeShort(item.captured_at)}
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="rounded-3xl border border-black/10 bg-white shadow-sm">
                    <div className="border-b border-black/5 px-5 py-4">
                      <div className="text-sm font-semibold text-[var(--ink)]">Rework</div>
                    </div>
                    <div className="divide-y divide-black/5">
                      {!checkDetail.rework_tasks.length ? (
                        <div className="px-5 py-6 text-sm text-[var(--ink-muted)]">
                          Sin rework asociado.
                        </div>
                      ) : null}
                      {checkDetail.rework_tasks.map((rework) => {
                        const attempts = checkDetail.rework_attempts
                          .filter((attempt) => attempt.rework_task_id === rework.id)
                          .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''));
                        return (
                          <div key={rework.id} className="px-5 py-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">
                                    {reworkStatusLabel[rework.status]}
                                  </span>
                                  <span className="text-xs text-[var(--ink-muted)]">
                                    {formatDateTimeShort(rework.created_at)}
                                  </span>
                                  {rework.task_status ? (
                                    <span className="rounded-full border border-black/10 bg-white px-2 py-0.5 text-xs text-[var(--ink-muted)]">
                                      {taskStatusLabel[rework.task_status]}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-2 text-sm text-[var(--ink)]">{rework.description}</div>
                              </div>
                              <div className="text-xs text-[var(--ink-muted)]">#{rework.id}</div>
                            </div>

                            {attempts.length ? (
                              <div className="mt-4 space-y-2">
                                <div className="text-xs font-semibold text-[var(--ink)]">
                                  Intentos ({attempts.length})
                                </div>
                                {attempts.map((attempt) => (
                                  <div
                                    key={attempt.task_instance_id}
                                    className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="text-sm font-semibold text-[var(--ink)]">
                                        {attempt.station_name ?? 'Sin estacion'} · {taskStatusLabel[attempt.status]}
                                      </div>
                                      <div className="text-xs text-[var(--ink-muted)]">
                                        #{attempt.task_instance_id}
                                      </div>
                                    </div>
                                    <div className="mt-1 text-xs text-[var(--ink-muted)]">
                                      {attempt.started_at ? formatDateTimeShort(attempt.started_at) : '-'}
                                      {attempt.completed_at ? ` → ${formatDateTimeShort(attempt.completed_at)}` : ''}
                                    </div>
                                    <div className="mt-2 text-xs text-[var(--ink-muted)]">
                                      Workers:{' '}
                                      <span className="font-medium text-[var(--ink)]">
                                        {attempt.workers.length
                                          ? attempt.workers.map((w) => w.worker_name).join(', ')
                                          : '-'}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {mediaViewer ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="absolute inset-0" onClick={() => setMediaViewer(null)} />
          <div className="relative w-full max-w-5xl overflow-hidden rounded-3xl border border-black/10 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-black/5 bg-white/80 px-6 py-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[var(--ink)]">{mediaViewer.title}</div>
              </div>
              <button
                type="button"
                onClick={() => setMediaViewer(null)}
                className="rounded-full border border-black/10 p-2 text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="bg-black/5 p-4">
              {mediaViewer.mimeType?.startsWith('video/') ? (
                <video src={mediaViewer.uri} controls className="max-h-[75vh] w-full rounded-2xl bg-black" />
              ) : (
                <img src={mediaViewer.uri} alt={mediaViewer.title} className="max-h-[75vh] w-full object-contain" />
              )}
              <div className="mt-3 flex justify-end">
                <a
                  href={mediaViewer.uri}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-sm"
                >
                  <FileImage className="h-4 w-4" />
                  Abrir en nueva pestaña
                </a>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default QCLibrary;
