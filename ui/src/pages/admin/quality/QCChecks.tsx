import React, { useEffect } from 'react';
import { Plus, Edit2, Trash2, Sliders, PlayCircle, MapPin, MousePointer, Target } from 'lucide-react';
import { CHECK_DEFINITIONS } from '../../../services/qcMockData';
import { useAdminHeader } from '../../../layouts/AdminLayout';

const QCChecks: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const checks = Object.values(CHECK_DEFINITIONS);

  useEffect(() => {
    setHeader({
      title: 'Definiciones de revisiones QC',
      kicker: 'Calidad / Revisiones QC',
    });
  }, [setHeader]);

  const getTriggerIcon = (type: string) => {
      switch(type) {
          case 'Task Completion': return <CheckCircleIcon className="w-4 h-4 text-emerald-500" />;
          case 'Station Entry': return <MapPin className="w-4 h-4 text-blue-500" />;
          default: return <MousePointer className="w-4 h-4 text-gray-400" />;
      }
  };

  const CheckCircleIcon = ({className}: {className: string}) => (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
  );

  return (
    <div className="p-8 max-w-[1600px] mx-auto">
      <div className="flex justify-end mb-8">
        <button className="flex items-center px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 font-medium transition-colors shadow-sm">
          <Plus className="w-4 h-4 mr-2" />
          Crear definicion
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
         <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50/50 text-xs uppercase font-bold text-slate-400 border-b border-gray-100">
               <tr>
                 <th className="px-6 py-4 w-1/4">Nombre de definicion</th>
                 <th className="px-6 py-4">Disparador y alcance</th>
                 <th className="px-6 py-4">Estrategia de muestreo</th>
                 <th className="px-6 py-4">Vista previa de guia</th>
                 <th className="px-6 py-4 text-right">Acciones</th>
               </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
               {checks.map(check => (
                 <tr key={check.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-5">
                        <div className="flex items-start">
                            <div className="mr-3 mt-1 p-2 bg-slate-100 rounded text-slate-500">
                                <Target className="w-4 h-4" />
                            </div>
                            <div>
                                <div className="font-bold text-slate-900 text-sm">{check.name}</div>
                                <div className="text-xs text-slate-400 font-mono mt-0.5">{check.id}</div>
                                <div className="mt-1 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 uppercase tracking-wide">
                                    {check.category}
                                </div>
                            </div>
                        </div>
                    </td>
                    <td className="px-6 py-5">
                        <div className="space-y-2">
                            <div className="flex items-center text-sm text-slate-700">
                                <div className="w-6 flex justify-center mr-2">
                                    {getTriggerIcon(check.trigger)}
                                </div>
                                <span className="font-medium">{check.trigger}</span>
                            </div>
                            <div className="flex items-center text-xs text-slate-500">
                                <div className="w-6 flex justify-center mr-2">
                                    <Sliders className="w-3.5 h-3.5 text-slate-400" />
                                </div>
                                {check.applicability}
                            </div>
                        </div>
                    </td>
                    <td className="px-6 py-5">
                        <div className="w-48">
                            <div className="flex justify-between text-xs font-bold text-slate-600 mb-1.5">
                                <span>{(check.samplingRate * 100).toFixed(0)}% tasa</span>
                                <span className="text-slate-400">Objetivo</span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div 
                                    className={`h-full rounded-full ${
                                        check.samplingRate === 1.0 ? 'bg-emerald-500' : 
                                        check.samplingRate >= 0.5 ? 'bg-blue-500' : 'bg-amber-400'
                                    }`} 
                                    style={{ width: `${check.samplingRate * 100}%` }}
                                ></div>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1.5">
                                {check.samplingRate === 1.0
                                  ? 'Cada unidad revisada'
                                  : 'Muestreo aleatorio habilitado'}
                            </div>
                        </div>
                    </td>
                    <td className="px-6 py-5">
                        <p className="text-sm text-slate-500 line-clamp-2 max-w-xs leading-relaxed">
                            {check.guidance}
                        </p>
                        <div className="mt-2 text-xs font-medium text-slate-400">
                            {check.steps.length} paso{check.steps.length !== 1 && 's'} configurado{check.steps.length !== 1 && 's'}
                        </div>
                    </td>
                    <td className="px-6 py-5 text-right">
                        <div className="flex items-center justify-end space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="p-2 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors">
                                <Edit2 className="w-4 h-4" />
                            </button>
                            <button className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </td>
                 </tr>
               ))}
            </tbody>
         </table>
         {checks.length === 0 && (
             <div className="p-12 text-center text-slate-400 border-t border-gray-100">
                 Aun no hay revisiones definidas.
             </div>
         )}
      </div>
    </div>
  );
};

export default QCChecks;
