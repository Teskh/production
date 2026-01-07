import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Filter,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type Worker = {
  id: number;
  geovictoria_id: string | null;
  geovictoria_identifier: string | null;
  first_name: string;
  last_name: string;
  pin: string | null;
  login_required: boolean;
  active: boolean;
  assigned_station_ids: number[] | null;
  supervisor_id: number | null;
};

type WorkerSupervisor = {
  id: number;
  geovictoria_id: string | null;
  geovictoria_identifier: string | null;
  first_name: string;
  last_name: string;
  pin: string | null;
};

type Station = {
  id: number;
  name: string;
  line_type: string | null;
  sequence_order: number | null;
  role: string;
};

type Skill = {
  id: number;
  name: string;
};

type WorkerDraft = {
  id?: number;
  geovictoria_id: string;
  geovictoria_identifier: string;
  first_name: string;
  last_name: string;
  pin: string;
  login_required: boolean;
  active: boolean;
  assigned_station_ids: number[];
  supervisor_id: number | null;
  skill_ids: number[];
};

type SupervisorDraft = {
  id?: number;
  geovictoria_id: string;
  geovictoria_identifier: string;
  first_name: string;
  last_name: string;
  pin: string;
};

type GeoVictoriaWorker = {
  geovictoria_id: string | null;
  identifier: string | null;
  first_name: string | null;
  last_name: string | null;
};

type RosterMode = 'workers' | 'supervisors';

type GeoLinkedPerson = {
  geovictoria_id: string | null;
  geovictoria_identifier: string | null;
  first_name: string;
  last_name: string;
};

type WorkersProps = {
  initialRosterMode?: RosterMode;
  hideRosterTabs?: boolean;
};

const emptyWorkerDraft = (): WorkerDraft => ({
  geovictoria_id: '',
  geovictoria_identifier: '',
  first_name: '',
  last_name: '',
  pin: '',
  login_required: true,
  active: true,
  assigned_station_ids: [],
  supervisor_id: null,
  skill_ids: [],
});

const emptySupervisorDraft = (): SupervisorDraft => ({
  geovictoria_id: '',
  geovictoria_identifier: '',
  first_name: '',
  last_name: '',
  pin: '',
});

const buildDraftFromWorker = (worker: Worker): WorkerDraft => ({
  id: worker.id,
  geovictoria_id: worker.geovictoria_id ?? '',
  geovictoria_identifier: worker.geovictoria_identifier ?? '',
  first_name: worker.first_name,
  last_name: worker.last_name,
  pin: worker.pin ?? '',
  login_required: worker.login_required,
  active: worker.active,
  assigned_station_ids: worker.assigned_station_ids ?? [],
  supervisor_id: worker.supervisor_id ?? null,
  skill_ids: [],
});

const buildDraftFromSupervisor = (
  supervisor: WorkerSupervisor
): SupervisorDraft => ({
  id: supervisor.id,
  geovictoria_id: supervisor.geovictoria_id ?? '',
  geovictoria_identifier: supervisor.geovictoria_identifier ?? '',
  first_name: supervisor.first_name,
  last_name: supervisor.last_name,
  pin: supervisor.pin ?? '',
});

const buildGeoSelectionFromPerson = (
  person: GeoLinkedPerson
): GeoVictoriaWorker | null => {
  if (!person.geovictoria_id && !person.geovictoria_identifier) {
    return null;
  }
  return {
    geovictoria_id: person.geovictoria_id,
    identifier: person.geovictoria_identifier,
    first_name: person.first_name,
    last_name: person.last_name,
  };
};

const sortWorkers = (list: Worker[]) =>
  [...list].sort((a, b) => {
    const lastCompare = a.last_name.localeCompare(b.last_name);
    if (lastCompare !== 0) {
      return lastCompare;
    }
    return a.first_name.localeCompare(b.first_name);
  });

const sortSupervisors = (list: WorkerSupervisor[]) =>
  [...list].sort((a, b) => {
    const lastCompare = a.last_name.localeCompare(b.last_name);
    if (lastCompare !== 0) {
      return lastCompare;
    }
    return a.first_name.localeCompare(b.first_name);
  });

const buildHeaders = (options: RequestInit): Headers => {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
};

const normalizeSearchValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

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

