import React from 'react';
import { 
  ArrowRight, Layers, GripVertical, 
  Calendar, Edit
} from 'lucide-react';

const ProductionStatus: React.FC = () => {
  // Mock Plan Data
  const upcomingPlan = [
    { id: '1', batch: 'Batch-A', type: 'Type X', count: 12 },
    { id: '2', batch: 'Batch-B', type: 'Type Y', count: 8 },
    { id: '3', batch: 'Batch-C', type: 'Type X', count: 15 },
  ];

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">Production Status & Planning</h1>
        <div className="space-x-2">
          <button className="px-4 py-2 bg-white border border-gray-300 rounded shadow-sm text-sm font-medium hover:bg-gray-50">
            Export Report
          </button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded shadow-sm text-sm font-medium hover:bg-blue-700">
            + Add Batch
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 overflow-hidden">
        {/* Left: Station Layout Visualization */}
        <div className="flex-1 bg-white p-6 rounded-lg shadow-sm border border-gray-200 overflow-y-auto">
          <h3 className="text-lg font-semibold text-gray-700 mb-6">Line Status</h3>
          
          <div className="relative border-2 border-dashed border-gray-200 rounded-xl p-8 min-h-[400px]">
             {/* Mock Layout */}
             <div className="grid grid-cols-4 gap-8">
               <div className="col-span-1 flex flex-col items-center">
                 <div className="w-24 h-24 bg-blue-50 border-2 border-blue-200 rounded-lg flex items-center justify-center font-bold text-blue-700">
                   Magazine
                 </div>
                 <ArrowRight className="mt-4 text-gray-400 rotate-90" />
               </div>

               <div className="col-span-3 grid grid-cols-3 gap-4">
                 {['Station 1', 'Station 2', 'Station 3'].map((st, i) => (
                   <div key={st} className="flex items-center space-x-2">
                      <div className="flex-1 h-32 bg-gray-50 border border-gray-300 rounded-lg p-3 relative">
                        <span className="text-xs font-bold uppercase text-gray-400 block mb-2">{st}</span>
                        {i === 0 && (
                           <div className="bg-green-100 border border-green-300 p-2 rounded text-xs text-green-800">
                             Batch-A #4
                           </div>
                        )}
                      </div>
                      {i < 2 && <ArrowRight className="text-gray-400" />}
                   </div>
                 ))}
               </div>
             </div>
             
             <div className="absolute bottom-4 left-0 right-0 text-center text-sm text-gray-400 italic">
               Live view updated 1 min ago
             </div>
          </div>
        </div>

        {/* Right: Upcoming Plan (Drag & Drop Simulation) */}
        <div className="w-full lg:w-96 bg-gray-50 p-4 rounded-lg border border-gray-200 flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-gray-700">Production Queue</h3>
            <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded">3 Batches</span>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto">
            {upcomingPlan.map((item) => (
              <div 
                key={item.id} 
                className="bg-white p-3 rounded shadow-sm border border-gray-200 flex items-center group cursor-grab active:cursor-grabbing hover:border-blue-300 transition-colors"
              >
                <div className="mr-3 text-gray-400">
                  <GripVertical className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="font-bold text-sm text-gray-900">{item.batch}</span>
                    <span className="text-xs font-mono bg-blue-50 text-blue-700 px-1 rounded">{item.count} panels</span>
                  </div>
                  <div className="flex items-center text-xs text-gray-500">
                    <Layers className="w-3 h-3 mr-1" />
                    {item.type}
                  </div>
                </div>
                <div className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button className="p-1 hover:bg-gray-100 rounded">
                     <Edit className="w-4 h-4 text-gray-500" />
                   </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
            <button className="w-full py-2 text-sm text-blue-600 bg-blue-50 rounded hover:bg-blue-100 flex items-center justify-center">
              <Calendar className="w-4 h-4 mr-2" /> Schedule for Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductionStatus;