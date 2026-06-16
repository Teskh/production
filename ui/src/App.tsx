import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

// Layouts
import AdminLayout from './layouts/AdminLayout';
import WorkerLayout from './layouts/WorkerLayout';
import QCLayout from './layouts/QCLayout';

// Pages
import Login from './pages/Login';
import PanelLineSupervisorView from './pages/PanelLineSupervisorView';

// Worker Pages
import StationWorkspace from './pages/worker/StationWorkspace';

// QC Pages
import QCDashboard from './pages/qc/QCDashboard';
import QCExecution from './pages/qc/QCExecution';
import QCLibrary from './pages/qc/QCLibrary';
import QCManualCheck from './pages/qc/QCManualCheck';
import QCComplaints from './pages/qc/QCComplaints';

// Admin Pages
import Dashboards from './pages/admin/dashboards/Dashboards';
import DashboardPanels from './pages/admin/dashboards/dashboard_panels';
import DashboardStations from './pages/admin/dashboards/dashboard_stations';
import DashboardTasks from './pages/admin/dashboards/dashboard_tasks';
import DashboardPanelAnalysis from './pages/admin/dashboards/dashboard_panel_analysis';
import DashboardTaskStationAdherence from './pages/admin/dashboards/dashboard_task_station_adherence';
import DashboardTaskFootage from './pages/admin/dashboards/dashboard_task_footage';
import DashboardAssistance from './pages/admin/dashboards/dashboard_assistance.jsx';
import DashboardLineAttendanceThroughput from './pages/admin/dashboards/dashboard_line_attendance_throughput';
import DashboardPlantView from './pages/admin/dashboards/dashboard_plant_view';
import Personnel from './pages/admin/personnel/Personnel';
import ProductionQueue from './pages/admin/planning/ProductionQueue';
import Stations from './pages/admin/config/Stations';
import HouseConfigurator from './pages/admin/config/HouseConfigurator';
import HouseParams from './pages/admin/config/HouseParams';
import TaskDefs from './pages/admin/config/TaskDefs';
import ConditionDefs from './pages/admin/config/ConditionDefs';
import PauseNoteDefs from './pages/admin/config/PauseNoteDefs';
import Backups from './pages/admin/config/Backups';
import QCChecks from './pages/admin/quality/QCChecks';

// Utility Pages
import DaySummary from './pages/utility/DaySummary';
import GeneralOverview from './pages/utility/GeneralOverview';
import FloorStatus from './pages/utility/floorStatus';
import Protocols from './pages/utility/Protocols';
import { isSysadminUser, useAdminSession } from './layouts/AdminLayoutContext';
import {
  canViewDashboard,
  dashboardApiRequest,
  type DashboardPermission,
  permissionsToMap,
} from './pages/admin/dashboards/dashboardVisibility';

const SysadminOnlyRoute = ({ element }: { element: ReactElement }) => {
  const admin = useAdminSession();
  if (!isSysadminUser(admin)) {
    return <Navigate to="/admin/dashboards" replace />;
  }
  return element;
};

const DashboardPermissionRoute = ({
  dashboardId,
  element,
}: {
  dashboardId: string;
  element: ReactElement;
}) => {
  const admin = useAdminSession();
  const [permissions, setPermissions] = useState<DashboardPermission[] | null>(null);

  useEffect(() => {
    let isMounted = true;
    dashboardApiRequest<DashboardPermission[]>('/api/admin/dashboard-permissions')
      .then((nextPermissions) => {
        if (isMounted) {
          setPermissions(nextPermissions);
        }
      })
      .catch(() => {
        if (isMounted) {
          setPermissions([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (isSysadminUser(admin)) {
    return element;
  }
  if (permissions === null) {
    return null;
  }
  if (!canViewDashboard(admin, dashboardId, permissionsToMap(permissions))) {
    return <Navigate to="/admin/dashboards" replace />;
  }
  return element;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* Supervisor Routes */}
        <Route path="/supervisor/panel-line" element={<PanelLineSupervisorView />} />

        {/* Worker Routes */}
        <Route path="/worker" element={<WorkerLayout />}>
          <Route index element={<Navigate to="stationWorkspace" replace />} />
          <Route path="stationWorkspace" element={<StationWorkspace />} />
        </Route>

        {/* QC Routes */}
        <Route path="/qc" element={<QCLayout />}>
          <Route index element={<QCDashboard />} />
          <Route path="new" element={<QCManualCheck />} />
          <Route path="library" element={<QCLibrary />} />
          <Route path="complaints" element={<QCComplaints />} />
          <Route path="checks" element={<QCChecks />} />
        </Route>
        
        {/* QC Execution - Standalone (tablet optimized, no layout wrapper) */}
        <Route path="/qc/execute" element={<QCExecution />} />

        {/* Admin Routes */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="dashboards" replace />} />
          
          {/* Personnel */}
          <Route path="workers" element={<Personnel />} />
          <Route path="specialties" element={<Personnel />} />
          <Route path="admin-users" element={<Personnel />} />
          <Route path="assistance" element={<Navigate to="/admin/workers" replace />} />
          
          {/* Planning */}
          <Route path="line-status" element={<Navigate to="/admin/production-queue" replace />} />
          <Route path="production-queue" element={<ProductionQueue />} />
          
          {/* Config */}
          <Route path="stations" element={<Stations />} />
          <Route path="house-config" element={<HouseConfigurator />} />
          <Route path="rules" element={<Navigate to="/admin/house-config" replace />} />
          <Route path="house-types" element={<Navigate to="/admin/house-config" replace />} />
          <Route
            path="house-params"
            element={<SysadminOnlyRoute element={<HouseParams />} />}
          />
          <Route path="house-panels" element={<Navigate to="/admin/house-config" replace />} />
          <Route path="task-defs" element={<TaskDefs />} />
          <Route path="condition-defs" element={<ConditionDefs />} />
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
          <Route
            path="dashboards/task-footage"
            element={
              <DashboardPermissionRoute
                dashboardId="task-footage"
                element={<DashboardTaskFootage />}
              />
            }
          />
          <Route path="dashboards/station-adherence" element={<DashboardTaskStationAdherence />} />
          <Route
            path="dashboards/assistance"
            element={
              <DashboardPermissionRoute
                dashboardId="assistance-activity"
                element={<DashboardAssistance />}
              />
            }
          />
          <Route
            path="dashboards/plant-view"
            element={
              <DashboardPermissionRoute
                dashboardId="plant-view"
                element={<DashboardPlantView />}
              />
            }
          />
          <Route
            path="dashboards/performance"
            element={<Navigate to="/admin/dashboards" replace />}
          />
          <Route
            path="dashboards/line-attendance-throughput"
            element={
              <DashboardPermissionRoute
                dashboardId="line-attendance-throughput"
                element={<DashboardLineAttendanceThroughput />}
              />
            }
          />
        </Route>

        {/* Utility Pages (Standalone?) - Spec says "accessed outside the primary navigation" */}
        <Route path="/utility/day-summary" element={<DaySummary />} />
        <Route path="/utility/overview" element={<GeneralOverview />} />
        <Route path="/utility/floor-status" element={<FloorStatus />} />
        <Route path="/utility/protocols" element={<Protocols />} />

        {/* Default Redirect */}
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
