import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Camera, Check, X, MessageSquare, 
  AlertTriangle, ChevronLeft, SkipForward, AlertCircle,
  ChevronRight, Image
} from 'lucide-react';
import { 
  CHECK_DEFINITIONS, PENDING_CHECKS, FAILURE_MODES, SEVERITY_LEVELS 
} from '../../services/qcMockData';

const MOCK_GUIDANCE_IMAGES = [
  'https://placehold.co/600x400/3b82f6/white?text=Guidance+1',
  'https://placehold.co/600x400/3b82f6/white?text=Guidance+2',
];

const QCExecution: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const checkId = location.state?.checkId;
  
  const checkInstance = PENDING_CHECKS.find(c => c.id === checkId);
  const defId = checkInstance?.checkDefinitionId || location.state?.defId || 'chk_wall';
  const checkDef = CHECK_DEFINITIONS[defId];

  const [currentStep, setCurrentStep] = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const [showFailModal, setShowFailModal] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  
  const [refImageIndex, setRefImageIndex] = useState(0);
  const [guideImageIndex, setGuideImageIndex] = useState(0);
  
  const [evidence, setEvidence] = useState<{url: string, id: string, type: 'image'|'video'}[]>([]);
  const [notes, setNotes] = useState('');
  const [failureData, setFailureData] = useState<{modeId: string, severityId: string} | null>(null);

  const steps = checkDef?.steps || [];
  const currentStepData = steps[currentStep];
  
  const referenceImages = steps
    .map(s => s.image)
    .filter((img): img is string => !!img);
  
  const guidanceImages = MOCK_GUIDANCE_IMAGES;

  const handlePass = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
      setRefImageIndex(Math.min(currentStep + 1, referenceImages.length - 1));
    } else {
      navigate('/qc');
    }
  };
  
  const handleFailSubmit = () => {
    setShowFailModal(false);
    navigate('/qc');
  };

  const handleCapture = () => {
    const newImage = {
      url: 'https://placehold.co/400x400/22c55e/white?text=Evidence',
      id: Date.now().toString(),
      type: 'image' as const
    };
    setEvidence([...evidence, newImage]);
    setShowCamera(false);
  };

  const nextRefImage = () => setRefImageIndex(i => (i + 1) % referenceImages.length);
  const prevRefImage = () => setRefImageIndex(i => (i - 1 + referenceImages.length) % referenceImages.length);
  const nextGuideImage = () => setGuideImageIndex(i => (i + 1) % guidanceImages.length);
  const prevGuideImage = () => setGuideImageIndex(i => (i - 1 + guidanceImages.length) % guidanceImages.length);

  if (!checkDef) return <div className="h-screen flex items-center justify-center bg-slate-900 text-white">Cargando revision...</div>;

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white overflow-hidden">
      
      {/* Minimal Header */}
      <div className="flex items-center px-4 py-2 bg-slate-800/50 backdrop-blur-sm">
        <button 
          onClick={() => navigate('/qc')} 
          className="p-2 rounded-lg hover:bg-slate-700 transition-colors"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="ml-2 text-sm text-slate-400">
          <span className="font-medium text-white">{checkInstance?.moduleNumber || 'Manual'}</span>
          <span className="mx-2">•</span>
          <span>Paso {currentStep + 1}/{steps.length}</span>
        </div>
      </div>

      {/* Main Content: Two Carousels Side by Side */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        
        {/* Reference Images Carousel */}
        <div className="flex-1 relative bg-slate-800 flex items-center justify-center min-h-[30vh] lg:min-h-0">
          <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-semibold z-10">
            Referencia
          </div>
          
          {referenceImages.length > 0 ? (
            <>
              <img 
                src={referenceImages[refImageIndex]} 
                alt="Referencia" 
                className="max-w-full max-h-full object-contain p-4"
              />
              
              {referenceImages.length > 1 && (
                <>
                  <button 
                    onClick={prevRefImage}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={nextRefImage}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {referenceImages.map((_, i) => (
                      <button 
                        key={i}
                        onClick={() => setRefImageIndex(i)}
                        className={`w-2 h-2 rounded-full transition-colors ${i === refImageIndex ? 'bg-white' : 'bg-white/40'}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="text-slate-500 flex flex-col items-center">
              <Image className="w-12 h-12 mb-2 opacity-50" />
              <span className="text-sm">Sin imagen de referencia</span>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="hidden lg:block w-px bg-slate-700" />
        <div className="lg:hidden h-px bg-slate-700" />

        {/* Guidance Images Carousel */}
        <div className="flex-1 relative bg-slate-800/50 flex items-center justify-center min-h-[30vh] lg:min-h-0">
          <div className="absolute top-3 left-3 bg-blue-600/80 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-semibold z-10">
            Guia Visual
          </div>
          
          {guidanceImages.length > 0 ? (
            <>
              <img 
                src={guidanceImages[guideImageIndex]} 
                alt="Guia" 
                className="max-w-full max-h-full object-contain p-4"
              />
              
              {guidanceImages.length > 1 && (
                <>
                  <button 
                    onClick={prevGuideImage}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={nextGuideImage}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {guidanceImages.map((_, i) => (
                      <button 
                        key={i}
                        onClick={() => setGuideImageIndex(i)}
                        className={`w-2 h-2 rounded-full transition-colors ${i === guideImageIndex ? 'bg-white' : 'bg-white/40'}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="text-slate-500 flex flex-col items-center">
              <Image className="w-12 h-12 mb-2 opacity-50" />
              <span className="text-sm">Sin guia visual</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Panel: Description + Actions */}
      <div className="bg-slate-800 border-t border-slate-700">
        
        {/* Description */}
        <div className="px-4 py-3 border-b border-slate-700/50">
          <h2 className="text-lg font-bold text-white">{currentStepData?.title || checkDef.name}</h2>
          <p className="text-sm text-slate-300 mt-1">{currentStepData?.desc || checkDef.guidance}</p>
        </div>
        
        {/* Actions Row */}
        <div className="flex items-center justify-between p-3 gap-3">
          
          {/* Left: Tools */}
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowCamera(true)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-sm"
            >
              <Camera className="w-4 h-4" />
              <span className="hidden sm:inline">Evidencia</span>
            </button>
            <button 
              onClick={() => setShowNotesModal(true)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm ${
                notes ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-700 hover:bg-slate-600'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">Nota</span>
            </button>
            
            {evidence.length > 0 && (
              <div className="flex -space-x-2 ml-2">
                {evidence.slice(0, 3).map((ev) => (
                  <div key={ev.id} className="w-8 h-8 rounded-lg border-2 border-slate-800 overflow-hidden">
                    <img src={ev.url} alt="ev" className="w-full h-full object-cover" />
                  </div>
                ))}
                {evidence.length > 3 && (
                  <div className="w-8 h-8 rounded-lg border-2 border-slate-800 bg-slate-700 flex items-center justify-center text-xs">
                    +{evidence.length - 3}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Center: Secondary Actions */}
          <div className="hidden sm:flex items-center gap-1">
            <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors" title="Omitir paso">
              <SkipForward className="w-5 h-5" />
            </button>
            <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors" title="Omitir revision">
              <AlertCircle className="w-5 h-5" />
            </button>
          </div>

          {/* Right: Main Actions */}
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowFailModal(true)}
              className="flex items-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 rounded-xl font-bold transition-colors"
            >
              <X className="w-5 h-5" />
              <span className="hidden sm:inline">Fallar</span>
            </button>
            <button 
              onClick={handlePass}
              className="flex items-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-600 rounded-xl font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-[0.98]"
            >
              <Check className="w-5 h-5" />
              <span>{currentStep < steps.length - 1 ? 'Siguiente' : 'Finalizar'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* --- Modals --- */}

      {/* Camera Overlay */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center relative bg-slate-900">
            <p className="text-white/50 text-sm absolute top-8">Simulador de camara</p>
            <div className="w-full max-w-md aspect-[4/3] border border-white/20 relative flex items-center justify-center">
              <div className="w-48 h-48 border-2 border-white/30 rounded-lg flex items-center justify-center">
                <span className="text-white/20 text-4xl font-thin">+</span>
              </div>
              <div className="absolute bottom-4 left-4 text-[10px] text-yellow-400 font-mono bg-black/50 px-2 py-1 rounded">
                {checkInstance?.moduleNumber || 'MOD-XXX'} | {new Date().toLocaleTimeString()}
              </div>
            </div>
            <div className="mt-8 flex items-center gap-8">
              <button 
                onClick={() => setShowCamera(false)}
                className="p-4 rounded-full bg-slate-800 text-white hover:bg-slate-700"
              >
                <X className="w-6 h-6" />
              </button>
              <button 
                onClick={handleCapture}
                className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center hover:scale-105 transition-transform"
              >
                <div className="w-16 h-16 bg-white rounded-full"></div>
              </button>
              <div className="w-14" />
            </div>
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {showNotesModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 w-full max-w-lg rounded-xl shadow-2xl overflow-hidden border border-slate-700">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
              <h3 className="font-bold text-white">Agregar nota</h3>
              <button onClick={() => setShowNotesModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <textarea 
                className="w-full h-32 bg-slate-900 border border-slate-600 rounded-lg p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                placeholder="Escribe los detalles de observacion aqui..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                autoFocus
              />
            </div>
            <div className="p-4 bg-slate-900/50 flex justify-end">
              <button 
                onClick={() => setShowNotesModal(false)}
                className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"
              >
                Guardar nota
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Failure Mode Modal */}
      {showFailModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 w-full max-w-lg rounded-xl shadow-2xl flex flex-col max-h-[90vh] border border-slate-700">
            <div className="p-4 border-b border-slate-700 bg-red-900/30 flex justify-between items-center rounded-t-xl">
              <div className="flex items-center text-red-400">
                <AlertTriangle className="w-5 h-5 mr-2" />
                <h3 className="font-bold">Registrar falla</h3>
              </div>
              <button onClick={() => setShowFailModal(false)} className="text-red-400 hover:text-red-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              <div className="mb-6">
                <label className="block text-sm font-bold text-slate-300 mb-2">Modo de falla</label>
                <div className="space-y-2">
                  {FAILURE_MODES.map(mode => (
                    <label 
                      key={mode.id}
                      className={`flex items-start p-3 border rounded-lg cursor-pointer transition-all ${
                        failureData?.modeId === mode.id 
                          ? 'border-red-500 bg-red-900/30 ring-1 ring-red-500' 
                          : 'border-slate-600 hover:border-slate-500 bg-slate-900/50'
                      }`}
                    >
                      <input 
                        type="radio" 
                        name="failureMode" 
                        className="mt-1 mr-3 text-red-600 focus:ring-red-500"
                        checked={failureData?.modeId === mode.id}
                        onChange={() => setFailureData({ 
                          modeId: mode.id, 
                          severityId: mode.defaultSeverityId 
                        })}
                      />
                      <div>
                        <div className="font-semibold text-white">{mode.name}</div>
                        <div className="text-xs text-slate-400">{mode.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {failureData && (
                <div className="mb-6">
                  <label className="block text-sm font-bold text-slate-300 mb-2">Severidad</label>
                  <div className="flex flex-wrap gap-2">
                    {SEVERITY_LEVELS.map(sev => (
                      <button
                        key={sev.id}
                        onClick={() => setFailureData(prev => prev ? {...prev, severityId: sev.id} : null)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          failureData.severityId === sev.id 
                            ? sev.color + ' border-current ring-1 ring-current'
                            : 'bg-slate-900 text-slate-400 border-slate-600 hover:bg-slate-700'
                        }`}
                      >
                        {sev.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-bold text-slate-300 mb-2">
                  Instrucciones de retrabajo
                </label>
                <textarea 
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-sm h-20 text-white placeholder-slate-500"
                  defaultValue={failureData ? FAILURE_MODES.find(m => m.id === failureData.modeId)?.defaultReworkText : ''}
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-700 bg-slate-900/50 flex justify-end gap-3 rounded-b-xl">
              <button 
                onClick={() => setShowFailModal(false)}
                className="px-5 py-2 text-slate-300 font-semibold hover:bg-slate-700 rounded-lg"
              >
                Cancelar
              </button>
              <button 
                disabled={!failureData}
                onClick={handleFailSubmit}
                className={`px-5 py-2 text-white font-bold rounded-lg shadow-sm ${
                  failureData ? 'bg-red-600 hover:bg-red-700' : 'bg-red-900 cursor-not-allowed opacity-50'
                }`}
              >
                Confirmar falla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QCExecution;
