import React, { useState } from 'react';
import { User, Edit2, Trash2, Plus, Save, X } from 'lucide-react';

const Workers: React.FC = () => {
  const [showForm, setShowForm] = useState(false);
  
  // Mock Data
  const workers = [
    { id: 1, name: 'John Doe', role: 'Operator', stations: ['Wall Assembly', 'Framing'] },
    { id: 2, name: 'Jane Smith', role: 'Operator', stations: ['Finishing'] },
  ];

  const specialties = ['Framing', 'Electrical', 'Plumbing', 'Finishing'];
  const stations = ['Station A', 'Station B', 'Station C', 'Station D'];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">Workers Management</h1>
        <button 
          onClick={() => setShowForm(!showForm)}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          {showForm ? <X className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
          {showForm ? 'Cancel' : 'Add Worker'}
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Form Section */}
        {showForm && (
          <div className="lg:w-1/3 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold mb-4">Add/Edit Worker</h3>
            <form className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Full Name</label>
                <input type="text" className="mt-1 block w-full border border-gray-300 rounded-md p-2" />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700">Specialties</label>
                <div className="mt-2 space-y-2 h-32 overflow-y-auto border border-gray-200 p-2 rounded">
                  {specialties.map(s => (
                    <label key={s} className="flex items-center space-x-2">
                      <input type="checkbox" className="rounded text-blue-600" />
                      <span className="text-sm text-gray-600">{s}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Station Assignments</label>
                <div className="mt-2 space-y-2 h-32 overflow-y-auto border border-gray-200 p-2 rounded">
                  {stations.map(s => (
                    <label key={s} className="flex items-center space-x-2">
                      <input type="checkbox" className="rounded text-blue-600" />
                      <span className="text-sm text-gray-600">{s}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <button type="button" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center">
                  <Save className="w-4 h-4 mr-2" /> Save
                </button>
              </div>
            </form>
          </div>
        )}

        {/* List Section */}
        <div className="flex-1 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stations</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {workers.map(worker => (
                <tr key={worker.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 bg-gray-200 rounded-full flex items-center justify-center">
                        <User className="w-5 h-5 text-gray-500" />
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{worker.name}</div>
                        <div className="text-sm text-gray-500">{worker.role}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {worker.stations.map(s => (
                        <span key={s} className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800">
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button className="text-indigo-600 hover:text-indigo-900 mr-3">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button className="text-red-600 hover:text-red-900">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Workers;