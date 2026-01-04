import React, { useEffect } from 'react';
import { useAdminHeader } from '../../../layouts/AdminLayout';

const AdminTeam: React.FC = () => {
  const { setHeader } = useAdminHeader();

  useEffect(() => {
    setHeader({
      title: 'Gestion del equipo admin',
      kicker: 'Personal / Equipo admin',
    });
  }, [setHeader]);

  return (
    <div className="p-6">
      <p className="text-gray-500">
        Este es un marcador para la pagina de gestion del equipo admin.
      </p>
    </div>
  );
};

export default AdminTeam;
