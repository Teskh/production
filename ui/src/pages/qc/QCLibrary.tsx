import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  ChevronRight,
  ExternalLink,
  FileImage,
  Loader2,
  MessageSquareText,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useOptionalQCSession } from '../../layouts/QCLayoutContext';
import { formatDateTimeShort } from '../../utils/timeUtils';
import './QCLibrary.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const PAGE_SIZE = 50;
// const CHECK_DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_QC_EVIDENCE_BYTES = 50 * 1024 * 1024;
const QC_ACTION_ROLES = new Set(['Calidad', 'QC']);
const SEARCH_DEBOUNCE_MS = 300;

type QCExecutionOutcome = 'Pass' | 'Fail' | 'Waive' | 'Skip';
type QCCheckStatus = 'Open' | 'Closed';
type TaskScope = 'panel' | 'module' | 'aux';
type QCReworkStatus = 'Open' | 'InProgress' | 'Done' | 'Canceled';
type TaskStatus = 'NotStarted' | 'InProgress' | 'Paused' | 'Completed';
type QCSeverity = 'baja' | 'media' | 'critica';
type WorkUnitStatus = 'Planned' | 'Panels' | 'Magazine' | 'Assembly' | 'Completed';

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
  status: WorkUnitStatus;
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
  severity_level: QCSeverity | null;
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
  status: WorkUnitStatus;
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
  default_severity_level: QCSeverity | null;
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

type ProductionQueuePanelStatus = {
  panel_unit_id: number | null;
  panel_code: string | null;
  status: string;
  current_station_name: string | null;
};

type ProductionQueueModuleStatus = {
  status: WorkUnitStatus;
  current_station_name: string | null;
  panels: ProductionQueuePanelStatus[];
};

type QCManualCheckOption = {
  id: number;
  name: string;
  guidance_text: string | null;
  has_open_instance: boolean;
};

type QCManualCheckResponse = {
  id: number;
};

const parseApiErrorMessage = (text: string): string => {
  try {
    const parsed = JSON.parse(text) as { detail?: string };
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
      return parsed.detail;
    }
  } catch {
    // Keep raw text fallback.
  }
  return text;
};

const apiRequest = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    const text = await response.text();
    if (text) throw new Error(parseApiErrorMessage(text));
    throw new Error(`Solicitud fallida (${response.status})`);
  }
  return (await response.json()) as T;
};

const apiDeleteRequest = async (path: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const text = await response.text();
    if (text) throw new Error(parseApiErrorMessage(text));
    throw new Error(`Solicitud fallida (${response.status})`);
  }
};

