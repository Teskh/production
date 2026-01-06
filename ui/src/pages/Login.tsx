import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  Lock,
  MapPin,
  QrCode,
  Shield,
  User,
} from 'lucide-react';
import QRCodeScannerModal from '../components/QRCodeScannerModal';
import type { StationContext } from '../utils/stationContext';
import {
  SPECIFIC_STATION_ID_STORAGE_KEY,
  STATION_CONTEXT_STORAGE_KEY,
  formatStationContext,
  formatStationLabel,
  getAssemblySequenceOrders,
  getContextLabel,
  getStationsForContext,
  parseStationContext,
} from '../utils/stationContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type Station = {
  id: number;
  name: string;
  role: string;
  line_type: string | null;
  sequence_order: number | null;
};

type StationPickerMode =
  | { kind: 'station_list' }
  | { kind: 'panel_line' }
  | { kind: 'aux' }
  | { kind: 'assembly_sequence'; sequenceOrder: number };

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

const formatWorkerDisplayName = (worker: Pick<Worker, 'first_name' | 'last_name'>): string => {
  const first = firstNamePart(worker.first_name);
  const last = firstNamePart(worker.last_name);
  return [first, last].filter(Boolean).join(' ');
};

type ProductionQueueItem = {
  id: number;
  project_name: string;
  house_identifier: string;
  module_number: number;
  house_type_name: string;
  planned_start_datetime: string | null;
  status: string;
};

type WorkerSessionResponse = {
  worker: Worker;
  station_id: number | null;
  require_pin_change: boolean;
  idle_timeout_seconds: number | null;
};

