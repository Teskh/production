import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { isSysadminUser, useAdminSession } from '../../../layouts/AdminLayout';
import AdminUsers from './AdminUsers';
import Specialties from './Specialties';
import Workers from './Workers';

type PersonnelTab = 'operators' | 'supervisors' | 'specialties' | 'admin-users';

const getTabFromPath = (
  pathname: string,
  search: string,
  isSysadmin: boolean
): PersonnelTab => {
  if (pathname.includes('specialties')) return 'specialties';
  if (pathname.includes('admin-users') && isSysadmin) return 'admin-users';
  const params = new URLSearchParams(search);
  if (params.get('tab') === 'supervisors') return 'supervisors';
  return 'operators';
};

const Personnel: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const admin = useAdminSession();
  const isSysadmin = isSysadminUser(admin);
  
  const [activeTab, setActiveTab] = useState<PersonnelTab>(() =>
    getTabFromPath(location.pathname, location.search, isSysadmin)
  );

  if (location.pathname.includes('admin-users') && !isSysadmin && activeTab !== 'operators') {
    navigate('/admin/workers', { replace: true });
    setActiveTab('operators');
  }

  const handleTabChange = (tab: PersonnelTab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    const path =
      tab === 'operators'
        ? '/admin/workers'
        : tab === 'supervisors'
        ? '/admin/workers?tab=supervisors'
        : tab === 'specialties'
        ? '/admin/specialties'
        : '/admin/admin-users';
    window.history.replaceState(null, '', path);
  };

  return (
    <div className="space-y-6">
      <div className="inline-flex flex-wrap rounded-full border border-black/10 bg-white/70 p-1 text-xs font-semibold text-[var(--ink-muted)]">
        <button
          type="button"
          onClick={() => handleTabChange('operators')}
          className={`rounded-full px-4 py-2 transition-none ${
            activeTab === 'operators' ? 'bg-black/5 text-[var(--ink)]' : ''
          }`}
        >
          Operadores
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('supervisors')}
          className={`rounded-full px-4 py-2 transition-none ${
            activeTab === 'supervisors' ? 'bg-black/5 text-[var(--ink)]' : ''
          }`}
        >
          Supervisores
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('specialties')}
          className={`rounded-full px-4 py-2 transition-none ${
            activeTab === 'specialties' ? 'bg-black/5 text-[var(--ink)]' : ''
          }`}
        >
          Especialidades
        </button>
        {isSysadmin && (
          <button
            type="button"
            onClick={() => handleTabChange('admin-users')}
            className={`rounded-full px-4 py-2 transition-none ${
              activeTab === 'admin-users' ? 'bg-black/5 text-[var(--ink)]' : ''
            }`}
          >
          Equipo Admin
        </button>
        )}
      </div>
      <div className="min-h-[600px]">
        {activeTab === 'specialties' ? (
          <Specialties />
        ) : activeTab === 'admin-users' ? (
          <AdminUsers />
        ) : (
          <Workers
            key={activeTab}
            initialRosterMode={activeTab === 'supervisors' ? 'supervisors' : 'workers'}
            hideRosterTabs
          />
        )}
      </div>
    </div>
  );
};

export default Personnel;
