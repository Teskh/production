import React, { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import QCPhotoCaptureButton from '../../components/QCPhotoCaptureButton';
import { useOptionalQCSession } from '../../layouts/QCLayoutContext';
import { formatDateTimeShort } from '../../utils/timeUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const QC_ROLE_VALUES = new Set(['Calidad', 'QC']);

type QCSeverityLevel = 'baja' | 'media' | 'critica';
type QCComplaintStatus = 'Open' | 'ClosureProposed' | 'Closed';

type ProductionQueueItem = {
  id: number;
  project_name: string;
  house_identifier: string | null;
  module_number: number;
  house_type_name: string;
  status: string;
};

type PanelStatus = {
  panel_unit_id: number | null;
  panel_code: string | null;
  status: string;
};

type ProductionQueueModuleStatus = {
  panels: PanelStatus[];
};

type SupervisorSummary = {
  id: number;
  first_name: string;
  last_name: string;
};

type ComplaintMedia = {
  id: number;
  event_id: number | null;
  media_asset_id: number;
  role: string;
  uri: string;
  mime_type: string;
  created_at: string;
};

type ComplaintEvent = {
  id: number;
  complaint_id: number;
  actor_type: 'qc' | 'supervisor' | 'system';
  actor_user_id: number | null;
  actor_supervisor_id: number | null;
  actor_name: string | null;
  event_type:
    | 'created'
    | 'comment'
    | 'media_added'
    | 'closure_proposed'
    | 'closure_accepted'
    | 'closure_rejected';
  message: string | null;
  created_at: string;
  media: ComplaintMedia[];
};

type ComplaintSummary = {
  id: number;
  work_unit_id: number;
  panel_unit_id: number | null;
  station_id: number | null;
  station_name: string | null;
  title: string;
  description: string;
  severity_level: QCSeverityLevel;
  status: QCComplaintStatus;
  created_by_user_id: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  closure_proposed_at: string | null;
  closed_at: string | null;
  module_number: number;
  house_identifier: string | null;
  project_name: string;
  house_type_name: string;
  panel_code: string | null;
  supervisors: SupervisorSummary[];
  media_count: number;
  event_count: number;
  latest_event_at: string | null;
};

type ComplaintDetail = ComplaintSummary & {
  events: ComplaintEvent[];
};

const severityLabels: Record<QCSeverityLevel, string> = {
  baja: 'Baja',
  media: 'Media',
  critica: 'Critica',
};

const statusLabels: Record<QCComplaintStatus, string> = {
  Open: 'Abierta',
  ClosureProposed: 'Cierre propuesto',
  Closed: 'Cerrada',
};

const eventLabels: Record<ComplaintEvent['event_type'], string> = {
  created: 'Creo la observacion',
  comment: 'Comento',
  media_added: 'Agrego evidencia',
  closure_proposed: 'Propuso cierre',
  closure_accepted: 'Acepto cierre',
  closure_rejected: 'Rechazo cierre',
};

const apiRequest = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers:
      options?.body instanceof FormData
        ? options.headers
        : {
            'Content-Type': 'application/json',
            ...(options?.headers ?? {}),
          },
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

const fullName = (person: SupervisorSummary) => `${person.first_name} ${person.last_name}`;

const moduleLabel = (item: Pick<ComplaintSummary, 'house_identifier' | 'module_number' | 'project_name'>) =>
  `${item.project_name}${item.house_identifier ? ` / Casa ${item.house_identifier}` : ''} / Modulo ${item.module_number}`;

const fileKey = (file: File) => `${file.name}-${file.lastModified}-${file.size}`;

const formatStampDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
};

