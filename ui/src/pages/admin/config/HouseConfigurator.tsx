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
  applicabilityRowId: number | null;
  durationRowId: number | null;
};

type TaskRuleBaseline = {
  applies: boolean;
  expectedMinutes: string;
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
  'Vigas Caj\u00f3n',
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
    throw new Error(text || `Request failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

const parseCascadeWarning = (message: string) => {
  const match = message.match(
    /sub_types=(\d+), panel_definitions=(\d+), panel_units=(\d+), parameter_values=(\d+)/
  );
  if (!match) {
    return null;
  }
  const [, subTypes, panelDefinitions, panelUnits, parameterValues] = match;
  return {
    subTypes: Number(subTypes),
    panelDefinitions: Number(panelDefinitions),
    panelUnits: Number(panelUnits),
    parameterValues: Number(parameterValues),
  };
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

const isDefaultApplicabilityRow = (row: TaskApplicability) =>
  row.house_type_id === null &&
  row.sub_type_id === null &&
  row.module_number === null &&
  row.panel_definition_id === null;

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
            setSubtypeMessage('Some subtype lists failed to load.');
          }
          setLoadingSubtypes(false);
        } else {
          setHouseTypes([]);
          setSelectedTypeId(null);
          setSelectedModuleNumber(null);
          setDraft(emptyDraft());
          setSubtypesByType({});
          messageParts.push('House types failed to load.');
        }

        if (panelResult.status === 'fulfilled') {
          setPanels(panelResult.value);
        } else {
          setPanels([]);
          messageParts.push('Panel definitions failed to load.');
        }

        if (taskResult.status === 'fulfilled') {
          setTaskDefinitions(taskResult.value);
        } else {
          setTaskDefinitions([]);
          messageParts.push('Task definitions failed to load.');
        }

        if (applicabilityResult.status === 'fulfilled') {
          setApplicabilityRows(applicabilityResult.value);
        } else {
          setApplicabilityRows([]);
          messageParts.push('Task applicability rules failed to load.');
        }

        if (durationResult.status === 'fulfilled') {
          setDurationRows(durationResult.value);
        } else {
          setDurationRows([]);
          messageParts.push('Task duration rules failed to load.');
        }

        if (stationResult.status === 'fulfilled') {
          setStations(stationResult.value);
        } else {
          setStations([]);
          messageParts.push('Stations failed to load.');
        }

        if (messageParts.length > 0) {
          setStatusMessage(messageParts.join(' '));
        }
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error ? error.message : 'Failed to load house configuration.';
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

  const defaultApplicabilityByTask = useMemo(() => {
    const map = new Map<number, TaskApplicability>();
    applicabilityRows.forEach((row) => {
      if (!isDefaultApplicabilityRow(row)) {
        return;
      }
      const existing = map.get(row.task_definition_id);
      if (!existing || row.id < existing.id) {
        map.set(row.task_definition_id, row);
      }
    });
    return map;
  }, [applicabilityRows]);

  const panelTasks = useMemo(() => {
    const panelScoped = taskDefinitions
      .filter((task) => task.scope === 'panel' && task.active)
      .map((task) => ({
        id: task.id,
        name: task.name,
        station_sequence_order: defaultApplicabilityByTask.get(task.id)?.station_sequence_order ?? null,
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
  }, [taskDefinitions, defaultApplicabilityByTask]);

  const moduleTasks = useMemo(() => {
    const moduleScoped = taskDefinitions
      .filter((task) => task.scope === 'module' && task.active)
      .map((task) => ({
        id: task.id,
        name: task.name,
        station_sequence_order: defaultApplicabilityByTask.get(task.id)?.station_sequence_order ?? null,
      }));
    return sortTasks(moduleScoped);
  }, [taskDefinitions, defaultApplicabilityByTask]);

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

  const stationGroups = useMemo(() => {
    const groups = new Map<string, StationGroup>();
    const buildGroupInfo = (sequence: number | null) => {
      if (sequence === null) {
        return {
          title: 'Other tasks',
          subtitle: 'Unscheduled or auxiliary work',
        };
      }
      const info = stationInfoBySequence.get(sequence);
      const names = info ? Array.from(new Set(info.names)) : [];
      const lineTypes = info ? Array.from(new Set(info.lineTypes)) : [];
      const title = names.length > 0 ? names.join(' / ') : `Sequence ${sequence}`;
      const subtitleParts = [`Seq ${sequence}`];
      if (lineTypes.length > 0) {
        subtitleParts.push(`Line ${lineTypes.join('/')}`);
      }
      return {
        title,
        subtitle: subtitleParts.join(' / '),
      };
    };

    moduleTasks.forEach((task) => {
      const sequence = task.station_sequence_order;
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
  }, [moduleTasks, stationInfoBySequence]);

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
      const defaultRow = pickRow(
        taskApplicabilityRows,
        (row) =>
          row.house_type_id === null &&
          row.module_number === null &&
          row.sub_type_id === null &&
          row.panel_definition_id === null
      );
      const resolvedApplicability = moduleRow ?? houseRow ?? defaultRow ?? null;
      const applies = resolvedApplicability ? resolvedApplicability.applies : false;

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
        applicabilityRowId: moduleRow?.id ?? null,
        durationRowId: moduleDuration?.id ?? null,
      };
      nextBaseline[task.id] = { applies, expectedMinutes };
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
      const message = error instanceof Error ? error.message : 'Failed to load subtypes.';
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
      throw new Error('House type name is required.');
    }
    const modulesValue = current.number_of_modules.trim();
    const modules = Number(modulesValue);
    if (!modulesValue) {
      throw new Error('Number of modules is required.');
    }
    if (!Number.isInteger(modules) || modules <= 0) {
      throw new Error('Number of modules must be a positive whole number.');
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
      setTypeStatusMessage('House type saved.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save house type.';
      setTypeStatusMessage(message);
    } finally {
      setSavingType(false);
    }
  };

  const handleDeleteHouseType = async () => {
    if (!draft.id) {
      return;
    }
    if (!window.confirm('Delete this house type?')) {
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
      setTypeStatusMessage('House type removed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove house type.';
      const counts = parseCascadeWarning(message);
      if (counts) {
        const confirmMessage = [
          'This house type has dependent records:',
          `Subtypes: ${counts.subTypes}`,
          `Panel definitions: ${counts.panelDefinitions}`,
          `Panel units: ${counts.panelUnits}`,
          `Parameter values: ${counts.parameterValues}`,
          'Delete anyway?',
        ].join('\n');
        if (!window.confirm(confirmMessage)) {
          setTypeStatusMessage('Deletion cancelled.');
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
          setTypeStatusMessage('House type removed.');
          return;
        } catch (forceError) {
          const forceMessage =
            forceError instanceof Error ? forceError.message : 'Failed to remove house type.';
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
      setSubtypeMessage('Subtype name is required.');
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
      setSubtypeMessage('Subtype added.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add subtype.';
      setSubtypeMessage(message);
    } finally {
      setSavingSubtype(false);
    }
  };

  const handleSaveSubtype = async (subtype: HouseSubType) => {
    const draftName = (subtypeDrafts[subtype.id] ?? subtype.name).trim();
    if (!draftName) {
      setSubtypeMessage('Subtype name is required.');
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
      setSubtypeMessage('Subtype updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update subtype.';
      setSubtypeMessage(message);
    } finally {
      setSavingSubtype(false);
    }
  };

  const handleDeleteSubtype = async (subtype: HouseSubType) => {
    if (!window.confirm('Delete this subtype?')) {
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
      setSubtypeMessage('Subtype removed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove subtype.';
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
    if (!window.confirm(`Delete panel ${panel.panel_code}? This cannot be undone.`)) {
      return;
    }
    try {
      await apiRequest<void>(`/api/panel-definitions/${panel.id}`, { method: 'DELETE' });
      setPanels((prev) => prev.filter((item) => item.id !== panel.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete panel.';
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
      return { error: 'Expected minutes must be a non-negative number.' } as const;
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
      setPanelMessage('Panel code is required.');
      setPanelSaving(false);
      return;
    }

    const areaValue = parseOptionalNumber(panelDraft.panel_area);
    if (areaValue === 'invalid') {
      setPanelMessage('Area must be a non-negative number.');
      setPanelSaving(false);
      return;
    }

    const lengthValue = parseOptionalNumber(panelDraft.panel_length_m);
    if (lengthValue === 'invalid') {
      setPanelMessage('Length must be a non-negative number.');
      setPanelSaving(false);
      return;
    }

    const taskPayload = buildTaskPayload(panelDraft.applicable_task_ids, panelDraft.task_durations);
    if ('error' in taskPayload) {
      setPanelMessage(taskPayload.error);
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
      const message = error instanceof Error ? error.message : 'Failed to save panel.';
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
      const message = error instanceof Error ? error.message : 'Failed to save matrix.';
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
      const message = error instanceof Error ? error.message : 'Failed to save panel sequence.';
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
            applicabilityRowId: null,
            durationRowId: null,
          };
          return;
        }
        next[task.id] = {
          ...current,
          applies: baseline.applies,
          expectedMinutes: baseline.expectedMinutes,
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

      if (draftState.applies !== baseline.applies) {
        const existing = moduleApplicability.get(task.id);
        if (existing) {
          requests.push(
            apiRequest(`/api/task-rules/applicability/${existing.id}`, {
              method: 'PUT',
              body: JSON.stringify({ applies: draftState.applies }),
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
                station_sequence_order: task.station_sequence_order,
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
        setModuleSaveMessage('Expected minutes must be a non-negative number.');
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
      setModuleSaveMessage('No changes to save.');
      setModuleSaveError(false);
      setModuleSaving(false);
      return;
    }

    try {
      await Promise.all(requests);
      await refreshModuleRules();
      setModuleSaveMessage('Changes saved.');
      setModuleSaveError(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save module rules.';
      setModuleSaveMessage(message);
      setModuleSaveError(true);
    } finally {
      setModuleSaving(false);
    }
  };

  const renderPanelCard = (panel: PanelDefinition, index: number) => {
    const subtypeLabel = panel.sub_type_id ? subtypeNameById.get(panel.sub_type_id) : null;
    const hasArea = panel.panel_area !== null && panel.panel_area !== undefined;
    const hasLength = panel.panel_length_m !== null && panel.panel_length_m !== undefined;
    return (
      <div
        key={panel.id}
        className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-white px-4 py-4 text-left shadow-sm animate-rise"
        style={{ animationDelay: `${index * 60}ms` }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(201,215,245,0.6)] text-[var(--ink)]">
              <Grid2X2 className="h-4 w-4" />
            </div>
            <div>
              <p className="font-semibold text-[var(--ink)]">{panel.panel_code}</p>
              <p className="text-xs text-[var(--ink-muted)]">{panel.group}</p>
              {subtypeLabel && (
                <span className="mt-1 inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                  {subtypeLabel}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {panel.panel_sequence_number !== null && panel.panel_sequence_number !== undefined && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                Ord {panel.panel_sequence_number}
              </span>
            )}
            <span className="rounded-full border border-black/10 px-2 py-1 text-[10px] text-[var(--ink-muted)]">
              #{panel.id}
            </span>
            <button
              className="rounded-full border border-black/10 p-2 text-[var(--ink)] hover:border-[var(--accent)]"
              onClick={() => handleEditPanel(panel)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded-full border border-black/10 p-2 text-[var(--ink)] hover:border-red-400 hover:text-red-500"
              onClick={() => handleDeletePanel(panel)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--ink-muted)]">
          {hasArea && <span>{panel.panel_area} m2</span>}
          {hasLength && <span>{panel.panel_length_m} m</span>}
          {!hasArea && !hasLength && <span className="italic">No geometry set</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Product Definition / House Configuration
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">House Configuration Studio</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            1) Define house types + subtypes, 2) set up panels, 3) confirm module task rules.
          </p>
        </div>
      </header>

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
            House types
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
            Panels
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
            Module tasks
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
          <span className="rounded-full border border-black/10 bg-white px-3 py-1">
            {selectedType ? selectedType.name : 'Pick a house type'}
          </span>
          {selectedType && (
            <span className="rounded-full border border-black/10 bg-white px-3 py-1">
              {selectedModuleNumber ? `Module ${selectedModuleNumber}` : 'Select a module'}
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
                  Step 1
                </p>
                <h2 className="text-lg font-display text-[var(--ink)]">House types & subtypes</h2>
                <p className="text-sm text-[var(--ink-muted)]">
                  {houseTypes.length} house types in the library
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
                  <input
                    type="search"
                    placeholder="Search house types"
                    className="h-9 rounded-full border border-black/10 bg-white pl-9 pr-4 text-sm"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <button
                  onClick={handleAddHouseType}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                >
                  <Plus className="h-4 w-4" /> New house type
                </button>
              </div>
            </div>

            {loading && (
              <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
                Loading house types…
              </div>
            )}

            {!loading && filteredHouseTypes.length === 0 && (
              <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
                No house types match this search.
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {filteredHouseTypes.map((type, index) => {
                const subtypes = subtypesByType[type.id];
                const preview = subtypes ? subtypes.slice(0, 3) : [];
                const remainingCount = subtypes ? subtypes.length - preview.length : 0;
                return (
                  <button
                    key={type.id}
                    onClick={() => handleSelectType(type)}
                    className={`flex h-full flex-col justify-between rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
                      selectedTypeId === type.id
                        ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
                        : 'border-black/5 bg-white'
                    }`}
                    style={{ animationDelay: `${index * 70}ms` }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(201,215,245,0.55)] text-[var(--ink)]">
                        <Home className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-base font-semibold text-[var(--ink)]">{type.name}</p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          {type.number_of_modules} modules
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {subtypes ? (
                        subtypes.length > 0 ? (
                          <>
                            {preview.map((subtype) => (
                              <span
                                key={subtype.id}
                                className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-[var(--ink-muted)]"
                              >
                                {subtype.name}
                              </span>
                            ))}
                            {remainingCount > 0 && (
                              <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-[var(--ink-muted)]">
                                +{remainingCount} more
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-[var(--ink-muted)]">No subtypes</span>
                        )
                      ) : (
                        <span className="text-xs text-[var(--ink-muted)]">
                          {loadingSubtypes ? 'Subtypes loading...' : 'Subtypes unavailable'}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
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
                    {selectedType ? selectedType.name : 'New house type'}
                  </h2>
                </div>
                <Sparkles className="h-5 w-5 text-[var(--ink-muted)]" />
              </div>

              <div className="mt-4 space-y-4">
                <label className="text-sm text-[var(--ink-muted)]">
                  House type name
                  <input
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    value={draft.name}
                    onChange={(event) => handleDraftChange({ name: event.target.value })}
                  />
                </label>
                <label className="text-sm text-[var(--ink-muted)]">
                  Number of modules
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
                    <p className="text-sm text-[var(--ink-muted)]">Subtypes</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input
                      className="min-w-[12rem] flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      placeholder="Subtype name"
                      value={newSubtypeName}
                      onChange={(event) => setNewSubtypeName(event.target.value)}
                      disabled={!selectedTypeId || savingSubtype}
                    />
                    <button
                      onClick={handleAddSubtype}
                      disabled={!selectedTypeId || savingSubtype}
                      className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-[var(--ink)] disabled:opacity-60"
                    >
                      <Plus className="h-3 w-3" /> Add subtype
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {!selectedTypeId && (
                      <div className="rounded-2xl border border-dashed border-black/10 px-3 py-2 text-xs text-[var(--ink-muted)]">
                        Save the house type to manage subtypes.
                      </div>
                    )}
                    {selectedTypeId && loadingSubtypes && selectedSubtypes.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-black/10 px-3 py-2 text-xs text-[var(--ink-muted)]">
                        Loading subtypes...
                      </div>
                    )}
                    {selectedTypeId && !loadingSubtypes && selectedSubtypes.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-black/10 px-3 py-2 text-xs text-[var(--ink-muted)]">
                        No subtypes configured.
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
                              Save
                            </button>
                            <button
                              onClick={() => handleDeleteSubtype(subtype)}
                              disabled={savingSubtype}
                              className="text-xs text-[var(--ink-muted)] disabled:opacity-60"
                            >
                              Remove
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
                    {savingType ? 'Saving...' : 'Save house type'}
                  </button>
                  <button
                    onClick={handleDeleteHouseType}
                    disabled={savingType || !draft.id}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--ink-muted)] disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" /> Delete
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
                Step 2
              </p>
              <h2 className="text-lg font-display text-[var(--ink)]">Panels per module</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                Add panel definitions, group them, and set panel-level task applicability.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
                onClick={handleOpenSequence}
                disabled={filteredPanels.length === 0}
              >
                <ListOrdered className="h-4 w-4" /> Sequence
              </button>
              <button
              className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
              onClick={handleOpenMatrix}
              disabled={filteredPanels.length === 0}
            >
              <Layers className="h-4 w-4" /> Task matrix
            </button>
              <button
                className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleAddPanel}
                disabled={!selectedTypeId || !selectedModuleNumber}
              >
                <Plus className="h-4 w-4" /> Add panel
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
              {!selectedTypeId && <option value="">Select house type</option>}
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
              {!selectedModuleNumber && <option value="">Select module</option>}
              {availableModules.map((moduleNumber) => (
                <option key={moduleNumber} value={moduleNumber}>
                  Module {moduleNumber}
                </option>
              ))}
            </select>
            {selectedType && selectedModuleNumber && (
              <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                <Layers className="h-4 w-4" />
                {selectedType.name} / Module {selectedModuleNumber}
              </div>
            )}
          </div>

          {loading && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              Loading panel definitions...
            </div>
          )}

          {!loading && !selectedTypeId && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm italic text-[var(--ink-muted)]">
              Select a house type above to begin managing panel definitions.
            </div>
          )}

          {!loading && selectedTypeId && filteredPanels.length === 0 && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              No panels are defined for this module yet.
            </div>
          )}

          {!loading && selectedTypeId && filteredPanels.length > 0 && (
            <div className="space-y-6">
              {groupedPanels.map((group) => (
                <section
                  key={group.name}
                  className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                      {group.name}
                    </h3>
                    <span className="text-xs text-[var(--ink-muted)]">
                      {group.items.length} panels
                    </span>
                  </div>
                  {group.items.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-4 text-sm text-[var(--ink-muted)]">
                      No panels in this group.
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {group.items.map((panel, index) => renderPanelCard(panel, index))}
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
                Step 3
              </p>
              <h2 className="text-lg font-display text-[var(--ink)]">Module task rules</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                Confirm which module tasks apply and set expected minutes for the selected module.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
                onClick={handleResetModuleRules}
                disabled={!moduleHasChanges || moduleSaving}
              >
                <RefreshCcw className="h-4 w-4" /> Reset
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleSaveModuleRules}
                disabled={
                  !moduleHasChanges || moduleSaving || !selectedTypeId || !selectedModuleNumber
                }
              >
                <Save className="h-4 w-4" />
                {moduleSaving ? 'Saving...' : 'Save changes'}
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
              {!selectedTypeId && <option value="">Select house type</option>}
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
              {!selectedModuleNumber && <option value="">Select module</option>}
              {availableModules.map((moduleNumber) => (
                <option key={moduleNumber} value={moduleNumber}>
                  Module {moduleNumber}
                </option>
              ))}
            </select>
            {selectedType && selectedModuleNumber && (
              <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                <Layers className="h-4 w-4" />
                {selectedType.name} / Module {selectedModuleNumber}
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
              Loading module task rules...
            </div>
          )}

          {!loading && !selectedTypeId && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm italic text-[var(--ink-muted)]">
              Select a house type above to begin managing module task rules.
            </div>
          )}

          {!loading && selectedTypeId && moduleTasks.length === 0 && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              No active module tasks are defined yet.
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
                        Station group
                      </p>
                      <h3 className="text-lg font-display text-[var(--ink)]">{group.title}</h3>
                      <p className="text-xs text-[var(--ink-muted)]">{group.subtitle}</p>
                    </div>
                    <span className="text-xs text-[var(--ink-muted)]">
                      {group.tasks.length} tasks
                    </span>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                  <table className="w-full table-fixed text-sm">
                    <thead className="bg-[rgba(201,215,245,0.3)] text-xs text-[var(--ink-muted)]">
                      <tr>
                        <th className="w-1/2 px-4 py-3 text-left">Task</th>
                        <th className="w-1/4 px-4 py-3 text-left">Applies</th>
                        <th className="w-1/4 px-4 py-3 text-left">Expected minutes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.tasks.map((task) => {
                        const state = moduleDraftByTask[task.id];
                        if (!state) {
                          return null;
                        }
                        return (
                          <tr key={task.id} className="border-t border-black/5">
                            <td className="w-1/2 px-4 py-3 font-medium text-[var(--ink)]">
                              <div className="flex flex-col">
                                <span>{task.name}</span>
                                {task.station_sequence_order !== null && (
                                  <span className="text-[10px] text-[var(--ink-muted)] font-mono">
                                    Seq {String(task.station_sequence_order).padStart(3, '0')}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="w-1/4 px-4 py-3">
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
                                {state.applies ? 'Applies' : 'Not applicable'}
                              </button>
                            </td>
                            <td className="w-1/4 px-4 py-3">
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
                  {panelDraft.id ? `Edit ${panelDraft.panel_code}` : 'Add panel'}
                </h3>
                {selectedType && (
                  <p className="text-xs text-[var(--ink-muted)]">
                    {selectedType.name} | Module {selectedModuleNumber}
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
                  Group
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
                  Panel code
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
                    Length (m)
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
                  Sub-type
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
                    <option value="">General (no sub-type)</option>
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
                      Applicability
                    </p>
                    <h4 className="text-sm font-semibold text-[var(--ink)]">
                      Panel tasks ({panelTasks.length})
                    </h4>
                  </div>
                  <Layers className="h-4 w-4 text-[var(--ink-muted)]" />
                </div>
                {panelTasks.length === 0 && (
                  <p className="mt-3 text-sm text-[var(--ink-muted)]">
                    No panel tasks are defined yet.
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
                Cancel
              </button>
              <button
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleSavePanel}
                disabled={panelSaving}
              >
                {panelSaving ? 'Saving...' : 'Save panel'}
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
                  Configuration Matrix
                </p>
                <h3 className="mt-1 text-xl font-display text-[var(--ink)]">
                  Task Applicability & Durations
                </h3>
                {selectedType && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                      {selectedType.name}
                    </span>
                    <span className="text-[var(--ink-muted)]">/</span>
                    <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10">
                      Module {selectedModuleNumber}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div className="hidden text-right sm:block">
                  <p className="text-xs text-[var(--ink-muted)]">Total Panels</p>
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
                      No panel tasks are available for this matrix.
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
                            Task Definition
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
                                    {subtypeNameById.get(panel.sub_type_id) ?? 'Sub-type'}
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
                                  Seq: {String(task.station_sequence_order).padStart(3, '0')}
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
                                        ? 'Disable task for this panel'
                                        : 'Enable task for this panel'
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
                  Cancel
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
                    'Save Changes'
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
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Sequence</p>
                <h3 className="text-lg font-display text-[var(--ink)]">Production Order</h3>
                {selectedType && (
                  <p className="text-xs text-[var(--ink-muted)]">
                    {selectedType.name} | Module {selectedModuleNumber}
                  </p>
                )}
              </div>
              <button onClick={handleCloseSequence}>
                <X className="h-5 w-5 text-[var(--ink-muted)]" />
              </button>
            </div>

            <div className="mt-4 max-h-[60vh] overflow-auto rounded-2xl border border-black/5 bg-white">
              {sequenceDraft.length === 0 ? (
                <div className="p-4 text-sm text-[var(--ink-muted)]">No panels to order.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[rgba(201,215,245,0.4)] text-xs text-[var(--ink-muted)]">
                    <tr>
                      <th className="w-16 px-4 py-2 text-left">Ord</th>
                      <th className="px-4 py-2 text-left">Panel Code</th>
                      <th className="px-4 py-2 text-left">Group / Sub-type</th>
                      <th className="px-4 py-2 text-right">Action</th>
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
                Cancel
              </button>
              <button
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleSaveSequence}
                disabled={sequenceSaving}
              >
                {sequenceSaving ? 'Saving...' : 'Apply Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HouseConfigurator;
