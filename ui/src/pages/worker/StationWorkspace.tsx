import React, { useState } from 'react';
import { 
  Play, Pause, CheckSquare, FastForward, MoreHorizontal, 
  Users, Search, PlusCircle 
} from 'lucide-react';
import clsx from 'clsx';

// Mock Types
type TaskStatus = 'pending' | 'active' | 'paused' | 'completed' | 'skipped';

interface Task {
  id: string;
  module: string;
  name: string;
  status: TaskStatus;
  meta: string;
}

const StationWorkspace: React.FC = () => {
  // State
  const [tasks, setTasks] = useState<Task[]>([
    { id: '1', module: 'MOD-1001', name: 'Frame Assembly', status: 'active', meta: 'House Type A' },
    { id: '2', module: 'MOD-1002', name: 'Frame Assembly', status: 'pending', meta: 'House Type B' },
    { id: '3', module: 'MOD-1003', name: 'Frame Assembly', status: 'pending', meta: 'House Type A' },
  ]);
  
  const [activeModal, setActiveModal] = useState<'pause' | 'skip' | 'finish' | 'crew' | 'manual' | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Mock Data for Modals
  const pauseReasons = ['Material Missing', 'Machine Breakdown', 'Quality Issue', 'Break'];
  const commentTemplates = ['Completed successfully', 'Minor adjustments made', 'Material substitution used'];

  // Handlers
  const handleAction = (taskId: string, action: 'pause' | 'skip' | 'finish' | 'start') => {
    setSelectedTaskId(taskId);
    if (action === 'start') {
      updateTaskStatus(taskId, 'active');
    } else {
      setActiveModal(action);
    }
  };

  const updateTaskStatus = (taskId: string, status: TaskStatus) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
    setActiveModal(null);
  };

  const closeModal = () => {
    setActiveModal(null);
    setSelectedTaskId(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Controls / Aux Toggle */}
      <div className="flex items-center justify-between bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800">Task Queue</h2>
        <div className="flex items-center space-x-3">
           <button 
             onClick={() => setActiveModal('manual')}
             className="flex items-center px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100"
            >
             <Search className="w-4 h-4 mr-2" />
             Find Module
           </button>
           <div className="flex items-center border-l pl-4 ml-4">
             <span className="text-sm text-gray-500 mr-2">Aux Mode</span>
             <button className="relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 bg-gray-200">
               <span className="translate-x-0 pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200"></span>
             </button>
           </div>
        </div>
      </div>

      {/* Main Task List */}
      <div className="space-y-4">
        {tasks.map(task => (
          <div 
            key={task.id} 
            className={clsx(
              "bg-white rounded-lg shadow-sm border-l-4 p-6 flex items-center justify-between transition-all",
              task.status === 'active' ? "border-green-500 ring-1 ring-green-100" : "border-gray-200"
            )}
          >
            <div>
              <div className="flex items-center space-x-3 mb-1">
                <span className="text-sm font-bold text-gray-500">{task.module}</span>
                {task.status === 'active' && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">IN PROGRESS</span>
                )}
                {task.status === 'paused' && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">PAUSED</span>
                )}
              </div>
              <h3 className="text-xl font-bold text-gray-900">{task.name}</h3>
              <p className="text-sm text-gray-500">{task.meta}</p>
            </div>

            <div className="flex items-center space-x-2">
              {task.status === 'active' ? (
                <>
                  <button 
                    onClick={() => handleAction(task.id, 'pause')}
                    className="flex flex-col items-center justify-center w-20 h-20 rounded-lg bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border border-yellow-200 transition-colors"
                  >
                    <Pause className="w-8 h-8 mb-1" />
                    <span className="text-xs font-semibold">Pause</span>
                  </button>
                  <button 
                    onClick={() => handleAction(task.id, 'finish')}
                    className="flex flex-col items-center justify-center w-24 h-24 rounded-lg bg-green-600 text-white hover:bg-green-700 shadow-md transition-transform transform hover:scale-105"
                  >
                    <CheckSquare className="w-10 h-10 mb-1" />
                    <span className="text-sm font-bold">Finish</span>
                  </button>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => handleAction(task.id, 'skip')}
                    className="flex flex-col items-center justify-center w-16 h-16 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                  >
                    <FastForward className="w-6 h-6 mb-1" />
                    <span className="text-xs">Skip</span>
                  </button>
                  <button 
                    onClick={() => handleAction(task.id, 'start')}
                    className="flex flex-col items-center justify-center w-20 h-20 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
                  >
                    <Play className="w-8 h-8 mb-1" />
                    <span className="text-xs font-semibold">Start</span>
                  </button>
                </>
              )}
              
              <button 
                onClick={() => setActiveModal('crew')}
                className="ml-2 p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>
            </div>
          </div>
        ))}

        {/* Empty State / Add More */}
        <button 
          onClick={() => setActiveModal('manual')}
          className="w-full py-4 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-500 flex items-center justify-center transition-colors"
        >
          <PlusCircle className="w-5 h-5 mr-2" />
          Add Task manually
        </button>
      </div>

      {/* MODALS */}
      {activeModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" onClick={closeModal}>
              <div className="absolute inset-0 bg-gray-900 opacity-75"></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
            
            <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
              
              {/* PAUSE MODAL */}
              {activeModal === 'pause' && (
                <div>
                  <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100">
                    <Pause className="h-6 w-6 text-yellow-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-5">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">Pause Task</h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500 mb-4">Select a reason for pausing this task.</p>
                      <div className="space-y-2">
                        {pauseReasons.map(r => (
                          <button 
                            key={r}
                            onClick={() => updateTaskStatus(selectedTaskId!, 'paused')}
                            className="w-full text-left px-4 py-3 border border-gray-300 rounded-md hover:bg-yellow-50 hover:border-yellow-500"
                          >
                            {r}
                          </button>
                        ))}
                        <input type="text" placeholder="Other reason..." className="w-full mt-2 border border-gray-300 rounded-md p-2 text-sm" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* FINISH MODAL */}
              {activeModal === 'finish' && (
                <div>
                  <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                    <CheckSquare className="h-6 w-6 text-green-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-5">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">Finish Task</h3>
                    <div className="mt-2 text-left">
                      <p className="text-sm text-gray-500 mb-4">Add a comment (optional).</p>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {commentTemplates.map(c => (
                          <span key={c} className="px-2 py-1 bg-gray-100 rounded-full text-xs text-gray-600 cursor-pointer hover:bg-gray-200">
                            {c}
                          </span>
                        ))}
                      </div>
                      <textarea 
                        className="w-full border border-gray-300 rounded-md p-2 text-sm h-24" 
                        placeholder="Add notes here..."
                      ></textarea>
                      <div className="mt-4 flex justify-end space-x-2">
                        <button onClick={closeModal} className="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
                        <button 
                          onClick={() => updateTaskStatus(selectedTaskId!, 'completed')}
                          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          Complete Task
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* MANUAL SELECTOR MODAL */}
              {activeModal === 'manual' && (
                <div>
                   <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">Find Module</h3>
                    <div className="mt-2">
                      <input type="text" placeholder="Search module ID..." className="w-full border border-gray-300 rounded-md p-2 mb-4" />
                      <div className="h-48 overflow-y-auto border rounded bg-gray-50 p-2 text-sm text-gray-500">
                        <p>Results will appear here...</p>
                      </div>
                      <div className="mt-4 flex justify-end">
                         <button onClick={closeModal} className="px-4 py-2 border rounded">Close</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* CREW SELECTOR MODAL */}
              {activeModal === 'crew' && (
                <div>
                   <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100">
                    <Users className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-5">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">Crew Selection</h3>
                    <p className="text-sm text-gray-500 mb-4">Select workers helping with this task.</p>
                    <div className="grid grid-cols-2 gap-2 text-left">
                      {['Worker A', 'Worker B', 'Worker C', 'Worker D'].map(w => (
                        <label key={w} className="flex items-center space-x-2 p-2 border rounded cursor-pointer hover:bg-gray-50">
                          <input type="checkbox" className="rounded text-blue-600" />
                          <span className="text-sm">{w}</span>
                        </label>
                      ))}
                    </div>
                    <div className="mt-4 flex justify-end">
                       <button onClick={closeModal} className="px-4 py-2 bg-blue-600 text-white rounded">Save Crew</button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StationWorkspace;