const WORKER_THRESHOLD = 6;

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

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [stations, setStations] = useState<Station[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [queuePreview, setQueuePreview] = useState<ProductionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [stationContext, setStationContext] = useState<StationContext | null>(null);
  const [showContextPicker, setShowContextPicker] = useState(false);
  const [showStationPicker, setShowStationPicker] = useState(false);
  const [stationPickerMode, setStationPickerMode] = useState<StationPickerMode>({
    kind: 'station_list',
  });
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
  const [submitting, setSubmitting] = useState(false);
  const [pinChangeOpen, setPinChangeOpen] = useState(false);
  const [pinChangeWorkerId, setPinChangeWorkerId] = useState<number | null>(null);
  const [pinChangeDraft, setPinChangeDraft] = useState('');
  const [pinChangeConfirm, setPinChangeConfirm] = useState('');
  const [pinChangeError, setPinChangeError] = useState<string | null>(null);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [qrScanValue, setQrScanValue] = useState<string | null>(null);
  const [qrScanHint, setQrScanHint] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [stationData, workerData, queueData] = await Promise.all([
          apiRequest<Station[]>('/api/stations'),
          apiRequest<Worker[]>('/api/workers'),
          apiRequest<ProductionQueueItem[]>('/api/production-queue?include_completed=false'),
        ]);
        setStations(stationData);
        setWorkers(workerData.filter((worker) => worker.active));
        setQueuePreview(queueData.slice(0, 8));
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
        setStationPickerMode(modeFromContext(normalizedContext));
        let resolvedStationId: number | null = null;
        if (normalizedContext && normalizedContext.kind === 'station') {
          resolvedStationId = normalizedContext.stationId;
        }
        setSelectedStationId(resolvedStationId);
        if (!normalizedContext) {
          setShowContextPicker(true);
        } else if (normalizedContext.kind !== 'station') {
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
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo cargar la informacion de inicio de sesion.';
        setStatusMessage(message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

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

  const stationLabel = selectedStation ? formatStationLabel(selectedStation) : 'Sin estacion seleccionada';
  const contextLabel = useMemo(
    () => getContextLabel(stationContext, stations),
    [stationContext, stations]
  );
  const stationSelectionLabel = selectedStation
    ? formatStationLabel(selectedStation)
    : 'Selecciona estacion';

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
        label: 'Linea de paneles',
        mode: { kind: 'panel_line' },
        context: { kind: 'panel_line' },
      });
    }
    assemblySequenceOrders.forEach((order) => {
      const station = stations.find(
        (item) => item.role === 'Assembly' && item.sequence_order === order
      );
      options.push({
        label: station ? `Ensamble - ${station.name}` : `Secuencia de ensamble ${order}`,
        mode: { kind: 'assembly_sequence', sequenceOrder: order },
        context: { kind: 'assembly_sequence', sequenceOrder: order },
      });
    });
    if (stations.some((station) => station.role === 'AUX')) {
      options.push({
        label: 'Auxiliar',
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

  const handleContextModeSelect = (mode: StationPickerMode, context: StationContext | null) => {
    setStationPickerMode(mode);
    if (!context) {
      return;
    }
    setStationContext(context);
    persistStationContext(context);
    setSelectedStationId(null);
    persistSpecificStationId(null);
    setSelectedWorkerId(null);
    setShowAllWorkers(false);
    setShowContextPicker(false);
    setShowStationPicker(true);
  };

  const handleConfigStationSelect = (stationId: number) => {
    const context: StationContext = { kind: 'station', stationId };
    setStationContext(context);
    persistStationContext(context);
    setStationPickerMode(modeFromContext(context));
    setSelectedStationId(stationId);
    persistSpecificStationId(stationId);
    setSelectedWorkerId(null);
    setShowAllWorkers(false);
    setShowContextPicker(false);
    setShowStationPicker(false);
  };

  const handleSessionStationSelect = (stationId: number) => {
    setSelectedStationId(stationId);
    persistSpecificStationId(stationId);
    setSelectedWorkerId(null);
    setShowAllWorkers(false);
    setShowStationPicker(false);
  };

  const handleAdminLogin = async () => {
    setSubmitting(true);
    setLoginError(null);
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
      setLoginError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const openPinChange = (workerId: number) => {
    setPinChangeWorkerId(workerId);
    setPinChangeDraft('');
    setPinChangeConfirm('');
    setPinChangeError(null);
    setPinChangeOpen(true);
  };

  const handleWorkerLogin = async (worker: Worker, workerPin?: string | null) => {
    if (!selectedStationId) {
      setLoginError('Selecciona una estacion antes de iniciar tu turno.');
      return;
    }
    if (worker.login_required && !workerPin) {
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
          pin: worker.login_required ? workerPin : null,
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

  const handleQrDetected = (value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    setQrScanValue(normalized);
    setLoginError(null);
    const matchedWorker = workers.find((worker) => String(worker.id) === normalized);
    if (matchedWorker) {
      setSelectedWorkerId(matchedWorker.id);
      setShowAllWorkers(true);
      setQrScanHint(`Coincide con ${formatWorkerDisplayName(matchedWorker)}.`);
      handleWorkerSelection(matchedWorker.id);
    } else {
      setQrScanHint('Escaneo capturado. Aun no hay coincidencia de trabajador.');
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

  const formattedPreview = useMemo(() => {
    return queuePreview.map((item) => {
      const timeLabel = item.planned_start_datetime
        ? new Date(item.planned_start_datetime).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '--:--';
      const moduleLabel = `${item.house_identifier} - M${item.module_number}`;
      return {
        id: item.id,
        time: timeLabel,
        module: moduleLabel,
        task: item.house_type_name,
        status: item.status,
      };
    });
  }, [queuePreview]);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col lg:flex-row">
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-20 xl:px-24 bg-white shadow-xl z-10">
        <div className="mx-auto w-full max-w-sm lg:w-96">
          <div className="mb-8">
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
              {isAdmin ? 'Portal de Admin' : 'Ingreso de Trabajador'}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {isAdmin
                ? 'Ingresa tus credenciales para administrar el sistema.'
                : 'Confirma la estacion y selecciona tu identidad para comenzar.'}
            </p>
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
              {!isAdmin ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Contexto de estacion
                    </label>
                    <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4" />
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-gray-700">
                            {contextLabel}
                          </span>
                          {stationContext && stationContext.kind !== 'station' && (
                            <span className="text-xs text-gray-500">
                              Estacion: {stationSelectionLabel}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {stationContext && stationContext.kind !== 'station' && (
                          <button
                            onClick={() => setShowStationPicker(true)}
                            className="text-xs font-semibold uppercase text-blue-600 hover:text-blue-800"
                          >
                            Seleccionar estacion
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setStationPickerMode(modeFromContext(stationContext));
                            setShowContextPicker(true);
                          }}
                          className="text-xs font-semibold uppercase text-gray-500 hover:text-gray-700"
                        >
                          Configurar
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="worker" className="block text-sm font-medium text-gray-700 mb-2">
                      Quien eres?
                    </label>
                    {shouldUseDropdown ? (
                      <div className="relative">
                        <select
                          id="worker"
                          className="block w-full rounded-md border border-gray-300 bg-white py-3 pl-3 pr-10 text-base focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
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
                      <div className="grid grid-cols-1 gap-2">
                        {availableWorkers.map((worker) => (
                          <button
                            key={worker.id}
                            onClick={() => handleWorkerSelection(worker.id)}
                            className={`w-full rounded-md border px-4 py-3 text-left transition-colors flex items-center justify-between ${
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

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      {!showAllWorkers ? (
                        <button
                          onClick={() => setShowAllWorkers(true)}
                          className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          No estas en tu estacion? Inicia sesion
                        </button>
                      ) : (
                        <button
                          onClick={() => setShowAllWorkers(false)}
                          className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
                        >
                          Mostrar solo trabajadores de la estacion
                        </button>
                      )}

                      <button
                        className="ml-auto flex items-center text-sm text-blue-600 hover:text-blue-500"
                        type="button"
                        onClick={() => setQrScannerOpen(true)}
                      >
                        <QrCode className="mr-1 h-4 w-4" /> Escanear QR
                      </button>
                    </div>

                    {qrScanValue && (
                      <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                        <span className="font-semibold">Ultimo escaneo:</span> {qrScanValue}
                        {qrScanHint ? ` - ${qrScanHint}` : ''}
                      </div>
                    )}
                  </div>

                </>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={useSysadmin}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setUseSysadmin(checked);
                          if (checked) {
                            setAdminFirstName('sysadmin');
                            setAdminLastName('sysadmin');
                            setAdminPin('');
                          } else {
                            setAdminFirstName('');
                            setAdminLastName('');
                            setAdminPin('');
                          }
                        }}
                      />
                      Usar sysadmin
                    </label>
                    <span className="text-xs text-gray-500">Contraseña via SYS_ADMIN_PASSWORD</span>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Nombre</label>
                    <input
                      type="text"
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      value={adminFirstName}
                      onChange={(event) => setAdminFirstName(event.target.value)}
                      disabled={useSysadmin}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Apellido</label>
                    <input
                      type="text"
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      value={adminLastName}
                      onChange={(event) => setAdminLastName(event.target.value)}
                      disabled={useSysadmin}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      {useSysadmin ? 'Contraseña' : 'PIN'}
                    </label>
                    <input
                      type="password"
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      value={adminPin}
                      onChange={(event) => setAdminPin(event.target.value)}
                    />
                  </div>
                </>
              )}

              {isAdmin && (
                <div>
                  <button
                    onClick={handleAdminLogin}
                    disabled={submitting}
                    className={`w-full flex justify-center items-center py-3 px-4 rounded-md text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                      submitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    Entrar como Admin
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-6">
            <button
              onClick={() => {
                setIsAdmin(!isAdmin);
                setSelectedWorkerId(null);
                closePinModal();
                setLoginError(null);
                setQrScannerOpen(false);
                setUseSysadmin(false);
                setAdminFirstName('');
                setAdminLastName('');
                setAdminPin('');
              }}
              className="w-full flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <Shield className="w-4 h-4 mr-2 text-gray-500" />
              {isAdmin ? 'Cambiar a ingreso de trabajador' : 'Ingreso Admin'}
            </button>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 bg-slate-800 text-white p-12 flex-col">
        <div className="mb-8">
          <h3 className="text-xl font-bold flex items-center mb-2">
            <Calendar className="w-6 h-6 mr-2 text-blue-400" />
            Vista previa de la cola de produccion
          </h3>
          <p className="text-slate-400">
            {selectedStation
              ? `Proximos modulos para ${stationLabel}`
              : 'Proximos modulos del plan'}
          </p>
        </div>

        <div className="bg-slate-700 rounded-lg overflow-hidden shadow-lg flex-1">
          <table className="min-w-full divide-y divide-slate-600">
            <thead className="bg-slate-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                  Hora
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                  Modulo
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                  Tipo de casa
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-600">
              {formattedPreview.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-4 text-sm text-slate-300">
                    Aun no hay modulos proximos.
                  </td>
                </tr>
              ) : (
                formattedPreview.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-600 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">{row.time}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                      {row.module}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">{row.task}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showContextPicker && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" />
            </div>

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">
              &#8203;
            </span>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 sm:mx-0 sm:h-10 sm:w-10">
                    <MapPin className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">Contexto de estacion</h3>
                    <p className="mt-2 text-sm text-gray-500">
                      Define el contexto del kiosco y luego elige la estacion para esta sesion.
                    </p>
                    <div className="mt-4 space-y-2">
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
                            className={`w-full text-left px-4 py-3 border rounded-md transition-colors ${
                              isActive
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <span className="font-semibold block">{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    {stationPickerMode.kind === 'station_list' ? (
                      <div className="mt-5">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                          Estaciones
                        </p>
                        <div className="mt-2 grid grid-cols-1 gap-2">
                          {stationPickerStations.map((station) => (
                            <button
                              key={station.id}
                              onClick={() => handleConfigStationSelect(station.id)}
                              className={`w-full text-left px-4 py-3 border rounded-md transition-colors ${
                                selectedStationId === station.id
                                  ? 'border-blue-500 bg-blue-50'
                                  : 'border-gray-300 hover:bg-blue-50 hover:border-blue-500'
                              }`}
                            >
                              <span className="font-semibold block">{station.name}</span>
                              <span className="text-xs text-gray-500">
                                {station.role}
                                {station.line_type ? ` - Linea ${station.line_type}` : ''}
                              </span>
                            </button>
                          ))}
                          {stationPickerStations.length === 0 && (
                            <div className="rounded-md border border-dashed border-gray-200 px-4 py-3 text-xs text-gray-500">
                              No hay estaciones disponibles para este contexto.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-5 rounded-md border border-dashed border-gray-200 px-4 py-3 text-xs text-gray-500">
                        La seleccion de estacion ocurre despues de elegir el contexto.
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {!contextSelectionRequired && (
                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 sm:mt-0 sm:ml-3 sm:w-auto"
                    onClick={() => setShowContextPicker(false)}
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showStationPicker && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" />
            </div>

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">
              &#8203;
            </span>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 sm:mx-0 sm:h-10 sm:w-10">
                    <MapPin className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">Seleccionar estacion</h3>
                    <p className="mt-2 text-sm text-gray-500">
                      Elige la estacion para esta sesion.
                    </p>
                    <div className="mt-4 grid grid-cols-1 gap-2">
                      {sessionStations.map((station) => (
                        <button
                          key={station.id}
                          onClick={() => handleSessionStationSelect(station.id)}
                          className="w-full text-left px-4 py-3 border border-gray-300 rounded-md hover:bg-blue-50 hover:border-blue-500 transition-colors"
                        >
                          <span className="font-semibold block">{station.name}</span>
                          <span className="text-xs text-gray-500">
                            {station.role}
                            {station.line_type ? ` - Linea ${station.line_type}` : ''}
                          </span>
                        </button>
                      ))}
                      {sessionStations.length === 0 && (
                        <div className="rounded-md border border-dashed border-gray-200 px-4 py-3 text-xs text-gray-500">
                          No hay estaciones disponibles para este contexto.
                        </div>
                      )}
                    </div>
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

      <QRCodeScannerModal
        open={qrScannerOpen && !isAdmin}
        onClose={() => setQrScannerOpen(false)}
        onDetected={handleQrDetected}
      />
    </div>
  );
};

export default Login;