// Temporarily paused. Keep the helper for the 48h delete/evidence window so it can be
// restored without rediscovering all call sites.
const isWithinDeleteWindow = (openedAt: string): boolean => {
  void openedAt;
  return true;
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

const workUnitStatusLabel = (status: string): string =>
  status.toLowerCase() === 'assembly' ? 'Armado' : status;

const inspectionScopeForStatus = (status: WorkUnitStatus): 'panel' | 'module' | null => {
  if (status === 'Panels') return 'panel';
  if (status === 'Magazine' || status === 'Assembly') return 'module';
  return null;
};

const severityLabel: Record<QCSeverity, string> = {
  baja: 'Sev. baja',
  media: 'Sev. media',
  critica: 'Sev. critica',
};

// Tone classes map statuses to the physical QC tag colors defined in QCLibrary.css.
const outcomeTone: Record<QCExecutionOutcome, string> = {
  Pass: 'qcl-pass',
  Fail: 'qcl-fail',
  Waive: 'qcl-rework',
  Skip: 'qcl-skip',
};

const severityTone: Record<QCSeverity, string> = {
  baja: 'qcl-skip',
  media: 'qcl-rework',
  critica: 'qcl-fail',
};

const checkStatusTone = (status: QCCheckStatus): string =>
  status === 'Open' ? 'qcl-open' : 'qcl-neutral';

const manualSubtypeLabel = (check: QCCheckInstanceSummary): string | null => {
  if (check.origin !== 'manual') return null;
  return check.check_definition_id === null ? 'Ad-hoc' : 'Manual desde check';
};

const checkDisplayName = (check: QCCheckInstanceSummary): string =>
  check.check_name ?? `Check #${check.id}`;

// ---------------------------------------------------------------------------
// Presentational leaves
// ---------------------------------------------------------------------------

const Tag: React.FC<{ tone: string; children: React.ReactNode; className?: string }> = ({
  tone,
  children,
  className,
}) => <span className={clsx('qcl-tag', tone, className)}>{children}</span>;

const OutcomeStamp: React.FC<{
  outcome: QCExecutionOutcome;
  large?: boolean;
  tilt?: boolean;
}> = ({ outcome, large, tilt }) => (
  <span
    className={clsx(
      'qcl-stamp',
      outcomeTone[outcome],
      large && 'qcl-stamp--lg',
      tilt && 'qcl-stamp--tilt'
    )}
  >
    {outcomeLabel[outcome]}
  </span>
);

const Counter: React.FC<{ label: string; value: number; tone?: string }> = ({
  label,
  value,
  tone,
}) => (
  <div className="px-5 first:pl-0 last:pr-0">
    <div className={clsx('qcl-counter-num', value > 0 && tone ? tone : 'qcl-ink')}>{value}</div>
    <div className="qcl-counter-label mt-1">{label}</div>
  </div>
);

const EvidenceThumb: React.FC<{
  item: QCEvidenceSummary;
  onOpen: (item: QCEvidenceSummary) => void;
  className?: string;
}> = ({ item, onOpen, className }) => (
  <button
    type="button"
    onClick={() => onOpen(item)}
    title={`Evidencia #${item.id} · ${formatDateTimeShort(item.captured_at)}`}
    className={clsx(
      'group relative overflow-hidden rounded-[3px] border border-[var(--qcl-line)] bg-[var(--qcl-paper-2)]',
      className ?? 'h-14 w-14'
    )}
  >
    {item.mime_type?.startsWith('image/') ? (
      <img
        src={resolveMediaUri(item.uri)}
        alt={`Evidencia ${item.id}`}
        loading="lazy"
        className="h-full w-full object-cover transition group-hover:scale-105"
      />
    ) : (
      <span className="flex h-full w-full items-center justify-center text-[var(--qcl-ink-2)]">
        <FileImage className="h-5 w-5" />
      </span>
    )}
  </button>
);

// ---------------------------------------------------------------------------
// Check story (per-check history card in the module sheet)
// ---------------------------------------------------------------------------

type StoryEvent =
  | { kind: 'opened'; ts: string }
  | { kind: 'execution'; ts: string; execution: QCExecutionRead; evidence: QCEvidenceSummary[] }
  | { kind: 'rework'; ts: string; rework: QCReworkTaskSummary }
  | { kind: 'closed'; ts: string };

type CheckStory = {
  check: QCCheckInstanceSummary;
  events: StoryEvent[];
  lastOutcome: QCExecutionOutcome | null;
  lastActivityTs: string;
  hasFail: boolean;
  noteCount: number;
  openReworkCount: number;
};

const storyAccentClass = (story: CheckStory): string => {
  if (story.check.status === 'Open') {
    return story.hasFail ? 'qcl-story--fail' : 'qcl-story--open';
  }
  return story.hasFail ? 'qcl-story--rework' : 'qcl-story--pass';
};

const StoryEventRow: React.FC<{
  event: StoryEvent;
  isLast: boolean;
  check: QCCheckInstanceSummary;
  adminNameById: Map<number, string>;
  onOpenMedia: (item: QCEvidenceSummary) => void;
}> = ({ event, isLast, check, adminNameById, onOpenMedia }) => {
  let nodeClass = 'qcl-open qcl-node--outline';
  let title: React.ReactNode = 'Check abierto';

  if (event.kind === 'closed') {
    nodeClass = 'qcl-ink';
    title = 'Check cerrado';
  } else if (event.kind === 'rework') {
    nodeClass = 'qcl-rework qcl-node--diamond';
    title = (
      <>
        Rework · <span className="qcl-rework">{reworkStatusLabel[event.rework.status]}</span>
      </>
    );
  } else if (event.kind === 'execution') {
    nodeClass = outcomeTone[event.execution.outcome];
    title = (
      <>
        Inspeccion ·{' '}
        <span className={outcomeTone[event.execution.outcome]}>
          {outcomeLabel[event.execution.outcome]}
        </span>
      </>
    );
  }

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <div className="relative flex w-4 shrink-0 justify-center pt-[5px]">
        {!isLast ? (
          <span className="absolute bottom-[-6px] left-1/2 top-4 w-px -translate-x-1/2 bg-[var(--qcl-line)]" />
        ) : null}
        <span className={clsx('qcl-node relative z-10', nodeClass)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-sm font-semibold">{title}</span>
          <span className="qcl-mono text-[11px] text-[var(--qcl-ink-2)]">
            {formatDateTimeShort(event.ts)}
          </span>
        </div>
        {event.kind === 'opened' ? (
          <p className="mt-0.5 text-xs text-[var(--qcl-ink-2)]">
            {check.origin === 'triggered' ? 'Generado por tarea' : 'Creado manualmente'}
            {check.station_name ? ` · ${check.station_name}` : ''}
          </p>
        ) : null}
        {event.kind === 'execution' ? (
          <>
            <p className="mt-0.5 text-xs text-[var(--qcl-ink-2)]">
              por{' '}
              {adminNameById.get(event.execution.performed_by_user_id) ??
                `Usuario #${event.execution.performed_by_user_id}`}
            </p>
            {event.execution.notes?.trim() ? (
              <div className="qcl-note mt-2">
                <div className="qcl-note__label">
                  <MessageSquareText className="h-3.5 w-3.5" />
                  Nota
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {event.execution.notes.trim()}
                </p>
              </div>
            ) : null}
            {event.execution.failure_modes.length ? (
              <p className="mt-1 text-xs text-[var(--qcl-ink-2)]">
                Fallas:{' '}
                <span className="font-medium text-[var(--qcl-ink)]">
                  {event.execution.failure_modes
                    .map((mode) => mode.failure_mode_name ?? mode.other_text ?? 'Otro')
                    .join(', ')}
                </span>
              </p>
            ) : null}
            {event.evidence.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {event.evidence.map((item) => (
                  <EvidenceThumb key={item.id} item={item} onOpen={onOpenMedia} />
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        {event.kind === 'rework' ? (
          <p className="mt-0.5 text-sm">{event.rework.description}</p>
        ) : null}
      </div>
    </li>
  );
};

const CheckStoryCard: React.FC<{
  story: CheckStory;
  adminNameById: Map<number, string>;
  onOpenCheck: (checkId: number) => void;
  onOpenMedia: (item: QCEvidenceSummary) => void;
}> = ({ story, adminNameById, onOpenCheck, onOpenMedia }) => {
  const { check } = story;
  return (
    <article className={clsx('qcl-card qcl-story overflow-hidden', storyAccentClass(story))}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--qcl-line-soft)] bg-[var(--qcl-paper-2)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h5 className="text-[15px] font-semibold leading-tight">{checkDisplayName(check)}</h5>
            <span className="qcl-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--qcl-ink-2)]">
              {check.scope === 'panel' && check.panel_code
                ? `Panel ${check.panel_code}`
                : scopeLabel[check.scope]}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Tag tone={checkStatusTone(check.status)}>{checkStatusLabel[check.status]}</Tag>
            {story.lastOutcome ? <OutcomeStamp outcome={story.lastOutcome} /> : null}
            {check.severity_level ? (
              <Tag tone={severityTone[check.severity_level]}>
                {severityLabel[check.severity_level]}
              </Tag>
            ) : null}
            {story.openReworkCount > 0 ? (
              <Tag tone="qcl-rework">{story.openReworkCount} rework abierto</Tag>
            ) : null}
            {story.noteCount > 0 ? (
              <span className="qcl-note-indicator">
                <MessageSquareText className="h-3.5 w-3.5" />
                {story.noteCount} {story.noteCount === 1 ? 'nota' : 'notas'}
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpenCheck(check.id)}
          className="qcl-btn qcl-btn--sm shrink-0"
        >
          Ver ficha
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <ol className="px-4 py-3">
        {story.events.map((event, index) => (
          <StoryEventRow
            key={`${event.kind}:${index}`}
            event={event}
            isLast={index === story.events.length - 1}
            check={check}
            adminNameById={adminNameById}
            onOpenMedia={onOpenMedia}
          />
        ))}
      </ol>
    </article>
  );
};

// ---------------------------------------------------------------------------
// House grouping for the main list
// ---------------------------------------------------------------------------

type HouseGroup = {
  key: string;
  houseIdentifier: string | null;
  projectName: string;
  houseTypeName: string;
  units: QCLibraryWorkUnitSummary[];
  openChecks: number;
  openRework: number;
  lastOutcome: QCExecutionOutcome | null;
  lastOutcomeAt: string | null;
};

const QCLibrary: React.FC = () => {
  const navigate = useNavigate();
  const qcSession = useOptionalQCSession();
  const [searchParams, setSearchParams] = useSearchParams();

  const [workUnits, setWorkUnits] = useState<QCLibraryWorkUnitSummary[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [loadingMoreUnits, setLoadingMoreUnits] = useState(false);
  const [hasMoreUnits, setHasMoreUnits] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [unitsRefreshToken, setUnitsRefreshToken] = useState(0);

  const [adminUsers, setAdminUsers] = useState<AdminUserRead[]>([]);

  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('__all__');
  const [statusFilter, setStatusFilter] = useState<string>('__all__');
  const [unfulfilledOnly, setUnfulfilledOnly] = useState(false);

  const selectedWorkUnitId = Number(searchParams.get('module') ?? '') || null;
  const selectedCheckId = Number(searchParams.get('check') ?? '') || null;

  const [workUnitDetail, setWorkUnitDetail] = useState<QCLibraryWorkUnitDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);
  const [sheetStatusFilter, setSheetStatusFilter] = useState<'all' | 'open' | 'fail'>('all');
  const [sheetScopeFilter, setSheetScopeFilter] = useState<string>('__all__');

  const [inspectionCreatorOpen, setInspectionCreatorOpen] = useState(false);
  const [inspectionTarget, setInspectionTarget] = useState<ProductionQueueModuleStatus | null>(null);
  const [inspectionOptions, setInspectionOptions] = useState<QCManualCheckOption[]>([]);
  const [inspectionPanelId, setInspectionPanelId] = useState<number | null>(null);
  const [inspectionDefinitionId, setInspectionDefinitionId] = useState<number | null>(null);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [inspectionOptionsLoading, setInspectionOptionsLoading] = useState(false);
  const [inspectionSubmitting, setInspectionSubmitting] = useState(false);
  const [inspectionError, setInspectionError] = useState<string | null>(null);

  const [checkDetail, setCheckDetail] = useState<QCCheckInstanceDetail | null>(null);
  const [loadingCheckDetail, setLoadingCheckDetail] = useState(false);
  const [checkDetailError, setCheckDetailError] = useState<string | null>(null);
  const [checkRefreshToken, setCheckRefreshToken] = useState(0);
  const [checkDeleteError, setCheckDeleteError] = useState<string | null>(null);
  const [deletingCheck, setDeletingCheck] = useState(false);
  const [deletingEvidenceIds, setDeletingEvidenceIds] = useState<Set<number>>(new Set());
  const [uploadingEvidenceExecutionIds, setUploadingEvidenceExecutionIds] = useState<Set<number>>(
    new Set()
  );

  const [mediaViewer, setMediaViewer] = useState<{
    uri: string;
    mimeType: string | null;
    title: string;
  } | null>(null);

  // ------------------------------------------------------------------
  // Overlay navigation (URL-backed so deep links keep working)
  // ------------------------------------------------------------------

  const closeModuleOverlay = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('module');
    next.delete('check');
    setSearchParams(next, { replace: true });
    setWorkUnitDetail(null);
    setDetailError(null);
    setInspectionCreatorOpen(false);
    setInspectionTarget(null);
    setInspectionOptions([]);
    setInspectionPanelId(null);
    setInspectionDefinitionId(null);
    setInspectionError(null);
  }, [searchParams, setSearchParams]);

  const openModuleOverlay = (workUnitId: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('module', String(workUnitId));
    next.delete('check');
    setSearchParams(next, { replace: true });
  };

  const closeInspectionCreator = useCallback(() => {
    if (inspectionSubmitting) return;
    setInspectionCreatorOpen(false);
    setInspectionTarget(null);
    setInspectionOptions([]);
    setInspectionPanelId(null);
    setInspectionDefinitionId(null);
    setInspectionError(null);
  }, [inspectionSubmitting]);

  const openInspectionCreator = () => {
    setInspectionCreatorOpen(true);
    setInspectionTarget(null);
    setInspectionOptions([]);
    setInspectionPanelId(null);
    setInspectionDefinitionId(null);
    setInspectionError(null);
  };

  const closeCheckOverlay = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('check');
    setSearchParams(next, { replace: true });
    setCheckDetail(null);
    setCheckDetailError(null);
    setCheckDeleteError(null);
    setDeletingCheck(false);
    setDeletingEvidenceIds(new Set());
    setUploadingEvidenceExecutionIds(new Set());
  }, [searchParams, setSearchParams]);

  const openCheckOverlay = useCallback(
    (checkId: number) => {
      const next = new URLSearchParams(searchParams);
      next.set('check', String(checkId));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(searchInput), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const fetchUnitsPage = useCallback(
    async (offset: number): Promise<QCLibraryWorkUnitSummary[]> => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        include_planned: 'false',
        sort: 'newest',
      });
      if (searchTerm.trim()) {
        params.set('q', searchTerm.trim());
      }
      const response = await fetch(
        `${API_BASE_URL}/api/qc/library/work-units?${params.toString()}`,
        { credentials: 'include' }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text ? parseApiErrorMessage(text) : `Solicitud fallida (${response.status})`);
      }
      return (await response.json()) as QCLibraryWorkUnitSummary[];
    },
    [searchTerm]
  );

  useEffect(() => {
    let mounted = true;

    const loadUnits = async () => {
      setLoadingUnits(true);
      try {
        const data = await fetchUnitsPage(0);
        if (!mounted) return;
        setWorkUnits(data);
        setHasMoreUnits(data.length === PAGE_SIZE);
        setUnitsError(null);
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
  }, [fetchUnitsPage, unitsRefreshToken]);

  const loadMoreUnits = async () => {
    if (loadingUnits || loadingMoreUnits || !hasMoreUnits) return;
    setLoadingMoreUnits(true);
    try {
      const data = await fetchUnitsPage(workUnits.length);
      setWorkUnits((prev) => {
        const existing = new Set(prev.map((unit) => unit.work_unit_id));
        return [...prev, ...data.filter((unit) => !existing.has(unit.work_unit_id))];
      });
      setHasMoreUnits(data.length === PAGE_SIZE);
      setUnitsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar mas modulos.';
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
  }, [detailRefreshToken, selectedWorkUnitId]);

  useEffect(() => {
    setSheetStatusFilter('all');
    setSheetScopeFilter('__all__');
  }, [selectedWorkUnitId]);

  useEffect(() => {
    let mounted = true;
    if (!inspectionCreatorOpen || !selectedWorkUnitId) return () => {
      mounted = false;
    };

    const loadInspectionTarget = async () => {
      setInspectionLoading(true);
      setInspectionError(null);
      try {
        const target = await apiRequest<ProductionQueueModuleStatus>(
          `/api/production-queue/items/${selectedWorkUnitId}/status`
        );
        if (!mounted) return;
        const scope = inspectionScopeForStatus(target.status);
        if (!scope) {
          throw new Error('Solo se pueden agregar inspecciones a módulos actualmente en producción.');
        }
        setInspectionTarget(target);
        const availablePanels = target.panels.filter((panel) => panel.panel_unit_id !== null);
        setInspectionPanelId(
          scope === 'panel' && availablePanels.length === 1
            ? availablePanels[0].panel_unit_id
            : null
        );
      } catch (error) {
        if (!mounted) return;
        setInspectionTarget(null);
        setInspectionError(
          error instanceof Error ? error.message : 'No se pudo cargar el objetivo de inspección.'
        );
      } finally {
        if (mounted) setInspectionLoading(false);
      }
    };
    void loadInspectionTarget();
    return () => {
      mounted = false;
    };
  }, [inspectionCreatorOpen, selectedWorkUnitId]);

  useEffect(() => {
    let mounted = true;
    if (!inspectionCreatorOpen || !inspectionTarget || !selectedWorkUnitId) return () => {
      mounted = false;
    };
    const scope = inspectionScopeForStatus(inspectionTarget.status);
    if (!scope || (scope === 'panel' && !inspectionPanelId)) {
      setInspectionOptions([]);
      setInspectionDefinitionId(null);
      return () => {
        mounted = false;
      };
    }

    const loadInspectionOptions = async () => {
      setInspectionOptionsLoading(true);
      setInspectionError(null);
      try {
        const params = new URLSearchParams({ work_unit_id: String(selectedWorkUnitId) });
        if (scope === 'panel' && inspectionPanelId) {
          params.set('panel_unit_id', String(inspectionPanelId));
        }
        const options = await apiRequest<QCManualCheckOption[]>(
          `/api/qc/manual-check-options?${params.toString()}`
        );
        if (!mounted) return;
        setInspectionOptions(options);
        setInspectionDefinitionId((current) =>
          current && options.some((option) => option.id === current && !option.has_open_instance)
            ? current
            : null
        );
      } catch (error) {
        if (!mounted) return;
        setInspectionOptions([]);
        setInspectionDefinitionId(null);
        setInspectionError(
          error instanceof Error ? error.message : 'No se pudieron cargar las pautas aplicables.'
        );
      } finally {
        if (mounted) setInspectionOptionsLoading(false);
      }
    };
    void loadInspectionOptions();
    return () => {
      mounted = false;
    };
  }, [inspectionCreatorOpen, inspectionPanelId, inspectionTarget, selectedWorkUnitId]);

  useEffect(() => {
    let mounted = true;
    if (!selectedCheckId) {
      setCheckDetail(null);
      setCheckDetailError(null);
      setCheckDeleteError(null);
      setDeletingCheck(false);
      setDeletingEvidenceIds(new Set());
      return () => {
        mounted = false;
      };
    }
    setCheckDeleteError(null);
    const loadCheck = async () => {
      setLoadingCheckDetail(true);
      try {
        const detail = await apiRequest<QCCheckInstanceDetail>(
          `/api/qc/check-instances/${selectedCheckId}`
        );
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
  }, [checkRefreshToken, selectedCheckId]);

  // ------------------------------------------------------------------
  // Derived data
  // ------------------------------------------------------------------

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
    const needle = searchInput.trim().toLowerCase();
    return workUnits.filter((unit) => {
      if (projectFilter !== '__all__' && unit.project_name !== projectFilter) return false;
      if (statusFilter !== '__all__' && unit.status !== statusFilter) return false;
      if (unfulfilledOnly && unit.open_checks + unit.open_rework === 0) return false;
      if (!needle) return true;
      return (
        String(unit.module_number).toLowerCase().includes(needle) ||
        (unit.house_identifier ?? '').toLowerCase().includes(needle) ||
        unit.project_name.toLowerCase().includes(needle) ||
        unit.house_type_name.toLowerCase().includes(needle)
      );
    });
  }, [projectFilter, searchInput, statusFilter, unfulfilledOnly, workUnits]);

  const houseGroups = useMemo<HouseGroup[]>(() => {
    const map = new Map<string, HouseGroup>();
    const order: string[] = [];
    for (const unit of filteredUnits) {
      // Units without a house identifier stay as standalone entries.
      const key = unit.house_identifier
        ? `${unit.project_name}::${unit.house_identifier}`
        : `wu::${unit.work_unit_id}`;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          houseIdentifier: unit.house_identifier,
          projectName: unit.project_name,
          houseTypeName: unit.house_type_name,
          units: [],
          openChecks: 0,
          openRework: 0,
          lastOutcome: null,
          lastOutcomeAt: null,
        };
        map.set(key, group);
        order.push(key);
      }
      group.units.push(unit);
      group.openChecks += unit.open_checks;
      group.openRework += unit.open_rework;
      if (
        unit.last_outcome_at &&
        (!group.lastOutcomeAt || unit.last_outcome_at > group.lastOutcomeAt)
      ) {
        group.lastOutcome = unit.last_outcome;
        group.lastOutcomeAt = unit.last_outcome_at;
      }
    }
    for (const group of map.values()) {
      group.units.sort((a, b) => a.module_number - b.module_number);
    }
    // The API sorts by newest activity; first appearance preserves that order.
    return order.map((key) => map.get(key)!);
  }, [filteredUnits]);

  const summaryCounts = useMemo(
    () => ({
      houses: houseGroups.length,
      modules: filteredUnits.length,
      openChecks: filteredUnits.reduce((acc, unit) => acc + unit.open_checks, 0),
      openRework: filteredUnits.reduce((acc, unit) => acc + unit.open_rework, 0),
    }),
    [filteredUnits, houseGroups]
  );

  const sheetStats = useMemo(() => {
    if (!workUnitDetail) return null;
    return {
      totalChecks: workUnitDetail.checks.length,
      openChecks: workUnitDetail.checks.filter((check) => check.status === 'Open').length,
      fails: workUnitDetail.executions.filter((execution) => execution.outcome === 'Fail').length,
      openRework: workUnitDetail.rework_tasks.filter(
        (rework) => rework.status === 'Open' || rework.status === 'InProgress'
      ).length,
      evidence: workUnitDetail.evidence.length,
    };
  }, [workUnitDetail]);

  const checkStories = useMemo<CheckStory[]>(() => {
    if (!workUnitDetail) return [];
    const evidenceByExecution = new Map<number, QCEvidenceSummary[]>();
    for (const item of workUnitDetail.evidence) {
      const list = evidenceByExecution.get(item.execution_id) ?? [];
      list.push(item);
      evidenceByExecution.set(item.execution_id, list);
    }
    return workUnitDetail.checks
      .map((check) => {
        const executions = workUnitDetail.executions
          .filter((execution) => execution.check_instance_id === check.id)
          .sort((a, b) => a.performed_at.localeCompare(b.performed_at));
        const reworks = workUnitDetail.rework_tasks.filter(
          (rework) => rework.check_instance_id === check.id
        );
        const events: StoryEvent[] = [{ kind: 'opened', ts: check.opened_at }];
        for (const execution of executions) {
          events.push({
            kind: 'execution',
            ts: execution.performed_at,
            execution,
            evidence: (evidenceByExecution.get(execution.id) ?? [])
              .slice()
              .sort((a, b) => a.captured_at.localeCompare(b.captured_at)),
          });
        }
        for (const rework of reworks) {
          events.push({ kind: 'rework', ts: rework.created_at, rework });
        }
        if (check.closed_at) {
          events.push({ kind: 'closed', ts: check.closed_at });
        }
        events.sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''));
        const lastExecution = executions[executions.length - 1] ?? null;
        return {
          check,
          events,
          lastOutcome: lastExecution?.outcome ?? null,
          lastActivityTs: events[events.length - 1]?.ts ?? check.opened_at,
          hasFail: executions.some((execution) => execution.outcome === 'Fail'),
          noteCount: executions.filter((execution) => Boolean(execution.notes?.trim())).length,
          openReworkCount: reworks.filter(
            (rework) => rework.status === 'Open' || rework.status === 'InProgress'
          ).length,
        };
      })
      .sort((a, b) => {
        const aOpen = a.check.status === 'Open' ? 0 : 1;
        const bOpen = b.check.status === 'Open' ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        return b.lastActivityTs.localeCompare(a.lastActivityTs);
      });
  }, [workUnitDetail]);

  const sheetScopeOptions = useMemo(() => {
    const panels = new Set<string>();
    let hasModule = false;
    let hasAux = false;
    for (const story of checkStories) {
      if (story.check.scope === 'panel' && story.check.panel_code) {
        panels.add(story.check.panel_code);
      } else if (story.check.scope === 'module') {
        hasModule = true;
      } else {
        hasAux = true;
      }
    }
    return {
      panels: Array.from(panels).sort((a, b) => a.localeCompare(b)),
      hasModule,
      hasAux,
    };
  }, [checkStories]);

  const visibleStories = useMemo(() => {
    return checkStories.filter((story) => {
      if (sheetStatusFilter === 'open' && story.check.status !== 'Open') return false;
      if (sheetStatusFilter === 'fail' && !story.hasFail) return false;
      if (sheetScopeFilter === '__all__') return true;
      if (sheetScopeFilter === 'module') return story.check.scope === 'module';
      if (sheetScopeFilter === 'aux') return story.check.scope === 'aux';
      return story.check.scope === 'panel' && story.check.panel_code === sheetScopeFilter;
    });
  }, [checkStories, sheetScopeFilter, sheetStatusFilter]);

  const handleCreateInspection = async () => {
    if (
      !selectedWorkUnitId ||
      !inspectionTarget ||
      !inspectionDefinitionId ||
      inspectionSubmitting
    ) {
      return;
    }
    const scope = inspectionScopeForStatus(inspectionTarget.status);
    if (!scope || (scope === 'panel' && !inspectionPanelId)) return;

    setInspectionSubmitting(true);
    setInspectionError(null);
    try {
      const created = await apiRequest<QCManualCheckResponse>('/api/qc/check-instances/manual', {
        method: 'POST',
        body: JSON.stringify({
          check_definition_id: inspectionDefinitionId,
          ad_hoc_title: null,
          ad_hoc_guidance: null,
          scope,
          work_unit_id: selectedWorkUnitId,
          panel_unit_id: scope === 'panel' ? inspectionPanelId : null,
          station_id: null,
        }),
      });
      navigate(`/qc/execute?check=${created.id}`, {
        state: {
          checkId: created.id,
          returnTo: `/qc/library?module=${selectedWorkUnitId}`,
        },
      });
    } catch (error) {
      setInspectionError(
        error instanceof Error ? error.message : 'No se pudo iniciar la inspección.'
      );
    } finally {
      setInspectionSubmitting(false);
    }
  };

  // ------------------------------------------------------------------
  // Escape closes the topmost overlay
  // ------------------------------------------------------------------

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
      if (inspectionCreatorOpen) return closeInspectionCreator();
      if (selectedWorkUnitId) return closeModuleOverlay();
    };
  }, [
    closeCheckOverlay,
    closeInspectionCreator,
    closeModuleOverlay,
    inspectionCreatorOpen,
    mediaViewer,
    selectedCheckId,
    selectedWorkUnitId,
  ]);

  // ------------------------------------------------------------------
  // Check management (delete check, add/remove evidence)
  // ------------------------------------------------------------------

  const hasQcRole = qcSession ? QC_ACTION_ROLES.has(qcSession.role) : false;
  const hasFailedExecution =
    checkDetail?.executions.some((execution) => execution.outcome === 'Fail') ?? false;
  const checkNotes = useMemo(() => {
    if (!checkDetail) return [];
    return checkDetail.executions
      .flatMap((execution) => {
        const note = execution.notes?.trim();
        return note
          ? [
              {
                executionId: execution.id,
                note,
                outcome: execution.outcome,
                performedByUserId: execution.performed_by_user_id,
                performedAt: execution.performed_at,
              },
            ]
          : [];
      })
      .sort((a, b) => b.performedAt.localeCompare(a.performedAt));
  }, [checkDetail]);
  const hasReworkTask = (checkDetail?.rework_tasks.length ?? 0) > 0;
  const checkDeleteWindowExpired = checkDetail
    ? !isWithinDeleteWindow(checkDetail.check_instance.opened_at)
    : false;

  const checkDeleteBlockedReason = useMemo(() => {
    if (!checkDetail) return 'No hay check seleccionado.';
    if (!hasQcRole) return 'Solo personal QC puede eliminar checks.';
    if (checkDeleteWindowExpired) {
      return 'Solo se pueden eliminar checks dentro de 48 horas desde su apertura.';
    }
    if (hasFailedExecution && hasReworkTask) {
      return 'No se puede eliminar un check fallido con rework asociado.';
    }
    return null;
  }, [checkDetail, checkDeleteWindowExpired, hasQcRole, hasFailedExecution, hasReworkTask]);

  const evidenceManageBlockedReason = useMemo(() => {
    if (!checkDetail) return 'No hay check seleccionado.';
    if (!hasQcRole) return 'Solo personal QC puede gestionar evidencia.';
    if (checkDeleteWindowExpired) {
      return 'Solo se puede gestionar evidencia dentro de 48 horas desde la apertura del check.';
    }
    return null;
  }, [checkDetail, checkDeleteWindowExpired, hasQcRole]);

  const handleDeleteCheck = useCallback(async () => {
    if (!checkDetail) return;
    if (checkDeleteBlockedReason) {
      setCheckDeleteError(checkDeleteBlockedReason);
      return;
    }
    const checkName = checkDisplayName(checkDetail.check_instance);
    const confirmed = window.confirm(
      `Eliminar ${checkName}? Esta accion eliminara ejecuciones y evidencias asociadas.`
    );
    if (!confirmed) return;
    setDeletingCheck(true);
    setCheckDeleteError(null);
    try {
      await apiDeleteRequest(`/api/qc/check-instances/${checkDetail.check_instance.id}`);
      closeCheckOverlay();
      setUnitsRefreshToken((prev) => prev + 1);
      setDetailRefreshToken((prev) => prev + 1);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo eliminar la inspeccion.';
      setCheckDeleteError(message);
    } finally {
      setDeletingCheck(false);
    }
  }, [checkDeleteBlockedReason, checkDetail, closeCheckOverlay]);

  const handleDeleteEvidence = useCallback(
    async (item: QCEvidenceSummary) => {
      if (evidenceManageBlockedReason) {
        setCheckDeleteError(evidenceManageBlockedReason);
        return;
      }
      const confirmed = window.confirm(
        `Eliminar evidencia #${item.id}? Esta accion elimina el registro y el archivo.`
      );
      if (!confirmed) return;

      setDeletingEvidenceIds((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
      setCheckDeleteError(null);
      try {
        await apiDeleteRequest(`/api/qc/evidence/${item.id}`);
        const targetUri = resolveMediaUri(item.uri);
        setMediaViewer((prev) => (prev?.uri === targetUri ? null : prev));
        setCheckRefreshToken((prev) => prev + 1);
        setDetailRefreshToken((prev) => prev + 1);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'No se pudo eliminar la evidencia.';
        setCheckDeleteError(message);
      } finally {
        setDeletingEvidenceIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    },
    [evidenceManageBlockedReason]
  );

  const handleAddEvidence = useCallback(
    async (executionId: number, files: File[]) => {
      if (evidenceManageBlockedReason) {
        setCheckDeleteError(evidenceManageBlockedReason);
        return;
      }
      const acceptedFiles = files.filter(
        (file) => file.type.startsWith('image/') || file.type.startsWith('video/')
      );
      if (!acceptedFiles.length) {
        setCheckDeleteError('Seleccione imagenes o videos para adjuntar como evidencia.');
        return;
      }
      const oversized = acceptedFiles.find((file) => file.size > MAX_QC_EVIDENCE_BYTES);
      if (oversized) {
        setCheckDeleteError(
          `"${oversized.name}" excede el limite de ${MAX_QC_EVIDENCE_BYTES / (1024 * 1024)} MB.`
        );
        return;
      }

      setUploadingEvidenceExecutionIds((prev) => {
        const next = new Set(prev);
        next.add(executionId);
        return next;
      });
      setCheckDeleteError(null);
      try {
        for (const file of acceptedFiles) {
          const formData = new FormData();
          formData.append('file', file);
          const response = await fetch(`${API_BASE_URL}/api/qc/executions/${executionId}/evidence`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(parseApiErrorMessage(text) || 'No se pudo agregar la evidencia.');
          }
        }
        setCheckRefreshToken((prev) => prev + 1);
        setDetailRefreshToken((prev) => prev + 1);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'No se pudo agregar la evidencia.';
        setCheckDeleteError(message);
      } finally {
        setUploadingEvidenceExecutionIds((prev) => {
          const next = new Set(prev);
          next.delete(executionId);
          return next;
        });
      }
    },
    [evidenceManageBlockedReason]
  );

  const openMediaForEvidence = useCallback((item: QCEvidenceSummary) => {
    setMediaViewer({
      uri: resolveMediaUri(item.uri),
      mimeType: item.mime_type,
      title: `Evidencia #${item.id}`,
    });
  }, []);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const sheetHouseIdentifier =
    workUnitDetail?.house_identifier ??
    workUnits.find((unit) => unit.work_unit_id === selectedWorkUnitId)?.house_identifier ??
    null;

  const fichaHeadStamp = (() => {
    if (!checkDetail) return null;
    const executions = checkDetail.executions
      .slice()
      .sort((a, b) => a.performed_at.localeCompare(b.performed_at));
    const last = executions[executions.length - 1];
    if (last) return <OutcomeStamp outcome={last.outcome} large tilt />;
    return (
      <span
        className={clsx(
          'qcl-stamp qcl-stamp--lg qcl-stamp--tilt',
          checkStatusTone(checkDetail.check_instance.status)
        )}
      >
        {checkStatusLabel[checkDetail.check_instance.status]}
      </span>
    );
  })();

  return (
    <div className="qcl -mx-4 -my-4 min-h-[calc(100vh-72px)] bg-[var(--qcl-paper)] px-4 py-7 sm:-mx-6 sm:-my-6 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-5">
        {/* ------------------------------------------------------------ */}
        {/* Masthead: title, counters, search and filters                 */}
        {/* ------------------------------------------------------------ */}
        <header>
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div>
              <p className="qcl-eyebrow">Control de calidad · Trazabilidad</p>
              <h2 className="qcl-display mt-1.5 text-[34px] font-semibold uppercase leading-none tracking-[0.03em]">
                Biblioteca QC
              </h2>
            </div>
            <div className="flex divide-x divide-[var(--qcl-line)]">
              <Counter label="Casas" value={summaryCounts.houses} />
              <Counter label="Modulos" value={summaryCounts.modules} />
              <Counter label="Checks abiertos" value={summaryCounts.openChecks} tone="qcl-open" />
              <Counter label="Rework abierto" value={summaryCounts.openRework} tone="qcl-rework" />
            </div>
          </div>
          <div className="mt-4 h-[2px] bg-[var(--qcl-ink)]" />

          <div className="qcl-card mt-4 grid gap-2 p-3 md:grid-cols-[minmax(0,1fr)_200px_180px_auto]">
            <label className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--qcl-ink-2)]" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Buscar por casa, modulo, proyecto o tipo..."
                className="qcl-input qcl-input--search"
              />
            </label>

            <select
              className="qcl-input"
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

            <select
              className="qcl-input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="__all__">Todos los estados</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {workUnitStatusLabel(status)}
                </option>
              ))}
            </select>

            <button
              type="button"
              aria-pressed={unfulfilledOnly}
              onClick={() => setUnfulfilledOnly((prev) => !prev)}
              className={clsx('qcl-btn justify-center', unfulfilledOnly && 'qcl-btn--primary')}
            >
              Solo pendientes
            </button>
          </div>
          {unitsError ? <div className="qcl-error mt-3">{unitsError}</div> : null}
        </header>

        {/* ------------------------------------------------------------ */}
        {/* House list                                                    */}
        {/* ------------------------------------------------------------ */}
        <section className="space-y-4">
          <div className="qcl-mono px-1 text-[11px] uppercase tracking-[0.08em] text-[var(--qcl-ink-2)]">
            {loadingUnits
              ? 'Cargando modulos...'
              : `${summaryCounts.houses} casas · ${summaryCounts.modules} de ${workUnits.length} modulos cargados`}
          </div>

          {loadingUnits && !houseGroups.length ? (
            <div className="qcl-empty px-5 py-8 text-center text-sm">Cargando biblioteca...</div>
          ) : null}
          {!loadingUnits && !houseGroups.length ? (
            <div className="qcl-empty px-5 py-8 text-center text-sm">
              Sin resultados para los filtros actuales.
            </div>
          ) : null}

          {houseGroups.map((group) => (
            <article key={group.key} className="qcl-card overflow-hidden">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--qcl-line-soft)] bg-[var(--qcl-paper-2)] px-4 py-3">
                <span className="qcl-plate shrink-0">
                  {group.houseIdentifier ? `Casa ${group.houseIdentifier}` : 'Sin ID'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="qcl-display text-lg font-semibold uppercase leading-tight tracking-[0.02em]">
                    {group.projectName}
                  </div>
                  <div className="qcl-mono mt-0.5 text-[10.5px] uppercase tracking-[0.06em] text-[var(--qcl-ink-2)]">
                    {group.houseTypeName} ·{' '}
                    {group.units.length === 1 ? '1 modulo' : `${group.units.length} modulos`}
                    {group.lastOutcomeAt
                      ? ` · Ultima inspeccion ${formatDateTimeShort(group.lastOutcomeAt)}`
                      : ' · Sin inspecciones'}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {group.openChecks > 0 ? (
                    <Tag tone="qcl-open">
                      {group.openChecks}{' '}
                      {group.openChecks === 1 ? 'check abierto' : 'checks abiertos'}
                    </Tag>
                  ) : null}
                  {group.openRework > 0 ? (
                    <Tag tone="qcl-rework">{group.openRework} rework</Tag>
                  ) : null}
                  {group.openChecks === 0 && group.openRework === 0 ? (
                    <Tag tone="qcl-pass">Sin pendientes</Tag>
                  ) : null}
                </div>
              </div>

              <div className="divide-y divide-[var(--qcl-line-soft)]">
                {group.units.map((unit) => (
                  <button
                    key={unit.work_unit_id}
                    type="button"
                    onClick={() => openModuleOverlay(unit.work_unit_id)}
                    className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-[var(--qcl-paper-2)]"
                  >
                    <span className="qcl-mono w-14 shrink-0 text-[13px] font-semibold">
                      MD {unit.module_number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="text-sm font-medium">{workUnitStatusLabel(unit.status)}</span>
                        {unit.last_outcome ? (
                          <Tag tone={outcomeTone[unit.last_outcome]}>
                            {outcomeLabel[unit.last_outcome]}
                            {unit.last_outcome_at
                              ? ` · ${formatDateTimeShort(unit.last_outcome_at)}`
                              : ''}
                          </Tag>
                        ) : (
                          <span className="qcl-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--qcl-ink-2)]">
                            Sin inspecciones
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-x-4">
                      {unit.open_checks > 0 ? (
                        <Tag tone="qcl-open">{unit.open_checks} checks</Tag>
                      ) : null}
                      {unit.open_rework > 0 ? (
                        <Tag tone="qcl-rework">{unit.open_rework} rework</Tag>
                      ) : null}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--qcl-ink-2)]" />
                  </button>
                ))}
              </div>
            </article>
          ))}

          {hasMoreUnits ? (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={loadMoreUnits}
                disabled={loadingMoreUnits}
                className="qcl-btn"
              >
                {loadingMoreUnits ? `Cargando ${PAGE_SIZE}...` : `Cargar ${PAGE_SIZE} mas`}
              </button>
            </div>
          ) : null}
        </section>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* Module sheet: per-check history                               */}
      {/* ------------------------------------------------------------ */}
      {selectedWorkUnitId ? (
        <div className="qcl-overlay fixed inset-0 z-50 flex items-stretch justify-end bg-[rgba(16,23,32,0.5)] px-4 py-5">
          <div className="absolute inset-0" onClick={closeModuleOverlay} />
          <div className="qcl-sheet relative flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-md border border-[var(--qcl-line)] bg-[var(--qcl-paper)] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--qcl-ink)] bg-[var(--qcl-card)] px-5 py-4">
              <div className="min-w-0">
                <p className="qcl-eyebrow">Historial del modulo</p>
                <h3 className="qcl-display mt-1.5 text-2xl font-semibold uppercase leading-none tracking-[0.02em]">
                  {sheetHouseIdentifier ? `Casa ${sheetHouseIdentifier}` : 'Casa sin ID'} · MD{' '}
                  {workUnitDetail?.module_number ?? '...'}
                </h3>
                <div className="qcl-mono mt-2 text-[10.5px] uppercase tracking-[0.06em] text-[var(--qcl-ink-2)]">
                  {workUnitDetail
                    ? `${workUnitDetail.project_name} · ${workUnitDetail.house_type_name} · ${workUnitStatusLabel(workUnitDetail.status)}`
                    : 'Cargando...'}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {hasQcRole &&
                workUnitDetail &&
                inspectionScopeForStatus(workUnitDetail.status) ? (
                  <button
                    type="button"
                    onClick={openInspectionCreator}
                    className="qcl-btn qcl-btn--primary"
                  >
                    <Plus className="h-4 w-4" />
                    Nueva inspección
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={closeModuleOverlay}
                  className="qcl-btn qcl-btn--icon"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingDetail ? (
                <div className="px-5 py-6 text-sm text-[var(--qcl-ink-2)]">Cargando detalle...</div>
              ) : null}
              {detailError ? <div className="qcl-error mx-5 my-5">{detailError}</div> : null}

              {!loadingDetail && workUnitDetail && sheetStats ? (
                <div className="space-y-4 px-5 py-5">
                  <div className="qcl-card flex divide-x divide-[var(--qcl-line-soft)] overflow-x-auto">
                    {(
                      [
                        ['Checks', sheetStats.totalChecks, undefined],
                        ['Abiertos', sheetStats.openChecks, 'qcl-open'],
                        ['Fallas', sheetStats.fails, 'qcl-fail'],
                        ['Rework', sheetStats.openRework, 'qcl-rework'],
                        ['Evidencias', sheetStats.evidence, undefined],
                      ] as const
                    ).map(([label, value, tone]) => (
                      <div key={label} className="flex-1 px-4 py-3 text-center">
                        <div className={clsx('qcl-counter-num', value > 0 && tone ? tone : 'qcl-ink')}>
                          {value}
                        </div>
                        <div className="qcl-counter-label mt-1">{label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="qcl-seg">
                      {(
                        [
                          ['all', 'Todos'],
                          ['open', 'Abiertos'],
                          ['fail', 'Con fallas'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={sheetStatusFilter === value}
                          onClick={() => setSheetStatusFilter(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {sheetScopeOptions.panels.length ||
                    sheetScopeOptions.hasModule ||
                    sheetScopeOptions.hasAux ? (
                      <select
                        value={sheetScopeFilter}
                        onChange={(event) => setSheetScopeFilter(event.target.value)}
                        className="qcl-input qcl-input--fit ml-auto"
                      >
                        <option value="__all__">Todas las ubicaciones</option>
                        {sheetScopeOptions.hasModule ? <option value="module">Modulo</option> : null}
                        {sheetScopeOptions.hasAux ? <option value="aux">Aux</option> : null}
                        {sheetScopeOptions.panels.map((panel) => (
                          <option key={panel} value={panel}>
                            Panel {panel}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>

                  {!checkStories.length ? (
                    <div className="qcl-empty px-5 py-8 text-center text-sm">
                      No hay checks QC registrados para este modulo.
                    </div>
                  ) : null}
                  {checkStories.length && !visibleStories.length ? (
                    <div className="qcl-empty px-5 py-8 text-center text-sm">
                      Ningun check coincide con los filtros.
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    {visibleStories.map((story) => (
                      <CheckStoryCard
                        key={story.check.id}
                        story={story}
                        adminNameById={adminNameById}
                        onOpenCheck={openCheckOverlay}
                        onOpenMedia={openMediaForEvidence}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {inspectionCreatorOpen && selectedWorkUnitId ? (
        <div className="qcl-overlay fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(16,23,32,0.6)] px-4 py-6">
          <div className="absolute inset-0" onClick={closeInspectionCreator} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateInspection();
            }}
            className="qcl-modal relative flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-md border border-[var(--qcl-line)] bg-[var(--qcl-paper)] shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--qcl-ink)] bg-[var(--qcl-card)] px-5 py-4">
              <div>
                <p className="qcl-eyebrow">Inspección manual · MD {workUnitDetail?.module_number}</p>
                <h3 className="qcl-display mt-1.5 text-2xl font-semibold uppercase leading-none tracking-[0.02em]">
                  Nueva inspección
                </h3>
              </div>
              <button
                type="button"
                onClick={closeInspectionCreator}
                disabled={inspectionSubmitting}
                className="qcl-btn qcl-btn--icon"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {inspectionLoading ? (
                <div className="flex items-center gap-2 text-sm text-[var(--qcl-ink-2)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Consultando ubicación actual…
                </div>
              ) : null}

              {inspectionTarget ? (
                <div className="qcl-card grid gap-3 bg-[var(--qcl-paper-2)] p-4 sm:grid-cols-2">
                  <div>
                    <p className="qcl-eyebrow">Alcance automático</p>
                    <p className="mt-1 text-sm font-semibold">
                      {inspectionScopeForStatus(inspectionTarget.status) === 'panel'
                        ? 'Panel'
                        : 'Módulo'}
                    </p>
                  </div>
                  <div>
                    <p className="qcl-eyebrow">Ubicación actual</p>
                    <p className="mt-1 text-sm font-semibold">
                      {inspectionTarget.current_station_name ??
                        workUnitStatusLabel(inspectionTarget.status)}
                    </p>
                  </div>
                </div>
              ) : null}

              {inspectionTarget && inspectionScopeForStatus(inspectionTarget.status) === 'panel' ? (
                <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--qcl-ink-2)]">
                  Panel objetivo
                  <select
                    value={inspectionPanelId ?? ''}
                    onChange={(event) => {
                      setInspectionPanelId(Number(event.target.value) || null);
                      setInspectionDefinitionId(null);
                    }}
                    disabled={inspectionSubmitting}
                    className="qcl-input mt-1.5 w-full"
                  >
                    <option value="">Seleccionar panel…</option>
                    {inspectionTarget.panels
                      .filter((panel) => panel.panel_unit_id !== null)
                      .map((panel) => (
                        <option key={panel.panel_unit_id} value={panel.panel_unit_id ?? ''}>
                          {panel.panel_code ?? `Panel ${panel.panel_unit_id}`}
                          {panel.current_station_name ? ` · ${panel.current_station_name}` : ''}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}

              {inspectionTarget ? (
                <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--qcl-ink-2)]">
                  Pauta manual aplicable
                  <select
                    value={inspectionDefinitionId ?? ''}
                    onChange={(event) =>
                      setInspectionDefinitionId(Number(event.target.value) || null)
                    }
                    disabled={
                      inspectionSubmitting ||
                      inspectionOptionsLoading ||
                      (inspectionScopeForStatus(inspectionTarget.status) === 'panel' &&
                        !inspectionPanelId)
                    }
                    className="qcl-input mt-1.5 w-full"
                  >
                    <option value="">
                      {inspectionOptionsLoading ? 'Cargando pautas…' : 'Seleccionar pauta…'}
                    </option>
                    {inspectionOptions.map((option) => (
                      <option
                        key={option.id}
                        value={option.id}
                        disabled={option.has_open_instance}
                      >
                        {option.name}{option.has_open_instance ? ' · Ya abierta' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {inspectionTarget &&
              !inspectionOptionsLoading &&
              (inspectionScopeForStatus(inspectionTarget.status) !== 'panel' || inspectionPanelId) &&
              inspectionOptions.length === 0 ? (
                <div className="qcl-empty px-4 py-4 text-sm">
                  No hay pautas manuales aplicables para este objetivo.
                </div>
              ) : null}

              {inspectionDefinitionId ? (
                <p className="text-sm text-[var(--qcl-ink-2)]">
                  {inspectionOptions.find((option) => option.id === inspectionDefinitionId)
                    ?.guidance_text ??
                    'La pauta se abrirá directamente en la pantalla de ejecución.'}
                </p>
              ) : null}

              {inspectionError ? <div className="qcl-error">{inspectionError}</div> : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--qcl-line)] bg-[var(--qcl-paper-2)] px-5 py-4">
              <button
                type="button"
                onClick={closeInspectionCreator}
                disabled={inspectionSubmitting}
                className="qcl-btn"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={
                  inspectionLoading ||
                  inspectionOptionsLoading ||
                  inspectionSubmitting ||
                  !inspectionDefinitionId ||
                  !inspectionTarget ||
                  (inspectionScopeForStatus(inspectionTarget.status) === 'panel' &&
                    !inspectionPanelId)
                }
                className="qcl-btn qcl-btn--primary"
              >
                {inspectionSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {inspectionSubmitting ? 'Iniciando…' : 'Iniciar inspección'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* ------------------------------------------------------------ */}
      {/* Check modal: full record + evidence management                */}
      {/* ------------------------------------------------------------ */}
      {selectedCheckId ? (
        <div className="qcl-overlay fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(16,23,32,0.6)] px-4 py-6">
          <div className="absolute inset-0" onClick={closeCheckOverlay} />
          <div className="qcl-modal relative max-h-full w-full max-w-3xl overflow-hidden rounded-md border border-[var(--qcl-line)] bg-[var(--qcl-paper)] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--qcl-ink)] bg-[var(--qcl-card)] px-5 py-4">
              <div className="min-w-0">
                <p className="qcl-eyebrow">Ficha de inspeccion · N° {selectedCheckId}</p>
                <h3 className="qcl-display mt-1.5 text-2xl font-semibold uppercase leading-none tracking-[0.02em]">
                  {checkDetail
                    ? checkDisplayName(checkDetail.check_instance)
                    : `Check #${selectedCheckId}`}
                </h3>
                {checkDetail ? (
                  <>
                    <div className="qcl-mono mt-2 text-[10.5px] uppercase tracking-[0.06em] text-[var(--qcl-ink-2)]">
                      MD {checkDetail.check_instance.module_number}
                      {checkDetail.check_instance.panel_code
                        ? ` · Panel ${checkDetail.check_instance.panel_code}`
                        : ` · ${scopeLabel[checkDetail.check_instance.scope]}`}
                      {checkDetail.check_instance.station_name
                        ? ` · ${checkDetail.check_instance.station_name}`
                        : ''}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <Tag tone={checkStatusTone(checkDetail.check_instance.status)}>
                        {checkStatusLabel[checkDetail.check_instance.status]}
                      </Tag>
                      {checkNotes.length ? (
                        <span className="qcl-note-indicator">
                          <MessageSquareText className="h-3.5 w-3.5" />
                          {checkNotes.length} {checkNotes.length === 1 ? 'nota' : 'notas'}
                        </span>
                      ) : null}
                      {checkDetail.check_instance.severity_level ? (
                        <Tag tone={severityTone[checkDetail.check_instance.severity_level]}>
                          {severityLabel[checkDetail.check_instance.severity_level]}
                        </Tag>
                      ) : null}
                      <Tag tone="qcl-neutral">
                        {checkDetail.check_instance.origin === 'triggered'
                          ? 'Origen: trigger'
                          : `Origen: ${manualSubtypeLabel(checkDetail.check_instance) ?? 'manual'}`}
                      </Tag>
                      <span className="qcl-mono text-[10.5px] uppercase tracking-[0.06em] text-[var(--qcl-ink-2)]">
                        Abierto {formatDateTimeShort(checkDetail.check_instance.opened_at)}
                        {checkDetail.check_instance.closed_at
                          ? ` · Cerrado ${formatDateTimeShort(checkDetail.check_instance.closed_at)}`
                          : ''}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {fichaHeadStamp}
                <button
                  type="button"
                  onClick={closeCheckOverlay}
                  className="qcl-btn qcl-btn--icon"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="max-h-[calc(100vh-14rem)] overflow-y-auto px-5 py-5">
              {loadingCheckDetail ? (
                <div className="text-sm text-[var(--qcl-ink-2)]">Cargando inspeccion...</div>
              ) : null}
              {checkDetailError ? <div className="qcl-error">{checkDetailError}</div> : null}
              {checkDeleteError ? <div className="qcl-error mt-3">{checkDeleteError}</div> : null}

              {!loadingCheckDetail && checkDetail ? (
                <div className="space-y-5">
                  <section className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/qc/execute?check=${checkDetail.check_instance.id}`}
                      className="qcl-btn qcl-btn--primary"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      Abrir ejecucion
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleDeleteCheck()}
                      disabled={Boolean(checkDeleteBlockedReason) || deletingCheck}
                      className="qcl-btn qcl-btn--danger"
                    >
                      <Trash2 className="h-4 w-4" />
                      {deletingCheck ? 'Eliminando...' : 'Eliminar check'}
                    </button>
                    {checkDeleteBlockedReason ? (
                      <span className="text-xs text-[var(--qcl-ink-2)]">
                        {checkDeleteBlockedReason}
                      </span>
                    ) : null}
                  </section>

                  {checkNotes.length ? (
                    <section className="qcl-card overflow-hidden">
                      <div className="flex items-center gap-2 border-b border-[var(--qcl-line-soft)] bg-[var(--qcl-paper-2)] px-4 py-3">
                        <MessageSquareText className="h-4 w-4 text-[var(--qcl-open)]" />
                        <h4 className="qcl-h">Notas del check ({checkNotes.length})</h4>
                      </div>
                      <div className="divide-y divide-[var(--qcl-line-soft)]">
                        {checkNotes.map((item) => (
                          <div key={item.executionId} className="px-4 py-3.5">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <OutcomeStamp outcome={item.outcome} />
                              <span className="text-xs text-[var(--qcl-ink-2)]">
                                {adminNameById.get(item.performedByUserId) ??
                                  `Usuario #${item.performedByUserId}`}
                              </span>
                              <span className="qcl-mono text-[11px] text-[var(--qcl-ink-2)]">
                                {formatDateTimeShort(item.performedAt)}
                              </span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
                              {item.note}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {checkDetail.trigger_task ? (
                    <section className="qcl-card p-4">
                      <p className="qcl-eyebrow">Tarea verificada (origen)</p>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div>
                          <div className="text-sm font-semibold">
                            {checkDetail.trigger_task.task_name}
                          </div>
                          <div className="qcl-mono mt-1 text-[10.5px] uppercase tracking-[0.06em] text-[var(--qcl-ink-2)]">
                            {checkDetail.trigger_task.station_name ?? 'Sin estacion'} ·{' '}
                            {checkDetail.trigger_task.completed_at
                              ? `Completada ${formatDateTimeShort(checkDetail.trigger_task.completed_at)}`
                              : taskStatusLabel[checkDetail.trigger_task.status]}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold">Realizada por</div>
                          <div className="mt-1 text-sm text-[var(--qcl-ink-2)]">
                            {checkDetail.trigger_task.workers.length
                              ? checkDetail.trigger_task.workers.map((w) => w.worker_name).join(', ')
                              : '-'}
                          </div>
                        </div>
                      </div>
                    </section>
                  ) : null}

                  <section className="qcl-card overflow-hidden">
                    <div className="border-b border-[var(--qcl-line-soft)] px-4 py-3">
                      <h4 className="qcl-h">Ejecuciones ({checkDetail.executions.length})</h4>
                    </div>
                    <div className="divide-y divide-[var(--qcl-line-soft)]">
                      {!checkDetail.executions.length ? (
                        <div className="px-4 py-6 text-sm text-[var(--qcl-ink-2)]">
                          Sin ejecuciones registradas.
                        </div>
                      ) : null}
                      {checkDetail.executions
                        .slice()
                        .sort((a, b) => a.performed_at.localeCompare(b.performed_at))
                        .map((exec, index) => {
                          const evidence = checkDetail.evidence.filter(
                            (item) => item.execution_id === exec.id
                          );
                          return (
                            <div key={exec.id} className="px-4 py-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                    <span className="qcl-eyebrow">Ejecucion {index + 1}</span>
                                    <OutcomeStamp outcome={exec.outcome} />
                                    <span className="qcl-mono text-[11px] text-[var(--qcl-ink-2)]">
                                      {formatDateTimeShort(exec.performed_at)}
                                    </span>
                                  </div>
                                  <div className="mt-2 text-xs text-[var(--qcl-ink-2)]">
                                    QC:{' '}
                                    {adminNameById.get(exec.performed_by_user_id) ??
                                      `Usuario #${exec.performed_by_user_id}`}
                                  </div>
                                  {exec.notes?.trim() ? (
                                    <div className="qcl-note mt-3">
                                      <div className="qcl-note__label">
                                        <MessageSquareText className="h-3.5 w-3.5" />
                                        Nota
                                      </div>
                                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                                        {exec.notes.trim()}
                                      </p>
                                    </div>
                                  ) : null}
                                  {exec.failure_modes.length ? (
                                    <div className="mt-2 text-xs text-[var(--qcl-ink-2)]">
                                      Fallas:{' '}
                                      <span className="font-medium text-[var(--qcl-ink)]">
                                        {exec.failure_modes
                                          .map(
                                            (mode) =>
                                              mode.failure_mode_name ?? mode.other_text ?? 'Otro'
                                          )
                                          .join(', ')}
                                      </span>
                                    </div>
                                  ) : null}
                                </div>
                                <div className="qcl-mono text-[11px] text-[var(--qcl-ink-2)]">
                                  #{exec.id}
                                </div>
                              </div>

                              <div className="mt-4">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                  <div className="qcl-mono text-[10.5px] font-semibold uppercase tracking-[0.08em]">
                                    Evidencia ({evidence.length})
                                  </div>
                                  <label
                                    className={clsx(
                                      'qcl-btn qcl-btn--sm',
                                      evidenceManageBlockedReason
                                        ? 'cursor-not-allowed opacity-50'
                                        : 'cursor-pointer'
                                    )}
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    {uploadingEvidenceExecutionIds.has(exec.id)
                                      ? 'Subiendo...'
                                      : 'Agregar desde galeria'}
                                    <input
                                      type="file"
                                      accept="image/*,video/*"
                                      multiple
                                      className="hidden"
                                      disabled={
                                        Boolean(evidenceManageBlockedReason) ||
                                        uploadingEvidenceExecutionIds.has(exec.id)
                                      }
                                      onChange={(event) => {
                                        const files = event.target.files
                                          ? Array.from(event.target.files)
                                          : [];
                                        event.target.value = '';
                                        void handleAddEvidence(exec.id, files);
                                      }}
                                    />
                                  </label>
                                </div>
                                {evidenceManageBlockedReason ? (
                                  <div className="mb-2 text-xs text-[var(--qcl-ink-2)]">
                                    {evidenceManageBlockedReason}
                                  </div>
                                ) : null}
                                {evidence.length ? (
                                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                                    {evidence.map((item) => {
                                      const isDeletingEvidence = deletingEvidenceIds.has(item.id);
                                      return (
                                        <div key={item.id} className="relative">
                                          <EvidenceThumb
                                            item={item}
                                            onOpen={openMediaForEvidence}
                                            className="h-28 w-full"
                                          />
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.preventDefault();
                                              event.stopPropagation();
                                              void handleDeleteEvidence(item);
                                            }}
                                            disabled={
                                              Boolean(evidenceManageBlockedReason) ||
                                              isDeletingEvidence
                                            }
                                            className="absolute right-1.5 top-1.5 inline-flex items-center justify-center rounded-[3px] border border-[var(--qcl-fail)] bg-white/95 p-1 text-[var(--qcl-fail)] shadow-sm transition hover:bg-[var(--qcl-fail-tint)] disabled:cursor-not-allowed disabled:opacity-50"
                                            aria-label={`Eliminar evidencia ${item.id}`}
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                          <div className="qcl-mono pointer-events-none absolute inset-x-0 bottom-0 bg-[rgba(16,23,32,0.55)] px-2 py-1 text-[10px] text-white">
                                            {isDeletingEvidence
                                              ? 'Eliminando...'
                                              : formatDateTimeShort(item.captured_at)}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="qcl-empty px-4 py-5 text-sm">
                                    Sin evidencia registrada para esta ejecucion.
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </section>

                  <section className="qcl-card overflow-hidden">
                    <div className="border-b border-[var(--qcl-line-soft)] px-4 py-3">
                      <h4 className="qcl-h">Rework ({checkDetail.rework_tasks.length})</h4>
                    </div>
                    <div className="divide-y divide-[var(--qcl-line-soft)]">
                      {!checkDetail.rework_tasks.length ? (
                        <div className="px-4 py-6 text-sm text-[var(--qcl-ink-2)]">
                          Sin rework asociado.
                        </div>
                      ) : null}
                      {checkDetail.rework_tasks.map((rework) => {
                        const attempts = checkDetail.rework_attempts
                          .filter((attempt) => attempt.rework_task_id === rework.id)
                          .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));
                        return (
                          <div key={rework.id} className="px-4 py-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                  <Tag tone="qcl-rework">{reworkStatusLabel[rework.status]}</Tag>
                                  <span className="qcl-mono text-[11px] text-[var(--qcl-ink-2)]">
                                    {formatDateTimeShort(rework.created_at)}
                                  </span>
                                  {rework.task_status ? (
                                    <Tag tone="qcl-neutral">
                                      {taskStatusLabel[rework.task_status]}
                                    </Tag>
                                  ) : null}
                                </div>
                                <div className="mt-2 text-sm">{rework.description}</div>
                              </div>
                              <div className="qcl-mono text-[11px] text-[var(--qcl-ink-2)]">
                                #{rework.id}
                              </div>
                            </div>

                            {attempts.length ? (
                              <div className="mt-4 space-y-2">
                                <div className="qcl-mono text-[10.5px] font-semibold uppercase tracking-[0.08em]">
                                  Intentos ({attempts.length})
                                </div>
                                {attempts.map((attempt) => (
                                  <div
                                    key={attempt.task_instance_id}
                                    className="rounded-[4px] border border-[var(--qcl-line-soft)] bg-[var(--qcl-paper-2)] px-3 py-2.5 text-sm"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="text-sm font-semibold">
                                        {attempt.station_name ?? 'Sin estacion'} ·{' '}
                                        {taskStatusLabel[attempt.status]}
                                      </div>
                                      <div className="qcl-mono text-[11px] text-[var(--qcl-ink-2)]">
                                        #{attempt.task_instance_id}
                                      </div>
                                    </div>
                                    <div className="qcl-mono mt-1 text-[11px] text-[var(--qcl-ink-2)]">
                                      {attempt.started_at
                                        ? formatDateTimeShort(attempt.started_at)
                                        : '-'}
                                      {attempt.completed_at
                                        ? ` → ${formatDateTimeShort(attempt.completed_at)}`
                                        : ''}
                                    </div>
                                    <div className="mt-1.5 text-xs text-[var(--qcl-ink-2)]">
                                      Workers:{' '}
                                      <span className="font-medium text-[var(--qcl-ink)]">
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

      {/* ------------------------------------------------------------ */}
      {/* Media viewer                                                  */}
      {/* ------------------------------------------------------------ */}
      {mediaViewer ? (
        <div className="qcl-overlay fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(16,23,32,0.75)] px-4 py-6">
          <div className="absolute inset-0" onClick={() => setMediaViewer(null)} />
          <div className="qcl-modal relative w-full max-w-5xl overflow-hidden rounded-md border border-[var(--qcl-line)] bg-[var(--qcl-card)] shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--qcl-line-soft)] px-5 py-3">
              <div className="qcl-mono min-w-0 truncate text-[12px] font-semibold uppercase tracking-[0.08em]">
                {mediaViewer.title}
              </div>
              <button
                type="button"
                onClick={() => setMediaViewer(null)}
                className="qcl-btn qcl-btn--icon"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="bg-[var(--qcl-paper)] p-4">
              {mediaViewer.mimeType?.startsWith('video/') ? (
                <video
                  src={mediaViewer.uri}
                  controls
                  className="max-h-[75vh] w-full rounded-[4px] bg-black"
                />
              ) : (
                <img
                  src={mediaViewer.uri}
                  alt={mediaViewer.title}
                  className="max-h-[75vh] w-full object-contain"
                />
              )}
              <div className="mt-3 flex justify-end">
                <a
                  href={mediaViewer.uri}
                  target="_blank"
                  rel="noreferrer"
                  className="qcl-btn qcl-btn--sm"
                >
                  <ExternalLink className="h-4 w-4" />
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
