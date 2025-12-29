import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { 
  Users, Calendar, Settings, FileText, BarChart, 
  Menu, X, Home, ClipboardList, CheckSquare, Layers
} from 'lucide-react';
import clsx from 'clsx';

const AdminLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();

  const menuItems = [
    {
      title: 'Personnel',
      items: [
        { name: 'Workers', path: '/admin/workers', icon: Users },
        { name: 'Specialties', path: '/admin/specialties', icon: Settings }, // Using Settings as placeholder
        { name: 'Admin Team', path: '/admin/team', icon: Users },
        { name: 'Assistance', path: '/admin/assistance', icon: Calendar },
      ]
    },
    {
      title: 'Planning & Production',
      items: [
        { name: 'Line Status', path: '/admin/line-status', icon: Home },
        { name: 'Production Queue', path: '/admin/production-queue', icon: Layers },
        { name: 'Panel History', path: '/admin/panel-history', icon: FileText },
        { name: 'Station Finished', path: '/admin/station-finished', icon: CheckSquare },
        { name: 'Task Analysis', path: '/admin/task-analysis', icon: BarChart },
        { name: 'Panel Meters', path: '/admin/panel-meters', icon: BarChart },
      ]
    },
    {
      title: 'Product Definition',
      items: [
        { name: 'House Types', path: '/admin/house-types', icon: Home },
        { name: 'House Params', path: '/admin/house-params', icon: Settings },
        { name: 'House Panels', path: '/admin/house-panels', icon: FileText },
        { name: 'Module Rules', path: '/admin/rules', icon: Settings },
      ]
    },
    {
      title: 'Configuration',
      items: [
        { name: 'Stations', path: '/admin/stations', icon: Settings },
        { name: 'Task Definitions', path: '/admin/task-defs', icon: ClipboardList },
        { name: 'Pause Definitions', path: '/admin/pause-defs', icon: Settings },
        { name: 'Note Definitions', path: '/admin/note-defs', icon: FileText },
      ]
    },
    {
      title: 'Quality',
      items: [
        { name: 'QC Checks', path: '/admin/qc-checks', icon: CheckSquare },
      ]
    }
  ];

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Mobile Sidebar Overlay */}
      {!sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(true)}
        />
      )}

      {/* Sidebar */}
      <div className={clsx(
        "fixed lg:static inset-y-0 left-0 z-30 w-64 bg-slate-800 text-white transition-transform duration-300 transform",
        !sidebarOpen ? "-translate-x-full lg:translate-x-0" : "translate-x-0",
        "lg:translate-x-0" // Always show on large screens? Actually spec says "Sidebar collapses on small screens"
      )}>
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h1 className="text-xl font-bold">Admin Panel</h1>
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-1 hover:bg-slate-700 rounded"
          >
            <X size={20} />
          </button>
        </div>
        
        <nav className="p-4 space-y-6 overflow-y-auto h-[calc(100vh-65px)]">
          {menuItems.map((group, idx) => (
            <div key={idx}>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={clsx(
                      "flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
                      location.pathname === item.path 
                        ? "bg-slate-700 text-white" 
                        : "text-slate-300 hover:bg-slate-700 hover:text-white"
                    )}
                  >
                    <item.icon size={18} className="mr-3" />
                    {item.name}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm h-16 flex items-center px-6">
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden mr-4 text-gray-600"
          >
            <Menu size={24} />
          </button>
          <div className="flex-1"></div>
          <div className="text-sm text-gray-600">
            Admin User
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
