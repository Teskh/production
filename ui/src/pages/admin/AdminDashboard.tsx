import React from 'react';
import { Users, AlertCircle, TrendingUp, Activity } from 'lucide-react';

const AdminDashboard: React.FC = () => {
  const stats = [
    { label: 'Active Workers', value: '34', icon: Users, color: 'text-blue-600', bg: 'bg-blue-100' },
    { label: 'Pending Issues', value: '5', icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100' },
    { label: 'Daily Output', value: '12', icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-100' },
    { label: 'System Health', value: '98%', icon: Activity, color: 'text-purple-600', bg: 'bg-purple-100' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Dashboard Overview</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-white rounded-lg p-6 shadow-sm border border-gray-200 flex items-center">
            <div className={`p-3 rounded-full ${stat.bg} mr-4`}>
              <stat.icon className={`w-6 h-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">{stat.label}</p>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 h-64">
          <h3 className="font-semibold text-gray-700 mb-4">Production Trend</h3>
          <div className="h-full flex items-center justify-center text-gray-400 bg-gray-50 rounded">
            Chart Placeholder
          </div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 h-64">
           <h3 className="font-semibold text-gray-700 mb-4">Recent Activity</h3>
           <div className="space-y-3">
             <div className="text-sm border-l-2 border-blue-500 pl-3 py-1">
               <span className="font-medium text-gray-900">User Login</span>
               <p className="text-gray-500">John Doe logged into Station A</p>
             </div>
             <div className="text-sm border-l-2 border-green-500 pl-3 py-1">
               <span className="font-medium text-gray-900">Task Completed</span>
               <p className="text-gray-500">Frame Assembly finished on Line 1</p>
             </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;