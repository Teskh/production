import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Grid2X2,
  Home,
  Layers,
  ListOrdered,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayout';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type HouseType = {
  id: number;
  name: string;
  number_of_modules: number;
};

type HouseSubType = {
  id: number;
  house_type_id: number;
  name: string;
};

type HouseTypeDraft = {
  id?: number;
  name: string;
  number_of_modules: string;
};

type PanelDefinition = {
  id: number;
  house_type_id: number;
  module_sequence_number: number;
  sub_type_id: number | null;
  group: string;
  panel_code: string;
  panel_area: number | null;
  panel_length_m: number | null;
  applicable_task_ids: number[] | null;
  task_durations_json: Array<number | null> | null;
  panel_sequence_number: number | null;
};

type TaskScope = 'panel' | 'module' | 'aux';

type TaskDefinition = {
  id: number;
  name: string;
  scope: TaskScope;
  active: boolean;
  default_station_sequence: number | null;
};

type TaskApplicability = {
  id: number;
  task_definition_id: number;
  house_type_id: number | null;
  sub_type_id: number | null;
  module_number: number | null;
  panel_definition_id: number | null;
  applies: boolean;
  station_sequence_order: number | null;
};

type TaskExpectedDuration = {
  id: number;
  task_definition_id: number;
  house_type_id: number | null;
  sub_type_id: number | null;
  module_number: number | null;
  panel_definition_id: number | null;
  expected_minutes: number;
};

type Station = {
  id: number;
  name: string;
  role: 'Panels' | 'Magazine' | 'Assembly' | 'AUX';
  line_type: '1' | '2' | '3' | null;
  sequence_order: number | null;
};

type PanelTask = {
  id: number;
  name: string;
  station_sequence_order: number | null;
};

type ModuleTask = {
  id: number;
  name: string;
  station_sequence_order: number | null;
};

type PanelDraft = {
  id?: number;
  group: string;
  panel_code: string;
  panel_area: string;
  panel_length_m: string;
  sub_type_id: number | null;
  applicable_task_ids: Set<number>;
  task_durations: Record<number, string>;
};

type MatrixPanelState = {
  applicable_task_ids: Set<number>;
  task_durations: Record<number, string>;
};

type TaskRuleState = {
  applies: boolean;
  expectedMinutes: string;
  stationSequence: number | null;
  applicabilityRowId: number | null;
  durationRowId: number | null;
};

type TaskRuleBaseline = {
  applies: boolean;
  expectedMinutes: string;
  stationSequence: number | null;
};

type StationGroup = {
  key: string;
  title: string;
  subtitle: string;
  sequence: number | null;
  tasks: ModuleTask[];
};

const PANEL_GROUPS = [
  'Paneles de Piso',
  'Paneles de Cielo',
  'Paneles Perimetrales',
  'Tabiques Interiores',
  'Vigas Cajon',
  'Otros',
  'Multiwalls',
];

const emptyDraft = (): HouseTypeDraft => ({
  name: '',
  number_of_modules: '',
});

const buildDraftFromHouseType = (houseType: HouseType): HouseTypeDraft => ({
  id: houseType.id,
  name: houseType.name,
  number_of_modules: String(houseType.number_of_modules),
});

const normalizeSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const normalizeGroup = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const buildHeaders = (options: RequestInit): Headers => {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
};

