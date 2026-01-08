import React from 'react';
import { Outlet } from 'react-router-dom';

const WorkerLayout: React.FC = () => {
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <main className="flex-1 overflow-auto p-4">
        <Outlet />
      </main>
    </div>
  );
};

export default WorkerLayout;
