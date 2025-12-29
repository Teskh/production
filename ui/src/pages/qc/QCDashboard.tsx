import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ClipboardList, AlertTriangle, ChevronRight, CheckCircle 
} from 'lucide-react';

const QCDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'checks' | 'rework'>('checks');

  const pendingChecks = [
    { id: '1', station: 'Wall Assembly', module: 'MOD-2023-101', time: '10:00 AM', status: 'ready' },
    { id: '2', station: 'Roofing', module: 'MOD-2023-105', time: '10:15 AM', status: 'waiting' },
    { id: '3', station: 'Finishing', module: 'MOD-2023-099', time: '09:45 AM', status: 'urgent' },
  ];

  const reworkTasks = [
    { id: 'r1', station: 'Wall Assembly', module: 'MOD-2023-080', issue: 'Missing insulation', priority: 'high' },
    { id: 'r2', station: 'Framing', module: 'MOD-2023-095', issue: 'Loose stud', priority: 'medium' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
      {/* Left Column: Lists */}
      <div className="lg:col-span-2 flex flex-col space-y-4">
        
        {/* Quick Filters / Tabs */}
        <div className="flex space-x-2 border-b border-gray-200 pb-2">
          <button 
            onClick={() => setActiveTab('checks')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg ${activeTab === 'checks' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Pending Checks ({pendingChecks.length})
          </button>
          <button 
             onClick={() => setActiveTab('rework')}
             className={`px-4 py-2 text-sm font-medium rounded-t-lg ${activeTab === 'rework' ? 'bg-white text-red-600 border-b-2 border-red-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Rework Tasks ({reworkTasks.length})
          </button>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto space-y-3 p-1">
          {activeTab === 'checks' ? (
            pendingChecks.map(check => (
              <div 
                key={check.id}
                onClick={() => navigate('/qc/execute')}
                className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:border-blue-400 cursor-pointer transition-colors flex justify-between items-center"
              >
                <div className="flex items-center space-x-4">
                  <div className={`p-2 rounded-full ${check.status === 'urgent' ? 'bg-red-100 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                    <ClipboardList className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-gray-900">{check.module}</h4>
                    <p className="text-xs text-gray-500">{check.station} • {check.time}</p>
                  </div>
                </div>
                <div className="flex items-center text-gray-400">
                  <span className="text-xs mr-2 uppercase font-semibold tracking-wider">{check.status}</span>
                  <ChevronRight className="w-5 h-5" />
                </div>
              </div>
            ))
          ) : (
            reworkTasks.map(task => (
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
                    <h4 className="text-base font-bold text-gray-900">{task.module}</h4>
                    <p className="text-sm text-gray-600">{task.issue}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">{task.station}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Column: Station Overview / Stats */}
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Station Status</h3>
          <div className="space-y-4">
            {['Framing', 'Insulation', 'Wall Assembly', 'Roofing'].map(st => (
              <div key={st} className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700">{st}</span>
                <div className="flex space-x-1">
                   {Math.random() > 0.7 ? (
                     <span className="h-2 w-2 rounded-full bg-red-500"></span>
                   ) : (
                     <span className="h-2 w-2 rounded-full bg-green-500"></span>
                   )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg shadow p-6 text-white">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-bold">Today's Performance</h3>
            <CheckCircle className="w-6 h-6 opacity-75" />
          </div>
          <div className="text-4xl font-extrabold mb-1">94%</div>
          <p className="text-sm opacity-80">First Pass Yield</p>
          
          <div className="mt-4 pt-4 border-t border-white/20 flex justify-between text-sm">
            <span>24 Checks Done</span>
            <span>2 Reworks</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QCDashboard;