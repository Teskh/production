import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Edit,
  GripVertical,
  Info,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayout';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

// --- Types ---

type ProductionStatus = 'Planned' | 'Panels' | 'Magazine' | 'Assembly' | 'Completed';
type LineId = '1' | '2' | '3' | null;

type QueueItem = {
  id: number;
  work_order_id: number;
  planned_sequence: number;
  project_name: string;
  house_identifier: string;
  module_number: number;
  house_type_id: number;
  house_type_name: string;
  sub_type_id: number | null;
  sub_type_name: string | null;
  planned_start_datetime: string | null;
  planned_assembly_line: LineId;
  status: ProductionStatus;
};

type PanelStatus = 'Planned' | 'InProgress' | 'Completed' | 'Consumed';
type TaskStatus = 'NotStarted' | 'InProgress' | 'Paused' | 'Completed' | 'Skipped';

type PanelTaskStatus = {
  task_definition_id: number;
  name: string;
  status: TaskStatus;
};

type PanelStatusDetail = {
  panel_definition_id: number;
  panel_unit_id: number | null;
  panel_code: string | null;
  status: PanelStatus;
  current_station_id: number | null;
  current_station_name: string | null;
  pending_tasks: PanelTaskStatus[];
};

type ModuleStatusDetail = {
  work_unit_id: number;
  work_order_id: number;
  project_name: string;
  house_identifier: string;
  module_number: number;
  house_type_id: number;
  house_type_name: string;
  sub_type_id: number | null;
  sub_type_name: string | null;
  status: ProductionStatus;
  planned_assembly_line: LineId;
  current_station_id: number | null;
  current_station_name: string | null;
  panels: PanelStatusDetail[];
};

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

type BatchDraft = {
  project_name: string;
  house_identifier_base: string;
  house_type_id: string;
  sub_type_id: string;
  quantity: number;
  planned_start_datetime: string;
};