const Workers: React.FC<WorkersProps> = ({
  initialRosterMode = 'workers',
  hideRosterTabs = false,
}) => {
  const { setHeader } = useAdminHeader();
  const [rosterMode, setRosterMode] = useState<RosterMode>(initialRosterMode);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [supervisors, setSupervisors] = useState<WorkerSupervisor[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<number | null>(null);
  const [draft, setDraft] = useState<WorkerDraft | null>(null);
  const [supervisorDraft, setSupervisorDraft] = useState<SupervisorDraft | null>(null);
  const [workerQuery, setWorkerQuery] = useState('');
  const [supervisorQuery, setSupervisorQuery] = useState('');
  const [geoDirectory, setGeoDirectory] = useState<GeoVictoriaWorker[]>([]);
  const [geoQuery, setGeoQuery] = useState('');
  const [geoSuggestions, setGeoSuggestions] = useState<GeoVictoriaWorker[]>([]);
  const [geoSelected, setGeoSelected] = useState<GeoVictoriaWorker | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoSearchLoading, setGeoSearchLoading] = useState(false);
  const [geoDirectoryLoaded, setGeoDirectoryLoaded] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [stationDropdownOpen, setStationDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [filterStation, setFilterStation] = useState<number | null>(null);
  const [filterSkill, setFilterSkill] = useState<number | null>(null);
  const [workerSkillsMap, setWorkerSkillsMap] = useState<Map<number, number[]>>(new Map());
  const stationDropdownRef = useRef<HTMLDivElement | null>(null);
  const filterPanelRef = useRef<HTMLDivElement | null>(null);

  const isWorkerMode = rosterMode === 'workers';
  const hasActiveFilters = filterStation !== null || filterSkill !== null;

  useEffect(() => {
    setRosterMode(initialRosterMode);
  }, [initialRosterMode]);

  useEffect(() => {
    setHeader({
      title: 'Directorio de trabajadores',
      kicker: 'Personal / Trabajadores',
    });
  }, [setHeader]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setStatusMessage(null);
      try {
        const [workerData, stationData, skillData, supervisorData] =
          await Promise.all([
            apiRequest<Worker[]>('/api/workers'),
            apiRequest<Station[]>('/api/stations'),
            apiRequest<Skill[]>('/api/workers/skills'),
            apiRequest<WorkerSupervisor[]>('/api/workers/supervisors'),
          ]);
        if (!active) {
          return;
        }
        const sortedWorkers = sortWorkers(workerData);
        const sortedSupervisors = sortSupervisors(supervisorData);
        setWorkers(sortedWorkers);
        setSupervisors(sortedSupervisors);
        setStations(stationData);
        setSkills(skillData);
        setSelectedWorkerId(null);
        setSelectedSupervisorId(null);
        setDraft(emptyWorkerDraft());
        setSupervisorDraft(emptySupervisorDraft());
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error ? error.message : 'No se pudieron cargar los trabajadores.';
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

  useEffect(() => {
    if (workers.length === 0) return;
    let active = true;
    const loadAllWorkerSkills = async () => {
      const skillsMap = new Map<number, number[]>();
      await Promise.all(
        workers.map(async (worker) => {
          try {
            const workerSkills = await apiRequest<Skill[]>(`/api/workers/${worker.id}/skills`);
            if (active) {
              skillsMap.set(worker.id, workerSkills.map((s) => s.id));
            }
          } catch {
            skillsMap.set(worker.id, []);
          }
        })
      );
      if (active) {
        setWorkerSkillsMap(skillsMap);
      }
    };
    loadAllWorkerSkills();
    return () => {
      active = false;
    };
  }, [workers]);

  useEffect(() => {
    let active = true;
    const loadGeoDirectory = async () => {
      setGeoLoading(true);
      setGeoError(null);
      try {
        const results = await apiRequest<GeoVictoriaWorker[]>(
          '/api/geovictoria/workers/active'
        );
        if (active) {
          setGeoDirectory(results);
        }
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error
              ? error.message
              : 'No se pudieron cargar los trabajadores de GeoVictoria.';
          setGeoError(message);
        }
      } finally {
        if (active) {
          setGeoLoading(false);
          setGeoDirectoryLoaded(true);
        }
      }
    };
    loadGeoDirectory();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const query = geoQuery.trim();
    if (query.length < 2) {
      setGeoSuggestions([]);
      setGeoSearchLoading(false);
      return;
    }
    if (geoDirectoryLoaded && geoDirectory.length > 0) {
      const results: GeoVictoriaWorker[] = [];
      const lowered = normalizeSearchValue(query);
      for (const item of geoDirectory) {
        if (!item.geovictoria_id || !item.identifier) {
          continue;
        }
        const haystack = normalizeSearchValue(
          [item.first_name, item.last_name, item.identifier].filter(Boolean).join(' ')
        );
        if (haystack.includes(lowered)) {
          results.push(item);
          if (results.length >= 8) {
            break;
          }
        }
      }
      setGeoSuggestions(results);
      setGeoSearchLoading(false);
      return;
    }
    if (geoDirectoryLoaded && !geoError) {
      setGeoSuggestions([]);
      setGeoSearchLoading(false);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setGeoSearchLoading(true);
      setGeoError(null);
      try {
        const results = await apiRequest<GeoVictoriaWorker[]>(
          `/api/geovictoria/workers?query=${encodeURIComponent(query)}`
        );
        if (active) {
          setGeoSuggestions(results);
        }
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error
              ? error.message
              : 'No se pudo buscar en GeoVictoria.';
          setGeoError(message);
          setGeoSuggestions([]);
        }
      } finally {
        if (active) {
          setGeoSearchLoading(false);
        }
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [geoDirectory, geoDirectoryLoaded, geoError, geoQuery]);

  useEffect(() => {
    if (selectedWorkerId === null) {
      setDraft(emptyWorkerDraft());
      if (isWorkerMode) {
        setGeoSelected(null);
        setGeoQuery('');
        setGeoSuggestions([]);
        setGeoError(null);
      }
      setStationDropdownOpen(false);
      return;
    }
    const worker = workers.find((item) => item.id === selectedWorkerId);
    if (!worker) {
      return;
    }
    setDraft(buildDraftFromWorker(worker));
    if (isWorkerMode) {
      setGeoSelected(buildGeoSelectionFromPerson(worker));
      setGeoQuery('');
      setGeoSuggestions([]);
      setGeoError(null);
    }
    setStationDropdownOpen(false);
    let active = true;
    const loadSkills = async () => {
      try {
        const workerSkills = await apiRequest<Skill[]>(
          `/api/workers/${worker.id}/skills`
        );
        if (active) {
          setDraft((prev) =>
            prev ? { ...prev, skill_ids: workerSkills.map((skill) => skill.id) } : prev
          );
        }
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error
              ? error.message
              : 'No se pudieron cargar las habilidades del trabajador.';
          setStatusMessage(message);
        }
      }
    };
    loadSkills();
    return () => {
      active = false;
    };
  }, [isWorkerMode, selectedWorkerId, workers]);

  useEffect(() => {
    if (selectedSupervisorId === null) {
      setSupervisorDraft(emptySupervisorDraft());
      if (!isWorkerMode) {
        setGeoSelected(null);
        setGeoQuery('');
        setGeoSuggestions([]);
        setGeoError(null);
      }
      setStationDropdownOpen(false);
      return;
    }
    const supervisor = supervisors.find((item) => item.id === selectedSupervisorId);
    if (!supervisor) {
      return;
    }
    setSupervisorDraft(buildDraftFromSupervisor(supervisor));
    if (!isWorkerMode) {
      setGeoSelected(buildGeoSelectionFromPerson(supervisor));
      setGeoQuery('');
      setGeoSuggestions([]);
      setGeoError(null);
    }
    setStationDropdownOpen(false);
  }, [isWorkerMode, selectedSupervisorId, supervisors]);

  useEffect(() => {
    if (rosterMode === 'workers') {
      const selectedWorker = workers.find((item) => item.id === selectedWorkerId);
      setGeoSelected(selectedWorker ? buildGeoSelectionFromPerson(selectedWorker) : null);
    } else {
      const selectedSupervisor = supervisors.find(
        (item) => item.id === selectedSupervisorId
      );
      setGeoSelected(
        selectedSupervisor ? buildGeoSelectionFromPerson(selectedSupervisor) : null
      );
    }
    setGeoQuery('');
    setGeoSuggestions([]);
    setGeoError(null);
    setStationDropdownOpen(false);
  }, [rosterMode, selectedSupervisorId, selectedWorkerId, supervisors, workers]);

  const activeCount = useMemo(() => workers.filter((worker) => worker.active).length, [
    workers,
  ]);
  const filteredGeoSuggestions = useMemo(
    () => geoSuggestions.filter((item) => item.geovictoria_id && item.identifier),
    [geoSuggestions]
  );
  const filteredWorkers = useMemo(() => {
    let result = workers;
    const query = normalizeSearchValue(workerQuery.trim());
    if (query) {
      result = result.filter((worker) => {
        const haystack = normalizeSearchValue(
          [
            worker.first_name,
            worker.last_name,
            worker.geovictoria_identifier ?? '',
          ].join(' ')
        );
        return haystack.includes(query);
      });
    }
    if (filterStation !== null) {
      result = result.filter((worker) =>
        worker.assigned_station_ids?.includes(filterStation)
      );
    }
    if (filterSkill !== null) {
      result = result.filter((worker) => {
        const skills = workerSkillsMap.get(worker.id) ?? [];
        return skills.includes(filterSkill);
      });
    }
    return result;
  }, [workerQuery, workers, filterStation, filterSkill, workerSkillsMap]);
  const filteredSupervisors = useMemo(() => {
    const query = normalizeSearchValue(supervisorQuery.trim());
    if (!query) {
      return supervisors;
    }
    return supervisors.filter((supervisor) => {
      const haystack = normalizeSearchValue(
        [
          supervisor.first_name,
          supervisor.last_name,
          supervisor.geovictoria_identifier ?? '',
        ].join(' ')
      );
      return haystack.includes(query);
    });
  }, [supervisorQuery, supervisors]);

  const stationNameById = useMemo(
    () => new Map(stations.map((station) => [station.id, station.name])),
    [stations]
  );

  const supervisorNameById = useMemo(
    () =>
      new Map(
        supervisors.map((supervisor) => [
          supervisor.id,
          `${supervisor.first_name} ${supervisor.last_name}`,
        ])
      ),
    [supervisors]
  );

  const supervisorCrewCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const worker of workers) {
      if (!worker.supervisor_id) {
        continue;
      }
      map.set(worker.supervisor_id, (map.get(worker.supervisor_id) ?? 0) + 1);
    }
    return map;
  }, [workers]);

  const orderedStations = useMemo(
    () =>
      [...stations].sort((a, b) => {
        const sequenceCompare = (a.sequence_order ?? Number.POSITIVE_INFINITY) -
          (b.sequence_order ?? Number.POSITIVE_INFINITY);
        if (sequenceCompare !== 0) {
          return sequenceCompare;
        }
        return a.name.localeCompare(b.name);
      }),
    [stations]
  );

  const stationSubtitle = (station: Station) =>
    station.role === 'Assembly' && station.line_type ? `linea ${station.line_type}` : null;

  const assignedStationNames = useMemo(() => {
    if (!draft?.assigned_station_ids) {
      return [];
    }
    return draft.assigned_station_ids.map(
      (id) => stationNameById.get(id) ?? 'Estacion desconocida'
    );
  }, [draft?.assigned_station_ids, stationNameById]);

  const assignedStationLabel = useMemo(() => {
    if (assignedStationNames.length === 0) {
      return 'Sin estaciones seleccionadas';
    }
    if (assignedStationNames.length <= 2) {
      return assignedStationNames.join(', ');
    }
    return `${assignedStationNames[0]}, ${assignedStationNames[1]} +${assignedStationNames.length - 2}`;
  }, [assignedStationNames]);

  useEffect(() => {
    if (!stationDropdownOpen) {
      return undefined;
    }
    const handleClick = (event: MouseEvent) => {
      if (!stationDropdownRef.current) {
        return;
      }
      if (!stationDropdownRef.current.contains(event.target as Node)) {
        setStationDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setStationDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [stationDropdownOpen]);

  useEffect(() => {
    if (!filterPanelOpen) {
      return undefined;
    }
    const handleClick = (event: MouseEvent) => {
      if (!filterPanelRef.current) {
        return;
      }
      if (!filterPanelRef.current.contains(event.target as Node)) {
        setFilterPanelOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFilterPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [filterPanelOpen]);

  const clearFilters = () => {
    setFilterStation(null);
    setFilterSkill(null);
  };

  const updateDraft = (patch: Partial<WorkerDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateSupervisorDraft = (patch: Partial<SupervisorDraft>) => {
    setSupervisorDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const toggleStation = (stationId: number) => {
    setDraft((prev) => {
      if (!prev) {
        return prev;
      }
      const assigned = new Set(prev.assigned_station_ids);
      if (assigned.has(stationId)) {
        assigned.delete(stationId);
      } else {
        assigned.add(stationId);
      }
      return { ...prev, assigned_station_ids: Array.from(assigned) };
    });
  };

  const toggleSkill = (skillId: number) => {
    setDraft((prev) => {
      if (!prev) {
        return prev;
      }
      const selected = new Set(prev.skill_ids);
      if (selected.has(skillId)) {
        selected.delete(skillId);
      } else {
        selected.add(skillId);
      }
      return { ...prev, skill_ids: Array.from(selected) };
    });
  };

  const handleGeoSelect = (worker: GeoVictoriaWorker) => {
    if (!worker.geovictoria_id || !worker.identifier) {
      setGeoError('La seleccion de GeoVictoria no tiene identificador.');
      return;
    }
    setGeoSelected(worker);
    setGeoQuery('');
    setGeoSuggestions([]);
    setGeoError(null);
    const patch = {
      geovictoria_id: worker.geovictoria_id,
      geovictoria_identifier: worker.identifier,
      first_name: worker.first_name ?? '',
      last_name: worker.last_name ?? '',
    };
    if (isWorkerMode) {
      updateDraft(patch);
    } else {
      updateSupervisorDraft(patch);
    }
  };

  const clearGeoSelection = () => {
    setGeoSelected(null);
    if (isWorkerMode) {
      updateDraft({ geovictoria_id: '', geovictoria_identifier: '' });
    } else {
      updateSupervisorDraft({ geovictoria_id: '', geovictoria_identifier: '' });
    }
  };

  const handleAddWorker = () => {
    setStatusMessage(null);
    setRosterMode('workers');
    setSelectedWorkerId(null);
    setDraft(emptyWorkerDraft());
    setGeoSelected(null);
    setGeoQuery('');
    setGeoSuggestions([]);
    setGeoError(null);
  };

  const handleAddSupervisor = () => {
    setStatusMessage(null);
    setRosterMode('supervisors');
    setSelectedSupervisorId(null);
    setSupervisorDraft(emptySupervisorDraft());
    setGeoSelected(null);
    setGeoQuery('');
    setGeoSuggestions([]);
    setGeoError(null);
  };

  const handleSaveWorker = async (override?: WorkerDraft) => {
    const working = override ?? draft;
    if (!working) {
      return;
    }
    if (!working.first_name.trim() || !working.last_name.trim()) {
      setStatusMessage('Nombre y apellido son obligatorios.');
      return;
    }
    if (!working.geovictoria_id.trim() || !working.geovictoria_identifier.trim()) {
      setStatusMessage(
        'El enlace de GeoVictoria es obligatorio antes de guardar un trabajador.'
      );
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    const payload = {
      geovictoria_id: working.geovictoria_id.trim(),
      geovictoria_identifier: working.geovictoria_identifier.trim(),
      first_name: working.first_name.trim(),
      last_name: working.last_name.trim(),
      pin: working.pin.trim() ? working.pin.trim() : null,
      login_required: working.login_required,
      active: working.active,
      assigned_station_ids: working.assigned_station_ids,
      supervisor_id: working.supervisor_id ?? null,
    };
    try {
      const savedWorker = working.id
        ? await apiRequest<Worker>(`/api/workers/${working.id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await apiRequest<Worker>('/api/workers', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      await apiRequest<Skill[]>(`/api/workers/${savedWorker.id}/skills`, {
        method: 'PUT',
        body: JSON.stringify({ skill_ids: working.skill_ids }),
      });
      setWorkers((prev) => {
        const exists = prev.some((worker) => worker.id === savedWorker.id);
        const next = exists
          ? prev.map((worker) => (worker.id === savedWorker.id ? savedWorker : worker))
          : [...prev, savedWorker];
        return sortWorkers(next);
      });
      setSelectedWorkerId(savedWorker.id);
      setStatusMessage('Cambios guardados.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudieron guardar los cambios.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSupervisor = async (override?: SupervisorDraft) => {
    const working = override ?? supervisorDraft;
    if (!working) {
      return;
    }
    if (!working.first_name.trim() || !working.last_name.trim()) {
      setStatusMessage('First and last name are required.');
      return;
    }
    if (!working.geovictoria_id.trim() || !working.geovictoria_identifier.trim()) {
      setStatusMessage(
        'El enlace de GeoVictoria es obligatorio antes de guardar un supervisor.'
      );
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    const payload = {
      geovictoria_id: working.geovictoria_id.trim(),
      geovictoria_identifier: working.geovictoria_identifier.trim(),
      first_name: working.first_name.trim(),
      last_name: working.last_name.trim(),
      pin: working.pin.trim() ? working.pin.trim() : null,
    };
    try {
      const savedSupervisor = working.id
        ? await apiRequest<WorkerSupervisor>(
            `/api/workers/supervisors/${working.id}`,
            {
              method: 'PUT',
              body: JSON.stringify(payload),
            }
          )
        : await apiRequest<WorkerSupervisor>('/api/workers/supervisors', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      setSupervisors((prev) => {
        const exists = prev.some((supervisor) => supervisor.id === savedSupervisor.id);
        const next = exists
          ? prev.map((supervisor) =>
              supervisor.id === savedSupervisor.id ? savedSupervisor : supervisor
            )
          : [...prev, savedSupervisor];
        return sortSupervisors(next);
      });
      setSelectedSupervisorId(savedSupervisor.id);
      setStatusMessage('Supervisor guardado.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar el supervisor.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    if (!draft) {
      return;
    }
    const updated = { ...draft, active: false };
    setDraft(updated);
    if (updated.id) {
      await handleSaveWorker(updated);
    }
  };

  const workerCanSave =
    !saving &&
    Boolean(draft?.first_name.trim()) &&
    Boolean(draft?.last_name.trim()) &&
    Boolean(draft?.geovictoria_id.trim()) &&
    Boolean(draft?.geovictoria_identifier.trim());

  const supervisorCanSave =
    !saving &&
    Boolean(supervisorDraft?.first_name.trim()) &&
    Boolean(supervisorDraft?.last_name.trim()) &&
    Boolean(supervisorDraft?.geovictoria_id.trim()) &&
    Boolean(supervisorDraft?.geovictoria_identifier.trim());

  const canSave = isWorkerMode ? workerCanSave : supervisorCanSave;

  const rosterSearchValue = isWorkerMode ? workerQuery : supervisorQuery;

  const geoLink = (
    <div>
      <p className="text-sm text-[var(--ink-muted)]">Enlace GeoVictoria</p>
      <div className="relative mt-2">
        <input
          className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
          placeholder="Buscar por nombre o RUT"
          value={geoQuery}
          onChange={(event) => setGeoQuery(event.target.value)}
        />
        {filteredGeoSuggestions.length > 0 && (
          <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-lg">
            {filteredGeoSuggestions.map((item, index) => {
              const name = [item.first_name, item.last_name].filter(Boolean).join(' ');
              const identifier = item.identifier ?? 'RUT faltante';
              const key = item.geovictoria_id ?? item.identifier ?? `${index}`;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleGeoSelect(item)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm text-[var(--ink)] hover:bg-black/5"
                >
                  <div>
                    <p className="font-semibold">{name || 'Trabajador desconocido'}</p>
                    <p className="text-xs text-[var(--ink-muted)]">{identifier}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[var(--ink-muted)]" />
                </button>
              );
            })}
          </div>
        )}
      </div>
      {geoLoading && (
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          Cargando listado de GeoVictoria...
        </p>
      )}
      {geoSearchLoading && !geoLoading && (
        <p className="mt-2 text-xs text-[var(--ink-muted)]">Buscando en GeoVictoria...</p>
      )}
      {geoError && <p className="mt-2 text-xs text-[var(--accent)]">{geoError}</p>}
      {geoSelected && (
        <div className="mt-3 rounded-2xl border border-black/10 bg-[rgba(201,215,245,0.2)] px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-[var(--ink)]">
                {[geoSelected.first_name, geoSelected.last_name]
                  .filter(Boolean)
                  .join(' ') || 'Trabajador de GeoVictoria'}
              </p>
              <p className="text-[var(--ink-muted)]">
                RUT: {geoSelected.identifier ?? 'Desconocido'}
              </p>
            </div>
            <button
              type="button"
              onClick={clearGeoSelection}
              className="rounded-full border border-black/10 px-3 py-1 text-[10px] font-semibold text-[var(--ink)]"
            >
              Limpiar
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {statusMessage && (
        <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-2 text-sm text-[var(--ink-muted)]">
          {statusMessage}
        </div>
      )}

      {!hideRosterTabs && (
        <div className="inline-flex rounded-full border border-black/10 bg-white/70 p-1 text-xs font-semibold text-[var(--ink-muted)]">
          <button
            type="button"
            onClick={() => setRosterMode('workers')}
            className={`rounded-full px-4 py-2 transition-none ${
              rosterMode === 'workers' ? 'bg-black/5 text-[var(--ink)]' : ''
            }`}
          >
            Operadores
          </button>
          <button
            type="button"
            onClick={() => setRosterMode('supervisors')}
            className={`rounded-full px-4 py-2 transition-none ${
              rosterMode === 'supervisors' ? 'bg-black/5 text-[var(--ink)]' : ''
            }`}
          >
            Supervisores
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-black/5 bg-white/80 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-display text-[var(--ink)]">
                {isWorkerMode ? 'Equipo activo' : 'Lista de supervisores'}
              </h2>
              <p className="text-xs text-[var(--ink-muted)]">
                {loading
                  ? 'Cargando operadores...'
                  : isWorkerMode
                  ? `${activeCount} activos de ${workers.length} total`
                  : `${supervisors.length} supervisores registrados`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
                <input
                  type="search"
                  placeholder={isWorkerMode ? 'Buscar trabajador' : 'Buscar supervisor'}
                  className="h-9 rounded-full border border-black/10 bg-white pl-9 pr-4 text-sm"
                  value={rosterSearchValue}
                  onChange={(event) =>
                    isWorkerMode
                      ? setWorkerQuery(event.target.value)
                      : setSupervisorQuery(event.target.value)
                  }
                />
              </label>
              {isWorkerMode && (
                <div className="relative" ref={filterPanelRef}>
                  <button
                    type="button"
                    onClick={() => setFilterPanelOpen((prev) => !prev)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${
                      hasActiveFilters
                        ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.1)] text-[var(--accent)]'
                        : 'border-black/10 bg-white'
                    }`}
                  >
                    <Filter className="h-4 w-4" />
                    Filtros
                    {hasActiveFilters && (
                      <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white">
                        {(filterStation !== null ? 1 : 0) + (filterSkill !== null ? 1 : 0)}
                      </span>
                    )}
                  </button>
                  {filterPanelOpen && (
                    <div className="absolute right-0 z-20 mt-2 w-72 rounded-2xl border border-black/10 bg-white p-4 shadow-lg">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-[var(--ink)]">Filtros</h3>
                        {hasActiveFilters && (
                          <button
                            type="button"
                            onClick={clearFilters}
                            className="text-xs text-[var(--accent)] hover:underline"
                          >
                            Limpiar filtros
                          </button>
                        )}
                      </div>
                      <div className="space-y-3">
                        <label className="block text-xs text-[var(--ink-muted)]">
                          Estacion asignada
                          <select
                            className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                            value={filterStation ?? ''}
                            onChange={(e) =>
                              setFilterStation(e.target.value ? Number(e.target.value) : null)
                            }
                          >
                            <option value="">Todas las estaciones</option>
                            {orderedStations.map((station) => (
                              <option key={station.id} value={station.id}>
                                {station.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs text-[var(--ink-muted)]">
                          Especialidad (skill)
                          <select
                            className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                            value={filterSkill ?? ''}
                            onChange={(e) =>
                              setFilterSkill(e.target.value ? Number(e.target.value) : null)
                            }
                          >
                            <option value="">Todas las especialidades</option>
                            {skills.map((skill) => (
                              <option key={skill.id} value={skill.id}>
                                {skill.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {hasActiveFilters && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--ink-muted)]">Filtros activos:</span>
              {filterStation !== null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(242,98,65,0.1)] px-2 py-1 text-xs text-[var(--accent)]">
                  Estacion: {stationNameById.get(filterStation) ?? 'Desconocida'}
                  <button
                    type="button"
                    onClick={() => setFilterStation(null)}
                    className="ml-1 hover:text-[var(--ink)]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {filterSkill !== null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(242,98,65,0.1)] px-2 py-1 text-xs text-[var(--accent)]">
                  Especialidad: {skills.find((s) => s.id === filterSkill)?.name ?? 'Desconocida'}
                  <button
                    type="button"
                    onClick={() => setFilterSkill(null)}
                    className="ml-1 hover:text-[var(--ink)]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>
          )}

          <div className="mt-4 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden min-h-[400px]">
            {isWorkerMode && workers.length === 0 && !loading && (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                No se encontraron trabajadores. Agrega el primer trabajador para empezar.
              </div>
            )}
            {isWorkerMode && workers.length > 0 && filteredWorkers.length === 0 && !loading && (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                No hay trabajadores que coincidan con la busqueda.
              </div>
            )}
            {!isWorkerMode && supervisors.length === 0 && !loading && (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                No se encontraron supervisores. Agrega el primer supervisor para empezar.
              </div>
            )}
            {!isWorkerMode && supervisors.length > 0 && filteredSupervisors.length === 0 && !loading && (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                No hay supervisores que coincidan con la busqueda.
              </div>
            )}
            
            <div className="divide-y divide-gray-100">
            {isWorkerMode &&
              filteredWorkers.map((worker) => {
                const stationsLabel = worker.assigned_station_ids?.length
                  ? worker.assigned_station_ids
                      .map((id) => stationNameById.get(id) ?? 'Estacion desconocida')
                      .join(', ')
                  : 'Sin asignar';
                const supervisorLabel =
                  worker.supervisor_id != null
                    ? supervisorNameById.get(worker.supervisor_id) ?? 'Supervisor desconocido'
                    : 'Sin asignar';
                const isSelected = selectedWorkerId === worker.id;

                return (
                  <div
                    key={worker.id}
                    className={`group flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${
                      isSelected
                        ? 'bg-blue-50/50'
                        : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium truncate ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                           {worker.first_name} {worker.last_name}
                        </p>
                        {!worker.active && (
                           <span className="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                             Inactivo
                           </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                         <span className="truncate">Estaciones: {stationsLabel}</span>
                         <span className="truncate">Sup: {supervisorLabel}</span>
                         <span className="truncate text-gray-400">
                           RUT: {worker.geovictoria_identifier || 'Sin vincular'}
                         </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                         type="button"
                         onClick={() => {
                           setStatusMessage(null);
                           setSelectedWorkerId(worker.id);
                         }}
                         className={`rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${isSelected ? 'bg-white border-blue-200 text-blue-700 shadow-sm' : 'bg-gray-50 border-gray-200 text-gray-600 group-hover:bg-white group-hover:border-gray-300'}`}
                      >
                        Editar
                      </button>
                    </div>
                  </div>
                );
              })}
            {!isWorkerMode &&
              filteredSupervisors.map((supervisor) => {
                const crewCount = supervisorCrewCounts.get(supervisor.id) ?? 0;
                const isSelected = selectedSupervisorId === supervisor.id;
                
                return (
                  <div
                    key={supervisor.id}
                    className={`group flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${
                      isSelected
                         ? 'bg-blue-50/50'
                         : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex-1 min-w-0 pr-4">
                       <p className={`text-sm font-medium truncate ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                         {supervisor.first_name} {supervisor.last_name}
                       </p>
                       <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                          <span>Equipo: {crewCount} trabajadores</span>
                          <span className="truncate text-gray-400">
                            RUT: {supervisor.geovictoria_identifier || 'Sin vincular'}
                          </span>
                       </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                         type="button"
                         onClick={() => {
                           setStatusMessage(null);
                           setSelectedSupervisorId(supervisor.id);
                         }}
                         className={`rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${isSelected ? 'bg-white border-blue-200 text-blue-700 shadow-sm' : 'bg-gray-50 border-gray-200 text-gray-600 group-hover:bg-white group-hover:border-gray-300'}`}
                      >
                        Editar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          {isWorkerMode ? (
            <section className="rounded-3xl border border-black/5 bg-white/90 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-display text-[var(--ink)] truncate">
                    {draft
                      ? `${draft.first_name || 'Nuevo'} ${draft.last_name || 'Trabajador'}`
                      : 'Nuevo trabajador'}
                  </h2>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {draft?.id ? `Editando #${draft.id}` : 'Nuevo registro'}
                  </p>
                </div>
                <button
                  onClick={handleAddWorker}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Nuevo
                </button>
              </div>

              <div className="mt-3 grid gap-3">
                {geoLink}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-[var(--ink-muted)]">
                    Nombre
                    <input
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={draft?.first_name ?? ''}
                      onChange={(event) => updateDraft({ first_name: event.target.value })}
                    />
                  </label>
                  <label className="text-sm text-[var(--ink-muted)]">
                    Apellido
                    <input
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={draft?.last_name ?? ''}
                      onChange={(event) => updateDraft({ last_name: event.target.value })}
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-[var(--ink-muted)]">
                    PIN
                    <input
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={draft?.pin ?? ''}
                      onChange={(event) => updateDraft({ pin: event.target.value })}
                    />
                  </label>
                  <label className="text-sm text-[var(--ink-muted)]">
                    Estado
                    <select
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={draft?.active ? 'Activo' : 'Inactivo'}
                      onChange={(event) =>
                        updateDraft({ active: event.target.value === 'Activo' })
                      }
                    >
                      <option>Activo</option>
                      <option>Inactivo</option>
                    </select>
                  </label>
                </div>

                <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                  <input
                    type="checkbox"
                    checked={draft?.login_required ?? false}
                    onChange={(event) => updateDraft({ login_required: event.target.checked })}
                  />
                  Inicio de sesion requerido (PIN)
                </label>

                <label className="text-sm text-[var(--ink-muted)]">
                  Supervisor
                  <select
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    value={draft?.supervisor_id ?? ''}
                    onChange={(event) =>
                      updateDraft({
                        supervisor_id: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                    disabled={supervisors.length === 0}
                  >
                    <option value="">Sin asignar</option>
                    {supervisors.map((supervisor) => (
                      <option key={supervisor.id} value={supervisor.id}>
                        {supervisor.first_name} {supervisor.last_name}
                      </option>
                    ))}
                  </select>
                </label>
                {supervisors.length === 0 && (
                  <p className="text-xs text-[var(--ink-muted)]">
                    Aun no hay supervisores registrados.
                  </p>
                )}

                <div>
                  <p className="text-sm text-[var(--ink-muted)]">Estaciones asignadas</p>
                  <div className="relative mt-2" ref={stationDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setStationDropdownOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between gap-2 rounded-2xl border border-black/10 bg-white px-3 py-2 text-left text-sm text-[var(--ink)]"
                    >
                      <span className="truncate">{assignedStationLabel}</span>
                      <ChevronDown
                        className={`h-4 w-4 text-[var(--ink-muted)] transition ${
                          stationDropdownOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {stationDropdownOpen && (
                      <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-lg">
                        {orderedStations.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-[var(--ink-muted)]">
                            No hay estaciones disponibles.
                          </div>
                        ) : (
                          <div className="max-h-56 overflow-auto p-3 text-sm">
                            <div className="flex flex-col gap-2">
                              {orderedStations.map((station) => (
                                <label key={station.id} className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={(draft?.assigned_station_ids ?? []).includes(
                                      station.id
                                    )}
                                    onChange={() => toggleStation(station.id)}
                                  />
                                  <span className="flex items-center gap-2">
                                    <span className="text-[var(--ink)]">{station.name}</span>
                                    {stationSubtitle(station) && (
                                      <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                                        {stationSubtitle(station)}
                                      </span>
                                    )}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-sm text-[var(--ink-muted)]">Cobertura de habilidades</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {skills.map((skill) => (
                      <label
                        key={skill.id}
                        className={`rounded-full border px-3 py-1 text-xs ${
                          (draft?.skill_ids ?? []).includes(skill.id)
                            ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.12)] text-[var(--ink)]'
                            : 'border-black/10 text-[var(--ink-muted)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mr-2"
                          checked={(draft?.skill_ids ?? []).includes(skill.id)}
                          onChange={() => toggleSkill(skill.id)}
                        />
                        {skill.name}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    onClick={() => void handleSaveWorker()}
                    disabled={!canSave}
                    className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Guardar cambios
                  </button>
                  <button
                    onClick={() => void handleDisable()}
                    className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)]"
                  >
                    Desactivar trabajador
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-3xl border border-black/5 bg-white/90 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-display text-[var(--ink)] truncate">
                    {supervisorDraft
                      ? `${supervisorDraft.first_name || 'Nuevo'} ${
                          supervisorDraft.last_name || 'Supervisor'
                        }`
                      : 'Nuevo supervisor'}
                  </h2>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {supervisorDraft?.id
                      ? `Editando #${supervisorDraft.id}`
                      : 'Nuevo registro'}
                  </p>
                </div>
                <button
                  onClick={handleAddSupervisor}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Nuevo
                </button>
              </div>

              <div className="mt-3 grid gap-3">
                {geoLink}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-[var(--ink-muted)]">
                    Nombre
                    <input
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={supervisorDraft?.first_name ?? ''}
                      onChange={(event) =>
                        updateSupervisorDraft({ first_name: event.target.value })
                      }
                    />
                  </label>
                  <label className="text-sm text-[var(--ink-muted)]">
                    Apellido
                    <input
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={supervisorDraft?.last_name ?? ''}
                      onChange={(event) =>
                        updateSupervisorDraft({ last_name: event.target.value })
                      }
                    />
                  </label>
                </div>

                <label className="text-sm text-[var(--ink-muted)]">
                  PIN
                  <input
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    value={supervisorDraft?.pin ?? ''}
                    onChange={(event) => updateSupervisorDraft({ pin: event.target.value })}
                  />
                </label>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    onClick={() => void handleSaveSupervisor()}
                    disabled={!canSave}
                    className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Guardar supervisor
                  </button>
                </div>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
};

export default Workers;
