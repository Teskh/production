import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  LogIn,
  LogOut,
  MessageSquare,
  Send,
  Wrench,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import QCPhotoCaptureButton from '../components/QCPhotoCaptureButton';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const REFRESH_INTERVAL_MS = 30000;

type Station = {
  id: number;
  name: string;
  role: string;
  line_type: string | null;
  sequence_order: number | null;
};

type StationWorkItem = {
  id: string;
  work_unit_id: number;
  project_name: string;
  house_identifier: string;
  house_type_name: string;
  module_number: number;
  panel_code: string | null;
  status: string;
};

type StationSnapshot = {
  station: Station;
  work_items: StationWorkItem[];
};

type QCCheckInstanceSummary = {
  id: number;
  check_name: string | null;
  work_unit_id: number;
  station_name: string | null;
  current_station_name: string | null;
  module_number: number;
  project_name: string | null;
  house_type_name: string | null;
  house_identifier: string | null;
  panel_code: string | null;
  status: 'Open' | 'Closed';
  severity_level: 'baja' | 'media' | 'critica' | null;
  opened_at: string;
};

type QCReworkTaskSummary = {
  id: number;
  check_instance_id: number;
  description: string;
  status: 'Open' | 'InProgress' | 'Done' | 'Canceled';
  check_status: 'Open' | 'Closed' | null;
  severity_level: 'baja' | 'media' | 'critica' | null;
  task_status: string | null;
  work_unit_id: number;
  station_name: string | null;
  current_station_name: string | null;
  module_number: number;
  project_name: string | null;
  house_type_name: string | null;
  house_identifier: string | null;
  panel_code: string | null;
  created_at: string;
};

type QCDashboardResponse = {
  pending_checks: QCCheckInstanceSummary[];
  rework_tasks: QCReworkTaskSummary[];
};

type SupervisorSummary = {
  id: number;
  first_name: string;
  last_name: string;
};

type SupervisorSession = {
  supervisor: SupervisorSummary;
  pending_protocol_count: number;
};

type QCComplaintSupervisor = {
  id: number;
  first_name: string;
  last_name: string;
};

type QCComplaintSummary = {
  id: number;
  work_unit_id: number;
  title: string;
  description: string;
  severity_level: 'baja' | 'media' | 'critica';
  status: 'Open' | 'ClosureProposed' | 'Closed';
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  module_number: number;
  house_identifier: string | null;
  project_name: string;
  house_type_name: string;
  panel_code: string | null;
  supervisors: QCComplaintSupervisor[];
};

type QCComplaintMedia = {
  id: number;
  event_id: number | null;
  media_asset_id: number;
  role: string;
  uri: string;
  mime_type: string;
  created_at: string;
};

type QCComplaintEvent = {
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
  media: QCComplaintMedia[];
};

type QCComplaintDetail = QCComplaintSummary & {
  events: QCComplaintEvent[];
};

type QCExecutionFailureModeRead = {
  id: number;
  failure_mode_definition_id: number | null;
  failure_mode_name: string | null;
  other_text: string | null;
  measurement_json: Record<string, unknown> | null;
  notes: string | null;
};

type QCExecutionRead = {
  id: number;
  check_instance_id: number;
  outcome: 'Pass' | 'Fail' | 'Blocked';
  notes: string | null;
  performed_by_user_id: number;
  performed_at: string;
  failure_modes: QCExecutionFailureModeRead[];
};

type QCCheckMediaSummary = {
  id: number;
  media_type: string;
  uri: string;
  created_at: string | null;
};

type QCEvidenceSummary = {
  id: number;
  execution_id: number;
  media_asset_id: number;
  uri: string;
  mime_type: string | null;
  captured_at: string;
};

type QCCheckInstanceDetail = {
  check_instance: QCCheckInstanceSummary;
  check_definition: {
    id: number;
    name: string;
    guidance_text: string | null;
    category_id: number | null;
  } | null;
  media_assets: QCCheckMediaSummary[];
  executions: QCExecutionRead[];
  evidence: QCEvidenceSummary[];
};

type AlertModalState = {
  kind: 'reworks' | 'complaints' | 'failedChecks';
  workItem: StationWorkItem;
} | null;

type MediaPreview = {
  uri: string;
  mime_type?: string | null;
} | null;

const getStationInitials = (name: string): string => {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  const stationMatch = normalized.match(/^estacion\s*(\d+)$/i);
  if (stationMatch) {
    return `E${stationMatch[1]}`;
  }
  const tokens = normalized.match(/[a-zA-Z]+|\d+/g) ?? [];
  return tokens
    .map((token) => (/^\d+$/.test(token) ? token : token[0]))
    .join('')
    .toUpperCase();
};

const isMagazineStatus = (value: string): boolean =>
  value.trim().toLowerCase() === 'magazine';

const fullName = (person: SupervisorSummary): string =>
  `${person.first_name} ${person.last_name}`.trim();

const supervisorDisplayName = (person: QCComplaintSupervisor): string =>
  `${person.first_name} ${person.last_name}`.trim();

const formatTimestamp = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const resolveMediaUri = (uri: string): string => {
  if (!uri) return uri;
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  if (uri.startsWith('/')) return `${API_BASE_URL}${uri}`;
  return `${API_BASE_URL}/${uri}`;
};

const severityLabel = (value: 'baja' | 'media' | 'critica' | null | undefined): string => {
  if (value === 'critica') return 'Critica';
  if (value === 'media') return 'Media';
  if (value === 'baja') return 'Baja';
  return 'Sin severidad';
};

const severityTextClass = (value: 'baja' | 'media' | 'critica' | null | undefined): string => {
  if (value === 'critica') return 'text-red-600 hover:text-red-800';
  if (value === 'media') return 'text-orange-500 hover:text-orange-700';
  if (value === 'baja') return 'text-slate-500 hover:text-slate-700';
  return 'text-amber-500 hover:text-amber-700';
};

const severityBadgeClass = (value: 'baja' | 'media' | 'critica' | null | undefined): string => {
  if (value === 'critica') return 'bg-red-100 text-red-700';
  if (value === 'media') return 'bg-amber-100 text-amber-700';
  if (value === 'baja') return 'bg-slate-100 text-slate-700';
  return 'bg-gray-100 text-gray-600';
};

const complaintStatusLabel = (value: QCComplaintSummary['status']): string => {
  if (value === 'ClosureProposed') return 'Cierre propuesto';
  if (value === 'Closed') return 'Cerrada';
  return 'Abierta';
};

