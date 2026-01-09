import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, MapPin, QrCode, Settings, User } from 'lucide-react';
import LoginSettings from './LoginSettings';
import QRCodeScannerModal from '../components/QRCodeScannerModal';
import PanelStationGoalPanel from '../components/PanelStationGoalPanel';
import type { StationContext } from '../utils/stationContext';
import {
  SPECIFIC_STATION_ID_STORAGE_KEY,
  STATION_CONTEXT_STORAGE_KEY,
  formatStationContext,
  formatStationLabel,
  getAssemblySequenceOrders,
  getStationsForContext,
  isStationInContext,
  parseStationContext,
} from '../utils/stationContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const QR_SCANNING_STORAGE_KEY = 'login_qr_scanning_enabled';

type Station = {
  id: number;
  name: string;
  role: string;
  line_type: string | null;
  sequence_order: number | null;
};

type TaskScope = 'panel' | 'module' | 'aux';

type TaskDefinition = {
  id: number;
  scope: TaskScope;
  default_station_sequence: number | null;
  active?: boolean;
};

type Worker = {
  id: number;
  first_name: string;
  last_name: string;
  pin: string | null;
  login_required: boolean;
  active: boolean;
  assigned_station_ids: number[] | null;
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

const findWorkerByQrValue = (value: string, list: Worker[]): Worker | null => {
  const normalized = normalizeQrValue(value);
  if (!normalized) {
    return null;
  }
  const fullMatch =
    list.find(
      (worker) => normalizeQrValue(formatWorkerFullName(worker)) === normalized
    ) ?? null;
  if (fullMatch) {
    return fullMatch;
  }
  return (
    list.find(
      (worker) => normalizeQrValue(formatWorkerDisplayName(worker)) === normalized
    ) ?? null
  );
};

type WorkerSessionResponse = {
  worker: Worker;
  station_id: number | null;
  require_pin_change: boolean;
  idle_timeout_seconds: number | null;
};

const WORKER_THRESHOLD = 16;

type TaskCoverage = {
  panelSequences: Set<number>;
  moduleSequences: Set<number>;
  auxSequences: Set<number>;
  auxUnassigned: boolean;
  moduleUnassigned: boolean;
};

const buildTaskCoverage = (tasks: TaskDefinition[]): TaskCoverage => {
  const coverage: TaskCoverage = {
    panelSequences: new Set<number>(),
    moduleSequences: new Set<number>(),
    auxSequences: new Set<number>(),
    auxUnassigned: false,
    moduleUnassigned: false,
  };

  tasks.forEach((task) => {
    if (task.active === false) {
      return;
    }
    if (task.default_station_sequence === null) {
      if (task.scope === 'aux') {
        coverage.auxUnassigned = true;
      }
      if (task.scope === 'module') {
        coverage.moduleUnassigned = true;
      }
      return;
    }
    if (task.scope === 'panel') {
      coverage.panelSequences.add(task.default_station_sequence);
      return;
    }
    if (task.scope === 'module') {
      coverage.moduleSequences.add(task.default_station_sequence);
      return;
    }
    if (task.scope === 'aux') {
      coverage.auxSequences.add(task.default_station_sequence);
    }
  });

  return coverage;
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

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [stations, setStations] = useState<Station[]>([]);
  const [taskDefinitions, setTaskDefinitions] = useState<TaskDefinition[]>([]);
  const [taskDefinitionsReady, setTaskDefinitionsReady] = useState(false);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [stationContext, setStationContext] = useState<StationContext | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showStationPicker, setShowStationPicker] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinModalWorkerId, setPinModalWorkerId] = useState<number | null>(null);
  const [pinModalValue, setPinModalValue] = useState('');
  const [pinModalError, setPinModalError] = useState<string | null>(null);
  const [showAllWorkers, setShowAllWorkers] = useState(false);
  const [adminFirstName, setAdminFirstName] = useState('');
  const [adminLastName, setAdminLastName] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [useSysadmin, setUseSysadmin] = useState(false);
  const [adminSubmitting, setAdminSubmitting] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pinChangeOpen, setPinChangeOpen] = useState(false);
  const [pinChangeWorkerId, setPinChangeWorkerId] = useState<number | null>(null);
  const [pinChangeDraft, setPinChangeDraft] = useState('');
  const [pinChangeConfirm, setPinChangeConfirm] = useState('');
  const [pinChangeError, setPinChangeError] = useState<string | null>(null);
  const [qrScanningEnabled, setQrScanningEnabled] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return localStorage.getItem(QR_SCANNING_STORAGE_KEY) === 'true';
  });
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const lastTapRef = useRef(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const taskPromise = apiRequest<TaskDefinition[]>('/api/task-definitions').then(
          (data) => ({ ok: true, data }),
          () => ({ ok: false, data: [] as TaskDefinition[] })
        );
        const [stationData, workerData, taskResult] = await Promise.all([
          apiRequest<Station[]>('/api/stations'),
          apiRequest<Worker[]>('/api/workers'),
          taskPromise,
        ]);
        setStations(stationData);
        setWorkers(workerData.filter((worker) => worker.active));
        setTaskDefinitions(taskResult.data);
        setTaskDefinitionsReady(taskResult.ok);
        const storedContext = parseStationContext(
          localStorage.getItem(STATION_CONTEXT_STORAGE_KEY)
        );
        const storedStationId = parseStoredStationId(
          localStorage.getItem(SPECIFIC_STATION_ID_STORAGE_KEY)
        );
        let resolvedContext = storedContext;
        if (!resolvedContext && storedStationId) {
          const exists = stationData.some((station) => station.id === storedStationId);
          if (exists) {
            resolvedContext = { kind: 'station', stationId: storedStationId };
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
        let resolvedStationId: number | null = null;
        if (normalizedContext && normalizedContext.kind === 'station') {
          resolvedStationId = normalizedContext.stationId;
        } else if (normalizedContext && storedStationId) {
          const station = stationData.find((item) => item.id === storedStationId) ?? null;
          if (station && isStationInContext(station, normalizedContext)) {
            resolvedStationId = storedStationId;
          } else {
            persistSpecificStationId(null);
          }
        }
        setSelectedStationId(resolvedStationId);
        if (!normalizedContext) {
          setShowSettings(true);
        } else if (normalizedContext.kind !== 'station' && !resolvedStationId) {
          setShowStationPicker(true);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo cargar la informacion de inicio de sesion.';
        setStatusMessage(message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    setFullscreenAvailable(Boolean(root?.requestFullscreen));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    localStorage.setItem(QR_SCANNING_STORAGE_KEY, String(qrScanningEnabled));
  }, [qrScanningEnabled]);

  const selectedStation = useMemo(
    () => stations.find((station) => station.id === selectedStationId) ?? null,
    [stations, selectedStationId]
  );

  const selectedWorker = useMemo(
    () => workers.find((worker) => worker.id === selectedWorkerId) ?? null,
    [workers, selectedWorkerId]
  );

  const availableWorkers = useMemo(() => {
    if (showAllWorkers || !selectedStationId) {
      return workers;
    }
    return workers.filter((worker) =>
      (worker.assigned_station_ids ?? []).includes(selectedStationId)
    );
  }, [workers, selectedStationId, showAllWorkers]);

  const shouldUseDropdown = showAllWorkers || availableWorkers.length > WORKER_THRESHOLD;

  const taskCoverage = useMemo(() => buildTaskCoverage(taskDefinitions), [taskDefinitions]);

  const stationHasTasks = React.useCallback(
    (station: Station): boolean => {
      if (!taskDefinitionsReady) {
        return true;
      }
      if (station.role === 'Panels') {
        return (
          station.sequence_order !== null &&
          taskCoverage.panelSequences.has(station.sequence_order)
        );
      }
      if (station.role === 'Assembly') {
        return (
          station.sequence_order !== null &&
          taskCoverage.moduleSequences.has(station.sequence_order)
        );
      }
      if (station.role === 'AUX') {
        if (
          station.sequence_order !== null &&
          (taskCoverage.auxSequences.has(station.sequence_order) ||
            taskCoverage.moduleSequences.has(station.sequence_order))
        ) {
          return true;
        }
        return taskCoverage.auxUnassigned || taskCoverage.moduleUnassigned;
      }
      return true;
    },
    [taskCoverage, taskDefinitionsReady]
  );

  const stationLabel = selectedStation ? formatStationLabel(selectedStation) : 'Sin estacion seleccionada';
  const stationIndicatorLabel = selectedStation ? formatStationLabel(selectedStation) : 'Selecciona estacion';
  const canSelectStation = stationContext !== null && stationContext.kind !== 'station';
  const stationSelectionRequired = canSelectStation && !selectedStationId;

  const assemblySequenceOrders = useMemo(() => {
    const orders = getAssemblySequenceOrders(stations);
    if (!taskDefinitionsReady) {
      return orders;
    }
    return orders.filter((order) => taskCoverage.moduleSequences.has(order));
  }, [stations, taskCoverage, taskDefinitionsReady]);

  const sessionStations = useMemo(() => {
    if (!stationContext || stationContext.kind === 'station') {
      return [];
    }
    return getStationsForContext(stations, stationContext);
  }, [stationContext, stations]);

  const sessionStationOptions = useMemo(
    () => sessionStations.filter((station) => stationHasTasks(station)),
    [sessionStations, stationHasTasks]
  );

  const panelStations = useMemo(() => {
    return [...stations]
      .filter((station) => station.role === 'Panels')
      .filter((station) => stationHasTasks(station))
      .sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0));
  }, [stations, stationHasTasks]);

  const assemblyStations = useMemo(() => {
    return [...stations]
      .filter((station) => station.role === 'Assembly')
      .filter((station) => stationHasTasks(station))
      .sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0));
  }, [stations, stationHasTasks]);

  const resetWorkerSelection = () => {
    setSelectedWorkerId(null);
    setShowAllWorkers(false);
  };

  const applyStationContext = (context: StationContext | null) => {
    setStationContext(context);
    persistStationContext(context);
    resetWorkerSelection();
  };

  const handleGroupContextSelect = (context: StationContext) => {
    applyStationContext(context);
    setSelectedStationId(null);
    persistSpecificStationId(null);
    setShowSettings(false);
    setShowStationPicker(true);
  };

  const handleSpecificStationSelect = (stationId: number) => {
    const context: StationContext = { kind: 'station', stationId };
    applyStationContext(context);
    setSelectedStationId(stationId);
    persistSpecificStationId(stationId);
    setShowSettings(false);
    setShowStationPicker(false);
  };

  useEffect(() => {
    if (!canSelectStation || showStationPicker || showSettings || pinModalOpen || pinChangeOpen) {
      return;
    }
    if (!selectedStationId) {
      setShowStationPicker(true);
      return;
    }
    let timer = window.setTimeout(() => setShowStationPicker(true), 45000);
    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setShowStationPicker(true), 45000);
    };
    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'touchstart',
      'keydown',
      'scroll',
    ];
    events.forEach((event) => window.addEventListener(event, resetTimer));
    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [canSelectStation, pinChangeOpen, pinModalOpen, selectedStationId, showSettings, showStationPicker]);

  useEffect(() => {
    if (!taskDefinitionsReady || !canSelectStation || !selectedStationId) {
      return;
    }
    const station = stations.find((item) => item.id === selectedStationId);
    if (station && !stationHasTasks(station)) {
      setSelectedStationId(null);
      persistSpecificStationId(null);
      setShowStationPicker(true);
    }
  }, [canSelectStation, selectedStationId, stationHasTasks, stations, taskDefinitionsReady]);

  const handleSessionStationSelect = (stationId: number) => {
    setSelectedStationId(stationId);
    persistSpecificStationId(stationId);
    resetWorkerSelection();
    setShowStationPicker(false);
  };

  const handleAdminLogin = async () => {
    setAdminSubmitting(true);
    setAdminError(null);
    try {
      await apiRequest('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          first_name: adminFirstName.trim(),
          last_name: adminLastName.trim(),
          pin: adminPin,
        }),
      });
      navigate('/admin');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fallo el inicio de sesion de admin.';
      setAdminError(message);
    } finally {
      setAdminSubmitting(false);
    }
  };

  const handleSysadminToggle = (checked: boolean) => {
    setUseSysadmin(checked);
    setAdminError(null);
    if (checked) {
      setAdminFirstName('sysadmin');
      setAdminLastName('sysadmin');
      setAdminPin('');
      return;
    }
    setAdminFirstName('');
    setAdminLastName('');
    setAdminPin('');
  };

  const handleOpenQcDashboard = () => {
    setShowSettings(false);
    navigate('/qc');
  };

  const openPinChange = (workerId: number) => {
    setPinChangeWorkerId(workerId);
    setPinChangeDraft('');
    setPinChangeConfirm('');
    setPinChangeError(null);
    setPinChangeOpen(true);
  };

  const handleWorkerLogin = async (
    worker: Worker,
    workerPin?: string | null,
    options?: { skipPinRequirement?: boolean }
  ) => {
    if (!selectedStationId) {
      setLoginError('Selecciona una estacion antes de iniciar tu turno.');
      return;
    }
    if (worker.login_required && !workerPin && !options?.skipPinRequirement) {
      setLoginError('Se requiere PIN para este trabajador.');
      return;
    }
    setSubmitting(true);
    setLoginError(null);
    setPinModalError(null);
    try {
      const response = await apiRequest<WorkerSessionResponse>('/api/worker-sessions/login', {
        method: 'POST',
        body: JSON.stringify({
          worker_id: worker.id,
          pin: worker.login_required && !options?.skipPinRequirement ? workerPin : null,
          station_id: selectedStationId,
        }),
      });
      if (response.require_pin_change) {
        setPinModalOpen(false);
        setPinModalWorkerId(null);
        setPinModalValue('');
        openPinChange(worker.id);
        return;
      }
      setPinModalOpen(false);
      setPinModalWorkerId(null);
      setPinModalValue('');
      navigate('/worker/stationWorkspace');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fallo el inicio de sesion del trabajador.';
      setLoginError(message);
      setPinModalError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQrDetected = (value: string) => {
    const matchedWorker = findWorkerByQrValue(value, workers);
    if (submitting) {
      return;
    }
    if (!matchedWorker) {
      return;
    }
    setSelectedWorkerId(matchedWorker.id);
    if (!selectedStationId) {
      setLoginError('Selecciona una estacion antes de iniciar tu turno.');
      setShowStationPicker(true);
      return;
    }
    void handleWorkerLogin(matchedWorker, null, { skipPinRequirement: true });
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!fullscreenAvailable || document.fullscreenElement) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select, a')) {
      return;
    }
    const now = Date.now();
    const lastTap = lastTapRef.current;
    lastTapRef.current = now;
    if (now - lastTap < 300) {
      void document.documentElement.requestFullscreen();
      lastTapRef.current = 0;
    }
  };

  const handlePinUpdate = async () => {
    if (!pinChangeWorkerId) {
      return;
    }
    if (pinChangeDraft.trim().length < 4) {
      setPinChangeError('El nuevo PIN debe tener al menos 4 digitos.');
      return;
    }
    if (pinChangeDraft !== pinChangeConfirm) {
      setPinChangeError('Los PIN no coinciden.');
      return;
    }
    setSubmitting(true);
    setPinChangeError(null);
    try {
      await apiRequest(`/api/workers/${pinChangeWorkerId}`, {
        method: 'PUT',
        body: JSON.stringify({ pin: pinChangeDraft }),
      });
      if (selectedStationId) {
        await apiRequest('/api/worker-sessions/login', {
          method: 'POST',
          body: JSON.stringify({
            worker_id: pinChangeWorkerId,
            pin: pinChangeDraft,
            station_id: selectedStationId,
          }),
        });
      }
      setPinChangeOpen(false);
      navigate('/worker/stationWorkspace');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar el PIN.';
      setPinChangeError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const openPinModal = (workerId: number) => {
    setPinModalWorkerId(workerId);
    setPinModalValue('');
    setPinModalError(null);
    setPinModalOpen(true);
  };

  const closePinModal = () => {
    setPinModalOpen(false);
    setPinModalWorkerId(null);
    setPinModalValue('');
    setPinModalError(null);
  };

  const handleWorkerSelection = (workerId: number) => {
    if (submitting) {
      return;
    }
    const worker = workers.find((item) => item.id === workerId);
    if (!worker) {
      return;
    }
    setSelectedWorkerId(workerId);
    setLoginError(null);
    if (!selectedStationId) {
      setLoginError('Selecciona una estacion antes de iniciar tu turno.');
      return;
    }
    if (worker.login_required) {
      openPinModal(workerId);
      return;
    }
    void handleWorkerLogin(worker, null);
  };

  const handlePinSubmit = async () => {
    if (!pinModalWorkerId) {
      return;
    }
    const worker = workers.find((item) => item.id === pinModalWorkerId);
    if (!worker) {
      setPinModalError('Trabajador no encontrado.');
      return;
    }
    if (!pinModalValue.trim()) {
      setPinModalError('Se requiere PIN para este trabajador.');
      return;
    }
    await handleWorkerLogin(worker, pinModalValue.trim());
  };

  return (
    <div
      className="min-h-screen bg-gray-100 flex flex-col lg:flex-row"
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-20 xl:px-24 bg-white shadow-xl z-10">
        <div className="mx-auto w-full max-w-2xl">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              disabled={!canSelectStation}
              onClick={() => {
                if (canSelectStation) {
                  setShowStationPicker(true);
                }
              }}
              className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition ${
                canSelectStation
                  ? 'border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-900'
                  : 'border-slate-200 text-slate-500'
              }`}
            >
              <MapPin className="h-4 w-4" />
              <span>{stationIndicatorLabel}</span>
            </button>
            <div className="flex items-center gap-3">
              <span
                className="flex h-9 w-9 items-center justify-center"
                title={qrScanningEnabled ? 'Escaneo QR activo' : 'Escaneo QR inactivo'}
                aria-hidden="true"
              >
                <QrCode
                  className={`h-4 w-4 ${
                    qrScanningEnabled ? 'text-slate-900' : 'text-slate-300'
                  }`}
                />
              </span>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                aria-label="Abrir ajustes"
              >
                <Settings className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="mt-8 mb-6">
            <h2 className="text-3xl font-extrabold text-gray-900">Ingreso a plataforma</h2>
          </div>

          {statusMessage && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              {statusMessage}
            </div>
          )}

          {loginError && (
            <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {loginError}
            </div>
          )}

          {loading ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
              Cargando lista de estaciones...
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <label htmlFor="worker" className="sr-only">
                  Quien eres?
                </label>
                {shouldUseDropdown ? (
                  <div className="relative">
                    <select
                      id="worker"
                      className="block w-full rounded-md border border-gray-300 bg-white py-4 pl-4 pr-10 text-base focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                      value={selectedWorkerId ?? ''}
                      onChange={(event) => {
                        const workerId = Number(event.target.value);
                        if (!Number.isNaN(workerId)) {
                          handleWorkerSelection(workerId);
                        }
                      }}
                    >
                      <option value="" disabled>
                        Selecciona tu nombre
                      </option>
                      {availableWorkers.map((worker) => (
                        <option key={worker.id} value={worker.id}>
                          {formatWorkerDisplayName(worker)}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                      <User className="h-5 w-5 text-gray-400" />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {availableWorkers.map((worker) => (
                      <button
                        key={worker.id}
                        onClick={() => handleWorkerSelection(worker.id)}
                        className={`w-full rounded-md border px-4 py-4 text-left transition-colors flex items-center justify-between ${
                          selectedWorkerId === worker.id
                            ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500'
                            : 'border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <span
                          className={`font-medium ${
                            selectedWorkerId === worker.id ? 'text-blue-900' : 'text-gray-900'
                          }`}
                        >
                          {formatWorkerDisplayName(worker)}
                        </span>
                        {selectedWorkerId === worker.id && (
                          <span className="h-2 w-2 rounded-full bg-blue-500" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <button
                  onClick={() => setShowAllWorkers((prev) => !prev)}
                  className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  No estas en tu estacion? Inicia sesion
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedStation?.role === 'Panels' && (
        <PanelStationGoalPanel stationId={selectedStation.id} stationLabel={stationLabel} />
      )}

      <LoginSettings
        open={showSettings}
        onClose={() => setShowSettings(false)}
        stationContext={stationContext}
        selectedStation={selectedStation}
        panelStations={panelStations}
        assemblyStations={assemblyStations}
        assemblySequenceOrders={assemblySequenceOrders}
        onSelectGroupContext={handleGroupContextSelect}
        onSelectSpecificStation={handleSpecificStationSelect}
        onOpenQc={handleOpenQcDashboard}
        onAdminLogin={handleAdminLogin}
        adminFirstName={adminFirstName}
        adminLastName={adminLastName}
        adminPin={adminPin}
        adminError={adminError}
        adminSubmitting={adminSubmitting}
        useSysadmin={useSysadmin}
        onAdminFirstNameChange={setAdminFirstName}
        onAdminLastNameChange={setAdminLastName}
        onAdminPinChange={setAdminPin}
        onUseSysadminChange={handleSysadminToggle}
        qrScanningEnabled={qrScanningEnabled}
        onQrScanningChange={setQrScanningEnabled}
      />

      <QRCodeScannerModal
        open={qrScanningEnabled}
        onClose={() => setQrScanningEnabled(false)}
        onDetected={handleQrDetected}
        variant="background"
      />

      {showStationPicker && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" />
            </div>

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">
              &#8203;
            </span>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-5xl sm:w-full">
              <div className="bg-white px-5 pt-6 pb-4 sm:p-8">
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                      <MapPin className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Seleccionar estacion</h3>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {sessionStationOptions.map((station) => {
                      const isAssembly = station.role === 'Assembly';
                      const showSmallName = isAssembly && station.line_type;
                      const mainLabel =
                        isAssembly && station.line_type
                          ? `Linea ${station.line_type}`
                          : station.name;
                      return (
                        <button
                          key={station.id}
                          onClick={() => handleSessionStationSelect(station.id)}
                          className="w-full rounded-md border border-gray-300 px-4 py-4 text-left transition-colors hover:bg-blue-50 hover:border-blue-500"
                        >
                          {isAssembly ? (
                            <div>
                              <span className="text-lg font-semibold text-gray-900">
                                {mainLabel}
                              </span>
                              {showSmallName && (
                                <span className="mt-1 block text-xs text-gray-500">
                                  {station.name}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              {station.line_type && (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                                  Linea {station.line_type}
                                </span>
                              )}
                              <span className="font-semibold text-gray-900">{station.name}</span>
                            </div>
                          )}
                          {!isAssembly && (
                            <span className="mt-1 block text-xs text-gray-500">
                              {station.role}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {sessionStationOptions.length === 0 && (
                      <div className="col-span-full rounded-md border border-dashed border-gray-200 px-4 py-4 text-sm text-gray-500">
                        No hay estaciones con tareas definidas para este contexto.
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {!stationSelectionRequired && (
                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 sm:mt-0 sm:ml-3 sm:w-auto"
                    onClick={() => setShowStationPicker(false)}
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {pinModalOpen && pinModalWorkerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-gray-500/70" onClick={closePinModal} />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900">PIN requerido</h3>
            <p className="mt-2 text-sm text-gray-500">
              Ingresa el PIN de{' '}
              {selectedWorker
                ? formatWorkerDisplayName(selectedWorker)
                : 'este trabajador'}{' '}
              para continuar.
            </p>
            {pinModalError && (
              <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                {pinModalError}
              </div>
            )}
            <div className="mt-4">
              <label htmlFor="pin-modal" className="block text-sm font-medium text-gray-700">
                Codigo PIN
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <input
                  type="password"
                  id="pin-modal"
                  className="block w-full rounded-md border border-gray-300 py-3 pl-3 pr-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder="Ingresa PIN"
                  value={pinModalValue}
                  onChange={(event) => setPinModalValue(event.target.value)}
                  autoFocus
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={closePinModal}
                className="flex-1 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handlePinSubmit}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                disabled={submitting}
              >
                Entrar
              </button>
            </div>
          </div>
        </div>
      )}

      {pinChangeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-gray-500/70" />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900">Cambio de PIN requerido</h3>
            <p className="mt-2 text-sm text-gray-500">
              Tu cuenta aun usa el PIN predeterminado. Define uno nuevo para continuar.
            </p>
            {pinChangeError && (
              <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                {pinChangeError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Nuevo PIN</label>
                <input
                  type="password"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  value={pinChangeDraft}
                  onChange={(event) => setPinChangeDraft(event.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Confirmar PIN</label>
                <input
                  type="password"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  value={pinChangeConfirm}
                  onChange={(event) => setPinChangeConfirm(event.target.value)}
                />
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setPinChangeOpen(false)}
                className="flex-1 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handlePinUpdate}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                disabled={submitting}
              >
                Actualizar PIN
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Login;
