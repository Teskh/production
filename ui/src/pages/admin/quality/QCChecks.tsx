import React, { useEffect, useMemo, useState } from 'react';
import { Filter, Image, Pencil, Plus, Search, Settings2, Trash2, X } from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayout';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type QCCheckKind = 'triggered' | 'manual_template';
type QCTriggerEventType = 'task_completed';
type QCSeverityLevelKey = 'baja' | 'media' | 'critica';
type QCCheckMediaType = 'guidance' | 'reference';

type QCCheckDefinition = {
  id: number;
  name: string;
  active: boolean;
  guidance_text: string | null;
  version: number;
  kind: QCCheckKind;
  category_id: number | null;
  archived_at?: string | null;
};

type QCCheckCategory = {
  id: number;
  name: string;
  parent_id: number | null;
  active: boolean;
  sort_order: number | null;
};

type QCFailureMode = {
  id: number;
  check_definition_id: number | null;
  name: string;
  description: string | null;
  default_severity_level: QCSeverityLevelKey | null;
  default_rework_description: string | null;
};

type QCCheckMediaAsset = {
  id: number;
  check_definition_id: number;
  media_type: QCCheckMediaType;
  uri: string;
  created_at: string | null;
};

type QCTrigger = {
  id: number;
  check_definition_id: number;
  event_type: QCTriggerEventType;
  params_json: Record<string, number[]> | null;
  sampling_rate: number;
  sampling_autotune: boolean;
  sampling_step: number;
};

type QCApplicability = {
  id: number;
  check_definition_id: number;
  house_type_id: number | null;
  sub_type_id: number | null;
  module_number: number | null;
  panel_definition_id: number | null;
  force_required: boolean;
  effective_from: string | null;
  effective_to: string | null;
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

type PanelDefinition = {
  id: number;
  house_type_id: number;
  module_sequence_number: number;
  sub_type_id: number | null;
  group: string;
  panel_code: string;
};

type TaskDefinition = {
  id: number;
  name: string;
  scope: 'panel' | 'module' | 'aux';
  default_station_sequence: number | null;
  active: boolean;
};

type Station = {
  id: number;
  name: string;
  role: 'Panels' | 'Magazine' | 'Assembly' | 'AUX';
  line_type: '1' | '2' | '3' | null;
  sequence_order: number | null;
};

type CheckDraft = {
  id?: number;
  name: string;
  active: boolean;
  guidance_text: string;
  version: number;
  kind: QCCheckKind;
  category_id: number | null;
};

type CategoryDraft = {
  id?: number;
  name: string;
  parent_id: number | null;
  active: boolean;
  sort_order: string;
};

type FailureModeDraft = {
  id?: number;
  check_definition_id: number | null;
  name: string;
  description: string;
  default_severity_level: QCSeverityLevelKey | null;
  default_rework_description: string;
};

type TriggerDraft = {
  id?: number;
  event_type: QCTriggerEventType;
  sampling_rate: string;
  sampling_step: string;
  sampling_autotune: boolean;
  task_definition_ids: number[];
};

type ApplicabilityDraft = {
  id?: number;
  house_type_id: number | null;
  sub_type_id: number | null;
  module_number: string;
  panel_definition_id: number | null;
  force_required: boolean;
  effective_from: string;
  effective_to: string;
};

const emptyCheckDraft = (): CheckDraft => ({
  name: '',
  active: true,
  guidance_text: '',
  version: 1,
  kind: 'triggered',
  category_id: null,
});

const emptyCategoryDraft = (): CategoryDraft => ({
  name: '',
  parent_id: null,
  active: true,
  sort_order: '',
});

const emptyFailureModeDraft = (checkDefinitionId: number | null): FailureModeDraft => ({
  check_definition_id: checkDefinitionId,
  name: '',
  description: '',
  default_severity_level: null,
  default_rework_description: '',
});

const severityOptions: Array<{ value: QCSeverityLevelKey; label: string }> = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'critica', label: 'Crítica' },
];

const emptyTriggerDraft = (): TriggerDraft => ({
  event_type: 'task_completed',
  sampling_rate: '1',
  sampling_step: '0.2',
  sampling_autotune: false,
  task_definition_ids: [],
});

const emptyApplicabilityDraft = (): ApplicabilityDraft => ({
  house_type_id: null,
  sub_type_id: null,
  module_number: '',
  panel_definition_id: null,
  force_required: false,
  effective_from: '',
  effective_to: '',
});

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

const normalizeSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const normalizeStationName = (station: Station) => {
  const trimmed = station.name.trim();
  if (!station.line_type) {
    return trimmed;
  }
  const pattern = new RegExp(`^(Linea|Line)\\s*${station.line_type}\\s*-\\s*`, 'i');
  const normalized = trimmed.replace(pattern, '').trim();
  return normalized || trimmed;
};

