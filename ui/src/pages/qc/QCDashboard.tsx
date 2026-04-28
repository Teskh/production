import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  ClipboardPlus,
  FileSpreadsheet,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Wrench,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import QCPhotoCaptureButton from '../../components/QCPhotoCaptureButton';
import { useOptionalQCSession, useQCLayoutStatus } from '../../layouts/QCLayoutContext';

const REFRESH_INTERVAL_MS = 20000;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const QC_ROLE_VALUES = new Set(['Calidad', 'QC']);
const OPEN_CHECK_STATION_FILTER_STORAGE_KEY = 'qcDashboardOpenCheckStationFilter';

type QCCheckOrigin = 'triggered' | 'manual';
type QCCheckStatus = 'Open' | 'Closed';
type TaskScope = 'panel' | 'module' | 'aux';
type QCReworkStatus = 'Open' | 'InProgress' | 'Done' | 'Canceled';

type QCCheckInstanceSummary = {
  id: number;
  check_definition_id: number | null;
  check_name: string | null;
  origin: QCCheckOrigin;
  scope: TaskScope;
  work_unit_id: number;
  panel_unit_id: number | null;
  station_id: number | null;
  station_name: string | null;
  current_station_id: number | null;
  current_station_name: string | null;
  module_number: number;
  project_name: string | null;
  house_type_name: string | null;
  house_identifier: string | null;
  panel_code: string | null;
  status: QCCheckStatus;
  opened_at: string;
};

type QCReworkTaskSummary = {
  id: number;
  check_instance_id: number;
  description: string;
  status: QCReworkStatus;
  check_status: QCCheckStatus | null;
  task_status: string | null;
  work_unit_id: number;
  panel_unit_id: number | null;
  station_id: number | null;
  station_name: string | null;
  current_station_id: number | null;
  current_station_name: string | null;
  module_number: number;
  project_name: string | null;
  house_type_name: string | null;
  house_identifier: string | null;
  panel_code: string | null;
  created_at: string;
};

type QCPlantPanelSummary = {
  panel_unit_id: number;
  panel_definition_id: number;
  work_unit_id: number;
  current_station_id: number;
  current_station_name: string | null;
  status: 'Planned' | 'InProgress' | 'Completed' | 'Consumed';
  module_number: number;
  project_name: string | null;
  house_type_name: string | null;
  house_identifier: string | null;
  panel_code: string | null;
};

type QCPlantModuleSummary = {
  work_unit_id: number;
  current_station_id: number;
  current_station_name: string | null;
  status: 'Planned' | 'Panels' | 'Magazine' | 'Assembly' | 'Completed';
  module_number: number;
  project_name: string | null;
  house_type_name: string | null;
  house_identifier: string | null;
};

type QCDashboardResponse = {
  pending_checks: QCCheckInstanceSummary[];
  rework_tasks: QCReworkTaskSummary[];
  plant_panels: QCPlantPanelSummary[];
  plant_modules: QCPlantModuleSummary[];
};

type StationSummary = {
  id: number;
  name: string;
  role: string;
  line_type: string | null;
  sequence_order: number | null;
};

type QCSeverityLevel = 'baja' | 'media' | 'critica';
type QCComplaintStatus = 'Open' | 'ClosureProposed' | 'Closed';

type SupervisorSummary = {
  id: number;
  first_name: string;
  last_name: string;
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

type QCComplaintSummary = {
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

type QCComplaintDetail = QCComplaintSummary & {
  events: QCComplaintEvent[];
};

type ObservationModuleSelection = {
  workUnitId: number;
  moduleNumber: number;
  projectName: string | null;
  houseTypeName: string | null;
  houseIdentifier: string | null;
};

type MediaPreview = {
  uri: string;
  mime_type?: string | null;
} | null;

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

const scopeLabels: Record<TaskScope, string> = {
  module: 'Modulo',
  panel: 'Panel',
  aux: 'Aux',
};

const reworkStatusLabels: Record<QCReworkStatus, string> = {
  Open: 'Abierto',
  InProgress: 'En progreso',
  Done: 'Finalizado',
  Canceled: 'Cancelado',
};

const reworkTaskStatusLabels: Record<string, string> = {
  NotStarted: 'Sin iniciar',
  InProgress: 'En trabajo',
  Paused: 'En pausa',
  Completed: 'Completado',
};

const severityLabels: Record<QCSeverityLevel, string> = {
  baja: 'Baja',
  media: 'Media',
  critica: 'Critica',
};

const observationStatusLabels: Record<QCComplaintStatus, string> = {
  Open: 'Abierta',
  ClosureProposed: 'Cierre propuesto',
  Closed: 'Cerrada',
};

const observationEventLabels: Record<QCComplaintEvent['event_type'], string> = {
  created: 'Creo la observacion',
  comment: 'Comento',
  media_added: 'Agrego evidencia',
  closure_proposed: 'Propuso cierre',
  closure_accepted: 'Acepto cierre',
  closure_rejected: 'Rechazo cierre',
};

const fullName = (person: SupervisorSummary): string =>
  `${person.first_name} ${person.last_name}`;

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
    title?: string | null;
  }
) => {
  const parts: string[] = [];
  if (context.projectName) parts.push(context.projectName);
  if (context.houseIdentifier) parts.push(`Casa ${context.houseIdentifier}`);
  if (context.moduleNumber) parts.push(`Modulo ${context.moduleNumber}`);
  const lines: string[] = [];
  if (parts.length) lines.push(parts.join(' · '));
  lines.push(context.title?.trim() || 'Observacion QC');
  lines.push(`${formatStampDate(date)} ${formatStampTime(date)}`);
  return lines.filter(Boolean);
};

const resolveMediaUri = (uri: string): string => {
  if (!uri) return uri;
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  if (uri.startsWith('/')) return `${API_BASE_URL}${uri}`;
  return `${API_BASE_URL}/${uri}`;
};

const buildWorkUnitLabel = (
  projectName: string | null,
  houseTypeName: string | null,
  houseIdentifier: string | null
): string => {
  const parts: string[] = [];
  if (projectName) parts.push(projectName);
  if (houseTypeName) parts.push(houseTypeName);
  if (houseIdentifier) parts.push(`Casa ${houseIdentifier}`);
  return parts.length ? parts.join(' · ') : '-';
};

const formatModulePanelLabel = (moduleNumber: number, panelCode: string | null): string => {
  const moduleLabel = `Modulo ${moduleNumber}`;
  if (panelCode) {
    return `${moduleLabel} · Panel ${panelCode}`;
  }
  return moduleLabel;
};

const resolveStationId = (stationId: number | null, currentId: number | null): number | null =>
  currentId ?? stationId;

const toTimestamp = (value: string): number => {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const parseFilenameFromDisposition = (dispositionHeader: string | null, fallbackName: string) => {
  if (!dispositionHeader) {
    return fallbackName;
  }
  const utf8Match = dispositionHeader.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const quotedMatch = dispositionHeader.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }
  const plainMatch = dispositionHeader.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() || fallbackName;
};

