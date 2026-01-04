import React, { useState } from 'react';
import { 
  Search, Filter, ChevronRight, X, 
  CheckCircle, AlertTriangle, Clock, FileText,
  ArrowDownCircle, PlayCircle, StopCircle, User
} from 'lucide-react';
import { MODULE_HISTORY, MODULE_TIMELINE } from '../../services/qcMockData';

const QCLibrary: React.FC = () => {
  const [selectedModule, setSelectedModule] = useState<typeof MODULE_HISTORY[0] | null>(null);
  const [filterStatus, setFilterStatus] = useState<'All' | 'Assembly' | 'Magazine' | 'Completed'>('All');
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

  const filteredModules = MODULE_HISTORY.filter(m => 
    filterStatus === 'All' || m.status === filterStatus
  );

  return (
    <div className="h-full flex flex-col bg-slate-50 relative">
      
      {/* Header / Filter Bar */}
      <div className="px-8 py-6 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Historial y trazabilidad QC
            </h1>
            <div className="text-sm text-slate-500">
                {filteredModules.length} modulos encontrados
            </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Buscar por ID de modulo, tipo de casa..." 
              className="pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none w-full shadow-sm"
            />
          </div>
          <select 
            className="px-4 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer shadow-sm"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
          >
            <option value="All">Todos los estados</option>
            <option value="Assembly">En ensamblaje</option>
            <option value="Magazine">Magazine</option>
            <option value="Completed">Completado</option>
          </select>
        </div>
      </div>

      {/* Main List */}
      <div className="flex-1 overflow-auto p-8">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4">Numero de modulo</th>
                <th className="px-6 py-4">Tipo de casa</th>
                <th className="px-6 py-4">Estado actual</th>
                <th className="px-6 py-4">Ultima inspeccion</th>
                <th className="px-6 py-4 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredModules.map((mod) => (
                <tr 
                    key={mod.moduleNumber} 
                    onClick={() => setSelectedModule(mod)}
                    className="hover:bg-blue-50 cursor-pointer transition-colors group"
                >
                  <td className="px-6 py-4">
                      <div className="font-bold text-slate-900 text-base">{mod.moduleNumber}</div>
                  </td>
                  <td className="px-6 py-4">
                      <div className="font-medium text-slate-700">{mod.houseType}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                      mod.status === 'Completed' ? 'bg-green-100 text-green-700 border-green-200' :
                      mod.status === 'Assembly' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                      'bg-slate-100 text-slate-600 border-slate-200'
                    }`}>
                      {(statusLabels[mod.status] ?? mod.status).toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                        {mod.lastCheck === 'Passed' && <CheckCircle className="w-4 h-4 text-emerald-500 mr-2" />}
                        {mod.lastCheck === 'Failed' && <AlertTriangle className="w-4 h-4 text-rose-500 mr-2" />}
                        {mod.lastCheck === 'Pending' && <Clock className="w-4 h-4 text-slate-400 mr-2" />}
                        <span className={`font-medium ${
                             mod.lastCheck === 'Failed' ? 'text-rose-600' : 
                             mod.lastCheck === 'Passed' ? 'text-emerald-600' : 'text-slate-500'
                        }`}>
                            {lastCheckLabels[mod.lastCheck] ?? mod.lastCheck}
                        </span>
                        {mod.pendingRework > 0 && (
                            <span className="ml-3 px-2 py-0.5 bg-rose-100 text-rose-700 text-[10px] font-bold rounded-full border border-rose-200">
                                {mod.pendingRework} defectos activos
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
      </div>

      {/* Detail Slide-over */}
      {selectedModule && (
          <div className="absolute inset-0 z-50 flex justify-end overflow-hidden">
              <div 
                className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm transition-opacity"
                onClick={() => setSelectedModule(null)}
              ></div>
              <div className="w-full max-w-2xl bg-white h-full shadow-2xl transform transition-transform relative flex flex-col animate-in slide-in-from-right duration-300">
                  
                  {/* Slide-over Header */}
                  <div className="px-8 py-6 border-b border-gray-100 bg-white flex justify-between items-start z-10 shadow-sm">
                      <div>
                          <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">
                            Trazabilidad del modulo
                          </div>
                          <h2 className="text-3xl font-bold text-slate-900">{selectedModule.moduleNumber}</h2>
                          <p className="text-slate-500 mt-1 flex items-center">
                              {selectedModule.houseType}{' '}
                              <span className="mx-2 text-slate-300">-</span>{' '}
                              {selectedModule.status}
                          </p>
                      </div>
                      <button 
                        onClick={() => setSelectedModule(null)}
                        className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                      >
                          <X className="w-6 h-6" />
                      </button>
                  </div>

                  {/* Timeline Content */}
                  <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
                      
                      <div className="relative">
                          {/* Timeline Vertical Line */}
                          <div className="absolute left-6 top-4 bottom-4 w-0.5 bg-slate-200"></div>

                          <div className="space-y-8">
                              {MODULE_TIMELINE.map((event, idx) => (
                                  <div key={event.id} className="relative pl-16 group">
                                      {/* Timeline Icon */}
                                      <div className={`absolute left-0 w-12 h-12 rounded-full border-4 border-white shadow-sm flex items-center justify-center z-10 ${
                                          event.type === 'check' && event.status === 'Pass' ? 'bg-emerald-100 text-emerald-600' :
                                          event.type === 'check' && event.status === 'Fail' ? 'bg-rose-100 text-rose-600' :
                                          event.type === 'rework' ? 'bg-amber-100 text-amber-600' :
                                          'bg-slate-100 text-slate-500'
                                      }`}>
                                          {event.type === 'check' && event.status === 'Pass' ? <CheckCircle className="w-6 h-6" /> :
                                           event.type === 'check' && event.status === 'Fail' ? <AlertTriangle className="w-6 h-6" /> :
                                           event.type === 'rework' ? <FileText className="w-6 h-6" /> :
                                           <ArrowDownCircle className="w-6 h-6" />}
                                      </div>

                                      {/* Event Card */}
                                      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                                          <div className="flex justify-between items-start mb-1">
                                              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{event.timestamp}</span>
                                              {event.status && (
                                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                      event.status === 'Pass' ? 'bg-emerald-50 text-emerald-700' :
                                                      event.status === 'Fail' ? 'bg-rose-50 text-rose-700' :
                                                      'bg-slate-100 text-slate-600'
                                                  }`}>
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
                              ))}
                          </div>
                      </div>

                  </div>
                  
                  {/* Slide-over Footer */}
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
