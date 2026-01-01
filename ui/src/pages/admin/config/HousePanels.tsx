import React, { useEffect, useMemo, useState } from 'react';
import { Grid2X2, Layers, Pencil, Plus, Trash2, X } from 'lucide-react';

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
};

type TaskScope = 'panel' | 'module';

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

type PanelTask = {
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

const PANEL_GROUPS = [
  'Paneles de Piso',
  'Paneles de Cielo',
  'Paneles Perimetrales',
  'Tabiques Interiores',
  'Vigas Caj\u00f3n',
  'Otros',
  'Multiwalls',
];

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
    throw new Error(text || `Request failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
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

const isDefaultApplicabilityRow = (row: TaskApplicability) =>
  row.house_type_id === null &&
  row.sub_type_id === null &&
  row.module_number === null &&
  row.panel_definition_id === null;

const sortHouseTypes = (list: HouseType[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

const sortSubtypes = (list: HouseSubType[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

const sortPanels = (list: PanelDefinition[]) =>
  [...list].sort((a, b) => {
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

const HousePanels: React.FC = () => {
  const [houseTypes, setHouseTypes] = useState<HouseType[]>([]);
  const [subtypesByType, setSubtypesByType] = useState<Record<number, HouseSubType[]>>({});
  const [panels, setPanels] = useState<PanelDefinition[]>([]);
  const [tasks, setTasks] = useState<PanelTask[]>([]);
  const [selectedHouseTypeId, setSelectedHouseTypeId] = useState<number | null>(null);
  const [selectedModuleNumber, setSelectedModuleNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSubtypes, setLoadingSubtypes] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [panelModalOpen, setPanelModalOpen] = useState(false);
  const [panelDraft, setPanelDraft] = useState<PanelDraft | null>(null);
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);

  const [matrixOpen, setMatrixOpen] = useState(false);
  const [matrixDraft, setMatrixDraft] = useState<Record<number, MatrixPanelState>>({});
  const [matrixSaving, setMatrixSaving] = useState(false);
  const [matrixMessage, setMatrixMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setStatusMessage(null);
      try {
        const [houseTypeResult, panelResult, taskResult, applicabilityResult] =
          (await Promise.allSettled([
            apiRequest<HouseType[]>('/api/house-types'),
            apiRequest<PanelDefinition[]>('/api/panel-definitions'),
            apiRequest<TaskDefinition[]>('/api/task-definitions'),
            apiRequest<TaskApplicability[]>('/api/task-rules/applicability'),
          ])) as [
            PromiseSettledResult<HouseType[]>,
            PromiseSettledResult<PanelDefinition[]>,
            PromiseSettledResult<TaskDefinition[]>,
            PromiseSettledResult<TaskApplicability[]>,
          ];
        if (!active) {
          return;
        }
        const messageParts: string[] = [];

        if (houseTypeResult.status === 'fulfilled') {
          const sortedHouseTypes = sortHouseTypes(houseTypeResult.value);
          setHouseTypes(sortedHouseTypes);
          if (sortedHouseTypes.length > 0) {
            setSelectedHouseTypeId(sortedHouseTypes[0].id);
            setSelectedModuleNumber(1);
          } else {
            setSelectedHouseTypeId(null);
            setSelectedModuleNumber(null);
          }
        } else {
          setHouseTypes([]);
          setSelectedHouseTypeId(null);
          setSelectedModuleNumber(null);
          messageParts.push('House types failed to load.');
        }

        if (panelResult.status === 'fulfilled') {
          setPanels(panelResult.value);
        } else {
          setPanels([]);
          messageParts.push('Panel definitions failed to load.');
        }

        const defaultApplicability = new Map<number, TaskApplicability>();
        if (applicabilityResult.status === 'fulfilled') {
          applicabilityResult.value.forEach((row) => {
            if (!isDefaultApplicabilityRow(row)) {
              return;
            }
            const existing = defaultApplicability.get(row.task_definition_id);
            if (!existing || row.id < existing.id) {
              defaultApplicability.set(row.task_definition_id, row);
            }
          });
        } else {
          messageParts.push('Task applicability rules failed to load.');
        }

        if (taskResult.status === 'fulfilled') {
          const panelTasks = taskResult.value
            .filter((task) => task.scope === 'panel' && task.active)
            .map((task) => ({
              id: task.id,
              name: task.name,
              station_sequence_order:
                defaultApplicability.get(task.id)?.station_sequence_order ?? null,
            }))
            .sort((a, b) => {
              const aSeq = a.station_sequence_order ?? Number.POSITIVE_INFINITY;
              const bSeq = b.station_sequence_order ?? Number.POSITIVE_INFINITY;
              if (aSeq !== bSeq) {
                return aSeq - bSeq;
              }
              return a.name.localeCompare(b.name);
            });
          setTasks(panelTasks);
        } else {
          setTasks([]);
          messageParts.push('Task definitions failed to load.');
        }

        if (messageParts.length > 0) {
          setStatusMessage(messageParts.join(' '));
        }
      } catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : 'Failed to load panel data.';
          setStatusMessage(message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const selectedHouseType = useMemo(
    () => houseTypes.find((type) => type.id === selectedHouseTypeId) ?? null,
    [houseTypes, selectedHouseTypeId]
  );

  const availableModules = useMemo(() => {
    if (!selectedHouseType) {
      return [];
    }
    return Array.from({ length: selectedHouseType.number_of_modules }, (_, index) => index + 1);
  }, [selectedHouseType]);

  useEffect(() => {
    if (!selectedHouseTypeId) {
      return;
    }
    if (subtypesByType[selectedHouseTypeId]) {
      return;
    }
    const loadSubtypes = async () => {
      setLoadingSubtypes(true);
      try {
        const data = await apiRequest<HouseSubType[]>(
          `/api/house-types/${selectedHouseTypeId}/subtypes`
        );
        setSubtypesByType((prev) => ({
          ...prev,
          [selectedHouseTypeId]: sortSubtypes(data),
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load subtypes.';
        setStatusMessage(message);
      } finally {
        setLoadingSubtypes(false);
      }
    };
    void loadSubtypes();
  }, [selectedHouseTypeId, subtypesByType]);

  const selectedSubtypes = useMemo(() => {
    if (!selectedHouseTypeId) {
      return [];
    }
    return subtypesByType[selectedHouseTypeId] ?? [];
  }, [selectedHouseTypeId, subtypesByType]);

  const subtypeNameById = useMemo(() => {
    const map = new Map<number, string>();
    selectedSubtypes.forEach((subtype) => {
      map.set(subtype.id, subtype.name);
    });
    return map;
  }, [selectedSubtypes]);

  const filteredPanels = useMemo(() => {
    if (!selectedHouseTypeId || !selectedModuleNumber) {
      return [];
    }
    return panels.filter(
      (panel) =>
        panel.house_type_id === selectedHouseTypeId &&
        panel.module_sequence_number === selectedModuleNumber
    );
  }, [panels, selectedHouseTypeId, selectedModuleNumber]);

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

  const taskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);

  const openPanelModal = (panel: PanelDefinition | null) => {
    setPanelDraft(buildPanelDraft(panel, tasks));
    setPanelMessage(null);
    setPanelModalOpen(true);
  };

  const handleAddPanel = () => {
    if (!selectedHouseTypeId || !selectedModuleNumber) {
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

  const buildTaskPayload = (
    applicableSet: Set<number>,
    durations: Record<number, string>
  ) => {
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
    if (!panelDraft || !selectedHouseTypeId || !selectedModuleNumber) {
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

    const taskPayload = buildTaskPayload(
      panelDraft.applicable_task_ids,
      panelDraft.task_durations
    );
    if ('error' in taskPayload) {
      setPanelMessage(taskPayload.error);
      setPanelSaving(false);
      return;
    }

    const payload = {
      house_type_id: selectedHouseTypeId,
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
        task_durations: buildDurationsMap(panel, tasks),
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
    if (!selectedHouseTypeId || !selectedModuleNumber) {
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

  const handleSelectHouseType = (houseTypeId: number) => {
    setSelectedHouseTypeId(houseTypeId);
    setSelectedModuleNumber(1);
    setPanelDraft(null);
    setPanelModalOpen(false);
    setMatrixOpen(false);
    setStatusMessage(null);
  };

  const handleSelectModule = (moduleNumber: number) => {
    setSelectedModuleNumber(moduleNumber);
    setPanelDraft(null);
    setPanelModalOpen(false);
    setMatrixOpen(false);
    setStatusMessage(null);
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
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Product Definition / House Panels
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">Panel Definitions</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Define panel geometry, task applicability, and expected minutes per module.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
            onClick={handleOpenMatrix}
            disabled={filteredPanels.length === 0 || tasks.length === 0}
          >
            <Layers className="h-4 w-4" /> Task matrix
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={handleAddPanel}
            disabled={!selectedHouseTypeId || !selectedModuleNumber}
          >
            <Plus className="h-4 w-4" /> Add panel
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-3">
        <select
          className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm"
          value={selectedHouseTypeId ?? ''}
          onChange={(event) => handleSelectHouseType(Number(event.target.value))}
          disabled={houseTypes.length === 0}
        >
          {!selectedHouseTypeId && <option value="">Select house type</option>}
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
          disabled={!selectedHouseTypeId}
        >
          {!selectedModuleNumber && <option value="">Select module</option>}
          {availableModules.map((moduleNumber) => (
            <option key={moduleNumber} value={moduleNumber}>
              Module {moduleNumber}
            </option>
          ))}
        </select>
      </div>

      {statusMessage && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {statusMessage}
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
          Loading panel definitions...
        </div>
      )}

      {!loading && !selectedHouseTypeId && (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm italic text-[var(--ink-muted)]">
          Select a house type to begin managing panel definitions.
        </div>
      )}

      {!loading && selectedHouseTypeId && filteredPanels.length === 0 && (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
          No panels are defined for this module yet.
        </div>
      )}

      {!loading && selectedHouseTypeId && filteredPanels.length > 0 && (
        <div className="space-y-6">
          {groupedPanels.map((group) => (
            <section
              key={group.name}
              className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  {group.name}
                </h2>
                <span className="text-xs text-[var(--ink-muted)]">{group.items.length} panels</span>
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

      {panelModalOpen && panelDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-4xl rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Panel</p>
                <h3 className="text-lg font-display text-[var(--ink)]">
                  {panelDraft.id ? `Edit ${panelDraft.panel_code}` : 'Add panel'}
                </h3>
                {selectedHouseType && (
                  <p className="text-xs text-[var(--ink-muted)]">
                    {selectedHouseType.name} | Module {selectedModuleNumber}
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
                      Panel tasks ({tasks.length})
                    </h4>
                  </div>
                  <Layers className="h-4 w-4 text-[var(--ink-muted)]" />
                </div>
                {tasks.length === 0 && (
                  <p className="mt-3 text-sm text-[var(--ink-muted)]">
                    No panel tasks are defined yet.
                  </p>
                )}
                {tasks.length > 0 && (
                  <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-2 text-sm">
                    {tasks.map((task) => (
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-6xl rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Matrix</p>
                <h3 className="text-lg font-display text-[var(--ink)]">
                  Task applicability + expected minutes
                </h3>
                {selectedHouseType && (
                  <p className="text-xs text-[var(--ink-muted)]">
                    {selectedHouseType.name} | Module {selectedModuleNumber}
                  </p>
                )}
              </div>
              <button onClick={handleCloseMatrix}>
                <X className="h-5 w-5 text-[var(--ink-muted)]" />
              </button>
            </div>

            {tasks.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-4 text-sm text-[var(--ink-muted)]">
                No panel tasks are available for this matrix.
              </div>
            ) : (
              <div className="mt-4 overflow-auto rounded-2xl border border-black/5">
                <table className="min-w-full text-sm">
                  <thead className="bg-[rgba(201,215,245,0.4)] text-xs text-[var(--ink-muted)]">
                    <tr>
                      <th className="sticky left-0 z-10 bg-[rgba(201,215,245,0.6)] px-3 py-2 text-left">
                        Task
                      </th>
                      {filteredPanels.map((panel) => (
                        <th key={panel.id} className="px-3 py-2 text-left">
                          <div className="font-semibold text-[var(--ink)]">{panel.panel_code}</div>
                          {panel.sub_type_id && (
                            <div className="text-[10px] text-sky-700">
                              {subtypeNameById.get(panel.sub_type_id) ?? 'Sub-type'}
                            </div>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => (
                      <tr key={task.id} className="border-t border-black/5">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 text-[var(--ink)]">
                          <div className="font-semibold">{task.name}</div>
                          {task.station_sequence_order !== null && (
                            <div className="text-[10px] text-[var(--ink-muted)]">
                              Seq {task.station_sequence_order}
                            </div>
                          )}
                        </td>
                        {filteredPanels.map((panel) => {
                          const state = matrixDraft[panel.id];
                          const applies = state?.applicable_task_ids.has(task.id) ?? true;
                          return (
                            <td key={panel.id} className="px-3 py-2">
                              <div className="flex flex-col gap-2">
                                <button
                                  type="button"
                                  className={`h-6 rounded-full px-2 text-xs font-semibold text-white transition ${
                                    applies
                                      ? 'bg-emerald-500 hover:bg-emerald-600'
                                      : 'bg-rose-400 hover:bg-rose-500'
                                  }`}
                                  onClick={() => toggleMatrixApplicability(panel.id, task.id)}
                                >
                                  {applies ? 'Applies' : 'Skip'}
                                </button>
                                {applies ? (
                                  <input
                                    className="w-24 rounded-lg border border-black/10 bg-white px-2 py-1 text-xs"
                                    placeholder="min"
                                    value={state?.task_durations[task.id] ?? ''}
                                    onChange={(event) =>
                                      updateMatrixDuration(panel.id, task.id, event.target.value)
                                    }
                                  />
                                ) : (
                                  <span className="text-[10px] text-[var(--ink-muted)]">N/A</span>
                                )}
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

            {matrixMessage && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {matrixMessage}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-full border border-black/10 px-4 py-2 text-sm"
                onClick={handleCloseMatrix}
                disabled={matrixSaving}
              >
                Close
              </button>
              <button
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleSaveMatrix}
                disabled={matrixSaving}
              >
                {matrixSaving ? 'Saving...' : 'Save matrix'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loadingSubtypes && (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-3 text-sm text-[var(--ink-muted)]">
          Loading subtypes...
        </div>
      )}
    </div>
  );
};

export default HousePanels;
