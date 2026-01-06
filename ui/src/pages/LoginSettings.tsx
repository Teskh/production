import React, { useEffect, useMemo, useState } from 'react';
import { Eye, MapPin, Shield, X } from 'lucide-react';
import type { StationContext } from '../utils/stationContext';
import { formatStationLabel } from '../utils/stationContext';

type Station = {
  id: number;
  name: string;
  role: string;
  line_type: string | null;
  sequence_order: number | null;
};

type LoginSettingsProps = {
  open: boolean;
  stationContext: StationContext | null;
  selectedStation: Station | null;
  panelStations: Station[];
  assemblyStations: Station[];
  assemblySequenceOrders: number[];
  onSelectGroupContext: (context: StationContext) => void;
  onSelectSpecificStation: (stationId: number) => void;
  onOpenQc: () => void;
  onAdminLogin: () => void;
  adminFirstName: string;
  adminLastName: string;
  adminPin: string;
  adminError: string | null;
  adminSubmitting: boolean;
  useSysadmin: boolean;
  onAdminFirstNameChange: (value: string) => void;
  onAdminLastNameChange: (value: string) => void;
  onAdminPinChange: (value: string) => void;
  onUseSysadminChange: (checked: boolean) => void;
  onClose: () => void;
};

const normalizeStationName = (station: Station) => {
  const trimmed = station.name.trim();
  if (!station.line_type) {
    return trimmed;
  }
  const pattern = new RegExp(`^(Linea|Line)\\s*${station.line_type}\\s*-\\s*`, 'i');
  const normalized = trimmed.replace(pattern, '').trim();
  return normalized || trimmed;
};