const normalizeAssemblyStationName = (station: StationSummary): string => {
  const trimmed = station.name.trim();
  if (!station.line_type) {
    return trimmed;
  }
  const escapedLineType = station.line_type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(Linea|Line)\\s*${escapedLineType}\\s*-\\s*`, 'i');
  const normalized = trimmed.replace(pattern, '').trim();
  return normalized || trimmed;
};

const parseStoredStationFilter = (): number[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = localStorage.getItem(OPEN_CHECK_STATION_FILTER_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return Array.from(
      new Set(
        parsed
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    );
  } catch {
    return [];
  }
};

const QCDashboard: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [dashboard, setDashboard] = useState<QCDashboardResponse>({
    pending_checks: [],
    rework_tasks: [],
    plant_panels: [],
    plant_modules: [],
  });
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [isUnauthorized, setIsUnauthorized] = useState(false);
  const [stations, setStations] = useState<StationSummary[]>([]);
  const [stationsLoading, setStationsLoading] = useState(true);
  const [stationsError, setStationsError] = useState<string | null>(null);
  const [observations, setObservations] = useState<QCComplaintSummary[]>([]);
  const [observationSelection, setObservationSelection] =
    useState<ObservationModuleSelection | null>(null);
  const [observationDetail, setObservationDetail] = useState<QCComplaintDetail | null>(null);
  const [observationDetailLoading, setObservationDetailLoading] = useState(false);
  const [observationError, setObservationError] = useState<string | null>(null);
  const [observationMediaPreview, setObservationMediaPreview] = useState<MediaPreview>(null);
  const [supervisors, setSupervisors] = useState<SupervisorSummary[]>([]);
  const [newObservationOpen, setNewObservationOpen] = useState(false);
  const newObservationTitleRef = useRef<HTMLInputElement | null>(null);
  const newObservationDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const [newObservationSeverity, setNewObservationSeverity] = useState<QCSeverityLevel>('media');
  const [newObservationSupervisorIds, setNewObservationSupervisorIds] = useState<Set<number>>(
    new Set()
  );
  const [newObservationFiles, setNewObservationFiles] = useState<File[]>([]);
  const [newObservationSubmitting, setNewObservationSubmitting] = useState(false);
  const [stationSelection, setStationSelection] = useState<{
    stationName: string;
    checks: QCCheckInstanceSummary[];
  } | null>(null);
  const [selectedStationFilterIds, setSelectedStationFilterIds] = useState<number[]>(() =>
    parseStoredStationFilter()
  );
  const [stationFilterOpen, setStationFilterOpen] = useState(false);
  const stationFilterRef = useRef<HTMLDivElement | null>(null);
  const [activeTaskTab, setActiveTaskTab] = useState<'checks' | 'observations' | 'reworks'>('checks');
  const [activePlantTab, setActivePlantTab] = useState<'panels' | 'armado'>('panels');
  const qcSession = useOptionalQCSession();
  const { setStatus } = useQCLayoutStatus();
  const canExecuteChecks = Boolean(qcSession?.role && QC_ROLE_VALUES.has(qcSession.role));
  const blockedMessage =
    location.state?.blocked === 'qc-auth'
      ? 'Inicia sesion para ejecutar inspecciones QC.'
      : null;

  useEffect(() => {
    let isMounted = true;
    const loadDashboard = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/qc/dashboard`, {
          credentials: 'include',
        });
        if (!isMounted) {
          return;
        }
        if (response.status === 401) {
          setDashboard({
            pending_checks: [],
            rework_tasks: [],
            plant_panels: [],
            plant_modules: [],
          });
          setIsUnauthorized(true);
          setErrorMessage(null);
          setLoading(false);
          return;
        }
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Solicitud fallida (${response.status})`);
        }
        const data = (await response.json()) as QCDashboardResponse;
        setDashboard({
          ...data,
          plant_panels: data.plant_panels ?? [],
          plant_modules: data.plant_modules ?? [],
        });
        setIsUnauthorized(false);
        setErrorMessage(null);
        setLastUpdated(new Date());
      } catch (error) {
        if (!isMounted) {
          return;
        }
        const message =
          error instanceof Error ? error.message : 'No se pudo cargar el tablero QC.';
        setErrorMessage(message);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    loadDashboard();
    const intervalId = window.setInterval(loadDashboard, REFRESH_INTERVAL_MS);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const loadObservations = async () => {
    if (!canExecuteChecks) {
      setObservations([]);
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/qc/complaints`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Solicitud fallida (${response.status})`);
      }
      const data = (await response.json()) as QCComplaintSummary[];
      setObservations(data);
    } catch (error) {
      setObservationError(
        error instanceof Error ? error.message : 'No se pudieron cargar observaciones.'
      );
    }
  };

  useEffect(() => {
    void loadObservations();
    const intervalId = window.setInterval(() => void loadObservations(), REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canExecuteChecks]);

  useEffect(() => {
    if (!canExecuteChecks) {
      setSupervisors([]);
      return;
    }
    let isMounted = true;
    const loadSupervisors = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/workers/supervisors`, {
          credentials: 'include',
        });
        if (!isMounted) {
          return;
        }
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Solicitud fallida (${response.status})`);
        }
        setSupervisors((await response.json()) as SupervisorSummary[]);
      } catch (error) {
        if (isMounted) {
          setObservationError(
            error instanceof Error ? error.message : 'No se pudieron cargar supervisores.'
          );
        }
      }
    };
    void loadSupervisors();
    return () => {
      isMounted = false;
    };
  }, [canExecuteChecks]);

  useEffect(() => {
    let isMounted = true;
    const loadStations = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/stations`, {
          credentials: 'include',
        });
        if (!isMounted) {
          return;
        }
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Solicitud fallida (${response.status})`);
        }
        const data = (await response.json()) as StationSummary[];
        setStations(data);
        setStationsError(null);
      } catch (error) {
        if (!isMounted) {
          return;
        }
        const message =
          error instanceof Error ? error.message : 'No se pudo cargar estaciones.';
        setStationsError(message);
      } finally {
        if (isMounted) {
          setStationsLoading(false);
        }
      }
    };
    loadStations();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    setStatus((current) => ({ ...current, refreshIntervalMs: REFRESH_INTERVAL_MS }));
    return () => {
      setStatus({});
    };
  }, [setStatus]);

  useEffect(() => {
    try {
      localStorage.setItem(
        OPEN_CHECK_STATION_FILTER_STORAGE_KEY,
        JSON.stringify(selectedStationFilterIds)
      );
    } catch {
      // Ignore localStorage write errors.
    }
  }, [selectedStationFilterIds]);

  useEffect(() => {
    if (!stations.length) {
      return;
    }
    const validStationIds = new Set(stations.map((station) => station.id));
    setSelectedStationFilterIds((current) => {
      const next = current.filter((stationId) => validStationIds.has(stationId));
      return next.length === current.length ? current : next;
    });
  }, [stations]);

  useEffect(() => {
    if (!stationFilterOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!stationFilterRef.current) {
        return;
      }
      if (stationFilterRef.current.contains(event.target as Node)) {
        return;
      }
      setStationFilterOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setStationFilterOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [stationFilterOpen]);

  useEffect(() => {
    setStationSelection(null);
  }, [selectedStationFilterIds]);

  useEffect(() => {
    setStatus((current) => ({ ...current, lastUpdated }));
  }, [lastUpdated, setStatus]);

  const pendingChecks = useMemo(() => dashboard.pending_checks, [dashboard.pending_checks]);
  const selectedStationFilterSet = useMemo(
    () => new Set(selectedStationFilterIds),
    [selectedStationFilterIds]
  );
  const hasStationFilter = selectedStationFilterIds.length > 0;
  const filteredPendingChecks = useMemo(() => {
    if (!hasStationFilter) {
      return pendingChecks;
    }
    return pendingChecks.filter((check) => {
      const stationId = resolveStationId(check.station_id, check.current_station_id);
      return stationId !== null && selectedStationFilterSet.has(stationId);
    });
  }, [pendingChecks, hasStationFilter, selectedStationFilterSet]);
  const reworkTasks = useMemo(() => dashboard.rework_tasks, [dashboard.rework_tasks]);
  const plantPanels = useMemo(() => dashboard.plant_panels ?? [], [dashboard.plant_panels]);
  const plantModules = useMemo(() => dashboard.plant_modules ?? [], [dashboard.plant_modules]);
  const activeReworkTasks = useMemo(
    () => reworkTasks.filter((task) => task.current_station_id !== null),
    [reworkTasks]
  );
  const stationActivity = useMemo(() => {
    const activity = new Map<
      number,
      { openChecks: QCCheckInstanceSummary[]; reworks: QCReworkTaskSummary[] }
    >();
    const ensureEntry = (stationId: number) => {
      const entry = activity.get(stationId);
      if (entry) {
        return entry;
      }
      const next = { openChecks: [], reworks: [] };
      activity.set(stationId, next);
      return next;
    };
    filteredPendingChecks.forEach((check) => {
      const stationId = resolveStationId(check.station_id, check.current_station_id);
      if (stationId === null) {
        return;
      }
      ensureEntry(stationId).openChecks.push(check);
    });
    activeReworkTasks.forEach((task) => {
      const stationId = resolveStationId(task.station_id, task.current_station_id);
      if (stationId === null) {
        return;
      }
      ensureEntry(stationId).reworks.push(task);
    });
    activity.forEach((entry) => {
      entry.openChecks.sort((a, b) => toTimestamp(b.opened_at) - toTimestamp(a.opened_at));
      entry.reworks.sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at));
    });
    return activity;
  }, [filteredPendingChecks, activeReworkTasks]);
  const plantPanelsByStation = useMemo(() => {
    const panelsByStation = new Map<number, QCPlantPanelSummary[]>();
    plantPanels.forEach((panel) => {
      const current = panelsByStation.get(panel.current_station_id) ?? [];
      current.push(panel);
      panelsByStation.set(panel.current_station_id, current);
    });
    panelsByStation.forEach((panels) => {
      panels.sort((a, b) => {
        if (a.module_number !== b.module_number) {
          return a.module_number - b.module_number;
        }
        return (a.panel_code ?? '').localeCompare(b.panel_code ?? '');
      });
    });
    return panelsByStation;
  }, [plantPanels]);
  const plantModulesByStation = useMemo(() => {
    const modulesByStation = new Map<number, QCPlantModuleSummary[]>();
    plantModules.forEach((module) => {
      const current = modulesByStation.get(module.current_station_id) ?? [];
      current.push(module);
      modulesByStation.set(module.current_station_id, current);
    });
    modulesByStation.forEach((modules) => {
      modules.sort((a, b) => a.module_number - b.module_number);
    });
    return modulesByStation;
  }, [plantModules]);
  const openObservationCountsByWorkUnit = useMemo(() => {
    const counts = new Map<number, number>();
    observations.forEach((observation) => {
      if (observation.status === 'Closed') {
        return;
      }
      counts.set(observation.work_unit_id, (counts.get(observation.work_unit_id) ?? 0) + 1);
    });
    return counts;
  }, [observations]);
  const stationGroups = useMemo(() => {
    const panels: StationSummary[] = [];
    const lines: Record<'1' | '2' | '3', StationSummary[]> = {
      '1': [],
      '2': [],
      '3': [],
    };
    stations.forEach((station) => {
      if (station.role === 'Panels') {
        panels.push(station);
        return;
      }
      if (station.role === 'Assembly' && station.line_type) {
        const bucket = lines[station.line_type as keyof typeof lines];
        if (bucket) {
          bucket.push(station);
        }
      }
    });
    const sortStations = (a: StationSummary, b: StationSummary) => {
      const left = a.sequence_order ?? Number.POSITIVE_INFINITY;
      const right = b.sequence_order ?? Number.POSITIVE_INFINITY;
      if (left !== right) {
        return left - right;
      }
      return a.name.localeCompare(b.name);
    };
    panels.sort(sortStations);
    Object.values(lines).forEach((group) => group.sort(sortStations));
    return [
      { id: 'panels', title: 'Paneles', stations: panels },
      { id: 'line-1', title: 'Linea 1', stations: lines['1'] },
      { id: 'line-2', title: 'Linea 2', stations: lines['2'] },
      { id: 'line-3', title: 'Linea 3', stations: lines['3'] },
    ];
  }, [stations]);
  const filterStationGroups = useMemo(() => {
    type FilterOption = {
      id: string;
      label: string;
      subtitle: string | null;
      stationIds: number[];
    };
    type FilterGroup = {
      id: string;
      title: string;
      options: FilterOption[];
    };

    const panelOptions = stations
      .filter((station) => station.role === 'Panels')
      .sort((a, b) => {
        const left = a.sequence_order ?? Number.POSITIVE_INFINITY;
        const right = b.sequence_order ?? Number.POSITIVE_INFINITY;
        if (left !== right) {
          return left - right;
        }
        return a.name.localeCompare(b.name);
      })
      .map((station) => ({
        id: `panel-station-${station.id}`,
        label: station.name,
        subtitle: null,
        stationIds: [station.id],
      }));

    const assemblyBySequence = new Map<number, StationSummary[]>();
    stations.forEach((station) => {
      if (station.role !== 'Assembly' || station.sequence_order === null) {
        return;
      }
      const current = assemblyBySequence.get(station.sequence_order) ?? [];
      current.push(station);
      assemblyBySequence.set(station.sequence_order, current);
    });
    const assemblyOptions = Array.from(assemblyBySequence.entries())
      .sort(([left], [right]) => left - right)
      .map(([sequenceOrder, sequenceStations]) => {
        const uniqueNames = Array.from(
          new Set(sequenceStations.map((station) => normalizeAssemblyStationName(station)))
        );
        const label = uniqueNames[0] ?? `Secuencia ${sequenceOrder}`;
        return {
          id: `assembly-sequence-${sequenceOrder}`,
          label,
          subtitle: `Secuencia ${sequenceOrder}`,
          stationIds: sequenceStations.map((station) => station.id),
        };
      });

    const groups: FilterGroup[] = [];
    if (panelOptions.length) {
      groups.push({ id: 'panels', title: 'Paneles', options: panelOptions });
    }
    if (assemblyOptions.length) {
      groups.push({
        id: 'assembly-sequences',
        title: 'Armado y terminaciones',
        options: assemblyOptions,
      });
    }
    return groups;
  }, [stations]);
  const filterStationOptions = useMemo(
    () => filterStationGroups.flatMap((group) => group.options),
    [filterStationGroups]
  );
  const selectedFilterOptionLabels = useMemo(() => {
    if (!selectedStationFilterIds.length) {
      return [];
    }
    return filterStationOptions
      .filter((option) => option.stationIds.every((stationId) => selectedStationFilterSet.has(stationId)))
      .map((option) => option.label);
  }, [filterStationOptions, selectedStationFilterSet, selectedStationFilterIds.length]);
  const stationFilterSummary = useMemo(() => {
    if (!selectedFilterOptionLabels.length) {
      return 'Todas las estaciones';
    }
    if (selectedFilterOptionLabels.length <= 2) {
      return selectedFilterOptionLabels.join(', ');
    }
    return `${selectedFilterOptionLabels.length} grupos`;
  }, [selectedFilterOptionLabels]);
  useEffect(() => {
    if (!selectedStationFilterIds.length || !filterStationOptions.length) {
      return;
    }
    setSelectedStationFilterIds((current) => {
      const next = new Set(current);
      let changed = false;
      filterStationOptions.forEach((option) => {
        const selectedCount = option.stationIds.reduce(
          (count, stationId) => (next.has(stationId) ? count + 1 : count),
          0
        );
        if (selectedCount > 0 && selectedCount < option.stationIds.length) {
          option.stationIds.forEach((stationId) => next.add(stationId));
          changed = true;
        }
      });
      return changed ? Array.from(next) : current;
    });
  }, [filterStationOptions, selectedStationFilterIds]);
  const hasFilterStationOptions = useMemo(
    () => filterStationGroups.some((group) => group.options.length > 0),
    [filterStationGroups]
  );
  const baseCardClass =
    'group rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md';
  const disabledCardClass = clsx(baseCardClass, 'pointer-events-none opacity-70');
  const locationLabel = (stationName: string | null, currentName: string | null) =>
    currentName ?? stationName ?? 'Sin estacion';
  const unauthorizedMessage = isUnauthorized
    ? 'Inicia sesion para ver inspecciones pendientes y re-trabajos.'
    : null;
  const hasStations = stations.length > 0;
  const isFilterOptionSelected = (stationIds: number[]) =>
    stationIds.every((stationId) => selectedStationFilterSet.has(stationId));
  const toggleStationFilterOption = (stationIds: number[]) => {
    setSelectedStationFilterIds((current) => {
      const next = new Set(current);
      const allSelected = stationIds.every((stationId) => next.has(stationId));
      if (allSelected) {
        stationIds.forEach((stationId) => next.delete(stationId));
      } else {
        stationIds.forEach((stationId) => next.add(stationId));
      }
      return Array.from(next);
    });
  };
  const clearStationFilter = () => {
    setSelectedStationFilterIds([]);
  };
  const getStationSummary = (stationId: number) => {
    const activity = stationActivity.get(stationId);
    const stationPanels = plantPanelsByStation.get(stationId) ?? [];
    const primaryPanel = stationPanels[0] ?? null;
    const stationModules = plantModulesByStation.get(stationId) ?? [];
    const primaryModule = stationModules[0] ?? null;
    const moduleFallback = () => {
      if (!primaryModule) {
        return null;
      }
      const workUnitLabel = buildWorkUnitLabel(
        primaryModule.project_name,
        primaryModule.house_type_name,
        primaryModule.house_identifier
      );
      return {
        moduleLabel:
          stationModules.length > 1
            ? `Modulo ${primaryModule.module_number} +${stationModules.length - 1}`
            : `Modulo ${primaryModule.module_number}`,
        workUnitLabel: workUnitLabel === '-' ? '' : workUnitLabel,
        openCheckCount: 0,
        workUnitId: primaryModule.work_unit_id,
        moduleNumber: primaryModule.module_number,
        projectName: primaryModule.project_name,
        houseTypeName: primaryModule.house_type_name,
        houseIdentifier: primaryModule.house_identifier,
      };
    };
    if (!activity) {
      if (primaryPanel) {
        const workUnitLabel = buildWorkUnitLabel(
          primaryPanel.project_name,
          primaryPanel.house_type_name,
          primaryPanel.house_identifier
        );
        return {
          moduleLabel:
            stationPanels.length > 1
              ? `${formatModulePanelLabel(primaryPanel.module_number, primaryPanel.panel_code)} +${stationPanels.length - 1}`
              : formatModulePanelLabel(primaryPanel.module_number, primaryPanel.panel_code),
          workUnitLabel: workUnitLabel === '-' ? '' : workUnitLabel,
          openCheckCount: 0,
          workUnitId: primaryPanel.work_unit_id,
          moduleNumber: primaryPanel.module_number,
          projectName: primaryPanel.project_name,
          houseTypeName: primaryPanel.house_type_name,
          houseIdentifier: primaryPanel.house_identifier,
        };
      }
      const fallback = moduleFallback();
      if (fallback) {
        return fallback;
      }
      return {
        moduleLabel: 'Sin datos',
        workUnitLabel: '',
        openCheckCount: 0,
        workUnitId: null as number | null,
        moduleNumber: null as number | null,
        projectName: null as string | null,
        houseTypeName: null as string | null,
        houseIdentifier: null as string | null,
      };
    }
    const primary = activity.openChecks[0] ?? activity.reworks[0];
    const openCheckCount = activity.openChecks.length;
    if (!primary) {
      if (primaryPanel) {
        const workUnitLabel = buildWorkUnitLabel(
          primaryPanel.project_name,
          primaryPanel.house_type_name,
          primaryPanel.house_identifier
        );
        return {
          moduleLabel:
            stationPanels.length > 1
              ? `${formatModulePanelLabel(primaryPanel.module_number, primaryPanel.panel_code)} +${stationPanels.length - 1}`
              : formatModulePanelLabel(primaryPanel.module_number, primaryPanel.panel_code),
          workUnitLabel: workUnitLabel === '-' ? '' : workUnitLabel,
          openCheckCount,
          workUnitId: primaryPanel.work_unit_id,
          moduleNumber: primaryPanel.module_number,
          projectName: primaryPanel.project_name,
          houseTypeName: primaryPanel.house_type_name,
          houseIdentifier: primaryPanel.house_identifier,
        };
      }
      const fallback = moduleFallback();
      if (fallback) {
        return { ...fallback, openCheckCount };
      }
      return {
        moduleLabel: 'Sin datos',
        workUnitLabel: '',
        openCheckCount,
        workUnitId: null as number | null,
        moduleNumber: null as number | null,
        projectName: null as string | null,
        houseTypeName: null as string | null,
        houseIdentifier: null as string | null,
      };
    }
    const workUnitLabel = buildWorkUnitLabel(
      primary.project_name,
      primary.house_type_name,
      primary.house_identifier
    );
    return {
      moduleLabel: formatModulePanelLabel(primary.module_number, primary.panel_code),
      workUnitLabel: workUnitLabel === '-' ? '' : workUnitLabel,
      openCheckCount,
      workUnitId: primary.work_unit_id,
      moduleNumber: primary.module_number,
      projectName: primary.project_name,
      houseTypeName: primary.house_type_name,
      houseIdentifier: primary.house_identifier,
    };
  };
  const openStationChecks = (station: StationSummary) => {
    if (!canExecuteChecks) {
      return;
    }
    const checks = stationActivity.get(station.id)?.openChecks ?? [];
    if (!checks.length) {
      return;
    }
    if (checks.length === 1) {
      const check = checks[0];
      navigate(`/qc/execute?check=${check.id}`, { state: { checkId: check.id } });
      return;
    }
    setStationSelection({ stationName: station.name, checks });
  };
  const closeStationSelection = () => {
    setStationSelection(null);
  };
  const handleSelectCheck = (check: QCCheckInstanceSummary) => {
    setStationSelection(null);
    navigate(`/qc/execute?check=${check.id}`, { state: { checkId: check.id } });
  };
  const closeObservationModal = () => {
    setObservationSelection(null);
    setObservationDetail(null);
    setObservationError(null);
    setObservationMediaPreview(null);
    setNewObservationOpen(false);
    if (newObservationTitleRef.current) {
      newObservationTitleRef.current.value = '';
    }
    if (newObservationDescriptionRef.current) {
      newObservationDescriptionRef.current.value = '';
    }
    setNewObservationSeverity('media');
    setNewObservationSupervisorIds(new Set());
    setNewObservationFiles([]);
  };
  const openObservationModal = async (selection: ObservationModuleSelection, initialObservationId?: number) => {
    setObservationSelection(selection);
    setObservationDetail(null);
    setObservationError(null);
    setNewObservationOpen(false);
    const moduleObservations = observations
      .filter((observation) => observation.work_unit_id === selection.workUnitId)
      .sort((a, b) => toTimestamp(b.updated_at) - toTimestamp(a.updated_at));
    const targetObs =
      (initialObservationId ? moduleObservations.find(o => o.id === initialObservationId) : null) ??
      moduleObservations.find((observation) => observation.status !== 'Closed') ??
      moduleObservations[0] ??
      null;
    if (!targetObs) {
      return;
    }
    setObservationDetailLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/qc/complaints/${targetObs.id}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Solicitud fallida (${response.status})`);
      }
      setObservationDetail((await response.json()) as QCComplaintDetail);
    } catch (error) {
      setObservationError(
        error instanceof Error ? error.message : 'No se pudo cargar la observacion.'
      );
    } finally {
      setObservationDetailLoading(false);
    }
  };
  const selectObservationDetail = async (observationId: number) => {
    setObservationDetailLoading(true);
    setObservationError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/qc/complaints/${observationId}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Solicitud fallida (${response.status})`);
      }
      setObservationDetail((await response.json()) as QCComplaintDetail);
    } catch (error) {
      setObservationError(
        error instanceof Error ? error.message : 'No se pudo cargar la observacion.'
      );
    } finally {
      setObservationDetailLoading(false);
    }
  };
  const uploadObservationFiles = async (complaintId: number, eventId: number, files: File[]) => {
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(
        `${API_BASE_URL}/api/qc/complaints/${complaintId}/events/${eventId}/media`,
        {
          method: 'POST',
          credentials: 'include',
          body: formData,
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `No se pudo subir ${file.name}`);
      }
    }
  };
  const createModuleObservation = async () => {
    if (!observationSelection) {
      return;
    }
    const title = newObservationTitleRef.current?.value.trim() ?? '';
    const description = newObservationDescriptionRef.current?.value.trim() ?? '';
    if (!title || !description) {
      setObservationError('Titulo y descripcion son obligatorios.');
      return;
    }
    if (!newObservationSupervisorIds.size) {
      setObservationError('Seleccione al menos un supervisor.');
      return;
    }
    setNewObservationSubmitting(true);
    setObservationError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/qc/complaints`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_unit_id: observationSelection.workUnitId,
          panel_unit_id: null,
          station_id: null,
          title,
          description,
          severity_level: newObservationSeverity,
          supervisor_ids: Array.from(newObservationSupervisorIds),
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Solicitud fallida (${response.status})`);
      }
      const created = (await response.json()) as QCComplaintDetail;
      const initialEvent = created.events.find((event) => event.event_type === 'created');
      if (initialEvent && newObservationFiles.length) {
        await uploadObservationFiles(created.id, initialEvent.id, newObservationFiles);
      }
      setNewObservationOpen(false);
      if (newObservationTitleRef.current) {
        newObservationTitleRef.current.value = '';
      }
      if (newObservationDescriptionRef.current) {
        newObservationDescriptionRef.current.value = '';
      }
      setNewObservationSeverity('media');
      setNewObservationSupervisorIds(new Set());
      setNewObservationFiles([]);
      await loadObservations();
      await selectObservationDetail(created.id);
    } catch (error) {
      setObservationError(
        error instanceof Error ? error.message : 'No se pudo crear la observacion.'
      );
    } finally {
      setNewObservationSubmitting(false);
    }
  };
  const reviewModuleObservationClosure = async (action: 'accept-closure' | 'reject-closure') => {
    if (!observationDetail) {
      return;
    }
    const message =
      action === 'accept-closure'
        ? window.prompt('Comentario opcional para aceptar el cierre') ?? ''
        : window.prompt('Motivo para rechazar el cierre') ?? '';
    if (action === 'reject-closure' && !message.trim()) {
      setObservationError('Indique un motivo para rechazar el cierre.');
      return;
    }
    setObservationError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/qc/complaints/${observationDetail.id}/${action}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Solicitud fallida (${response.status})`);
      }
      setObservationDetail((await response.json()) as QCComplaintDetail);
      await loadObservations();
    } catch (error) {
      setObservationError(
        error instanceof Error ? error.message : 'No se pudo revisar el cierre.'
      );
    }
  };
  const handleExportReport = async () => {
    if (!canExecuteChecks || reportGenerating) {
      return;
    }
    setReportError(null);
    setReportGenerating(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/qc/dashboard/export.xlsx`, {
        credentials: 'include',
      });
      if (!response.ok) {
        let detail = '';
        try {
          const payload = (await response.json()) as { detail?: unknown };
          detail = typeof payload.detail === 'string' ? payload.detail : '';
        } catch {
          detail = (await response.text()) || '';
        }
        throw new Error(detail || `No fue posible generar el reporte (${response.status})`);
      }

      const blob = await response.blob();
      const filename = parseFilenameFromDisposition(
        response.headers.get('content-disposition'),
        'qc_dashboard_report.xlsx'
      );
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl);
      }, 1000);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No fue posible generar el reporte Excel.';
      setReportError(message);
    } finally {
      setReportGenerating(false);
    }
  };

  const selectedModuleObservations = observationSelection
    ? observations
        .filter((observation) => observation.work_unit_id === observationSelection.workUnitId)
        .sort((a, b) => toTimestamp(b.updated_at) - toTimestamp(a.updated_at))
    : [];
  const selectedModuleOpenObservations = selectedModuleObservations.filter(
    (observation) => observation.status !== 'Closed'
  );
  const selectedModuleClosedObservations = selectedModuleObservations.filter(
    (observation) => observation.status === 'Closed'
  );
  const observationModuleLabel = observationSelection
    ? buildWorkUnitLabel(
        observationSelection.projectName,
        observationSelection.houseTypeName,
        observationSelection.houseIdentifier
      )
    : '';

  return (
    <div className="space-y-6">
      {(unauthorizedMessage || blockedMessage) && (
        <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--ink-muted)]">
          {blockedMessage ?? unauthorizedMessage}
          {!canExecuteChecks ? (
            <button
              type="button"
              onClick={() => navigate('/qc', { state: { qcLogin: true } })}
              className="ml-2 font-semibold text-[var(--ink)] underline"
            >
              Iniciar sesion
            </button>
          ) : null}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--ink-muted)]">
          {errorMessage}
        </div>
      )}
      {reportError && (
        <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--ink-muted)]">
          {reportError}
        </div>
      )}
      <section className="rounded-3xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-2">
            {([
              { id: 'checks' as const, label: 'Revisiones', icon: ClipboardCheck, count: filteredPendingChecks.length },
              { id: 'observations' as const, label: 'Observaciones', icon: MessageSquare, count: observations.filter((o) => o.status !== 'Closed').length },
              { id: 'reworks' as const, label: 'Re-trabajos', icon: Wrench, count: activeReworkTasks.length },
            ]).map(({ id, label, icon: Icon, count }) => {
              const active = activeTaskTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTaskTab(id)}
                  className={clsx(
                    'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition',
                    active
                      ? 'bg-[var(--ink)] text-white shadow-sm'
                      : 'border border-black/10 bg-white text-[var(--ink-muted)] hover:bg-[var(--canvas)]'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  <span
                    className={clsx(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      active ? 'bg-white/20 text-white' : 'bg-black/5 text-[var(--ink)]'
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeTaskTab === 'checks' && canExecuteChecks ? (
              <button
                type="button"
                onClick={handleExportReport}
                disabled={reportGenerating}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {reportGenerating ? 'Generando...' : 'Reporte Excel'}
              </button>
            ) : null}
            {activeTaskTab === 'checks' ? (
              <div ref={stationFilterRef} className="relative">
                <button
                  type="button"
                  onClick={() => setStationFilterOpen((open) => !open)}
                  className="inline-flex max-w-[13rem] items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-left text-xs text-[var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  aria-label="Filtrar inspecciones abiertas por estacion"
                  aria-expanded={stationFilterOpen}
                >
                  <span className="truncate">{stationFilterSummary}</span>
                  <ChevronDown
                    className={clsx('h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)] transition', {
                      'rotate-180': stationFilterOpen,
                    })}
                  />
                </button>
                {stationFilterOpen ? (
                  <div className="absolute right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-black/10 bg-white p-3 shadow-xl">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                        Filtrar por estacion
                      </p>
                      <button
                        type="button"
                        onClick={clearStationFilter}
                        disabled={!selectedStationFilterIds.length}
                        className="text-xs font-semibold text-[var(--ink)] underline disabled:cursor-not-allowed disabled:text-[var(--ink-muted)]"
                      >
                        Ver todas
                      </button>
                    </div>
                    {!hasFilterStationOptions ? (
                      <p className="mt-3 rounded-xl border border-dashed border-black/10 px-3 py-4 text-xs text-[var(--ink-muted)]">
                        No hay estaciones disponibles para filtrar.
                      </p>
                    ) : (
                      <div className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
                        {filterStationGroups.map((group) =>
                          group.options.length ? (
                            <div key={group.id}>
                              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                                {group.title}
                              </p>
                              <div className="mt-2 space-y-2">
                                {group.options.map((option) => {
                                  const checkboxId = `qc-station-filter-${option.id}`;
                                  return (
                                    <label
                                      key={option.id}
                                      htmlFor={checkboxId}
                                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-black/5 px-2 py-1.5 text-xs text-[var(--ink)] transition hover:bg-[var(--canvas)]"
                                    >
                                      <input
                                        id={checkboxId}
                                        type="checkbox"
                                        checked={isFilterOptionSelected(option.stationIds)}
                                        onChange={() => toggleStationFilterOption(option.stationIds)}
                                        className="h-3.5 w-3.5 rounded border-black/20 text-[var(--accent)] focus:ring-[var(--accent)]"
                                      />
                                      <span className="truncate">{option.label}</span>
                                      {option.subtitle ? (
                                        <span className="ml-auto text-[10px] text-[var(--ink-muted)]">
                                          {option.subtitle}
                                        </span>
                                      ) : null}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
            {canExecuteChecks ? (
              <Link
                to="/qc/new"
                className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <ClipboardPlus className="h-4 w-4" />
                Nueva inspeccion
              </Link>
            ) : null}
          </div>
        </div>

        {activeTaskTab === 'checks' ? (
          <div className="mt-5">
            {hasStationFilter ? (
              <p className="mb-3 text-xs text-[var(--ink-muted)]">Filtro: {stationFilterSummary}</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {loading && !pendingChecks.length ? (
                <div className="rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)] sm:col-span-2 xl:col-span-3">
                  Cargando revisiones pendientes...
                </div>
              ) : null}
              {!loading && !filteredPendingChecks.length ? (
                <div className="rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)] sm:col-span-2 xl:col-span-3">
                  {hasStationFilter && pendingChecks.length
                    ? 'No hay revisiones abiertas para las estaciones seleccionadas.'
                    : 'No hay revisiones abiertas en este momento.'}
                </div>
              ) : null}
              {filteredPendingChecks.map((check) => {
                const workUnitLabel = buildWorkUnitLabel(
                  check.project_name,
                  check.house_type_name,
                  check.house_identifier
                );
                const cardContent = (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--ink)]">
                          {check.check_name ?? 'Inspeccion sin titulo'}
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">{workUnitLabel}</p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          {check.module_number}
                          {check.panel_code ? ` · Panel ${check.panel_code}` : ''} ·{' '}
                          en {locationLabel(check.station_name, check.current_station_name)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(242,98,65,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink)]">
                        {scopeLabels[check.scope]}
                      </span>
                      <span>Creado {formatTimestamp(check.opened_at)}</span>
                    </div>
                  </>
                );
                if (!canExecuteChecks) {
                  return (
                    <div key={check.id} className={disabledCardClass} aria-disabled="true">
                      {cardContent}
                    </div>
                  );
                }
                return (
                  <Link
                    key={check.id}
                    to={`/qc/execute?check=${check.id}`}
                    state={{ checkId: check.id }}
                    className={baseCardClass}
                  >
                    {cardContent}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}

        {activeTaskTab === 'observations' ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {!observations.filter((obs) => obs.status !== 'Closed').length ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)] sm:col-span-2 xl:col-span-3">
                No hay observaciones abiertas.
              </div>
            ) : null}
            {observations.filter((obs) => obs.status !== 'Closed')
              .sort((a, b) => toTimestamp(b.updated_at) - toTimestamp(a.updated_at))
              .map((obs) => {
              const workUnitLabel = buildWorkUnitLabel(
                obs.project_name,
                obs.house_type_name,
                obs.house_identifier
              );
              const cardContent = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--ink)] truncate">
                        {obs.title}
                      </p>
                      <p className="text-xs text-[var(--ink-muted)] truncate">{workUnitLabel}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        {obs.module_number}
                        {obs.panel_code ? ` · Panel ${obs.panel_code}` : ''}
                      </p>
                    </div>
                    <span className={clsx(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      obs.severity_level === 'critica' ? 'bg-red-100 text-red-700' :
                      obs.severity_level === 'media' ? 'bg-amber-100 text-amber-700' :
                      'bg-slate-100 text-slate-700'
                    )}>
                      {severityLabels[obs.severity_level]}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                    <span>{observationStatusLabels[obs.status]} · {formatTimestamp(obs.updated_at)}</span>
                  </div>
                </>
              );
              return (
                <button
                  key={obs.id}
                  type="button"
                  onClick={() => {
                    openObservationModal({
                      workUnitId: obs.work_unit_id,
                      moduleNumber: obs.module_number,
                      projectName: obs.project_name,
                      houseTypeName: obs.house_type_name,
                      houseIdentifier: obs.house_identifier,
                    }, obs.id);
                  }}
                  className={clsx(baseCardClass, 'text-left')}
                >
                  {cardContent}
                </button>
              );
            })}
          </div>
        ) : null}

        {activeTaskTab === 'reworks' ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {loading && !activeReworkTasks.length ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)] sm:col-span-2 xl:col-span-3">
                Cargando re-trabajos...
              </div>
            ) : null}
            {!loading && !activeReworkTasks.length ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)] sm:col-span-2 xl:col-span-3">
                No hay re-trabajos activos.
              </div>
            ) : null}
            {activeReworkTasks.map((task) => {
              const workUnitLabel = buildWorkUnitLabel(
                task.project_name,
                task.house_type_name,
                task.house_identifier
              );
              const taskStatusLabel = task.task_status
                ? reworkTaskStatusLabels[task.task_status] ?? task.task_status
                : 'Sin iniciar';
              const checkReady = task.status === 'Done' && task.check_status === 'Open';
              const statusLabel = `${reworkStatusLabels[task.status]} · ${taskStatusLabel}`;
              const detailLine = checkReady
                ? 'Retrabajo completado · Reinspeccion pendiente'
                : `${task.description || 'Retrabajo en seguimiento'} · ${statusLabel}`;
              const cardContent = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-[var(--ink-muted)]">{workUnitLabel}</p>
                      <p className="text-sm font-semibold text-[var(--ink)]">
                        {task.module_number}
                        {task.panel_code ? ` · Panel ${task.panel_code}` : ''} ·{' '}
                        en {locationLabel(task.station_name, task.current_station_name)}
                      </p>
                      <p className="text-xs text-[var(--ink-muted)]">{detailLine}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                    <span>Creado {formatTimestamp(task.created_at)}</span>
                  </div>
                </>
              );
              if (!checkReady) {
                return (
                  <div
                    key={task.id}
                    className="rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm opacity-70"
                  >
                    {cardContent}
                  </div>
                );
              }
              if (!canExecuteChecks) {
                return (
                  <div key={task.id} className={disabledCardClass} aria-disabled="true">
                    {cardContent}
                  </div>
                );
              }
              return (
                <Link
                  key={task.id}
                  to={`/qc/execute?check=${task.check_instance_id}`}
                  state={{ rework: task, checkId: task.check_instance_id }}
                  className={clsx(baseCardClass, 'border-emerald-200')}
                >
                  {cardContent}
                </Link>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2">
            {(['panels', 'armado'] as const).map((id) => {
              const active = activePlantTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActivePlantTab(id)}
                  className={clsx(
                    'rounded-full px-5 py-2 text-sm font-semibold transition',
                    active
                      ? 'bg-[var(--ink)] text-white shadow-sm'
                      : 'border border-black/10 bg-white text-[var(--ink-muted)] hover:bg-[var(--canvas)]'
                  )}
                >
                  {id === 'panels' ? 'Paneles' : 'Armado'}
                </button>
              );
            })}
          </div>
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            <LayoutGrid className="h-4 w-4" />
            Vista de planta
          </div>
        </div>
        {stationsError ? (
          <div className="mt-4 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--ink-muted)]">
            {stationsError}
          </div>
        ) : null}
        {!hasStations && stationsLoading ? (
          <div className="mt-4 rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)]">
            Cargando estaciones...
          </div>
        ) : null}
        {!hasStations && !stationsLoading ? (
          <div className="mt-4 rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)]">
            No hay estaciones para mostrar.
          </div>
        ) : null}
        {hasStations ? (() => {
          const renderStationCard = (station: StationSummary) => {
            const summary = getStationSummary(station.id);
            const hasOpenChecks = summary.openCheckCount > 0;
            const isEmptyStation = summary.workUnitId === null && !hasOpenChecks;
            const obsCount = summary.workUnitId
              ? openObservationCountsByWorkUnit.get(summary.workUnitId) ?? 0
              : 0;
            const canOpenObservations = canExecuteChecks && summary.workUnitId !== null;
            const observationSelectionForStation =
              summary.workUnitId !== null && summary.moduleNumber !== null
                ? {
                    workUnitId: summary.workUnitId,
                    moduleNumber: summary.moduleNumber,
                    projectName: summary.projectName,
                    houseTypeName: summary.houseTypeName,
                    houseIdentifier: summary.houseIdentifier,
                  }
                : null;
            return (
              <div
                key={station.id}
                className={clsx(
                  'flex flex-col justify-between rounded-xl border p-3 shadow-sm transition hover:shadow-md',
                  isEmptyStation
                    ? 'border-black/5 bg-slate-100/70 text-[var(--ink-muted)] opacity-75'
                    : 'border-black/10 bg-white'
                )}
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[var(--ink)]">{station.name}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">{summary.moduleLabel}</p>
                  {summary.workUnitLabel ? (
                    <p className="mt-0.5 truncate text-[10px] text-[var(--ink-muted)]">
                      {summary.workUnitLabel}
                    </p>
                  ) : null}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => openStationChecks(station)}
                    disabled={!canExecuteChecks || !hasOpenChecks}
                    className={clsx(
                      'flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[10px] font-semibold transition',
                      hasOpenChecks
                        ? 'border-[rgba(242,98,65,0.3)] bg-[rgba(242,98,65,0.08)] text-[var(--ink)]'
                        : 'border-black/5 bg-slate-50 text-[var(--ink-muted)]',
                      canExecuteChecks && hasOpenChecks
                        ? 'hover:-translate-y-0.5 hover:shadow-sm'
                        : 'opacity-70 cursor-not-allowed'
                    )}
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" />
                    {summary.openCheckCount} Checks
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (observationSelectionForStation) {
                        openObservationModal(observationSelectionForStation);
                      }
                    }}
                    disabled={!canOpenObservations || !observationSelectionForStation}
                    className={clsx(
                      'flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[10px] font-semibold transition',
                      obsCount > 0
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-black/5 bg-slate-50 text-[var(--ink-muted)]',
                      canOpenObservations && observationSelectionForStation
                        ? 'hover:-translate-y-0.5 hover:shadow-sm'
                        : 'opacity-70 cursor-not-allowed'
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    {obsCount} Obs.
                  </button>
                </div>
              </div>
            );
          };
          const panelStations = stationGroups.find((g) => g.id === 'panels')?.stations ?? [];
          const lineGroups = stationGroups.filter((g) => g.id !== 'panels');
          if (activePlantTab === 'panels') {
            return panelStations.length ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {panelStations.map(renderStationCard)}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-black/10 bg-white px-4 py-6 text-sm text-[var(--ink-muted)]">
                No hay estaciones de paneles configuradas.
              </div>
            );
          }
          return (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {lineGroups.map((group) => (
                <div key={group.id} className="rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                      {group.title}
                    </p>
                    <span className="text-[10px] text-[var(--ink-muted)]">
                      {group.stations.length} est.
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {group.stations.length ? (
                      group.stations.map(renderStationCard)
                    ) : (
                      <div className="rounded-xl border border-dashed border-black/10 bg-[var(--canvas)] px-3 py-3 text-xs text-[var(--ink-muted)]">
                        Sin estaciones configuradas.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })() : null}
      </section>

      {observationSelection ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeObservationModal} />
          <div className="relative grid max-h-[90vh] w-full max-w-5xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-xl">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/10 px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Observaciones
                </p>
                <h4 className="mt-1 text-base font-display text-[var(--ink)]">
                  Modulo {observationSelection.moduleNumber}
                </h4>
                <p className="text-xs text-[var(--ink-muted)]">{observationModuleLabel}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNewObservationOpen((open) => !open)}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-3 py-2 text-xs font-semibold text-white"
                >
                  <Plus className="h-4 w-4" />
                  Nueva observacion
                </button>
                <button
                  type="button"
                  onClick={closeObservationModal}
                  className="rounded-full p-2 text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 gap-0 md:grid-cols-[340px_minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto border-r border-black/10 p-4">
                {observationError ? (
                  <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {observationError}
                  </div>
                ) : null}
                {newObservationOpen ? (
                  <div className="mb-4 rounded-2xl border border-black/10 bg-[var(--canvas)] p-3">
                    <div className="grid gap-2">
                      <input
                        ref={newObservationTitleRef}
                        placeholder="Titulo"
                        className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                      />
                      <textarea
                        ref={newObservationDescriptionRef}
                        placeholder="Descripcion"
                        rows={3}
                        className="resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                      />
                      <select
                        value={newObservationSeverity}
                        onChange={(event) =>
                          setNewObservationSeverity(event.target.value as QCSeverityLevel)
                        }
                        className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                      >
                        <option value="baja">Baja</option>
                        <option value="media">Media</option>
                        <option value="critica">Critica</option>
                      </select>
                      <div className="max-h-32 overflow-y-auto rounded-lg border border-black/10 bg-white p-2">
                        {supervisors.map((supervisor) => {
                          const checked = newObservationSupervisorIds.has(supervisor.id);
                          return (
                            <label
                              key={supervisor.id}
                              className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-slate-50"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  setNewObservationSupervisorIds((current) => {
                                    const next = new Set(current);
                                    if (event.target.checked) {
                                      next.add(supervisor.id);
                                    } else {
                                      next.delete(supervisor.id);
                                    }
                                    return next;
                                  });
                                }}
                              />
                              {fullName(supervisor)}
                            </label>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <QCPhotoCaptureButton
                          fileNamePrefix={`qc-observacion-${observationSelection.workUnitId}`}
                          buttonLabel="Tomar foto"
                          className="py-1.5 text-xs"
                          watermarkLines={(date) =>
                            buildObservationWatermarkLines(date, {
                              projectName: observationSelection.projectName,
                              houseIdentifier: observationSelection.houseIdentifier,
                              moduleNumber: observationSelection.moduleNumber,
                              title: newObservationTitleRef.current?.value ?? '',
                            })
                          }
                          onCapture={(file) =>
                            setNewObservationFiles((current) => [...current, file])
                          }
                        />
                        <button
                          type="button"
                          onClick={() => void createModuleObservation()}
                          disabled={newObservationSubmitting}
                          className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          {newObservationSubmitting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                          Crear
                        </button>
                      </div>
                      {newObservationFiles.length ? (
                        <div className="flex flex-wrap gap-1">
                          {newObservationFiles.map((file) => (
                            <span
                              key={fileKey(file)}
                              className="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] text-[var(--ink-muted)] ring-1 ring-black/10"
                            >
                              <span className="truncate">{file.name}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setNewObservationFiles((current) =>
                                    current.filter((item) => fileKey(item) !== fileKey(file))
                                  )
                                }
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                  Abiertas
                </p>
                <div className="mt-2 space-y-2">
                  {selectedModuleOpenObservations.length ? (
                    selectedModuleOpenObservations.map((observation) => (
                      <button
                        key={observation.id}
                        type="button"
                        onClick={() => void selectObservationDetail(observation.id)}
                        className={clsx(
                          'w-full rounded-xl border px-3 py-2 text-left text-xs transition hover:bg-slate-50',
                          observationDetail?.id === observation.id
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                            : 'border-black/10 bg-white'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold text-[var(--ink)]">
                            {observation.title}
                          </span>
                          <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">
                            {severityLabels[observation.severity_level]}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] text-[var(--ink-muted)]">
                          {observation.description}
                        </p>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-black/10 px-3 py-3 text-xs text-[var(--ink-muted)]">
                      Sin observaciones abiertas.
                    </div>
                  )}
                </div>

                <p className="mt-5 text-[11px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                  Cerradas
                </p>
                <div className="mt-2 space-y-2">
                  {selectedModuleClosedObservations.length ? (
                    selectedModuleClosedObservations.map((observation) => (
                      <button
                        key={observation.id}
                        type="button"
                        onClick={() => void selectObservationDetail(observation.id)}
                        className={clsx(
                          'w-full rounded-xl border px-3 py-2 text-left text-xs opacity-80 transition hover:bg-slate-50',
                          observationDetail?.id === observation.id
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                            : 'border-black/10 bg-white'
                        )}
                      >
                        <span className="truncate font-semibold text-[var(--ink)]">
                          {observation.title}
                        </span>
                        <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                          {observation.closed_at ? formatTimestamp(observation.closed_at) : 'Cerrada'}
                        </p>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-black/10 px-3 py-3 text-xs text-[var(--ink-muted)]">
                      Sin observaciones cerradas.
                    </div>
                  )}
                </div>
              </div>

              <div className="min-h-0 overflow-y-auto p-5">
                {observationDetailLoading ? (
                  <div className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando observacion...
                  </div>
                ) : observationDetail ? (
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h5 className="text-base font-semibold text-[var(--ink)]">
                          {observationDetail.title}
                        </h5>
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">
                          {observationStatusLabels[observationDetail.status]} ·{' '}
                          {severityLabels[observationDetail.severity_level]} ·{' '}
                          {formatTimestamp(observationDetail.updated_at)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {observationDetail.events.map((event) => {
                        const fromQc = event.actor_type === 'qc';
                        const isStatusEvent =
                          event.event_type === 'closure_accepted' ||
                          event.event_type === 'closure_rejected';
                        const isPendingClosureProposal =
                          event.event_type === 'closure_proposed' &&
                          observationDetail.status === 'ClosureProposed';
                        return (
                          <div
                            key={event.id}
                            className={clsx('flex', fromQc ? 'justify-end' : 'justify-start')}
                          >
                            <div className={clsx('flex max-w-[82%] flex-col', fromQc ? 'items-end' : 'items-start')}>
                            <div
                              className={clsx(
                                isStatusEvent
                                  ? 'max-w-[90%] rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-900'
                                  : 'max-w-[82%] rounded-2xl px-4 py-3 text-sm',
                                !isStatusEvent && fromQc
                                  ? 'bg-[var(--ink)] text-white'
                                  : !isStatusEvent
                                  ? 'bg-slate-100 text-[var(--ink)]'
                                  : ''
                              )}
                            >
                              <p
                                className={clsx(
                                  'mb-1 text-[11px]',
                                  isStatusEvent
                                    ? 'font-semibold uppercase tracking-wide text-amber-700'
                                    : fromQc
                                    ? 'text-white/70'
                                    : 'text-[var(--ink-muted)]'
                                )}
                              >
                                {event.actor_name ?? (fromQc ? 'Calidad' : 'Supervisor')} ·{' '}
                                {observationEventLabels[event.event_type]} ·{' '}
                                {formatTimestamp(event.created_at)}
                              </p>
                              {event.message ? (
                                <p className="whitespace-pre-wrap">{event.message}</p>
                              ) : null}
                              {event.media.length ? (
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                  {event.media.map((media) => {
                                    const mediaSrc = resolveMediaUri(media.uri);
                                    return (
                                      <button
                                        key={media.id}
                                        type="button"
                                        onClick={() =>
                                          setObservationMediaPreview({
                                            uri: media.uri,
                                            mime_type: media.mime_type,
                                          })
                                        }
                                        className="block overflow-hidden rounded-lg bg-black/10"
                                      >
                                        {media.mime_type.startsWith('image/') ? (
                                        <img
                                          src={mediaSrc}
                                          alt=""
                                          className="h-28 w-full object-cover"
                                        />
                                        ) : (
                                        <video
                                          src={mediaSrc}
                                          className="h-28 w-full object-cover"
                                          muted
                                          playsInline
                                        />
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                            {isPendingClosureProposal ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void reviewModuleObservationClosure('accept-closure')}
                                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Cerrar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void reviewModuleObservationClosure('reject-closure')}
                                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white"
                                >
                                  <AlertTriangle className="h-3.5 w-3.5" />
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
                ) : (
                  <div className="rounded-2xl border border-dashed border-black/10 px-4 py-8 text-sm text-[var(--ink-muted)]">
                    Selecciona una observacion o crea una nueva para este modulo.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {observationMediaPreview ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4">
          <div className="relative flex max-h-[92vh] w-full max-w-6xl items-center justify-center">
            <button
              type="button"
              onClick={() => setObservationMediaPreview(null)}
              className="absolute right-0 top-0 z-10 rounded-full bg-white/90 p-2 text-[var(--ink)] shadow-lg transition hover:bg-white"
              aria-label="Cerrar vista previa"
            >
              <X className="h-5 w-5" />
            </button>
            {(observationMediaPreview.mime_type ?? '').startsWith('video/') ? (
              <video
                src={resolveMediaUri(observationMediaPreview.uri)}
                className="max-h-[88vh] max-w-full rounded-xl bg-black object-contain"
                controls
                autoPlay
              />
            ) : (
              <img
                src={resolveMediaUri(observationMediaPreview.uri)}
                alt=""
                className="max-h-[88vh] max-w-full rounded-xl bg-black object-contain"
              />
            )}
          </div>
        </div>
      ) : null}

      {stationSelection && stationSelection.checks.length > 1 ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeStationSelection} />
          <div className="relative w-full max-w-xl rounded-2xl border border-black/10 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Inspecciones abiertas
                </p>
                <h4 className="mt-1 text-base font-display text-[var(--ink)]">
                  {stationSelection.stationName}
                </h4>
              </div>
              <button
                type="button"
                onClick={closeStationSelection}
                className="rounded-full p-2 text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto px-4 py-4">
              {stationSelection.checks.map((check) => {
                const workUnitLabel = buildWorkUnitLabel(
                  check.project_name,
                  check.house_type_name,
                  check.house_identifier
                );
                return (
                  <button
                    key={check.id}
                    type="button"
                    onClick={() => handleSelectCheck(check)}
                    className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--ink)]">
                          {check.check_name ?? 'Inspeccion sin titulo'}
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          {formatModulePanelLabel(check.module_number, check.panel_code)}
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">{workUnitLabel}</p>
                      </div>
                      <span className="text-xs text-[var(--ink-muted)]">
                        {formatTimestamp(check.opened_at)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
};

export default QCDashboard;