const complaintEventLabel = (value: QCComplaintEvent['event_type']): string => {
  if (value === 'created') return 'Creo la observacion';
  if (value === 'closure_proposed') return 'Propuso cierre';
  if (value === 'closure_accepted') return 'Acepto cierre';
  if (value === 'closure_rejected') return 'Rechazo cierre';
  if (value === 'media_added') return 'Agrego evidencia';
  return 'Comento';
};

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

const PanelLineSupervisorView: React.FC = () => {
  const navigate = useNavigate();
  const [stations, setStations] = useState<Station[]>([]);
  const [snapshots, setSnapshots] = useState<Record<number, StationSnapshot>>({});
  const [qcDashboard, setQcDashboard] = useState<QCDashboardResponse>({
    pending_checks: [],
    rework_tasks: [],
  });
  const [complaints, setComplaints] = useState<QCComplaintSummary[]>([]);
  const [supervisors, setSupervisors] = useState<SupervisorSummary[]>([]);
  const [supervisorSession, setSupervisorSession] = useState<SupervisorSession | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginSupervisorId, setLoginSupervisorId] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [alertModal, setAlertModal] = useState<AlertModalState>(null);
  const [checkDetails, setCheckDetails] = useState<Record<number, QCCheckInstanceDetail>>({});
  const [loadingCheckIds, setLoadingCheckIds] = useState<Set<number>>(new Set());
  const [checkDetailError, setCheckDetailError] = useState<string | null>(null);
  const [complaintDetails, setComplaintDetails] = useState<Record<number, QCComplaintDetail>>({});
  const [loadingComplaintIds, setLoadingComplaintIds] = useState<Set<number>>(new Set());
  const [complaintDetailError, setComplaintDetailError] = useState<string | null>(null);
  const [complaintDrafts, setComplaintDrafts] = useState<Record<number, string>>({});
  const [complaintFiles, setComplaintFiles] = useState<Record<number, File[]>>({});
  const [closureProposalIds, setClosureProposalIds] = useState<Set<number>>(new Set());
  const [submittingComplaintIds, setSubmittingComplaintIds] = useState<Set<number>>(new Set());
  const [proposingClosureIds, setProposingClosureIds] = useState<Set<number>>(new Set());
  const [mediaPreview, setMediaPreview] = useState<MediaPreview>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'paneles' | 'armado'>('paneles');

  useEffect(() => {
    let isMounted = true;
    let isFetching = false;
    let cachedStations: Station[] | null = null;
    const fetchData = async () => {
      if (isFetching) {
        return;
      }
      isFetching = true;
      try {
        let stationsData = cachedStations;
        const dashboardPromise = fetch(`${API_BASE_URL}/api/qc/dashboard`, { credentials: 'include' });
        if (!stationsData) {
          const stationsRes = await fetch(`${API_BASE_URL}/api/stations`, { credentials: 'include' });
          if (!stationsRes.ok) {
            throw new Error('No se pudieron cargar las estaciones.');
          }
          stationsData = await stationsRes.json() as Station[];
          cachedStations = stationsData;
          if (isMounted) {
            setStations(stationsData);
          }
        }

        const qcDashboardRes = await dashboardPromise;
        if (qcDashboardRes.ok && isMounted) {
          setQcDashboard(await qcDashboardRes.json() as QCDashboardResponse);
        }

        const snapshotMap: Record<number, StationSnapshot> = {};
        await Promise.all(
          stationsData.map(async (station) => {
            try {
              const res = await fetch(`${API_BASE_URL}/api/worker-stations/${station.id}/snapshot?planned_limit=1`, { credentials: 'include' });
              if (res.ok) {
                snapshotMap[station.id] = await res.json() as StationSnapshot;
              }
            } catch {
              // Ignore individual station errors
            }
          })
        );

        if (isMounted) {
          setSnapshots(snapshotMap);
        }

      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Error desconocido.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
        isFetching = false;
      }
    };
    fetchData();
    const intervalId = window.setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadSupervisorChrome = async () => {
      try {
        const [supervisorsRes, sessionRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/workers/supervisors`, { credentials: 'include' }),
          fetch(`${API_BASE_URL}/api/protocols/supervisor/session`, { credentials: 'include' }),
        ]);
        if (!isMounted) {
          return;
        }
        if (supervisorsRes.ok) {
          setSupervisors(await supervisorsRes.json() as SupervisorSummary[]);
        }
        if (sessionRes.ok) {
          setSupervisorSession(await sessionRes.json() as SupervisorSession | null);
        } else if (sessionRes.status === 401) {
          setSupervisorSession(null);
        }
      } catch {
        if (isMounted) {
          setSupervisorSession(null);
        }
      }
    };
    void loadSupervisorChrome();
    const intervalId = window.setInterval(loadSupervisorChrome, REFRESH_INTERVAL_MS);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadComplaints = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/qc/complaints`, {
          credentials: 'include',
        });
        if (!isMounted) {
          return;
        }
        if (response.ok) {
          setComplaints(await response.json() as QCComplaintSummary[]);
        }
      } catch {
        if (isMounted) {
          setComplaints([]);
        }
      }
    };
    void loadComplaints();
    const intervalId = window.setInterval(loadComplaints, REFRESH_INTERVAL_MS);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const visibleStations = useMemo(() => {
    if (activeTab === 'paneles') {
      return stations
        .filter((s) => s.role === 'Panels')
        .sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0));
    }
    return stations
      .filter((s) => s.role === 'Assembly')
      .sort((a, b) => {
        const sequenceA = a.sequence_order ?? Number.POSITIVE_INFINITY;
        const sequenceB = b.sequence_order ?? Number.POSITIVE_INFINITY;
        if (sequenceA !== sequenceB) {
          return sequenceA - sequenceB;
        }
        const lineA = a.line_type ?? '';
        const lineB = b.line_type ?? '';
        return lineA.localeCompare(lineB);
      });
  }, [stations, activeTab]);

  const assemblyGrid = useMemo(() => {
    if (activeTab !== 'armado') return null;

    const lines = Array.from(new Set(visibleStations.map(s => s.line_type || ''))).filter(Boolean).sort();
    const sequences = Array.from(new Set(visibleStations.map(s => s.sequence_order ?? 0))).sort((a, b) => a - b);

    const rows = sequences.map(seq => {
      const rowStations = lines.map(line => {
        return visibleStations.find(s => s.sequence_order === seq && s.line_type === line) || null;
      });
      return { sequence: seq, stations: rowStations };
    });

    return { lines, rows };
  }, [visibleStations, activeTab]);

  const formatProjectInitials = (name: string) => {
    if (!name) return '';
    return name
      .split(/\s+/)
      .map(word => word[0])
      .join('')
      .substring(0, 5)
      .toUpperCase();
  };

  const isComplaintAssignedToCurrentSupervisor = useCallback(
    (complaint: QCComplaintSummary): boolean =>
      Boolean(
        supervisorSession &&
          complaint.supervisors.some((supervisor) => supervisor.id === supervisorSession.supervisor.id)
      ),
    [supervisorSession]
  );

  const alertsByWorkUnit = useMemo(() => {
    const alerts = new Map<
      number,
      {
        failedChecks: number;
        reworks: number;
        complaints: number;
        assignedComplaints: number;
        maxComplaintSeverity: 'baja' | 'media' | 'critica' | null;
        maxCheckSeverity: 'baja' | 'media' | 'critica' | null;
      }
    >();
    const ensureEntry = (workUnitId: number) => {
      const existing = alerts.get(workUnitId);
      if (existing) {
        return existing;
      }
      const next: {
        failedChecks: number;
        reworks: number;
        complaints: number;
        assignedComplaints: number;
        maxComplaintSeverity: 'baja' | 'media' | 'critica' | null;
        maxCheckSeverity: 'baja' | 'media' | 'critica' | null;
      } = {
        failedChecks: 0,
        reworks: 0,
        complaints: 0,
        assignedComplaints: 0,
        maxComplaintSeverity: null,
        maxCheckSeverity: null,
      };
      alerts.set(workUnitId, next);
      return next;
    };
    const severityWeights = { baja: 1, media: 2, critica: 3 };
    const applyCheckSeverity = (
      entry: ReturnType<typeof ensureEntry>,
      severity: 'baja' | 'media' | 'critica' | null
    ) => {
      const currentWeight = entry.maxCheckSeverity ? severityWeights[entry.maxCheckSeverity] : 0;
      const newWeight = severity ? severityWeights[severity] : 0;
      if (newWeight > currentWeight) {
        entry.maxCheckSeverity = severity;
      }
    };

    qcDashboard.rework_tasks
      .filter((task) => task.status === 'Open' || task.status === 'InProgress')
      .forEach((task) => {
        const entry = ensureEntry(task.work_unit_id);
        entry.reworks += 1;
        applyCheckSeverity(entry, task.severity_level);
      });
    qcDashboard.rework_tasks
      .filter((task) => task.status === 'Done' && task.check_status === 'Open')
      .forEach((task) => {
        const entry = ensureEntry(task.work_unit_id);
        entry.failedChecks += 1;
        applyCheckSeverity(entry, task.severity_level);
      });
    complaints
      .filter((complaint) => complaint.status !== 'Closed')
      .forEach((complaint) => {
        const entry = ensureEntry(complaint.work_unit_id);
        entry.complaints += 1;
        if (isComplaintAssignedToCurrentSupervisor(complaint)) {
          entry.assignedComplaints += 1;
        }
        
        const currentWeight = entry.maxComplaintSeverity ? severityWeights[entry.maxComplaintSeverity] : 0;
        const newWeight = severityWeights[complaint.severity_level] || 0;
        
        if (newWeight > currentWeight) {
          entry.maxComplaintSeverity = complaint.severity_level;
        }
      });

    return alerts;
  }, [complaints, isComplaintAssignedToCurrentSupervisor, qcDashboard.rework_tasks]);

  const selectedAlertDetails = useMemo(() => {
    if (!alertModal) {
      return null;
    }
    const workUnitId = alertModal.workItem.work_unit_id;
    if (alertModal.kind === 'reworks') {
      return {
        title: 'Re-trabajos abiertos',
        items: qcDashboard.rework_tasks.filter(
          (task) =>
            task.work_unit_id === workUnitId &&
            (task.status === 'Open' || task.status === 'InProgress')
        ),
      };
    }
    if (alertModal.kind === 'failedChecks') {
      return {
        title: 'Checks fallidos',
        items: qcDashboard.rework_tasks.filter(
          (task) =>
            task.work_unit_id === workUnitId &&
            task.status === 'Done' &&
            task.check_status === 'Open'
        ),
      };
    }
    return {
      title: 'Observaciones abiertas',
      items: complaints.filter(
        (complaint) => complaint.work_unit_id === workUnitId && complaint.status !== 'Closed'
      ),
    };
  }, [alertModal, complaints, qcDashboard.rework_tasks]);

  useEffect(() => {
    if (!alertModal || alertModal.kind === 'complaints' || !selectedAlertDetails) {
      return;
    }
    const checkIds = Array.from(
      new Set(
        (selectedAlertDetails.items as QCReworkTaskSummary[])
          .map((task) => task.check_instance_id)
          .filter((id) => !checkDetails[id])
      )
    );
    if (!checkIds.length) {
      return;
    }
    let isMounted = true;
    setCheckDetailError(null);
    setLoadingCheckIds((current) => {
      const next = new Set(current);
      checkIds.forEach((id) => next.add(id));
      return next;
    });
    void Promise.all(
      checkIds.map(async (checkId) => {
        const response = await fetch(`${API_BASE_URL}/api/qc/check-instances/${checkId}`, {
          credentials: 'include',
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `No se pudo cargar check #${checkId}.`);
        }
        return [checkId, await response.json() as QCCheckInstanceDetail] as const;
      })
    )
      .then((entries) => {
        if (!isMounted) return;
        setCheckDetails((current) => {
          const next = { ...current };
          entries.forEach(([checkId, detail]) => {
            next[checkId] = detail;
          });
          return next;
        });
      })
      .catch((err) => {
        if (isMounted) {
          setCheckDetailError(
            err instanceof Error ? err.message : 'No se pudieron cargar detalles QC.'
          );
        }
      })
      .finally(() => {
        if (!isMounted) return;
        setLoadingCheckIds((current) => {
          const next = new Set(current);
          checkIds.forEach((id) => next.delete(id));
          return next;
        });
      });
    return () => {
      isMounted = false;
    };
  }, [alertModal, checkDetails, selectedAlertDetails]);

  useEffect(() => {
    if (!alertModal || alertModal.kind !== 'complaints' || !selectedAlertDetails) {
      return;
    }
      const complaintIds = Array.from(
      new Set(
        (selectedAlertDetails.items as QCComplaintSummary[])
          .map((complaint) => complaint.id)
          .filter((id) => !complaintDetails[id])
      )
    );
    if (!complaintIds.length) {
      return;
    }
    let isMounted = true;
    setComplaintDetailError(null);
    setLoadingComplaintIds((current) => {
      const next = new Set(current);
      complaintIds.forEach((id) => next.add(id));
      return next;
    });
    void Promise.all(
      complaintIds.map(async (complaintId) => {
        const summary = (selectedAlertDetails.items as QCComplaintSummary[]).find(
          (complaint) => complaint.id === complaintId
        );
        const detailPath = summary && isComplaintAssignedToCurrentSupervisor(summary)
          ? `/api/qc/supervisor/complaints/${complaintId}`
          : `/api/qc/complaints/${complaintId}`;
        const response = await fetch(`${API_BASE_URL}${detailPath}`, {
          credentials: 'include',
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `No se pudo cargar observacion #${complaintId}.`);
        }
        return [complaintId, await response.json() as QCComplaintDetail] as const;
      })
    )
      .then((entries) => {
        if (!isMounted) return;
        setComplaintDetails((current) => {
          const next = { ...current };
          entries.forEach(([complaintId, detail]) => {
            next[complaintId] = detail;
          });
          return next;
        });
      })
      .catch((err) => {
        if (isMounted) {
          setComplaintDetailError(
            err instanceof Error ? err.message : 'No se pudieron cargar detalles de observacion.'
          );
        }
      })
      .finally(() => {
        if (!isMounted) return;
        setLoadingComplaintIds((current) => {
          const next = new Set(current);
          complaintIds.forEach((id) => next.delete(id));
          return next;
        });
      });
    return () => {
      isMounted = false;
    };
  }, [alertModal, complaintDetails, isComplaintAssignedToCurrentSupervisor, selectedAlertDetails]);

  const handleSupervisorLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loginSubmitting) {
      return;
    }
    const supervisorId = Number.parseInt(loginSupervisorId, 10);
    if (!supervisorId || !loginPin.trim()) {
      setLoginError('Selecciona supervisor e ingresa PIN.');
      return;
    }
    setLoginSubmitting(true);
    setLoginError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/protocols/supervisor/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supervisor_id: supervisorId,
          pin: loginPin.trim(),
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'No se pudo iniciar sesion.');
      }
      setSupervisorSession(await response.json() as SupervisorSession);
      setLoginSupervisorId(String(supervisorId));
      setLoginPin('');
      setLoginOpen(false);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'No se pudo iniciar sesion.');
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleSupervisorLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/protocols/supervisor/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      setSupervisorSession(null);
    }
  };

  const refreshSupervisorComplaints = async () => {
    const response = await fetch(`${API_BASE_URL}/api/qc/complaints`, {
      credentials: 'include',
    });
    if (!response.ok) {
      return;
    }
    setComplaints(await response.json() as QCComplaintSummary[]);
  };

  const refreshComplaintDetail = async (complaintId: number) => {
    const response = await fetch(`${API_BASE_URL}/api/qc/supervisor/complaints/${complaintId}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'No se pudo actualizar la observacion.');
    }
    const detail = await response.json() as QCComplaintDetail;
    setComplaintDetails((current) => ({ ...current, [complaintId]: detail }));
    return detail;
  };

  const uploadSupervisorComplaintFiles = async (
    complaintId: number,
    eventId: number,
    files: File[]
  ) => {
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(
        `${API_BASE_URL}/api/qc/supervisor/complaints/${complaintId}/events/${eventId}/media`,
        {
          method: 'POST',
          credentials: 'include',
          body: formData,
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'No se pudo subir la foto.');
      }
    }
  };

  const handleSupervisorComment = async (complaint: QCComplaintSummary) => {
    const message = complaintDrafts[complaint.id]?.trim() ?? '';
    const files = complaintFiles[complaint.id] ?? [];
    const proposeClosure = closureProposalIds.has(complaint.id);
    if (!proposeClosure && !message && !files.length) {
      setComplaintDetailError('Escribe un comentario o toma una foto.');
      return;
    }
    setComplaintDetailError(null);
    setSubmittingComplaintIds((current) => new Set(current).add(complaint.id));
    if (proposeClosure) {
      setProposingClosureIds((current) => new Set(current).add(complaint.id));
    }
    try {
      const response = proposeClosure
        ? await fetch(`${API_BASE_URL}/api/qc/supervisor/complaints/${complaint.id}/propose-closure`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message || null }),
          })
        : await fetch(`${API_BASE_URL}/api/qc/supervisor/complaints/${complaint.id}/events`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message || 'Evidencia adjunta' }),
          });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || (proposeClosure ? 'No se pudo proponer el cierre.' : 'No se pudo enviar el comentario.'));
      }
      const event = await response.json() as QCComplaintEvent;
      if (files.length) {
        await uploadSupervisorComplaintFiles(complaint.id, event.id, files);
      }
      setComplaintDrafts((current) => ({ ...current, [complaint.id]: '' }));
      setComplaintFiles((current) => ({ ...current, [complaint.id]: [] }));
      setClosureProposalIds((current) => {
        const next = new Set(current);
        next.delete(complaint.id);
        return next;
      });
      await refreshComplaintDetail(complaint.id);
      await refreshSupervisorComplaints();
    } catch (err) {
      setComplaintDetailError(
        err instanceof Error
          ? err.message
          : proposeClosure
          ? 'No se pudo proponer el cierre.'
          : 'No se pudo enviar el comentario.'
      );
    } finally {
      setSubmittingComplaintIds((current) => {
        const next = new Set(current);
        next.delete(complaint.id);
        return next;
      });
      setProposingClosureIds((current) => {
        const next = new Set(current);
        next.delete(complaint.id);
        return next;
      });
    }
  };

  const renderMediaGrid = (items: Array<{ id: number; uri: string; mime_type?: string | null }>) => {
    if (!items.length) {
      return null;
    }
    return (
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((item) => {
          const src = resolveMediaUri(item.uri);
          const mimeType = item.mime_type ?? '';
          const isVideo = mimeType.startsWith('video/');
          return (
            <button
              key={`${item.id}-${item.uri}`}
              type="button"
              onClick={() => setMediaPreview({ uri: item.uri, mime_type: item.mime_type })}
              className="group overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
              title="Ver media"
            >
              {isVideo ? (
                <video src={src} className="h-28 w-full object-cover" muted playsInline />
              ) : (
                <img src={src} alt="" className="h-28 w-full object-cover transition group-hover:scale-[1.02]" />
              )}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6 flex flex-col">
      <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-full border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition"
              aria-label="Volver"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('armado')}
                className={clsx(
                  'rounded-full px-5 py-2 text-sm font-semibold uppercase tracking-wider transition',
                  activeTab === 'armado'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
                )}
              >
                Armado
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('paneles')}
                className={clsx(
                  'rounded-full px-5 py-2 text-sm font-semibold uppercase tracking-wider transition',
                  activeTab === 'paneles'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
                )}
              >
                Paneles
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {supervisorSession ? (
              <button
                type="button"
                onClick={handleSupervisorLogout}
                className="inline-flex max-w-[min(70vw,18rem)] items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                title="Cerrar sesion de supervisor"
              >
                <span className="truncate">{fullName(supervisorSession.supervisor)}</span>
                <LogOut className="h-4 w-4 shrink-0" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                <span>Ingresar</span>
                <LogIn className="h-4 w-4" />
              </button>
            )}
          </div>
        </header>

        {error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
            {error}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center flex-1">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="flex flex-col flex-1">
            <div className="flex-1 overflow-x-auto">
              {activeTab === 'armado' && assemblyGrid ? (
                assemblyGrid.lines.length === 0 ? (
                  <div className="py-12 text-center text-gray-400">
                    No hay estaciones configuradas para esta vista.
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse table-fixed min-w-[800px]">
                    <thead>
                      <tr>
                        <th className="w-16 pb-4 text-center border-b border-gray-200 font-semibold text-gray-400 text-[10px] uppercase tracking-widest align-bottom">
                          Est.
                        </th>
                        {assemblyGrid.lines.map((line, lineIdx) => (
                          <th
                            key={line}
                            className={clsx(
                              'pb-4 px-4 text-center border-b border-gray-200 font-bold text-gray-900 align-bottom',
                              lineIdx > 0 && 'border-l border-gray-200'
                            )}
                          >
                            Línea {line}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {assemblyGrid.rows.map((row, rowIdx) => {
                        const rowLabelStation = row.stations.find(Boolean);
                        const stripeStyle =
                          rowIdx % 2 === 1
                            ? { backgroundColor: 'rgba(15, 23, 42, 0.012)' }
                            : undefined;

                        return (
                        <tr
                          key={row.sequence}
                          className="transition-colors group"
                          style={stripeStyle}
                        >
                          <td
                            className="py-4 align-middle text-center text-xs font-black text-gray-700 tracking-wide"
                            style={stripeStyle}
                          >
                            {rowLabelStation ? getStationInitials(rowLabelStation.name) : '-'}
                          </td>
                          {row.stations.map((station, colIdx) => {
                            if (!station) {
                              return (
                                <td
                                  key={`empty-${colIdx}`}
                                  className={clsx('p-4 align-middle', colIdx > 0 && 'border-l border-gray-200')}
                                  style={stripeStyle}
                                />
                              );
                            }

                            const stationSnapshot = snapshots[station.id];
                            const workItems = stationSnapshot?.work_items.filter((wi) => !isMagazineStatus(wi.status)) || [];

                            return (
                              <td
                                key={station.id}
                                className={clsx('py-4 px-4 align-middle', colIdx > 0 && 'border-l border-gray-200')}
                                style={stripeStyle}
                              >
                                <div className="flex flex-col gap-2">
                                  <div className="flex flex-col gap-1.5">
                                    {workItems.length > 0 ? (
                                      workItems.map(wu => (
                                        <div key={wu.id} className="group/item">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="font-bold text-gray-950 tabular-nums">
                                              {wu.house_identifier}
                                            </span>
                                            <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                                              M{wu.module_number}
                                            </span>
                                            {(() => {
                                              const alerts = alertsByWorkUnit.get(wu.work_unit_id);
                                              if (!alerts) {
                                                return null;
                                              }
                                              return (
                                                <div className="flex items-center gap-1.5">
                                                  {alerts.reworks > 0 && (
                                                    <button
                                                      type="button"
                                                      onClick={() => setAlertModal({ kind: 'reworks', workItem: wu })}
                                                      className={clsx(
                                                        'inline-flex items-center gap-0.5 text-xs font-bold transition-colors',
                                                        severityTextClass(alerts.maxCheckSeverity)
                                                      )}
                                                      title={`Re-trabajos QC abiertos (${severityLabel(alerts.maxCheckSeverity)})`}
                                                    >
                                                      <Wrench className="h-3 w-3" />
                                                      {alerts.reworks}
                                                    </button>
                                                  )}
                                                  {alerts.complaints > 0 && (
                                                    <button
                                                      type="button"
                                                      onClick={() => setAlertModal({ kind: 'complaints', workItem: wu })}
                                                      className={clsx(
                                                        "inline-flex items-center gap-0.5 text-xs font-bold transition-colors",
                                                        supervisorSession &&
                                                          alerts.assignedComplaints > 0 &&
                                                          'rounded-full bg-blue-50 px-1 text-blue-700 ring-1 ring-blue-100',
                                                        alerts.maxComplaintSeverity === 'critica'
                                                          ? 'text-rose-600 hover:text-rose-800'
                                                          : alerts.maxComplaintSeverity === 'media'
                                                          ? 'text-orange-500 hover:text-orange-700'
                                                          : 'text-slate-500 hover:text-slate-700'
                                                      )}
                                                      title={
                                                        supervisorSession && alerts.assignedComplaints > 0
                                                          ? `${alerts.assignedComplaints} observacion(es) para ti de ${alerts.complaints} abiertas`
                                                          : `Observaciones abiertas (${severityLabel(alerts.maxComplaintSeverity)})`
                                                      }
                                                    >
                                                      <MessageSquare className="h-3 w-3" />
                                                      {alerts.complaints}
                                                    </button>
                                                  )}
                                                  {alerts.failedChecks > 0 && (
                                                    <button
                                                      type="button"
                                                      onClick={() => setAlertModal({ kind: 'failedChecks', workItem: wu })}
                                                      className={clsx(
                                                        'inline-flex items-center gap-0.5 text-xs font-bold transition-colors',
                                                        severityTextClass(alerts.maxCheckSeverity)
                                                      )}
                                                      title={`Check QC fallido con reinspeccion pendiente (${severityLabel(alerts.maxCheckSeverity)})`}
                                                    >
                                                      <AlertTriangle className="h-3 w-3" />
                                                      {alerts.failedChecks}
                                                    </button>
                                                  )}
                                                </div>
                                              );
                                            })()}
                                          </div>
                                          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-gray-500 group-hover/item:text-gray-900">
                                            <span className="flex-none text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                              {formatProjectInitials(wu.project_name)}
                                            </span>
                                            <span className="truncate transition-colors" title={wu.house_type_name}>
                                              {wu.house_type_name}
                                            </span>
                                          </div>
                                        </div>
                                      ))
                                    ) : (
                                      <span className="text-gray-300 text-sm font-light">—</span>
                                    )}
                                  </div>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              ) : (
                <div className="grid gap-x-4 gap-y-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleStations.length === 0 ? (
                    <div className="col-span-full py-12 text-center text-gray-400">
                      No hay estaciones configuradas para esta vista.
                    </div>
                  ) : (
                    visibleStations.map((station) => {
                      const stationSnapshot = snapshots[station.id];
                      const workItems = stationSnapshot?.work_items.filter((wi) => !isMagazineStatus(wi.status)) || [];

                      const groupedWorkItems = Object.values(
                        workItems.reduce((acc, wu) => {
                          const key = `${wu.house_identifier}-${wu.module_number}`;
                          if (!acc[key]) {
                            acc[key] = {
                              id: key,
                              house_identifier: wu.house_identifier,
                              module_number: wu.module_number,
                              project_name: wu.project_name,
                              house_type_name: wu.house_type_name,
                              panels: []
                            };
                          }
                          acc[key].panels.push(wu);
                          return acc;
                        }, {} as Record<string, {
                          id: string;
                          house_identifier: string;
                          module_number: number;
                          project_name: string;
                          house_type_name: string;
                          panels: typeof workItems;
                        }>)
                      );

                      return (
                        <div
                          key={station.id}
                          className="flex flex-col relative group/station"
                        >
                          <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider truncate mb-1.5 border-b border-gray-900 pb-1.5" title={station.name}>
                            {station.name}
                          </h3>

                          <div className="flex-1 flex flex-col gap-0 divide-y divide-gray-100 border-t border-gray-100">
                            {groupedWorkItems.length > 0 ? (
                              groupedWorkItems.map(group => (
                                <div key={group.id} className="py-2.5 flex flex-col gap-1 group/house">
                                  <div className="flex items-center gap-1 min-w-0 text-xs text-gray-500">
                                    <span className="font-bold text-gray-950 tabular-nums">
                                      {group.house_identifier}
                                    </span>
                                    <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-1 py-0.5 rounded shrink-0">
                                      M{group.module_number}
                                    </span>
                                    <span className="flex-none text-[10px] font-bold text-gray-500 bg-gray-100 px-1 py-0.5 rounded">
                                      {formatProjectInitials(group.project_name)}
                                    </span>
                                    <span className="truncate" title={group.house_type_name}>
                                      {group.house_type_name}
                                    </span>
                                  </div>

                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {group.panels.map(wu => {
                                      const alerts = alertsByWorkUnit.get(wu.work_unit_id);
                                      const hasAlerts = alerts && (alerts.reworks > 0 || alerts.complaints > 0 || alerts.failedChecks > 0);

                                      return (
                                        <div 
                                          key={wu.id} 
                                          className={clsx(
                                            "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border transition-all",
                                            hasAlerts 
                                              ? "bg-white border-red-200 shadow-sm" 
                                              : "bg-gray-50 border-gray-200/60 text-gray-600 hover:border-gray-300"
                                          )}
                                        >
                                          <span className={clsx(hasAlerts && "text-gray-900")}>
                                            {wu.panel_code || 'S/N'}
                                          </span>

                                          {hasAlerts && (
                                            <div className="flex items-center gap-0.5 border-l border-gray-100 pl-1 ml-0.5">
                                              {alerts.reworks > 0 && (
                                                <button
                                                  type="button"
                                                  onClick={() => setAlertModal({ kind: 'reworks', workItem: wu })}
                                                  className={severityTextClass(alerts.maxCheckSeverity)}
                                                  title={`Re-trabajos abiertos (${severityLabel(alerts.maxCheckSeverity)})`}
                                                >
                                                  <Wrench className="h-2.5 w-2.5" />
                                                </button>
                                              )}
                                              {alerts.complaints > 0 && (
                                                <button
                                                  type="button"
                                                  onClick={() => setAlertModal({ kind: 'complaints', workItem: wu })}
                                                  className={
                                                    clsx(
                                                      supervisorSession &&
                                                        alerts.assignedComplaints > 0 &&
                                                        'rounded-full bg-blue-50 p-0.5 text-blue-700 ring-1 ring-blue-100',
                                                      alerts.maxComplaintSeverity === 'critica'
                                                        ? 'text-rose-600 hover:text-rose-800'
                                                        : alerts.maxComplaintSeverity === 'media'
                                                        ? 'text-orange-500 hover:text-orange-700'
                                                        : 'text-slate-500 hover:text-slate-700'
                                                    )
                                                  }
                                                  title={
                                                    supervisorSession && alerts.assignedComplaints > 0
                                                      ? `${alerts.assignedComplaints} observacion(es) para ti de ${alerts.complaints} abiertas`
                                                      : `Observaciones abiertas (${severityLabel(alerts.maxComplaintSeverity)})`
                                                  }
                                                >
                                                  <MessageSquare className="h-2.5 w-2.5" />
                                                </button>
                                              )}
                                              {alerts.failedChecks > 0 && (
                                                <button
                                                  type="button"
                                                  onClick={() => setAlertModal({ kind: 'failedChecks', workItem: wu })}
                                                  className={severityTextClass(alerts.maxCheckSeverity)}
                                                  title={`Checks fallidos (${severityLabel(alerts.maxCheckSeverity)})`}
                                                >
                                                  <AlertTriangle className="h-2.5 w-2.5" />
                                                </button>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="py-6 flex items-center justify-center text-gray-300 text-xs font-medium">
                                Sin paneles en estación
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>              )}
            </div>
          </div>
        )}
      </div>
      {alertModal && selectedAlertDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-4xl rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-900">{selectedAlertDetails.title}</h2>
                <p className="mt-1 truncate text-sm text-gray-500">
                  {alertModal.workItem.house_identifier} · M{alertModal.workItem.module_number} ·{' '}
                  {formatProjectInitials(alertModal.workItem.project_name)} {alertModal.workItem.house_type_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAlertModal(null)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {selectedAlertDetails.items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500">
                  No hay informacion vigente para este modulo.
                </div>
              ) : null}

              {alertModal.kind === 'complaints'
                ? (selectedAlertDetails.items as QCComplaintSummary[]).map((complaint) => {
                    const detail = complaintDetails[complaint.id];
                    const draft = complaintDrafts[complaint.id] ?? '';
                    const files = complaintFiles[complaint.id] ?? [];
                    const isSubmitting = submittingComplaintIds.has(complaint.id);
                    const isProposingClosure = proposingClosureIds.has(complaint.id);
                    const isAssignedToCurrentSupervisor = isComplaintAssignedToCurrentSupervisor(complaint);
                    const isClosureProposal = closureProposalIds.has(complaint.id);
                    const canWrite = isAssignedToCurrentSupervisor && complaint.status !== 'Closed';
                    const canProposeClosure = complaint.status === 'Open';
                    const supervisorNames = complaint.supervisors.map(supervisorDisplayName).filter(Boolean);

                    return (
                      <div
                        key={complaint.id}
                        className={clsx(
                          'rounded-xl border bg-white p-4 shadow-sm',
                          isAssignedToCurrentSupervisor
                            ? 'border-blue-200 ring-1 ring-blue-100'
                            : 'border-rose-100'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-bold text-gray-900">{complaint.title}</p>
                              {supervisorSession ? (
                                <span
                                  className={clsx(
                                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                                    isAssignedToCurrentSupervisor
                                      ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
                                      : 'bg-gray-50 text-gray-500 ring-1 ring-gray-200'
                                  )}
                                >
                                  {isAssignedToCurrentSupervisor ? 'Para ti' : 'Otro supervisor'}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm text-gray-600">{complaint.description}</p>
                          </div>
                          <span
                            className={clsx(
                              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                              severityBadgeClass(complaint.severity_level)
                            )}
                          >
                            {severityLabel(complaint.severity_level)}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                          <span>Estado: {complaintStatusLabel(complaint.status)}</span>
                          <span>Actualizada: {formatTimestamp(complaint.updated_at)}</span>
                          {complaint.created_by_name ? <span>Creada por: {complaint.created_by_name}</span> : null}
                          {supervisorNames.length ? <span>Asignada a: {supervisorNames.join(', ')}</span> : null}
                        </div>

                        {loadingComplaintIds.has(complaint.id) ? (
                          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Cargando media de observacion...
                          </div>
                        ) : null}

                        {detail ? (
                          <div className="mt-4 space-y-4">
                            <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-3">
                              {detail.events.map((event) => {
                                const isSupervisor = event.actor_type === 'supervisor';
                                const isSystemEvent = event.event_type !== 'comment' && event.event_type !== 'created';
                                return (
                                  <div
                                    key={event.id}
                                    className={clsx(
                                      'flex',
                                      isSystemEvent
                                        ? 'justify-center'
                                        : isSupervisor
                                        ? 'justify-end'
                                        : 'justify-start'
                                    )}
                                  >
                                    <div
                                      className={clsx(
                                        isSystemEvent
                                          ? 'max-w-[90%] rounded-xl bg-white px-3 py-2 text-center text-xs font-semibold text-gray-600 ring-1 ring-gray-200'
                                          : 'max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm',
                                        !isSystemEvent && isSupervisor && 'bg-blue-600 text-white',
                                        !isSystemEvent && !isSupervisor && 'bg-white text-gray-800 ring-1 ring-gray-200'
                                      )}
                                    >
                                      <div className={clsx('text-[10px] font-bold uppercase tracking-wide', !isSystemEvent && isSupervisor ? 'text-white/70' : 'text-gray-400')}>
                                        {event.actor_name ?? (isSupervisor ? 'Supervisor' : 'Calidad')} · {complaintEventLabel(event.event_type)} · {formatTimestamp(event.created_at)}
                                      </div>
                                      {event.message ? (
                                        <div className="mt-1 whitespace-pre-wrap">{event.message}</div>
                                      ) : null}
                                      {event.media.length ? renderMediaGrid(event.media) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {canWrite ? (
                              <div
                                className={clsx(
                                  'rounded-xl border p-3',
                                  isClosureProposal
                                    ? 'border-emerald-200 bg-emerald-50'
                                    : 'border-gray-200 bg-gray-50'
                                )}
                              >
                                <textarea
                                  value={draft}
                                  onChange={(event) =>
                                    setComplaintDrafts((current) => ({
                                      ...current,
                                      [complaint.id]: event.target.value,
                                    }))
                                  }
                                  rows={2}
                                  placeholder={
                                    isClosureProposal
                                      ? 'Comentario de cierre para Calidad'
                                      : 'Responder a esta observacion'
                                  }
                                  className={clsx(
                                    'w-full resize-none rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 outline-none',
                                    isClosureProposal
                                      ? 'border-emerald-200 focus:border-emerald-500'
                                      : 'border-gray-200 focus:border-blue-500'
                                  )}
                                />
                                {files.length ? (
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {files.map((file) => (
                                      <span key={fileKey(file)} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-gray-600 ring-1 ring-gray-200">
                                        {file.name}
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setComplaintFiles((current) => ({
                                              ...current,
                                              [complaint.id]: (current[complaint.id] ?? []).filter(
                                                (item) => fileKey(item) !== fileKey(file)
                                              ),
                                            }))
                                          }
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                  <QCPhotoCaptureButton
                                    fileNamePrefix={
                                      isClosureProposal
                                        ? `supervisor-cierre-observacion-${complaint.id}`
                                        : `supervisor-observacion-${complaint.id}`
                                    }
                                    buttonLabel="Tomar foto"
                                    watermarkLines={(date) =>
                                      buildObservationWatermarkLines(date, {
                                        projectName: complaint.project_name,
                                        houseIdentifier: complaint.house_identifier,
                                        moduleNumber: complaint.module_number,
                                        panelCode: complaint.panel_code,
                                        title: complaint.title,
                                      })
                                    }
                                    onCapture={(file) =>
                                      setComplaintFiles((current) => ({
                                        ...current,
                                        [complaint.id]: [...(current[complaint.id] ?? []), file],
                                      }))
                                    }
                                  />
                                  <div className="flex flex-wrap items-center gap-2">
                                    <label
                                      className={clsx(
                                        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold',
                                        canProposeClosure
                                          ? 'cursor-pointer bg-white text-emerald-700'
                                          : 'cursor-not-allowed bg-gray-100 text-gray-400',
                                        isClosureProposal && canProposeClosure
                                          ? 'border-emerald-300 ring-1 ring-emerald-200'
                                          : 'border-gray-200'
                                      )}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isClosureProposal}
                                        disabled={!canProposeClosure}
                                        onChange={(event) =>
                                          setClosureProposalIds((current) => {
                                            const next = new Set(current);
                                            if (event.target.checked) {
                                              next.add(complaint.id);
                                            } else {
                                              next.delete(complaint.id);
                                            }
                                            return next;
                                          })
                                        }
                                        className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                      />
                                      Proponer cierre
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => void handleSupervisorComment(complaint)}
                                      disabled={isSubmitting || isProposingClosure}
                                      className={clsx(
                                        'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white disabled:opacity-60',
                                        isClosureProposal ? 'bg-emerald-600' : 'bg-blue-600'
                                      )}
                                    >
                                      {isSubmitting || isProposingClosure ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : isClosureProposal ? (
                                        <CheckCircle2 className="h-4 w-4" />
                                      ) : (
                                        <Send className="h-4 w-4" />
                                      )}
                                      {isClosureProposal ? 'Enviar cierre' : 'Enviar'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                : (selectedAlertDetails.items as QCReworkTaskSummary[]).map((task) => {
                      const detail = checkDetails[task.check_instance_id];
                      const failedExecution = detail?.executions.find(
                        (execution) => execution.outcome === 'Fail'
                      );
                      const evidence = detail?.evidence.filter((item) =>
                        failedExecution ? item.execution_id === failedExecution.id : true
                      ) ?? [];
                      return (
                        <div
                          key={task.id}
                          className={clsx(
                            'rounded-xl border p-4',
                            alertModal.kind === 'failedChecks'
                              ? 'border-red-100 bg-red-50/40'
                              : 'border-amber-100 bg-amber-50/40'
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-gray-900">
                                {detail?.check_instance.check_name ??
                                  (alertModal.kind === 'failedChecks'
                                    ? 'Reinspeccion QC pendiente'
                                    : 'Re-trabajo QC abierto')}
                              </p>
                              <p className="mt-1 text-sm text-gray-600">
                                {task.description || 'Sin descripcion registrada.'}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-gray-600">
                                {task.status}
                              </span>
                              <span
                                className={clsx(
                                  'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                                  severityBadgeClass(detail?.check_instance.severity_level ?? task.severity_level)
                                )}
                              >
                                {severityLabel(detail?.check_instance.severity_level ?? task.severity_level)}
                              </span>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                            <span>Check #{task.check_instance_id}</span>
                            <span>Estacion: {task.current_station_name ?? task.station_name ?? 'Sin estacion'}</span>
                            <span>Creado: {formatTimestamp(task.created_at)}</span>
                            {task.task_status ? <span>Tarea: {task.task_status}</span> : null}
                          </div>

                          {loadingCheckIds.has(task.check_instance_id) ? (
                            <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Cargando detalle del check...
                            </div>
                          ) : null}

                          {detail ? (
                            <div className="mt-4 space-y-3 rounded-lg border border-white/70 bg-white/70 p-3">
                              {detail.check_definition?.guidance_text ? (
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                                    Guia QC
                                  </p>
                                  <p className="mt-1 text-sm text-gray-700">
                                    {detail.check_definition.guidance_text}
                                  </p>
                                </div>
                              ) : null}

                              {failedExecution ? (
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                                    Falla registrada
                                  </p>
                                  <div className="mt-1 space-y-1 text-sm text-gray-700">
                                    <p>Fecha: {formatTimestamp(failedExecution.performed_at)}</p>
                                    {failedExecution.notes ? <p>Notas: {failedExecution.notes}</p> : null}
                                    {failedExecution.failure_modes.length ? (
                                      <p>
                                        Modos: {failedExecution.failure_modes
                                          .map((mode) => mode.failure_mode_name ?? mode.other_text)
                                          .filter(Boolean)
                                          .join(', ')}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}

                              {evidence.length ? (
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                                    Evidencia capturada
                                  </p>
                                  {renderMediaGrid(evidence)}
                                </div>
                              ) : null}

                              {!failedExecution && !evidence.length ? (
                                <p className="text-sm text-gray-500">
                                  Este check no tiene media o ejecuciones visibles registradas.
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                  })}
            </div>
            {checkDetailError ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {checkDetailError}
              </div>
            ) : null}
            {complaintDetailError ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {complaintDetailError}
              </div>
            ) : null}
          </div>
        </div>
      )}
      {mediaPreview ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4">
          <div className="relative max-h-[92vh] w-full max-w-5xl">
            <button
              type="button"
              onClick={() => setMediaPreview(null)}
              className="absolute -right-2 -top-2 z-10 rounded-full bg-white p-2 text-gray-600 shadow-lg hover:text-gray-900"
              aria-label="Cerrar media"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex max-h-[92vh] items-center justify-center overflow-hidden rounded-2xl bg-black shadow-2xl">
              {(mediaPreview.mime_type ?? '').startsWith('video/') ? (
                <video
                  src={resolveMediaUri(mediaPreview.uri)}
                  className="max-h-[92vh] w-full object-contain"
                  controls
                  autoPlay
                />
              ) : (
                <img
                  src={resolveMediaUri(mediaPreview.uri)}
                  alt=""
                  className="max-h-[92vh] w-full object-contain"
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
      {loginOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Login supervisor</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Las observaciones se filtraran por el supervisor activo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLoginOpen(false)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSupervisorLogin} className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-gray-600">
                Supervisor
                <select
                  value={loginSupervisorId}
                  onChange={(event) => setLoginSupervisorId(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Seleccionar</option>
                  {supervisors.map((supervisor) => (
                    <option key={supervisor.id} value={supervisor.id}>
                      {fullName(supervisor)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-gray-600">
                PIN
                <input
                  type="password"
                  value={loginPin}
                  onChange={(event) => setLoginPin(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
                  autoComplete="current-password"
                />
              </label>

              {loginError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {loginError}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loginSubmitting}
                className={clsx(
                  'w-full rounded-xl px-4 py-2 text-sm font-bold text-white transition',
                  loginSubmitting ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
                )}
              >
                {loginSubmitting ? 'Ingresando...' : 'Ingresar'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PanelLineSupervisorView;