const apiRequest = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: buildHeaders(options),
    credentials: 'include',
  });
  if (!response.ok) {
    const text = await response.text();
    if (text) {
      try {
        const data = JSON.parse(text) as { detail?: string };
        if (data?.detail) {
          throw new Error(data.detail);
        }
      } catch {
        // Fall through to the raw text.
      }
    }
    throw new Error(text || `Solicitud fallida (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

const COUNT_LABELS: Record<string, string> = {
  sub_types: 'Subtipos',
  panel_definitions: 'Definiciones de panel',
  panel_units: 'Unidades de panel',
  parameter_values: 'Valores de parametros',
  work_orders: 'Ordenes de trabajo',
  work_units: 'Unidades de trabajo',
  task_applicability: 'Aplicabilidad de tareas',
  task_expected_durations: 'Duraciones esperadas de tareas',
  task_instances: 'Instancias de tareas',
  task_participations: 'Participaciones de tareas',
  task_pauses: 'Pausas de tareas',
  task_exceptions: 'Excepciones de tareas',
  qc_applicability: 'Aplicabilidad de QC',
  qc_check_instances: 'Instancias de verificacion QC',
  qc_executions: 'Ejecuciones QC',
  qc_evidence: 'Evidencia QC',
  qc_rework_tasks: 'Tareas de retrabajo QC',
  qc_notifications: 'Notificaciones QC',
};

const parseCascadeWarning = (message: string) => {
  const matches = [...message.matchAll(/([a-z_]+)=(\d+)/g)];
  if (matches.length === 0) {
    return null;
  }
  return matches.map((match) => ({
    key: match[1],
    value: Number(match[2]),
  }));
};

const formatOptionalNumber = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

const parseOptionalNumber = (value: string): number | null | 'invalid' => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 'invalid';
  }
  return parsed;
};

const areDurationValuesEqual = (left: string, right: string): boolean => {
  const leftParsed = parseOptionalNumber(left);
  const rightParsed = parseOptionalNumber(right);
  if (leftParsed === 'invalid' || rightParsed === 'invalid') {
    return false;
  }
  if (leftParsed === null && rightParsed === null) {
    return true;
  }
  if (leftParsed === null || rightParsed === null) {
    return false;
  }
  return leftParsed === rightParsed;
};

const sortHouseTypes = (types: HouseType[]): HouseType[] =>
  [...types].sort((a, b) => a.name.localeCompare(b.name));

const sortSubtypes = (subtypes: HouseSubType[]): HouseSubType[] =>
  [...subtypes].sort((a, b) => a.name.localeCompare(b.name));

const sortPanels = (list: PanelDefinition[]) =>
  [...list].sort((a, b) => {
    if (a.panel_sequence_number != null && b.panel_sequence_number != null) {
      return a.panel_sequence_number - b.panel_sequence_number;
    }
    if (a.panel_sequence_number != null) return -1;
    if (b.panel_sequence_number != null) return 1;

    const codeCompare = a.panel_code.localeCompare(b.panel_code);
    if (codeCompare !== 0) {
      return codeCompare;
    }
    return a.id - b.id;
  });

const buildApplicableTaskSet = (panel: PanelDefinition | null, taskIds: number[]) => {
  if (!panel || panel.applicable_task_ids === null) {
    return new Set(taskIds);
  }
  return new Set(panel.applicable_task_ids.filter((id) => taskIds.includes(id)));
};

const buildDurationsMap = (panel: PanelDefinition | null, tasks: PanelTask[]) => {
  const durations: Record<number, string> = {};
  if (!panel?.task_durations_json) {
    return durations;
  }
  if (panel.applicable_task_ids === null) {
    tasks.forEach((task, index) => {
      const value = panel.task_durations_json?.[index];
      if (value !== null && value !== undefined) {
        durations[task.id] = String(value);
      }
    });
    return durations;
  }
  panel.applicable_task_ids.forEach((taskId, index) => {
    const value = panel.task_durations_json?.[index];
    if (value !== null && value !== undefined) {
      durations[taskId] = String(value);
    }
  });
  return durations;
};

const buildPanelDraft = (panel: PanelDefinition | null, tasks: PanelTask[]): PanelDraft => {
  const taskIds = tasks.map((task) => task.id);
  return {
    id: panel?.id,
    group: panel?.group ?? PANEL_GROUPS[0],
    panel_code: panel?.panel_code ?? '',
    panel_area: formatOptionalNumber(panel?.panel_area),
    panel_length_m: formatOptionalNumber(panel?.panel_length_m),
    sub_type_id: panel?.sub_type_id ?? null,
    applicable_task_ids: buildApplicableTaskSet(panel, taskIds),
    task_durations: buildDurationsMap(panel, tasks),
  };
};

const arraysEqual = <T,>(left: T[] | null | undefined, right: T[] | null | undefined) => {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
};

const pickRow = <T extends { id: number }>(
  rows: T[],
  predicate: (row: T) => boolean
): T | null => {
  let match: T | null = null;
  rows.forEach((row) => {
    if (!predicate(row)) {
      return;
    }
    if (!match || row.id < match.id) {
      match = row;
    }
  });
  return match;
};

const groupRowsByTask = <T extends { task_definition_id: number }>(
  rows: T[]
): Map<number, T[]> => {
  const map = new Map<number, T[]>();
  rows.forEach((row) => {
    const list = map.get(row.task_definition_id) ?? [];
    list.push(row);
    map.set(row.task_definition_id, list);
  });
  return map;
};

const sortTasks = (list: ModuleTask[]) =>
  [...list].sort((a, b) => {
    const aSeq = a.station_sequence_order ?? Number.POSITIVE_INFINITY;
    const bSeq = b.station_sequence_order ?? Number.POSITIVE_INFINITY;
    if (aSeq !== bSeq) {
      return aSeq - bSeq;
    }
    return a.name.localeCompare(b.name);
  });

const HouseConfigurator: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [activeTab, setActiveTab] = useState<'house-types' | 'panels' | 'module-tasks'>(
    'house-types'
  );
  const [houseTypes, setHouseTypes] = useState<HouseType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [selectedModuleNumber, setSelectedModuleNumber] = useState<number | null>(null);
  const [draft, setDraft] = useState<HouseTypeDraft>(emptyDraft());
  const [subtypesByType, setSubtypesByType] = useState<Record<number, HouseSubType[]>>({});
  const [subtypeDrafts, setSubtypeDrafts] = useState<Record<number, string>>({});
  const [newSubtypeName, setNewSubtypeName] = useState('');
  const [search, setSearch] = useState('');
  const [panels, setPanels] = useState<PanelDefinition[]>([]);
  const [taskDefinitions, setTaskDefinitions] = useState<TaskDefinition[]>([]);
  const [applicabilityRows, setApplicabilityRows] = useState<TaskApplicability[]>([]);
  const [durationRows, setDurationRows] = useState<TaskExpectedDuration[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSubtypes, setLoadingSubtypes] = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [savingSubtype, setSavingSubtype] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [typeStatusMessage, setTypeStatusMessage] = useState<string | null>(null);
  const [subtypeMessage, setSubtypeMessage] = useState<string | null>(null);

  const [panelModalOpen, setPanelModalOpen] = useState(false);
  const [panelDraft, setPanelDraft] = useState<PanelDraft | null>(null);
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);

  const [matrixOpen, setMatrixOpen] = useState(false);
  const [matrixDraft, setMatrixDraft] = useState<Record<number, MatrixPanelState>>({});
  const [matrixSaving, setMatrixSaving] = useState(false);
  const [matrixMessage, setMatrixMessage] = useState<string | null>(null);

  const [sequenceOpen, setSequenceOpen] = useState(false);
  const [sequenceDraft, setSequenceDraft] = useState<PanelDefinition[]>([]);
  const [sequenceSaving, setSequenceSaving] = useState(false);
  const [sequenceMessage, setSequenceMessage] = useState<string | null>(null);

  const [moduleDraftByTask, setModuleDraftByTask] = useState<Record<number, TaskRuleState>>({});
  const [moduleBaselineByTask, setModuleBaselineByTask] = useState<Record<number, TaskRuleBaseline>>(
    {}
  );
  const [moduleSaving, setModuleSaving] = useState(false);
  const [moduleSaveMessage, setModuleSaveMessage] = useState<string | null>(null);
  const [moduleSaveError, setModuleSaveError] = useState(false);

  useEffect(() => {
    setHeader({
      title: 'Estudio de configuracion de casas',
      kicker: 'Definicion de producto / Configuracion de casas',
    });
  }, [setHeader]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setStatusMessage(null);
      try {
        const [
          houseResult,
          panelResult,
          taskResult,
          applicabilityResult,
          durationResult,
          stationResult,
        ] = (await Promise.allSettled([
          apiRequest<HouseType[]>('/api/house-types'),
          apiRequest<PanelDefinition[]>('/api/panel-definitions'),
          apiRequest<TaskDefinition[]>('/api/task-definitions'),
          apiRequest<TaskApplicability[]>('/api/task-rules/applicability'),
          apiRequest<TaskExpectedDuration[]>('/api/task-rules/durations'),
          apiRequest<Station[]>('/api/stations'),
        ])) as [
          PromiseSettledResult<HouseType[]>,
          PromiseSettledResult<PanelDefinition[]>,
          PromiseSettledResult<TaskDefinition[]>,
          PromiseSettledResult<TaskApplicability[]>,
          PromiseSettledResult<TaskExpectedDuration[]>,
          PromiseSettledResult<Station[]>,
        ];

        if (!active) {
          return;
        }

        const messageParts: string[] = [];

        if (houseResult.status === 'fulfilled') {
          const sorted = sortHouseTypes(houseResult.value);
          setHouseTypes(sorted);
          if (sorted.length > 0) {
            setSelectedTypeId(sorted[0].id);
            setDraft(buildDraftFromHouseType(sorted[0]));
            setSelectedModuleNumber(1);
          } else {
            setSelectedTypeId(null);
            setDraft(emptyDraft());
            setSelectedModuleNumber(null);
          }
          setLoadingSubtypes(true);
          const results = await Promise.allSettled(
            sorted.map(async (houseType) => ({
              id: houseType.id,
              subtypes: await apiRequest<HouseSubType[]>(
                `/api/house-types/${houseType.id}/subtypes`
              ),
            }))
          );
          if (!active) {
            return;
          }
          const nextMap: Record<number, HouseSubType[]> = {};
          let failed = false;
          results.forEach((result) => {
            if (result.status === 'fulfilled') {
              nextMap[result.value.id] = sortSubtypes(result.value.subtypes);
            } else {
              failed = true;
            }
          });
          setSubtypesByType(nextMap);
          if (failed) {
            setSubtypeMessage('No se pudieron cargar algunas listas de subtipos.');
          }
          setLoadingSubtypes(false);
        } else {
          setHouseTypes([]);
          setSelectedTypeId(null);
          setSelectedModuleNumber(null);
          setDraft(emptyDraft());
          setSubtypesByType({});
          messageParts.push('No se pudieron cargar los tipos de casa.');
        }

        if (panelResult.status === 'fulfilled') {
          setPanels(panelResult.value);
        } else {
          setPanels([]);
          messageParts.push('No se pudieron cargar las definiciones de panel.');
        }

        if (taskResult.status === 'fulfilled') {
          setTaskDefinitions(taskResult.value);
        } else {
          setTaskDefinitions([]);
          messageParts.push('No se pudieron cargar las definiciones de tareas.');
        }

        if (applicabilityResult.status === 'fulfilled') {
          setApplicabilityRows(applicabilityResult.value);
        } else {
          setApplicabilityRows([]);
          messageParts.push('No se pudieron cargar las reglas de aplicabilidad de tareas.');
        }

        if (durationResult.status === 'fulfilled') {
          setDurationRows(durationResult.value);
        } else {
          setDurationRows([]);
          messageParts.push('No se pudieron cargar las reglas de duracion de tareas.');
        }

        if (stationResult.status === 'fulfilled') {
          setStations(stationResult.value);
        } else {
          setStations([]);
          messageParts.push('No se pudieron cargar las estaciones.');
        }

        if (messageParts.length > 0) {
          setStatusMessage(messageParts.join(' '));
        }
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error
              ? error.message
              : 'No se pudo cargar la configuracion de casas.';
          setStatusMessage(message);
        }
      } finally {
        if (active) {
          setLoading(false);
          setLoadingSubtypes(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const panelTasks = useMemo(() => {
    const panelScoped = taskDefinitions
      .filter((task) => task.scope === 'panel' && task.active)
      .map((task) => ({
        id: task.id,
        name: task.name,
        station_sequence_order: task.default_station_sequence ?? null,
      }))
      .sort((a, b) => {
        const aSeq = a.station_sequence_order ?? Number.POSITIVE_INFINITY;
        const bSeq = b.station_sequence_order ?? Number.POSITIVE_INFINITY;
        if (aSeq !== bSeq) {
          return aSeq - bSeq;
        }
        return a.name.localeCompare(b.name);
      });
    return panelScoped;
  }, [taskDefinitions]);

  const moduleTasks = useMemo(() => {
    const moduleScoped = taskDefinitions
      .filter((task) => task.scope === 'module' && task.active)
      .map((task) => ({
        id: task.id,
        name: task.name,
        station_sequence_order: task.default_station_sequence ?? null,
      }));
    return sortTasks(moduleScoped);
  }, [taskDefinitions]);

  const selectedType = useMemo(
    () => houseTypes.find((type) => type.id === selectedTypeId) ?? null,
    [selectedTypeId, houseTypes]
  );

  const availableModules = useMemo(() => {
    if (!selectedType) {
      return [];
    }
    return Array.from({ length: selectedType.number_of_modules }, (_, index) => index + 1);
  }, [selectedType]);

  useEffect(() => {
    if (!selectedType) {
      setSelectedModuleNumber(null);
      return;
    }
    setSelectedModuleNumber((prev) => {
      if (!prev || prev > selectedType.number_of_modules) {
        return 1;
      }
      return prev;
    });
  }, [selectedType]);

  const filteredHouseTypes = useMemo(() => {
    const query = normalizeSearch(search.trim());
    if (!query) {
      return houseTypes;
    }
    return houseTypes.filter((houseType) =>
      normalizeSearch(`${houseType.name} ${houseType.number_of_modules}`).includes(query)
    );
  }, [houseTypes, search]);

  const selectedSubtypes = useMemo(() => {
    if (!selectedTypeId) {
      return [];
    }
    return subtypesByType[selectedTypeId] ?? [];
  }, [selectedTypeId, subtypesByType]);

  const subtypeNameById = useMemo(() => {
    const map = new Map<number, string>();
    selectedSubtypes.forEach((subtype) => {
      map.set(subtype.id, subtype.name);
    });
    return map;
  }, [selectedSubtypes]);

  const filteredPanels = useMemo(() => {
    if (!selectedTypeId || !selectedModuleNumber) {
      return [];
    }
    return panels.filter(
      (panel) =>
        panel.house_type_id === selectedTypeId &&
        panel.module_sequence_number === selectedModuleNumber
    );
  }, [panels, selectedTypeId, selectedModuleNumber]);

  const groupedPanels = useMemo(() => {
    const groups = PANEL_GROUPS.map((name) => ({ name, items: [] as PanelDefinition[] }));
    const groupIndex = new Map<string, number>();
    PANEL_GROUPS.forEach((name, index) => {
      groupIndex.set(normalizeGroup(name), index);
    });
    const fallbackIndex = groupIndex.get(normalizeGroup('Otros'));

    filteredPanels.forEach((panel) => {
      const index = groupIndex.get(normalizeGroup(panel.group)) ?? fallbackIndex;
      if (index === undefined) {
        groups.push({ name: panel.group, items: [panel] });
        return;
      }
      groups[index].items.push(panel);
    });

    return groups.map((group) => ({
      ...group,
      items: sortPanels(group.items),
    }));
  }, [filteredPanels]);

  const taskIds = useMemo(() => panelTasks.map((task) => task.id), [panelTasks]);

  const applicabilityByTask = useMemo(
    () => groupRowsByTask(applicabilityRows),
    [applicabilityRows]
  );

  const durationByTask = useMemo(() => groupRowsByTask(durationRows), [durationRows]);

  const stationInfoBySequence = useMemo(() => {
    const map = new Map<number, { names: string[]; lineTypes: string[] }>();
    stations
      .filter((station) => station.role === 'Assembly')
      .forEach((station) => {
        if (station.sequence_order === null) {
          return;
        }
        const entry = map.get(station.sequence_order) ?? { names: [], lineTypes: [] };
        entry.names.push(station.name);
        if (station.line_type) {
          entry.lineTypes.push(station.line_type);
        }
        map.set(station.sequence_order, entry);
      });
    return map;
  }, [stations]);

  const moduleStationOptions = useMemo(() => {
    const entries = new Map<number, { names: Set<string>; lineTypes: Set<string> }>();
    stations.forEach((station) => {
      if (station.sequence_order === null) {
        return;
      }
      if (station.role !== 'Assembly') {
        return;
      }
      const entry =
        entries.get(station.sequence_order) ?? { names: new Set(), lineTypes: new Set() };
      entry.names.add(station.name);
      if (station.line_type) {
        entry.lineTypes.add(station.line_type);
      }
      entries.set(station.sequence_order, entry);
    });
    moduleTasks.forEach((task) => {
      if (task.station_sequence_order === null) {
        return;
      }
      if (!entries.has(task.station_sequence_order)) {
        entries.set(task.station_sequence_order, { names: new Set(), lineTypes: new Set() });
      }
    });
    return Array.from(entries.entries())
      .map(([sequence, info]) => {
        const names = Array.from(info.names);
        const lineTypes = Array.from(info.lineTypes);
        const title = names.length > 0 ? names.join(' / ') : `Sec ${sequence}`;
        const metaParts: string[] = [];
        if (lineTypes.length > 0) {
          metaParts.push(`Linea ${lineTypes.join('/')}`);
        }
        if (names.length > 0) {
          metaParts.unshift(`Sec ${sequence}`);
        }
        return {
          sequence,
          label:
            metaParts.length > 0 ? `${title} (${metaParts.join(' / ')})` : title,
        };
      })
      .sort((a, b) => a.sequence - b.sequence);
  }, [moduleTasks, stations]);

  const moduleTaskSequenceById = useMemo(() => {
    const map = new Map<number, number | null>();
    moduleTasks.forEach((task) => {
      const state = moduleDraftByTask[task.id];
      map.set(task.id, state ? state.stationSequence : task.station_sequence_order);
    });
    return map;
  }, [moduleDraftByTask, moduleTasks]);

  const stationGroups = useMemo(() => {
    const groups = new Map<string, StationGroup>();
    const buildGroupInfo = (sequence: number | null) => {
      if (sequence === null) {
        return {
          title: 'Otras tareas',
          subtitle: 'Trabajo sin programar o auxiliar',
        };
      }
      const info = stationInfoBySequence.get(sequence);
      const names = info ? Array.from(new Set(info.names)) : [];
      const lineTypes = info ? Array.from(new Set(info.lineTypes)) : [];
      const title = names.length > 0 ? names.join(' / ') : `Secuencia ${sequence}`;
      const subtitleParts = [`Sec ${sequence}`];
      if (lineTypes.length > 0) {
        subtitleParts.push(`Linea ${lineTypes.join('/')}`);
      }
      return {
        title,
        subtitle: subtitleParts.join(' / '),
      };
    };

    moduleTasks.forEach((task) => {
      const sequence = moduleTaskSequenceById.get(task.id) ?? task.station_sequence_order;
      const key = sequence === null ? 'unscheduled' : `seq-${sequence}`;
      const existing = groups.get(key);
      if (existing) {
        existing.tasks.push(task);
        return;
      }
      const info = buildGroupInfo(sequence);
      groups.set(key, {
        key,
        sequence,
        title: info.title,
        subtitle: info.subtitle,
        tasks: [task],
      });
    });

    return Array.from(groups.values()).sort((a, b) => {
      const aSeq = a.sequence ?? Number.POSITIVE_INFINITY;
      const bSeq = b.sequence ?? Number.POSITIVE_INFINITY;
      if (aSeq !== bSeq) {
        return aSeq - bSeq;
      }
      return a.title.localeCompare(b.title);
    });
  }, [moduleTaskSequenceById, moduleTasks, stationInfoBySequence]);

  useEffect(() => {
    if (!selectedTypeId || !selectedModuleNumber) {
      setModuleDraftByTask({});
      setModuleBaselineByTask({});
      return;
    }

    const nextDraft: Record<number, TaskRuleState> = {};
    const nextBaseline: Record<number, TaskRuleBaseline> = {};

    moduleTasks.forEach((task) => {
      const taskApplicabilityRows = applicabilityByTask.get(task.id) ?? [];
      const moduleRow = pickRow(
        taskApplicabilityRows,
        (row) =>
          row.house_type_id === selectedTypeId &&
          row.module_number === selectedModuleNumber &&
          row.sub_type_id === null &&
          row.panel_definition_id === null
      );
      const houseRow = pickRow(
        taskApplicabilityRows,
        (row) =>
          row.house_type_id === selectedTypeId &&
          row.module_number === null &&
          row.sub_type_id === null &&
          row.panel_definition_id === null
      );
      const resolvedApplicability = moduleRow ?? houseRow ?? null;
      const applies = resolvedApplicability ? resolvedApplicability.applies : true;
      const resolvedStationSequence = moduleRow
        ? moduleRow.station_sequence_order
        : houseRow
        ? houseRow.station_sequence_order
        : task.station_sequence_order;

      const taskDurationRows = durationByTask.get(task.id) ?? [];
      const moduleDuration = pickRow(
        taskDurationRows,
        (row) =>
          row.house_type_id === selectedTypeId &&
          row.module_number === selectedModuleNumber &&
          row.sub_type_id === null &&
          row.panel_definition_id === null
      );
      const houseDuration = pickRow(
        taskDurationRows,
        (row) =>
          row.house_type_id === selectedTypeId &&
          row.module_number === null &&
          row.sub_type_id === null &&
          row.panel_definition_id === null
      );
      const defaultDuration = pickRow(
        taskDurationRows,
        (row) =>
          row.house_type_id === null &&
          row.module_number === null &&
          row.sub_type_id === null &&
          row.panel_definition_id === null
      );
      const resolvedDuration = moduleDuration ?? houseDuration ?? defaultDuration ?? null;
      const expectedMinutes = resolvedDuration ? String(resolvedDuration.expected_minutes) : '';

      nextDraft[task.id] = {
        applies,
        expectedMinutes,
        stationSequence: resolvedStationSequence,
        applicabilityRowId: moduleRow?.id ?? null,
        durationRowId: moduleDuration?.id ?? null,
      };
      nextBaseline[task.id] = { applies, expectedMinutes, stationSequence: resolvedStationSequence };
    });

    setModuleDraftByTask(nextDraft);
    setModuleBaselineByTask(nextBaseline);
    setModuleSaveMessage(null);
  }, [
    applicabilityByTask,
    durationByTask,
    moduleTasks,
    selectedTypeId,
    selectedModuleNumber,
  ]);

  const moduleHasChanges = useMemo(() => {
    return moduleTasks.some((task) => {
      const draftState = moduleDraftByTask[task.id];
      const baseline = moduleBaselineByTask[task.id];
      if (!draftState || !baseline) {
        return false;
      }
      if (draftState.applies !== baseline.applies) {
        return true;
      }
      if (draftState.stationSequence !== baseline.stationSequence) {
        return true;
      }
      return !areDurationValuesEqual(draftState.expectedMinutes, baseline.expectedMinutes);
    });
  }, [moduleBaselineByTask, moduleDraftByTask, moduleTasks]);

  const loadSubtypesForType = async (houseTypeId: number) => {
    setLoadingSubtypes(true);
    setSubtypeMessage(null);
    try {
      const data = await apiRequest<HouseSubType[]>(`/api/house-types/${houseTypeId}/subtypes`);
      setSubtypesByType((prev) => ({ ...prev, [houseTypeId]: sortSubtypes(data) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron cargar los subtipos.';
      setSubtypeMessage(message);
    } finally {
      setLoadingSubtypes(false);
    }
  };

  const handleSelectType = (houseType: HouseType) => {
    setSelectedTypeId(houseType.id);
    setDraft(buildDraftFromHouseType(houseType));
    setSelectedModuleNumber((prev) => {
      if (prev && prev <= houseType.number_of_modules) {
        return prev;
      }
      return 1;
    });
    if (activeTab === 'house-types') {
      setActiveTab('panels');
    }
    setPanelDraft(null);
    setPanelModalOpen(false);
    setMatrixOpen(false);
    setSequenceOpen(false);
    setPanelMessage(null);
    setMatrixMessage(null);
    setSequenceMessage(null);
    setTypeStatusMessage(null);
    setSubtypeMessage(null);
    setSubtypeDrafts({});
    setNewSubtypeName('');
    if (!subtypesByType[houseType.id]) {
      void loadSubtypesForType(houseType.id);
    }
  };

  const handleAddHouseType = () => {
    setSelectedTypeId(null);
    setSelectedModuleNumber(null);
    setDraft(emptyDraft());
    setActiveTab('house-types');
    setPanelDraft(null);
    setPanelModalOpen(false);
    setMatrixOpen(false);
    setSequenceOpen(false);
    setPanelMessage(null);
    setMatrixMessage(null);
    setSequenceMessage(null);
    setTypeStatusMessage(null);
    setSubtypeMessage(null);
    setSubtypeDrafts({});
    setNewSubtypeName('');
  };

  const handleDraftChange = (patch: Partial<HouseTypeDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const buildHousePayload = (current: HouseTypeDraft) => {
    const name = current.name.trim();
    if (!name) {
      throw new Error('Se requiere el nombre del tipo de casa.');
    }
    const modulesValue = current.number_of_modules.trim();
    const modules = Number(modulesValue);
    if (!modulesValue) {
      throw new Error('Se requiere el numero de modulos.');
    }
    if (!Number.isInteger(modules) || modules <= 0) {
      throw new Error('El numero de modulos debe ser un numero entero positivo.');
    }
    return { name, number_of_modules: modules };
  };

  const handleSaveHouseType = async () => {
    setSavingType(true);
    setTypeStatusMessage(null);
    try {
      const payload = buildHousePayload(draft);
      let saved: HouseType;
      if (draft.id) {
        saved = await apiRequest<HouseType>(`/api/house-types/${draft.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setHouseTypes((prev) =>
          sortHouseTypes(prev.map((item) => (item.id === saved.id ? saved : item)))
        );
      } else {
        saved = await apiRequest<HouseType>('/api/house-types', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setHouseTypes((prev) => sortHouseTypes([...prev, saved]));
        setSubtypesByType((prev) => ({ ...prev, [saved.id]: [] }));
      }
      setSelectedTypeId(saved.id);
      setSelectedModuleNumber((prev) => {
        if (!prev || prev > saved.number_of_modules) {
          return 1;
        }
        return prev;
      });
      setDraft(buildDraftFromHouseType(saved));
      setTypeStatusMessage('Tipo de casa guardado.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar el tipo de casa.';
      setTypeStatusMessage(message);
    } finally {
      setSavingType(false);
    }
  };

  const handleDeleteHouseType = async () => {
    if (!draft.id) {
      return;
    }
    if (!window.confirm('Eliminar este tipo de casa?')) {
      return;
    }
    setSavingType(true);
    setTypeStatusMessage(null);
    try {
      await apiRequest<void>(`/api/house-types/${draft.id}`, { method: 'DELETE' });
      const remaining = sortHouseTypes(houseTypes.filter((item) => item.id !== draft.id));
      setHouseTypes(remaining);
      setSubtypesByType((prev) => {
        const next = { ...prev };
        delete next[draft.id as number];
        return next;
      });
      if (remaining.length > 0) {
        handleSelectType(remaining[0]);
      } else {
        setSelectedTypeId(null);
        setSelectedModuleNumber(null);
        setDraft(emptyDraft());
      }
      setTypeStatusMessage('Tipo de casa eliminado.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo eliminar el tipo de casa.';
      const counts = parseCascadeWarning(message);
      if (counts) {
        const lines = counts
          .filter((entry) => entry.value > 0)
          .map(
            (entry) =>
              `${COUNT_LABELS[entry.key] ?? entry.key}: ${entry.value}`
          );
        const confirmMessage = [
          'Este tipo de casa tiene registros dependientes:',
          ...lines,
          'Eliminar de todos modos?',
        ].join('\n');
        if (!window.confirm(confirmMessage)) {
          setTypeStatusMessage('Eliminacion cancelada.');
          return;
        }
        try {
          await apiRequest<void>(`/api/house-types/${draft.id}?force=true`, {
            method: 'DELETE',
          });
          const remaining = sortHouseTypes(houseTypes.filter((item) => item.id !== draft.id));
          setHouseTypes(remaining);
          setSubtypesByType((prev) => {
            const next = { ...prev };
            delete next[draft.id as number];
            return next;
          });
          if (remaining.length > 0) {
            handleSelectType(remaining[0]);
          } else {
            setSelectedTypeId(null);
            setSelectedModuleNumber(null);
            setDraft(emptyDraft());
          }
          setTypeStatusMessage('Tipo de casa eliminado.');
          return;
        } catch (forceError) {
          const forceMessage =
            forceError instanceof Error
              ? forceError.message
              : 'No se pudo eliminar el tipo de casa.';
          setTypeStatusMessage(forceMessage);
          return;
        }
      }
      setTypeStatusMessage(message);
    } finally {
      setSavingType(false);
    }
  };

  const handleSubtypeDraftChange = (id: number, value: string) => {
    setSubtypeDrafts((prev) => ({ ...prev, [id]: value }));
  };

  const handleAddSubtype = async () => {
    if (!selectedTypeId) {
      return;
    }
    const name = newSubtypeName.trim();
    if (!name) {
      setSubtypeMessage('Se requiere el nombre del subtipo.');
      return;
    }
    setSavingSubtype(true);
    setSubtypeMessage(null);
    try {
      const created = await apiRequest<HouseSubType>(`/api/house-types/${selectedTypeId}/subtypes`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setSubtypesByType((prev) => ({
        ...prev,
        [selectedTypeId]: sortSubtypes([...(prev[selectedTypeId] ?? []), created]),
      }));
      setNewSubtypeName('');
      setSubtypeMessage('Subtipo agregado.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo agregar el subtipo.';
      setSubtypeMessage(message);
    } finally {
      setSavingSubtype(false);
    }
  };

  const handleSaveSubtype = async (subtype: HouseSubType) => {
    const draftName = (subtypeDrafts[subtype.id] ?? subtype.name).trim();
    if (!draftName) {
      setSubtypeMessage('Se requiere el nombre del subtipo.');
      return;
    }
    if (draftName === subtype.name) {
      return;
    }
    setSavingSubtype(true);
    setSubtypeMessage(null);
    try {
      const updated = await apiRequest<HouseSubType>(`/api/house-types/subtypes/${subtype.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: draftName }),
      });
      setSubtypesByType((prev) => ({
        ...prev,
        [updated.house_type_id]: sortSubtypes(
          (prev[updated.house_type_id] ?? []).map((item) => (item.id === updated.id ? updated : item))
        ),
      }));
      setSubtypeDrafts((prev) => {
        const next = { ...prev };
        delete next[subtype.id];
        return next;
      });
      setSubtypeMessage('Subtipo actualizado.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar el subtipo.';
      setSubtypeMessage(message);
    } finally {
      setSavingSubtype(false);
    }
  };

  const handleDeleteSubtype = async (subtype: HouseSubType) => {
    if (!window.confirm('Eliminar este subtipo?')) {
      return;
    }
    setSavingSubtype(true);
    setSubtypeMessage(null);
    try {
      await apiRequest<void>(`/api/house-types/subtypes/${subtype.id}`, { method: 'DELETE' });
      setSubtypesByType((prev) => ({
        ...prev,
        [subtype.house_type_id]: (prev[subtype.house_type_id] ?? []).filter(
          (item) => item.id !== subtype.id
        ),
      }));
      setSubtypeDrafts((prev) => {
        const next = { ...prev };
        delete next[subtype.id];
        return next;
      });
      setSubtypeMessage('Subtipo eliminado.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar el subtipo.';
      setSubtypeMessage(message);
    } finally {
      setSavingSubtype(false);
    }
  };

  const openPanelModal = (panel: PanelDefinition | null) => {
    setPanelDraft(buildPanelDraft(panel, panelTasks));
    setPanelMessage(null);
    setPanelModalOpen(true);
  };

  const handleAddPanel = () => {
    if (!selectedTypeId || !selectedModuleNumber) {
      return;
    }
    openPanelModal(null);
  };

  const handleEditPanel = (panel: PanelDefinition) => {
    openPanelModal(panel);
  };

  const handleClosePanelModal = () => {
    setPanelModalOpen(false);
    setPanelDraft(null);
    setPanelMessage(null);
  };

  const handleDeletePanel = async (panel: PanelDefinition) => {
    if (!window.confirm(`Eliminar panel ${panel.panel_code}? Esto no se puede deshacer.`)) {
      return;
    }
    try {
      await apiRequest<void>(`/api/panel-definitions/${panel.id}`, { method: 'DELETE' });
      setPanels((prev) => prev.filter((item) => item.id !== panel.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar el panel.';
      setStatusMessage(message);
    }
  };

  const buildTaskPayload = (applicableSet: Set<number>, durations: Record<number, string>) => {
    if (taskIds.length === 0) {
      return { applicable_task_ids: null, task_durations_json: null };
    }
    const applicableList = taskIds.filter((taskId) => applicableSet.has(taskId));
    const isAllApplied = applicableList.length === taskIds.length;
    const applicablePayload = isAllApplied ? null : applicableList;

    const durationList = applicableList.map((taskId) => {
      const parsed = parseOptionalNumber(durations[taskId] ?? '');
      if (parsed === 'invalid') {
        return 'invalid';
      }
      return parsed;
    });

    if (durationList.some((value) => value === 'invalid')) {
      return { error: 'Los minutos esperados deben ser un numero no negativo.' } as const;
    }

    const normalizedDurations = durationList as Array<number | null>;
    const durationsPayload =
      normalizedDurations.length === 0 || normalizedDurations.every((value) => value === null)
        ? null
        : normalizedDurations;

    return {
      applicable_task_ids: applicablePayload,
      task_durations_json: durationsPayload,
    } as const;
  };

  const handleSavePanel = async () => {
    if (!panelDraft || !selectedTypeId || !selectedModuleNumber) {
      return;
    }
    setPanelSaving(true);
    setPanelMessage(null);

    const panelCode = panelDraft.panel_code.trim();
    if (!panelCode) {
      setPanelMessage('Se requiere el codigo de panel.');
      setPanelSaving(false);
      return;
    }

    const areaValue = parseOptionalNumber(panelDraft.panel_area);
    if (areaValue === 'invalid') {
      setPanelMessage('El area debe ser un numero no negativo.');
      setPanelSaving(false);
      return;
    }

    const lengthValue = parseOptionalNumber(panelDraft.panel_length_m);
    if (lengthValue === 'invalid') {
      setPanelMessage('La longitud debe ser un numero no negativo.');
      setPanelSaving(false);
      return;
    }

	    const taskPayload = buildTaskPayload(panelDraft.applicable_task_ids, panelDraft.task_durations);
	    if ('error' in taskPayload) {
	      setPanelMessage(taskPayload.error ?? 'Error al validar tareas del panel.');
	      setPanelSaving(false);
	      return;
	    }

    const payload = {
      house_type_id: selectedTypeId,
      module_sequence_number: selectedModuleNumber,
      sub_type_id: panelDraft.sub_type_id,
      group: panelDraft.group,
      panel_code: panelCode,
      panel_area: areaValue,
      panel_length_m: lengthValue,
      applicable_task_ids: taskPayload.applicable_task_ids,
      task_durations_json: taskPayload.task_durations_json,
    };

    try {
      const saved = panelDraft.id
        ? await apiRequest<PanelDefinition>(`/api/panel-definitions/${panelDraft.id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await apiRequest<PanelDefinition>('/api/panel-definitions', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      setPanels((prev) => {
        const exists = prev.some((panel) => panel.id === saved.id);
        if (exists) {
          return prev.map((panel) => (panel.id === saved.id ? saved : panel));
        }
        return [...prev, saved];
      });
      handleClosePanelModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar el panel.';
      setPanelMessage(message);
    } finally {
      setPanelSaving(false);
    }
  };

  const handleOpenMatrix = () => {
    const nextDraft: Record<number, MatrixPanelState> = {};
    filteredPanels.forEach((panel) => {
      nextDraft[panel.id] = {
        applicable_task_ids: buildApplicableTaskSet(panel, taskIds),
        task_durations: buildDurationsMap(panel, panelTasks),
      };
    });
    setMatrixDraft(nextDraft);
    setMatrixMessage(null);
    setMatrixOpen(true);
  };

  const handleCloseMatrix = () => {
    setMatrixOpen(false);
    setMatrixDraft({});
    setMatrixMessage(null);
  };

  const toggleMatrixApplicability = (panelId: number, taskId: number) => {
    setMatrixDraft((prev) => {
      const current = prev[panelId];
      if (!current) {
        return prev;
      }
      const nextSet = new Set(current.applicable_task_ids);
      if (nextSet.has(taskId)) {
        nextSet.delete(taskId);
      } else {
        nextSet.add(taskId);
      }
      return {
        ...prev,
        [panelId]: {
          ...current,
          applicable_task_ids: nextSet,
        },
      };
    });
  };

  const updateMatrixDuration = (panelId: number, taskId: number, value: string) => {
    setMatrixDraft((prev) => {
      const current = prev[panelId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [panelId]: {
          ...current,
          task_durations: {
            ...current.task_durations,
            [taskId]: value,
          },
        },
      };
    });
  };

  const handleSaveMatrix = async () => {
    if (!selectedTypeId || !selectedModuleNumber) {
      return;
    }
    setMatrixSaving(true);
    setMatrixMessage(null);

    try {
      const updates = await Promise.all(
        filteredPanels.map(async (panel) => {
          const state = matrixDraft[panel.id];
          if (!state) {
            return panel;
          }
          const payload = buildTaskPayload(state.applicable_task_ids, state.task_durations);
          if ('error' in payload) {
            throw new Error(payload.error);
          }

          const applicableChanged = !arraysEqual(
            panel.applicable_task_ids,
            payload.applicable_task_ids
          );
          const durationChanged = !arraysEqual(
            panel.task_durations_json ?? null,
            payload.task_durations_json
          );
          if (!applicableChanged && !durationChanged) {
            return panel;
          }

          return apiRequest<PanelDefinition>(`/api/panel-definitions/${panel.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              applicable_task_ids: payload.applicable_task_ids,
              task_durations_json: payload.task_durations_json,
            }),
          });
        })
      );

      setPanels((prev) =>
        prev.map((panel) => updates.find((updated) => updated.id === panel.id) ?? panel)
      );
      handleCloseMatrix();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar la matriz.';
      setMatrixMessage(message);
    } finally {
      setMatrixSaving(false);
    }
  };

  const handleOpenSequence = () => {
    const sorted = [...filteredPanels].sort((a, b) => {
      if (a.panel_sequence_number != null && b.panel_sequence_number != null) {
        return a.panel_sequence_number - b.panel_sequence_number;
      }
      if (a.panel_sequence_number != null) return -1;
      if (b.panel_sequence_number != null) return 1;
      return a.panel_code.localeCompare(b.panel_code);
    });
    setSequenceDraft(sorted);
    setSequenceMessage(null);
    setSequenceOpen(true);
  };

  const handleCloseSequence = () => {
    setSequenceOpen(false);
    setSequenceDraft([]);
    setSequenceMessage(null);
  };

  const handleMovePanel = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === sequenceDraft.length - 1) return;

    setSequenceDraft((prev) => {
      const next = [...prev];
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      const [moved] = next.splice(index, 1);
      next.splice(newIndex, 0, moved);
      return next;
    });
  };

  const handleSaveSequence = async () => {
    if (!selectedTypeId || !selectedModuleNumber) return;
    setSequenceSaving(true);
    setSequenceMessage(null);

    const updates = new Map<number, number>();
    sequenceDraft.forEach((panel, index) => {
      updates.set(panel.id, index + 1);
    });

    try {
      const updatedPanels = await Promise.all(
        sequenceDraft.map(async (panel) => {
          const nextOrder = updates.get(panel.id) ?? null;
          if (panel.panel_sequence_number === nextOrder) {
            return panel;
          }
          return apiRequest<PanelDefinition>(`/api/panel-definitions/${panel.id}`, {
            method: 'PUT',
            body: JSON.stringify({ panel_sequence_number: nextOrder }),
          });
        })
      );

      setPanels((prev) =>
        prev.map((panel) => updatedPanels.find((updated) => updated.id === panel.id) ?? panel)
      );
      handleCloseSequence();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar la secuencia de paneles.';
      setSequenceMessage(message);
    } finally {
      setSequenceSaving(false);
    }
  };

  const handleSelectModule = (moduleNumber: number) => {
    setSelectedModuleNumber(moduleNumber);
    setPanelDraft(null);
    setPanelModalOpen(false);
    setMatrixOpen(false);
    setSequenceOpen(false);
    setPanelMessage(null);
    setMatrixMessage(null);
    setSequenceMessage(null);
  };

  const refreshModuleRules = async () => {
    const [applicabilityData, durationData] = await Promise.all([
      apiRequest<TaskApplicability[]>('/api/task-rules/applicability'),
      apiRequest<TaskExpectedDuration[]>('/api/task-rules/durations'),
    ]);
    setApplicabilityRows(applicabilityData);
    setDurationRows(durationData);
  };

  const handleResetModuleRules = () => {
    setModuleDraftByTask((prev) => {
      const next = { ...prev };
      moduleTasks.forEach((task) => {
        const baseline = moduleBaselineByTask[task.id];
        if (!baseline) {
          return;
        }
        const current = next[task.id];
        if (!current) {
          next[task.id] = {
            applies: baseline.applies,
            expectedMinutes: baseline.expectedMinutes,
            stationSequence: baseline.stationSequence,
            applicabilityRowId: null,
            durationRowId: null,
          };
          return;
        }
        next[task.id] = {
          ...current,
          applies: baseline.applies,
          expectedMinutes: baseline.expectedMinutes,
          stationSequence: baseline.stationSequence,
        };
      });
      return next;
    });
    setModuleSaveMessage(null);
  };

  const toggleModuleApplies = (taskId: number) => {
    setModuleDraftByTask((prev) => {
      const current = prev[taskId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [taskId]: {
          ...current,
          applies: !current.applies,
        },
      };
    });
    setModuleSaveMessage(null);
  };

  const updateModuleExpectedMinutes = (taskId: number, value: string) => {
    setModuleDraftByTask((prev) => {
      const current = prev[taskId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [taskId]: {
          ...current,
          expectedMinutes: value,
        },
      };
    });
    setModuleSaveMessage(null);
  };

  const updateModuleStationSequence = (taskId: number, sequence: number | null) => {
    setModuleDraftByTask((prev) => {
      const current = prev[taskId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [taskId]: {
          ...current,
          stationSequence: sequence,
        },
      };
    });
    setModuleSaveMessage(null);
  };

  const handleSaveModuleRules = async () => {
    if (!selectedTypeId || !selectedModuleNumber) {
      return;
    }
    setModuleSaving(true);
    setModuleSaveMessage(null);
    setModuleSaveError(false);

    const moduleApplicability = new Map<number, TaskApplicability>();
    applicabilityRows.forEach((row) => {
      if (
        row.house_type_id === selectedTypeId &&
        row.module_number === selectedModuleNumber &&
        row.sub_type_id === null &&
        row.panel_definition_id === null
      ) {
        moduleApplicability.set(row.task_definition_id, row);
      }
    });

    const moduleDurations = new Map<number, TaskExpectedDuration>();
    durationRows.forEach((row) => {
      if (
        row.house_type_id === selectedTypeId &&
        row.module_number === selectedModuleNumber &&
        row.sub_type_id === null &&
        row.panel_definition_id === null
      ) {
        moduleDurations.set(row.task_definition_id, row);
      }
    });

    const requests: Promise<unknown>[] = [];

    for (const task of moduleTasks) {
      const draftState = moduleDraftByTask[task.id];
      const baseline = moduleBaselineByTask[task.id];
      if (!draftState || !baseline) {
        continue;
      }

      const appliesChanged = draftState.applies !== baseline.applies;
      const stationChanged = draftState.stationSequence !== baseline.stationSequence;

      if (appliesChanged || stationChanged) {
        const existing = moduleApplicability.get(task.id);
        if (existing) {
          requests.push(
            apiRequest(`/api/task-rules/applicability/${existing.id}`, {
              method: 'PUT',
              body: JSON.stringify({
                applies: draftState.applies,
                station_sequence_order: draftState.stationSequence,
              }),
            })
          );
        } else {
          requests.push(
            apiRequest('/api/task-rules/applicability', {
              method: 'POST',
              body: JSON.stringify({
                task_definition_id: task.id,
                house_type_id: selectedTypeId,
                sub_type_id: null,
                module_number: selectedModuleNumber,
                panel_definition_id: null,
                applies: draftState.applies,
                station_sequence_order: draftState.stationSequence,
              }),
            })
          );
        }
      }

      const durationChanged = !areDurationValuesEqual(
        draftState.expectedMinutes,
        baseline.expectedMinutes
      );
      if (!durationChanged) {
        continue;
      }
      const parsed = parseOptionalNumber(draftState.expectedMinutes);
      if (parsed === 'invalid') {
        setModuleSaveMessage('Los minutos esperados deben ser un numero no negativo.');
        setModuleSaveError(true);
        setModuleSaving(false);
        return;
      }
      const existingDuration = moduleDurations.get(task.id);
      if (parsed === null) {
        if (existingDuration) {
          requests.push(
            apiRequest(`/api/task-rules/durations/${existingDuration.id}`, {
              method: 'DELETE',
            })
          );
        }
        continue;
      }
      if (existingDuration) {
        requests.push(
          apiRequest(`/api/task-rules/durations/${existingDuration.id}`, {
            method: 'PUT',
            body: JSON.stringify({ expected_minutes: parsed }),
          })
        );
      } else {
        requests.push(
          apiRequest('/api/task-rules/durations', {
            method: 'POST',
            body: JSON.stringify({
              task_definition_id: task.id,
              house_type_id: selectedTypeId,
              sub_type_id: null,
              module_number: selectedModuleNumber,
              panel_definition_id: null,
              expected_minutes: parsed,
            }),
          })
        );
      }
    }

    if (requests.length === 0) {
      setModuleSaveMessage('No hay cambios para guardar.');
      setModuleSaveError(false);
      setModuleSaving(false);
      return;
    }

    try {
      await Promise.all(requests);
      await refreshModuleRules();
      setModuleSaveMessage('Cambios guardados.');
      setModuleSaveError(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudieron guardar las reglas del modulo.';
      setModuleSaveMessage(message);
      setModuleSaveError(true);
    } finally {
      setModuleSaving(false);
    }
  };



  return (
    <div className="space-y-8">

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-full border border-black/10 bg-white p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('house-types')}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 transition ${
              activeTab === 'house-types'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--ink-muted)] hover:bg-black/5'
            }`}
          >
            <Home className="h-3.5 w-3.5" />
            Tipos de casa
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('panels')}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 transition ${
              activeTab === 'panels'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--ink-muted)] hover:bg-black/5'
            }`}
          >
            <Grid2X2 className="h-3.5 w-3.5" />
            Paneles
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('module-tasks')}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 transition ${
              activeTab === 'module-tasks'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--ink-muted)] hover:bg-black/5'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Tareas de modulo
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
          <span className="rounded-full border border-black/10 bg-white px-3 py-1">
            {selectedType ? selectedType.name : 'Elija un tipo de casa'}
          </span>
          {selectedType && (
            <span className="rounded-full border border-black/10 bg-white px-3 py-1">
              {selectedModuleNumber ? `Modulo ${selectedModuleNumber}` : 'Seleccione un modulo'}
            </span>
          )}
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {statusMessage}
        </div>
      )}

      {activeTab === 'house-types' && (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Paso 1
                </p>
                <h2 className="text-lg font-display text-[var(--ink)]">Tipos de casa y subtipos</h2>
                <p className="text-sm text-[var(--ink-muted)]">
                  {houseTypes.length} tipos de casa en la biblioteca
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
                  <input
                    type="search"
                    placeholder="Buscar tipos de casa"
                    className="h-9 rounded-full border border-black/10 bg-white pl-9 pr-4 text-sm"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <button
                  onClick={handleAddHouseType}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                >
                  <Plus className="h-4 w-4" /> Nuevo tipo de casa
                </button>
              </div>
            </div>

            {loading && (
              <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-center text-sm text-[var(--ink-muted)]">
                Cargando tipos de casa...
              </div>
            )}

            {!loading && filteredHouseTypes.length === 0 && (
              <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-center text-sm text-[var(--ink-muted)]">
                No hay tipos de casa que coincidan con esta busqueda.
              </div>
            )}

            <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="divide-y divide-gray-100">
                {filteredHouseTypes.map((type) => {
                  const subtypes = subtypesByType[type.id];
                  const preview = subtypes ? subtypes.slice(0, 3) : [];
                  const remainingCount = subtypes ? subtypes.length - preview.length : 0;
                  const isSelected = selectedTypeId === type.id;

                  return (
                    <button
                      key={type.id}
                      onClick={() => handleSelectType(type)}
                      className={`group flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? 'bg-blue-50/50'
                          : 'bg-white hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-medium truncate ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                            {type.name}
                          </p>
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                             {type.number_of_modules} mod
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                           {subtypes ? (
                            subtypes.length > 0 ? (
                              <>
                                {preview.map((subtype) => (
                                  <span
                                    key={subtype.id}
                                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] bg-gray-50 text-gray-500 border border-gray-100"
                                  >
                                    {subtype.name}
                                  </span>
                                ))}
                                {remainingCount > 0 && (
                                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] bg-gray-50 text-gray-400">
                                    +{remainingCount}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[10px] text-gray-400 italic">Sin subtipos</span>
                            )
                          ) : (
                             <span className="text-[10px] text-gray-400">
                              {loadingSubtypes ? 'Cargando...' : '...'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center shrink-0">
                         {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                    Detail
                  </p>
                  <h2 className="text-lg font-display text-[var(--ink)]">
                    {selectedType ? selectedType.name : 'Nuevo tipo de casa'}
                  </h2>
                </div>
                <Sparkles className="h-5 w-5 text-[var(--ink-muted)]" />
              </div>

              <div className="mt-4 space-y-4">
                <label className="text-sm text-[var(--ink-muted)]">
                  Nombre del tipo de casa
                  <input
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    value={draft.name}
                    onChange={(event) => handleDraftChange({ name: event.target.value })}
                  />
                </label>
                <label className="text-sm text-[var(--ink-muted)]">
                  Numero de modulos
                  <input
                    type="number"
                    min={1}
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    value={draft.number_of_modules}
                    onChange={(event) =>
                      handleDraftChange({ number_of_modules: event.target.value })
                    }
                  />
                </label>
                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-[var(--ink-muted)]">Subtipos</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input
                      className="min-w-[12rem] flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      placeholder="Nombre de subtipo"
                      value={newSubtypeName}
                      onChange={(event) => setNewSubtypeName(event.target.value)}
                      disabled={!selectedTypeId || savingSubtype}
                    />
                    <button
                      onClick={handleAddSubtype}
                      disabled={!selectedTypeId || savingSubtype}
                      className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-[var(--ink)] disabled:opacity-60"
                    >
                      <Plus className="h-3 w-3" /> Agregar subtipo
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {!selectedTypeId && (
                      <div className="rounded-2xl border border-dashed border-black/10 px-3 py-2 text-xs text-[var(--ink-muted)]">
                        Guarde el tipo de casa para administrar subtipos.
                      </div>
                    )}
                    {selectedTypeId && loadingSubtypes && selectedSubtypes.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-black/10 px-3 py-2 text-xs text-[var(--ink-muted)]">
                        Cargando subtipos...
                      </div>
                    )}
                    {selectedTypeId && !loadingSubtypes && selectedSubtypes.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-black/10 px-3 py-2 text-xs text-[var(--ink-muted)]">
                        No hay subtipos configurados.
                      </div>
                    )}
                    {selectedSubtypes.map((subtype) => {
                      const draftName = subtypeDrafts[subtype.id] ?? subtype.name;
                      const trimmed = draftName.trim();
                      const canSave = trimmed.length > 0 && trimmed !== subtype.name;
                      return (
                        <div
                          key={subtype.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-black/5 bg-white px-3 py-2"
                        >
                          <input
                            className="flex-1 rounded-lg border border-black/10 bg-white px-2 py-1 text-sm"
                            value={draftName}
                            onChange={(event) =>
                              handleSubtypeDraftChange(subtype.id, event.target.value)
                            }
                            disabled={savingSubtype}
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleSaveSubtype(subtype)}
                              disabled={!canSave || savingSubtype}
                              className="text-xs font-semibold text-[var(--accent)] disabled:opacity-60"
                            >
                              Guardar
                            </button>
                            <button
                              onClick={() => handleDeleteSubtype(subtype)}
                              disabled={savingSubtype}
                              className="text-xs text-[var(--ink-muted)] disabled:opacity-60"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {subtypeMessage && (
                    <p className="rounded-2xl border border-black/5 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                      {subtypeMessage}
                    </p>
                  )}
                </div>

                {typeStatusMessage && (
                  <p className="rounded-2xl border border-black/5 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                    {typeStatusMessage}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleSaveHouseType}
                    disabled={savingType}
                    className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {savingType ? 'Guardando...' : 'Guardar tipo de casa'}
                  </button>
                  <button
                    onClick={handleDeleteHouseType}
                    disabled={savingType || !draft.id}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink-muted)] disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" /> Eliminar
                  </button>
                </div>
              </div>
            </section>
          </aside>
        </div>
      )}

      {activeTab === 'panels' && (
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Paso 2
                </p>
              <h2 className="text-lg font-display text-[var(--ink)]">Paneles por modulo</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                Agregue definiciones de panel, agrupe y configure aplicabilidad a nivel de panel.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
                onClick={handleOpenSequence}
                disabled={filteredPanels.length === 0}
              >
                <ListOrdered className="h-4 w-4" /> Secuencia
              </button>
              <button
              className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
              onClick={handleOpenMatrix}
              disabled={filteredPanels.length === 0}
            >
              <Layers className="h-4 w-4" /> Matriz de tareas
            </button>
              <button
                className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleAddPanel}
                disabled={!selectedTypeId || !selectedModuleNumber}
              >
                <Plus className="h-4 w-4" /> Agregar panel
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <select
              className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm"
              value={selectedTypeId ?? ''}
              onChange={(event) => {
                const selected = houseTypes.find(
                  (type) => type.id === Number(event.target.value)
                );
                if (selected) {
                  handleSelectType(selected);
                }
              }}
              disabled={houseTypes.length === 0}
            >
              {!selectedTypeId && <option value="">Seleccionar tipo de casa</option>}
              {houseTypes.map((houseType) => (
                <option key={houseType.id} value={houseType.id}>
                  {houseType.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm"
              value={selectedModuleNumber ?? ''}
              onChange={(event) => handleSelectModule(Number(event.target.value))}
              disabled={!selectedTypeId}
            >
              {!selectedModuleNumber && <option value="">Seleccionar modulo</option>}
              {availableModules.map((moduleNumber) => (
                <option key={moduleNumber} value={moduleNumber}>
                  Modulo {moduleNumber}
                </option>
              ))}
            </select>
            {selectedType && selectedModuleNumber && (
              <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                <Layers className="h-4 w-4" />
                {selectedType.name} / Modulo {selectedModuleNumber}
              </div>
            )}
          </div>

          {loading && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              Cargando definiciones de panel...
            </div>
          )}

          {!loading && !selectedTypeId && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm italic text-[var(--ink-muted)]">
              Seleccione un tipo de casa arriba para comenzar a administrar definiciones de panel.
            </div>
          )}

          {!loading && selectedTypeId && filteredPanels.length === 0 && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              Aun no hay paneles definidos para este modulo.
            </div>
          )}

          {!loading && selectedTypeId && filteredPanels.length > 0 && (
            <div className="space-y-6">
              {groupedPanels.map((group) => (
                <section
                  key={group.name}
                  className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
                >
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                      {group.name}
                    </h3>
                    <span className="text-[10px] text-gray-400">
                      {group.items.length} paneles
                    </span>
                  </div>
                  
                  {group.items.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-gray-500 italic">
                      No hay paneles en este grupo.
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {group.items.map((panel) => {
                        const subtypeLabel = panel.sub_type_id ? subtypeNameById.get(panel.sub_type_id) : null;
                        const hasArea = panel.panel_area !== null && panel.panel_area !== undefined;
                        const hasLength = panel.panel_length_m !== null && panel.panel_length_m !== undefined;

                        return (
                          <div
                            key={panel.id}
                            className="group flex w-full items-center justify-between px-4 py-2.5 text-left bg-white hover:bg-gray-50 transition-colors"
                          >
                            <div className="flex-1 min-w-0 pr-4">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-900">
                                  {panel.panel_code}
                                </span>
                                {subtypeLabel && (
                                  <span className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                                    {subtypeLabel}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
                                 {hasArea && <span>{panel.panel_area} m2</span>}
                                 {hasLength && <span>{panel.panel_length_m} m</span>}
                                 {!hasArea && !hasLength && (
                                   <span className="italic text-gray-400">Sin geometria</span>
                                 )}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              {panel.panel_sequence_number !== null && panel.panel_sequence_number !== undefined && (
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-100">
                                  #{panel.panel_sequence_number}
                                </span>
                              )}
                              <button
                                className="p-1.5 text-gray-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors"
                                onClick={() => handleEditPanel(panel)}
                                title="Editar panel"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors"
                                onClick={() => handleDeletePanel(panel)}
                                title="Eliminar panel"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'module-tasks' && (
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Paso 3
                </p>
              <h2 className="text-lg font-display text-[var(--ink)]">Reglas de tareas de modulo</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                Confirme que tareas de modulo aplican y establezca minutos esperados para el modulo seleccionado.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
                onClick={handleResetModuleRules}
                disabled={!moduleHasChanges || moduleSaving}
              >
                <RefreshCcw className="h-4 w-4" /> Restablecer
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleSaveModuleRules}
                disabled={
                  !moduleHasChanges || moduleSaving || !selectedTypeId || !selectedModuleNumber
                }
              >
                <Save className="h-4 w-4" />
                {moduleSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <select
              className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm"
              value={selectedTypeId ?? ''}
              onChange={(event) => {
                const selected = houseTypes.find(
                  (type) => type.id === Number(event.target.value)
                );
                if (selected) {
                  handleSelectType(selected);
                }
              }}
              disabled={houseTypes.length === 0}
            >
              {!selectedTypeId && <option value="">Seleccionar tipo de casa</option>}
              {houseTypes.map((houseType) => (
                <option key={houseType.id} value={houseType.id}>
                  {houseType.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm"
              value={selectedModuleNumber ?? ''}
              onChange={(event) => handleSelectModule(Number(event.target.value))}
              disabled={!selectedTypeId}
            >
              {!selectedModuleNumber && <option value="">Seleccionar modulo</option>}
              {availableModules.map((moduleNumber) => (
                <option key={moduleNumber} value={moduleNumber}>
                  Modulo {moduleNumber}
                </option>
              ))}
            </select>
            {selectedType && selectedModuleNumber && (
              <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                <Layers className="h-4 w-4" />
                {selectedType.name} / Modulo {selectedModuleNumber}
              </div>
            )}
          </div>

          {moduleSaveMessage && (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                moduleSaveError
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}
            >
              {moduleSaveMessage}
            </div>
          )}

          {loading && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              Cargando reglas de tareas de modulo...
            </div>
          )}

          {!loading && !selectedTypeId && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm italic text-[var(--ink-muted)]">
              Seleccione un tipo de casa arriba para comenzar a administrar reglas de tareas de modulo.
            </div>
          )}

          {!loading && selectedTypeId && moduleTasks.length === 0 && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              Aun no hay tareas de modulo activas definidas.
            </div>
          )}

          {!loading && selectedTypeId && moduleTasks.length > 0 && (
            <div className="space-y-6">
              {stationGroups.map((group) => (
                <section
                  key={group.key}
                  className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                        Grupo de estacion
                      </p>
                      <h3 className="text-lg font-display text-[var(--ink)]">{group.title}</h3>
                      <p className="text-xs text-[var(--ink-muted)]">{group.subtitle}</p>
                    </div>
                    <span className="text-xs text-[var(--ink-muted)]">
                      {group.tasks.length} tareas
                    </span>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                  <table className="w-full table-fixed text-sm">
                    <thead className="bg-[rgba(201,215,245,0.3)] text-xs text-[var(--ink-muted)]">
                      <tr>
                        <th className="w-[38%] px-4 py-3 text-left">Tarea</th>
                        <th className="w-[26%] px-4 py-3 text-left">Estacion</th>
                        <th className="w-[18%] px-4 py-3 text-left">Aplica</th>
                        <th className="w-[18%] px-4 py-3 text-left">Minutos esperados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.tasks.map((task) => {
                        const state = moduleDraftByTask[task.id];
                        if (!state) {
                          return null;
                        }
                        const defaultSequence = task.station_sequence_order;
                        const usesDefaultStation = state.stationSequence === defaultSequence;
                        return (
                          <tr key={task.id} className="border-t border-black/5">
                            <td className="w-[38%] px-4 py-3 font-medium text-[var(--ink)]">
                              {task.name}
                            </td>
                            <td className="w-[26%] px-4 py-3">
                              <div className="flex flex-col gap-1">
                                <select
                                  className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm"
                                  value={
                                    state.stationSequence !== null
                                      ? String(state.stationSequence)
                                      : ''
                                  }
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    updateModuleStationSequence(
                                      task.id,
                                      value ? Number(value) : null
                                    );
                                  }}
                                >
                                  <option value="">Sin asignar</option>
                                  {moduleStationOptions.map((option) => (
                                    <option key={option.sequence} value={option.sequence}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <span
                                  className={`text-[10px] ${
                                    usesDefaultStation
                                      ? 'text-[var(--ink-muted)]'
                                      : 'text-amber-600'
                                  }`}
                                >
                                  {usesDefaultStation
                                    ? 'Estacion por defecto'
                                    : 'Reemplazo para esta seleccion'}
                                </span>
                              </div>
                            </td>
                            <td className="w-[18%] px-4 py-3">
                              <button
                                type="button"
                                onClick={() => toggleModuleApplies(task.id)}
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                  state.applies
                                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                                      : 'border-black/10 bg-white text-[var(--ink-muted)]'
                                  }`}
                                >
                                  <span
                                    className={`flex h-5 w-5 items-center justify-center rounded-full ${
                                      state.applies
                                        ? 'bg-blue-500 text-white'
                                        : 'bg-slate-200 text-slate-400'
                                    }`}
                                  >
                                    {state.applies ? (
                                      <Check className="h-3 w-3" strokeWidth={3} />
                                    ) : (
                                      <Plus className="h-3 w-3" strokeWidth={3} />
                                    )}
                                  </span>
                                  {state.applies ? 'Aplica' : 'No aplica'}
                              </button>
                            </td>
                            <td className="w-[18%] px-4 py-3">
                              {state.applies ? (
                                <div className="flex items-center gap-2">
                                  <input
                                      className="w-24 rounded-lg border border-black/10 bg-white px-2 py-1 text-right text-sm"
                                      value={state.expectedMinutes}
                                      onChange={(event) =>
                                        updateModuleExpectedMinutes(task.id, event.target.value)
                                      }
                                      placeholder="0"
                                    />
                                    <span className="text-xs text-[var(--ink-muted)]">min</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-[var(--ink-muted)]">N/A</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
      )}

      {panelModalOpen && panelDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-4xl rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Panel</p>
                <h3 className="text-lg font-display text-[var(--ink)]">
                  {panelDraft.id ? `Editar ${panelDraft.panel_code}` : 'Agregar panel'}
                </h3>
                {selectedType && (
                  <p className="text-xs text-[var(--ink-muted)]">
                    {selectedType.name} | Modulo {selectedModuleNumber}
                  </p>
                )}
              </div>
              <button onClick={handleClosePanelModal}>
                <X className="h-5 w-5 text-[var(--ink-muted)]" />
              </button>
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <label className="text-sm text-[var(--ink-muted)]">
                  Grupo
                  <select
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    value={panelDraft.group}
                    onChange={(event) =>
                      setPanelDraft((prev) =>
                        prev ? { ...prev, group: event.target.value } : prev
                      )
                    }
                  >
                    {PANEL_GROUPS.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-[var(--ink-muted)]">
                  Codigo de panel
                  <input
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    value={panelDraft.panel_code}
                    onChange={(event) =>
                      setPanelDraft((prev) =>
                        prev ? { ...prev, panel_code: event.target.value } : prev
                      )
                    }
                  />
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-[var(--ink-muted)]">
                    Area (m2)
                    <input
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={panelDraft.panel_area}
                      onChange={(event) =>
                        setPanelDraft((prev) =>
                          prev ? { ...prev, panel_area: event.target.value } : prev
                        )
                      }
                    />
                  </label>
                  <label className="text-sm text-[var(--ink-muted)]">
                    Longitud (m)
                    <input
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={panelDraft.panel_length_m}
                      onChange={(event) =>
                        setPanelDraft((prev) =>
                          prev ? { ...prev, panel_length_m: event.target.value } : prev
                        )
                      }
                    />
                  </label>
                </div>
                <label className="text-sm text-[var(--ink-muted)]">
                  Subtipo
                  <select
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    value={panelDraft.sub_type_id ?? ''}
                    onChange={(event) =>
                      setPanelDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              sub_type_id: event.target.value
                                ? Number(event.target.value)
                                : null,
                            }
                          : prev
                      )
                    }
                  >
                    <option value="">General (sin subtipo)</option>
                    {selectedSubtypes.map((subtype) => (
                      <option key={subtype.id} value={subtype.id}>
                        {subtype.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                      Aplicabilidad
                    </p>
                    <h4 className="text-sm font-semibold text-[var(--ink)]">
                      Tareas de panel ({panelTasks.length})
                    </h4>
                  </div>
                  <Layers className="h-4 w-4 text-[var(--ink-muted)]" />
                </div>
                {panelTasks.length === 0 && (
                  <p className="mt-3 text-sm text-[var(--ink-muted)]">
                    Aun no hay tareas de panel definidas.
                  </p>
                )}
                {panelTasks.length > 0 && (
                  <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-2 text-sm">
                    {panelTasks.map((task) => (
                      <label key={task.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={panelDraft.applicable_task_ids.has(task.id)}
                          onChange={() =>
                            setPanelDraft((prev) => {
                              if (!prev) {
                                return prev;
                              }
                              const nextSet = new Set(prev.applicable_task_ids);
                              if (nextSet.has(task.id)) {
                                nextSet.delete(task.id);
                              } else {
                                nextSet.add(task.id);
                              }
                              return { ...prev, applicable_task_ids: nextSet };
                            })
                          }
                        />
                        <span>{task.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {panelMessage && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {panelMessage}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-full border border-black/10 px-4 py-2 text-sm"
                onClick={handleClosePanelModal}
                disabled={panelSaving}
              >
                Cancelar
              </button>
              <button
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleSavePanel}
                disabled={panelSaving}
              >
                {panelSaving ? 'Guardando...' : 'Guardar panel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {matrixOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm transition-all duration-300">
          <div className="flex h-full max-h-[90vh] w-full max-w-[95vw] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5">
            <div className="flex items-center justify-between border-b border-black/5 bg-white px-8 py-6 z-20">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Matriz de configuracion
                </p>
                <h3 className="mt-1 text-xl font-display text-[var(--ink)]">
                  Aplicabilidad de tareas y duraciones
                </h3>
                {selectedType && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                      {selectedType.name}
                    </span>
                    <span className="text-[var(--ink-muted)]">/</span>
                    <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10">
                      Modulo {selectedModuleNumber}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div className="hidden text-right sm:block">
                  <p className="text-xs text-[var(--ink-muted)]">Paneles totales</p>
                  <p className="font-semibold text-[var(--ink)]">{filteredPanels.length}</p>
                </div>
                <button
                  onClick={handleCloseMatrix}
                  className="rounded-full p-2 transition-colors hover:bg-black/5"
                >
                  <X className="h-6 w-6 text-[var(--ink-muted)]" />
                </button>
              </div>
            </div>

            <div className="relative flex-1 overflow-auto bg-slate-50/50">
              {panelTasks.length === 0 ? (
                <div className="flex h-full items-center justify-center p-8">
                  <div className="rounded-2xl border border-dashed border-black/10 bg-white p-8 text-center">
                    <p className="text-sm text-[var(--ink-muted)]">
                      No hay tareas de panel disponibles para esta matriz.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="inline-block min-w-fit w-full">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead className="sticky top-0 z-20 bg-slate-50">
                      <tr>
                        <th className="sticky left-0 z-30 w-64 min-w-[16rem] border-b border-r border-black/5 bg-slate-50 px-4 py-4 text-left shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)]">
                          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                            Definicion de tarea
                          </span>
                        </th>
                        {filteredPanels.map((panel) => (
                          <th
                            key={panel.id}
                            className="min-w-[160px] w-40 border-b border-black/5 bg-slate-50/95 px-4 py-4 text-left backdrop-blur-sm"
                          >
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-semibold text-[var(--ink)]">
                                {panel.panel_code}
                              </span>
                              <div className="flex flex-col">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--ink-muted)]">
                                  {panel.group}
                                </span>
                                {panel.sub_type_id && (
                                  <span className="text-[10px] font-bold text-blue-600">
                                    {subtypeNameById.get(panel.sub_type_id) ?? 'Subtipo'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {panelTasks.map((task) => (
                        <tr key={task.id} className="group transition-colors hover:bg-slate-50/50">
                          <td className="sticky left-0 z-10 w-64 min-w-[16rem] border-b border-r border-black/5 bg-white px-4 py-3 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)] group-hover:bg-slate-50/50">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-[var(--ink)]">
                                {task.name}
                              </span>
                              {task.station_sequence_order !== null && (
                                <span className="mt-0.5 text-[10px] font-mono text-[var(--ink-muted)]">
                                  Sec: {String(task.station_sequence_order).padStart(3, '0')}
                                </span>
                              )}
                            </div>
                          </td>
                          {filteredPanels.map((panel) => {
                            const state = matrixDraft[panel.id];
                            const applies = state?.applicable_task_ids.has(task.id) ?? true;
                            const duration = state?.task_durations[task.id] ?? '';

                            return (
                              <td key={panel.id} className="border-b border-black/5 px-3 py-2">
                                <div
                                  className={`relative flex items-center gap-2 rounded-lg border px-3 py-2 transition-all duration-200 ${
                                    applies
                                      ? 'border-blue-200 bg-blue-50/30 shadow-sm'
                                      : 'border-transparent bg-slate-50 hover:border-slate-200 hover:bg-slate-100'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggleMatrixApplicability(panel.id, task.id)}
                                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${
                                      applies
                                        ? 'bg-blue-500 text-white shadow-sm hover:bg-blue-600 hover:scale-105'
                                        : 'bg-slate-200 text-slate-400 hover:bg-slate-300 hover:text-slate-500'
                                    }`}
                                    title={
                                      applies
                                        ? 'Deshabilitar tarea para este panel'
                                        : 'Habilitar tarea para este panel'
                                    }
                                  >
                                    {applies ? (
                                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                    ) : (
                                      <Plus className="h-3.5 w-3.5" strokeWidth={3} />
                                    )}
                                  </button>

                                  <div
                                    className={`flex flex-1 items-center gap-1.5 ${
                                      !applies && 'pointer-events-none opacity-30 grayscale'
                                    }`}
                                  >
                                    {applies ? (
                                      <>
                                        <input
                                          className="w-full min-w-0 bg-transparent text-right text-sm font-semibold text-[var(--ink)] placeholder:text-slate-300 focus:outline-none"
                                          placeholder="0"
                                          value={duration}
                                          onChange={(event) =>
                                            updateMatrixDuration(panel.id, task.id, event.target.value)
                                          }
                                        />
                                        <span className="select-none text-[10px] font-medium text-[var(--ink-muted)]">
                                          min
                                        </span>
                                      </>
                                    ) : (
                                      <span className="w-full select-none text-center text-xs font-medium text-slate-400">
                                        N/A
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-black/5 bg-white px-8 py-5 z-20">
              <div className="text-xs text-[var(--ink-muted)]">
                {matrixMessage && (
                  <span className="rounded-md bg-red-50 px-2 py-1 font-medium text-red-600">
                    {matrixMessage}
                  </span>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  className="rounded-full border border-black/10 px-6 py-2.5 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-slate-50 disabled:opacity-50"
                  onClick={handleCloseMatrix}
                  disabled={matrixSaving}
                >
                  Cancelar
                </button>
                <button
                  className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-[var(--accent)]/90 hover:shadow-lg disabled:opacity-60 disabled:shadow-none"
                  onClick={handleSaveMatrix}
                  disabled={matrixSaving}
                >
                  {matrixSaving ? (
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      <span>Saving...</span>
                    </div>
                  ) : (
                    'Guardar cambios'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {sequenceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Secuencia</p>
                <h3 className="text-lg font-display text-[var(--ink)]">Orden de produccion</h3>
                {selectedType && (
                  <p className="text-xs text-[var(--ink-muted)]">
                    {selectedType.name} | Modulo {selectedModuleNumber}
                  </p>
                )}
              </div>
              <button onClick={handleCloseSequence}>
                <X className="h-5 w-5 text-[var(--ink-muted)]" />
              </button>
            </div>

            <div className="mt-4 max-h-[60vh] overflow-auto rounded-2xl border border-black/5 bg-white">
              {sequenceDraft.length === 0 ? (
                <div className="p-4 text-sm text-[var(--ink-muted)]">No hay paneles para ordenar.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[rgba(201,215,245,0.4)] text-xs text-[var(--ink-muted)]">
                    <tr>
                      <th className="w-16 px-4 py-2 text-left">Orden</th>
                      <th className="px-4 py-2 text-left">Codigo de panel</th>
                      <th className="px-4 py-2 text-left">Grupo / Subtipo</th>
                      <th className="px-4 py-2 text-right">Accion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sequenceDraft.map((panel, index) => (
                      <tr key={panel.id} className="border-t border-black/5">
                        <td className="px-4 py-3 font-mono text-[var(--ink-muted)]">{index + 1}</td>
                        <td className="px-4 py-3 font-semibold text-[var(--ink)]">
                          {panel.panel_code}
                        </td>
                        <td className="px-4 py-3 text-[var(--ink-muted)]">
                          <div className="flex flex-col">
                            <span className="text-xs">{panel.group}</span>
                            {panel.sub_type_id && (
                              <span className="text-[10px] font-bold text-blue-600">
                                {subtypeNameById.get(panel.sub_type_id)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              className="rounded p-1 hover:bg-black/5 disabled:opacity-30"
                              onClick={() => handleMovePanel(index, 'up')}
                              disabled={index === 0}
                            >
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                              className="rounded p-1 hover:bg-black/5 disabled:opacity-30"
                              onClick={() => handleMovePanel(index, 'down')}
                              disabled={index === sequenceDraft.length - 1}
                            >
                              <ArrowDown className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {sequenceMessage && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {sequenceMessage}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-full border border-black/10 px-4 py-2 text-sm"
                onClick={handleCloseSequence}
                disabled={sequenceSaving}
              >
                Cancelar
              </button>
              <button
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleSaveSequence}
                disabled={sequenceSaving}
              >
                {sequenceSaving ? 'Guardando...' : 'Aplicar orden'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HouseConfigurator;
