import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { ComponentType, ReactElement } from 'react';

// Layouts
import AdminLayout from './layouts/AdminLayout';
import WorkerLayout from './layouts/WorkerLayout';
import QCLayout from './layouts/QCLayout';
import { useOptionalQCSession } from './layouts/QCLayoutContext';

// Pages
import Login from './pages/Login';
import { isSysadminUser, useAdminSession } from './layouts/AdminLayoutContext';
import {
  canViewDashboard,
  dashboardApiRequest,
  type DashboardPermission,
  permissionsToMap,
} from './pages/admin/dashboards/dashboardVisibility';

const CHUNK_RELOAD_KEY = 'scp-route-chunk-reload';

const lazyRoute = <T extends ComponentType<Record<string, unknown>>>(
  loader: () => Promise<{ default: T }>,
) =>
  lazy(async () => {
    try {
      const module = await loader();
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      return module;
    } catch (error) {
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
        window.location.reload();
        return new Promise<never>(() => undefined);
      }
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      throw error;
    }
  });

const PanelLineSupervisorView = lazyRoute(() => import('./pages/PanelLineSupervisorView'));
const StationWorkspace = lazyRoute(() => import('./pages/worker/StationWorkspace'));
const QCMainMenu = lazyRoute(() => import('./pages/qc/QCMainMenu'));
const QCDashboards = lazyRoute(() => import('./pages/qc/QCDashboards'));
const DashboardQualityCompliance = lazyRoute(
  () => import('./pages/qc/dashboard_quality_compliance'),
);
const DashboardFailureAnalysis = lazyRoute(
  () => import('./pages/qc/dashboard_failure_analysis'),
);
const QCExecution = lazyRoute(() => import('./pages/qc/QCExecution'));
const QCLibrary = lazyRoute(() => import('./pages/qc/QCLibrary'));
const QCManualCheck = lazyRoute(() => import('./pages/qc/QCManualCheck'));
const QCComplaints = lazyRoute(() => import('./pages/qc/QCComplaints'));
const Dashboards = lazyRoute(() => import('./pages/admin/dashboards/Dashboards'));
const DashboardPanels = lazyRoute(() => import('./pages/admin/dashboards/dashboard_panels'));
const DashboardStations = lazyRoute(() => import('./pages/admin/dashboards/dashboard_stations'));
const DashboardTasks = lazyRoute(() => import('./pages/admin/dashboards/dashboard_tasks'));
const DashboardPanelAnalysis = lazyRoute(
  () => import('./pages/admin/dashboards/dashboard_panel_analysis'),
);
const DashboardTaskStationAdherence = lazyRoute(
  () => import('./pages/admin/dashboards/dashboard_task_station_adherence'),
);
const DashboardTaskSequence = lazyRoute(
  () => import('./pages/admin/dashboards/dashboard_task_sequence'),
);
const DashboardTaskFootage = lazyRoute(
  () => import('./pages/admin/dashboards/dashboard_task_footage'),
);
const DashboardAssistance = lazyRoute(
  () => import('./pages/admin/dashboards/dashboard_assistance.jsx'),
);
const DashboardLineAttendanceThroughput = lazyRoute(
  () => import('./pages/admin/dashboards/dashboard_line_attendance_throughput'),
);
const DashboardPlantView = lazyRoute(
  () => import('./pages/admin/dashboards/dashboard_plant_view'),
);
const Personnel = lazyRoute(() => import('./pages/admin/personnel/Personnel'));
const ProductionQueue = lazyRoute(() => import('./pages/admin/planning/ProductionQueue'));
const Stations = lazyRoute(() => import('./pages/admin/config/Stations'));
const HouseConfigurator = lazyRoute(() => import('./pages/admin/config/HouseConfigurator'));
const HouseParams = lazyRoute(() => import('./pages/admin/config/HouseParams'));
const TaskDefs = lazyRoute(() => import('./pages/admin/config/TaskDefs'));
const ConditionDefs = lazyRoute(() => import('./pages/admin/config/ConditionDefs'));
const PauseNoteDefs = lazyRoute(() => import('./pages/admin/config/PauseNoteDefs'));
const Backups = lazyRoute(() => import('./pages/admin/config/Backups'));
const Labels = lazyRoute(() => import('./pages/admin/config/Labels'));
const QCChecks = lazyRoute(() => import('./pages/admin/quality/QCChecks'));
const DaySummary = lazyRoute(() => import('./pages/utility/DaySummary'));
const GeneralOverview = lazyRoute(() => import('./pages/utility/GeneralOverview'));
const FloorStatus = lazyRoute(() => import('./pages/utility/floorStatus'));
const Protocols = lazyRoute(() => import('./pages/utility/Protocols'));

const RouteLoadingFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
    <div className="flex items-center gap-3 text-sm font-medium">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-orange-400" />
      Cargando modulo...
    </div>
  </div>
);

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

const QCDashboardPermissionRoute = ({
  dashboardId,
  element,
}: {
  dashboardId: string;
  element: ReactElement;
}) => {
  const admin = useOptionalQCSession();
  const [permissions, setPermissions] = useState<DashboardPermission[] | null>(null);

  useEffect(() => {
    if (!admin) {
      return;
    }
    let isMounted = true;
    dashboardApiRequest<DashboardPermission[]>('/api/admin/dashboard-permissions')
      .then((nextPermissions) => {
        if (isMounted) setPermissions(nextPermissions);
      })
      .catch(() => {
        if (isMounted) setPermissions([]);
      });
    return () => {
      isMounted = false;
    };
  }, [admin]);

  if (!admin) {
    return <Navigate to="/qc/dashboards" replace state={{ qcLogin: true }} />;
  }
  if (isSysadminUser(admin)) return element;
  if (permissions === null) return null;
  if (!canViewDashboard(admin, dashboardId, permissionsToMap(permissions))) {
    return <Navigate to="/qc/dashboards" replace />;
  }
  return element;
};

function App() {
  return (
    <Router>
      <Suspense fallback={<RouteLoadingFallback />}>
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
          <Route index element={<QCMainMenu />} />
          <Route path="dashboards" element={<QCDashboards />} />
          <Route
            path="dashboards/quality-compliance"
            element={
              <QCDashboardPermissionRoute
                dashboardId="qc-quality-compliance"
                element={<DashboardQualityCompliance />}
              />
            }
          />
          <Route
            path="dashboards/failure-analysis"
            element={
              <QCDashboardPermissionRoute
                dashboardId="qc-failure-analysis"
                element={<DashboardFailureAnalysis />}
              />
            }
          />
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
          <Route
            path="labels"
            element={<SysadminOnlyRoute element={<Labels />} />}
          />
          
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
          <Route path="dashboards/task-sequence" element={<DashboardTaskSequence />} />
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
      </Suspense>
    </Router>
  );
}

export default App;
