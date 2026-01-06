import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { isSysadminUser, useAdminSession } from '../../../layouts/AdminLayout';
import AdminUsers from './AdminUsers';
import Specialties from './Specialties';
import Workers from './Workers';

const Personnel: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const admin = useAdminSession();
  const isSysadmin = isSysadminUser(admin);
  const requestedTab = location.pathname.includes('specialties')
    ? 'specialties'
    : location.pathname.includes('admin-users')
    ? 'admin-users'
    : 'workers';
  const activeTab = requestedTab === 'admin-users' && !isSysadmin ? 'workers' : requestedTab;

  useEffect(() => {
    if (requestedTab === 'admin-users' && !isSysadmin) {
      navigate('/admin/workers', { replace: true });
    }
  }, [isSysadmin, navigate, requestedTab]);

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-full border border-black/10 bg-white/70 p-1 text-xs font-semibold text-[var(--ink-muted)]">
        <button
          type="button"
          onClick={() => navigate('/admin/workers')}
          className={`rounded-full px-4 py-2 transition-none ${
            activeTab === 'workers' ? 'bg-black/5 text-[var(--ink)]' : ''
          }`}
        >
          Trabajadores
        </button>
        <button
          type="button"
          onClick={() => navigate('/admin/specialties')}
          className={`rounded-full px-4 py-2 transition-none ${
            activeTab === 'specialties' ? 'bg-black/5 text-[var(--ink)]' : ''
          }`}
        >
          Especialidades
        </button>
        {isSysadmin && (
          <button
            type="button"
            onClick={() => navigate('/admin/admin-users')}
            className={`rounded-full px-4 py-2 transition-none ${
              activeTab === 'admin-users' ? 'bg-black/5 text-[var(--ink)]' : ''
            }`}
          >
            Equipo admin
          </button>
        )}
      </div>
      {activeTab === 'specialties' ? (
        <Specialties />
      ) : activeTab === 'admin-users' ? (
        <AdminUsers />
      ) : (
        <Workers />
      )}
    </div>
  );
};

export default Personnel;
