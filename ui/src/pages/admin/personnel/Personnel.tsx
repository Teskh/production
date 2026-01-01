import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import Specialties from './Specialties';
import Workers from './Workers';

const Personnel: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = location.pathname.includes('specialties') ? 'specialties' : 'workers';

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-full border border-black/10 bg-white/70 p-1 text-xs font-semibold text-[var(--ink-muted)]">
        <button
          type="button"
          onClick={() => navigate('/admin/workers')}
          className={`rounded-full px-4 py-2 transition ${
            activeTab === 'workers' ? 'bg-black/5 text-[var(--ink)]' : ''
          }`}
        >
          Workers
        </button>
        <button
          type="button"
          onClick={() => navigate('/admin/specialties')}
          className={`rounded-full px-4 py-2 transition ${
            activeTab === 'specialties' ? 'bg-black/5 text-[var(--ink)]' : ''
          }`}
        >
          Specialties
        </button>
      </div>
      {activeTab === 'specialties' ? <Specialties /> : <Workers />}
    </div>
  );
};

export default Personnel;
