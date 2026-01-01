import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, MapPin, Calendar, ArrowRight, Shield, QrCode } from 'lucide-react';

// Mock Data Types
type Worker = {
  name: string;
  stations: string[];
};

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [showStationPicker, setShowStationPicker] = useState(false);
  const [stationContext, setStationContext] = useState('Line 1 - Station A');
  const [showAllWorkers, setShowAllWorkers] = useState(false);

  // Mock Data
  const stations = ['Line 1 - Station A', 'Line 1 - Station B', 'Line 2 - Station A'];
  
  const workers: Worker[] = [
    { name: 'John Doe', stations: ['Line 1 - Station A'] },
    { name: 'Jane Smith', stations: ['Line 1 - Station A'] },
    { name: 'Mike Ross', stations: ['Line 1 - Station A'] },
    { name: 'Rachel Zane', stations: ['Line 1 - Station A'] },
    { name: 'Bob Johnson', stations: ['Line 1 - Station B'] },
    { name: 'Alice Williams', stations: ['Line 2 - Station A'] },
    { name: 'Harvey Specter', stations: ['Line 1 - Station B', 'Line 2 - Station A'] },
    { name: 'Donna Paulsen', stations: ['Line 1 - Station A'] },
  ];

  const WORKER_THRESHOLD = 5;

  const handleLogin = () => {
    if (isAdmin) {
      navigate('/admin');
    } else {
      // Logic to determine where to go next
      // For now, we just go to the station dashboard or worker workspace
      navigate('/worker/stationWorkspace');
    }
  };

  const handleStationSelect = (station: string) => {
    setStationContext(station);
    setShowStationPicker(false);
    setSelectedWorker(null); // Reset selection on station change
    setShowAllWorkers(false); // Reset "show all" on station change
  };

  const availableWorkers = useMemo(() => {
    if (showAllWorkers) return workers;
    return workers.filter(w => w.stations.includes(stationContext));
  }, [workers, stationContext, showAllWorkers]);

  const shouldUseDropdown = showAllWorkers || availableWorkers.length > WORKER_THRESHOLD;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col lg:flex-row">
      {/* Left Panel: Login Form */}
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-20 xl:px-24 bg-white shadow-xl z-10">
        <div className="mx-auto w-full max-w-sm lg:w-96">
          <div className="mb-8">
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
              {isAdmin ? 'Admin Portal' : 'Worker Sign In'}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {isAdmin ? 'Enter your credentials to manage the system.' : 'Select your identity and station to begin.'}
            </p>
          </div>

          <div className="space-y-6">
            {!isAdmin ? (
              <>
                {/* Station Display/Picker Trigger */}
                <div>
                  <label className="block text-sm font-medium text-gray-700">Current Station</label>
                  <div className="mt-1 flex items-center justify-between p-3 border border-gray-200 rounded-md bg-gray-50 text-gray-500">
                    <div className="flex items-center">
                      <MapPin className="w-4 h-4 mr-2" />
                      {stationContext}
                    </div>
                    <button onClick={() => setShowStationPicker(true)} className="text-xs text-blue-600 font-semibold uppercase hover:text-blue-800">Change</button>
                  </div>
                </div>

                {/* Worker Selection */}
                <div>
                  <label htmlFor="worker" className="block text-sm font-medium text-gray-700 mb-2">
                    Who are you?
                  </label>
                  
                  {shouldUseDropdown ? (
                    <div className="relative">
                      <select
                        id="worker"
                        className="block w-full pl-3 pr-10 py-3 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md border bg-white"
                        value={selectedWorker || ''}
                        onChange={(e) => setSelectedWorker(e.target.value)}
                      >
                        <option value="" disabled>Select your name</option>
                        {availableWorkers.map(w => <option key={w.name} value={w.name}>{w.name}</option>)}
                      </select>
                      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                        <User className="h-5 w-5 text-gray-400" />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {availableWorkers.map(w => (
                        <button
                          key={w.name}
                          onClick={() => setSelectedWorker(w.name)}
                          className={`w-full text-left px-4 py-3 border rounded-md transition-colors flex items-center justify-between ${
                            selectedWorker === w.name
                              ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500'
                              : 'border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <span className={`font-medium ${selectedWorker === w.name ? 'text-blue-900' : 'text-gray-900'}`}>
                            {w.name}
                          </span>
                          {selectedWorker === w.name && <div className="h-2 w-2 rounded-full bg-blue-500"></div>}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex justify-between items-center">
                     {!showAllWorkers ? (
                        <button 
                          onClick={() => setShowAllWorkers(true)}
                          className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          Not in your station? Log in
                        </button>
                     ) : (
                        <button 
                          onClick={() => setShowAllWorkers(false)}
                          className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
                        >
                          Show station workers only
                        </button>
                     )}

                    <button className="text-sm text-blue-600 hover:text-blue-500 flex items-center ml-auto">
                      <QrCode className="w-4 h-4 mr-1" /> Scan Badge
                    </button>
                  </div>
                </div>

                {selectedWorker && (
                  <div className="animate-fade-in-down">
                    <label htmlFor="pin" className="block text-sm font-medium text-gray-700">
                      PIN Code
                    </label>
                    <div className="mt-1 relative rounded-md shadow-sm">
                      <input
                        type="password"
                        id="pin"
                        className="focus:ring-blue-500 focus:border-blue-500 block w-full pl-3 pr-10 py-3 sm:text-sm border-gray-300 rounded-md border"
                        placeholder="Enter PIN"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                      />
                      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                        <Lock className="h-5 w-5 text-gray-400" />
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Admin Form Fields Placeholder */}
                <div>
                  <label className="block text-sm font-medium text-gray-700">Username</label>
                  <input type="text" className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-3 px-3 focus:ring-blue-500 focus:border-blue-500 sm:text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Password</label>
                  <input type="password" className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-3 px-3 focus:ring-blue-500 focus:border-blue-500 sm:text-sm" />
                </div>
              </>
            )}

            <div>
              <button
                onClick={handleLogin}
                disabled={!isAdmin && (!selectedWorker || !pin)}
                className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                  (!isAdmin && (!selectedWorker || !pin)) ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {isAdmin ? 'Log in as Admin' : 'Start Shift'}
                <ArrowRight className="ml-2 w-4 h-4" />
              </button>
            </div>
          </div>
          
          <div className="mt-6">
            <button 
              onClick={() => {
                setIsAdmin(!isAdmin);
                setSelectedWorker(null);
                setPin('');
              }}
              className="w-full flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <Shield className="w-4 h-4 mr-2 text-gray-500" />
              {isAdmin ? 'Switch to Worker Login' : 'Admin Login'}
            </button>
          </div>
        </div>
      </div>

      {/* Right Panel: Station Schedule Preview */}
      <div className="hidden lg:flex flex-1 bg-slate-800 text-white p-12 flex-col">
        <div className="mb-8">
          <h3 className="text-xl font-bold flex items-center mb-2">
            <Calendar className="w-6 h-6 mr-2 text-blue-400" />
            Station Schedule Preview
          </h3>
          <p className="text-slate-400">Upcoming tasks for {stationContext}</p>
        </div>

        <div className="bg-slate-700 rounded-lg overflow-hidden shadow-lg flex-1">
          <table className="min-w-full divide-y divide-slate-600">
            <thead className="bg-slate-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">Time</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">Module</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">Task</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-600">
              {[1, 2, 3, 4, 5].map((i) => (
                <tr key={i} className="hover:bg-slate-600 transition-colors cursor-pointer">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">08:{15 + i * 15}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">MOD-2023-{100 + i}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">Frame Assembly</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Station Picker Modal */}
      {showStationPicker && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 sm:mx-0 sm:h-10 sm:w-10">
                    <MapPin className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                      Confirm Station
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500 mb-4">
                        Please confirm which station you are logging into.
                      </p>
                      <div className="grid grid-cols-1 gap-2">
                        {stations.map(s => (
                          <button
                            key={s}
                            onClick={() => handleStationSelect(s)}
                            className="w-full text-left px-4 py-3 border border-gray-300 rounded-md hover:bg-blue-50 hover:border-blue-500 transition-colors"
                          >
                            <span className="font-semibold block">{s}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