// --- Utils ---

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
    throw new Error(text || `Solicitud fallida (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

const normalizeSearchValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const formatPlannedDate = (value: string | null): string => {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  const now = new Date();
  const datePart = date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
  });
  if (date.getFullYear() !== now.getFullYear()) {
    return `${datePart}/${date.getFullYear()}`;
  }
  return datePart;
};

const formatPlannedTime = (value: string | null): string => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const toInputDateTime = (value: string | null): string => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

const formatStatusLabel = (value: string): string => {
  const map: Record<string, string> = {
    Planned: 'Planificado',
    InProgress: 'En progreso',
    Completed: 'Completado',
    Consumed: 'Consumido',
    NotStarted: 'No iniciado',
    Paused: 'Pausado',
    Skipped: 'Omitido',
  };
  if (map[value]) {
    return map[value];
  }
  return value.replace(/([a-z])([A-Z])/g, '$1 $2');
};

const sortQueueItems = (list: QueueItem[]): QueueItem[] =>
  [...list].sort((a, b) => {
    const aCompleted = a.status === 'Completed';
    const bCompleted = b.status === 'Completed';
    if (aCompleted !== bCompleted) {
      return aCompleted ? 1 : -1;
    }
    if (a.planned_sequence !== b.planned_sequence) {
      return a.planned_sequence - b.planned_sequence;
    }
    return a.id - b.id;
  });

const suggestHouseIdentifierBase = (projectName: string, items: QueueItem[]): string => {
  const matches = items.filter((item) => item.project_name === projectName);
  let bestMatch: { prefix: string; number: number; width: number } | null = null;
  matches.forEach((item) => {
    const match = item.house_identifier.match(/^(.*?)(\d+)$/);
    if (!match) {
      return;
    }
    const [, prefix, digits] = match;
    const number = Number(digits);
    if (Number.isNaN(number)) {
      return;
    }
    if (!bestMatch || number > bestMatch.number) {
      bestMatch = { prefix, number, width: digits.length };
    }
  });
  if (!bestMatch) {
    return '';
  }
  const nextNumber = String(bestMatch.number + 1).padStart(bestMatch.width, '0');
  return `${bestMatch.prefix}${nextNumber}`;
};

// --- Sub-components ---

type StatusKey = 'planned' | 'panels' | 'magazine' | 'assembly' | 'completed';

const StatusBadge: React.FC<{ status: ProductionStatus }> = ({ status }) => {
  const statusKey = status.toLowerCase() as StatusKey;
  const styles: Record<StatusKey, string> = {
    planned: 'bg-black/5 text-[var(--ink-muted)] border-black/5',
    panels: 'bg-[rgba(242,98,65,0.1)] text-[var(--accent)] border-[rgba(242,98,65,0.2)]',
    magazine: 'bg-purple-50 text-purple-700 border-purple-100',
    assembly: 'bg-[rgba(201,215,245,0.3)] text-blue-700 border-blue-100',
    completed: 'bg-[rgba(47,107,79,0.12)] text-[var(--leaf)] border-[rgba(47,107,79,0.2)]',
  };

  const labels: Record<StatusKey, string> = {
    planned: 'Planificado',
    panels: 'Paneles',
    magazine: 'Magazine',
    assembly: 'Ensamblaje',
    completed: 'Completado',
  };

  return (
    <span
      className={`px-3 py-1 rounded-full text-[10px] uppercase tracking-wider font-bold border ${
        styles[statusKey]
      }`}
    >
      {labels[statusKey]}
    </span>
  );
};

const panelStatusStyles: Record<PanelStatus, string> = {
  Planned: 'bg-black/5 text-[var(--ink-muted)] border-black/5',
  InProgress: 'bg-[rgba(242,98,65,0.1)] text-[var(--accent)] border-[rgba(242,98,65,0.2)]',
  Completed: 'bg-[rgba(47,107,79,0.12)] text-[var(--leaf)] border-[rgba(47,107,79,0.2)]',
  Consumed: 'bg-black/10 text-[var(--ink-muted)] border-black/10',
};

const taskStatusStyles: Record<TaskStatus, string> = {
  NotStarted: 'bg-black/5 text-[var(--ink-muted)] border-black/5',
  InProgress: 'bg-blue-50 text-blue-700 border-blue-100',
  Paused: 'bg-amber-50 text-amber-700 border-amber-100',
  Completed: 'bg-[rgba(47,107,79,0.12)] text-[var(--leaf)] border-[rgba(47,107,79,0.2)]',
  Skipped: 'bg-black/10 text-[var(--ink-muted)] border-black/10',
};

const LineSelector: React.FC<{
  current: LineId;
  onChange: (l: LineId) => void;
  disabled?: boolean;
}> = ({ current, onChange, disabled }) => {
  return (
    <div className="flex bg-black/5 rounded-xl p-1 gap-1">
      {(['1', '2', '3'] as const).map((line) => (
        <button
          key={line}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onChange(line);
          }}
          className={`
            w-7 h-7 flex items-center justify-center text-[11px] font-bold rounded-lg
            transition-all
            ${
              current === line
                ? 'bg-white text-[var(--accent)] shadow-sm border border-black/5'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-white/50'
            }
            ${disabled ? 'opacity-30 cursor-not-allowed' : ''}
          `}
        >
          {line}
        </button>
      ))}
    </div>
  );
};

const SubTypeSelector: React.FC<{
  subTypes: HouseSubType[];
  currentId: number | null;
  onToggle: (subTypeId: number) => void;
  disabled?: boolean;
}> = ({ subTypes, currentId, onToggle, disabled }) => {
  if (subTypes.length === 0) {
    return null;
  }

  return (
    <div className="inline-flex flex-wrap bg-black/5 rounded-xl p-1 gap-1">
      {subTypes.map((subType) => {
        const active = currentId === subType.id;
        return (
          <button
            key={subType.id}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(subType.id);
            }}
            title={subType.name}
            className={`
              px-2 h-6 flex items-center justify-center text-[10px] font-semibold rounded-lg
              transition-all truncate max-w-[88px]
              ${
                active
                  ? 'bg-white text-[var(--accent)] shadow-sm border border-black/5'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-white/50'
              }
              ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
            `}
          >
            {subType.name}
          </button>
        );
      })}
    </div>
  );
};

// --- Main Component ---

const ProductionQueue: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [query, setQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<QueueItem | null>(null);
  const [detailData, setDetailData] = useState<ModuleStatusDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [houseTypes, setHouseTypes] = useState<HouseType[]>([]);
  const [houseSubTypes, setHouseSubTypes] = useState<Record<number, HouseSubType[]>>({});
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchDraft, setBatchDraft] = useState<BatchDraft>({
    project_name: '',
    house_identifier_base: '',
    house_type_id: '',
    sub_type_id: '',
    quantity: 1,
    planned_start_datetime: '',
  });
  const [editIds, setEditIds] = useState<number[]>([]);
  const [editStartValue, setEditStartValue] = useState('');
  const [editStartInitial, setEditStartInitial] = useState('');
  const [editStartCleared, setEditStartCleared] = useState(false);
  const [editSubTypeValue, setEditSubTypeValue] = useState('keep');
  const [editSubTypeInitial, setEditSubTypeInitial] = useState('keep');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [draggingIds, setDraggingIds] = useState<number[]>([]);
  const [dragTarget, setDragTarget] = useState<{
    id: number;
    position: 'before' | 'after';
  } | null>(null);

  useEffect(() => {
    setHeader({
      title: 'Cola de produccion',
      kicker: 'Planificacion / Produccion',
    });
  }, [setHeader]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );

  const selectedCount = selectedIds.size;
  const hasCompletedSelected = selectedItems.some((item) => item.status === 'Completed');

  const filteredItems = useMemo(() => {
    const needle = normalizeSearchValue(query.trim());
    return items.filter((item) => {
      if (!showCompleted && item.status === 'Completed') {
        return false;
      }
      if (!needle) {
        return true;
      }
      const haystack = normalizeSearchValue(
        [item.house_identifier, item.project_name, item.house_type_name, item.sub_type_name]
          .filter(Boolean)
          .join(' ')
      );
      return haystack.includes(needle);
    });
  }, [items, showCompleted, query]);

  const projectOptions = useMemo(() => {
    const unique = new Set(items.map((item) => item.project_name).filter(Boolean));
    return Array.from(unique).sort();
  }, [items]);

  const selectedHouseType = useMemo(
    () => houseTypes.find((house) => String(house.id) === batchDraft.house_type_id) || null,
    [houseTypes, batchDraft.house_type_id]
  );

  const editHouseTypeId = useMemo(() => {
    if (!editIds.length) {
      return null;
    }
    const itemsForEdit = items.filter((item) => editIds.includes(item.id));
    if (!itemsForEdit.length) {
      return null;
    }
    const first = itemsForEdit[0].house_type_id;
    return itemsForEdit.every((item) => item.house_type_id === first) ? first : null;
  }, [editIds, items]);

  const editSubTypes = useMemo(() => {
    if (!editHouseTypeId) {
      return [];
    }
    return houseSubTypes[editHouseTypeId] ?? [];
  }, [editHouseTypeId, houseSubTypes]);

  const loadQueue = useCallback(async (silent = false) => {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setErrorMessage(null);
      const data = await apiRequest<QueueItem[]>('/api/production-queue');
      const sorted = sortQueueItems(data);
      setItems(sorted);
      setSelectedIds((prev) => {
        const allowed = new Set(sorted.map((item) => item.id));
        return new Set([...prev].filter((id) => allowed.has(id)));
      });
      setLastUpdated(new Date());
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudo cargar la cola.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadQueue(false);
    const interval = window.setInterval(() => {
      loadQueue(true);
    }, 30000);
    return () => window.clearInterval(interval);
  }, [loadQueue]);

  useEffect(() => {
    if (items.length === 0) {
      return;
    }
    const uniqueHouseTypeIds = Array.from(new Set(items.map((item) => item.house_type_id)));
    uniqueHouseTypeIds.forEach((houseTypeId) => {
      if (houseSubTypes[houseTypeId]) {
        return;
      }
      const load = async () => {
        try {
          const data = await apiRequest<HouseSubType[]>(
            `/api/house-types/${houseTypeId}/subtypes`
          );
          setHouseSubTypes((prev) => ({ ...prev, [houseTypeId]: data }));
        } catch (error) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'No se pudieron cargar los subtipos de casa.'
          );
        }
      };
      load();
    });
  }, [items, houseSubTypes]);

  useEffect(() => {
    if (!isAddModalOpen) {
      return;
    }
    setBatchError(null);
    const load = async () => {
      try {
        const data = await apiRequest<HouseType[]>('/api/house-types');
        setHouseTypes(data);
      } catch (error) {
        setBatchError(
          error instanceof Error ? error.message : 'No se pudieron cargar los tipos de casa.'
        );
      }
    };
    load();
  }, [isAddModalOpen]);

  useEffect(() => {
    if (!isAddModalOpen) {
      return;
    }
    if (!batchDraft.project_name || batchDraft.house_identifier_base.trim()) {
      return;
    }
    const suggestion = suggestHouseIdentifierBase(batchDraft.project_name, items);
    if (!suggestion) {
      return;
    }
    setBatchDraft((prev) => ({
      ...prev,
      house_identifier_base: suggestion,
    }));
  }, [batchDraft.project_name, batchDraft.house_identifier_base, isAddModalOpen, items]);

  useEffect(() => {
    const houseTypeId = Number(batchDraft.house_type_id);
    if (!houseTypeId || houseSubTypes[houseTypeId]) {
      return;
    }
    const load = async () => {
      try {
        const data = await apiRequest<HouseSubType[]>(`/api/house-types/${houseTypeId}/subtypes`);
        setHouseSubTypes((prev) => ({ ...prev, [houseTypeId]: data }));
      } catch (error) {
        setBatchError(
          error instanceof Error
            ? error.message
            : 'No se pudieron cargar los subtipos de casa.'
        );
      }
    };
    load();
  }, [batchDraft.house_type_id, houseSubTypes]);

  useEffect(() => {
    if (!isEditModalOpen || !editHouseTypeId || houseSubTypes[editHouseTypeId]) {
      return;
    }
    const load = async () => {
      try {
        const data = await apiRequest<HouseSubType[]>(`/api/house-types/${editHouseTypeId}/subtypes`);
        setHouseSubTypes((prev) => ({ ...prev, [editHouseTypeId]: data }));
      } catch (error) {
        setEditError(
          error instanceof Error
            ? error.message
            : 'No se pudieron cargar los subtipos de casa.'
        );
      }
    };
    load();
  }, [editHouseTypeId, houseSubTypes, isEditModalOpen]);

  const visibleItems = filteredItems;

  const applySelection = (
    id: number,
    index: number,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    const isToggle = event.metaKey || event.ctrlKey;
    const isRange = event.shiftKey && lastSelectedIndex !== null;

    setSelectedIds((prev) => {
      if (isRange && lastSelectedIndex !== null) {
        const next = new Set(prev);
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        for (let i = start; i <= end; i += 1) {
          next.add(visibleItems[i].id);
        }
        return next;
      }
      const next = new Set(isToggle ? prev : []);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastSelectedIndex(index);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
  };

  const handleContainerClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-queue-row="true"]')) {
      return;
    }
    clearSelection();
  };

  const commitReorder = async (nextItems: QueueItem[]) => {
    const previousItems = items;
    setItems(nextItems);
    try {
      const updated = await apiRequest<QueueItem[]>('/api/production-queue/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ordered_ids: nextItems.map((item) => item.id) }),
      });
      const sorted = sortQueueItems(updated);
      setItems(sorted);
      setSelectedIds((prev) => {
        const allowed = new Set(sorted.map((item) => item.id));
        return new Set([...prev].filter((id) => allowed.has(id)));
      });
      setErrorMessage(null);
    } catch (error) {
      setItems(previousItems);
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudieron reordenar los elementos.'
      );
    }
  };

  const reorderActiveItems = (
    blockIds: number[],
    targetId: number,
    position: 'before' | 'after'
  ) => {
    const activeItems = items.filter((item) => item.status !== 'Completed');
    const completedItems = items.filter((item) => item.status === 'Completed');
    if (blockIds.includes(targetId)) {
      return;
    }
    const block = activeItems.filter((item) => blockIds.includes(item.id));
    const remaining = activeItems.filter((item) => !blockIds.includes(item.id));
    const targetIndex = remaining.findIndex((item) => item.id === targetId);
    if (targetIndex === -1 || block.length === 0) {
      return;
    }
    const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
    const nextActive = [
      ...remaining.slice(0, insertIndex),
      ...block,
      ...remaining.slice(insertIndex),
    ];
    const nextItems = [...nextActive, ...completedItems];
    commitReorder(nextItems);
  };

  const moveSelectionByOne = (direction: 'up' | 'down', anchorId: number) => {
    const activeItems = items.filter((item) => item.status !== 'Completed');
    const completedItems = items.filter((item) => item.status === 'Completed');
    const anchorItem = activeItems.find((item) => item.id === anchorId);
    if (!anchorItem) {
      return;
    }
    const selection = selectedIds.has(anchorId)
      ? activeItems.filter((item) => selectedIds.has(item.id))
      : [anchorItem];
    const blockIds = selection.map((item) => item.id);
    const indices = activeItems
      .map((item, index) => (blockIds.includes(item.id) ? index : -1))
      .filter((index) => index >= 0);
    const minIndex = Math.min(...indices);
    const maxIndex = Math.max(...indices);
    if (direction === 'up' && minIndex === 0) {
      return;
    }
    if (direction === 'down' && maxIndex === activeItems.length - 1) {
      return;
    }
    const remaining = activeItems.filter((item) => !blockIds.includes(item.id));
    const insertIndex = direction === 'up' ? minIndex - 1 : minIndex + 1;
    const nextActive = [
      ...remaining.slice(0, insertIndex),
      ...selection,
      ...remaining.slice(insertIndex),
    ];
    const nextItems = [...nextActive, ...completedItems];
    commitReorder(nextItems);
    if (!selectedIds.has(anchorId)) {
      setSelectedIds(new Set([anchorId]));
    }
  };

  const handleDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    item: QueueItem,
    index: number
  ) => {
    if (item.status === 'Completed') {
      event.preventDefault();
      return;
    }
    const nextIds = selectedIds.has(item.id) ? Array.from(selectedIds) : [item.id];
    if (!selectedIds.has(item.id)) {
      setSelectedIds(new Set([item.id]));
      setLastSelectedIndex(index);
    }
    setDraggingIds(nextIds);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    itemId: number
  ) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientY - bounds.top > bounds.height / 2 ? 'after' : 'before';
    setDragTarget({ id: itemId, position });
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (
    event: React.DragEvent<HTMLDivElement>,
    targetId: number
  ) => {
    event.preventDefault();
    if (!draggingIds.length) {
      setDragTarget(null);
      return;
    }
    const position = dragTarget?.position ?? 'before';
    reorderActiveItems(draggingIds, targetId, position);
    setDraggingIds([]);
    setDragTarget(null);
  };

  const handleDragEnd = () => {
    setDraggingIds([]);
    setDragTarget(null);
  };

  const openEditModal = (ids: number[]) => {
    const uniqueIds = Array.from(new Set(ids));
    setEditIds(uniqueIds);
    setEditError(null);
    setEditStartCleared(false);
    if (uniqueIds.length === 1) {
      const item = items.find((queue) => queue.id === uniqueIds[0]);
      const initialValue = toInputDateTime(item?.planned_start_datetime ?? null);
      setEditStartValue(initialValue);
      setEditStartInitial(initialValue);
      const subtypeValue = item?.sub_type_id ? String(item.sub_type_id) : 'none';
      setEditSubTypeValue(subtypeValue);
      setEditSubTypeInitial(subtypeValue);
    } else {
      setEditStartValue('');
      setEditStartInitial('');
      setEditSubTypeValue('keep');
      setEditSubTypeInitial('keep');
    }
    setIsEditModalOpen(true);
  };

  const handleEditSave = async () => {
    if (!editIds.length) {
      return;
    }
    const payload: Record<string, unknown> = {
      work_unit_ids: editIds,
    };
    if (editStartCleared) {
      payload.planned_start_datetime = null;
    } else if (editStartValue && editStartValue !== editStartInitial) {
      payload.planned_start_datetime = editStartValue;
    }
    if (editSubTypeValue !== editSubTypeInitial && editSubTypeValue !== 'keep') {
      payload.sub_type_id = editSubTypeValue === 'none' ? null : Number(editSubTypeValue);
    }
    if (Object.keys(payload).length === 1) {
      setIsEditModalOpen(false);
      return;
    }
    try {
      setEditSaving(true);
      setEditError(null);
      await apiRequest<QueueItem[]>('/api/production-queue/items', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setIsEditModalOpen(false);
      await loadQueue(true);
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : 'No se pudieron guardar los cambios.'
      );
    } finally {
      setEditSaving(false);
    }
  };

  const handleLineChange = async (line: LineId, anchorId: number) => {
    if (!line) {
      return;
    }
    const targetIds =
      selectedCount > 1 && selectedIds.has(anchorId)
        ? Array.from(selectedIds)
        : [anchorId];
    if (targetIds.some((id) => items.find((item) => item.id === id)?.status === 'Completed')) {
      setErrorMessage('Los elementos completados no pueden cambiar de linea.');
      return;
    }
    try {
      await apiRequest<QueueItem[]>('/api/production-queue/items', {
        method: 'PATCH',
        body: JSON.stringify({
          work_unit_ids: targetIds,
          planned_assembly_line: line,
        }),
      });
      setErrorMessage(null);
      await loadQueue(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudo actualizar la linea.'
      );
    }
  };

  const handleSubTypeToggle = async (subTypeId: number, anchorId: number) => {
    const targetIds =
      selectedCount > 1 && selectedIds.has(anchorId)
        ? Array.from(selectedIds)
        : [anchorId];
    const targetItems = items.filter((item) => targetIds.includes(item.id));
    if (!targetItems.length) {
      return;
    }
    const houseTypeId = targetItems[0].house_type_id;
    if (!targetItems.every((item) => item.house_type_id === houseTypeId)) {
      setErrorMessage(
        'Selecciona elementos con el mismo tipo de casa para cambiar el subtipo.'
      );
      return;
    }
    const shouldClear = targetItems.every((item) => item.sub_type_id === subTypeId);
    try {
      await apiRequest<QueueItem[]>('/api/production-queue/items', {
        method: 'PATCH',
        body: JSON.stringify({
          work_unit_ids: targetIds,
          sub_type_id: shouldClear ? null : subTypeId,
        }),
      });
      setErrorMessage(null);
      await loadQueue(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudo actualizar el subtipo.'
      );
    }
  };

  const handleComplete = async (targetIds: number[]) => {
    if (!targetIds.length) {
      return;
    }
    try {
      await apiRequest<QueueItem[]>('/api/production-queue/items', {
        method: 'PATCH',
        body: JSON.stringify({
          work_unit_ids: targetIds,
          status: 'Completed',
        }),
      });
      await loadQueue(true);
      clearSelection();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudo marcar como completado.'
      );
    }
  };

  const handleDelete = async () => {
    if (!selectedCount) {
      return;
    }
    const confirmation =
      selectedCount === 1
        ? 'Eliminar este elemento de la cola?'
        : `Eliminar ${selectedCount} elementos de la cola? Esto no se puede deshacer.`;
    if (!window.confirm(confirmation)) {
      return;
    }
    try {
      await apiRequest<void>('/api/production-queue/items/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ work_unit_ids: Array.from(selectedIds) }),
      });
      clearSelection();
      await loadQueue(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudieron eliminar los elementos.'
      );
    }
  };

  const handleBatchCreate = async () => {
    setBatchError(null);
    if (!batchDraft.project_name.trim() || !batchDraft.house_identifier_base.trim()) {
      setBatchError('El nombre del proyecto y la base del identificador son obligatorios.');
      return;
    }
    if (!batchDraft.house_type_id) {
      setBatchError('Selecciona un tipo de casa para continuar.');
      return;
    }
    if (batchDraft.quantity < 1) {
      setBatchError('La cantidad debe ser al menos 1.');
      return;
    }
    try {
      setBatchSaving(true);
      await apiRequest<QueueItem[]>('/api/production-queue/batches', {
        method: 'POST',
        body: JSON.stringify({
          project_name: batchDraft.project_name.trim(),
          house_identifier_base: batchDraft.house_identifier_base.trim(),
          house_type_id: Number(batchDraft.house_type_id),
          sub_type_id: batchDraft.sub_type_id ? Number(batchDraft.sub_type_id) : null,
          quantity: batchDraft.quantity,
          planned_start_datetime: batchDraft.planned_start_datetime || null,
        }),
      });
      setIsAddModalOpen(false);
      setBatchDraft({
        project_name: '',
        house_identifier_base: '',
        house_type_id: '',
        sub_type_id: '',
        quantity: 1,
        planned_start_datetime: '',
      });
      await loadQueue(true);
    } catch (error) {
      setBatchError(
        error instanceof Error ? error.message : 'No se pudo crear el lote.'
      );
    } finally {
      setBatchSaving(false);
    }
  };

  const openDetailModal = async (item: QueueItem) => {
    setDetailItem(item);
    setIsDetailModalOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setDetailData(null);
    try {
      const data = await apiRequest<ModuleStatusDetail>(
        `/api/production-queue/items/${item.id}/status`
      );
      setDetailData(data);
    } catch (error) {
      setDetailError(
        error instanceof Error
          ? error.message
          : 'No se pudo cargar el estado del modulo.'
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetailModal = () => {
    setIsDetailModalOpen(false);
    setDetailItem(null);
    setDetailData(null);
    setDetailError(null);
    setDetailLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" /> Agregar lote de produccion
        </button>
      </div>

      <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">Secuencia activa</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {items.filter((item) => item.status !== 'Completed').length} modulos activos
              </p>
              <p className="text-[11px] text-[var(--ink-muted)]">
                Ultima actualizacion {lastUpdated ? lastUpdated.toLocaleTimeString() : '-'}
              </p>
            </div>
            <div className="flex bg-black/5 rounded-full p-1 ml-4">
              <button
                onClick={() => setShowCompleted(false)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${
                  !showCompleted
                    ? 'bg-white text-[var(--ink)] shadow-sm'
                    : 'text-[var(--ink-muted)]'
                }`}
              >
                Activos
              </button>
              <button
                onClick={() => setShowCompleted(true)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${
                  showCompleted
                    ? 'bg-white text-[var(--ink)] shadow-sm'
                    : 'text-[var(--ink-muted)]'
                }`}
              >
                Todos
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
              <input
                type="search"
                placeholder="Buscar modulos..."
                className="h-9 rounded-full border border-black/10 bg-white pl-9 pr-4 text-sm focus:ring-2 focus:ring-[var(--accent)] outline-none transition-all w-64"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="h-6 w-px bg-black/10 mx-1" />
            <button
              onClick={() => loadQueue(true)}
              disabled={refreshing}
              className="p-2 text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-40 transition-colors"
              title="Actualizar"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              disabled={selectedCount === 0}
              onClick={handleDelete}
              className="p-2 text-[var(--ink-muted)] hover:text-red-500 disabled:opacity-30 transition-colors"
              title="Eliminar seleccionados"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        {selectedCount > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--accent)]/20 bg-[rgba(242,98,65,0.06)] px-4 py-3">
            <span className="text-xs font-semibold text-[var(--ink)]">
              {selectedCount} seleccionados
            </span>
            <button
              onClick={() => openEditModal(Array.from(selectedIds))}
              className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[var(--ink)] shadow-sm border border-black/10 hover:border-black/20"
            >
              Editar horario
            </button>
            <button
              onClick={() => handleComplete(Array.from(selectedIds))}
              className="rounded-full bg-[var(--leaf)]/10 px-3 py-1 text-xs font-semibold text-[var(--leaf)] border border-[var(--leaf)]/20 hover:bg-[var(--leaf)]/20"
            >
              Marcar completado
            </button>
            <button
              onClick={clearSelection}
              className="rounded-full px-3 py-1 text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              Limpiar
            </button>
            {hasCompletedSelected && (
              <span className="text-[11px] text-[var(--ink-muted)]">
                Los elementos completados no se pueden editar en la linea.
              </span>
            )}
          </div>
        )}

        <div className="space-y-3" onClick={handleContainerClick}>
          {loading && items.length === 0 && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-12 text-center text-sm text-[var(--ink-muted)]">
              Cargando cola de produccion...
            </div>
          )}

          {!loading && visibleItems.length === 0 && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-12 text-center text-sm text-[var(--ink-muted)]">
              No se encontraron modulos en la cola de produccion.
            </div>
          )}

          {visibleItems.map((item, index) => {
            const isSelected = selectedIds.has(item.id);
            const prevItem = index > 0 ? visibleItems[index - 1] : null;
            const isNewGroup = !prevItem || prevItem.project_name !== item.project_name;
            const subTypes = houseSubTypes[item.house_type_id] ?? [];
            const dragHighlight =
              dragTarget?.id === item.id
                ? dragTarget.position === 'before'
                  ? 'border-t-2 border-t-[var(--accent)]'
                  : 'border-b-2 border-b-[var(--accent)]'
                : '';

            return (
              <React.Fragment key={item.id}>
                {isNewGroup && (
                  <div className="pt-4 pb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-[var(--ink-muted)]">
                        Proyecto: {item.project_name}
                      </span>
                      <div className="h-px bg-black/5 flex-1" />
                    </div>
                  </div>
                )}

                <div
                  data-queue-row="true"
                  onClick={(event) => applySelection(item.id, index, event)}
                  onDragStart={(event) => handleDragStart(event, item, index)}
                  onDragOver={(event) => handleDragOver(event, item.id)}
                  onDrop={(event) => handleDrop(event, item.id)}
                  onDragEnd={handleDragEnd}
                  draggable={item.status !== 'Completed'}
                  className={`
                    group relative flex items-center p-4 rounded-2xl border transition-all animate-rise select-none cursor-pointer
                    ${
                      isSelected
                        ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.05)] shadow-sm'
                        : 'border-black/5 bg-white hover:border-black/10 hover:shadow-sm'
                    }
                    ${item.status === 'Completed' ? 'opacity-60' : ''}
                    ${dragHighlight}
                  `}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center mr-6 gap-3">
                    <GripVertical className="h-4 w-4 text-black/10 group-hover:text-black/30" />
                    <span className="text-xs font-mono font-bold text-black/20 w-8">
                      {item.planned_sequence}
                    </span>
                  </div>

                  <div className="flex-1 grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-3">
                      <p className="font-bold text-[var(--ink)]">{item.house_identifier}</p>
                      <p className="text-[11px] text-[var(--ink-muted)]">
                        Modulo: M-{String(item.module_number).padStart(2, '0')}
                      </p>
                    </div>

                    <div className="col-span-3 flex items-center gap-3 min-w-0">
                      <p className="text-sm font-medium text-[var(--ink)] truncate max-w-[160px]">
                        {item.house_type_name}
                      </p>
                      {subTypes.length > 0 ? (
                        <SubTypeSelector
                          subTypes={subTypes}
                          currentId={item.sub_type_id}
                          onToggle={(subTypeId) => handleSubTypeToggle(subTypeId, item.id)}
                        />
                      ) : (
                        item.sub_type_name && (
                          <p className="text-[11px] text-[var(--ink-muted)] truncate max-w-[120px]">
                            {item.sub_type_name}
                          </p>
                        )
                      )}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditModal([item.id]);
                        }}
                        className="flex items-center gap-1.5 text-left"
                        title={formatPlannedTime(item.planned_start_datetime)}
                      >
                        <Calendar className="h-3 w-3 text-black/20" />
                        <span className="text-[11px] text-[var(--ink-muted)]">
                          {formatPlannedDate(item.planned_start_datetime)}
                        </span>
                      </button>
                    </div>

                    <div className="col-span-3 flex justify-center">
                      <LineSelector
                        current={item.planned_assembly_line}
                        onChange={(line) => handleLineChange(line, item.id)}
                        disabled={item.status === 'Completed' || hasCompletedSelected}
                      />
                    </div>

                    <div className="col-span-3 flex items-center justify-end gap-3">
                      <StatusBadge status={item.status} />
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          openDetailModal(item);
                        }}
                        className="p-2 text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-black/5 rounded-xl transition-all"
                        title="Estado del modulo"
                        type="button"
                      >
                        <Info className="h-4 w-4" />
                      </button>

                      <div className="flex items-center gap-1 min-w-[110px] justify-end">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditModal(selectedIds.has(item.id) && selectedCount > 1 ? Array.from(selectedIds) : [item.id]);
                          }}
                          className="p-2 text-[var(--ink-muted)] hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                          title="Editar horario"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleComplete(
                              selectedIds.has(item.id) && selectedCount > 1
                                ? Array.from(selectedIds)
                                : [item.id]
                            );
                          }}
                          className="p-2 text-[var(--ink-muted)] hover:text-[var(--leaf)] hover:bg-green-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                          title="Marcar completado"
                        >
                          <CheckCircle className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            moveSelectionByOne('up', item.id);
                          }}
                          disabled={item.status === 'Completed'}
                          className="p-2 text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-black/5 rounded-xl transition-all opacity-0 group-hover:opacity-100 disabled:opacity-30"
                          title="Mover arriba"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            moveSelectionByOne('down', item.id);
                          }}
                          disabled={item.status === 'Completed'}
                          className="p-2 text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-black/5 rounded-xl transition-all opacity-0 group-hover:opacity-100 disabled:opacity-30"
                          title="Mover abajo"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </section>

      {isDetailModalOpen && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center backdrop-blur-[2px]">
          <div className="bg-white rounded-[2rem] shadow-2xl w-[720px] max-h-[80vh] overflow-hidden border border-black/5 animate-rise">
            <div className="px-8 py-6 flex justify-between items-start gap-6 border-b border-black/5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Estado del modulo
                </p>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-display text-[var(--ink)]">
                    {detailData
                      ? `${detailData.house_identifier} - M-${String(detailData.module_number).padStart(
                          2,
                          '0'
                        )}`
                      : detailItem
                      ? `${detailItem.house_identifier} - M-${String(detailItem.module_number).padStart(
                          2,
                          '0'
                        )}`
                      : 'Detalles del modulo'}
                  </h2>
                  {detailData && <StatusBadge status={detailData.status} />}
                  {!detailData && detailItem && <StatusBadge status={detailItem.status} />}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                  <span>
                    {detailData?.project_name ?? detailItem?.project_name ?? '-'}
                  </span>
                  <span>-</span>
                  <span>
                    {detailData?.house_type_name ?? detailItem?.house_type_name ?? '-'}
                  </span>
                  {(detailData?.sub_type_name ?? detailItem?.sub_type_name) && (
                    <>
                      <span>-</span>
                      <span>
                        {detailData?.sub_type_name ?? detailItem?.sub_type_name}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={closeDetailModal}
                className="p-2 hover:bg-black/5 rounded-full transition-colors text-[var(--ink-muted)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-8 py-6 space-y-4 overflow-y-auto max-h-[calc(80vh-140px)]">
              {detailLoading && (
                <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                  Cargando estado del modulo...
                </div>
              )}

              {detailError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {detailError}
                </div>
              )}

              {detailData && !detailLoading && !detailError && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ink-muted)]">
                    <span>
                      Linea {detailData.planned_assembly_line ?? '-'}
                    </span>
                    <span>-</span>
                    <span>
                      Estacion actual {detailData.current_station_name ?? '-'}
                    </span>
                  </div>

                  {detailData.panels.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                      No hay paneles definidos para este modulo.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {detailData.panels.map((panel) => (
                        <div
                          key={panel.panel_definition_id}
                          className="rounded-2xl border border-black/5 bg-white/80 p-4"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="font-semibold text-[var(--ink)]">
                                {panel.panel_code ?? `Panel ${panel.panel_definition_id}`}
                              </p>
                              <p className="text-xs text-[var(--ink-muted)]">
                                Estacion {panel.current_station_name ?? '-'}
                              </p>
                            </div>
                            <span
                              className={`px-2 py-1 rounded-full text-[10px] uppercase tracking-wider font-bold border ${
                                panelStatusStyles[panel.status]
                              }`}
                            >
                              {formatStatusLabel(panel.status)}
                            </span>
                          </div>

                          <div className="mt-3">
                            {panel.pending_tasks.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {panel.pending_tasks.map((task) => (
                                  <span
                                    key={task.task_definition_id}
                                    className={`px-2 py-1 rounded-full text-[10px] font-semibold border ${
                                      taskStatusStyles[task.status]
                                    }`}
                                  >
                                    {task.name} - {formatStatusLabel(task.status)}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-[var(--ink-muted)]">
                                {panel.status === 'Completed' || panel.status === 'Consumed'
                                  ? 'Panel completado.'
                                  : panel.current_station_name
                                  ? 'No hay tareas pendientes en esta estacion.'
                                  : 'Aun no esta en una estacion.'}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center backdrop-blur-[2px]">
          <div className="bg-white rounded-[2rem] shadow-2xl w-[480px] overflow-hidden border border-black/5 animate-rise">
            <div className="px-8 py-6 flex justify-between items-center">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Workflow</p>
                <h2 className="text-xl font-display text-[var(--ink)]">Nuevo lote de produccion</h2>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-2 hover:bg-black/5 rounded-full transition-colors text-[var(--ink-muted)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-8 pb-8 space-y-5">
              {batchError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {batchError}
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--ink-muted)] ml-1">Proyecto</label>
                <input
                  list="project-options"
                  value={batchDraft.project_name}
                  onChange={(event) =>
                    setBatchDraft((prev) => ({ ...prev, project_name: event.target.value }))
                  }
                  placeholder="Ingresa el nombre del proyecto"
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                />
                <datalist id="project-options">
                  {projectOptions.map((name) => (
                    <option value={name} key={name} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--ink-muted)] ml-1">
                  Base del identificador de casa
                </label>
                <input
                  value={batchDraft.house_identifier_base}
                  onChange={(event) =>
                    setBatchDraft((prev) => ({
                      ...prev,
                      house_identifier_base: event.target.value,
                    }))
                  }
                  placeholder="SV-01"
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[var(--ink-muted)] ml-1">Tipo de casa</label>
                  <select
                    value={batchDraft.house_type_id}
                    onChange={(event) =>
                      setBatchDraft((prev) => ({
                        ...prev,
                        house_type_id: event.target.value,
                        sub_type_id: '',
                      }))
                    }
                    className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                  >
                    <option value="">Selecciona tipo</option>
                    {houseTypes.map((house) => (
                      <option key={house.id} value={house.id}>
                        {house.name} - {house.number_of_modules} modulos
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[var(--ink-muted)] ml-1">Cantidad</label>
                  <input
                    type="number"
                    min={1}
                    value={batchDraft.quantity}
                    onChange={(event) =>
                      setBatchDraft((prev) => ({
                        ...prev,
                        quantity: Number(event.target.value),
                      }))
                    }
                    className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                  />
                </div>
              </div>
              {selectedHouseType && (
                <p className="text-[11px] text-[var(--ink-muted)]">
                  {selectedHouseType.number_of_modules} modulos por casa -{' '}
                  {selectedHouseType.number_of_modules * batchDraft.quantity} modulos total
                </p>
              )}

              {selectedHouseType && (houseSubTypes[selectedHouseType.id]?.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[var(--ink-muted)] ml-1">Subtipo de casa</label>
                  <select
                    value={batchDraft.sub_type_id}
                    onChange={(event) =>
                      setBatchDraft((prev) => ({
                        ...prev,
                        sub_type_id: event.target.value,
                      }))
                    }
                    className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                  >
                    <option value="">Ninguno</option>
                    {(houseSubTypes[selectedHouseType.id] || []).map((subtype) => (
                      <option key={subtype.id} value={subtype.id}>
                        {subtype.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--ink-muted)] ml-1">
                  Fecha/hora de inicio
                </label>
                <input
                  type="datetime-local"
                  value={batchDraft.planned_start_datetime}
                  onChange={(event) =>
                    setBatchDraft((prev) => ({
                      ...prev,
                      planned_start_datetime: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 rounded-full border border-black/10 px-4 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-black/5 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleBatchCreate}
                  disabled={batchSaving}
                  className="flex-1 rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  {batchSaving ? 'Creando...' : 'Crear lote'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isEditModalOpen && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center backdrop-blur-[2px]">
          <div className="bg-white rounded-[2rem] shadow-2xl w-[480px] overflow-hidden border border-black/5 animate-rise">
            <div className="px-8 py-6 flex justify-between items-center">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Horario
                </p>
                <h2 className="text-xl font-display text-[var(--ink)]">
                  Editar elementos de la cola
                </h2>
                <p className="text-xs text-[var(--ink-muted)] mt-1">
                  {editIds.length} seleccionados
                </p>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-2 hover:bg-black/5 rounded-full transition-colors text-[var(--ink-muted)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-8 pb-8 space-y-5">
              {editError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {editError}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--ink-muted)] ml-1">
                  Inicio planificado
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="datetime-local"
                    value={editStartValue}
                    onChange={(event) => {
                      setEditStartCleared(false);
                      setEditStartValue(event.target.value);
                    }}
                    className="flex-1 rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setEditStartCleared(true);
                      setEditStartValue('');
                    }}
                    className="rounded-full border border-black/10 px-3 py-2 text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  >
                    Limpiar
                  </button>
                </div>
                {editIds.length > 1 && (
                  <p className="text-[11px] text-[var(--ink-muted)]">
                    Deja vacio para mantener los valores actuales.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--ink-muted)] ml-1">
                  Subtipo de casa
                </label>
                <select
                  value={editSubTypeValue}
                  onChange={(event) => setEditSubTypeValue(event.target.value)}
                  disabled={!editHouseTypeId}
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20 disabled:bg-black/5"
                >
                  {editIds.length > 1 && <option value="keep">Mantener actual</option>}
                  <option value="none">Ninguno</option>
                  {editSubTypes.map((subtype) => (
                    <option key={subtype.id} value={subtype.id}>
                      {subtype.name}
                    </option>
                  ))}
                </select>
                {!editHouseTypeId && (
                  <p className="text-[11px] text-[var(--ink-muted)]">
                    Selecciona elementos con el mismo tipo de casa para cambiar el subtipo.
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 rounded-full border border-black/10 px-4 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-black/5 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleEditSave}
                  disabled={editSaving}
                  className="flex-1 rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  {editSaving ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionQueue;