const formatStampTime = (date: Date) => {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const buildObservationWatermarkLines = (
  date: Date,
  context: {
    projectName?: string | null;
    houseIdentifier?: string | null;
    moduleNumber?: number | null;
    panelCode?: string | null;
    title?: string | null;
  }
) => {
  const parts: string[] = [];
  if (context.projectName) parts.push(context.projectName);
  if (context.houseIdentifier) parts.push(`Casa ${context.houseIdentifier}`);
  if (context.moduleNumber) parts.push(`Modulo ${context.moduleNumber}`);
  if (context.panelCode) parts.push(`Panel ${context.panelCode}`);
  const lines: string[] = [];
  if (parts.length) lines.push(parts.join(' · '));
  lines.push(context.title?.trim() || 'Observacion QC');
  lines.push(`${formatStampDate(date)} ${formatStampTime(date)}`);
  return lines.filter(Boolean);
};

const QCComplaints: React.FC = () => {
  const qcSession = useOptionalQCSession();
  const canManage = Boolean(qcSession?.role && QC_ROLE_VALUES.has(qcSession.role));

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ComplaintDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | QCComplaintStatus>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | QCSeverityLevel>('all');
  const [search, setSearch] = useState('');

  const [workUnits, setWorkUnits] = useState<ProductionQueueItem[]>([]);
  const [supervisors, setSupervisors] = useState<SupervisorSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [workUnitId, setWorkUnitId] = useState<number | null>(null);
  const [panelUnitId, setPanelUnitId] = useState<number | null>(null);
  const [panels, setPanels] = useState<PanelStatus[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<QCSeverityLevel>('media');
  const [selectedSupervisorIds, setSelectedSupervisorIds] = useState<Set<number>>(new Set());
  const [initialFiles, setInitialFiles] = useState<File[]>([]);

  const [commentText, setCommentText] = useState('');
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadComplaints = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (severityFilter !== 'all') params.set('severity_level', severityFilter);
      const data = await apiRequest<ComplaintSummary[]>(
        `/api/qc/complaints${params.toString() ? `?${params.toString()}` : ''}`
      );
      setComplaints(data);
      setErrorMessage(null);
      if (!selectedId && data.length) {
        setSelectedId(data[0].id);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudieron cargar observaciones.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const loadBaseData = async () => {
      try {
        const [queue, supervisorData] = await Promise.all([
          apiRequest<ProductionQueueItem[]>('/api/production-queue?include_completed=false'),
          apiRequest<SupervisorSummary[]>('/api/workers/supervisors'),
        ]);
        if (!active) return;
        setWorkUnits(queue);
        setSupervisors(supervisorData);
      } catch (error) {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : 'No se pudieron cargar datos base.');
        }
      }
    };
    void loadBaseData();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void loadComplaints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, severityFilter]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    const loadDetail = async () => {
      setDetailLoading(true);
      try {
        const data = await apiRequest<ComplaintDetail>(`/api/qc/complaints/${selectedId}`);
        if (active) {
          setDetail(data);
        }
      } catch (error) {
        if (active) {
          setActionError(error instanceof Error ? error.message : 'No se pudo cargar el detalle.');
        }
      } finally {
        if (active) {
          setDetailLoading(false);
        }
      }
    };
    void loadDetail();
    return () => {
      active = false;
    };
  }, [selectedId]);

  const selectedWorkUnit = workUnits.find((item) => item.id === workUnitId) ?? null;
  const selectedWorkUnitRequiresPanel =
    selectedWorkUnit?.status === 'Panels' || selectedWorkUnit?.status === 'Magazine';

  useEffect(() => {
    if (!workUnitId || !selectedWorkUnitRequiresPanel) {
      setPanels([]);
      setPanelUnitId(null);
      return;
    }
    let active = true;
    const loadPanels = async () => {
      setPanelsLoading(true);
      try {
        const status = await apiRequest<ProductionQueueModuleStatus>(
          `/api/production-queue/items/${workUnitId}/status`
        );
        if (active) {
          setPanels(status.panels.filter((panel) => panel.panel_unit_id !== null));
        }
      } catch {
        if (active) setPanels([]);
      } finally {
        if (active) setPanelsLoading(false);
      }
    };
    void loadPanels();
    return () => {
      active = false;
    };
  }, [workUnitId, selectedWorkUnitRequiresPanel]);

  const filteredComplaints = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return complaints;
    return complaints.filter((item) => {
      const haystack = [
        item.title,
        item.description,
        item.project_name,
        item.house_identifier,
        item.house_type_name,
        item.panel_code,
        ...item.supervisors.map(fullName),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [complaints, search]);

  const uploadFiles = async (complaintId: number, eventId: number, files: File[]) => {
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      await apiRequest<ComplaintMedia>(
        `/api/qc/complaints/${complaintId}/events/${eventId}/media`,
        {
          method: 'POST',
          body: formData,
        }
      );
    }
  };

  const resetCreateForm = () => {
    setWorkUnitId(null);
    setPanelUnitId(null);
    setPanels([]);
    setTitle('');
    setDescription('');
    setSeverity('media');
    setSelectedSupervisorIds(new Set());
    setInitialFiles([]);
    setCreateError(null);
  };

  const handleCreate = async () => {
    if (!workUnitId) {
      setCreateError('Seleccione un modulo.');
      return;
    }
    if (!title.trim() || !description.trim()) {
      setCreateError('Titulo y descripcion son obligatorios.');
      return;
    }
    if (!selectedSupervisorIds.size) {
      setCreateError('Seleccione al menos un supervisor.');
      return;
    }
    if (selectedWorkUnitRequiresPanel && !panelUnitId) {
      setCreateError('Seleccione un panel para modulos en Paneles o Magazine.');
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const created = await apiRequest<ComplaintDetail>('/api/qc/complaints', {
        method: 'POST',
        body: JSON.stringify({
          work_unit_id: workUnitId,
          panel_unit_id: selectedWorkUnitRequiresPanel ? panelUnitId : null,
          station_id: null,
          title: title.trim(),
          description: description.trim(),
          severity_level: severity,
          supervisor_ids: Array.from(selectedSupervisorIds),
        }),
      });
      const initialEvent = created.events.find((event) => event.event_type === 'created');
      if (initialEvent && initialFiles.length) {
        await uploadFiles(created.id, initialEvent.id, initialFiles);
      }
      setCreateOpen(false);
      resetCreateForm();
      setSelectedId(created.id);
      await loadComplaints();
      setDetail(await apiRequest<ComplaintDetail>(`/api/qc/complaints/${created.id}`));
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'No se pudo crear la observacion.');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleComment = async () => {
    if (!detail) return;
    if (!commentText.trim() && !commentFiles.length) {
      setActionError('Escriba un comentario o adjunte evidencia.');
      return;
    }
    setCommentSubmitting(true);
    setActionError(null);
    try {
      const event = await apiRequest<ComplaintEvent>(`/api/qc/complaints/${detail.id}/events`, {
        method: 'POST',
        body: JSON.stringify({ message: commentText.trim() || 'Evidencia adjunta' }),
      });
      if (commentFiles.length) {
        await uploadFiles(detail.id, event.id, commentFiles);
      }
      setCommentText('');
      setCommentFiles([]);
      setDetail(await apiRequest<ComplaintDetail>(`/api/qc/complaints/${detail.id}`));
      await loadComplaints();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo enviar el comentario.');
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!detail || !window.confirm('Cancelar y eliminar esta observacion con sus comentarios y fotos?')) {
      return;
    }
    setActionError(null);
    try {
      await apiRequest<void>(`/api/qc/complaints/${detail.id}`, { method: 'DELETE' });
      setDetail(null);
      setSelectedId(null);
      await loadComplaints();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo cancelar la observacion.');
    }
  };

  const reviewClosure = async (action: 'accept-closure' | 'reject-closure') => {
    if (!detail) return;
    const message =
      action === 'accept-closure'
        ? window.prompt('Comentario opcional para aceptar el cierre') ?? ''
        : window.prompt('Motivo para rechazar el cierre') ?? '';
    if (action === 'reject-closure' && !message.trim()) {
      setActionError('Indique un motivo para rechazar el cierre.');
      return;
    }
    try {
      const updated = await apiRequest<ComplaintDetail>(`/api/qc/complaints/${detail.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      setDetail(updated);
      await loadComplaints();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo revisar el cierre.');
    }
  };

  if (!canManage) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Inicia sesion como Calidad para gestionar observaciones.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--ink-muted)]">Observaciones QC</p>
          <h2 className="font-display text-2xl text-[var(--ink)]">Seguimiento con supervisores</h2>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Nueva observacion
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-lg border border-black/10 bg-white/85 shadow-sm">
          <div className="border-b border-black/10 p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por modulo, supervisor o texto"
                className="w-full rounded-lg border border-black/10 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
              >
                <option value="all">Todos los estados</option>
                <option value="Open">Abiertas</option>
                <option value="ClosureProposed">Cierre propuesto</option>
                <option value="Closed">Cerradas</option>
              </select>
              <select
                value={severityFilter}
                onChange={(event) => setSeverityFilter(event.target.value as typeof severityFilter)}
                className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
              >
                <option value="all">Toda severidad</option>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="critica">Critica</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 p-5 text-sm text-[var(--ink-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando observaciones...
            </div>
          ) : errorMessage ? (
            <div className="p-4 text-sm text-red-700">{errorMessage}</div>
          ) : (
            <div className="max-h-[72vh] overflow-y-auto">
              {filteredComplaints.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={clsx(
                    'block w-full border-b border-black/5 p-4 text-left transition hover:bg-slate-50',
                    selectedId === item.id && 'bg-[var(--accent)]/10'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--ink)]">{item.title}</div>
                      <div className="mt-1 truncate text-xs text-[var(--ink-muted)]">{moduleLabel(item)}</div>
                    </div>
                    <span
                      className={clsx(
                        'shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold',
                        item.severity_level === 'critica'
                          ? 'bg-red-100 text-red-700'
                          : item.severity_level === 'media'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-700'
                      )}
                    >
                      {severityLabels[item.severity_level]}
                    </span>
                  </div>
                  <div className="mt-2 line-clamp-2 text-xs text-[var(--ink-muted)]">{item.description}</div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ink-muted)]">
                    <span>{statusLabels[item.status]}</span>
                    <span>{item.event_count} mensajes</span>
                    <span>{item.media_count} archivos</span>
                  </div>
                </button>
              ))}
              {!filteredComplaints.length && (
                <div className="p-5 text-sm text-[var(--ink-muted)]">Sin observaciones para estos filtros.</div>
              )}
            </div>
          )}
        </section>

        <section className="min-h-[72vh] overflow-hidden rounded-lg border border-black/10 bg-white/85 shadow-sm">
          {!detail ? (
            <div className="flex h-full min-h-[420px] items-center justify-center p-8 text-sm text-[var(--ink-muted)]">
              Selecciona una observacion para ver la conversacion.
            </div>
          ) : (
            <div className="flex h-full min-h-[72vh] flex-col">
              <div className="border-b border-black/10 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-xl text-[var(--ink)]">{detail.title}</h3>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        {statusLabels[detail.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">{moduleLabel(detail)}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
                      {detail.panel_code && <span>Panel {detail.panel_code}</span>}
                      {detail.station_name && <span>{detail.station_name}</span>}
                      {detail.supervisors.map((supervisor) => (
                        <span key={supervisor.id} className="rounded-full bg-white px-2 py-1 ring-1 ring-black/10">
                          {fullName(supervisor)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {detail.status !== 'Closed' && (
                      <button
                        type="button"
                        onClick={() => void handleCancel()}
                        className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-200"
                      >
                        <Trash2 className="h-4 w-4" />
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {detailLoading ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[var(--ink-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando detalle...
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-5">
                  {actionError && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {actionError}
                    </div>
                  )}
                  <div className="space-y-4">
                    {detail.events.map((event) => {
                      const fromQc = event.actor_type === 'qc';
                      const isStatusEvent =
                        event.event_type === 'closure_accepted' ||
                        event.event_type === 'closure_rejected';
                      const isPendingClosureProposal =
                        event.event_type === 'closure_proposed' &&
                        detail.status === 'ClosureProposed';
                      return (
                        <div
                          key={event.id}
                          className={clsx('flex', fromQc ? 'justify-end' : 'justify-start')}
                        >
                          <div className={clsx('flex max-w-[78%] flex-col', fromQc ? 'items-end' : 'items-start')}>
                          <div
                            className={clsx(
                              isStatusEvent
                                ? 'max-w-[90%] rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-900'
                                : 'max-w-[78%] rounded-lg px-4 py-3 text-sm shadow-sm',
                              !isStatusEvent && fromQc
                                ? 'bg-[var(--ink)] text-white'
                                : !isStatusEvent
                                ? 'bg-slate-100 text-[var(--ink)]'
                                : ''
                            )}
                          >
                            <div
                              className={clsx(
                                'mb-1 text-[11px]',
                                isStatusEvent
                                  ? 'font-semibold uppercase tracking-wide text-amber-700'
                                  : fromQc
                                  ? 'text-white/70'
                                  : 'text-[var(--ink-muted)]'
                              )}
                            >
                              {event.actor_name ?? (fromQc ? 'Calidad' : 'Supervisor')} · {eventLabels[event.event_type]} ·{' '}
                              {formatDateTimeShort(event.created_at)}
                            </div>
                            {event.message && <div className="whitespace-pre-wrap">{event.message}</div>}
                              {event.media.length > 0 && (
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                {event.media.map((media) => (
                                  <a
                                    key={media.id}
                                    href={`${API_BASE_URL}${media.uri}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block overflow-hidden rounded-md bg-black/10"
                                  >
                                    {media.mime_type.startsWith('image/') ? (
                                      <img
                                        src={`${API_BASE_URL}${media.uri}`}
                                        alt=""
                                        className="h-28 w-full object-cover"
                                      />
                                    ) : (
                                      <video src={`${API_BASE_URL}${media.uri}`} className="h-28 w-full object-cover" />
                                    )}
                                  </a>
                                ))}
                              </div>
                              )}
                            </div>
                            {isPendingClosureProposal ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void reviewClosure('accept-closure')}
                                  className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                  Aceptar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void reviewClosure('reject-closure')}
                                  className="inline-flex items-center gap-2 rounded-full bg-amber-600 px-3 py-2 text-xs font-semibold text-white"
                                >
                                  <AlertTriangle className="h-4 w-4" />
                                  Rechazar
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {detail.status !== 'Closed' && (
                <div className="border-t border-black/10 p-4">
                  <textarea
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    rows={3}
                    placeholder="Escribir comentario para supervisores"
                    className="w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  />
                  {commentFiles.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {commentFiles.map((file) => (
                        <span key={fileKey(file)} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs">
                          {file.name}
                          <button
                            type="button"
                            onClick={() => setCommentFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)))}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <QCPhotoCaptureButton
                      fileNamePrefix={`qc-observacion-${detail.id}`}
                      buttonLabel="Tomar foto"
                      watermarkLines={(date) =>
                        buildObservationWatermarkLines(date, {
                          projectName: detail.project_name,
                          houseIdentifier: detail.house_identifier,
                          moduleNumber: detail.module_number,
                          panelCode: detail.panel_code,
                          title: detail.title,
                        })
                      }
                      onCapture={(file) => setCommentFiles((current) => [...current, file])}
                    />
                    <button
                      type="button"
                      onClick={() => void handleComment()}
                      disabled={commentSubmitting}
                      className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {commentSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Enviar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[var(--ink-muted)]">Nueva observacion</p>
                <h3 className="font-display text-xl text-[var(--ink)]">Crear conversacion con supervisores</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false);
                  resetCreateForm();
                }}
                className="rounded-full p-2 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              {createError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{createError}</div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block font-semibold text-[var(--ink)]">Modulo</span>
                  <select
                    value={workUnitId ?? ''}
                    onChange={(event) => setWorkUnitId(event.target.value ? Number(event.target.value) : null)}
                    className="w-full rounded-lg border border-black/10 bg-white px-3 py-2"
                  >
                    <option value="">Seleccionar modulo</option>
                    {workUnits.map((item) => (
                      <option key={item.id} value={item.id}>
                        {`${item.project_name}${item.house_identifier ? ` / ${item.house_identifier}` : ''} / Mod ${item.module_number}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-semibold text-[var(--ink)]">Severidad</span>
                  <select
                    value={severity}
                    onChange={(event) => setSeverity(event.target.value as QCSeverityLevel)}
                    className="w-full rounded-lg border border-black/10 bg-white px-3 py-2"
                  >
                    <option value="baja">Baja</option>
                    <option value="media">Media</option>
                    <option value="critica">Critica</option>
                  </select>
                </label>
                {selectedWorkUnitRequiresPanel ? (
                  <label className="text-sm md:col-span-2">
                    <span className="mb-1 block font-semibold text-[var(--ink)]">Panel</span>
                    <select
                      value={panelUnitId ?? ''}
                      disabled={!selectedWorkUnit || panelsLoading}
                      onChange={(event) =>
                        setPanelUnitId(event.target.value ? Number(event.target.value) : null)
                      }
                      className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 disabled:bg-slate-50"
                    >
                      <option value="">
                        {panelsLoading ? 'Cargando paneles...' : 'Seleccione panel'}
                      </option>
                      {panels.map((panel) => (
                        <option key={panel.panel_unit_id ?? panel.panel_code} value={panel.panel_unit_id ?? ''}>
                          {panel.panel_code ?? `Panel ${panel.panel_unit_id}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <label className="block text-sm">
                <span className="mb-1 block font-semibold text-[var(--ink)]">Titulo</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full rounded-lg border border-black/10 bg-white px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-semibold text-[var(--ink)]">Descripcion</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2"
                />
              </label>

              <div>
                <div className="mb-2 text-sm font-semibold text-[var(--ink)]">Supervisores</div>
                <div className="grid max-h-44 gap-2 overflow-y-auto rounded-lg border border-black/10 p-2 sm:grid-cols-2">
                  {supervisors.map((supervisor) => {
                    const checked = selectedSupervisorIds.has(supervisor.id);
                    return (
                      <label key={supervisor.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setSelectedSupervisorIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(supervisor.id);
                              else next.delete(supervisor.id);
                              return next;
                            });
                          }}
                        />
                        {fullName(supervisor)}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <QCPhotoCaptureButton
                  fileNamePrefix={`qc-observacion-${workUnitId ?? 'modulo'}`}
                  buttonLabel="Tomar foto"
                  watermarkLines={(date) =>
                    buildObservationWatermarkLines(date, {
                      projectName: selectedWorkUnit?.project_name,
                      houseIdentifier: selectedWorkUnit?.house_identifier,
                      moduleNumber: selectedWorkUnit?.module_number,
                      panelCode:
                        panels.find((panel) => panel.panel_unit_id === panelUnitId)?.panel_code ??
                        null,
                      title,
                    })
                  }
                  onCapture={(file) => setInitialFiles((current) => [...current, file])}
                />
                {initialFiles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {initialFiles.map((file) => (
                      <span key={fileKey(file)} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs">
                        {file.name}
                        <button
                          type="button"
                          onClick={() => setInitialFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)))}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-black/10 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false);
                  resetCreateForm();
                }}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] ring-1 ring-black/10"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={createSubmitting}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {createSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                Crear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QCComplaints;
