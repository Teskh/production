import React, { useState } from 'react';
import { 
  Camera, Check, X, 
  MessageSquare, Maximize2 
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const QCExecution: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  
  const steps = [
    { title: 'Check corner joints', desc: 'Ensure no gaps > 2mm at the joints.', image: 'https://via.placeholder.com/600x300/e2e8f0/64748b?text=Reference+Image+1' },
    { title: 'Verify insulation', desc: 'Insulation must be flush with studs.', image: 'https://via.placeholder.com/600x300/e2e8f0/64748b?text=Reference+Image+2' },
  ];

  const handlePass = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      navigate('/qc');
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-100">
      {/* Top: Guidance / Reference */}
      <div className="flex-1 bg-white shadow-sm m-4 rounded-lg overflow-hidden flex flex-col relative">
        <div className="absolute top-4 left-4 z-10 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
          Step {currentStep + 1} of {steps.length}
        </div>
        
        <div className="flex-1 bg-gray-200 flex items-center justify-center relative group">
           <img 
             src={steps[currentStep].image} 
             alt="Reference" 
             className="w-full h-full object-cover"
           />
           <button className="absolute bottom-4 right-4 bg-white/90 p-2 rounded-full shadow hover:bg-white transition-opacity">
             <Maximize2 className="w-5 h-5 text-gray-700" />
           </button>
        </div>

        <div className="p-6 border-t border-gray-100">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{steps[currentStep].title}</h2>
          <p className="text-lg text-gray-600">{steps[currentStep].desc}</p>
        </div>
      </div>

      {/* Bottom: Action Controls */}
      <div className="h-24 bg-white border-t border-gray-200 flex items-center justify-between px-6 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
        <div className="flex items-center space-x-4">
          <button 
            onClick={() => setShowCamera(true)}
            className="flex flex-col items-center justify-center w-16 h-16 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          >
            <Camera className="w-6 h-6 mb-1" />
            <span className="text-xs font-semibold">Evidence</span>
          </button>
          
          <button className="flex flex-col items-center justify-center w-16 h-16 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
            <MessageSquare className="w-6 h-6 mb-1" />
            <span className="text-xs font-semibold">Note</span>
          </button>
          
          {/* Gallery Preview Placeholder */}
          <div className="flex space-x-2 ml-4 border-l pl-4">
             <div className="w-12 h-12 bg-gray-300 rounded overflow-hidden"></div>
             <div className="w-12 h-12 bg-gray-300 rounded overflow-hidden"></div>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <button className="flex items-center px-6 py-3 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-bold">
            <X className="w-5 h-5 mr-2" />
            Fail
          </button>
          <button 
            onClick={handlePass}
            className="flex items-center px-8 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 font-bold shadow-md transform active:scale-95 transition-all"
          >
            <Check className="w-6 h-6 mr-2" />
            {currentStep < steps.length - 1 ? 'Pass & Next' : 'Finish Check'}
          </button>
        </div>
      </div>

      {/* Full Screen Camera Overlay */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex-1 flex items-center justify-center relative">
            <p className="text-white">Camera Feed Placeholder</p>
            {/* Capture Button */}
            <div className="absolute bottom-10 w-20 h-20 rounded-full border-4 border-white flex items-center justify-center">
              <div className="w-16 h-16 bg-white rounded-full"></div>
            </div>
          </div>
          <button 
            onClick={() => setShowCamera(false)}
            className="absolute top-4 right-4 text-white p-2"
          >
            <X className="w-8 h-8" />
          </button>
        </div>
      )}
    </div>
  );
};

export default QCExecution;