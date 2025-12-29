import React from 'react';
import { ArrowRight, ArrowDown, Box, Settings } from 'lucide-react';

const LineStatus: React.FC = () => {
  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">Line Status</h1>
        <div className="space-x-2">
          <button className="px-4 py-2 bg-white border border-gray-300 rounded shadow-sm text-sm font-medium hover:bg-gray-50">
            Export Report
          </button>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row gap-6">
        {/* Main Process Flow */}
        <div className="flex-1 bg-white p-6 rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
          <h3 className="text-lg font-semibold text-gray-700 mb-8">Production Line Map</h3>
          
          <div className="min-w-[800px] flex flex-col items-center space-y-12">
            
            {/* 1. Panel Line (Snake Layout) */}
            <div className="w-full max-w-5xl relative">
              {/* Row 1: Left to Right */}
              <div className="flex justify-between items-center mb-4 px-24">
                {['Panel St 1', 'Panel St 2', 'Panel St 3'].map((name, i) => (
                  <React.Fragment key={name}>
                    <div className="w-56 h-32 bg-blue-50 border-2 border-blue-200 rounded-lg flex flex-col items-center justify-center relative shadow-sm hover:shadow-md transition-shadow">
                      <span className="text-xs font-bold uppercase text-blue-800 mb-1">{name}</span>
                      <span className="text-xs text-gray-500">Running</span>
                      {i === 1 && (
                         <div className="absolute -top-3 -right-3 w-6 h-6 bg-green-500 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-bold">
                           2
                         </div>
                      )}
                    </div>
                    {/* Arrow between stations */}
                    {i < 2 && <ArrowRight className="text-gray-300 w-8 h-8" />}
                  </React.Fragment>
                ))}
              </div>

              {/* U-Turn Connector (Right Side) */}
              <div className="absolute right-0 top-16 h-44 w-24 border-r-4 border-gray-200 rounded-r-3xl pointer-events-none" />
              
              {/* Row 2: Right to Left */}
              <div className="flex justify-between items-center mt-12 px-24 flex-row-reverse">
                {['Panel St 4', 'Panel St 5', 'Panel St 6'].map((name, i) => (
                  <React.Fragment key={name}>
                    <div className="w-56 h-32 bg-blue-50 border-2 border-blue-200 rounded-lg flex flex-col items-center justify-center relative shadow-sm hover:shadow-md transition-shadow">
                      <span className="text-xs font-bold uppercase text-blue-800 mb-1">{name}</span>
                      <span className="text-xs text-gray-500">Running</span>
                    </div>
                    {/* Arrow between stations (Reversed for R->L flow visualization) */}
                    {i < 2 && <ArrowRight className="text-gray-300 w-8 h-8 rotate-180" />}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Connection Panel Line -> Magazine (Centered) */}
            <div className="w-full flex justify-center">
               <ArrowDown className="text-gray-300 w-10 h-10" />
            </div>

            {/* 2. Magazine (Buffer) - Centered and cleaned up */}
            <div className="w-80 h-32 bg-indigo-50 border-2 border-indigo-200 rounded-xl flex flex-col items-center justify-center shadow-sm relative">
              <Box className="w-8 h-8 text-indigo-500 mb-2" />
              <span className="font-bold text-indigo-900">MAGAZINE</span>
            </div>

            {/* Arrows from Magazine to Assembly Lines (Centered and Branching) */}
            <div className="w-full max-w-5xl h-24 relative">
               <svg className="w-full h-full text-gray-300 overflow-visible">
                 <defs>
                   <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                     <polygon points="0 0, 10 3.5, 0 7" fill="#cbd5e1" />
                   </marker>
                 </defs>
                 {/* Start from horizontal center (50%) */}
                 {/* Main vertical stem */}
                 <line x1="50%" y1="0" x2="50%" y2="40" stroke="currentColor" strokeWidth="2" />
                 {/* Horizontal crossbar */}
                 <line x1="16.66%" y1="40" x2="83.33%" y2="40" stroke="currentColor" strokeWidth="2" />
                 {/* Three vertical drops */}
                 <line x1="16.66%" y1="40" x2="16.66%" y2="80" stroke="currentColor" strokeWidth="2" markerEnd="url(#arrowhead)" />
                 <line x1="50%" y1="40" x2="50%" y2="80" stroke="currentColor" strokeWidth="2" markerEnd="url(#arrowhead)" />
                 <line x1="83.33%" y1="40" x2="83.33%" y2="80" stroke="currentColor" strokeWidth="2" markerEnd="url(#arrowhead)" />
               </svg>
            </div>

            {/* 3. Assembly Lines */}
            <div className="w-full max-w-5xl flex justify-between gap-8">
              {['Assembly Line 1', 'Assembly Line 2', 'Assembly Line 3'].map((name) => (
                <div key={name} className="flex-1 min-w-[300px] bg-green-50 border border-green-200 rounded-lg p-4 min-h-[240px] relative flex flex-col items-center">
                  <h4 className="font-bold text-green-900 text-center mb-4">{name}</h4>
                  <div className="w-full space-y-2">
                    <div className="bg-white p-2 rounded border border-green-100 text-xs shadow-sm">
                      Status: <span className="text-green-600 font-semibold">Active</span>
                    </div>
                    <div className="bg-white p-2 rounded border border-green-100 text-xs shadow-sm">
                      Current: Batch-A
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Auxiliary Stations */}
        <div className="w-full xl:w-80 flex flex-col gap-6">
          <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 h-full">
            <h3 className="text-lg font-semibold text-gray-700 mb-6 flex items-center">
              <Settings className="w-5 h-5 mr-2" />
              Auxiliary Stations
            </h3>
            
            <div className="space-y-4">
              {['Pre-Assembly Prep', 'Custom Finishing', 'Repair Bay', 'Quality Lab'].map((st) => (
                <div key={st} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:border-gray-300 transition-colors">
                  <h4 className="font-medium text-gray-800 text-sm mb-2">{st}</h4>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-500">Idle</span>
                    <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-8 p-4 bg-blue-50 rounded border border-blue-100 text-xs text-blue-800">
              <p className="font-semibold mb-1">Note:</p>
              Auxiliary stations operate independently of the main line flow.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LineStatus;
