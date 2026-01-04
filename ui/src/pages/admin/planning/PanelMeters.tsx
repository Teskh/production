import React, { useEffect } from 'react';
import { useAdminHeader } from '../../../layouts/AdminLayout';

const PanelMeters: React.FC = () => {
  const { setHeader } = useAdminHeader();

  useEffect(() => {
    setHeader({
      title: 'Metros lineales de paneles',
      kicker: 'Planificacion / Produccion',
    });
  }, [setHeader]);

  return (
    <div className="p-6">
      <p className="text-gray-500">
        Este es un marcador para la pagina de metros lineales de paneles.
      </p>
    </div>
  );
};

export default PanelMeters;
