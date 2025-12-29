import React from 'react';
import { Outlet } from 'react-router-dom';
import { Bell, User, MapPin } from 'lucide-react';

const WorkerLayout: React.FC = () => {
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow px-4 py-3 flex items-center justify-between z-10">
        <div className="flex items-center space-x-4">
          <div className="flex items-center text-gray-800 font-semibold">
            <User className="w-5 h-5 mr-2 text-blue-600" />
            <span>John Doe</span>
          </div>
          <div className="h-6 w-px bg-gray-300 mx-2"></div>
          <div className="flex items-center text-gray-600">
            <MapPin className="w-5 h-5 mr-2 text-green-600" />
            <span>Station: Wall Assembly 1</span>
          </div>
        </div>

        <div className="flex items-center">
          <button className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full">
            <Bell className="w-6 h-6" />
            <span className="absolute top-1 right-1 h-3 w-3 bg-red-500 rounded-full border-2 border-white"></span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-4">
        <Outlet />
      </main>
    </div>
  );
};

export default WorkerLayout;
