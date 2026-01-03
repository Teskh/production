import React, { useState } from 'react';
import { 
  Search, Filter, ChevronRight, X, 
  CheckCircle, AlertTriangle, Clock, FileText 
} from 'lucide-react';
import { MODULE_HISTORY } from '../../services/qcMockData';

const QCLibrary: React.FC = () => {
  const [selectedModule, setSelectedModule] = useState<typeof MODULE_HISTORY[0] | null>(null);
  const [filterStatus, setFilterStatus] = useState<'All' | 'Assembly' | 'Magazine' | 'Completed'>('All');

  const filteredModules = MODULE_HISTORY.filter(m => 
    filterStatus === 'All' || m.status === filterStatus
  );

  return (
    <div className="h-full flex flex-col bg-slate-50 relative">
      
      {/* Header / Filter Bar */}
      <div className="px-6 py-4 bg-white border-b border-gray-200 shadow-sm flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">QC Library</h1>
        
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Search module..." 
              className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none w-64"
            />
          </div>
          <div className="h-6 w-px bg-gray-300 mx-2"></div>
          <select 
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
          >
            <option value="All">All Statuses</option>
            <option value="Assembly">In Assembly</option>
            <option value="Magazine">Magazine</option>
            <option value="Completed">Completed</option>
          </select>
        </div>
      </div>

      {/* Main List */}
      <div className="flex-1 overflow-auto p-6">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500">
              <tr>
                <th className="px-6 py-3 border-b">Module Number</th>
                <th className="px-6 py-3 border-b">House Type</th>
                <th className="px-6 py-3 border-b">Current Status</th>
                <th className="px-6 py-3 border-b">Last QC Check</th>
                <th className="px-6 py-3 border-b text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredModules.map((mod) => (
                <tr 
                    key={mod.moduleNumber} 
                    onClick={() => setSelectedModule(mod)}
                    className="hover:bg-blue-50 cursor-pointer transition-colors group"
                >
                  <td className="px-6 py-4 font-medium text-slate-900">{mod.moduleNumber}</td>
                  <td className="px-6 py-4">{mod.houseType}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                      mod.status === 'Completed' ? 'bg-green-100 text-green-700' :
                      mod.status === 'Assembly' ? 'bg-blue-100 text-blue-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {mod.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                        {mod.lastCheck === 'Passed' && <CheckCircle className="w-4 h-4 text-emerald-500 mr-2" />}
                        {mod.lastCheck === 'Failed' && <AlertTriangle className="w-4 h-4 text-red-500 mr-2" />}
                        {mod.lastCheck === 'Pending' && <Clock className="w-4 h-4 text-gray-400 mr-2" />}
                        <span className={`${
                             mod.lastCheck === 'Failed' ? 'text-red-600 font-semibold' : ''
                        }`}>
                            {mod.lastCheck}
                        </span>
                        {mod.pendingRework > 0 && (
                            <span className="ml-2 px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] rounded border border-red-200">
                                {mod.pendingRework} Rework Active
                            </span>
                        )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="text-gray-400 hover:text-blue-600 group-hover:translate-x-1 transition-transform">
                        <ChevronRight className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Slide-over */}
      {selectedModule && (
          <div className="absolute inset-0 z-50 flex justify-end">
              <div 
                className="absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity"
                onClick={() => setSelectedModule(null)}
              ></div>
              <div className="w-full max-w-2xl bg-white h-full shadow-2xl transform transition-transform relative flex flex-col">
                  {/* Slide-over Header */}
                  <div className="px-6 py-5 border-b border-gray-200 bg-slate-50 flex justify-between items-start">
                      <div>
                          <h2 className="text-2xl font-bold text-slate-900">{selectedModule.moduleNumber}</h2>
                          <p className="text-sm text-slate-500 mt-1">
                              {selectedModule.houseType} • {selectedModule.status}
                          </p>
                      </div>
                      <button 
                        onClick={() => setSelectedModule(null)}
                        className="p-2 rounded-full hover:bg-slate-200 text-slate-500"
                      >
                          <X className="w-6 h-6" />
                      </button>
                  </div>

                  {/* Slide-over Content */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-8">
                      
                      {/* Active Issues Section */}
                      {selectedModule.pendingRework > 0 && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                              <h3 className="text-red-800 font-bold flex items-center mb-3">
                                  <AlertTriangle className="w-5 h-5 mr-2" />
                                  Active Rework Tasks
                              </h3>
                              <div className="space-y-3">
                                  <div className="bg-white p-3 rounded shadow-sm border border-red-100">
                                      <div className="flex justify-between">
                                          <span className="font-semibold text-slate-800">Loose stud at joint 3</span>
                                          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">In Progress</span>
                                      </div>
                                      <p className="text-xs text-slate-500 mt-1">Reported 2 hours ago at Framing Station</p>
                                  </div>
                              </div>
                          </div>
                      )}

                      {/* Timeline / History */}
                      <div>
                          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center">
                              <Clock className="w-5 h-5 mr-2 text-slate-400" />
                              Inspection History
                          </h3>
                          <div className="relative border-l-2 border-slate-200 ml-3 space-y-6 pb-4">
                              
                              {/* Timeline Item 1 */}
                              <div className="ml-6 relative">
                                  <div className="absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white ring-2 ring-emerald-100"></div>
                                  <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                                      <div className="flex justify-between items-start mb-2">
                                          <div>
                                              <h4 className="font-bold text-slate-800">Final Finish Check</h4>
                                              <p className="text-xs text-slate-500">Performed by Sarah Smith • 2h ago</p>
                                          </div>
                                          <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700 text-xs font-bold">PASS</span>
                                      </div>
                                      <div className="text-sm text-slate-600 bg-slate-50 p-2 rounded">
                                          "Surface looks good. No scratches detected."
                                      </div>
                                  </div>
                              </div>

                              {/* Timeline Item 2 */}
                              <div className="ml-6 relative">
                                  <div className="absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-red-500 border-2 border-white ring-2 ring-red-100"></div>
                                  <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                                      <div className="flex justify-between items-start mb-2">
                                          <div>
                                              <h4 className="font-bold text-slate-800">Framing Inspection</h4>
                                              <p className="text-xs text-slate-500">Performed by Mike Jones • Yesterday</p>
                                          </div>
                                          <span className="px-2 py-1 rounded bg-red-100 text-red-700 text-xs font-bold">FAIL</span>
                                      </div>
                                      <div className="text-sm text-slate-600 mb-2">
                                          <span className="font-semibold text-red-600">Failure Mode:</span> Loose Connection
                                      </div>
                                      <div className="flex space-x-2 mt-2">
                                          <div className="w-16 h-16 bg-slate-200 rounded flex items-center justify-center text-xs text-slate-400">Photo 1</div>
                                          <div className="w-16 h-16 bg-slate-200 rounded flex items-center justify-center text-xs text-slate-400">Photo 2</div>
                                      </div>
                                  </div>
                              </div>
                          </div>
                      </div>

                  </div>
                  
                  {/* Slide-over Footer */}
                  <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end">
                       <button className="flex items-center text-blue-600 hover:text-blue-800 font-medium text-sm">
                           <FileText className="w-4 h-4 mr-2" />
                           View Full Report
                       </button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default QCLibrary;
