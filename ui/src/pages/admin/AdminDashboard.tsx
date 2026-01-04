import React, { useEffect } from 'react';
import { Users, AlertCircle, TrendingUp, Activity } from 'lucide-react';
import { useAdminHeader } from '../../layouts/AdminLayout';

const AdminDashboard: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const stats = [
    { label: 'Trabajadores activos', value: '34', icon: Users, color: 'text-blue-600', bg: 'bg-blue-100' },
    { label: 'Incidencias pendientes', value: '5', icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100' },
    { label: 'Produccion diaria', value: '12', icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-100' },
    { label: 'Salud del sistema', value: '98%', icon: Activity, color: 'text-purple-600', bg: 'bg-purple-100' },
  ];

  useEffect(() => {
    setHeader({ title: 'Resumen del panel' });
  }, [setHeader]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-white rounded-lg px-4 py-3 shadow-sm border border-gray-100 flex items-center justify-between hover:border-gray-300 transition-colors">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">{stat.label}</p>
              <p className="text-lg font-bold text-gray-900">{stat.value}</p>
            </div>
            <stat.icon className={`w-5 h-5 ${stat.color} opacity-80`} />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden h-64 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
            <h3 className="text-sm font-semibold text-gray-700">Tendencia de produccion</h3>
          </div>
          <div className="flex-1 flex items-center justify-center text-gray-400 bg-white text-sm">
            Marcador de grafica
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden h-64 flex flex-col">
           <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
             <h3 className="text-sm font-semibold text-gray-700">Actividad reciente</h3>
           </div>
           <div className="overflow-auto">
             <div className="divide-y divide-gray-100">
               <div className="px-4 py-2.5 hover:bg-gray-50 flex items-start gap-3 transition-colors">
                 <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0"></div>
                 <div>
                   <p className="text-sm font-medium text-gray-900 leading-none">Inicio de sesion</p>
                   <p className="text-xs text-gray-500 mt-1">John Doe inicio sesion en Estacion A</p>
                 </div>
               </div>
               <div className="px-4 py-2.5 hover:bg-gray-50 flex items-start gap-3 transition-colors">
                 <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 shrink-0"></div>
                 <div>
                   <p className="text-sm font-medium text-gray-900 leading-none">Tarea completada</p>
                   <p className="text-xs text-gray-500 mt-1">Ensamble de marco termino en Linea 1</p>
                 </div>
               </div>
             </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
