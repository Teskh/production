import React, { useState } from 'react';
import { 
  Plus, Edit2, Trash2, ChevronDown, ChevronRight, 
  CheckSquare, Users, Clock 
} from 'lucide-react';

const TaskDefs: React.FC = () => {
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['Station A']);
  
  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => 
      prev.includes(group) ? prev.filter(g => g !== group) : [...prev, group]
    );
  };

  const taskGroups = [
    {
      name: 'Station A',
      tasks: [
        { id: 't1', name: 'Frame Assembly', duration: '15m', crew: 2 },
        { id: 't2', name: 'Stapling', duration: '10m', crew: 1 },
      ]
    },
    {
      name: 'Station B',
      tasks: [
        { id: 't3', name: 'Insulation Install', duration: '20m', crew: 2 },
      ]
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Task Definitions</h1>
          <p className="text-sm text-gray-500">Define standard tasks and their default parameters.</p>
        </div>
        <button className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          New Task
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200 bg-gray-50 font-medium text-gray-500 flex">
          <div className="flex-1">Task Name</div>
          <div className="w-32 text-center">Duration</div>
          <div className="w-32 text-center">Crew Size</div>
          <div className="w-24 text-right">Actions</div>
        </div>

        <div>
          {taskGroups.map(group => (
            <div key={group.name} className="border-b border-gray-100 last:border-0">
              <button 
                onClick={() => toggleGroup(group.name)}
                className="w-full flex items-center px-4 py-3 bg-gray-50/50 hover:bg-gray-100 transition-colors text-left"
              >
                {expandedGroups.includes(group.name) ? (
                  <ChevronDown className="w-4 h-4 text-gray-400 mr-2" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400 mr-2" />
                )}
                <span className="font-semibold text-gray-700">{group.name}</span>
              </button>

              {expandedGroups.includes(group.name) && (
                <div className="divide-y divide-gray-100">
                  {group.tasks.map(task => (
                    <div key={task.id} className="flex items-center p-4 hover:bg-white transition-colors">
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{task.name}</div>
                        <div className="text-xs text-gray-400 flex items-center mt-1">
                           <CheckSquare className="w-3 h-3 mr-1" />
                           Dependencies: None
                        </div>
                      </div>
                      <div className="w-32 text-center text-sm text-gray-600 flex items-center justify-center">
                        <Clock className="w-3 h-3 mr-1 text-gray-400" />
                        {task.duration}
                      </div>
                      <div className="w-32 text-center text-sm text-gray-600 flex items-center justify-center">
                        <Users className="w-3 h-3 mr-1 text-gray-400" />
                        {task.crew}
                      </div>
                      <div className="w-24 text-right flex justify-end space-x-2">
                        <button className="p-1 text-gray-400 hover:text-blue-600">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button className="p-1 text-gray-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TaskDefs;