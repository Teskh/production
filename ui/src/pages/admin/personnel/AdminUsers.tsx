import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  isSysadminUser,
  useAdminHeader,
  useAdminSession,
} from '../../../layouts/AdminLayoutContext';
import AdminUsersPanel from './AdminUsersPanel';

const AdminUsers: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const admin = useAdminSession();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  useEffect(() => {
    setHeader({
      title: 'Equipo admin',
      kicker: 'Personal / Equipo admin',
    });
  }, [setHeader]);

  if (!isSysadminUser(admin)) {
    return (
      <div className="rounded-3xl border border-black/5 bg-white/80 p-6 shadow-sm backdrop-blur">
        <h2 className="font-display text-lg text-[var(--ink)]">Acceso restringido</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Solo el usuario sysadmin puede ver y editar el equipo admin.
        </p>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => navigate('/admin/workers', { replace: true })}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)]"
          >
            Volver a trabajadores
          </button>
        </div>
      </div>
    );
  }

  return <AdminUsersPanel query={query} setQuery={setQuery} />;
};

export default AdminUsers;

