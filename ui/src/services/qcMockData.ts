// Mock data based on REBUILD_ALT_MODEL.md and QUALITY_CONTROL.md

export interface QCSeverityLevel {
  id: string;
  name: 'Low' | 'Medium' | 'High' | 'Critical';
  color: string;
}

export interface QCFailureMode {
  id: string;
  name: string;
  description: string;
  defaultSeverityId: string;
  defaultReworkText: string;
}

export interface QCCheckDefinition {
  id: string;
  name: string;
  category: string;
  guidance: string;
  steps: { title: string; desc: string; image?: string }[]; // UI helper for multi-step checks
}

export interface QCCheckInstance {
  id: string;
  checkDefinitionId: string;
  moduleNumber: string; // derived from WorkUnit
  stationName: string;
  status: 'Open' | 'Closed';
  outcome?: 'Pass' | 'Fail' | 'Waive' | 'Skip';
  severityId?: string;
  createdAt: string;
  scope: 'Module' | 'Panel';
  panelCode?: string;
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
}

// --- Mock Data ---

export const SEVERITY_LEVELS: QCSeverityLevel[] = [
  { id: 'sev_low', name: 'Low', color: 'bg-blue-100 text-blue-800' },
  { id: 'sev_med', name: 'Medium', color: 'bg-yellow-100 text-yellow-800' },
  { id: 'sev_high', name: 'High', color: 'bg-orange-100 text-orange-800' },
  { id: 'sev_crit', name: 'Critical', color: 'bg-red-100 text-red-800' },
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
];

export const CHECK_DEFINITIONS: Record<string, QCCheckDefinition> = {
  'chk_wall': {
    id: 'chk_wall',
    name: 'Wall Assembly Check',
    category: 'Assembly',
    guidance: 'Verify all studs are vertical and spacing matches blueprint. Check top/bottom plate connections.',
    steps: [
      { title: 'Stud Spacing', desc: 'Verify 40cm on center spacing.', image: 'https://placehold.co/600x300/e2e8f0/64748b?text=Stud+Spacing' },
      { title: 'Plate Connections', desc: 'Ensure top and bottom plates are securely fastened.', image: 'https://placehold.co/600x300/e2e8f0/64748b?text=Plate+Connections' }
    ]
  },
  'chk_ins': {
    id: 'chk_ins',
    name: 'Insulation Verification',
    category: 'Insulation',
    guidance: 'Insulation must be flush with studs, no gaps, no compression.',
    steps: [
      { title: 'Coverage', desc: 'Check for gaps at corners and edges.', image: 'https://placehold.co/600x300/e2e8f0/64748b?text=Insulation+Coverage' },
      { title: 'Flush Fit', desc: 'Ensure insulation is not compressed or bulging.', image: 'https://placehold.co/600x300/e2e8f0/64748b?text=Flush+Fit' }
    ]
  },
  'chk_finish': {
    id: 'chk_finish',
    name: 'Surface Finish',
    category: 'Finishing',
    guidance: 'Check for scratches, dents, or uneven paint application.',
    steps: [
      { title: 'Visual Inspection', desc: 'Inspect from 1m distance under ample light.', image: 'https://placehold.co/600x300/e2e8f0/64748b?text=Surface+Check' }
    ]
  }
};

export const PENDING_CHECKS: QCCheckInstance[] = [
  { id: 'inst_1', checkDefinitionId: 'chk_wall', moduleNumber: 'MOD-101', stationName: 'Wall Assembly', status: 'Open', createdAt: '10:00 AM', scope: 'Module' },
  { id: 'inst_2', checkDefinitionId: 'chk_ins', moduleNumber: 'MOD-105', stationName: 'Insulation', status: 'Open', createdAt: '10:15 AM', scope: 'Module' },
  { id: 'inst_3', checkDefinitionId: 'chk_finish', moduleNumber: 'MOD-099', stationName: 'Finishing', status: 'Open', createdAt: '09:45 AM', scope: 'Panel', panelCode: 'P-22' },
];

export const REWORK_TASKS: QCReworkTask[] = [
  { id: 'rw_1', checkInstanceId: 'inst_old_1', moduleNumber: 'MOD-080', stationName: 'Wall Assembly', description: 'Missing header insulation', status: 'Open', priority: 'High', createdAt: 'Yesterday' },
  { id: 'rw_2', checkInstanceId: 'inst_old_2', moduleNumber: 'MOD-095', stationName: 'Framing', description: 'Loose stud at joint 3', status: 'InProgress', priority: 'Medium', createdAt: 'Today 8:00 AM' },
];

export const MODULE_HISTORY = [
  { moduleNumber: 'MOD-101', houseType: 'Type A', status: 'Assembly', lastCheck: 'Passed', pendingRework: 0 },
  { moduleNumber: 'MOD-102', houseType: 'Type A', status: 'Completed', lastCheck: 'Passed', pendingRework: 0 },
  { moduleNumber: 'MOD-103', houseType: 'Type B', status: 'Assembly', lastCheck: 'Failed', pendingRework: 1 },
  { moduleNumber: 'MOD-104', houseType: 'Type A', status: 'Magazine', lastCheck: 'Passed', pendingRework: 0 },
  { moduleNumber: 'MOD-105', houseType: 'Type C', status: 'Assembly', lastCheck: 'Pending', pendingRework: 0 },
];
