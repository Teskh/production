import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Camera, Check, X, MessageSquare, Maximize2, 
  AlertTriangle, ChevronLeft, MoreVertical, SkipForward, AlertCircle
} from 'lucide-react';
import { 
  CHECK_DEFINITIONS, PENDING_CHECKS, FAILURE_MODES, SEVERITY_LEVELS 
} from '../../services/qcMockData';

const QCExecution: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const checkId = location.state?.checkId;
  
  // Resolve check definition
  const checkInstance = PENDING_CHECKS.find(c => c.id === checkId);
  const defId = checkInstance?.checkDefinitionId || location.state?.defId || 'chk_wall';
  const checkDef = CHECK_DEFINITIONS[defId];

  const [currentStep, setCurrentStep] = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const [showFailModal, setShowFailModal] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  
  // Execution State
  const [evidence, setEvidence] = useState<{url: string, id: string, type: 'image'|'video'}[]>([]);
  const [notes, setNotes] = useState('');
  const [failureData, setFailureData] = useState<{modeId: string, severityId: string} | null>(null);

  const steps = checkDef?.steps || [];

  const handlePass = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      // Finish Check
      navigate('/qc');
    }
  };
  
  const handleFailSubmit = () => {
      // In a real app, save failure data here
      setShowFailModal(false);
      navigate('/qc'); // Return to dashboard or rework creation
  };

  const handleCapture = () => {
      // Mock capture
      const newImage = {
          url: 'https://placehold.co/400x400/22c55e/white?text=Evidence',
          id: Date.now().toString(),
          type: 'image' as const
      };
      setEvidence([...evidence, newImage]);
      setShowCamera(false);
  };

  if (!checkDef) return <div className="p-8">Loading Check...</div>;

  return (
    <div className="flex flex-col h-full bg-slate-100">
      
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center shadow-sm z-10">
          <div className="flex items-center">
              <button onClick={() => navigate('/qc')} className="mr-3 p-1 rounded hover:bg-slate-100">
                  <ChevronLeft className="w-6 h-6 text-slate-500" />
              </button>
              <div>
                  <h1 className="text-lg font-bold text-slate-800">{checkDef.name}</h1>
                  <p className="text-xs text-slate-500">
                      {checkInstance ? `${checkInstance.moduleNumber} • ${checkInstance.stationName}` : 'Manual Check'}
                  </p>
              </div>
          </div>
          <div className="flex space-x-2">
              <button className="p-2 text-slate-400 hover:text-slate-600">
                  <MoreVertical className="w-5 h-5" />
              </button>
          </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col relative">
        
        {/* Step Indicator */}
        <div className="absolute top-4 left-4 z-10 bg-black/60 backdrop-blur-sm text-white px-3 py-1 rounded-full text-xs font-bold shadow-sm">
          Step {currentStep + 1} of {steps.length}
        </div>

        {/* Reference Image / Guidance */}
        <div className="flex-1 bg-slate-200 flex items-center justify-center relative group overflow-hidden">
           {steps[currentStep] ? (
               <img 
                src={steps[currentStep].image} 
                alt="Reference" 
                className="w-full h-full object-cover"
               />
           ) : (
               <div className="text-slate-400">No Image</div>
           )}
           
           <button className="absolute bottom-4 right-4 bg-white/90 p-2 rounded-full shadow hover:bg-white transition-opacity">
             <Maximize2 className="w-5 h-5 text-gray-700" />
           </button>
        </div>

        {/* Guidance Text */}
        <div className="bg-white px-6 py-4 border-t border-gray-100 shadow-sm z-10">
          <h2 className="text-xl font-bold text-slate-900 mb-1">{steps[currentStep]?.title}</h2>
          <p className="text-base text-slate-600 leading-relaxed">{steps[currentStep]?.desc}</p>
          <div className="mt-2 text-xs text-slate-400 bg-slate-50 p-2 rounded border border-slate-100 inline-block">
             Guidance: {checkDef.guidance}
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="bg-white border-t border-gray-200 flex flex-col shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.1)] z-20">
          
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
             <div className="flex space-x-4">
                <button 
                    onClick={() => setShowCamera(true)}
                    className="flex flex-col items-center justify-center text-slate-500 hover:text-blue-600 transition-colors"
                >
                    <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center mb-1 border border-slate-200">
                        <Camera className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-wide">Evidence</span>
                </button>
                <button 
                    onClick={() => setShowNotesModal(true)}
                    className={`flex flex-col items-center justify-center transition-colors ${notes ? 'text-blue-600' : 'text-slate-500 hover:text-blue-600'}`}
                >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-1 border ${notes ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                        <MessageSquare className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-wide">Note</span>
                </button>
             </div>

             {/* Evidence Gallery Preview */}
             {evidence.length > 0 && (
                 <div className="flex -space-x-2">
                     {evidence.map((ev) => (
                         <div key={ev.id} className="w-10 h-10 rounded-lg border-2 border-white overflow-hidden shadow-sm">
                             <img src={ev.url} alt="ev" className="w-full h-full object-cover" />
                         </div>
                     ))}
                 </div>
             )}
          </div>

          {/* Main Actions */}
          <div className="flex p-4 space-x-3">
            <button 
                onClick={() => setShowFailModal(true)}
                className="flex-1 flex items-center justify-center px-4 py-4 bg-red-50 text-red-700 rounded-xl hover:bg-red-100 font-bold border border-red-200 transition-colors"
            >
                <X className="w-6 h-6 mr-2" />
                Fail
            </button>
            
            {/* Secondary actions (hidden by default or smaller) */}
            <div className="flex flex-col space-y-1 justify-center">
                 <button className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50" title="Skip Step">
                     <SkipForward className="w-5 h-5" />
                 </button>
                 <button className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50" title="Waive Check">
                     <AlertCircle className="w-5 h-5" />
                 </button>
            </div>

            <button 
                onClick={handlePass}
                className="flex-[2] flex items-center justify-center px-4 py-4 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-bold shadow-lg shadow-emerald-200 transform active:scale-[0.98] transition-all"
            >
                <Check className="w-6 h-6 mr-2" />
                {currentStep < steps.length - 1 ? 'Pass & Next' : 'Finish Check'}
            </button>
          </div>
      </div>

      {/* --- Modals & Overlays --- */}

      {/* Camera Overlay */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center relative bg-slate-900">
            <p className="text-white/50 text-sm absolute top-20">Camera Feed Simulator</p>
            {/* Simulated Viewfinder */}
            <div className="w-full max-w-md h-3/4 border border-white/20 relative flex items-center justify-center">
                <div className="w-64 h-64 border-2 border-white/30 rounded-lg flex items-center justify-center">
                    <span className="text-white/20 text-4xl font-thin">+</span>
                </div>
                {/* Watermark Simulator */}
                <div className="absolute bottom-4 left-4 text-[10px] text-yellow-400 font-mono bg-black/50 px-2 py-1 rounded">
                    {checkInstance?.moduleNumber || 'MOD-XXX'} | {new Date().toLocaleTimeString()}
                </div>
            </div>

            {/* Controls */}
            <div className="absolute bottom-0 w-full h-32 bg-black/40 backdrop-blur flex items-center justify-around pb-4">
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
                <div className="w-14"></div> {/* Spacer */}
            </div>
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {showNotesModal && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
              <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl overflow-hidden">
                  <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                      <h3 className="font-bold text-slate-800">Add Note</h3>
                      <button onClick={() => setShowNotesModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
                  </div>
                  <div className="p-4">
                      <textarea 
                        className="w-full h-32 border border-gray-300 rounded-lg p-3 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                        placeholder="Type observation details here..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        autoFocus
                      />
                  </div>
                  <div className="p-4 bg-gray-50 flex justify-end">
                      <button 
                        onClick={() => setShowNotesModal(false)}
                        className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"
                      >
                          Save Note
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Failure Mode Modal */}
      {showFailModal && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
              <div className="bg-white w-full max-w-lg sm:rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
                  <div className="p-4 border-b border-gray-100 bg-red-50 flex justify-between items-center rounded-t-xl">
                      <div className="flex items-center text-red-700">
                          <AlertTriangle className="w-5 h-5 mr-2" />
                          <h3 className="font-bold">Record Failure</h3>
                      </div>
                      <button onClick={() => setShowFailModal(false)}><X className="w-5 h-5 text-red-400" /></button>
                  </div>
                  
                  <div className="p-6 overflow-y-auto">
                      <div className="mb-6">
                          <label className="block text-sm font-bold text-gray-700 mb-2">Failure Mode</label>
                          <div className="space-y-2">
                              {FAILURE_MODES.map(mode => (
                                  <label 
                                    key={mode.id}
                                    className={`flex items-start p-3 border rounded-lg cursor-pointer transition-all ${
                                        failureData?.modeId === mode.id 
                                        ? 'border-red-500 bg-red-50 ring-1 ring-red-500' 
                                        : 'border-gray-200 hover:border-gray-300'
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
                                          <div className="font-semibold text-gray-900">{mode.name}</div>
                                          <div className="text-xs text-gray-500">{mode.description}</div>
                                      </div>
                                  </label>
                              ))}
                          </div>
                      </div>

                      {failureData && (
                          <div className="mb-6">
                              <label className="block text-sm font-bold text-gray-700 mb-2">Severity</label>
                              <div className="flex flex-wrap gap-2">
                                  {SEVERITY_LEVELS.map(sev => (
                                      <button
                                        key={sev.id}
                                        onClick={() => setFailureData(prev => prev ? {...prev, severityId: sev.id} : null)}
                                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                                            failureData.severityId === sev.id 
                                            ? sev.color + ' border-current ring-1 ring-current'
                                            : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                                        }`}
                                      >
                                          {sev.name}
                                      </button>
                                  ))}
                              </div>
                          </div>
                      )}

                      <div className="mb-4">
                          <label className="block text-sm font-bold text-gray-700 mb-2">Rework Instructions</label>
                          <textarea 
                              className="w-full border border-gray-300 rounded-lg p-2 text-sm h-20"
                              defaultValue={failureData ? FAILURE_MODES.find(m => m.id === failureData.modeId)?.defaultReworkText : ''}
                          />
                      </div>
                  </div>

                  <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end space-x-3 rounded-b-xl">
                      <button 
                        onClick={() => setShowFailModal(false)}
                        className="px-5 py-2 text-gray-600 font-semibold hover:bg-gray-200 rounded-lg"
                      >
                          Cancel
                      </button>
                      <button 
                        disabled={!failureData}
                        onClick={handleFailSubmit}
                        className={`px-5 py-2 text-white font-bold rounded-lg shadow-sm ${
                            failureData ? 'bg-red-600 hover:bg-red-700' : 'bg-red-300 cursor-not-allowed'
                        }`}
                      >
                          Confirm Failure
                      </button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default QCExecution;