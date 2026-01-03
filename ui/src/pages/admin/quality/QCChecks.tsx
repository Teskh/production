import React, { useState } from 'react';
import { Plus, Edit2, Trash2, CheckCircle, AlertOctagon } from 'lucide-react';
import { CHECK_DEFINITIONS } from '../../../services/qcMockData';

const QCChecks: React.FC = () => {
  // Convert Record to Array
  const checks = Object.values(CHECK_DEFINITIONS);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
           <h1 className="text-2xl font-bold text-gray-900">QC Check Definitions</h1>
           <p className="text-sm text-gray-500 mt-1">Manage quality control checks, triggers, and guidance.</p>
        </div>
        <button className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors">
          <Plus className="w-4 h-4 mr-2" />
          New Check
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
         <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50 text-xs uppercase font-semibold text-gray-500 border-b border-gray-200">
               <tr>
                 <th className="px-6 py-4">Name</th>
                 <th className="px-6 py-4">Category</th>
                 <th className="px-6 py-4">Guidance</th>
                 <th className="px-6 py-4 text-center">Steps</th>
                 <th className="px-6 py-4 text-right">Actions</th>
               </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
               {checks.map(check => (
                 <tr key={check.id} className="hover:bg-blue-50/50 transition-colors group">
                    <td className="px-6 py-4">
                        <div className="font-semibold text-gray-900">{check.name}</div>
                        <div className="text-xs text-gray-400 font-mono mt-0.5">{check.id}</div>
                    </td>
                    <td className="px-6 py-4">
                        <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-bold">
                            {check.category}
                        </span>
                    </td>
                    <td className="px-6 py-4 max-w-xs truncate text-sm text-gray-600" title={check.guidance}>
                        {check.guidance}
                    </td>
                    <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                           {check.steps.length}
                        </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                        <button className="p-2 text-gray-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors">
                            <Edit2 className="w-4 h-4" />
                        </button>
                        <button className="p-2 text-gray-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors">
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </td>
                 </tr>
               ))}
            </tbody>
         </table>
         {checks.length === 0 && (
             <div className="p-8 text-center text-gray-500">No checks defined.</div>
         )}
      </div>
    </div>
  );
};

export default QCChecks;
