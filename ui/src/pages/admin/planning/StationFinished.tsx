import React, { useEffect } from 'react';
import { useAdminHeader } from '../../../layouts/AdminLayout';

const StationFinished: React.FC = () => {
  const { setHeader } = useAdminHeader();

  useEffect(() => {
    setHeader({
      title: 'Paneles terminados por estacion',
      kicker: 'Planificacion / Produccion',
    });
  }, [setHeader]);

  return (
    <div className="p-6">
      <p className="text-gray-500">
        Este es un marcador para la pagina de paneles terminados por estacion.
      </p>
    </div>
  );
};

export default StationFinished;
