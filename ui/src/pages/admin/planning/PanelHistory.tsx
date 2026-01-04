import React, { useEffect } from 'react';
import { useAdminHeader } from '../../../layouts/AdminLayout';

const PanelHistory: React.FC = () => {
  const { setHeader } = useAdminHeader();

  useEffect(() => {
    setHeader({
      title: 'Historial de produccion de paneles',
      kicker: 'Planificacion / Produccion',
    });
  }, [setHeader]);

  return (
    <div className="p-6">
      <p className="text-gray-500">
        Este es un marcador para la pagina de historial de produccion de paneles.
      </p>
    </div>
  );
};

export default PanelHistory;
