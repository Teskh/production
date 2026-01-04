import React, { useEffect } from 'react';
import { useAdminHeader } from '../../../layouts/AdminLayout';

const TaskAnalysis: React.FC = () => {
  const { setHeader } = useAdminHeader();

  useEffect(() => {
    setHeader({
      title: 'Analisis de tareas',
      kicker: 'Planificacion / Produccion',
    });
  }, [setHeader]);

  return (
    <div className="p-6">
      <p className="text-gray-500">
        Este es un marcador para la pagina de analisis de tareas.
      </p>
    </div>
  );
};

export default TaskAnalysis;
