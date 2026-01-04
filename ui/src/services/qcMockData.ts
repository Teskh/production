// Mock data based on REBUILD_ALT_MODEL.md and QUALITY_CONTROL.md

// --- Definitions ---

export interface QCSeverityLevel {
  id: string;
  name: 'Low' | 'Medium' | 'High' | 'Critical';
  color: string;
  icon?: string;
}

export interface QCFailureMode {
  id: string;
  name: string;
  description: string;
  defaultSeverityId: string;
  defaultReworkText: string;
}

export interface QCCheckStep {
  id: string;
  title: string;
  desc: string;
  image?: string;
  required: boolean;
}

export interface QCCheckDefinition {
  id: string;
  name: string;
  category: string;
  guidance: string;
  steps: QCCheckStep[];
  trigger: 'Task Completion' | 'Station Entry' | 'Manual';
  samplingRate: number; // 0.0 to 1.0
  applicability: string; // e.g., "All Walls", "Type A only"
}

// --- Runtime Entities ---

export interface QCCheckInstance {
  id: string;
  checkDefinitionId: string;
  moduleNumber: string;
  stationName: string;
  stationId: string;
  status: 'Open' | 'Closed';
  outcome?: 'Pass' | 'Fail' | 'Waive' | 'Skip';
  severityId?: string;
  createdAt: string; // ISO-ish for sorting
  scope: 'Module' | 'Panel';
  panelCode?: string;
  assignedTo?: string; // QC Worker
  samplingType: 'Random' | 'Forced' | 'Manual';
}

export interface QCReworkTask {
  id: string;
  checkInstanceId: string;
  moduleNumber: string;
  stationName: string;
  description: string;
  status: 'Open' | 'InProgress' | 'Done' | 'Canceled';
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  createdAt: string;
  assignedWorker?: string;
}

export interface QCEventTimeline {
  id: string;
  type: 'check' | 'rework' | 'movement';
  title: string;
  subtitle: string;
  timestamp: string;
  status?: string;
  user?: string;
}

// --- Mock Data Constants ---

export const SEVERITY_LEVELS: QCSeverityLevel[] = [
  { id: 'sev_low', name: 'Low', color: 'bg-blue-100 text-blue-800' },
  { id: 'sev_med', name: 'Medium', color: 'bg-amber-100 text-amber-800' },
  { id: 'sev_high', name: 'High', color: 'bg-orange-100 text-orange-800' },
  { id: 'sev_crit', name: 'Critical', color: 'bg-rose-100 text-rose-800' },
];

export const FAILURE_MODES: QCFailureMode[] = [
  { 
    id: 'fm_dim', 
    name: 'Incorrect Dimensions', 
    description: 'Measured dimensions do not match the plan.', 
    defaultSeverityId: 'sev_med',
    defaultReworkText: 'Measure and trim to correct size.'
  },
  { 
    id: 'fm_gap', 
    name: 'Excessive Gap', 
    description: 'Joint gap exceeds 2mm tolerance.', 
    defaultSeverityId: 'sev_low',
    defaultReworkText: 'Apply filler or shim as necessary.'
  },
  { 
    id: 'fm_miss', 
    name: 'Missing Component', 
    description: 'Required part is missing from the assembly.', 
    defaultSeverityId: 'sev_high',
    defaultReworkText: 'Install missing component.'
  },
  {
    id: 'fm_damage',
    name: 'Material Damage',
    description: 'Visible damage to surface or structure.',
    defaultSeverityId: 'sev_med',
    defaultReworkText: 'Replace damaged component.'
  }
];

export const CHECK_DEFINITIONS: Record<string, QCCheckDefinition> = {
  'chk_wall': {
    id: 'chk_wall',
    name: 'Wall Assembly Verification',
    category: 'Assembly',
    guidance: 'Verify all studs are vertical and spacing matches blueprint. Check top/bottom plate connections.',
    trigger: 'Task Completion',
    samplingRate: 1.0,
    applicability: 'All Modules',
    steps: [
      { id: 's1', title: 'Stud Spacing', desc: 'Verify 40cm on center spacing (+/- 5mm).', required: true, image: 'https://placehold.co/600x300/e2e8f0/64748b?text=Stud+Spacing' },
      { id: 's2', title: 'Plate Connections', desc: 'Ensure top and bottom plates are securely fastened with correct nail pattern.', required: true, image: 'https://placehold.co/600x300/e2e8f0/64748b?text=Plate+Connections' },
      { id: 's3', title: 'Squareness', desc: 'Measure diagonals to ensure frame is square.', required: true }
    ]
  },
  'chk_ins': {
    id: 'chk_ins',
    name: 'Insulation Quality',
    category: 'Insulation',
    guidance: 'Insulation must be flush with studs, no gaps, no compression.',
    trigger: 'Station Entry',
    samplingRate: 0.2,
    applicability: 'House Type A, B',
    steps: [
      { id: 's1', title: 'Coverage', desc: 'Check for gaps at corners and edges.', required: true },
      { id: 's2', title: 'Flush Fit', desc: 'Ensure insulation is not compressed or bulging.', required: true }
    ]
  },
  'chk_finish': {
    id: 'chk_finish',
    name: 'Final Surface Inspection',
    category: 'Finishing',
    guidance: 'Check for scratches, dents, or uneven paint application.',
    trigger: 'Task Completion',
    samplingRate: 0.5,
    applicability: 'All Panels',
    steps: [
      { id: 's1', title: 'Visual Inspection', desc: 'Inspect from 1m distance under ample light.', required: true }
    ]
  }
};

