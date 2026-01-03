import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ClipboardList, AlertTriangle, ChevronRight, CheckCircle, PlusCircle, RefreshCw
} from 'lucide-react';
import { PENDING_CHECKS, REWORK_TASKS, CHECK_DEFINITIONS } from '../../services/qcMockData';

const QCDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'checks' | 'rework'>('checks');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleStartCheck = (checkId: string) => {
    navigate('/qc/execute', { state: { checkId } });
  };

  const handleStartManual = () => {
      // For prototype, just pick the first definition
      navigate('/qc/execute', { state: { checkId: 'new_manual', defId: 'chk_wall' } });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
      {/* Left Column: Lists */}
      <div className="lg:col-span-2 flex flex-col space-y-4 h-full">
        
        {/* Header Actions */}
        <div className="flex justify-between items-center bg-white p-3 rounded-lg shadow-sm">
            <h2 className="text-lg font-bold text-slate-800 flex items-center">
                Dashboard
                <button onClick={handleRefresh} className={`ml-2 p-1 text-slate-400 hover:text-blue-500 transition-transform ${isRefreshing ? 'animate-spin' : ''}`}>
                    <RefreshCw className="w-4 h-4" />
                </button>
            </h2>
            <button 
                onClick={handleStartManual}
                className="flex items-center px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
            >
                <PlusCircle className="w-4 h-4 mr-2" />
                Manual Check
            </button>
        </div>

        {/* Quick Filters / Tabs */}
        <div className="flex space-x-2 border-b border-gray-200 pb-0">
          <button 
            onClick={() => setActiveTab('checks')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${
                activeTab === 'checks' 
                ? 'bg-white text-blue-600 border-blue-600' 
                : 'bg-slate-50 text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            Pending Checks ({PENDING_CHECKS.length})
          </button>
          <button 
             onClick={() => setActiveTab('rework')}
             className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${
                 activeTab === 'rework' 
                 ? 'bg-white text-red-600 border-red-600' 
                 : 'bg-slate-50 text-gray-500 border-transparent hover:text-gray-700'
             }`}
          >
            Rework Tasks ({REWORK_TASKS.length})
          </button>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto space-y-3 p-1">
          {activeTab === 'checks' ? (
            PENDING_CHECKS.map(check => {
                const def = CHECK_DEFINITIONS[check.checkDefinitionId];
                return (
                  <div 
                    key={check.id}
                    onClick={() => handleStartCheck(check.id)}
                    className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:border-blue-400 cursor-pointer transition-all flex justify-between items-center group"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="p-3 rounded-full bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors">
                        <ClipboardList className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-gray-900">{check.moduleNumber} <span className="font-normal text-gray-500">| {def?.name || 'Unknown Check'}</span></h4>
                        <p className="text-xs text-gray-500">
                           {check.stationName} • {check.scope} {check.panelCode ? `• ${check.panelCode}` : ''} • {check.createdAt}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center text-gray-400">
                      <span className="text-xs mr-3 font-semibold tracking-wider px-2 py-1 rounded bg-slate-100 text-slate-600">{check.status.toUpperCase()}</span>
                      <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500" />
                    </div>
                  </div>
                );
            })
          ) : (
            REWORK_TASKS.map(task => (
              <div 
                key={task.id}
                className="bg-white p-4 rounded-lg shadow-sm border-l-4 border-red-500 hover:shadow-md cursor-pointer transition-all"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center space-x-2 text-red-600 mb-1">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase">{task.priority} Priority</span>
                    </div>
                    <h4 className="text-base font-bold text-gray-900">{task.moduleNumber} <span className="text-sm font-normal text-gray-400">| Rework</span></h4>
                    <p className="text-sm text-gray-700 font-medium mt-1">{task.description}</p>
                    <p className="text-xs text-gray-500 mt-2">Originated from: {task.stationName}</p>
                  </div>
                  <div className="text-right flex flex-col items-end justify-between h-full">
                    <span className={`text-xs px-2 py-1 rounded font-semibold ${
                        task.status === 'InProgress' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-50 text-red-800'
                    }`}>
                        {task.status}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Column: Station Overview / Stats */}
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow p-4 border border-gray-100">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 border-b pb-2">Station Overview</h3>
          <div className="space-y-4">
            {[
                { name: 'Framing', status: 'ok', checks: 2 }, 
                { name: 'Insulation', status: 'issue', checks: 5 }, 
                { name: 'Wall Assembly', status: 'busy', checks: 8 }, 
                { name: 'Roofing', status: 'ok', checks: 1 }
            ].map(st => (
              <div key={st.name} className="flex justify-between items-center p-2 rounded hover:bg-slate-50">
                <div>
                    <div className="text-sm font-medium text-gray-700">{st.name}</div>
                    <div className="text-xs text-gray-400">{st.checks} active items</div>
                </div>
                <div className="flex space-x-1">
                   {st.status === 'issue' && (
                     <span className="h-3 w-3 rounded-full bg-red-500 ring-2 ring-red-200" title="High failure rate"></span>
                   )}
                   {st.status === 'busy' && (
                     <span className="h-3 w-3 rounded-full bg-yellow-500 ring-2 ring-yellow-200" title="Backlog"></span>
                   )}
                   {st.status === 'ok' && (
                     <span className="h-3 w-3 rounded-full bg-emerald-500" title="Normal"></span>
                   )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-lg shadow-lg p-6 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
                <ClipboardList className="w-24 h-24" />
            </div>
          <div className="flex items-center justify-between mb-2 relative z-10">
            <h3 className="text-lg font-bold">Shift Performance</h3>
            <CheckCircle className="w-6 h-6 text-emerald-300" />
          </div>
          <div className="text-5xl font-extrabold mb-1 tracking-tight relative z-10">94%</div>
          <p className="text-sm text-indigo-200 font-medium relative z-10">First Pass Yield</p>
          
          <div className="mt-6 pt-4 border-t border-white/20 flex justify-between text-sm relative z-10">
            <div>
                <span className="block font-bold text-lg">24</span>
                <span className="text-indigo-200 text-xs">Checks Done</span>
            </div>
            <div className="text-right">
                <span className="block font-bold text-lg">2</span>
                <span className="text-indigo-200 text-xs">Reworks</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QCDashboard;