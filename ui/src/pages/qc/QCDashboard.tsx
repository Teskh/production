import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ClipboardList, AlertTriangle, ChevronRight, CheckCircle, 
  PlusCircle, RefreshCw, Layout, Filter, AlertCircle, Clock
} from 'lucide-react';
import { PENDING_CHECKS, REWORK_TASKS, CHECK_DEFINITIONS } from '../../services/qcMockData';

const QCDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const priorityLabels: Record<string, string> = {
    High: 'Alta',
    Medium: 'Media',
    Low: 'Baja',
  };
  const statusLabels: Record<string, string> = {
    InProgress: 'En progreso',
    Done: 'Hecho',
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleStartCheck = (checkId: string) => {
    navigate('/qc/execute', { state: { checkId } });
  };

  const handleStartManual = () => {
      navigate('/qc/execute', { state: { checkId: 'new_manual', defId: 'chk_wall' } });
  };

  // Group Pending Checks by Station
  const checksByStation = PENDING_CHECKS.reduce((acc, check) => {
      if (!acc[check.stationName]) acc[check.stationName] = [];
      acc[check.stationName].push(check);
      return acc;
  }, {} as Record<string, typeof PENDING_CHECKS>);

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      
      {/* Header & KPIs */}
      <div className="p-6 space-y-6">
          <div className="flex justify-between items-center">
            <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                  Operaciones QC
                </h1>
                <p className="text-slate-500 text-sm">
                  Monitor de calidad de produccion en tiempo real
                </p>
            </div>
            <div className="flex space-x-3">
                <button 
                    onClick={handleRefresh} 
                    className={`p-2 bg-white border border-gray-200 rounded-lg text-slate-500 hover:text-blue-600 transition-all ${isRefreshing ? 'animate-spin' : ''}`}
                >
                    <RefreshCw className="w-5 h-5" />
                </button>
                <button 
                    onClick={handleStartManual}
                    className="flex items-center px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 transition-colors shadow-sm"
                >
                    <PlusCircle className="w-4 h-4 mr-2" />
                    Inspeccion manual
                </button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                  <div>
                      <div className="text-slate-500 text-xs font-semibold uppercase tracking-wider">
                        Revisiones pendientes
                      </div>
                      <div className="text-2xl font-bold text-slate-900 mt-1">{PENDING_CHECKS.length}</div>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-full text-blue-600">
                      <ClipboardList className="w-6 h-6" />
                  </div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                  <div>
                      <div className="text-slate-500 text-xs font-semibold uppercase tracking-wider">
                        Retrabajo activo
                      </div>
                      <div className="text-2xl font-bold text-slate-900 mt-1">{REWORK_TASKS.filter(t => t.status !== 'Done').length}</div>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-full text-amber-600">
                      <AlertTriangle className="w-6 h-6" />
                  </div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                  <div>
                      <div className="text-slate-500 text-xs font-semibold uppercase tracking-wider">
                        Tasa de aprobacion (24h)
                      </div>
                      <div className="text-2xl font-bold text-emerald-600 mt-1">94.2%</div>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-full text-emerald-600">
                      <CheckCircle className="w-6 h-6" />
                  </div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                  <div>
                      <div className="text-slate-500 text-xs font-semibold uppercase tracking-wider">
                        Respuesta prom.
                      </div>
                      <div className="text-2xl font-bold text-slate-900 mt-1">12<span className="text-sm font-normal text-slate-400 ml-1">min</span></div>
                  </div>
                  <div className="p-3 bg-purple-50 rounded-full text-purple-600">
                      <Clock className="w-6 h-6" />
                  </div>
              </div>
          </div>
      </div>

      {/* Main Content Split */}
      <div className="flex-1 overflow-hidden px-6 pb-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left: Pending Checks (Swimlanes) */}
          <div className="lg:col-span-2 flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <h3 className="font-bold text-slate-800 flex items-center">
                      <Layout className="w-4 h-4 mr-2 text-slate-500" />
                      Colas por estacion
                  </h3>
                  <button className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center">
                      <Filter className="w-3 h-3 mr-1" /> Filtrar
                  </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                  {Object.entries(checksByStation).map(([station, checks]) => (
                      <div key={station}>
                          <div className="flex items-center mb-3">
                              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{station}</span>
                              <div className="ml-3 flex-1 h-px bg-slate-100"></div>
                              <span className="ml-3 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{checks.length}</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {checks.map(check => {
                                  const def = CHECK_DEFINITIONS[check.checkDefinitionId];
                                  return (
                                      <div 
                                        key={check.id}
                                        onClick={() => handleStartCheck(check.id)}
                                        className="group bg-white border border-slate-200 rounded-lg p-3 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer relative"
                                      >
                                          {check.samplingType === 'Forced' && (
                                              <div className="absolute top-3 right-3 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" title="Muestra obligatoria"></div>
                                          )}
                                          <div className="flex justify-between items-start mb-2">
                                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                                  {check.moduleNumber}
                                              </span>
                                              <span className="text-[10px] text-slate-400">{check.createdAt}</span>
                                          </div>
                                          <h4 className="font-bold text-slate-800 text-sm mb-1 group-hover:text-blue-600 transition-colors">
                                              {def?.name || 'Revision desconocida'}
                                          </h4>
                                          <div className="flex items-center text-xs text-slate-500">
                                              <span className="truncate">
                                                {check.scope} {check.panelCode ? `- ${check.panelCode}` : ''}
                                              </span>
                                          </div>
                                      </div>
                                  );
                              })}
                          </div>
                      </div>
                  ))}
                  {Object.keys(checksByStation).length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full text-slate-400">
                          <CheckCircle className="w-12 h-12 mb-3 text-slate-200" />
                          <p>Todo en orden. No hay revisiones pendientes.</p>
                      </div>
                  )}
              </div>
          </div>

          {/* Right: Rework Priority List */}
          <div className="flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-rose-50/30 flex justify-between items-center">
                  <h3 className="font-bold text-rose-900 flex items-center">
                      <AlertCircle className="w-4 h-4 mr-2 text-rose-500" />
                      Retrabajo critico
                  </h3>
              </div>
              <div className="flex-1 overflow-y-auto p-0">
                  {REWORK_TASKS.map(task => (
                      <div 
                        key={task.id} 
                        className="p-4 border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer group"
                      >
                          <div className="flex justify-between items-start mb-1">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                  task.priority === 'High' ? 'bg-rose-100 text-rose-700' :
                                  task.priority === 'Medium' ? 'bg-amber-100 text-amber-700' :
                                  'bg-slate-100 text-slate-600'
                              }`}>
                                  {priorityLabels[task.priority] ?? task.priority}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                  task.status === 'InProgress' ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-500'
                              }`}>
                                  {statusLabels[task.status] ?? task.status}
                              </span>
                          </div>
                          <h4 className="text-sm font-bold text-slate-900 mt-2 mb-1 group-hover:text-blue-600">
                              {task.moduleNumber} <span className="text-slate-400 font-normal">| {task.stationName}</span>
                          </h4>
                          <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                              {task.description}
                          </p>
                          {task.assignedWorker && (
                              <div className="mt-2 flex items-center text-[10px] text-slate-400">
                                  <div className="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center mr-1 text-[8px] font-bold text-slate-500">
                                      {task.assignedWorker.charAt(0)}
                                  </div>
                                  Asignado a {task.assignedWorker}
                              </div>
                          )}
                      </div>
                  ))}
              </div>
          </div>

      </div>
    </div>
  );
};

export default QCDashboard;
