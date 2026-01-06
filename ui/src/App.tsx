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
import Dashboards from './pages/admin/dashboards/Dashboards';
import DashboardPanels from './pages/admin/dashboards/dashboard_panels';
import DashboardStations from './pages/admin/dashboards/dashboard_stations';
import DashboardTasks from './pages/admin/dashboards/dashboard_tasks';
import DashboardPanelAnalysis from './pages/admin/dashboards/dashboard_panel_analysis';
import Personnel from './pages/admin/personnel/Personnel';
import LineStatus from './pages/admin/planning/LineStatus';
import ProductionQueue from './pages/admin/planning/ProductionQueue';
import Stations from './pages/admin/config/Stations';
import HouseConfigurator from './pages/admin/config/HouseConfigurator';
import HouseParams from './pages/admin/config/HouseParams';
import TaskDefs from './pages/admin/config/TaskDefs';
import PauseNoteDefs from './pages/admin/config/PauseNoteDefs';
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
        <Route path="/worker" element={<WorkerLayout />}>
          <Route index element={<Navigate to="stationWorkspace" replace />} />
          <Route path="stationWorkspace" element={<StationWorkspace />} />
        </Route>

        {/* QC Routes */}
        <Route path="/qc" element={<QCLayout />}>
          <Route index element={<QCDashboard />} />
          <Route path="library" element={<QCLibrary />} />
          <Route path="checks" element={<QCChecks />} />
        </Route>
        
        {/* QC Execution - Standalone (tablet optimized, no layout wrapper) */}
        <Route path="/qc/execute" element={<QCExecution />} />

        {/* Admin Routes */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          
          {/* Personnel */}
          <Route path="workers" element={<Personnel />} />
          <Route path="specialties" element={<Personnel />} />
          <Route path="admin-users" element={<Personnel />} />
          <Route path="assistance" element={<Navigate to="/admin/workers" replace />} />
          
          {/* Planning */}
          <Route path="line-status" element={<LineStatus />} />
          <Route path="production-queue" element={<ProductionQueue />} />
          
          {/* Config */}
          <Route path="stations" element={<Stations />} />
          <Route path="house-config" element={<HouseConfigurator />} />
          <Route path="rules" element={<Navigate to="/admin/house-config" replace />} />
          <Route path="house-types" element={<Navigate to="/admin/house-config" replace />} />
          <Route path="house-params" element={<HouseParams />} />
          <Route path="house-panels" element={<Navigate to="/admin/house-config" replace />} />
          <Route path="task-defs" element={<TaskDefs />} />
          <Route path="pause-note-defs" element={<PauseNoteDefs />} />
          <Route
            path="pause-defs"
            element={<Navigate to="/admin/pause-note-defs?tab=pausas" replace />}
          />
          <Route
            path="note-defs"
            element={<Navigate to="/admin/pause-note-defs?tab=comentarios" replace />}
          />
          <Route path="backups" element={<Backups />} />
          
          {/* Dashboards */}
          <Route path="dashboards" element={<Dashboards />} />
          <Route path="dashboards/panels" element={<DashboardPanels />} />
          <Route path="dashboards/stations" element={<DashboardStations />} />
          <Route path="dashboards/panel-analysis" element={<DashboardPanelAnalysis />} />
          <Route path="dashboards/tasks" element={<DashboardTasks />} />
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
