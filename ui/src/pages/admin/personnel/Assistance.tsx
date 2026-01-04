import React, { useEffect } from 'react';
import { useAdminHeader } from '../../../layouts/AdminLayout';

const Assistance: React.FC = () => {
  const { setHeader } = useAdminHeader();

  useEffect(() => {
    setHeader({
      title: 'Resumen de asistencia',
      kicker: 'Personal / Asistencia',
    });
  }, [setHeader]);

  return (
    <div className="p-6">
      <p className="text-gray-500">
        Este es un marcador para la pagina de resumen de asistencia.
      </p>
    </div>
  );
};

export default Assistance;
