import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, MapPin } from 'lucide-react';
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

const PanelLineSupervisorView: React.FC = () => {
  const navigate = useNavigate();
  const [stations, setStations] = useState<Station[]>([]);
  const [snapshots, setSnapshots] = useState<Record<number, StationSnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'paneles' | 'armado'>('paneles');

  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      try {
        const stationsRes = await fetch(`${API_BASE_URL}/api/stations`, { credentials: 'include' });
        
        if (!stationsRes.ok) {
          throw new Error('No se pudieron cargar las estaciones.');
        }
        
        const stationsData = await stationsRes.json() as Station[];
        
        if (isMounted) {
          setStations(stationsData);
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

  const formatProjectInitials = (name: string) => {
    if (!name) return '';
    return name
      .split(/\s+/)
      .map(word => word[0])
      .join('')
      .substring(0, 5)
      .toUpperCase();
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6 flex flex-col">
      <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col">
        <header className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-full border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Vista Supervisor</h1>
            <p className="text-sm text-gray-500 mt-1">
              Monitoreo simplificado de estaciones
            </p>
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
            <div className="flex items-center gap-2 mb-4">
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
            </div>
            
            <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-4 md:p-6 flex-1">
              <div className={clsx(
                "grid gap-4",
                activeTab === 'armado' ? "grid-cols-3" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              )}>
                {visibleStations.map((station) => {
                  const stationSnapshot = snapshots[station.id];
                  const workItems =
                    stationSnapshot?.work_items.filter((wi) => !isMagazineStatus(wi.status)) || [];
                  const isAssembly = activeTab === 'armado';
                  
                  return (
                    <div 
                      key={station.id} 
                      className={clsx(
                        "rounded-2xl border flex flex-col relative overflow-hidden",
                        isAssembly ? "border-gray-100 bg-white shadow-sm p-2" : "border-gray-200 bg-gray-50 p-4"
                      )}
                    >
                      {isAssembly && station.line_type && (
                        <div className="absolute top-0 right-0 bg-blue-50 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-bl-xl border-b border-l border-blue-100">
                          L{station.line_type} - {getStationInitials(station.name) || '-'}
                        </div>
                      )}
                      
                      {!isAssembly && (
                        <div className="flex items-center gap-3 mb-3">
                          <div className="bg-blue-100 text-blue-600 p-2 rounded-lg shrink-0">
                            <MapPin className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 pr-8">
                            <h3 className="font-semibold text-gray-900 truncate" title={station.name}>
                              {station.name}
                            </h3>
                          </div>
                        </div>
                      )}
                      
                      <div className="flex-1 flex flex-col gap-2 mt-1">
                        {workItems.length > 0 ? (
                          workItems.map(wu => (
                            <div key={wu.id} className={clsx(
                              "rounded-xl border shadow-sm flex flex-col",
                              isAssembly ? "p-2 border-gray-100" : "bg-white p-3 border-gray-200"
                            )}>
                              {isAssembly ? (
                                <>
                                  <div className="flex items-end justify-between gap-2">
                                    <div className="flex items-end gap-1.5 leading-none">
                                      <span className="text-xl font-bold text-gray-900">
                                        {wu.house_identifier}
                                      </span>
                                      <span className="text-xs font-semibold text-gray-500 mb-0.5">
                                        M{wu.module_number}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-500">
                                    <span className="shrink-0 text-[10px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                      {formatProjectInitials(wu.project_name)}
                                    </span>
                                    <span className="truncate" title={wu.house_type_name}>
                                      {wu.house_type_name}
                                    </span>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                      {formatProjectInitials(wu.project_name)}
                                    </span>
                                    <span className="text-xs font-semibold text-blue-600">
                                      M{wu.module_number}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between text-xs text-gray-500">
                                    <span className="truncate max-w-[60%]" title={wu.house_type_name}>
                                      {wu.house_type_name}
                                    </span>
                                    <span className="font-medium text-gray-700">
                                      {wu.house_identifier}
                                    </span>
                                  </div>
                                </>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className={clsx(
                            "flex-1 flex items-center justify-center italic text-gray-400",
                            isAssembly ? "text-xs py-2" : "text-sm py-4"
                          )}>
                            {isAssembly ? 'Vacío' : 'Sin módulos en estación'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {visibleStations.length === 0 && (
                  <div className="col-span-full py-8 text-center text-gray-500">
                    No hay estaciones configuradas para esta vista.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PanelLineSupervisorView;
