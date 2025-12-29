import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { ClipboardCheck, List, LayoutGrid, LogOut } from 'lucide-react';
import clsx from 'clsx';

const QCLayout: React.FC = () => {
  const location = useLocation();

  const navItems = [
    { name: 'Dashboard', path: '/qc', icon: LayoutGrid },
    { name: 'Library', path: '/qc/library', icon: List },
  ];

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center space-x-6">
          <div className="flex items-center font-bold text-lg">
            <ClipboardCheck className="w-6 h-6 mr-2 text-emerald-400" />
            QC Station
          </div>
          
          <nav className="flex space-x-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={clsx(
                  "flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  location.pathname === item.path || (item.path !== '/qc' && location.pathname.startsWith(item.path))
                    ? "bg-slate-800 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                )}
              >
                <item.icon className="w-4 h-4 mr-2" />
                {item.name}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center space-x-4">
          <span className="text-sm text-slate-400">QC Inspector: Sarah Smith</span>
          <button className="flex items-center text-sm text-slate-300 hover:text-white">
            <LogOut className="w-4 h-4 mr-1" />
            Logout
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4">
        <Outlet />
      </main>
    </div>
  );
};

export default QCLayout;
