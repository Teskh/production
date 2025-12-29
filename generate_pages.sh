#!/bin/bash

create_page() {
  local path=$1
  local name=$2
  local title=$3
  
  mkdir -p $(dirname "ui/src/pages/$path")
  echo "import React from 'react';

const $name: React.FC = () => {
  return (
    <div className=\"p-6\">
      <h1 className=\"text-2xl font-bold mb-4\">$title</h1>
      <p className=\"text-gray-500\">This is a placeholder for the $title page.</p>
    </div>
  );
};

export default $name;" > "ui/src/pages/$path"
}

create_page "Login.tsx" "Login" "Login"
create_page "worker/StationWorkspace.tsx" "StationWorkspace" "Station Workspace"
create_page "qc/QCDashboard.tsx" "QCDashboard" "QC Dashboard"
create_page "qc/QCExecution.tsx" "QCExecution" "QC Execution"
create_page "qc/QCLibrary.tsx" "QCLibrary" "QC Library"
create_page "admin/AdminDashboard.tsx" "AdminDashboard" "Admin Dashboard"
create_page "admin/personnel/Workers.tsx" "Workers" "Workers Management"
create_page "admin/personnel/Specialties.tsx" "Specialties" "Specialties Management"
create_page "admin/personnel/AdminTeam.tsx" "AdminTeam" "Admin Team Management"
create_page "admin/personnel/Assistance.tsx" "Assistance" "Assistance Summary"
create_page "admin/planning/ProductionStatus.tsx" "ProductionStatus" "Production Status"
create_page "admin/planning/PanelHistory.tsx" "PanelHistory" "Panel Production History"
create_page "admin/planning/StationFinished.tsx" "StationFinished" "Station Panels Finished"
create_page "admin/planning/TaskAnalysis.tsx" "TaskAnalysis" "Task Analysis"
create_page "admin/planning/PanelMeters.tsx" "PanelMeters" "Panel Linear Meters"
create_page "admin/config/Stations.tsx" "Stations" "Stations Configuration"
create_page "admin/config/ModuleRules.tsx" "ModuleRules" "Module Advance Rules"
create_page "admin/config/HouseTypes.tsx" "HouseTypes" "House Types"
create_page "admin/config/HouseParams.tsx" "HouseParams" "House Parameters"
create_page "admin/config/HousePanels.tsx" "HousePanels" "House Panels"
create_page "admin/config/TaskDefs.tsx" "TaskDefs" "Task Definitions"
create_page "admin/config/PauseDefs.tsx" "PauseDefs" "Pause Definitions"
create_page "admin/config/NoteDefs.tsx" "NoteDefs" "Note Definitions"
create_page "admin/quality/QCChecks.tsx" "QCChecks" "QC Checks Configuration"
create_page "utility/DaySummary.tsx" "DaySummary" "Day Summary"
create_page "utility/GeneralOverview.tsx" "GeneralOverview" "General Overview"
