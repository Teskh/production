import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  AlertTriangle,
  BadgeCheck,
  BellRing,
  Download,
  Eye,
  CheckCircle2,
  ClipboardCheck,
  FileDiff,
  FileSignature,
  FileText,
  Filter,
  LogIn,
  LogOut,
  RefreshCcw,
  Search,
  Shield,
  ShieldAlert,
  Upload,
  UserRound,
  X,
  ChevronLeft,
  Plus,
  Pencil,
  Layers,
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type ProtocolSupervisor = {
  id: number;
  first_name: string;
  last_name: string;
  geovictoria_identifier: string | null;
};

type ProtocolSupervisorSession = {
  supervisor: ProtocolSupervisor;
  pending_protocol_count: number;
};

type AdminSession = {
  id: number;
  first_name: string;
  last_name: string;
  role: string;
  active: boolean;
};

type ProtocolVersionSummary = {
  id: number;
  version_number: number;
  change_summary: string | null;
  created_at: string;
  document_count: number;
};

type ProtocolSummary = {
  id: number;
  title: string;
  description: string | null;
  active: boolean;
  latest_version: ProtocolVersionSummary | null;
  applicable_supervisor_count: number;
  is_applicable_to_current_supervisor: boolean;
  has_signed_latest_version: boolean;
  requires_signature: boolean;
};

type ProtocolDocument = {
  id: number;
  original_filename: string;
  uri: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  preview_text: string | null;
};

type ProtocolSupervisorSignatureStatus = {
  supervisor: ProtocolSupervisor;
  signed: boolean;
  signed_name: string | null;
  signed_at: string | null;
};

type ProtocolDiffEntry = {
  kind: string;
  document_name: string;
  added_lines: number;
  removed_lines: number;
  diff_excerpt: string | null;
};

type ProtocolSignature = {
  id: number;
  protocol_version_id: number;
  supervisor_id: number;
  signed_name: string;
  signed_at: string;
};

type ProtocolDetail = ProtocolSummary & {
  applicable_supervisors: ProtocolSupervisor[];
  latest_signature_statuses: ProtocolSupervisorSignatureStatus[];
  latest_documents: ProtocolDocument[];
  previous_version_number: number | null;
  diff_entries: ProtocolDiffEntry[];
  current_supervisor_signature: ProtocolSignature | null;
  latest_signed_supervisor_count: number;
};

type SupervisorLoginDraft = {
  supervisor_id: string;
  pin: string;
};

type AdminLoginDraft = {
  first_name: string;
  last_name: string;
  pin: string;
};

type SignatureDraft = {
  signed_name: string;
  pin: string;
};

type CreateProtocolDraft = {
  title: string;
  description: string;
  change_summary: string;
  applicable_supervisor_ids: number[];
  files: File[];
};

type UpdateProtocolDraft = {
  title: string;
  description: string;
  applicable_supervisor_ids: number[];
};

type VersionDraft = {
  change_summary: string;
  files: File[];
};

type MergeSelectedFilesResult = {
  files: File[];
  message: string | null;
};

const emptyCreateDraft = (): CreateProtocolDraft => ({
  title: '',
  description: '',
  change_summary: '',
  applicable_supervisor_ids: [],
  files: [],
});

const emptyVersionDraft = (): VersionDraft => ({
  change_summary: '',
  files: [],
});

const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.pdf', '.docx']);

const buildHeaders = (options: RequestInit): Headers => {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
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
    throw new Error(await extractErrorMessage(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

const optionalSessionRequest = async <T,>(path: string): Promise<T | null> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  return (await response.json()) as T;
};

const extractErrorMessage = async (response: Response): Promise<string> => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === 'string' && payload.detail.trim()) {
        return payload.detail;
      }
    } catch {
      // Fall back to plain text below.
    }
  }
  const text = await response.text();
  return text || `Solicitud fallida (${response.status})`;
};

const normalizeSearchValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const toggleNumber = (items: number[], value: number): number[] =>
  items.includes(value) ? items.filter((item) => item !== value) : [...items, value];

const buildSupervisorName = (supervisor: ProtocolSupervisor): string =>
  `${supervisor.first_name} ${supervisor.last_name}`.trim();

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return 'Sin fecha';
  }
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

const formatFileSize = (value: number): string => {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} B`;
};

const isPdfDocument = (document: Pick<ProtocolDocument, 'mime_type' | 'original_filename'>): boolean =>
  document.mime_type === 'application/pdf' || document.original_filename.toLowerCase().endsWith('.pdf');

const isDocxDocument = (document: Pick<ProtocolDocument, 'mime_type' | 'original_filename'>): boolean =>
  document.mime_type ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
  document.original_filename.toLowerCase().endsWith('.docx');

const buildDocumentUrl = (uri: string): string => {
  if (/^https?:\/\//i.test(uri)) {
    return uri;
  }
  if (!API_BASE_URL) {
    return uri;
  }
  return `${API_BASE_URL.replace(/\/$/, '')}${uri}`;
};

const normalizeUploadFilename = (value: string): string =>
  value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .toLowerCase();

const mergeSelectedFiles = (
  existing: File[],
  nextFiles: FileList | null
): MergeSelectedFilesResult => {
  if (!nextFiles || nextFiles.length === 0) {
    return {
      files: existing,
      message: null,
    };
  }
  const merged = [...existing];
  const seen = new Set(
    existing.map((file) => `${file.name}::${file.size}::${file.lastModified}`)
  );
  const seenNormalizedNames = new Set(
    existing.map((file) => normalizeUploadFilename(file.name))
  );
  const invalidFiles: string[] = [];
  const duplicateNames: string[] = [];
  for (const file of Array.from(nextFiles)) {
    const extension = file.name.includes('.')
      ? `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
      : '';
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
      invalidFiles.push(file.name);
      continue;
    }
    const key = `${file.name}::${file.size}::${file.lastModified}`;
    if (seen.has(key)) {
      continue;
    }
    const normalizedName = normalizeUploadFilename(file.name);
    if (seenNormalizedNames.has(normalizedName)) {
      duplicateNames.push(file.name);
      continue;
    }
    merged.push(file);
    seen.add(key);
    seenNormalizedNames.add(normalizedName);
  }
  const messages: string[] = [];
  if (invalidFiles.length > 0) {
    messages.push(
      `Se ignoraron archivos no soportados: ${invalidFiles.join(', ')}. Solo se permiten PDF y DOCX.`
    );
  }
  if (duplicateNames.length > 0) {
    messages.push(
      `Se ignoraron archivos con nombre repetido dentro de la misma version: ${duplicateNames.join(', ')}.`
    );
  }
  return {
    files: merged,
    message: messages.length > 0 ? messages.join(' ') : null,
  };
};

