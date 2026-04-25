import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  MessageSquare,
  Wrench,
  X,
} from 'lucide-react';
import clsx from 'clsx';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

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
  work_unit_id: number;
  status: 'Open' | 'Closed';
};

type QCReworkTaskSummary = {
  id: number;
  status: 'Open' | 'InProgress' | 'Done' | 'Canceled';
  check_status: 'Open' | 'Closed' | null;
  work_unit_id: number;
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

type QCComplaintSummary = {
  id: number;
  work_unit_id: number;
  status: 'Open' | 'ClosureProposed' | 'Closed';
};

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'paneles' | 'armado'>('paneles');

  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      try {
        const [stationsRes, qcDashboardRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/stations`, { credentials: 'include' }),
          fetch(`${API_BASE_URL}/api/qc/dashboard`, { credentials: 'include' }),
        ]);
        
        if (!stationsRes.ok) {
          throw new Error('No se pudieron cargar las estaciones.');
        }
        
        const stationsData = await stationsRes.json() as Station[];
        
        if (isMounted) {
          setStations(stationsData);
        }

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
      }
    };
    fetchData();
    const intervalId = setInterval(fetchData, 30000);
    return () => {
      isMounted = false;
      clearInterval(intervalId);
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
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadComplaints = async () => {
      if (!supervisorSession) {
        setComplaints([]);
        return;
      }
      try {
        const response = await fetch(`${API_BASE_URL}/api/qc/supervisor/complaints`, {
          credentials: 'include',
        });
        if (!isMounted) {
          return;
        }
        if (response.ok) {
          setComplaints(await response.json() as QCComplaintSummary[]);
        } else if (response.status === 401) {
          setSupervisorSession(null);
          setComplaints([]);
        }
      } catch {
        if (isMounted) {
          setComplaints([]);
        }
      }
    };
    void loadComplaints();
    const intervalId = window.setInterval(loadComplaints, 30000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [supervisorSession]);

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

  const alertsByWorkUnit = useMemo(() => {
    const alerts = new Map<
      number,
      { openChecks: number; reworks: number; complaints: number }
    >();
    const ensureEntry = (workUnitId: number) => {
      const existing = alerts.get(workUnitId);
      if (existing) {
        return existing;
      }
      const next = { openChecks: 0, reworks: 0, complaints: 0 };
      alerts.set(workUnitId, next);
      return next;
    };

    qcDashboard.pending_checks
      .filter((check) => check.status === 'Open')
      .forEach((check) => {
        ensureEntry(check.work_unit_id).openChecks += 1;
      });
    qcDashboard.rework_tasks
      .filter((task) => task.status === 'Open' || task.status === 'InProgress')
      .forEach((task) => {
        ensureEntry(task.work_unit_id).reworks += 1;
      });
    complaints
      .filter((complaint) => complaint.status !== 'Closed')
      .forEach((complaint) => {
        ensureEntry(complaint.work_unit_id).complaints += 1;
      });

    return alerts;
  }, [complaints, qcDashboard.pending_checks, qcDashboard.rework_tasks]);

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
      setComplaints([]);
    }
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
              <>
                <span className="hidden sm:inline-flex rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-600">
                  Supervisor: {fullName(supervisorSession.supervisor)}
                </span>
                <button
                  type="button"
                  onClick={handleSupervisorLogout}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  <LogOut className="h-4 w-4" />
                  Salir
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                <LogIn className="h-4 w-4" />
                Supervisor
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
                        <th className="w-16 pb-4 border-b border-gray-200 font-semibold text-gray-400 text-[10px] uppercase tracking-widest align-bottom">
                          Est.
                        </th>
                        {assemblyGrid.lines.map((line, lineIdx) => (
                          <th
                            key={line}
                            className={clsx(
                              'pb-4 pl-4 border-b border-gray-200 font-bold text-gray-900 align-bottom',
                              lineIdx > 0 && 'border-l border-gray-200'
                            )}
                          >
                            Línea {line}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {assemblyGrid.rows.map(row => {
                        const rowLabelStation = row.stations.find(Boolean);

                        return (
                        <tr key={row.sequence} className="hover:bg-gray-50/30 transition-colors group">
                          <td className="py-4 align-top text-xs font-black text-gray-700 pt-5 tracking-wide">
                            {rowLabelStation ? getStationInitials(rowLabelStation.name) : '-'}
                          </td>
                          {row.stations.map((station, colIdx) => {
                            if (!station) {
                              return (
                                <td
                                  key={`empty-${colIdx}`}
                                  className={clsx('p-4', colIdx > 0 && 'border-l border-gray-200')}
                                />
                              );
                            }

                            const stationSnapshot = snapshots[station.id];
                            const workItems = stationSnapshot?.work_items.filter((wi) => !isMagazineStatus(wi.status)) || [];

                            return (
                              <td
                                key={station.id}
                                className={clsx('py-4 pl-4 align-top', colIdx > 0 && 'border-l border-gray-200')}
                              >
                                <div className="flex flex-col gap-2">
                                  <div className="flex flex-col gap-1.5">
                                    {workItems.length > 0 ? (
                                      workItems.map(wu => (
                                        <div key={wu.id} className="group/item">
                                          <div className="flex min-h-7 items-center justify-between gap-2">
                                            <div className="flex items-baseline gap-1.5">
                                              <span className="flex-none font-bold text-gray-950 tabular-nums">
                                                {wu.house_identifier}
                                              </span>
                                              <span className="flex-none text-xs font-bold text-blue-700">
                                                M{wu.module_number}
                                              </span>
                                            </div>
                                            <div className="flex flex-none items-center gap-1">
                                              {(() => {
                                                const alerts = alertsByWorkUnit.get(wu.work_unit_id);
                                                if (!alerts) {
                                                  return null;
                                                }
                                                return (
                                                  <>
                                                    {alerts.reworks > 0 && (
                                                      <span
                                                        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700"
                                                        title="Re-trabajos QC abiertos"
                                                      >
                                                        <Wrench className="h-3 w-3" />
                                                        {alerts.reworks}
                                                      </span>
                                                    )}
                                                    {alerts.complaints > 0 && (
                                                      <span
                                                        className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700"
                                                        title="Observaciones abiertas asignadas al supervisor"
                                                      >
                                                        <MessageSquare className="h-3 w-3" />
                                                        {alerts.complaints}
                                                      </span>
                                                    )}
                                                    {alerts.openChecks > 0 && (
                                                      <span
                                                        className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700"
                                                        title="Checks QC abiertos"
                                                      >
                                                        <AlertTriangle className="h-3 w-3" />
                                                        {alerts.openChecks}
                                                      </span>
                                                    )}
                                                  </>
                                                );
                                              })()}
                                            </div>
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
                <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleStations.length === 0 ? (
                    <div className="col-span-full py-12 text-center text-gray-400">
                      No hay estaciones configuradas para esta vista.
                    </div>
                  ) : (
                    visibleStations.map((station) => {
                      const stationSnapshot = snapshots[station.id];
                      const workItems = stationSnapshot?.work_items.filter((wi) => !isMagazineStatus(wi.status)) || [];
                      
                      return (
                        <div 
                          key={station.id} 
                          className="bg-white border border-gray-100 hover:border-gray-200 transition-colors rounded-2xl p-5 flex flex-col shadow-sm"
                        >
                          <div className="flex items-center gap-3 mb-5">
                            <div className="bg-blue-50 text-blue-600 p-2.5 rounded-xl shrink-0">
                              <MapPin className="w-5 h-5" />
                            </div>
                            <h3 className="font-bold text-gray-900 text-lg truncate" title={station.name}>
                              {station.name}
                            </h3>
                          </div>
                          
                          <div className="flex-1 flex flex-col gap-3">
                            {workItems.length > 0 ? (
                              workItems.map(wu => (
                                <div key={wu.id} className="flex flex-col gap-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-gray-900">{wu.house_identifier}</span>
                                    <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                                      M{wu.module_number}
                                    </span>
                                    <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                      {formatProjectInitials(wu.project_name)}
                                    </span>
                                  </div>
                                  <div className="text-sm text-gray-500 truncate" title={wu.house_type_name}>
                                    {wu.house_type_name}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="flex-1 flex items-center text-gray-400 text-sm font-light">
                                Sin módulos en estación
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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
