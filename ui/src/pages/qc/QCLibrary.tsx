import React, { useMemo, useState } from 'react';
import {
  Search,
  ChevronRight,
  X,
  CheckCircle,
  AlertTriangle,
  Clock,
  ArrowDownCircle,
  FileText,
  User,
} from 'lucide-react';
import { MODULE_HISTORY, MODULE_TIMELINE } from '../../services/qcMockData';

type ModuleHistoryItem = (typeof MODULE_HISTORY)[number];

const statusLabels: Record<string, string> = {
  Completed: 'COMPLETADO',
  Assembly: 'ENSAMBLAJE',
  Magazine: 'MAGAZINE',
};

const lastCheckLabels: Record<string, string> = {
  Passed: 'Aprobado',
  Failed: 'Fallido',
  Pending: 'Pendiente',
};

const QCLibrary: React.FC = () => {
  const [selectedModule, setSelectedModule] = useState<ModuleHistoryItem | null>(null);
  const [filterStatus, setFilterStatus] = useState<'All' | 'Assembly' | 'Magazine' | 'Completed'>(
    'All'
  );
  const [searchTerm, setSearchTerm] = useState('');

  const filteredModules = useMemo(() => {
    const normalizedTerm = searchTerm.trim().toLowerCase();
    return MODULE_HISTORY.filter((module) => {
      const matchesStatus = filterStatus === 'All' || module.status === filterStatus;
      const matchesSearch =
        !normalizedTerm ||
        module.moduleNumber.toLowerCase().includes(normalizedTerm) ||
        module.houseType.toLowerCase().includes(normalizedTerm);
      return matchesStatus && matchesSearch;
    });
  }, [filterStatus, searchTerm]);

  const renderTimelineEvents = () =>
    MODULE_TIMELINE.map((event) => (
      <div key={event.id} className="relative pl-16 group">
        <div
          className={`absolute left-0 w-12 h-12 rounded-full border-4 border-white shadow-sm flex items-center justify-center z-10 ${
            event.type === 'check' && event.status === 'Pass'
              ? 'bg-emerald-100 text-emerald-600'
              : event.type === 'check' && event.status === 'Fail'
              ? 'bg-rose-100 text-rose-600'
              : event.type === 'rework'
              ? 'bg-amber-100 text-amber-600'
              : 'bg-slate-100 text-slate-500'
          }`}
        >
          {event.type === 'check' && event.status === 'Pass' ? (
            <CheckCircle className="w-6 h-6" />
          ) : event.type === 'check' && event.status === 'Fail' ? (
            <AlertTriangle className="w-6 h-6" />
          ) : event.type === 'rework' ? (
            <FileText className="w-6 h-6" />
          ) : (
            <ArrowDownCircle className="w-6 h-6" />
          )}
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {event.timestamp}
            </span>
            {event.status && (
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  event.status === 'Pass'
                    ? 'bg-emerald-50 text-emerald-700'
                    : event.status === 'Fail'
                    ? 'bg-rose-50 text-rose-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {event.status}
              </span>
            )}
          </div>
          <h4 className="font-bold text-slate-900 text-lg">{event.title}</h4>
          <p className="text-slate-600 text-sm mt-1">{event.subtitle}</p>

          {event.user && (
            <div className="mt-3 flex items-center text-xs text-slate-400 font-medium">
              <User className="w-3 h-3 mr-1" />
              {event.user}
            </div>
          )}
        </div>
      </div>
    ));

  return (
    <div className="h-full flex flex-col bg-slate-50 relative">
      <div className="px-8 py-6 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Historial y trazabilidad QC
          </h1>
          <div className="text-sm text-slate-500">{filteredModules.length} módulos encontrados</div>
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por ID de módulo o tipo de casa..."
              className="pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none w-full shadow-sm"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          <select
            className="px-4 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer shadow-sm"
            value={filterStatus}
            onChange={(event) =>
              setFilterStatus(event.target.value as 'All' | 'Assembly' | 'Magazine' | 'Completed')
            }
          >
            <option value="All">Todos los estados</option>
            <option value="Assembly">En ensamblaje</option>
            <option value="Magazine">Magazine</option>
            <option value="Completed">Completado</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-8">
        <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden h-full">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4">Número de módulo</th>
                  <th className="px-6 py-4">Tipo de casa</th>
                  <th className="px-6 py-4">Estado actual</th>
                  <th className="px-6 py-4">Última inspección</th>
                  <th className="px-6 py-4 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredModules.map((module) => (
                  <tr
                    key={module.moduleNumber}
                    onClick={() => setSelectedModule(module)}
                    className="hover:bg-blue-50 cursor-pointer transition-colors group"
                  >
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-900 text-base">{module.moduleNumber}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-700">{module.houseType}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                          module.status === 'Completed'
                            ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                            : module.status === 'Assembly'
                            ? 'bg-sky-100 text-sky-700 border-sky-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {(statusLabels[module.status] ?? module.status).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        {module.lastCheck === 'Passed' && (
                          <CheckCircle className="w-4 h-4 text-emerald-500 mr-2" />
                        )}
                        {module.lastCheck === 'Failed' && (
                          <AlertTriangle className="w-4 h-4 text-rose-500 mr-2" />
                        )}
                        {module.lastCheck === 'Pending' && (
                          <Clock className="w-4 h-4 text-slate-400 mr-2" />
                        )}
                        <span
                          className={`font-medium ${
                            module.lastCheck === 'Failed'
                              ? 'text-rose-600'
                              : module.lastCheck === 'Passed'
                              ? 'text-emerald-600'
                              : 'text-slate-500'
                          }`}
                        >
                          {lastCheckLabels[module.lastCheck] ?? module.lastCheck}
                        </span>
                        {module.pendingRework > 0 && (
                          <span className="ml-3 px-2 py-0.5 bg-rose-100 text-rose-700 text-[10px] font-bold rounded-full border border-rose-200">
                            {module.pendingRework} defectos activos
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500 transition-colors" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className="hidden lg:flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {selectedModule ? (
              <>
                <div className="px-6 py-5 border-b border-gray-100 bg-white flex justify-between items-start">
                  <div>
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">
                      Trazabilidad del módulo
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900">{selectedModule.moduleNumber}</h2>
                    <p className="text-slate-500 mt-1 flex items-center gap-2">
                      <span>{selectedModule.houseType}</span>
                      <span className="text-slate-300">·</span>
                      <span>{selectedModule.status}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedModule(null)}
                    className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 relative">
                  <div className="absolute left-6 top-6 bottom-6 w-0.5 bg-slate-200" />
                  <div className="space-y-8 relative">{renderTimelineEvents()}</div>
                </div>
                <div className="p-4 border-t border-gray-200 bg-white flex justify-end space-x-3">
                  <button className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium text-sm border border-slate-200 rounded-lg hover:bg-slate-50">
                    Descargar reporte PDF
                  </button>
                  <button className="px-4 py-2 bg-blue-600 text-white font-medium text-sm rounded-lg hover:bg-blue-700 shadow-sm">
                    Ver detalles completos
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 p-6 flex flex-col items-center justify-center text-sm text-slate-500">
                <div className="text-slate-400 mb-2">Selecciona un módulo para ver trazabilidad</div>
                <div className="text-xs uppercase tracking-[0.35em] text-slate-300">Vista detallada</div>
              </div>
            )}
          </aside>
        </div>
      </div>

      {selectedModule && (
        <div className="lg:hidden absolute inset-0 z-50 flex justify-end overflow-hidden">
          <div
            className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm transition-opacity"
            onClick={() => setSelectedModule(null)}
          />
          <div className="w-full max-w-2xl bg-white h-full shadow-2xl relative flex flex-col animate-in slide-in-from-right duration-300">
            <div className="px-8 py-6 border-b border-gray-100 bg-white flex justify-between items-start z-10 shadow-sm">
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Trazabilidad del módulo
                </div>
                <h2 className="text-3xl font-bold text-slate-900">{selectedModule.moduleNumber}</h2>
                <p className="text-slate-500 mt-1 flex items-center gap-2">
                  <span>{selectedModule.houseType}</span>
                  <span className="text-slate-300">·</span>
                  <span>{selectedModule.status}</span>
                </p>
              </div>
              <button
                onClick={() => setSelectedModule(null)}
                className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
              <div className="relative">
                <div className="absolute left-6 top-4 bottom-4 w-0.5 bg-slate-200" />
                <div className="space-y-8">{renderTimelineEvents()}</div>
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 bg-white flex justify-end space-x-3">
              <button className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium text-sm border border-slate-200 rounded-lg hover:bg-slate-50">
                Descargar reporte PDF
              </button>
              <button className="px-4 py-2 bg-blue-600 text-white font-medium text-sm rounded-lg hover:bg-blue-700 shadow-sm">
                Ver detalles completos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QCLibrary;