type SelectedFilesListProps = {
  files: File[];
  tone: 'ink' | 'leaf';
  onRemove: (index: number) => void;
  onClear: () => void;
};

const SelectedFilesList: React.FC<SelectedFilesListProps> = ({
  files,
  tone,
  onRemove,
  onClear,
}) => {
  if (files.length === 0) {
    return null;
  }

  const actionClass =
    tone === 'leaf'
      ? 'border-[var(--leaf)]/20 bg-emerald-50 text-[var(--leaf)] hover:bg-emerald-100'
      : 'border-black/10 bg-slate-50 text-[var(--ink)] hover:bg-slate-100';

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {files.length} archivos seleccionados
        </div>
        <button
          type="button"
          onClick={onClear}
          className={clsx(
            'rounded-md border px-2.5 py-1 text-[11px] font-semibold transition',
            actionClass
          )}
        >
          Vaciar
        </button>
      </div>
      <div className="mt-2 space-y-1.5">
        {files.map((file, index) => (
          <div
            key={`${file.name}-${file.lastModified}-${index}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--ink)]">
                {file.name}
              </div>
              <div className="text-xs text-slate-500">{formatFileSize(file.size)}</div>
            </div>
            <button
              type="button"
              onClick={() => onRemove(index)}
              className={clsx(
                'rounded-md border px-2.5 py-1 text-[11px] font-semibold transition',
                actionClass
              )}
            >
              Quitar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const isProtocolManager = (admin: AdminSession | null): boolean => {
  if (!admin) {
    return false;
  }
  const normalized = admin.role.trim().toLowerCase();
  return normalized === 'prevencionista' || normalized === 'sysadmin';
};

type StatusPillProps = {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
};

const StatusPill: React.FC<StatusPillProps> = ({ children, tone = 'neutral' }) => {
  const className =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : tone === 'danger'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-slate-200 bg-white/80 text-slate-600';

  return (
    <span className={clsx('inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', className)}>
      {children}
    </span>
  );
};

type SupervisorChecklistProps = {
  supervisors: ProtocolSupervisor[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  disabled?: boolean;
};

const SupervisorChecklist: React.FC<SupervisorChecklistProps> = ({
  supervisors,
  selectedIds,
  onToggle,
  disabled = false,
}) => {
  if (supervisors.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">
        No hay supervisores disponibles.
      </div>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {supervisors.map((supervisor) => {
        const selected = selectedIds.includes(supervisor.id);
        return (
          <button
            key={supervisor.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(supervisor.id)}
            className={clsx(
              'rounded-lg border px-3 py-2.5 text-left transition',
              selected
                ? 'border-[var(--leaf)] bg-emerald-50 text-[var(--leaf)]'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
              disabled && 'cursor-not-allowed opacity-60'
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{buildSupervisorName(supervisor)}</div>
                <div className="text-xs text-slate-500">
                  {supervisor.geovictoria_identifier || 'Sin identificador'}
                </div>
              </div>
              <div
                className={clsx(
                  'flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold',
                  selected
                    ? 'border-[var(--leaf)] bg-[var(--leaf)] text-white'
                    : 'border-slate-300 bg-white text-slate-400'
                )}
              >
                {selected ? '✓' : ''}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};

/* ─── Modal shell ─── */
type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: React.ReactNode;
};

const Modal: React.FC<ModalProps> = ({ open, onClose, title, subtitle, wide, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-12" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx('relative w-full rounded-2xl border border-black/10 bg-white shadow-2xl', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-[var(--ink)]">{title}</h3>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
};

/* ─── Detail tab type ─── */
type DetailTab = 'docs' | 'signatures' | 'diff';

const Protocols: React.FC = () => {
  const [protocols, setProtocols] = useState<ProtocolSummary[]>([]);
  const [selectedProtocolId, setSelectedProtocolId] = useState<number | null>(null);
  const [selectedProtocol, setSelectedProtocol] = useState<ProtocolDetail | null>(null);
  const [supervisors, setSupervisors] = useState<ProtocolSupervisor[]>([]);
  const [supervisorSession, setSupervisorSession] = useState<ProtocolSupervisorSession | null>(null);
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [applicableOnly, setApplicableOnly] = useState(false);

  const [supervisorLogin, setSupervisorLogin] = useState<SupervisorLoginDraft>({
    supervisor_id: '',
    pin: '',
  });
  const [supervisorSubmitting, setSupervisorSubmitting] = useState(false);

  const [adminLogin, setAdminLogin] = useState<AdminLoginDraft>({
    first_name: '',
    last_name: '',
    pin: '',
  });
  const [adminSubmitting, setAdminSubmitting] = useState(false);

  const [signatureDraft, setSignatureDraft] = useState<SignatureDraft>({
    signed_name: '',
    pin: '',
  });
  const [signatureSubmitting, setSignatureSubmitting] = useState(false);

  const [createDraft, setCreateDraft] = useState<CreateProtocolDraft>(emptyCreateDraft);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  const [updateDraft, setUpdateDraft] = useState<UpdateProtocolDraft>({
    title: '',
    description: '',
    applicable_supervisor_ids: [],
  });
  const [updateSubmitting, setUpdateSubmitting] = useState(false);

  const [versionDraft, setVersionDraft] = useState<VersionDraft>(emptyVersionDraft);
  const [versionSubmitting, setVersionSubmitting] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<ProtocolDocument | null>(null);

  // UI state
  const [detailTab, setDetailTab] = useState<DetailTab>('docs');
  const [showSupervisorLogin, setShowSupervisorLogin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);

  const managerEnabled = isProtocolManager(adminSession);
  const latestSignatureStatuses = selectedProtocol?.latest_signature_statuses ?? [];
  const pendingSignatureStatuses = latestSignatureStatuses.filter((entry) => !entry.signed);
  const signedSignatureStatuses = latestSignatureStatuses.filter((entry) => entry.signed);

  const loadProtocols = async (preferredProtocolId?: number | null) => {
    setLoadingList(true);
    try {
      const data = await apiRequest<ProtocolSummary[]>('/api/protocols');
      setProtocols(data);
      const fallbackId = data[0]?.id ?? null;
      const nextId =
        preferredProtocolId != null && data.some((item) => item.id === preferredProtocolId)
          ? preferredProtocolId
          : selectedProtocolId != null && data.some((item) => item.id === selectedProtocolId)
          ? selectedProtocolId
          : fallbackId;
      setSelectedProtocolId(nextId);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'No se pudo cargar la lista.');
    } finally {
      setLoadingList(false);
    }
  };

  const loadSelectedProtocol = async (protocolId: number | null) => {
    if (!protocolId) {
      setSelectedProtocol(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const detail = await apiRequest<ProtocolDetail>(`/api/protocols/${protocolId}`);
      setSelectedProtocol(detail);
    } catch (error) {
      setSelectedProtocol(null);
      setPageError(error instanceof Error ? error.message : 'No se pudo cargar el protocolo.');
    } finally {
      setLoadingDetail(false);
    }
  };

  const loadSupervisorRoster = async () => {
    const data = await apiRequest<ProtocolSupervisor[]>('/api/protocols/supervisors');
    setSupervisors(data);
  };

  const refreshSupervisorSession = async () => {
    const data = await optionalSessionRequest<ProtocolSupervisorSession>('/api/protocols/supervisor/session');
    setSupervisorSession(data);
  };

  const refreshAdminSession = async () => {
    const data = await optionalSessionRequest<AdminSession>('/api/admin/session');
    setAdminSession(data);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setPageError(null);
      try {
        await Promise.all([
          loadProtocols(),
          loadSupervisorRoster(),
          refreshSupervisorSession(),
          refreshAdminSession(),
        ]);
      } catch (error) {
        if (active) {
          setPageError(error instanceof Error ? error.message : 'No se pudo inicializar la pagina.');
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void loadSelectedProtocol(selectedProtocolId);
  }, [selectedProtocolId]);

  useEffect(() => {
    if (!selectedProtocol) {
      setUpdateDraft({
        title: '',
        description: '',
        applicable_supervisor_ids: [],
      });
      return;
    }
    setUpdateDraft({
      title: selectedProtocol.title,
      description: selectedProtocol.description ?? '',
      applicable_supervisor_ids: selectedProtocol.applicable_supervisors.map((item) => item.id),
    });
  }, [selectedProtocol]);

  useEffect(() => {
    if (!supervisorSession) {
      setSignatureDraft((current) => ({
        signed_name: current.signed_name,
        pin: '',
      }));
      return;
    }
    setSignatureDraft({
      signed_name: buildSupervisorName(supervisorSession.supervisor),
      pin: '',
    });
  }, [supervisorSession]);

  const visibleProtocols = useMemo(() => {
    const needle = normalizeSearchValue(query.trim());
    return [...protocols]
      .filter((protocol) => {
        if (applicableOnly && supervisorSession && !protocol.is_applicable_to_current_supervisor) {
          return false;
        }
        if (!needle) {
          return true;
        }
        const haystack = normalizeSearchValue(
          `${protocol.title} ${protocol.description ?? ''}`.trim()
        );
        return haystack.includes(needle);
      })
      .sort((left, right) => {
        if (left.requires_signature !== right.requires_signature) {
          return left.requires_signature ? -1 : 1;
        }
        if (
          left.is_applicable_to_current_supervisor !== right.is_applicable_to_current_supervisor
        ) {
          return left.is_applicable_to_current_supervisor ? -1 : 1;
        }
        return left.title.localeCompare(right.title, 'es');
      });
  }, [applicableOnly, protocols, query, supervisorSession]);

  useEffect(() => {
    if (!visibleProtocols.length) {
      setSelectedProtocolId(null);
      return;
    }
    if (selectedProtocolId && visibleProtocols.some((item) => item.id === selectedProtocolId)) {
      return;
    }
    setSelectedProtocolId(visibleProtocols[0].id);
  }, [selectedProtocolId, visibleProtocols]);

  const handleSupervisorLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (supervisorSubmitting) {
      return;
    }
    const supervisorId = Number.parseInt(supervisorLogin.supervisor_id, 10);
    if (!supervisorId || !supervisorLogin.pin.trim()) {
      setActionMessage('Selecciona un supervisor e ingresa su PIN.');
      return;
    }
    setSupervisorSubmitting(true);
    setActionMessage(null);
    try {
      const data = await apiRequest<ProtocolSupervisorSession>('/api/protocols/supervisor/login', {
        method: 'POST',
        body: JSON.stringify({
          supervisor_id: supervisorId,
          pin: supervisorLogin.pin.trim(),
        }),
      });
      setSupervisorSession(data);
      setSupervisorLogin({ supervisor_id: String(supervisorId), pin: '' });
      setShowSupervisorLogin(false);
      await loadProtocols(selectedProtocolId);
      await loadSelectedProtocol(selectedProtocolId);
      setActionMessage('Sesion de supervisor iniciada.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesion.');
    } finally {
      setSupervisorSubmitting(false);
    }
  };

  const handleSupervisorLogout = async () => {
    try {
      await apiRequest<void>('/api/protocols/supervisor/logout', { method: 'POST' });
      setSupervisorSession(null);
      setApplicableOnly(false);
      await loadProtocols(selectedProtocolId);
      await loadSelectedProtocol(selectedProtocolId);
      setActionMessage('Sesion de supervisor cerrada.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'No se pudo cerrar sesion.');
    }
  };

  const handleAdminLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (adminSubmitting) {
      return;
    }
    const firstName = adminLogin.first_name.trim();
    const lastName = adminLogin.last_name.trim();
    const pin = adminLogin.pin.trim();
    if (!firstName || !lastName || !pin) {
      setActionMessage('Completa nombre, apellido y PIN del admin.');
      return;
    }
    setAdminSubmitting(true);
    setActionMessage(null);
    try {
      await apiRequest<AdminSession>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          pin,
        }),
      });
      setAdminLogin({ first_name: firstName, last_name: lastName, pin: '' });
      setShowAdminLogin(false);
      await Promise.all([refreshAdminSession(), loadSelectedProtocol(selectedProtocolId)]);
      setActionMessage('Sesion admin iniciada.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesion admin.');
    } finally {
      setAdminSubmitting(false);
    }
  };

  const handleAdminLogout = async () => {
    try {
      await apiRequest<void>('/api/admin/logout', { method: 'POST' });
      setAdminSession(null);
      await loadSelectedProtocol(selectedProtocolId);
      setActionMessage('Sesion admin cerrada.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'No se pudo cerrar la sesion admin.');
    }
  };

  const handleSignProtocol = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProtocol || !supervisorSession || signatureSubmitting) {
      return;
    }
    setSignatureSubmitting(true);
    setActionMessage(null);
    try {
      await apiRequest<ProtocolSignature>(`/api/protocols/${selectedProtocol.id}/sign`, {
        method: 'POST',
        body: JSON.stringify({
          signed_name: signatureDraft.signed_name.trim(),
          pin: signatureDraft.pin.trim(),
        }),
      });
      setSignatureDraft((current) => ({ ...current, pin: '' }));
      await Promise.all([
        refreshSupervisorSession(),
        loadProtocols(selectedProtocol.id),
        loadSelectedProtocol(selectedProtocol.id),
      ]);
      setActionMessage('Protocolo firmado correctamente.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'No se pudo firmar el protocolo.');
    } finally {
      setSignatureSubmitting(false);
    }
  };

  const handleCreateProtocol = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!managerEnabled || createSubmitting) {
      return;
    }
    if (!createDraft.title.trim() || createDraft.files.length === 0) {
      setActionMessage('Ingresa un titulo y adjunta al menos un documento.');
      return;
    }
    setCreateSubmitting(true);
    setActionMessage(null);
    try {
      const form = new FormData();
      form.set('title', createDraft.title.trim());
      form.set('description', createDraft.description.trim());
      form.set('change_summary', createDraft.change_summary.trim());
      form.set(
        'applicable_supervisor_ids',
        JSON.stringify(createDraft.applicable_supervisor_ids)
      );
      createDraft.files.forEach((file) => form.append('files', file));

      const created = await apiRequest<ProtocolDetail>('/api/protocols', {
        method: 'POST',
        body: form,
      });
      setCreateDraft(emptyCreateDraft());
      setShowCreateModal(false);
      await loadProtocols(created.id);
      await loadSelectedProtocol(created.id);
      setActionMessage('Protocolo creado.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'No se pudo crear el protocolo.');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleUpdateProtocol = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!managerEnabled || !selectedProtocol || updateSubmitting) {
      return;
    }
    setUpdateSubmitting(true);
    setActionMessage(null);
    try {
      await apiRequest<ProtocolDetail>(`/api/protocols/${selectedProtocol.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: updateDraft.title.trim(),
          description: updateDraft.description.trim() || null,
          applicable_supervisor_ids: updateDraft.applicable_supervisor_ids,
        }),
      });
      setShowEditModal(false);
      await loadProtocols(selectedProtocol.id);
      await loadSelectedProtocol(selectedProtocol.id);
      setActionMessage('Metadatos del protocolo actualizados.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'No se pudo actualizar el protocolo.');
    } finally {
      setUpdateSubmitting(false);
    }
  };

  const handleCreateVersion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!managerEnabled || !selectedProtocol || versionSubmitting) {
      return;
    }
    if (versionDraft.files.length === 0) {
      setActionMessage('Adjunta al menos un documento para crear una nueva version.');
      return;
    }
    setVersionSubmitting(true);
    setActionMessage(null);
    try {
      const form = new FormData();
      form.set('change_summary', versionDraft.change_summary.trim());
      versionDraft.files.forEach((file) => form.append('files', file));
      await apiRequest<ProtocolDetail>(`/api/protocols/${selectedProtocol.id}/versions`, {
        method: 'POST',
        body: form,
      });
      setVersionDraft(emptyVersionDraft());
      setShowVersionModal(false);
      await loadProtocols(selectedProtocol.id);
      await loadSelectedProtocol(selectedProtocol.id);
      if (supervisorSession) {
        await refreshSupervisorSession();
      }
      setActionMessage('Nueva version publicada.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'No se pudo publicar la nueva version.');
    } finally {
      setVersionSubmitting(false);
    }
  };

  // Auto-dismiss action messages after a few seconds
  useEffect(() => {
    if (!actionMessage) return;
    const timer = setTimeout(() => setActionMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */

  const detailTabs: { key: DetailTab; label: string; icon: React.ReactNode }[] = [
    { key: 'docs', label: 'Documentos', icon: <FileText className="h-4 w-4" /> },
    { key: 'signatures', label: 'Firmas', icon: <FileSignature className="h-4 w-4" /> },
    { key: 'diff', label: 'Cambios', icon: <FileDiff className="h-4 w-4" /> },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-[var(--canvas)]">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-30 border-b border-black/5 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-[var(--ink)]"
          >
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Link>

          <div className="mr-auto">
            <h1 className="text-base font-semibold text-[var(--ink)]">Protocolos de Seguridad</h1>
          </div>

          {/* Session indicators */}
          <div className="flex items-center gap-2">
            {supervisorSession ? (
              <div className="flex items-center gap-2">
                <div className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 sm:flex">
                  <UserRound className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-xs font-semibold text-emerald-700">
                    {buildSupervisorName(supervisorSession.supervisor)}
                  </span>
                  {supervisorSession.pending_protocol_count > 0 && (
                    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                      {supervisorSession.pending_protocol_count}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleSupervisorLogout}
                  className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  title="Cerrar sesion supervisor"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSupervisorLogin(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <UserRound className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Supervisor</span>
              </button>
            )}

            {adminSession ? (
              <div className="flex items-center gap-2">
                <div className="hidden items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 sm:flex">
                  <Shield className="h-3.5 w-3.5 text-slate-500" />
                  <span className="text-xs font-semibold text-slate-600">
                    {[adminSession.first_name, adminSession.last_name].filter(Boolean).join(' ')}
                  </span>
                  {managerEnabled && (
                    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                      P
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleAdminLogout}
                  className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  title="Cerrar sesion admin"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAdminLogin(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <Shield className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Admin</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setPageError(null);
                void Promise.all([
                  loadProtocols(selectedProtocolId),
                  loadSelectedProtocol(selectedProtocolId),
                  refreshSupervisorSession(),
                  refreshAdminSession(),
                ]);
              }}
              className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              title="Actualizar"
            >
              <RefreshCcw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Toast messages ── */}
      {(actionMessage || pageError) && (
        <div className="mx-auto w-full max-w-7xl px-4 pt-3 sm:px-6">
          {actionMessage && (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-[var(--ink-muted)] shadow-sm">
              <span>{actionMessage}</span>
              <button type="button" onClick={() => setActionMessage(null)} className="ml-3 text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {pageError && (
            <div className="mt-2 flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 shadow-sm">
              <span>{pageError}</span>
              <button type="button" onClick={() => setPageError(null)} className="ml-3 text-rose-400 hover:text-rose-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Pending signature banner ── */}
      {supervisorSession && supervisorSession.pending_protocol_count > 0 && (
        <div className="mx-auto w-full max-w-7xl px-4 pt-3 sm:px-6">
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            <BellRing className="h-4 w-4 flex-none" />
            <span>
              Tienes <strong>{supervisorSession.pending_protocol_count}</strong> protocolo(s) pendiente(s) de firma.
            </span>
          </div>
        </div>
      )}

      {/* ── Main layout ── */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-0 px-4 py-4 sm:px-6 lg:gap-6">
        {/* ── Sidebar: protocol list ── */}
        <aside className="hidden w-80 flex-none lg:block">
          <div className="sticky top-[61px] space-y-3">
            {/* Search */}
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar protocolo..."
                className="w-full rounded-lg border border-slate-200 bg-white px-9 py-2 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>

            {/* Filter toggle */}
            {supervisorSession && (
              <button
                type="button"
                onClick={() => setApplicableOnly((current) => !current)}
                className={clsx(
                  'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-semibold transition',
                  applicableOnly
                    ? 'border-[var(--leaf)] bg-emerald-50 text-[var(--leaf)]'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                )}
              >
                <span className="flex items-center gap-1.5">
                  <Filter className="h-3.5 w-3.5" />
                  Solo aplicables a mi
                </span>
                <span>{applicableOnly ? 'ON' : 'OFF'}</span>
              </button>
            )}

            {/* Manager: create button */}
            {managerEnabled && (
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-500 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Plus className="h-3.5 w-3.5" />
                Crear protocolo
              </button>
            )}

            {/* Protocol list */}
            <div className="max-h-[calc(100vh-200px)] space-y-1.5 overflow-y-auto pr-1">
              {loadingList && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                  Cargando...
                </div>
              )}
              {!loadingList && visibleProtocols.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                  Sin resultados.
                </div>
              )}
              {!loadingList &&
                visibleProtocols.map((protocol) => {
                  const selected = protocol.id === selectedProtocolId;
                  return (
                    <button
                      key={protocol.id}
                      type="button"
                      onClick={() => setSelectedProtocolId(protocol.id)}
                      className={clsx(
                        'w-full rounded-lg border px-3 py-3 text-left transition',
                        selected
                          ? 'border-[var(--ink)] bg-[var(--ink)] text-white shadow-md'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 text-sm font-semibold leading-snug">
                          {protocol.title}
                        </div>
                        {protocol.requires_signature ? (
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-300" />
                        ) : protocol.has_signed_latest_version ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-400" />
                        ) : (
                          <ClipboardCheck
                            className={clsx(
                              'mt-0.5 h-3.5 w-3.5 flex-none',
                              selected ? 'text-white/40' : 'text-slate-300'
                            )}
                          />
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {protocol.latest_version && (
                          <StatusPill tone={selected ? 'neutral' : protocol.requires_signature ? 'warning' : 'neutral'}>
                            V{protocol.latest_version.version_number}
                          </StatusPill>
                        )}
                        {protocol.requires_signature && (
                          <StatusPill tone="warning">Pendiente</StatusPill>
                        )}
                        {protocol.has_signed_latest_version && (
                          <StatusPill tone="success">Firmado</StatusPill>
                        )}
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        </aside>

        {/* ── Mobile protocol selector (shown on small screens) ── */}
        <div className="mb-4 w-full lg:hidden">
          <div className="flex gap-2">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar..."
                className="w-full rounded-lg border border-slate-200 bg-white px-9 py-2 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
            {supervisorSession && (
              <button
                type="button"
                onClick={() => setApplicableOnly((c) => !c)}
                className={clsx(
                  'rounded-lg border px-3 py-2 text-xs font-semibold transition',
                  applicableOnly ? 'border-[var(--leaf)] bg-emerald-50 text-[var(--leaf)]' : 'border-slate-200 bg-white text-slate-500'
                )}
              >
                <Filter className="h-4 w-4" />
              </button>
            )}
            {managerEnabled && (
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 transition hover:text-[var(--accent)]"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {loadingList && (
              <div className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
                Cargando...
              </div>
            )}
            {!loadingList &&
              visibleProtocols.map((protocol) => {
                const selected = protocol.id === selectedProtocolId;
                return (
                  <button
                    key={protocol.id}
                    type="button"
                    onClick={() => setSelectedProtocolId(protocol.id)}
                    className={clsx(
                      'flex-none whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                      selected
                        ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    )}
                  >
                    {protocol.title}
                    {protocol.requires_signature && ' *'}
                  </button>
                );
              })}
          </div>
        </div>

        {/* ── Detail panel ── */}
        <main className="min-w-0 flex-1">
          {selectedProtocol ? (
            <div className="rounded-xl border border-black/5 bg-white shadow-sm">
              {/* Detail header */}
              <div className="border-b border-slate-100 px-5 py-5 lg:px-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedProtocol.requires_signature ? (
                        <StatusPill tone="warning">Pendiente de firma</StatusPill>
                      ) : selectedProtocol.has_signed_latest_version ? (
                        <StatusPill tone="success">Firmado</StatusPill>
                      ) : (
                        <StatusPill>Publico</StatusPill>
                      )}
                      {selectedProtocol.latest_version && (
                        <StatusPill>V{selectedProtocol.latest_version.version_number}</StatusPill>
                      )}
                      <span className="text-xs text-slate-400">
                        {formatDateTime(selectedProtocol.latest_version?.created_at)}
                      </span>
                    </div>
                    <h2 className="mt-3 text-xl font-semibold text-[var(--ink)] lg:text-2xl">
                      {selectedProtocol.title}
                    </h2>
                    {selectedProtocol.description && (
                      <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-muted)]">
                        {selectedProtocol.description}
                      </p>
                    )}
                  </div>

                  {/* Quick stats */}
                  <div className="flex flex-none items-center gap-3 text-center">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-lg font-semibold text-[var(--ink)]">
                        {selectedProtocol.latest_signed_supervisor_count}
                        <span className="text-slate-400">/{selectedProtocol.applicable_supervisor_count}</span>
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Firmaron</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-lg font-semibold text-[var(--ink)]">
                        {selectedProtocol.latest_documents.length}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Docs</div>
                    </div>
                  </div>
                </div>

                {/* Manager actions row */}
                {managerEnabled && selectedProtocol && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setShowEditModal(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar metadatos
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowVersionModal(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--leaf)]/30 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-[var(--leaf)] transition hover:bg-emerald-100"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      Nueva version
                    </button>
                  </div>
                )}

                {/* Change summary */}
                {selectedProtocol.latest_version?.change_summary && (
                  <div className="mt-4 rounded-lg border border-[var(--accent-soft)] bg-[#fff3ee] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                      Resumen del cambio
                    </div>
                    <div className="mt-1 text-sm leading-relaxed text-[var(--ink)]">
                      {selectedProtocol.latest_version.change_summary}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Signature CTA ── */}
              {supervisorSession &&
                selectedProtocol.is_applicable_to_current_supervisor &&
                !selectedProtocol.has_signed_latest_version && (
                  <div className="border-b border-amber-100 bg-amber-50 px-5 py-4 lg:px-6">
                    <div className="flex items-start gap-3">
                      <FileSignature className="mt-0.5 h-5 w-5 flex-none text-amber-600" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-amber-900">
                          Firma pendiente para esta version
                        </div>
                        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={handleSignProtocol}>
                          <div className="flex-1">
                            <label className="block text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                              Nombre
                            </label>
                            <input
                              type="text"
                              autoComplete="name"
                              value={signatureDraft.signed_name}
                              onChange={(event) =>
                                setSignatureDraft((current) => ({
                                  ...current,
                                  signed_name: event.target.value,
                                }))
                              }
                              className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                              placeholder="Nombre completo"
                            />
                          </div>
                          <div className="w-36">
                            <label className="block text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                              PIN
                            </label>
                            <input
                              type="password"
                              autoComplete="current-password"
                              value={signatureDraft.pin}
                              onChange={(event) =>
                                setSignatureDraft((current) => ({
                                  ...current,
                                  pin: event.target.value,
                                }))
                              }
                              className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                              placeholder="PIN"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={signatureSubmitting}
                            className={clsx(
                              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition',
                              signatureSubmitting
                                ? 'cursor-not-allowed bg-slate-400'
                                : 'bg-amber-600 hover:bg-amber-700'
                            )}
                          >
                            <FileSignature className="h-4 w-4" />
                            {signatureSubmitting ? 'Firmando...' : 'Firmar'}
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                )}

              {/* ── Signed confirmation ── */}
              {selectedProtocol.current_supervisor_signature && (
                <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-3 lg:px-6">
                  <div className="flex items-center gap-2 text-sm text-emerald-800">
                    <BadgeCheck className="h-4 w-4 text-emerald-600" />
                    <span>
                      Firmada por <strong>{selectedProtocol.current_supervisor_signature.signed_name}</strong> el{' '}
                      {formatDateTime(selectedProtocol.current_supervisor_signature.signed_at)}
                    </span>
                  </div>
                </div>
              )}

              {/* ── Tabs ── */}
              <div className="border-b border-slate-100 px-5 lg:px-6">
                <div className="-mb-px flex gap-0">
                  {detailTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setDetailTab(tab.key)}
                      className={clsx(
                        'flex items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium transition',
                        detailTab === tab.key
                          ? 'border-[var(--ink)] text-[var(--ink)]'
                          : 'border-transparent text-slate-400 hover:text-slate-600'
                      )}
                    >
                      {tab.icon}
                      {tab.label}
                      {tab.key === 'signatures' && adminSession && pendingSignatureStatuses.length > 0 && (
                        <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                          {pendingSignatureStatuses.length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Tab content ── */}
              <div className="px-5 py-5 lg:px-6">
                {/* Documents tab */}
                {detailTab === 'docs' && (
                  <div className="space-y-3">
                    {selectedProtocol.latest_documents.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                        No hay documentos en esta version.
                      </div>
                    ) : (
                      selectedProtocol.latest_documents.map((document) => (
                        <div
                          key={document.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-[var(--ink)]">
                              {document.original_filename}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              {formatFileSize(document.size_bytes)} · {formatDateTime(document.uploaded_at)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setPreviewDocument(document)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Ver
                            </button>
                            <a
                              href={buildDocumentUrl(document.uri)}
                              download={document.original_filename}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Descargar
                            </a>
                          </div>
                        </div>
                      ))
                    )}

                    {/* Applicable supervisors summary */}
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Supervisores aplicables
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selectedProtocol.applicable_supervisors.length > 0 ? (
                          selectedProtocol.applicable_supervisors.map((supervisor) => (
                            <StatusPill key={supervisor.id}>
                              {buildSupervisorName(supervisor)}
                            </StatusPill>
                          ))
                        ) : (
                          <span className="text-sm text-slate-500">Sin supervisores asignados.</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Signatures tab */}
                {detailTab === 'signatures' && (
                  <div>
                    {!adminSession ? (
                      <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                        Inicia sesion como admin para ver el seguimiento detallado de firmas.
                      </div>
                    ) : selectedProtocol.applicable_supervisors.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                        No hay supervisores asignados a este protocolo.
                      </div>
                    ) : (
                      <div className="grid gap-4 lg:grid-cols-2">
                        {/* Pending */}
                        <div>
                          <div className="mb-3 flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-amber-900">Pendientes</h4>
                            <StatusPill tone="warning">{pendingSignatureStatuses.length}</StatusPill>
                          </div>
                          {pendingSignatureStatuses.length === 0 ? (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                              Todos firmaron esta version.
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {pendingSignatureStatuses.map((entry) => (
                                <div
                                  key={entry.supervisor.id}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
                                >
                                  <div>
                                    <div className="text-sm font-semibold text-[var(--ink)]">
                                      {buildSupervisorName(entry.supervisor)}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {entry.supervisor.geovictoria_identifier || 'Sin ID'}
                                    </div>
                                  </div>
                                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Signed */}
                        <div>
                          <div className="mb-3 flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-emerald-900">Firmados</h4>
                            <StatusPill tone="success">{signedSignatureStatuses.length}</StatusPill>
                          </div>
                          {signedSignatureStatuses.length === 0 ? (
                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                              Sin firmas aun.
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {signedSignatureStatuses.map((entry) => (
                                <div
                                  key={entry.supervisor.id}
                                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm font-semibold text-[var(--ink)]">
                                      {buildSupervisorName(entry.supervisor)}
                                    </div>
                                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                  </div>
                                  {entry.signed_at && (
                                    <div className="mt-1 text-xs text-slate-500">
                                      Firmado como {entry.signed_name} · {formatDateTime(entry.signed_at)}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Diff tab */}
                {detailTab === 'diff' && (
                  <div>
                    {selectedProtocol.previous_version_number == null ? (
                      <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                        Solo hay una version publicada — no hay diferencias disponibles.
                      </div>
                    ) : selectedProtocol.diff_entries.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                        No se detectaron diferencias con V{selectedProtocol.previous_version_number}.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="text-xs text-slate-500">
                          Comparando con V{selectedProtocol.previous_version_number}
                        </div>
                        {selectedProtocol.diff_entries.map((entry, index) => (
                          <div
                            key={`${entry.document_name}-${index}`}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-sm font-semibold text-[var(--ink)]">
                                  {entry.document_name}
                                </div>
                                <div className="mt-0.5 text-xs text-slate-500">
                                  {entry.kind === 'added'
                                    ? 'Documento agregado'
                                    : entry.kind === 'removed'
                                    ? 'Documento removido'
                                    : `+${entry.added_lines} / -${entry.removed_lines}`}
                                </div>
                              </div>
                              <StatusPill
                                tone={
                                  entry.kind === 'changed'
                                    ? 'warning'
                                    : entry.kind === 'added'
                                    ? 'success'
                                    : 'danger'
                                }
                              >
                                {entry.kind}
                              </StatusPill>
                            </div>
                            {entry.diff_excerpt && (
                              <pre className="mt-3 overflow-x-auto rounded-lg bg-[#101926] px-3 py-3 text-xs leading-5 text-slate-100">
                                {entry.diff_excerpt}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white text-sm text-slate-500">
              {loadingDetail || loadingList
                ? 'Cargando...'
                : 'Selecciona un protocolo para ver su detalle.'}
            </div>
          )}
        </main>
      </div>

      {/* ════════════════════════════════════════════════════════════
         MODALS
         ════════════════════════════════════════════════════════════ */}

      {/* ── Supervisor Login Modal ── */}
      <Modal open={showSupervisorLogin} onClose={() => setShowSupervisorLogin(false)} title="Ingresar como Supervisor" subtitle="Identifícate para ver protocolos aplicables y firmar.">
        <form className="space-y-4" onSubmit={handleSupervisorLogin}>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Supervisor
            </label>
            <select
              value={supervisorLogin.supervisor_id}
              onChange={(event) =>
                setSupervisorLogin((current) => ({
                  ...current,
                  supervisor_id: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
            >
              <option value="">Seleccionar supervisor</option>
              {supervisors.map((supervisor) => (
                <option key={supervisor.id} value={supervisor.id}>
                  {buildSupervisorName(supervisor)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              PIN
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={supervisorLogin.pin}
              onChange={(event) =>
                setSupervisorLogin((current) => ({ ...current, pin: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
              placeholder="Ingresar PIN"
            />
          </div>
          <button
            type="submit"
            disabled={supervisorSubmitting}
            className={clsx(
              'inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition',
              supervisorSubmitting
                ? 'cursor-not-allowed bg-slate-400'
                : 'bg-[var(--leaf)] hover:bg-[#24543d]'
            )}
          >
            <LogIn className="h-4 w-4" />
            {supervisorSubmitting ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </Modal>

      {/* ── Admin Login Modal ── */}
      <Modal open={showAdminLogin} onClose={() => setShowAdminLogin(false)} title="Ingresar como Admin" subtitle="Acceso para gestionar protocolos y ver firmas.">
        <form className="space-y-4" onSubmit={handleAdminLogin}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Nombre
              </label>
              <input
                type="text"
                value={adminLogin.first_name}
                onChange={(event) =>
                  setAdminLogin((current) => ({ ...current, first_name: event.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Apellido
              </label>
              <input
                type="text"
                value={adminLogin.last_name}
                onChange={(event) =>
                  setAdminLogin((current) => ({ ...current, last_name: event.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              PIN / Contrasena
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={adminLogin.pin}
              onChange={(event) =>
                setAdminLogin((current) => ({ ...current, pin: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={adminSubmitting}
            className={clsx(
              'inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition',
              adminSubmitting
                ? 'cursor-not-allowed bg-slate-400'
                : 'bg-[var(--ink)] hover:bg-black'
            )}
          >
            <Shield className="h-4 w-4" />
            {adminSubmitting ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </Modal>

      {/* ── Create Protocol Modal ── */}
      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Crear protocolo" subtitle="Publica un nuevo protocolo con sus documentos." wide>
        <form className="space-y-4" onSubmit={handleCreateProtocol}>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Titulo
            </label>
            <input
              type="text"
              value={createDraft.title}
              onChange={(event) =>
                setCreateDraft((current) => ({ ...current, title: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Descripcion
            </label>
            <textarea
              value={createDraft.description}
              onChange={(event) =>
                setCreateDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Resumen del cambio inicial
            </label>
            <textarea
              value={createDraft.change_summary}
              onChange={(event) =>
                setCreateDraft((current) => ({
                  ...current,
                  change_summary: event.target.value,
                }))
              }
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Supervisores aplicables
            </label>
            <div className="mt-2">
              <SupervisorChecklist
                supervisors={supervisors}
                selectedIds={createDraft.applicable_supervisor_ids}
                onToggle={(id) =>
                  setCreateDraft((current) => ({
                    ...current,
                    applicable_supervisor_ids: toggleNumber(
                      current.applicable_supervisor_ids,
                      id
                    ),
                  }))
                }
                disabled={createSubmitting}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Documentos
            </label>
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              multiple
              onChange={(event) => {
                const nextFiles = event.currentTarget.files;
                const result = mergeSelectedFiles(createDraft.files, nextFiles);
                setCreateDraft((current) => ({
                  ...current,
                  files: result.files,
                }));
                if (result.message) {
                  setActionMessage(result.message);
                }
                event.currentTarget.value = '';
              }}
              className="mt-1 block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-[var(--ink)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
            />
            <SelectedFilesList
              files={createDraft.files}
              tone="ink"
              onRemove={(index) =>
                setCreateDraft((current) => ({
                  ...current,
                  files: current.files.filter((_, currentIndex) => currentIndex !== index),
                }))
              }
              onClear={() =>
                setCreateDraft((current) => ({
                  ...current,
                  files: [],
                }))
              }
            />
          </div>
          <button
            type="submit"
            disabled={createSubmitting}
            className={clsx(
              'inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition',
              createSubmitting
                ? 'cursor-not-allowed bg-slate-400'
                : 'bg-[var(--accent)] hover:bg-[#df5535]'
            )}
          >
            <Upload className="h-4 w-4" />
            {createSubmitting ? 'Creando...' : 'Crear protocolo'}
          </button>
        </form>
      </Modal>

      {/* ── Edit Metadata Modal ── */}
      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title="Editar metadatos" subtitle={selectedProtocol?.title} wide>
        {selectedProtocol && (
          <form className="space-y-4" onSubmit={handleUpdateProtocol}>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Titulo
              </label>
              <input
                type="text"
                value={updateDraft.title}
                onChange={(event) =>
                  setUpdateDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Descripcion
              </label>
              <textarea
                value={updateDraft.description}
                onChange={(event) =>
                  setUpdateDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Supervisores aplicables
              </label>
              <div className="mt-2">
                <SupervisorChecklist
                  supervisors={supervisors}
                  selectedIds={updateDraft.applicable_supervisor_ids}
                  onToggle={(id) =>
                    setUpdateDraft((current) => ({
                      ...current,
                      applicable_supervisor_ids: toggleNumber(
                        current.applicable_supervisor_ids,
                        id
                      ),
                    }))
                  }
                  disabled={updateSubmitting}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={updateSubmitting}
              className={clsx(
                'inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition',
                updateSubmitting
                  ? 'cursor-not-allowed bg-slate-400'
                  : 'bg-[var(--ink)] hover:bg-black'
              )}
            >
              <ClipboardCheck className="h-4 w-4" />
              {updateSubmitting ? 'Guardando...' : 'Guardar metadatos'}
            </button>
          </form>
        )}
      </Modal>

      {/* ── New Version Modal ── */}
      <Modal open={showVersionModal} onClose={() => setShowVersionModal(false)} title="Publicar nueva version" subtitle={selectedProtocol?.title} wide>
        {selectedProtocol && (
          <form className="space-y-4" onSubmit={handleCreateVersion}>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
              Los documentos nuevos reemplazan otros con el mismo nombre y el resto se conserva.
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Resumen del cambio
              </label>
              <textarea
                value={versionDraft.change_summary}
                onChange={(event) =>
                  setVersionDraft((current) => ({
                    ...current,
                    change_summary: event.target.value,
                  }))
                }
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Documentos nuevos o actualizados
              </label>
              <input
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple
                onChange={(event) => {
                  const nextFiles = event.currentTarget.files;
                  const result = mergeSelectedFiles(versionDraft.files, nextFiles);
                  setVersionDraft((current) => ({
                    ...current,
                    files: result.files,
                  }));
                  if (result.message) {
                    setActionMessage(result.message);
                  }
                  event.currentTarget.value = '';
                }}
                className="mt-1 block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-[var(--leaf)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
              />
              <SelectedFilesList
                files={versionDraft.files}
                tone="leaf"
                onRemove={(index) =>
                  setVersionDraft((current) => ({
                    ...current,
                    files: current.files.filter((_, currentIndex) => currentIndex !== index),
                  }))
                }
                onClear={() =>
                  setVersionDraft((current) => ({
                    ...current,
                    files: [],
                  }))
                }
              />
            </div>
            <button
              type="submit"
              disabled={versionSubmitting}
              className={clsx(
                'inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition',
                versionSubmitting
                  ? 'cursor-not-allowed bg-slate-400'
                  : 'bg-[var(--leaf)] hover:bg-[#24543d]'
              )}
            >
              <FileSignature className="h-4 w-4" />
              {versionSubmitting ? 'Publicando...' : 'Publicar nueva version'}
            </button>
          </form>
        )}
      </Modal>

      {/* ── Document Preview Modal ── */}
      {previewDocument && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            onClick={() => setPreviewDocument(null)}
          />
          <div className="relative flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-[var(--ink)]">
                  {previewDocument.original_filename}
                </div>
                <div className="text-xs text-slate-500">
                  {previewDocument.mime_type} · {formatFileSize(previewDocument.size_bytes)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={buildDocumentUrl(previewDocument.uri)}
                  download={previewDocument.original_filename}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Descargar
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDocument(null)}
                  className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 bg-slate-100">
              {isPdfDocument(previewDocument) ? (
                <iframe
                  src={buildDocumentUrl(previewDocument.uri)}
                  title={previewDocument.original_filename}
                  className="h-full w-full border-0 bg-white"
                />
              ) : isDocxDocument(previewDocument) ? (
                <div className="h-full overflow-y-auto px-6 py-6">
                  <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white px-6 py-6 shadow-sm">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                      Vista previa DOCX
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      El formato original puede diferir.
                    </div>
                    <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[var(--ink)]">
                      {previewDocument.preview_text?.trim() ||
                        'No fue posible extraer una vista previa del contenido.'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-sm text-slate-500">
                  No hay vista previa integrada para este tipo de archivo.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Protocols;
