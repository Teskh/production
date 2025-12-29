import React from 'react';
import { 
  Layers, GripVertical, 
  Calendar, Edit
} from 'lucide-react';

const ProductionQueue: React.FC = () => {
  // Mock Plan Data
  const upcomingPlan = [
    { id: '1', batch: 'Batch-A', type: 'Type X', count: 12 },
    { id: '2', batch: 'Batch-B', type: 'Type Y', count: 8 },
    { id: '3', batch: 'Batch-C', type: 'Type X', count: 15 },
  ];

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">Production Queue</h1>
        <div className="space-x-2">
          <button className="px-4 py-2 bg-blue-600 text-white rounded shadow-sm text-sm font-medium hover:bg-blue-700">
            + Add Batch
          </button>
        </div>
      </div>

      <div className="flex-1 bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold text-gray-700">Upcoming Batches</h3>
          <span className="text-xs text-gray-500 bg-gray-200 px-3 py-1 rounded-full">{upcomingPlan.length} Batches</span>
        </div>

        <div className="space-y-4 flex-1 overflow-y-auto max-w-3xl">
          {upcomingPlan.map((item) => (
            <div 
              key={item.id} 
              className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex items-center group cursor-grab active:cursor-grabbing hover:border-blue-300 transition-all hover:shadow-md"
            >
              <div className="mr-4 text-gray-400 cursor-move">
                <GripVertical className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-lg text-gray-900">{item.batch}</span>
                  <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-100">{item.count} panels</span>
                </div>
                <div className="flex items-center text-sm text-gray-500">
                  <Layers className="w-4 h-4 mr-2" />
                  {item.type}
                </div>
              </div>
              <div className="ml-4 opacity-0 group-hover:opacity-100 transition-opacity flex space-x-2">
                 <button className="p-2 hover:bg-gray-100 rounded-full text-gray-500 hover:text-blue-600 transition-colors">
                   <Edit className="w-5 h-5" />
                 </button>
                 <button className="p-2 hover:bg-gray-100 rounded-full text-gray-500 hover:text-green-600 transition-colors">
                   <Calendar className="w-5 h-5" />
                 </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-sm text-gray-500">
            Drag and drop items to reorder the production priority. Changes are saved automatically.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ProductionQueue;