const LoginSettings: React.FC<LoginSettingsProps> = ({
  open,
  stationContext,
  selectedStation,
  panelStations,
  assemblyStations,
  assemblySequenceOrders,
  onSelectGroupContext,
  onSelectSpecificStation,
  onOpenQc,
  onAdminLogin,
  adminFirstName,
  adminLastName,
  adminPin,
  adminError,
  adminSubmitting,
  useSysadmin,
  onAdminFirstNameChange,
  onAdminLastNameChange,
  onAdminPinChange,
  onUseSysadminChange,
  onClose,
}) => {
  const [contextMode, setContextMode] = useState<'group' | 'specific' | null>(null);
  const [specificType, setSpecificType] = useState<'panel' | 'assembly' | null>(null);
  const [groupMode, setGroupMode] = useState<'panel_line' | 'assembly_sequence' | 'aux' | null>(
    null
  );
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setAdminOpen(false);
    if (!stationContext) {
      setContextMode(null);
      setSpecificType(null);
      setGroupMode(null);
      return;
    }
    if (stationContext.kind === 'station') {
      setContextMode('specific');
      if (selectedStation?.role === 'Panels') {
        setSpecificType('panel');
      } else if (selectedStation?.role === 'Assembly') {
        setSpecificType('assembly');
      } else {
        setSpecificType(null);
      }
      setGroupMode(null);
      return;
    }
    setContextMode('group');
    if (stationContext.kind === 'panel_line') {
      setGroupMode('panel_line');
    } else if (stationContext.kind === 'aux') {
      setGroupMode('aux');
    } else {
      setGroupMode('assembly_sequence');
    }
    setSpecificType(null);
  }, [open, selectedStation, stationContext]);

  const currentContextLabel = useMemo(() => {
    if (!stationContext) {
      return 'Sin contexto definido';
    }
    if (stationContext.kind === 'panel_line') {
      return 'Linea de paneles';
    }
    if (stationContext.kind === 'aux') {
      return 'Auxiliar';
    }
    if (stationContext.kind === 'assembly_sequence') {
      return `Ensamble - secuencia ${stationContext.sequenceOrder}`;
    }
    if (selectedStation) {
      return formatStationLabel(selectedStation);
    }
    return 'Estacion especifica';
  }, [selectedStation, stationContext]);

  const specificStations = specificType === 'panel' ? panelStations : assemblyStations;
  const assemblySequenceLabelByOrder = useMemo(() => {
    const entries = new Map<number, Set<string>>();
    assemblyStations.forEach((station) => {
      if (station.sequence_order === null) {
        return;
      }
      const normalized = normalizeStationName(station);
      const existing = entries.get(station.sequence_order) ?? new Set<string>();
      existing.add(normalized);
      entries.set(station.sequence_order, existing);
    });
    const map = new Map<number, string>();
    entries.forEach((names, sequence) => {
      map.set(sequence, names.size ? Array.from(names).join(' / ') : `Secuencia ${sequence}`);
    });
    return map;
  }, [assemblyStations]);

  const handleAdminSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (adminSubmitting) {
      return;
    }
    onAdminLogin();
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center px-4 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-slate-900/60" onClick={onClose} aria-hidden="true" />

        <span className="hidden sm:inline-block sm:h-screen sm:align-middle" aria-hidden="true">
          &#8203;
        </span>

        <div className="inline-block w-full transform overflow-hidden rounded-xl bg-white text-left align-bottom shadow-xl transition-all sm:my-8 sm:align-middle sm:max-w-5xl">
          <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Ajustes del kiosco</h2>
              <p className="mt-1 text-xs text-slate-500">
                Configura accesos rapidos y el contexto de estacion.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="Cerrar ajustes"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1fr_1.4fr]">
            <section className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Accesos
                </h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={onOpenQc}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                  >
                    <span>QC Dashboard</span>
                    <Eye className="h-4 w-4 text-slate-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminOpen((prev) => !prev)}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                  >
                    <span>Admin Dashboard</span>
                    <Shield className="h-4 w-4 text-slate-400" />
                  </button>
                </div>

                {adminOpen && (
                  <form className="mt-5 space-y-3" onSubmit={handleAdminSubmit}>
                    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={useSysadmin}
                          onChange={(event) => onUseSysadminChange(event.target.checked)}
                        />
                        Usar sysadmin
                      </label>
                      <span>SYS_ADMIN_PASSWORD</span>
                    </div>

                    {adminError && (
                      <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                        {adminError}
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Nombre
                        </label>
                        <input
                          type="text"
                          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                          value={adminFirstName}
                          onChange={(event) => onAdminFirstNameChange(event.target.value)}
                          disabled={useSysadmin}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Apellido
                        </label>
                        <input
                          type="text"
                          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                          value={adminLastName}
                          onChange={(event) => onAdminLastNameChange(event.target.value)}
                          disabled={useSysadmin}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {useSysadmin ? 'Contraseña' : 'PIN'}
                      </label>
                      <input
                        type="password"
                        className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                        value={adminPin}
                        onChange={(event) => onAdminPinChange(event.target.value)}
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={adminSubmitting}
                      className={`w-full rounded-md px-4 py-2 text-sm font-semibold text-white transition ${
                        adminSubmitting ? 'bg-slate-400' : 'bg-slate-900 hover:bg-slate-800'
                      }`}
                    >
                      Entrar a Admin
                    </button>
                  </form>
                )}
              </div>
            </section>

            <section className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-800">Contexto de estacion</h3>
                </div>
                <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span className="font-semibold text-slate-700">Actual:</span> {currentContextLabel}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setContextMode('group');
                      setGroupMode(null);
                    }}
                    className={`rounded-lg border px-4 py-3 text-left text-sm font-semibold transition ${
                      contextMode === 'group'
                        ? 'border-blue-500 bg-blue-50 text-blue-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Grupo de estaciones
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setContextMode('specific');
                      setSpecificType(null);
                    }}
                    className={`rounded-lg border px-4 py-3 text-left text-sm font-semibold transition ${
                      contextMode === 'specific'
                        ? 'border-blue-500 bg-blue-50 text-blue-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Estacion especifica
                  </button>
                </div>

                {contextMode === 'group' && (
                  <div className="mt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => {
                          setGroupMode('panel_line');
                          onSelectGroupContext({ kind: 'panel_line' });
                        }}
                        className={`rounded-lg border px-4 py-3 text-left text-sm font-semibold transition ${
                          groupMode === 'panel_line'
                            ? 'border-blue-500 bg-blue-50 text-blue-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Linea de paneles
                      </button>
                      <button
                        type="button"
                        onClick={() => setGroupMode('assembly_sequence')}
                        className={`rounded-lg border px-4 py-3 text-left text-sm font-semibold transition ${
                          groupMode === 'assembly_sequence'
                            ? 'border-blue-500 bg-blue-50 text-blue-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Secuencia de ensamble
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGroupMode('aux');
                          onSelectGroupContext({ kind: 'aux' });
                        }}
                        className={`rounded-lg border px-4 py-3 text-left text-sm font-semibold transition ${
                          groupMode === 'aux'
                            ? 'border-blue-500 bg-blue-50 text-blue-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Auxiliar
                      </button>
                    </div>

                    {groupMode === 'assembly_sequence' && (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {assemblySequenceOrders.map((order) => {
                          const label = assemblySequenceLabelByOrder.get(order);
                          return (
                            <button
                              key={order}
                              type="button"
                              onClick={() =>
                                onSelectGroupContext({
                                  kind: 'assembly_sequence',
                                  sequenceOrder: order,
                                })
                              }
                              className="rounded-md border border-slate-200 px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                            >
                              <span className="block">
                                {label ?? `Secuencia ${order}`}
                              </span>
                              {label && (
                                <span className="mt-1 block text-xs text-slate-500">
                                  Secuencia {order}
                                </span>
                              )}
                            </button>
                          );
                        })}
                        {assemblySequenceOrders.length === 0 && (
                          <div className="col-span-full rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
                            No hay secuencias con tareas definidas.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {contextMode === 'specific' && (
                  <div className="mt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setSpecificType('panel')}
                        className={`rounded-lg border px-4 py-3 text-left text-sm font-semibold transition ${
                          specificType === 'panel'
                            ? 'border-blue-500 bg-blue-50 text-blue-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Panel
                      </button>
                      <button
                        type="button"
                        onClick={() => setSpecificType('assembly')}
                        className={`rounded-lg border px-4 py-3 text-left text-sm font-semibold transition ${
                          specificType === 'assembly'
                            ? 'border-blue-500 bg-blue-50 text-blue-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Ensamble
                      </button>
                    </div>

                    {specificType && (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {specificStations.map((station) => {
                          const isAssembly = specificType === 'assembly';
                          const showSmallName = isAssembly && station.line_type;
                          const mainLabel =
                            isAssembly && station.line_type
                              ? `Linea ${station.line_type}`
                              : station.name;
                          return (
                            <button
                              key={station.id}
                              type="button"
                              onClick={() => onSelectSpecificStation(station.id)}
                              className={`rounded-md border px-3 py-3 text-left text-sm font-semibold transition ${
                                selectedStation?.id === station.id
                                  ? 'border-blue-500 bg-blue-50 text-blue-900'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <span className={isAssembly ? 'text-lg font-semibold' : undefined}>
                                {mainLabel}
                              </span>
                              {showSmallName && (
                                <span className="mt-1 block text-xs text-slate-500">
                                  {station.name}
                                </span>
                              )}
                              {!isAssembly && station.line_type && (
                                <span className="mt-1 block text-xs text-slate-500">
                                  Linea {station.line_type}
                                </span>
                              )}
                            </button>
                          );
                        })}
                        {specificStations.length === 0 && (
                          <div className="col-span-full rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
                            No hay estaciones con tareas definidas.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginSettings;
