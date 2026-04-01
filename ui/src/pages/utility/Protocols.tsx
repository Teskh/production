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
    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          {files.length} archivos seleccionados
        </div>
        <button
          type="button"
          onClick={onClear}
          className={clsx(
            'rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition',
            actionClass
          )}
        >
          Vaciar
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {files.map((file, index) => (
          <div
            key={`${file.name}-${file.lastModified}-${index}`}
            className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[var(--ink)]">
                {file.name}
              </div>
              <div className="mt-1 text-xs text-slate-500">{formatFileSize(file.size)}</div>
            </div>
            <button
              type="button"
              onClick={() => onRemove(index)}
              className={clsx(
                'rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition',
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
    <span className={clsx('rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]', className)}>
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
      <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">
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
              'rounded-2xl border px-3 py-3 text-left transition',
              selected
                ? 'border-[var(--leaf)] bg-emerald-50 text-[var(--leaf)]'
                : 'border-slate-200 bg-white/80 text-slate-700 hover:border-slate-300',
              disabled && 'cursor-not-allowed opacity-60'
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{buildSupervisorName(supervisor)}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {supervisor.geovictoria_identifier || 'Sin identificador'}
                </div>
              </div>
              <div
                className={clsx(
                  'mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold',
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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(242,98,65,0.18),_transparent_28%),linear-gradient(180deg,_#faf5ed_0%,_#f3ecdf_52%,_#ece5d7_100%)]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="overflow-hidden rounded-[2rem] border border-black/5 bg-white/80 shadow-[0_20px_80px_rgba(15,27,45,0.08)] backdrop-blur">
          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-slate-50"
                >
                  Volver al login
                </Link>
                <Link
                  to="/utility/floor-status"
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-black"
                >
                  Estado de planta
                </Link>
              </div>
              <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--leaf)]">
                Seguridad y cumplimiento
              </p>
              <h1 className="mt-3 max-w-3xl font-display text-4xl text-[var(--ink)] sm:text-5xl">
                Protocolos de seguridad con versionado y firma interna.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--ink-muted)] sm:text-base">
                Cualquier persona puede revisar los protocolos vigentes. Los supervisores pueden
                identificarse para ver sus protocolos aplicables y firmar la version activa con su
                nombre y PIN.
              </p>
            </div>

            <div className="rounded-[1.75rem] border border-black/5 bg-[linear-gradient(160deg,_rgba(15,27,45,0.95),_rgba(23,42,62,0.92))] p-6 text-white shadow-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-white/55">Vigencia</p>
                  <h2 className="mt-2 text-2xl font-semibold">
                    {protocols.length} protocolos activos
                  </h2>
                </div>
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
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/90 transition hover:bg-white/10"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Actualizar
                </button>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.25em] text-white/45">
                    Firmas pendientes
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div className="text-3xl font-semibold">
                      {supervisorSession?.pending_protocol_count ?? 0}
                    </div>
                    <BellRing className="h-5 w-5 text-[var(--accent-soft)]" />
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.25em] text-white/45">
                    Acceso manager
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-base font-semibold">
                      {managerEnabled ? 'Prevencionista activo' : 'Solo lectura'}
                    </div>
                    {managerEnabled ? (
                      <Shield className="h-5 w-5 text-emerald-300" />
                    ) : (
                      <ShieldAlert className="h-5 w-5 text-amber-300" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {supervisorSession && supervisorSession.pending_protocol_count > 0 && (
          <div className="mt-6 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 shadow-sm">
            <div className="flex items-start gap-3">
              <BellRing className="mt-0.5 h-5 w-5 flex-none" />
              <div>
                <div className="font-semibold">Tienes protocolos pendientes de firma.</div>
                <div className="mt-1 text-amber-700">
                  Esta alerta seguira visible mientras la version vigente de alguno de tus
                  protocolos aplicables siga sin firmarse.
                </div>
              </div>
            </div>
          </div>
        )}

        {(actionMessage || pageError) && (
          <div className="mt-6 space-y-3">
            {actionMessage && (
              <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm text-[var(--ink-muted)] shadow-sm">
                {actionMessage}
              </div>
            )}
            {pageError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
                {pageError}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <section className="rounded-[1.75rem] border border-black/5 bg-white/80 p-5 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                    Supervisor
                  </div>
                  <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">
                    {supervisorSession ? 'Sesion activa' : 'Ingresar para firmar'}
                  </h2>
                </div>
                <UserRound className="h-5 w-5 text-[var(--ink-muted)]" />
              </div>

              {supervisorSession ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                    <div className="text-sm font-semibold text-emerald-800">
                      {buildSupervisorName(supervisorSession.supervisor)}
                    </div>
                    <div className="mt-1 text-xs text-emerald-700">
                      {supervisorSession.supervisor.geovictoria_identifier || 'Sin identificador'}
                    </div>
                    <div className="mt-3">
                      <StatusPill tone={supervisorSession.pending_protocol_count > 0 ? 'warning' : 'success'}>
                        {supervisorSession.pending_protocol_count > 0
                          ? `${supervisorSession.pending_protocol_count} pendientes`
                          : 'Sin pendientes'}
                      </StatusPill>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleSupervisorLogout}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-slate-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Cerrar sesion supervisor
                  </button>
                </div>
              ) : (
                <form className="mt-4 space-y-3" onSubmit={handleSupervisorLogin}>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
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
                    <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      PIN
                    </label>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={supervisorLogin.pin}
                      onChange={(event) =>
                        setSupervisorLogin((current) => ({ ...current, pin: event.target.value }))
                      }
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
                      placeholder="Ingresar PIN"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={supervisorSubmitting}
                    className={clsx(
                      'inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white transition',
                      supervisorSubmitting
                        ? 'cursor-not-allowed bg-slate-400'
                        : 'bg-[var(--leaf)] hover:bg-[#24543d]'
                    )}
                  >
                    <LogIn className="h-4 w-4" />
                    {supervisorSubmitting ? 'Ingresando...' : 'Ingresar como supervisor'}
                  </button>
                </form>
              )}
            </section>

            <section className="rounded-[1.75rem] border border-black/5 bg-white/80 p-5 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                    Prevencionista
                  </div>
                  <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">
                    {adminSession ? 'Sesion admin activa' : 'Gestion de protocolos'}
                  </h2>
                </div>
                <Shield className="h-5 w-5 text-[var(--ink-muted)]" />
              </div>

              {adminSession ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-black/5 bg-slate-50 px-4 py-4">
                    <div className="text-sm font-semibold text-[var(--ink)]">
                      {[adminSession.first_name, adminSession.last_name].filter(Boolean).join(' ')}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ink-muted)]">
                      Rol: {adminSession.role}
                    </div>
                    <div className="mt-3">
                      <StatusPill tone={managerEnabled ? 'success' : 'warning'}>
                        {managerEnabled ? 'Permisos de gestion' : 'Sin permisos de gestion'}
                      </StatusPill>
                    </div>
                  </div>
                  {!managerEnabled && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      Esta sesion admin puede navegar, pero solo un rol `Prevencionista` o
                      `SysAdmin` puede crear y versionar protocolos.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleAdminLogout}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-slate-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Cerrar sesion admin
                  </button>
                </div>
              ) : (
                <form className="mt-4 space-y-3" onSubmit={handleAdminLogin}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Nombre
                      </label>
                      <input
                        type="text"
                        value={adminLogin.first_name}
                        onChange={(event) =>
                          setAdminLogin((current) => ({ ...current, first_name: event.target.value }))
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Apellido
                      </label>
                      <input
                        type="text"
                        value={adminLogin.last_name}
                        onChange={(event) =>
                          setAdminLogin((current) => ({ ...current, last_name: event.target.value }))
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      PIN / contraseña
                    </label>
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={adminLogin.pin}
                        onChange={(event) =>
                          setAdminLogin((current) => ({ ...current, pin: event.target.value }))
                      }
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={adminSubmitting}
                    className={clsx(
                      'inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white transition',
                      adminSubmitting
                        ? 'cursor-not-allowed bg-slate-400'
                        : 'bg-[var(--ink)] hover:bg-black'
                    )}
                  >
                    <Shield className="h-4 w-4" />
                    {adminSubmitting ? 'Ingresando...' : 'Ingresar como admin'}
                  </button>
                </form>
              )}
            </section>

            <section className="rounded-[1.75rem] border border-black/5 bg-white/80 p-5 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                    Catalogo
                  </div>
                  <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">
                    Protocolos visibles
                  </h2>
                </div>
                <FileText className="h-5 w-5 text-[var(--ink-muted)]" />
              </div>

              <div className="mt-4 space-y-3">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar protocolo"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-10 py-3 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
                  />
                </label>

                <button
                  type="button"
                  disabled={!supervisorSession}
                  onClick={() => setApplicableOnly((current) => !current)}
                  className={clsx(
                    'inline-flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition',
                    applicableOnly
                      ? 'border-[var(--leaf)] bg-emerald-50 text-[var(--leaf)]'
                      : 'border-slate-200 bg-white text-slate-600',
                    !supervisorSession && 'cursor-not-allowed opacity-60'
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    <Filter className="h-4 w-4" />
                    Solo aplicables a mi
                  </span>
                  <span>{applicableOnly ? 'ON' : 'OFF'}</span>
                </button>
              </div>

              <div className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                {loadingList && (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500">
                    Cargando protocolos...
                  </div>
                )}
                {!loadingList && visibleProtocols.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500">
                    No hay protocolos que coincidan con el filtro actual.
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
                          'w-full rounded-[1.35rem] border px-4 py-4 text-left transition',
                          selected
                            ? 'border-[var(--ink)] bg-[var(--ink)] text-white shadow-lg'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">{protocol.title}</div>
                            <div
                              className={clsx(
                                'mt-2 text-xs leading-5',
                                selected ? 'text-white/75' : 'text-slate-500'
                              )}
                            >
                              {protocol.description || 'Sin descripcion.'}
                            </div>
                          </div>
                          {protocol.requires_signature ? (
                            <AlertTriangle className="h-4 w-4 flex-none text-amber-300" />
                          ) : protocol.has_signed_latest_version ? (
                            <CheckCircle2 className="h-4 w-4 flex-none text-emerald-300" />
                          ) : (
                            <ClipboardCheck
                              className={clsx(
                                'h-4 w-4 flex-none',
                                selected ? 'text-white/45' : 'text-slate-300'
                              )}
                            />
                          )}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
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
            </section>
          </aside>

          <main className="space-y-6">
            <section className="rounded-[2rem] border border-black/5 bg-white/80 p-6 shadow-sm backdrop-blur lg:p-8">
              {selectedProtocol ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="max-w-3xl">
                      <div className="flex flex-wrap gap-2">
                        {selectedProtocol.requires_signature ? (
                          <StatusPill tone="warning">Pendiente de firma</StatusPill>
                        ) : selectedProtocol.has_signed_latest_version ? (
                          <StatusPill tone="success">Firmado</StatusPill>
                        ) : (
                          <StatusPill>Publico</StatusPill>
                        )}
                        {selectedProtocol.latest_version && (
                          <StatusPill>
                            Version {selectedProtocol.latest_version.version_number}
                          </StatusPill>
                        )}
                      </div>
                      <h2 className="mt-4 font-display text-3xl text-[var(--ink)]">
                        {selectedProtocol.title}
                      </h2>
                      <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-muted)] sm:text-base">
                        {selectedProtocol.description || 'Sin descripcion registrada.'}
                      </p>
                    </div>

                    <div className="grid min-w-[240px] gap-3 sm:grid-cols-2 lg:grid-cols-1">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                          Publicada
                        </div>
                        <div className="mt-2 text-sm font-semibold text-[var(--ink)]">
                          {formatDateTime(selectedProtocol.latest_version?.created_at)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                          Supervisores
                        </div>
                        <div className="mt-2 text-sm font-semibold text-[var(--ink)]">
                          {selectedProtocol.latest_signed_supervisor_count} firmaron /{' '}
                          {selectedProtocol.applicable_supervisor_count} aplican
                        </div>
                        {adminSession && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <StatusPill tone={pendingSignatureStatuses.length > 0 ? 'warning' : 'neutral'}>
                              {pendingSignatureStatuses.length} pendientes
                            </StatusPill>
                            <StatusPill tone={signedSignatureStatuses.length > 0 ? 'success' : 'neutral'}>
                              {signedSignatureStatuses.length} firmados
                            </StatusPill>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {selectedProtocol.latest_version?.change_summary && (
                    <div className="mt-6 rounded-[1.5rem] border border-[var(--accent-soft)] bg-[#fff3ee] px-5 py-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
                        Resumen del cambio
                      </div>
                      <div className="mt-2 text-sm leading-6 text-[var(--ink)]">
                        {selectedProtocol.latest_version.change_summary}
                      </div>
                    </div>
                  )}

                  {adminSession && (
                    <div className="mt-6 rounded-[1.6rem] border border-slate-200 bg-slate-50 px-5 py-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                            Seguimiento de firmas
                          </div>
                          <div className="mt-2 text-lg font-semibold text-[var(--ink)]">
                            Estado por supervisor asignado
                          </div>
                        </div>
                        <FileSignature className="h-5 w-5 text-slate-400" />
                      </div>

                      {selectedProtocol.applicable_supervisors.length === 0 ? (
                        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                          No hay supervisores asignados a este protocolo.
                        </div>
                      ) : (
                        <div className="mt-5 grid gap-4 lg:grid-cols-2">
                          <div className="rounded-[1.4rem] border border-amber-200 bg-amber-50/70 px-4 py-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-amber-900">Pendientes</div>
                              <StatusPill tone="warning">{pendingSignatureStatuses.length}</StatusPill>
                            </div>
                            {pendingSignatureStatuses.length === 0 ? (
                              <div className="mt-4 rounded-2xl border border-emerald-200 bg-white px-4 py-4 text-sm text-emerald-700">
                                Todos los supervisores asignados ya firmaron esta version.
                              </div>
                            ) : (
                              <div className="mt-4 space-y-3">
                                {pendingSignatureStatuses.map((entry) => (
                                  <div
                                    key={entry.supervisor.id}
                                    className="rounded-2xl border border-amber-200 bg-white px-4 py-4"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <div>
                                        <div className="text-sm font-semibold text-[var(--ink)]">
                                          {buildSupervisorName(entry.supervisor)}
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500">
                                          {entry.supervisor.geovictoria_identifier || 'Sin identificador'}
                                        </div>
                                      </div>
                                      <StatusPill tone="warning">Pendiente</StatusPill>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="rounded-[1.4rem] border border-emerald-200 bg-emerald-50/70 px-4 py-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-emerald-900">Firmados</div>
                              <StatusPill tone="success">{signedSignatureStatuses.length}</StatusPill>
                            </div>
                            {signedSignatureStatuses.length === 0 ? (
                              <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                                Aun no hay firmas registradas para esta version.
                              </div>
                            ) : (
                              <div className="mt-4 space-y-3">
                                {signedSignatureStatuses.map((entry) => (
                                  <div
                                    key={entry.supervisor.id}
                                    className="rounded-2xl border border-emerald-200 bg-white px-4 py-4"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <div>
                                        <div className="text-sm font-semibold text-[var(--ink)]">
                                          {buildSupervisorName(entry.supervisor)}
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500">
                                          {entry.supervisor.geovictoria_identifier || 'Sin identificador'}
                                        </div>
                                        {entry.signed_at && (
                                          <div className="mt-2 text-xs text-slate-600">
                                            Firmado como {entry.signed_name} el {formatDateTime(entry.signed_at)}
                                          </div>
                                        )}
                                      </div>
                                      <StatusPill tone="success">Firmado</StatusPill>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {supervisorSession &&
                    selectedProtocol.is_applicable_to_current_supervisor &&
                    !selectedProtocol.has_signed_latest_version && (
                      <div className="mt-6 rounded-[1.6rem] border border-amber-200 bg-amber-50 px-5 py-5">
                        <div className="flex items-start gap-3">
                          <FileSignature className="mt-0.5 h-5 w-5 text-amber-700" />
                          <div className="min-w-0 flex-1">
                            <div className="text-base font-semibold text-amber-900">
                              Firma pendiente para esta version
                            </div>
                            <div className="mt-1 text-sm text-amber-800">
                              Debes firmar la version vigente con tu nombre y PIN para dejar
                              constancia interna de recepcion.
                            </div>
                            <form className="mt-4 grid gap-3 lg:grid-cols-[1fr_220px_auto]" onSubmit={handleSignProtocol}>
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
                                className="rounded-2xl border border-amber-200 bg-white px-3 py-3 text-sm text-slate-700 focus:border-amber-400 focus:outline-none"
                                placeholder="Nombre completo"
                              />
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
                                className="rounded-2xl border border-amber-200 bg-white px-3 py-3 text-sm text-slate-700 focus:border-amber-400 focus:outline-none"
                                placeholder="PIN"
                              />
                              <button
                                type="submit"
                                disabled={signatureSubmitting}
                                className={clsx(
                                  'inline-flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white transition',
                                  signatureSubmitting
                                    ? 'cursor-not-allowed bg-slate-400'
                                    : 'bg-amber-600 hover:bg-amber-700'
                                )}
                              >
                                <FileSignature className="h-4 w-4" />
                                {signatureSubmitting ? 'Firmando...' : 'Firmar protocolo'}
                              </button>
                            </form>
                          </div>
                        </div>
                      </div>
                    )}

                  {selectedProtocol.current_supervisor_signature && (
                    <div className="mt-6 rounded-[1.6rem] border border-emerald-200 bg-emerald-50 px-5 py-4">
                      <div className="flex items-start gap-3">
                        <BadgeCheck className="mt-0.5 h-5 w-5 text-emerald-700" />
                        <div>
                          <div className="text-base font-semibold text-emerald-900">
                            Version firmada
                          </div>
                          <div className="mt-1 text-sm text-emerald-800">
                            Firmada por {selectedProtocol.current_supervisor_signature.signed_name}{' '}
                            el {formatDateTime(selectedProtocol.current_supervisor_signature.signed_at)}.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-8 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                    <div className="space-y-4">
                      <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                              Documentos vigentes
                            </div>
                            <div className="mt-2 text-lg font-semibold text-[var(--ink)]">
                              {selectedProtocol.latest_documents.length} archivos
                            </div>
                          </div>
                          <FileText className="h-5 w-5 text-slate-400" />
                        </div>
                        <div className="mt-4 space-y-3">
                          {selectedProtocol.latest_documents.map((document) => (
                            <div
                              key={document.id}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-[var(--ink)]">
                                  {document.original_filename}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {document.mime_type} · {formatFileSize(document.size_bytes)} ·{' '}
                                  {formatDateTime(document.uploaded_at)}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setPreviewDocument(document)}
                                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 transition hover:bg-slate-50"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  Ver
                                </button>
                                <a
                                  href={buildDocumentUrl(document.uri)}
                                  download={document.original_filename}
                                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 transition hover:bg-slate-50"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  Descargar
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-5">
                        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                          Supervisores aplicables
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {selectedProtocol.applicable_supervisors.length > 0 ? (
                            selectedProtocol.applicable_supervisors.map((supervisor) => (
                              <StatusPill key={supervisor.id}>
                                {buildSupervisorName(supervisor)}
                              </StatusPill>
                            ))
                          ) : (
                            <div className="text-sm text-slate-500">
                              Este protocolo no tiene supervisores asignados.
                            </div>
                          )}
                        </div>
                      </div>

                    </div>

                    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                            Diferencias con la version anterior
                          </div>
                          <div className="mt-2 text-lg font-semibold text-[var(--ink)]">
                            {selectedProtocol.previous_version_number
                              ? `Comparando con V${selectedProtocol.previous_version_number}`
                              : 'Sin version anterior'}
                          </div>
                        </div>
                        <FileDiff className="h-5 w-5 text-slate-400" />
                      </div>
                      {selectedProtocol.previous_version_number == null ? (
                        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                          Este protocolo solo tiene una version publicada.
                        </div>
                      ) : selectedProtocol.diff_entries.length === 0 ? (
                        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                          No se detectaron diferencias textuales entre la version anterior y la
                          vigente.
                        </div>
                      ) : (
                        <div className="mt-4 space-y-4">
                          {selectedProtocol.diff_entries.map((entry, index) => (
                            <div
                              key={`${entry.document_name}-${index}`}
                              className="rounded-2xl border border-slate-200 bg-white px-4 py-4"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-[var(--ink)]">
                                    {entry.document_name}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {entry.kind === 'added'
                                      ? 'Documento agregado'
                                      : entry.kind === 'removed'
                                      ? 'Documento removido'
                                      : `Cambios detectados: +${entry.added_lines} / -${entry.removed_lines}`}
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
                                <pre className="mt-4 overflow-x-auto rounded-2xl bg-[#101926] px-4 py-4 text-xs leading-5 text-slate-100">
                                  {entry.diff_excerpt}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-[1.6rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                  {loadingDetail || loadingList
                    ? 'Cargando detalle del protocolo...'
                    : 'Selecciona un protocolo para revisar documentos, firmas y diferencias.'}
                </div>
              )}
            </section>

            {managerEnabled && (
              <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                <form
                  className="rounded-[1.9rem] border border-black/5 bg-white/80 p-6 shadow-sm backdrop-blur"
                  onSubmit={handleCreateProtocol}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                        Nuevo protocolo
                      </div>
                      <h3 className="mt-2 text-xl font-semibold text-[var(--ink)]">
                        Crear protocolo
                      </h3>
                    </div>
                    <Upload className="h-5 w-5 text-[var(--ink-muted)]" />
                  </div>
                  <div className="mt-5 space-y-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Titulo
                      </label>
                      <input
                        type="text"
                        value={createDraft.title}
                        onChange={(event) =>
                          setCreateDraft((current) => ({ ...current, title: event.target.value }))
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                        rows={4}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                        rows={3}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                      <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                        className="mt-2 block w-full text-sm text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-[var(--ink)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
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
                        'inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white transition',
                        createSubmitting
                          ? 'cursor-not-allowed bg-slate-400'
                          : 'bg-[var(--accent)] hover:bg-[#df5535]'
                      )}
                    >
                      <Upload className="h-4 w-4" />
                      {createSubmitting ? 'Creando...' : 'Crear protocolo'}
                    </button>
                  </div>
                </form>

                <div className="space-y-6">
                  <form
                    className="rounded-[1.9rem] border border-black/5 bg-white/80 p-6 shadow-sm backdrop-blur"
                    onSubmit={handleUpdateProtocol}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                          Protocolo seleccionado
                        </div>
                        <h3 className="mt-2 text-xl font-semibold text-[var(--ink)]">
                          Editar metadatos
                        </h3>
                      </div>
                      <ClipboardCheck className="h-5 w-5 text-[var(--ink-muted)]" />
                    </div>

                    {!selectedProtocol ? (
                      <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                        Selecciona un protocolo para editar su titulo, descripcion y aplicabilidad.
                      </div>
                    ) : (
                      <div className="mt-5 space-y-4">
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                            'inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white transition',
                            updateSubmitting
                              ? 'cursor-not-allowed bg-slate-400'
                              : 'bg-[var(--ink)] hover:bg-black'
                          )}
                        >
                          <ClipboardCheck className="h-4 w-4" />
                          {updateSubmitting ? 'Guardando...' : 'Guardar metadatos'}
                        </button>
                      </div>
                    )}
                  </form>

                  <form
                    className="rounded-[1.9rem] border border-black/5 bg-white/80 p-6 shadow-sm backdrop-blur"
                    onSubmit={handleCreateVersion}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                          Versionado
                        </div>
                        <h3 className="mt-2 text-xl font-semibold text-[var(--ink)]">
                          Publicar nueva version
                        </h3>
                      </div>
                      <FileSignature className="h-5 w-5 text-[var(--ink-muted)]" />
                    </div>

                    {!selectedProtocol ? (
                      <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                        Selecciona un protocolo para cargar documentos nuevos o reemplazados.
                      </div>
                    ) : (
                      <div className="mt-5 space-y-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                          Los documentos nuevos reemplazan otros con el mismo nombre de archivo y
                          el resto de los documentos vigentes se conserva en la nueva version.
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 focus:border-[var(--accent)] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                            className="mt-2 block w-full text-sm text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-[var(--leaf)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
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
                            'inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white transition',
                            versionSubmitting
                              ? 'cursor-not-allowed bg-slate-400'
                              : 'bg-[var(--leaf)] hover:bg-[#24543d]'
                          )}
                        >
                          <FileSignature className="h-4 w-4" />
                          {versionSubmitting ? 'Publicando...' : 'Publicar nueva version'}
                        </button>
                      </div>
                    )}
                  </form>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>

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
          <div className="relative flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-black/10 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-[var(--ink)]">
                  {previewDocument.original_filename}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {previewDocument.mime_type} · {formatFileSize(previewDocument.size_bytes)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={buildDocumentUrl(previewDocument.uri)}
                  download={previewDocument.original_filename}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" />
                  Descargar
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDocument(null)}
                  className="inline-flex items-center justify-center rounded-full border border-black/10 p-2 text-[var(--ink)] transition hover:bg-slate-50"
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
                  <div className="mx-auto max-w-4xl rounded-[1.5rem] border border-slate-200 bg-white px-6 py-6 shadow-sm">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      Vista previa DOCX
                    </div>
                    <div className="mt-2 text-sm text-slate-500">
                      Se muestra una vista de texto extraido. El formato original del documento puede diferir.
                    </div>
                    <div className="mt-6 whitespace-pre-wrap text-sm leading-7 text-[var(--ink)]">
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
