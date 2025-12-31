import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Layouts
import AdminLayout from './layouts/AdminLayout';
import WorkerLayout from './layouts/WorkerLayout';
import QCLayout from './layouts/QCLayout';

// Pages
import Login from './pages/Login';

// Worker Pages
import StationWorkspace from './pages/worker/StationWorkspace';

// QC Pages
import QCDashboard from './pages/qc/QCDashboard';
import QCExecution from './pages/qc/QCExecution';
import QCLibrary from './pages/qc/QCLibrary';

// Admin Pages
import AdminDashboard from './pages/admin/AdminDashboard';
import Workers from './pages/admin/personnel/Workers';
import Specialties from './pages/admin/personnel/Specialties';
import AdminTeam from './pages/admin/personnel/AdminTeam';
import Assistance from './pages/admin/personnel/Assistance';
import LineStatus from './pages/admin/planning/LineStatus';
import ProductionQueue from './pages/admin/planning/ProductionQueue';
import PanelHistory from './pages/admin/planning/PanelHistory';
import StationFinished from './pages/admin/planning/StationFinished';
import TaskAnalysis from './pages/admin/planning/TaskAnalysis';
import PanelMeters from './pages/admin/planning/PanelMeters';
import Stations from './pages/admin/config/Stations';
import ModuleRules from './pages/admin/config/ModuleRules';
import HouseTypes from './pages/admin/config/HouseTypes';
import HouseParams from './pages/admin/config/HouseParams';
import HousePanels from './pages/admin/config/HousePanels';
import TaskDefs from './pages/admin/config/TaskDefs';
import PauseDefs from './pages/admin/config/PauseDefs';
import NoteDefs from './pages/admin/config/NoteDefs';
import Backups from './pages/admin/config/Backups';
import QCChecks from './pages/admin/quality/QCChecks';

// Utility Pages
import DaySummary from './pages/utility/DaySummary';
import GeneralOverview from './pages/utility/GeneralOverview';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* Worker Routes */}
        <Route path="/station" element={<WorkerLayout />}>
          <Route index element={<StationWorkspace />} />
        </Route>

        {/* QC Routes */}
        <Route path="/qc" element={<QCLayout />}>
          <Route index element={<QCDashboard />} />
          <Route path="execute" element={<QCExecution />} />
          <Route path="library" element={<QCLibrary />} />
        </Route>

        {/* Admin Routes */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          
          {/* Personnel */}
          <Route path="workers" element={<Workers />} />
          <Route path="specialties" element={<Specialties />} />
          <Route path="team" element={<AdminTeam />} />
          <Route path="assistance" element={<Assistance />} />
          
          {/* Planning */}
          <Route path="line-status" element={<LineStatus />} />
          <Route path="production-queue" element={<ProductionQueue />} />
          <Route path="panel-history" element={<PanelHistory />} />
          <Route path="station-finished" element={<StationFinished />} />
          <Route path="task-analysis" element={<TaskAnalysis />} />
          <Route path="panel-meters" element={<PanelMeters />} />
          
          {/* Config */}
          <Route path="stations" element={<Stations />} />
          <Route path="rules" element={<ModuleRules />} />
          <Route path="house-types" element={<HouseTypes />} />
          <Route path="house-params" element={<HouseParams />} />
          <Route path="house-panels" element={<HousePanels />} />
          <Route path="task-defs" element={<TaskDefs />} />
          <Route path="pause-defs" element={<PauseDefs />} />
          <Route path="note-defs" element={<NoteDefs />} />
          <Route path="backups" element={<Backups />} />
          
          {/* Quality Config */}
          <Route path="qc-checks" element={<QCChecks />} />
        </Route>

        {/* Utility Pages (Standalone?) - Spec says "accessed outside the primary navigation" */}
        <Route path="/utility/day-summary" element={<DaySummary />} />
        <Route path="/utility/overview" element={<GeneralOverview />} />

        {/* Default Redirect */}
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
