import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Calendar,
  Lock,
  MapPin,
  QrCode,
  Shield,
  User,
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type Station = {
  id: number;
  name: string;
  role: string;
  line_type: string | null;
  sequence_order: number | null;
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
    throw new Error(text || `Request failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
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
  const [showStationPicker, setShowStationPicker] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [showAllWorkers, setShowAllWorkers] = useState(false);
  const [adminFirstName, setAdminFirstName] = useState('');
  const [adminLastName, setAdminLastName] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pinChangeOpen, setPinChangeOpen] = useState(false);
  const [pinChangeWorkerId, setPinChangeWorkerId] = useState<number | null>(null);
  const [pinChangeDraft, setPinChangeDraft] = useState('');
  const [pinChangeConfirm, setPinChangeConfirm] = useState('');
  const [pinChangeError, setPinChangeError] = useState<string | null>(null);

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
        const savedStation = localStorage.getItem('selectedSpecificStationId');
        if (savedStation) {
          const stationId = Number(savedStation);
          if (!Number.isNaN(stationId)) {
            setSelectedStationId(stationId);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load login data.';
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

  const stationLabel = selectedStation
    ? `${selectedStation.name}${
        selectedStation.role === 'Assembly' && selectedStation.line_type
          ? ` - Line ${selectedStation.line_type}`
          : ''
      }`
    : 'No station selected';

  const storeStationContext = (stationId: number | null) => {
    if (stationId === null) {
      localStorage.removeItem('selectedStationContext');
      localStorage.removeItem('selectedSpecificStationId');
      return;
    }
    localStorage.setItem('selectedStationContext', `station:${stationId}`);
    localStorage.setItem('selectedSpecificStationId', String(stationId));
  };

  const handleStationSelect = (stationId: number) => {
    setSelectedStationId(stationId);
    storeStationContext(stationId);
    setSelectedWorkerId(null);
    setPin('');
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
      const message = error instanceof Error ? error.message : 'Admin login failed.';
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

  const handleWorkerLogin = async () => {
    if (!selectedWorker) {
      setLoginError('Select your name to continue.');
      return;
    }
    if (!selectedStationId) {
      setLoginError('Select a station before starting your shift.');
      return;
    }
    if (selectedWorker.login_required && !pin) {
      setLoginError('PIN is required for this worker.');
      return;
    }
    setSubmitting(true);
    setLoginError(null);
    try {
      const response = await apiRequest<WorkerSessionResponse>('/api/worker-sessions/login', {
        method: 'POST',
        body: JSON.stringify({
          worker_id: selectedWorker.id,
          pin: selectedWorker.login_required ? pin : null,
          station_id: selectedStationId,
        }),
      });
      if (response.require_pin_change) {
        openPinChange(selectedWorker.id);
        return;
      }
      navigate('/worker/stationWorkspace');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Worker login failed.';
      setLoginError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePinUpdate = async () => {
    if (!pinChangeWorkerId) {
      return;
    }
    if (pinChangeDraft.trim().length < 4) {
      setPinChangeError('New PIN must be at least 4 digits.');
      return;
    }
    if (pinChangeDraft !== pinChangeConfirm) {
      setPinChangeError('PIN entries do not match.');
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
      const message = error instanceof Error ? error.message : 'Failed to update PIN.';
      setPinChangeError(message);
    } finally {
      setSubmitting(false);
    }
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
              {isAdmin ? 'Admin Portal' : 'Worker Sign In'}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {isAdmin
                ? 'Enter your credentials to manage the system.'
                : 'Confirm the station and select your identity to begin.'}
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
              Loading station roster...
            </div>
          ) : (
            <div className="space-y-6">
              {!isAdmin ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Station Context
                    </label>
                    <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        <span>{stationLabel}</span>
                      </div>
                      <button
                        onClick={() => setShowStationPicker(true)}
                        className="text-xs font-semibold uppercase text-blue-600 hover:text-blue-800"
                      >
                        Change
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="worker" className="block text-sm font-medium text-gray-700 mb-2">
                      Who are you?
                    </label>
                    {shouldUseDropdown ? (
                      <div className="relative">
                        <select
                          id="worker"
                          className="block w-full rounded-md border border-gray-300 bg-white py-3 pl-3 pr-10 text-base focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                          value={selectedWorkerId ?? ''}
                          onChange={(event) => setSelectedWorkerId(Number(event.target.value))}
                        >
                          <option value="" disabled>
                            Select your name
                          </option>
                          {availableWorkers.map((worker) => (
                            <option key={worker.id} value={worker.id}>
                              {worker.first_name} {worker.last_name}
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
                            onClick={() => setSelectedWorkerId(worker.id)}
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
                              {worker.first_name} {worker.last_name}
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
                          Not in your station? Log in
                        </button>
                      ) : (
                        <button
                          onClick={() => setShowAllWorkers(false)}
                          className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
                        >
                          Show station workers only
                        </button>
                      )}

                      <button
                        className="ml-auto flex items-center text-sm text-blue-600 hover:text-blue-500"
                        type="button"
                      >
                        <QrCode className="mr-1 h-4 w-4" /> Scan Badge (soon)
                      </button>
                    </div>
                  </div>

                  {selectedWorker && selectedWorker.login_required ? (
                    <div>
                      <label htmlFor="pin" className="block text-sm font-medium text-gray-700">
                        PIN Code
                      </label>
                      <div className="mt-1 relative rounded-md shadow-sm">
                        <input
                          type="password"
                          id="pin"
                          className="block w-full rounded-md border border-gray-300 py-3 pl-3 pr-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                          placeholder="Enter PIN"
                          value={pin}
                          onChange={(event) => setPin(event.target.value)}
                        />
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                          <Lock className="h-5 w-5 text-gray-400" />
                        </div>
                      </div>
                    </div>
                  ) : selectedWorker ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                      PIN not required for this worker.
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">First name</label>
                    <input
                      type="text"
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      value={adminFirstName}
                      onChange={(event) => setAdminFirstName(event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Last name</label>
                    <input
                      type="text"
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      value={adminLastName}
                      onChange={(event) => setAdminLastName(event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">PIN</label>
                    <input
                      type="password"
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      value={adminPin}
                      onChange={(event) => setAdminPin(event.target.value)}
                    />
                  </div>
                </>
              )}

              <div>
                <button
                  onClick={isAdmin ? handleAdminLogin : handleWorkerLogin}
                  disabled={submitting}
                  className={`w-full flex justify-center items-center py-3 px-4 rounded-md text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                    submitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {isAdmin ? 'Log in as Admin' : 'Start Shift'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          <div className="mt-6">
            <button
              onClick={() => {
                setIsAdmin(!isAdmin);
                setSelectedWorkerId(null);
                setPin('');
                setLoginError(null);
              }}
              className="w-full flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <Shield className="w-4 h-4 mr-2 text-gray-500" />
              {isAdmin ? 'Switch to Worker Login' : 'Admin Login'}
            </button>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 bg-slate-800 text-white p-12 flex-col">
        <div className="mb-8">
          <h3 className="text-xl font-bold flex items-center mb-2">
            <Calendar className="w-6 h-6 mr-2 text-blue-400" />
            Production Queue Preview
          </h3>
          <p className="text-slate-400">
            {selectedStation ? `Upcoming modules for ${selectedStation.name}` : 'Upcoming modules from the plan'}
          </p>
        </div>

        <div className="bg-slate-700 rounded-lg overflow-hidden shadow-lg flex-1">
          <table className="min-w-full divide-y divide-slate-600">
            <thead className="bg-slate-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                  Time
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                  Module
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                  House Type
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-600">
              {formattedPreview.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-4 text-sm text-slate-300">
                    No upcoming modules yet.
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
                    <h3 className="text-lg leading-6 font-medium text-gray-900">Select Station</h3>
                    <p className="mt-2 text-sm text-gray-500">
                      Choose the station context for this kiosk.
                    </p>
                    <div className="mt-4 grid grid-cols-1 gap-2">
                      {stations.map((station) => (
                        <button
                          key={station.id}
                          onClick={() => handleStationSelect(station.id)}
                          className="w-full text-left px-4 py-3 border border-gray-300 rounded-md hover:bg-blue-50 hover:border-blue-500 transition-colors"
                        >
                          <span className="font-semibold block">{station.name}</span>
                          <span className="text-xs text-gray-500">
                            {station.role}
                            {station.line_type ? ` - Line ${station.line_type}` : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 sm:mt-0 sm:ml-3 sm:w-auto"
                  onClick={() => setShowStationPicker(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pinChangeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-gray-500/70" />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900">PIN change required</h3>
            <p className="mt-2 text-sm text-gray-500">
              Your account is still using the default PIN. Please set a new one to continue.
            </p>
            {pinChangeError && (
              <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                {pinChangeError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">New PIN</label>
                <input
                  type="password"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  value={pinChangeDraft}
                  onChange={(event) => setPinChangeDraft(event.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Confirm PIN</label>
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
                Cancel
              </button>
              <button
                onClick={handlePinUpdate}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                disabled={submitting}
              >
                Update PIN
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