const sortByName = <T extends { name: string }>(list: T[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

const sortByOrderThenName = <T extends { name: string; sort_order: number | null }>(
  list: T[]
) =>
  [...list].sort((a, b) => {
    const orderCompare = (a.sort_order ?? 9999) - (b.sort_order ?? 9999);
    if (orderCompare !== 0) {
      return orderCompare;
    }
    return a.name.localeCompare(b.name);
  });

const QCChecks: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [checks, setChecks] = useState<QCCheckDefinition[]>([]);
  const [categories, setCategories] = useState<QCCheckCategory[]>([]);
  const [failureModes, setFailureModes] = useState<QCFailureMode[]>([]);
  const [checkMedia, setCheckMedia] = useState<QCCheckMediaAsset[]>([]);
  const [triggers, setTriggers] = useState<QCTrigger[]>([]);
  const [applicability, setApplicability] = useState<QCApplicability[]>([]);
  const [tasks, setTasks] = useState<TaskDefinition[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [houseTypes, setHouseTypes] = useState<HouseType[]>([]);
  const [houseSubTypes, setHouseSubTypes] = useState<HouseSubType[]>([]);
  const [panelDefinitions, setPanelDefinitions] = useState<PanelDefinition[]>([]);
  const [selectedCheckId, setSelectedCheckId] = useState<number | null>(null);
  const [checkDraft, setCheckDraft] = useState<CheckDraft>(emptyCheckDraft());
  const [selectedTab, setSelectedTab] = useState<
    'definition' | 'failure_modes' | 'triggers' | 'references' | 'applicability'
  >('definition');
  const [checkSearch, setCheckSearch] = useState('');
  const [checkStatus, setCheckStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>(emptyCategoryDraft());
  const [categoryStatus, setCategoryStatus] = useState<string | null>(null);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);

  const [selectedFailureId, setSelectedFailureId] = useState<number | null>(null);
  const [isFailureModeDraftNew, setIsFailureModeDraftNew] = useState(false);
  const [failureDraft, setFailureDraft] = useState<FailureModeDraft>(
    emptyFailureModeDraft(null)
  );
  const [failureStatus, setFailureStatus] = useState<string | null>(null);

  const [selectedTriggerId, setSelectedTriggerId] = useState<number | null>(null);
  const [triggerDraft, setTriggerDraft] = useState<TriggerDraft>(emptyTriggerDraft());
  const [triggerStatus, setTriggerStatus] = useState<string | null>(null);
  const [triggerSearch, setTriggerSearch] = useState('');

  const [mediaStatus, setMediaStatus] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const [selectedApplicabilityId, setSelectedApplicabilityId] = useState<number | null>(null);
  const [applicabilityDraft, setApplicabilityDraft] = useState<ApplicabilityDraft>(
    emptyApplicabilityDraft()
  );
  const [applicabilityStatus, setApplicabilityStatus] = useState<string | null>(null);

  useEffect(() => {
    setHeader({
      title: 'Definicion de revisiones QC',
      kicker: 'Calidad / Revisiones QC',
    });
  }, [setHeader]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const [
          checkData,
          categoryData,
          failureData,
          checkMediaData,
          triggerData,
          applicabilityData,
          taskData,
          stationData,
          houseTypeData,
          panelData,
        ] = await Promise.all([
          apiRequest<QCCheckDefinition[]>('/api/qc/check-definitions'),
          apiRequest<QCCheckCategory[]>('/api/qc/categories'),
          apiRequest<QCFailureMode[]>('/api/qc/failure-modes'),
          apiRequest<QCCheckMediaAsset[]>('/api/qc/check-media'),
          apiRequest<QCTrigger[]>('/api/qc/triggers'),
          apiRequest<QCApplicability[]>('/api/qc/applicability'),
          apiRequest<TaskDefinition[]>('/api/task-definitions'),
          apiRequest<Station[]>('/api/stations'),
          apiRequest<HouseType[]>('/api/house-types'),
          apiRequest<PanelDefinition[]>('/api/panel-definitions'),
        ]);
        const subtypeResponses = await Promise.all(
          houseTypeData.map((house) =>
            apiRequest<HouseSubType[]>(`/api/house-types/${house.id}/subtypes`)
          )
        );
        if (!active) {
          return;
        }
        const sortedChecks = sortByName(checkData);
        setChecks(sortedChecks);
        setCategories(sortByOrderThenName(categoryData));
        setFailureModes(sortByName(failureData));
        setCheckMedia(checkMediaData);
        setTriggers(triggerData);
        setApplicability(applicabilityData);
        setTasks(sortByName(taskData));
        setStations(stationData);
        setHouseTypes(sortByName(houseTypeData));
        setHouseSubTypes(subtypeResponses.flat());
        setPanelDefinitions(panelData);
        setSelectedCheckId(sortedChecks[0]?.id ?? null);
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error
              ? error.message
              : 'No se pudo cargar la configuracion de QC.';
          setCheckStatus(message);
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

  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories]
  );
  const houseTypeNameById = useMemo(
    () => new Map(houseTypes.map((house) => [house.id, house.name])),
    [houseTypes]
  );
  const houseSubTypeNameById = useMemo(
    () => new Map(houseSubTypes.map((sub) => [sub.id, sub.name])),
    [houseSubTypes]
  );

  const filteredChecks = useMemo(() => {
    const query = normalizeSearch(checkSearch.trim());
    if (!query) {
      return checks;
    }
    return checks.filter((check) => {
      const categoryName = check.category_id
        ? categoryNameById.get(check.category_id) ?? ''
        : '';
      const haystack = normalizeSearch(`${check.name} ${check.kind} ${categoryName}`);
      return haystack.includes(query);
    });
  }, [checkSearch, checks, categoryNameById]);

  const checksByCategoryId = useMemo(() => {
    const map = new Map<number, QCCheckDefinition[]>();
    filteredChecks.forEach((check) => {
      if (check.category_id == null) {
        return;
      }
      const list = map.get(check.category_id) ?? [];
      list.push(check);
      map.set(check.category_id, list);
    });
    return map;
  }, [filteredChecks]);

  const checksWithoutCategory = useMemo(
    () => filteredChecks.filter((check) => check.category_id == null),
    [filteredChecks]
  );

  const categoryChildren = useMemo(() => {
    const map = new Map<number | null, QCCheckCategory[]>();
    categories.forEach((category) => {
      const parent = category.parent_id ?? null;
      const list = map.get(parent) ?? [];
      list.push(category);
      map.set(parent, list);
    });
    return map;
  }, [categories]);

  const checkMediaForSelected = useMemo(() => {
    if (!selectedCheckId) {
      return [];
    }
    return checkMedia.filter((media) => media.check_definition_id === selectedCheckId);
  }, [checkMedia, selectedCheckId]);

  const guidanceMedia = useMemo(
    () => checkMediaForSelected.filter((media) => media.media_type === 'guidance'),
    [checkMediaForSelected]
  );

  const referenceMedia = useMemo(
    () => checkMediaForSelected.filter((media) => media.media_type === 'reference'),
    [checkMediaForSelected]
  );

  const selectedCheck = useMemo(
    () => checks.find((check) => check.id === selectedCheckId) ?? null,
    [checks, selectedCheckId]
  );

  const filteredFailureModes = useMemo(() => {
    if (selectedCheckId === null) {
      return [];
    }
    return failureModes.filter((mode) => mode.check_definition_id === selectedCheckId);
  }, [failureModes, selectedCheckId]);

  const filteredTriggers = useMemo(
    () =>
      triggers.filter((trigger) =>
        selectedCheckId ? trigger.check_definition_id === selectedCheckId : false
      ),
    [triggers, selectedCheckId]
  );

  const filteredApplicability = useMemo(
    () =>
      applicability.filter((rule) =>
        selectedCheckId ? rule.check_definition_id === selectedCheckId : false
      ),
    [applicability, selectedCheckId]
  );

  useEffect(() => {
    if (!categories.length) {
      setSelectedCategoryId(null);
      setCategoryDraft(emptyCategoryDraft());
      return;
    }
    if (selectedCategoryId && categories.some((category) => category.id === selectedCategoryId)) {
      return;
    }
    const first = categories[0];
    setSelectedCategoryId(first.id);
    setCategoryDraft({
      id: first.id,
      name: first.name,
      parent_id: first.parent_id,
      active: first.active,
      sort_order: first.sort_order !== null ? String(first.sort_order) : '',
    });
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    if (!selectedCheck) {
      setCheckDraft(emptyCheckDraft());
      setFailureDraft(emptyFailureModeDraft(null));
      setSelectedFailureId(null);
      setIsFailureModeDraftNew(false);
      setMediaStatus(null);
      return;
    }
    setCheckDraft({
      id: selectedCheck.id,
      name: selectedCheck.name,
      active: selectedCheck.active,
      guidance_text: selectedCheck.guidance_text ?? '',
      version: selectedCheck.version,
      kind: selectedCheck.kind,
      category_id: selectedCheck.category_id ?? null,
    });
    setFailureDraft(emptyFailureModeDraft(selectedCheck.id));
    setSelectedFailureId(null);
    setIsFailureModeDraftNew(false);
    setSelectedTriggerId(null);
    setTriggerDraft(emptyTriggerDraft());
    setSelectedApplicabilityId(null);
    setApplicabilityDraft(emptyApplicabilityDraft());
    setMediaStatus(null);
  }, [selectedCheck]);

  useEffect(() => {
    if (isFailureModeDraftNew) {
      return;
    }
    if (!filteredFailureModes.length) {
      setSelectedFailureId(null);
      setFailureDraft(emptyFailureModeDraft(selectedCheckId));
      return;
    }
    if (selectedFailureId && filteredFailureModes.some((mode) => mode.id === selectedFailureId)) {
      return;
    }
    const first = filteredFailureModes[0];
    setSelectedFailureId(first.id);
    setFailureDraft({
      id: first.id,
      check_definition_id: first.check_definition_id,
      name: first.name,
      description: first.description ?? '',
      default_severity_level: first.default_severity_level,
      default_rework_description: first.default_rework_description ?? '',
    });
  }, [filteredFailureModes, isFailureModeDraftNew, selectedFailureId, selectedCheckId]);

  const summaryLabel = useMemo(() => {
    const activeCount = checks.filter((check) => check.active).length;
    return `${checks.length} revisiones / ${activeCount} activas`;
  }, [checks]);

  const updateCheckDraft = (patch: Partial<CheckDraft>) => {
    setCheckDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleAddCheck = () => {
    setSelectedCheckId(null);
    setCheckDraft(emptyCheckDraft());
    setSelectedTab('definition');
    setCheckStatus(null);
  };

  const handleSaveCheck = async () => {
    const name = checkDraft.name.trim();
    if (!name) {
      setCheckStatus('Se requiere el nombre de la revision.');
      return;
    }
    if (!Number.isInteger(checkDraft.version) || checkDraft.version < 1) {
      setCheckStatus('La version debe ser un numero entero positivo.');
      return;
    }
    setSaving(true);
    setCheckStatus(null);
    try {
      const payload = {
        name,
        active: checkDraft.active,
        guidance_text: checkDraft.guidance_text.trim() || null,
        version: checkDraft.version,
        kind: checkDraft.kind,
        category_id: checkDraft.category_id,
      };
      let saved: QCCheckDefinition;
      if (checkDraft.id) {
        saved = await apiRequest<QCCheckDefinition>(
          `/api/qc/check-definitions/${checkDraft.id}`,
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          }
        );
        setChecks((prev) => sortByName(prev.map((check) => (check.id === saved.id ? saved : check))));
      } else {
        saved = await apiRequest<QCCheckDefinition>('/api/qc/check-definitions', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setChecks((prev) => sortByName([...prev, saved]));
      }
      setSelectedCheckId(saved.id);
      setCheckStatus('Revision guardada.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar la revision.';
      setCheckStatus(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCheck = async () => {
    if (!checkDraft.id) {
      return;
    }
    setSaving(true);
    setCheckStatus(null);
    try {
      await apiRequest<void>(`/api/qc/check-definitions/${checkDraft.id}`, {
        method: 'DELETE',
      });
      setChecks((prev) => {
        const updated = prev.filter((check) => check.id !== checkDraft.id);
        const next = updated[0] ?? null;
        if (next) {
          setSelectedCheckId(next.id);
        } else {
          setSelectedCheckId(null);
          setCheckDraft(emptyCheckDraft());
        }
        return updated;
      });
      setTriggers((prev) => prev.filter((trigger) => trigger.check_definition_id !== checkDraft.id));
      setApplicability((prev) =>
        prev.filter((rule) => rule.check_definition_id !== checkDraft.id)
      );
      setFailureModes((prev) =>
        prev.filter((mode) => mode.check_definition_id !== checkDraft.id)
      );
      setCheckStatus('Revision eliminada.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo eliminar la revision.';
      setCheckStatus(message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCategory = async () => {
    const name = categoryDraft.name.trim();
    if (!name) {
      setCategoryStatus('Se requiere el nombre de la categoria.');
      return;
    }
    const rawSortOrder = categoryDraft.sort_order.trim();
    const sortOrder = rawSortOrder ? Number(rawSortOrder) : null;
    if (rawSortOrder && !Number.isInteger(Number(rawSortOrder))) {
      setCategoryStatus('El orden debe ser un numero entero.');
      return;
    }
    setCategoryStatus(null);
    try {
      const payload = {
        name,
        parent_id: categoryDraft.parent_id,
        active: categoryDraft.active,
        sort_order: sortOrder,
      };
      let saved: QCCheckCategory;
      if (categoryDraft.id) {
        saved = await apiRequest<QCCheckCategory>(`/api/qc/categories/${categoryDraft.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setCategories((prev) =>
          sortByOrderThenName(prev.map((category) => (category.id === saved.id ? saved : category)))
        );
      } else {
        saved = await apiRequest<QCCheckCategory>('/api/qc/categories', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setCategories((prev) => sortByOrderThenName([...prev, saved]));
      }
      setSelectedCategoryId(saved.id);
      setCategoryDraft({
        id: saved.id,
        name: saved.name,
        parent_id: saved.parent_id,
        active: saved.active,
        sort_order: saved.sort_order !== null ? String(saved.sort_order) : '',
      });
      setCategoryStatus(null);
      setIsCategoryModalOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar la categoria.';
      setCategoryStatus(message);
    }
  };

  const handleDeleteCategory = async () => {
    if (!categoryDraft.id) {
      return;
    }
    setCategoryStatus(null);
    try {
      await apiRequest<void>(`/api/qc/categories/${categoryDraft.id}`, { method: 'DELETE' });
      setCategories((prev) => prev.filter((category) => category.id !== categoryDraft.id));
      setSelectedCategoryId(null);
      setCategoryDraft(emptyCategoryDraft());
      setCategoryStatus(null);
      setIsCategoryModalOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo eliminar la categoria.';
      setCategoryStatus(message);
    }
  };

  const handleSaveFailureMode = async () => {
    const name = failureDraft.name.trim();
    if (!name) {
      setFailureStatus('Se requiere el nombre del modo de falla.');
      return;
    }
    const checkDefinitionId = failureDraft.check_definition_id ?? selectedCheckId;
    if (!checkDefinitionId) {
      setFailureStatus('Seleccione una revision antes de guardar el modo de falla.');
      return;
    }
    setFailureStatus(null);
    try {
      const payload = {
        check_definition_id: checkDefinitionId,
        name,
        description: failureDraft.description.trim() || null,
        default_severity_level: failureDraft.default_severity_level,
        default_rework_description: failureDraft.default_rework_description.trim() || null,
      };
      let saved: QCFailureMode;
      if (failureDraft.id) {
        saved = await apiRequest<QCFailureMode>(`/api/qc/failure-modes/${failureDraft.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setFailureModes((prev) =>
          sortByName(prev.map((mode) => (mode.id === saved.id ? saved : mode)))
        );
      } else {
        saved = await apiRequest<QCFailureMode>('/api/qc/failure-modes', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setFailureModes((prev) => sortByName([...prev, saved]));
      }
      setSelectedFailureId(saved.id);
      setIsFailureModeDraftNew(false);
      setFailureDraft({
        id: saved.id,
        check_definition_id: saved.check_definition_id,
        name: saved.name,
        description: saved.description ?? '',
        default_severity_level: saved.default_severity_level,
        default_rework_description: saved.default_rework_description ?? '',
      });
      setFailureStatus('Modo de falla guardado.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar el modo de falla.';
      setFailureStatus(message);
    }
  };

  const handleDeleteFailureMode = async () => {
    if (!failureDraft.id) {
      return;
    }
    setFailureStatus(null);
    try {
      await apiRequest<void>(`/api/qc/failure-modes/${failureDraft.id}`, { method: 'DELETE' });
      setFailureModes((prev) => prev.filter((mode) => mode.id !== failureDraft.id));
      setSelectedFailureId(null);
      setFailureDraft(emptyFailureModeDraft(selectedCheckId));
      setFailureStatus('Modo de falla eliminado.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo eliminar el modo de falla.';
      setFailureStatus(message);
    }
  };

  const uploadCheckMedia = async (files: File[], mediaType: QCCheckMediaType) => {
    if (!selectedCheckId) {
      setMediaStatus('Seleccione una revision antes de cargar imagenes.');
      return;
    }
    if (!files.length) {
      return;
    }
    setUploadingMedia(true);
    setMediaStatus(null);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('check_definition_id', String(selectedCheckId));
        formData.append('media_type', mediaType);
        const response = await fetch(`${API_BASE_URL}/api/qc/check-media`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || 'No se pudo guardar la imagen.');
        }
        const saved = (await response.json()) as QCCheckMediaAsset;
        setCheckMedia((prev) => [...prev, saved]);
      }
      setMediaStatus('Imagen guardada.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar la imagen.';
      setMediaStatus(message);
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleMediaInput = (
    event: React.ChangeEvent<HTMLInputElement>,
    mediaType: QCCheckMediaType
  ) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    void uploadCheckMedia(files, mediaType);
  };

  const handleMediaDrop = (
    event: React.DragEvent<HTMLDivElement>,
    mediaType: QCCheckMediaType
  ) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      file.type.startsWith('image/')
    );
    void uploadCheckMedia(files, mediaType);
  };

  const handleDeleteCheckMedia = async (mediaId: number) => {
    setMediaStatus(null);
    try {
      await apiRequest<void>(`/api/qc/check-media/${mediaId}`, { method: 'DELETE' });
      setCheckMedia((prev) => prev.filter((media) => media.id !== mediaId));
      setMediaStatus('Imagen eliminada.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo eliminar la imagen.';
      setMediaStatus(message);
    }
  };

  const handleSaveTrigger = async () => {
    if (!selectedCheckId) {
      setTriggerStatus('Seleccione una revision antes de crear un gatillante.');
      return;
    }
    const samplingRate = Number(triggerDraft.sampling_rate);
    const samplingStep = Number(triggerDraft.sampling_step);
    if (Number.isNaN(samplingRate) || samplingRate < 0 || samplingRate > 1) {
      setTriggerStatus('La tasa debe estar entre 0 y 1.');
      return;
    }
    if (Number.isNaN(samplingStep) || samplingStep < 0 || samplingStep > 1) {
      setTriggerStatus('El paso de ajuste debe estar entre 0 y 1.');
      return;
    }
    setTriggerStatus(null);
    try {
      const paramsJson = { task_definition_ids: triggerDraft.task_definition_ids };
      const payload = {
        check_definition_id: selectedCheckId,
        event_type: triggerDraft.event_type,
        params_json: paramsJson,
        sampling_rate: samplingRate,
        sampling_autotune: triggerDraft.sampling_autotune,
        sampling_step: samplingStep,
      };
      let saved: QCTrigger;
      if (triggerDraft.id) {
        saved = await apiRequest<QCTrigger>(`/api/qc/triggers/${triggerDraft.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setTriggers((prev) => prev.map((trigger) => (trigger.id === saved.id ? saved : trigger)));
      } else {
        saved = await apiRequest<QCTrigger>('/api/qc/triggers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setTriggers((prev) => [...prev, saved]);
      }
      setSelectedTriggerId(saved.id);
      setTriggerDraft({
        id: saved.id,
        event_type: saved.event_type,
        sampling_rate: String(saved.sampling_rate),
        sampling_step: String(saved.sampling_step),
        sampling_autotune: saved.sampling_autotune,
        task_definition_ids: saved.params_json?.task_definition_ids ?? [],
      });
      setTriggerStatus('Gatillante guardado.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar el gatillante.';
      setTriggerStatus(message);
    }
  };

  const handleDeleteTrigger = async () => {
    if (!triggerDraft.id) {
      return;
    }
    setTriggerStatus(null);
    try {
      await apiRequest<void>(`/api/qc/triggers/${triggerDraft.id}`, { method: 'DELETE' });
      setTriggers((prev) => prev.filter((trigger) => trigger.id !== triggerDraft.id));
      setSelectedTriggerId(null);
      setTriggerDraft(emptyTriggerDraft());
      setTriggerStatus('Gatillante eliminado.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo eliminar el gatillante.';
      setTriggerStatus(message);
    }
  };

  const handleSaveApplicability = async () => {
    if (!selectedCheckId) {
      setApplicabilityStatus('Seleccione una revision antes de crear una regla.');
      return;
    }
    const rawModuleNumber = applicabilityDraft.module_number.trim();
    const moduleNumber = rawModuleNumber ? Number(rawModuleNumber) : null;
    if (
      rawModuleNumber &&
      (!Number.isInteger(Number(rawModuleNumber)) || Number(rawModuleNumber) <= 0)
    ) {
      setApplicabilityStatus('El numero de modulo debe ser un entero positivo.');
      return;
    }
    setApplicabilityStatus(null);
    try {
      const payload = {
        check_definition_id: selectedCheckId,
        house_type_id: applicabilityDraft.house_type_id,
        sub_type_id: applicabilityDraft.sub_type_id,
        module_number: moduleNumber,
        panel_definition_id: applicabilityDraft.panel_definition_id,
        force_required: applicabilityDraft.force_required,
        effective_from: applicabilityDraft.effective_from || null,
        effective_to: applicabilityDraft.effective_to || null,
      };
      let saved: QCApplicability;
      if (applicabilityDraft.id) {
        saved = await apiRequest<QCApplicability>(
          `/api/qc/applicability/${applicabilityDraft.id}`,
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          }
        );
        setApplicability((prev) => prev.map((rule) => (rule.id === saved.id ? saved : rule)));
      } else {
        saved = await apiRequest<QCApplicability>('/api/qc/applicability', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setApplicability((prev) => [...prev, saved]);
      }
      setSelectedApplicabilityId(saved.id);
      setApplicabilityDraft({
        id: saved.id,
        house_type_id: saved.house_type_id,
        sub_type_id: saved.sub_type_id,
        module_number: saved.module_number ? String(saved.module_number) : '',
        panel_definition_id: saved.panel_definition_id,
        force_required: saved.force_required,
        effective_from: saved.effective_from ?? '',
        effective_to: saved.effective_to ?? '',
      });
      setApplicabilityStatus('Regla guardada.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar la regla.';
      setApplicabilityStatus(message);
    }
  };

  const handleDeleteApplicability = async () => {
    if (!applicabilityDraft.id) {
      return;
    }
    setApplicabilityStatus(null);
    try {
      await apiRequest<void>(`/api/qc/applicability/${applicabilityDraft.id}`, {
        method: 'DELETE',
      });
      setApplicability((prev) => prev.filter((rule) => rule.id !== applicabilityDraft.id));
      setSelectedApplicabilityId(null);
      setApplicabilityDraft(emptyApplicabilityDraft());
      setApplicabilityStatus('Regla eliminada.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo eliminar la regla.';
      setApplicabilityStatus(message);
    }
  };

  const selectTrigger = (trigger: QCTrigger) => {
    setSelectedTriggerId(trigger.id);
    setTriggerDraft({
      id: trigger.id,
      event_type: trigger.event_type,
      sampling_rate: String(trigger.sampling_rate),
      sampling_step: String(trigger.sampling_step),
      sampling_autotune: trigger.sampling_autotune,
      task_definition_ids: trigger.params_json?.task_definition_ids ?? [],
    });
    setTriggerStatus(null);
  };

  const selectApplicability = (rule: QCApplicability) => {
    setSelectedApplicabilityId(rule.id);
    setApplicabilityDraft({
      id: rule.id,
      house_type_id: rule.house_type_id,
      sub_type_id: rule.sub_type_id,
      module_number: rule.module_number ? String(rule.module_number) : '',
      panel_definition_id: rule.panel_definition_id,
      force_required: rule.force_required,
      effective_from: rule.effective_from ?? '',
      effective_to: rule.effective_to ?? '',
    });
    setApplicabilityStatus(null);
  };

  const selectCategory = (category: QCCheckCategory) => {
    setSelectedCategoryId(category.id);
    setCategoryDraft({
      id: category.id,
      name: category.name,
      parent_id: category.parent_id,
      active: category.active,
      sort_order: category.sort_order !== null ? String(category.sort_order) : '',
    });
    setCategoryStatus(null);
  };

  const openCategoryModal = (draft: CategoryDraft, selectedId: number | null) => {
    setSelectedCategoryId(selectedId);
    setCategoryDraft(draft);
    setCategoryStatus(null);
    setIsCategoryModalOpen(true);
  };

  const startNewCategory = () => {
    openCategoryModal(
      emptyCategoryDraft(),
      selectedCategoryId ?? (categories[0]?.id ?? null)
    );
  };

  const startSubcategory = (parent: QCCheckCategory) => {
    openCategoryModal({ ...emptyCategoryDraft(), parent_id: parent.id }, parent.id);
  };

  const startEditCategory = (category: QCCheckCategory) => {
    openCategoryModal(
      {
        id: category.id,
        name: category.name,
        parent_id: category.parent_id,
        active: category.active,
        sort_order: category.sort_order !== null ? String(category.sort_order) : '',
      },
      category.id
    );
  };

  const selectFailureMode = (mode: QCFailureMode) => {
    setSelectedFailureId(mode.id);
    setIsFailureModeDraftNew(false);
    setFailureDraft({
      id: mode.id,
      check_definition_id: mode.check_definition_id,
      name: mode.name,
      description: mode.description ?? '',
      default_severity_level: mode.default_severity_level,
      default_rework_description: mode.default_rework_description ?? '',
    });
    setFailureStatus(null);
  };

  const filteredTasks = useMemo(() => {
    const query = normalizeSearch(triggerSearch.trim());
    if (!query) {
      return tasks;
    }
    return tasks.filter((task) => normalizeSearch(task.name).includes(query));
  }, [tasks, triggerSearch]);

  const catalogSequenceLabelByOrder = useMemo(() => {
    const entries = new Map<number, Set<string>>();
    stations.forEach((station) => {
      if (station.sequence_order === null) {
        return;
      }
      const normalized = normalizeStationName(station);
      const existing = entries.get(station.sequence_order) ?? new Set<string>();
      existing.add(normalized);
      entries.set(station.sequence_order, existing);
    });
    const map = new Map<number, string>();
    entries.forEach((names, sequence) => {
      map.set(
        sequence,
        names.size ? Array.from(names).join(' / ') : `Secuencia ${sequence}`
      );
    });
    return map;
  }, [stations]);

  const groupedTasks = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; sequence: number | null; name: string; tasks: TaskDefinition[] }
    >();
    filteredTasks.forEach((task) => {
      const sequence = task.default_station_sequence ?? null;
      const key = sequence === null ? 'unscheduled' : `seq-${sequence}`;
      const name =
        sequence === null
          ? 'Sin secuencia'
          : catalogSequenceLabelByOrder.get(sequence) ?? `Secuencia ${sequence}`;
      const group = groups.get(key);
      if (group) {
        group.tasks.push(task);
      } else {
        groups.set(key, { key, sequence, name, tasks: [task] });
      }
    });
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        tasks: [...group.tasks].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => {
        const aSeq = a.sequence ?? Number.POSITIVE_INFINITY;
        const bSeq = b.sequence ?? Number.POSITIVE_INFINITY;
        if (aSeq !== bSeq) {
          return aSeq - bSeq;
        }
        return a.name.localeCompare(b.name);
      });
  }, [catalogSequenceLabelByOrder, filteredTasks]);

  const subTypesForHouse = useMemo(() => {
    if (!applicabilityDraft.house_type_id) {
      return houseSubTypes;
    }
    return houseSubTypes.filter((sub) => sub.house_type_id === applicabilityDraft.house_type_id);
  }, [houseSubTypes, applicabilityDraft.house_type_id]);

  const filteredPanels = useMemo(() => {
    return panelDefinitions.filter((panel) => {
      if (applicabilityDraft.house_type_id && panel.house_type_id !== applicabilityDraft.house_type_id) {
        return false;
      }
      if (applicabilityDraft.sub_type_id && panel.sub_type_id !== applicabilityDraft.sub_type_id) {
        return false;
      }
      const moduleNumber = applicabilityDraft.module_number.trim()
        ? Number(applicabilityDraft.module_number)
        : null;
      if (moduleNumber && panel.module_sequence_number !== moduleNumber) {
        return false;
      }
      return true;
    });
  }, [panelDefinitions, applicabilityDraft]);

  const renderCheckRow = (check: QCCheckDefinition) => {
    const isSelected = selectedCheckId === check.id;
    const categoryLabel = check.category_id
      ? categoryNameById.get(check.category_id) ?? 'Sin categoria'
      : 'Sin categoria';
    return (
      <button
        key={check.id}
        onClick={() => setSelectedCheckId(check.id)}
        className={`group flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${
          isSelected ? 'bg-blue-50/60' : 'bg-white hover:bg-gray-50'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`truncate text-sm font-medium ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
              {check.name}
            </p>
            {!check.active && (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                Inactivo
              </span>
            )}
          </div>
          <p className="truncate text-xs text-gray-500">
            {check.kind === 'triggered' ? 'Disparado' : 'Plantilla manual'} · {categoryLabel}
          </p>
        </div>
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            check.active ? 'bg-emerald-500' : 'bg-gray-300'
          }`}
        />
      </button>
    );
  };

  const renderCategoryTree = (parentId: number | null, depth = 0) => {
    const children = categoryChildren.get(parentId) ?? [];
    if (!children.length) {
      return null;
    }
    return children.map((category) => {
      const checksForCategory = checksByCategoryId.get(category.id) ?? [];
      return (
        <div key={category.id} className="space-y-1">
          <div
            className="flex items-center justify-between gap-2 group"
            style={{ marginLeft: depth * 12 }}
          >
            <button
              onClick={() => selectCategory(category)}
              className={`flex-1 text-left px-2 py-1 text-xs rounded ${
                selectedCategoryId === category.id
                  ? 'bg-blue-100 text-blue-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {category.name}
              {!category.active && <span className="ml-1 text-gray-400">(inactivo)</span>}
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => startEditCategory(category)}
                className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-500 hover:text-gray-700 px-1"
                title="Editar categoria"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => startSubcategory(category)}
                className="opacity-0 group-hover:opacity-100 text-[10px] text-blue-600 hover:text-blue-800 px-1"
                title="Nueva subcategoria"
              >
                + sub
              </button>
            </div>
          </div>
          {checksForCategory.length > 0 && (
            <div className="space-y-1" style={{ marginLeft: depth * 12 + 12 }}>
              {checksForCategory.map(renderCheckRow)}
            </div>
          )}
          {renderCategoryTree(category.id, depth + 1)}
        </div>
      );
    });
  };

  const tabs: Array<{
    key: 'definition' | 'failure_modes' | 'triggers' | 'references' | 'applicability';
    label: string;
    icon?: typeof Image;
  }> = [
    { key: 'definition', label: 'Definicion' },
    { key: 'failure_modes', label: 'Modos de falla' },
    { key: 'triggers', label: 'Gatillantes' },
    { key: 'references', label: 'Referencias', icon: Image },
    { key: 'applicability', label: 'Aplicabilidad' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={handleAddCheck}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm"
        >
          <Plus className="h-4 w-4" /> Agregar check
        </button>
        <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <Filter className="h-3.5 w-3.5" /> {summaryLabel}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1.9fr] items-start">
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 px-4 py-3 bg-gray-50/50">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Biblioteca de checks</h2>
              <p className="text-xs text-gray-500">{summaryLabel}</p>
            </div>
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-gray-400" />
              <input
                type="search"
                placeholder="Buscar..."
                className="h-8 rounded-md border border-gray-200 bg-white pl-9 pr-3 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={checkSearch}
                onChange={(event) => setCheckSearch(event.target.value)}
              />
            </label>
          </div>

          <div className="border-b border-gray-100 px-4 py-3 bg-gray-50/30">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                Categorias y checks
              </p>
              <button
                type="button"
                onClick={startNewCategory}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
              >
                <Plus className="h-3 w-3" /> Nueva categoria
              </button>
            </div>
            <div className="max-h-[420px] overflow-auto space-y-3 pr-1">
              {renderCategoryTree(null)}
              {checksWithoutCategory.length > 0 && (
                <div className="space-y-1">
                  <div className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Sin categoria
                  </div>
                  <div className="space-y-1">
                    {checksWithoutCategory.map(renderCheckRow)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {loading && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              Cargando revisiones...
            </div>
          )}
          {!loading && filteredChecks.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              No hay revisiones que coincidan con esa busqueda.
            </div>
          )}

          {!loading && filteredChecks.length > 0 && (
            <div className="px-4 pb-4 text-[11px] text-gray-400">
              {filteredChecks.length} checks visibles en el arbol.
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Editor de Check
                </p>
                <h2 className="mt-2 text-lg font-display text-[var(--ink)]">
                  {checkDraft.name.trim() ||
                    (checkDraft.id ? `Check #${checkDraft.id}` : 'Nuevo Check')}
                </h2>
              </div>
              <Settings2 className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setSelectedTab(tab.key)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    selectedTab === tab.key
                      ? 'bg-[var(--ink)] text-white'
                      : 'bg-white text-[var(--ink)] border border-black/10'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    {tab.icon && <tab.icon className="h-4 w-4" />}
                    {tab.label}
                  </span>
                </button>
              ))}
            </div>

            {selectedTab === 'definition' && (
              <div className="mt-6 space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm text-[var(--ink-muted)]">
                    Nombre
                    <input
                      className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                      value={checkDraft.name}
                      onChange={(event) => updateCheckDraft({ name: event.target.value })}
                    />
                  </label>
                  <label className="text-sm text-[var(--ink-muted)]">
                    Categoria
                    <select
                      className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                      value={checkDraft.category_id ?? ''}
                      onChange={(event) =>
                        updateCheckDraft({
                          category_id: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                    >
                      <option value="">Sin categoria</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-[var(--ink-muted)]">
                    Tipo
                    <select
                      className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                      value={checkDraft.kind}
                      onChange={(event) =>
                        updateCheckDraft({ kind: event.target.value as QCCheckKind })
                      }
                    >
                      <option value="triggered">Disparado</option>
                      <option value="manual_template">Plantilla manual</option>
                    </select>
                  </label>
                  <label className="text-sm text-[var(--ink-muted)]">
                    Estado
                    <select
                      className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                      value={checkDraft.active ? 'Activo' : 'Inactivo'}
                      onChange={(event) =>
                        updateCheckDraft({ active: event.target.value === 'Activo' })
                      }
                    >
                      <option value="Activo">Activo</option>
                      <option value="Inactivo">Inactivo</option>
                    </select>
                  </label>
                  <label className="text-sm text-[var(--ink-muted)]">
                    Version
                    <input
                      type="number"
                      className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                      value={checkDraft.version}
                      onChange={(event) =>
                        updateCheckDraft({ version: Number(event.target.value) || 1 })
                      }
                    />
                  </label>
                </div>
                <label className="text-sm text-[var(--ink-muted)]">
                  Guia
                  <textarea
                    className="mt-2 min-h-[96px] w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                    value={checkDraft.guidance_text}
                    onChange={(event) =>
                      updateCheckDraft({ guidance_text: event.target.value })
                    }
                  />
                </label>

                {checkStatus && (
                  <p className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                    {checkStatus}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleSaveCheck}
                    disabled={saving}
                    className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {saving ? 'Guardando...' : 'Guardar revision'}
                  </button>
                  <button
                    onClick={handleDeleteCheck}
                    disabled={saving || !checkDraft.id}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" /> Eliminar
                  </button>
                </div>
              </div>
            )}

            {selectedTab === 'failure_modes' && (
              <div className="mt-6 space-y-5">
                <div className="rounded-2xl border border-black/5 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                        Modos de falla
                      </p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        {selectedCheckId
                          ? 'Asignados a la revision.'
                          : 'Cree una revision para asignar modos de falla.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFailureId(null);
                        setIsFailureModeDraftNew(true);
                        setFailureDraft(emptyFailureModeDraft(selectedCheckId));
                        setFailureStatus(null);
                      }}
                      className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-[var(--ink)]"
                    >
                      <Plus className="h-3.5 w-3.5" /> Nuevo
                    </button>
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="max-h-52 overflow-auto rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.2)]">
                      {filteredFailureModes.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-[var(--ink-muted)]">
                          No hay modos de falla registrados.
                        </p>
                      ) : (
                        filteredFailureModes.map((mode) => (
                          <button
                            key={mode.id}
                            onClick={() => selectFailureMode(mode)}
                            className={`flex w-full items-center justify-between px-4 py-2 text-left text-xs ${
                              selectedFailureId === mode.id ? 'bg-white' : 'bg-transparent'
                            }`}
                          >
                            <span className="truncate text-[var(--ink)]">{mode.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                    <div className="space-y-3">
                      <label className="text-sm text-[var(--ink-muted)]">
                        Nombre
                        <input
                          className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                          value={failureDraft.name}
                          onChange={(event) =>
                            setFailureDraft((prev) => ({ ...prev, name: event.target.value }))
                          }
                        />
                      </label>
                      <label className="text-sm text-[var(--ink-muted)]">
                        Severidad sugerida
                        <select
                          className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                          value={failureDraft.default_severity_level ?? ''}
                          onChange={(event) =>
                            setFailureDraft((prev) => ({
                              ...prev,
                              default_severity_level: event.target.value
                                ? (event.target.value as QCSeverityLevelKey)
                                : null,
                            }))
                          }
                        >
                          <option value="">Sin severidad</option>
                          {severityOptions.map((level) => (
                            <option key={level.value} value={level.value}>
                              {level.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm text-[var(--ink-muted)]">
                        Descripcion
                        <textarea
                          className="mt-2 min-h-[80px] w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                          value={failureDraft.description}
                          onChange={(event) =>
                            setFailureDraft((prev) => ({
                              ...prev,
                              description: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="text-sm text-[var(--ink-muted)]">
                        Re-trabajo sugerido
                        <textarea
                          className="mt-2 min-h-[80px] w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                          value={failureDraft.default_rework_description}
                          onChange={(event) =>
                            setFailureDraft((prev) => ({
                              ...prev,
                              default_rework_description: event.target.value,
                            }))
                          }
                        />
                      </label>
                      {failureStatus && (
                        <p className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                          {failureStatus}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={handleSaveFailureMode}
                          className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                        >
                          Guardar modo
                        </button>
                        <button
                          onClick={handleDeleteFailureMode}
                          disabled={!failureDraft.id}
                          className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-60"
                        >
                          <Trash2 className="h-4 w-4" /> Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {selectedTab === 'references' && (
              <div className="mt-6 space-y-5">
                <div className="rounded-2xl border border-black/5 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                        Guias
                      </p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        Ejemplos de como se debe ejecutar el trabajo.
                      </p>
                    </div>
                    <label
                      className={`inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-[var(--ink)] ${
                        !selectedCheckId ? 'opacity-50 pointer-events-none' : ''
                      }`}
                    >
                      Subir
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(event) => handleMediaInput(event, 'guidance')}
                      />
                    </label>
                  </div>
                  {guidanceMedia.length > 0 ? (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <div
                        className={`flex h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/10 bg-[rgba(201,215,245,0.2)] px-4 text-center text-xs text-[var(--ink-muted)] sm:h-48 ${
                          !selectedCheckId ? 'opacity-50' : ''
                        }`}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleMediaDrop(event, 'guidance')}
                      >
                        <Image className="h-5 w-5 text-[var(--ink-muted)]" />
                        <p className="text-xs font-semibold text-[var(--ink)]">
                          Arrastra y suelta guias aqui.
                        </p>
                        <label
                          className={`mt-1 inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)] ${
                            !selectedCheckId ? 'opacity-50 pointer-events-none' : ''
                          }`}
                        >
                          <Plus className="h-3.5 w-3.5" /> Agregar imagenes
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(event) => handleMediaInput(event, 'guidance')}
                          />
                        </label>
                      </div>
                      {guidanceMedia.map((media) => (
                        <div
                          key={media.id}
                          className="relative overflow-hidden rounded-2xl border border-black/5 bg-white"
                        >
                          <img
                            src={`${API_BASE_URL}${media.uri}`}
                            alt="Guia"
                            className="h-40 w-full object-cover sm:h-48"
                          />
                          <button
                            type="button"
                            onClick={() => handleDeleteCheckMedia(media.id)}
                            className="absolute right-2 top-2 rounded-full border border-black/10 bg-white/90 p-1.5 text-[var(--ink)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      className={`mt-4 rounded-2xl border border-dashed border-black/10 bg-[rgba(201,215,245,0.2)] px-4 py-8 text-center text-xs text-[var(--ink-muted)] ${
                        !selectedCheckId ? 'opacity-50' : ''
                      }`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleMediaDrop(event, 'guidance')}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Image className="h-6 w-6 text-[var(--ink-muted)]" />
                        <p className="text-xs font-semibold text-[var(--ink)]">
                          Arrastra y suelta imagenes aqui.
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          O haz clic en el boton para agregar nuevas guias.
                        </p>
                        <label
                          className={`mt-2 inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[var(--ink)] ${
                            !selectedCheckId ? 'opacity-50 pointer-events-none' : ''
                          }`}
                        >
                          <Plus className="h-3.5 w-3.5" /> Agregar imagenes
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(event) => handleMediaInput(event, 'guidance')}
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-black/5 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                        Referencias
                      </p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        Ejemplos de fallas y de como deben ser tomadas las fotos de evidencia
                      </p>
                    </div>
                    <label
                      className={`inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-[var(--ink)] ${
                        !selectedCheckId ? 'opacity-50 pointer-events-none' : ''
                      }`}
                    >
                      Subir
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(event) => handleMediaInput(event, 'reference')}
                      />
                    </label>
                  </div>
                  {referenceMedia.length > 0 ? (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <div
                        className={`flex h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/10 bg-[rgba(201,215,245,0.2)] px-4 text-center text-xs text-[var(--ink-muted)] sm:h-48 ${
                          !selectedCheckId ? 'opacity-50' : ''
                        }`}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleMediaDrop(event, 'reference')}
                      >
                        <Image className="h-5 w-5 text-[var(--ink-muted)]" />
                        <p className="text-xs font-semibold text-[var(--ink)]">
                          Arrastra y suelta referencias aqui.
                        </p>
                        <label
                          className={`mt-1 inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink)] ${
                            !selectedCheckId ? 'opacity-50 pointer-events-none' : ''
                          }`}
                        >
                          <Plus className="h-3.5 w-3.5" /> Agregar imagenes
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(event) => handleMediaInput(event, 'reference')}
                          />
                        </label>
                      </div>
                      {referenceMedia.map((media) => (
                        <div
                          key={media.id}
                          className="relative overflow-hidden rounded-2xl border border-black/5 bg-white"
                        >
                          <img
                            src={`${API_BASE_URL}${media.uri}`}
                            alt="Referencia"
                            className="h-40 w-full object-cover sm:h-48"
                          />
                          <button
                            type="button"
                            onClick={() => handleDeleteCheckMedia(media.id)}
                            className="absolute right-2 top-2 rounded-full border border-black/10 bg-white/90 p-1.5 text-[var(--ink)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      className={`mt-4 rounded-2xl border border-dashed border-black/10 bg-[rgba(201,215,245,0.2)] px-4 py-8 text-center text-xs text-[var(--ink-muted)] ${
                        !selectedCheckId ? 'opacity-50' : ''
                      }`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleMediaDrop(event, 'reference')}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Image className="h-6 w-6 text-[var(--ink-muted)]" />
                        <p className="text-xs font-semibold text-[var(--ink)]">
                          Arrastra y suelta imagenes aqui.
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          O haz clic en el boton para agregar nuevas referencias.
                        </p>
                        <label
                          className={`mt-2 inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[var(--ink)] ${
                            !selectedCheckId ? 'opacity-50 pointer-events-none' : ''
                          }`}
                        >
                          <Plus className="h-3.5 w-3.5" /> Agregar imagenes
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(event) => handleMediaInput(event, 'reference')}
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {mediaStatus && (
                  <p className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                    {mediaStatus}
                  </p>
                )}

                {uploadingMedia && (
                  <p className="text-xs text-[var(--ink-muted)]">Subiendo imagenes...</p>
                )}
              </div>
            )}

            {selectedTab === 'triggers' && (
              <div className="mt-6 space-y-5">
                <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.2)]">
                    <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                          Gatillantes actuales
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          {filteredTriggers.length} configurados
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTriggerId(null);
                          setTriggerDraft(emptyTriggerDraft());
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-[var(--ink)]"
                      >
                        <Plus className="h-3.5 w-3.5" /> Nuevo
                      </button>
                    </div>
                    <div className="max-h-60 overflow-auto">
                      {filteredTriggers.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-[var(--ink-muted)]">
                          No hay gatillantes configurados.
                        </p>
                      ) : (
                        filteredTriggers.map((trigger) => (
                          <button
                            key={trigger.id}
                            onClick={() => selectTrigger(trigger)}
                            className={`flex w-full items-center justify-between px-4 py-2 text-left text-xs ${
                              selectedTriggerId === trigger.id ? 'bg-white' : 'bg-transparent'
                            }`}
                          >
                            <span className="truncate text-[var(--ink)]">
                              Tarea completada
                            </span>
                            <span className="text-[10px] text-[var(--ink-muted)]">
                              {Math.round(trigger.sampling_rate * 100)}%
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="text-sm text-[var(--ink-muted)]">
                      <span className="inline-flex items-center gap-2">
                        Evento
                        <span
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-black/10 text-[10px] font-semibold text-[var(--ink-muted)]"
                          title="Define cuando se dispara el gatillante (al completar una tarea)."
                        >
                          i
                        </span>
                      </span>
                      <div className="mt-2 rounded-xl border border-black/10 bg-gray-50 px-3 py-2 text-sm text-[var(--ink)]">
                        Tarea completada
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm text-[var(--ink-muted)]">
                        <span className="inline-flex items-center gap-2">
                          Tasa base
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-black/10 text-[10px] font-semibold text-[var(--ink-muted)]"
                            title="Porcentaje base de muestreo (0 a 1) para disparar la revision."
                          >
                            i
                          </span>
                        </span>
                        <input
                          className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                          value={triggerDraft.sampling_rate}
                          onChange={(event) =>
                            setTriggerDraft((prev) => ({
                              ...prev,
                              sampling_rate: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="text-sm text-[var(--ink-muted)]">
                        <span className="inline-flex items-center gap-2">
                          Paso de ajuste
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-black/10 text-[10px] font-semibold text-[var(--ink-muted)]"
                            title="Incremento/decremento aplicado cuando el muestreo adaptativo esta activo (0 a 1)."
                          >
                            i
                          </span>
                        </span>
                        <input
                          className={`mt-2 w-full rounded-xl border px-3 py-2 text-sm ${
                            triggerDraft.sampling_autotune
                              ? 'border-black/10'
                              : 'border-black/5 bg-gray-100 text-gray-400'
                          }`}
                          value={triggerDraft.sampling_step}
                          onChange={(event) =>
                            setTriggerDraft((prev) => ({
                              ...prev,
                              sampling_step: event.target.value,
                            }))
                          }
                          disabled={!triggerDraft.sampling_autotune}
                        />
                      </label>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                      <input
                        type="checkbox"
                        checked={triggerDraft.sampling_autotune}
                        onChange={(event) =>
                          setTriggerDraft((prev) => ({
                            ...prev,
                            sampling_autotune: event.target.checked,
                          }))
                        }
                      />
                      <span className="inline-flex items-center gap-2">
                        Muestreo adaptativo
                        <span
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-black/10 text-[10px] font-semibold text-[var(--ink-muted)]"
                          title="Permite ajustar automaticamente la tasa base usando el paso de ajuste."
                        >
                          i
                        </span>
                      </span>
                    </label>

                    <div className="rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.15)] p-3">
                      <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                        <Search className="h-3.5 w-3.5" />
                        <input
                          placeholder="Filtrar..."
                          value={triggerSearch}
                          onChange={(event) => setTriggerSearch(event.target.value)}
                          className="w-full bg-transparent text-xs outline-none"
                        />
                      </label>
                      <div className="mt-2 max-h-40 overflow-auto text-xs">
                        {groupedTasks.length === 0 ? (
                          <p className="text-[var(--ink-muted)]">No hay tareas disponibles.</p>
                        ) : (
                          <div className="space-y-2">
                            {groupedTasks.map((group) => (
                              <div key={group.key}>
                                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                                  {group.name}
                                </p>
                                <div className="space-y-1">
                                  {group.tasks.map((task) => (
                                    <label key={task.id} className="flex items-center gap-2 py-1">
                                      <input
                                        type="checkbox"
                                        checked={triggerDraft.task_definition_ids.includes(task.id)}
                                        onChange={() =>
                                          setTriggerDraft((prev) => {
                                            const selected = new Set(prev.task_definition_ids);
                                            if (selected.has(task.id)) {
                                              selected.delete(task.id);
                                            } else {
                                              selected.add(task.id);
                                            }
                                            return {
                                              ...prev,
                                              task_definition_ids: Array.from(selected),
                                            };
                                          })
                                        }
                                      />
                                      <span className="text-[var(--ink)]">{task.name}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {triggerStatus && (
                      <p className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                        {triggerStatus}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={handleSaveTrigger}
                        className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                      >
                        Guardar gatillante
                      </button>
                      <button
                        onClick={handleDeleteTrigger}
                        disabled={!triggerDraft.id}
                        className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-60"
                      >
                        <Trash2 className="h-4 w-4" /> Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {selectedTab === 'applicability' && (
              <div className="mt-6 space-y-5">
                <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.2)]">
                    <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                          Reglas vigentes
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          {filteredApplicability.length} reglas
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedApplicabilityId(null);
                          setApplicabilityDraft(emptyApplicabilityDraft());
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-[var(--ink)]"
                      >
                        <Plus className="h-3.5 w-3.5" /> Nueva
                      </button>
                    </div>
                    <div className="max-h-60 overflow-auto">
                      {filteredApplicability.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-[var(--ink-muted)]">
                          Sin reglas configuradas.
                        </p>
                      ) : (
                        filteredApplicability.map((rule) => {
                          const houseLabel = rule.house_type_id
                            ? houseTypeNameById.get(rule.house_type_id) ?? `Tipo ${rule.house_type_id}`
                            : 'Todos';
                          const subLabel = rule.sub_type_id
                            ? houseSubTypeNameById.get(rule.sub_type_id) ?? `Subtipo ${rule.sub_type_id}`
                            : 'Cualquier subtipo';
                          return (
                            <button
                              key={rule.id}
                              onClick={() => selectApplicability(rule)}
                              className={`flex w-full items-center justify-between px-4 py-2 text-left text-xs ${
                                selectedApplicabilityId === rule.id ? 'bg-white' : 'bg-transparent'
                              }`}
                            >
                              <span className="truncate text-[var(--ink)]">
                                {houseLabel} · {subLabel}
                              </span>
                              {rule.force_required && (
                                <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] text-[var(--ink-muted)]">
                                  Forzado
                                </span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm text-[var(--ink-muted)]">
                      Tipo de casa
                      <select
                        className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                        value={applicabilityDraft.house_type_id ?? ''}
                        onChange={(event) =>
                          setApplicabilityDraft((prev) => ({
                            ...prev,
                            house_type_id: event.target.value
                              ? Number(event.target.value)
                              : null,
                          }))
                        }
                      >
                        <option value="">Todos</option>
                        {houseTypes.map((house) => (
                          <option key={house.id} value={house.id}>
                            {house.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm text-[var(--ink-muted)]">
                      Subtipo
                      <select
                        className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                        value={applicabilityDraft.sub_type_id ?? ''}
                        onChange={(event) =>
                          setApplicabilityDraft((prev) => ({
                            ...prev,
                            sub_type_id: event.target.value
                              ? Number(event.target.value)
                              : null,
                          }))
                        }
                      >
                        <option value="">Todos</option>
                        {subTypesForHouse.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm text-[var(--ink-muted)]">
                      Numero de modulo
                      <input
                        className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                        value={applicabilityDraft.module_number}
                        onChange={(event) =>
                          setApplicabilityDraft((prev) => ({
                            ...prev,
                            module_number: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="text-sm text-[var(--ink-muted)]">
                      Panel
                      <select
                        className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                        value={applicabilityDraft.panel_definition_id ?? ''}
                        onChange={(event) =>
                          setApplicabilityDraft((prev) => ({
                            ...prev,
                            panel_definition_id: event.target.value
                              ? Number(event.target.value)
                              : null,
                          }))
                        }
                      >
                        <option value="">Todos</option>
                        {filteredPanels.map((panel) => (
                          <option key={panel.id} value={panel.id}>
                            {panel.panel_code} · M{panel.module_sequence_number}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm text-[var(--ink-muted)]">
                        Vigencia inicio
                        <input
                          type="date"
                          className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                          value={applicabilityDraft.effective_from}
                          onChange={(event) =>
                            setApplicabilityDraft((prev) => ({
                              ...prev,
                              effective_from: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="text-sm text-[var(--ink-muted)]">
                        Vigencia fin
                        <input
                          type="date"
                          className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                          value={applicabilityDraft.effective_to}
                          onChange={(event) =>
                            setApplicabilityDraft((prev) => ({
                              ...prev,
                              effective_to: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                      <input
                        type="checkbox"
                        checked={applicabilityDraft.force_required}
                        onChange={(event) =>
                          setApplicabilityDraft((prev) => ({
                            ...prev,
                            force_required: event.target.checked,
                          }))
                        }
                      />
                      Forzar apertura (ignora muestreo)
                    </label>

                    {applicabilityStatus && (
                      <p className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                        {applicabilityStatus}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={handleSaveApplicability}
                        className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                      >
                        Guardar regla
                      </button>
                      <button
                        onClick={handleDeleteApplicability}
                        disabled={!applicabilityDraft.id}
                        className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-60"
                      >
                        <Trash2 className="h-4 w-4" /> Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>

      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Categorias
                </p>
                <h3 className="text-lg font-display text-[var(--ink)]">
                  {categoryDraft.id
                    ? 'Editar categoria'
                    : categoryDraft.parent_id
                      ? 'Nueva subcategoria'
                      : 'Nueva categoria'}
                </h3>
                {categoryDraft.parent_id && (
                  <p className="text-xs text-[var(--ink-muted)]">
                    Subcategoria de{' '}
                    {categoryNameById.get(categoryDraft.parent_id) ?? 'Categoria'}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsCategoryModalOpen(false)}
                className="rounded-full p-1 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="text-sm text-[var(--ink-muted)]">
                Nombre
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                  placeholder="Nombre de categoria"
                  value={categoryDraft.name}
                  onChange={(e) =>
                    setCategoryDraft((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </label>

              {categoryStatus && (
                <p className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink-muted)]">
                  {categoryStatus}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSaveCategory}
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                >
                  Guardar categoria
                </button>
                <button
                  onClick={handleDeleteCategory}
                  disabled={!categoryDraft.id}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" /> Eliminar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QCChecks;