export const PENDING_CHECKS: QCCheckInstance[] = [
  { id: 'inst_1', checkDefinitionId: 'chk_wall', moduleNumber: 'MOD-2024-101', stationName: 'Wall Assembly', stationId: 'st_wall', status: 'Open', createdAt: '10:00 AM', scope: 'Module', samplingType: 'Forced' },
  { id: 'inst_2', checkDefinitionId: 'chk_ins', moduleNumber: 'MOD-2024-105', stationName: 'Insulation', stationId: 'st_ins', status: 'Open', createdAt: '10:15 AM', scope: 'Module', samplingType: 'Random' },
  { id: 'inst_3', checkDefinitionId: 'chk_finish', moduleNumber: 'MOD-2024-099', stationName: 'Finishing', stationId: 'st_fin', status: 'Open', createdAt: '09:45 AM', scope: 'Panel', panelCode: 'P-22', samplingType: 'Random' },
  { id: 'inst_4', checkDefinitionId: 'chk_wall', moduleNumber: 'MOD-2024-102', stationName: 'Wall Assembly', stationId: 'st_wall', status: 'Open', createdAt: '11:00 AM', scope: 'Module', samplingType: 'Forced' },
];

export const REWORK_TASKS: QCReworkTask[] = [
  { id: 'rw_1', checkInstanceId: 'inst_old_1', moduleNumber: 'MOD-080', stationName: 'Wall Assembly', description: 'Missing header insulation', status: 'Open', priority: 'High', createdAt: 'Yesterday' },
  { id: 'rw_2', checkInstanceId: 'inst_old_2', moduleNumber: 'MOD-095', stationName: 'Framing', description: 'Loose stud at joint 3', status: 'InProgress', priority: 'Medium', createdAt: 'Today 8:00 AM', assignedWorker: 'John D.' },
  { id: 'rw_3', checkInstanceId: 'inst_old_3', moduleNumber: 'MOD-098', stationName: 'Finishing', description: 'Scratch on panel P-04', status: 'Open', priority: 'Low', createdAt: 'Today 9:30 AM' },
];

export const MODULE_TIMELINE: QCEventTimeline[] = [
  { id: 'e1', type: 'movement', title: 'Entered Wall Assembly', subtitle: 'Station Entry', timestamp: '08:00 AM', user: 'System' },
  { id: 'e2', type: 'check', title: 'Wall Assembly Verification', subtitle: 'Passed', timestamp: '09:30 AM', status: 'Pass', user: 'Sarah S.' },
  { id: 'e3', type: 'movement', title: 'Entered Insulation', subtitle: 'Station Entry', timestamp: '09:35 AM', user: 'System' },
  { id: 'e4', type: 'check', title: 'Insulation Quality', subtitle: 'Failed - Gaps detected', timestamp: '10:15 AM', status: 'Fail', user: 'Mike R.' },
  { id: 'e5', type: 'rework', title: 'Rework Created', subtitle: 'Fill gaps in insulation', timestamp: '10:16 AM', status: 'Open', user: 'System' },
  { id: 'e6', type: 'rework', title: 'Rework Started', subtitle: 'Assigned to John D.', timestamp: '10:45 AM', status: 'InProgress', user: 'John D.' },
];

export const MODULE_HISTORY = [
  { moduleNumber: 'MOD-2024-101', houseType: 'Type A', status: 'Assembly', lastCheck: 'Passed', pendingRework: 0 },
  { moduleNumber: 'MOD-2024-102', houseType: 'Type A', status: 'Completed', lastCheck: 'Passed', pendingRework: 0 },
  { moduleNumber: 'MOD-2024-103', houseType: 'Type B', status: 'Assembly', lastCheck: 'Failed', pendingRework: 1 },
  { moduleNumber: 'MOD-2024-104', houseType: 'Type A', status: 'Magazine', lastCheck: 'Passed', pendingRework: 0 },
  { moduleNumber: 'MOD-2024-105', houseType: 'Type C', status: 'Assembly', lastCheck: 'Pending', pendingRework: 0 },
];