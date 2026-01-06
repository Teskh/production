import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { isSysadminUser, useAdminSession } from '../../../layouts/AdminLayout';
import AdminUsers from './AdminUsers';
import Specialties from './Specialties';
import Workers from './Workers';

type PersonnelTab = 'workers' | 'specialties' | 'admin-users';

const getTabFromPath = (pathname: string, isSysadmin: boolean): PersonnelTab => {
  if (pathname.includes('specialties')) return 'specialties';
  if (pathname.includes('admin-users') && isSysadmin) return 'admin-users';
  return 'workers';
};

const Personnel: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const admin = useAdminSession();
  const isSysadmin = isSysadminUser(admin);
  
  const [activeTab, setActiveTab] = useState<PersonnelTab>(() =>
    getTabFromPath(location.pathname, isSysadmin)
  );

  if (location.pathname.includes('admin-users') && !isSysadmin && activeTab !== 'workers') {
    navigate('/admin/workers', { replace: true });
    setActiveTab('workers');
  }

  const handleTabChange = (tab: PersonnelTab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    const path = tab === 'workers' ? '/admin/workers' : tab === 'specialties' ? '/admin/specialties' : '/admin/admin-users';
    window.history.replaceState(null, '', path);
  };

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-full border border-black/10 bg-white/70 p-1 text-xs font-semibold text-[var(--ink-muted)]">
        <button
          type="button"
          onClick={() => handleTabChange('workers')}
          className={`rounded-full px-4 py-2 transition-none ${
            activeTab === 'workers' ? 'bg-black/5 text-[var(--ink)]' : ''
          }`}
        >
          Trabajadores
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
            Equipo admin
          </button>
        )}
      </div>
      <div className="min-h-[600px]">
        {activeTab === 'specialties' ? (
          <Specialties />
        ) : activeTab === 'admin-users' ? (
          <AdminUsers />
        ) : (
          <Workers />
        )}
      </div>
    </div>
  );
};

export default Personnel;
