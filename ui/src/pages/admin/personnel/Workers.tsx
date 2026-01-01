import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Filter,
  Plus,
  Search,
  Shield,
  Users,
} from 'lucide-react';

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
    throw new Error(text || `Request failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

const Workers: React.FC = () => {
  const [rosterMode, setRosterMode] = useState<RosterMode>('workers');
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
  const stationDropdownRef = useRef<HTMLDivElement | null>(null);

  const isWorkerMode = rosterMode === 'workers';

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
          const message = error instanceof Error ? error.message : 'Failed to load workers.';
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
              : 'Failed to load GeoVictoria workers.';
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
              : 'Failed to search GeoVictoria.';
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
            error instanceof Error ? error.message : 'Failed to load worker skills.';
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
    const query = normalizeSearchValue(workerQuery.trim());
    if (!query) {
      return workers;
    }
    return workers.filter((worker) => {
      const haystack = normalizeSearchValue(
        [
          worker.first_name,
          worker.last_name,
          worker.geovictoria_identifier ?? '',
        ].join(' ')
      );
      return haystack.includes(query);
    });
  }, [workerQuery, workers]);
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
    station.role === 'Assembly' && station.line_type ? `línea ${station.line_type}` : null;

  const assignedStationNames = useMemo(() => {
    if (!draft?.assigned_station_ids) {
      return [];
    }
    return draft.assigned_station_ids.map((id) => stationNameById.get(id) ?? 'Unknown station');
  }, [draft?.assigned_station_ids, stationNameById]);

  const assignedStationLabel = useMemo(() => {
    if (assignedStationNames.length === 0) {
      return 'No stations selected';
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
      setGeoError('GeoVictoria selection is missing an identifier.');
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
      setStatusMessage('First and last name are required.');
      return;
    }
    if (!working.geovictoria_id.trim() || !working.geovictoria_identifier.trim()) {
      setStatusMessage('GeoVictoria link is required before saving a worker.');
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
      setStatusMessage('Changes saved.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save changes.';
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
      setStatusMessage('GeoVictoria link is required before saving a supervisor.');
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
      setStatusMessage('Supervisor saved.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save supervisor.';
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
      <p className="text-sm text-[var(--ink-muted)]">GeoVictoria link</p>
      <div className="relative mt-2">
        <input
          className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
          placeholder="Search by name or RUT"
          value={geoQuery}
          onChange={(event) => setGeoQuery(event.target.value)}
        />
        {filteredGeoSuggestions.length > 0 && (
          <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-lg">
            {filteredGeoSuggestions.map((item, index) => {
              const name = [item.first_name, item.last_name].filter(Boolean).join(' ');
              const identifier = item.identifier ?? 'Missing RUT';
              const key = item.geovictoria_id ?? item.identifier ?? `${index}`;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleGeoSelect(item)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm text-[var(--ink)] hover:bg-black/5"
                >
                  <div>
                    <p className="font-semibold">{name || 'Unknown worker'}</p>
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
          Loading GeoVictoria roster...
        </p>
      )}
      {geoSearchLoading && !geoLoading && (
        <p className="mt-2 text-xs text-[var(--ink-muted)]">Searching GeoVictoria...</p>
      )}
      {geoError && <p className="mt-2 text-xs text-[var(--accent)]">{geoError}</p>}
      {geoSelected && (
        <div className="mt-3 rounded-2xl border border-black/10 bg-[rgba(201,215,245,0.2)] px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-[var(--ink)]">
                {[geoSelected.first_name, geoSelected.last_name]
                  .filter(Boolean)
                  .join(' ') || 'GeoVictoria worker'}
              </p>
              <p className="text-[var(--ink-muted)]">
                RUT: {geoSelected.identifier ?? 'Unknown'}
              </p>
            </div>
            <button
              type="button"
              onClick={clearGeoSelection}
              className="rounded-full border border-black/10 px-3 py-1 text-[10px] font-semibold text-[var(--ink)]"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Personnel / Workers
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">Worker Directory</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Create, assign, and manage operator profiles with station coverage and skills.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={isWorkerMode ? handleAddWorker : handleAddSupervisor}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm"
          >
            <Plus className="h-4 w-4" /> {isWorkerMode ? 'Add Worker' : 'Add Supervisor'}
          </button>
        </div>
      </header>
      {statusMessage && (
        <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-2 text-sm text-[var(--ink-muted)]">
          {statusMessage}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-black/5 bg-white/80 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">
                {isWorkerMode ? 'Active Crew' : 'Supervisor Roster'}
              </h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {loading
                  ? 'Loading operators...'
                  : isWorkerMode
                  ? `${activeCount} active of ${workers.length} total`
                  : `${supervisors.length} supervisors on file`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex rounded-full border border-black/10 bg-white p-1 text-xs font-semibold text-[var(--ink-muted)]">
                <button
                  type="button"
                  onClick={() => setRosterMode('workers')}
                  className={`rounded-full px-3 py-1 transition ${
                    isWorkerMode ? 'bg-black/5 text-[var(--ink)]' : ''
                  }`}
                >
                  Workers
                </button>
                <button
                  type="button"
                  onClick={() => setRosterMode('supervisors')}
                  className={`rounded-full px-3 py-1 transition ${
                    !isWorkerMode ? 'bg-black/5 text-[var(--ink)]' : ''
                  }`}
                >
                  Supervisors
                </button>
              </div>
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
                <input
                  type="search"
                  placeholder={isWorkerMode ? 'Search worker' : 'Search supervisor'}
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
                <button className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm">
                  <Filter className="h-4 w-4" /> Filters
                </button>
              )}
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {isWorkerMode && workers.length === 0 && !loading && (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
                No workers found. Add the first worker to get started.
              </div>
            )}
            {isWorkerMode && workers.length > 0 && filteredWorkers.length === 0 && !loading && (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
                No workers match that search.
              </div>
            )}
            {!isWorkerMode && supervisors.length === 0 && !loading && (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
                No supervisors found. Add the first supervisor to get started.
              </div>
            )}
            {!isWorkerMode && supervisors.length > 0 && filteredSupervisors.length === 0 && !loading && (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
                No supervisors match that search.
              </div>
            )}
            {isWorkerMode &&
              filteredWorkers.map((worker, index) => {
                const stationsLabel = worker.assigned_station_ids?.length
                  ? worker.assigned_station_ids
                      .map((id) => stationNameById.get(id) ?? 'Unknown station')
                      .join(', ')
                  : 'Unassigned';
                const supervisorLabel =
                  worker.supervisor_id != null
                    ? supervisorNameById.get(worker.supervisor_id) ?? 'Unknown supervisor'
                    : 'Unassigned';
                return (
                  <div
                    key={worker.id}
                    className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
                      selectedWorkerId === worker.id
                        ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
                        : 'border-black/5 bg-white'
                    }`}
                    style={{ animationDelay: `${index * 80}ms` }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--sky)] text-[var(--ink)]">
                        <Users className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-[var(--ink)]">
                            {worker.first_name} {worker.last_name}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setStatusMessage(null);
                              setSelectedWorkerId(worker.id);
                            }}
                            className="rounded-full border border-black/10 px-2 py-0.5 text-xs font-semibold text-[var(--ink)] hover:bg-black/5"
                          >
                            Edit
                          </button>
                          {worker.active && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(47,107,79,0.15)] px-2 py-0.5 text-xs text-[var(--leaf)]">
                              <BadgeCheck className="h-3 w-3" /> Active
                            </span>
                          )}
                          {!worker.active && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-black/10 px-2 py-0.5 text-xs text-[var(--ink-muted)]">
                              Inactive
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--ink-muted)]">
                          Stations: {stationsLabel}
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          Supervisor: {supervisorLabel}
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          RUT: {worker.geovictoria_identifier || 'Unlinked'}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[var(--ink-muted)]" />
                  </div>
                );
              })}
            {!isWorkerMode &&
              filteredSupervisors.map((supervisor, index) => {
                const crewCount = supervisorCrewCounts.get(supervisor.id) ?? 0;
                return (
                  <div
                    key={supervisor.id}
                    className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
                      selectedSupervisorId === supervisor.id
                        ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
                        : 'border-black/5 bg-white'
                    }`}
                    style={{ animationDelay: `${index * 80}ms` }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(47,107,79,0.12)] text-[var(--leaf)]">
                        <Shield className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-[var(--ink)]">
                            {supervisor.first_name} {supervisor.last_name}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setStatusMessage(null);
                              setSelectedSupervisorId(supervisor.id);
                            }}
                            className="rounded-full border border-black/10 px-2 py-0.5 text-xs font-semibold text-[var(--ink)] hover:bg-black/5"
                          >
                            Edit
                          </button>
                        </div>
                        <p className="text-xs text-[var(--ink-muted)]">
                          Crew: {crewCount} workers
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          RUT: {supervisor.geovictoria_identifier || 'Unlinked'}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[var(--ink-muted)]" />
                  </div>
                );
              })}
          </div>
        </section>

        <aside className="space-y-6">
          {isWorkerMode ? (
            <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                    Detail + Edit
                  </p>
                  <h2 className="text-lg font-display text-[var(--ink)]">
                    {draft
                      ? `${draft.first_name || 'New'} ${draft.last_name || 'Worker'}`
                      : 'New worker'}
                  </h2>
                </div>
                <span className="rounded-full border border-black/10 px-3 py-1 text-xs text-[var(--ink-muted)]">
                  {draft?.id ? `Editing ${draft.id}` : 'New'}
                </span>
              </div>

              <div className="mt-4 grid gap-4">
                {geoLink}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-[var(--ink-muted)]">
                    First name
                    <input
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={draft?.first_name ?? ''}
                      onChange={(event) => updateDraft({ first_name: event.target.value })}
                    />
                  </label>
                  <label className="text-sm text-[var(--ink-muted)]">
                    Last name
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
                    Status
                    <select
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={draft?.active ? 'Active' : 'Inactive'}
                      onChange={(event) =>
                        updateDraft({ active: event.target.value === 'Active' })
                      }
                    >
                      <option>Active</option>
                      <option>Inactive</option>
                    </select>
                  </label>
                </div>

                <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                  <input
                    type="checkbox"
                    checked={draft?.login_required ?? false}
                    onChange={(event) => updateDraft({ login_required: event.target.checked })}
                  />
                  Login required (PIN)
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
                    <option value="">Unassigned</option>
                    {supervisors.map((supervisor) => (
                      <option key={supervisor.id} value={supervisor.id}>
                        {supervisor.first_name} {supervisor.last_name}
                      </option>
                    ))}
                  </select>
                </label>
                {supervisors.length === 0 && (
                  <p className="text-xs text-[var(--ink-muted)]">
                    No supervisors on file yet.
                  </p>
                )}

                <div>
                  <p className="text-sm text-[var(--ink-muted)]">Assigned stations</p>
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
                            No stations available.
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
                  <p className="text-sm text-[var(--ink-muted)]">Skill coverage</p>
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
                    Save changes
                  </button>
                  <button
                    onClick={() => void handleDisable()}
                    className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)]"
                  >
                    Disable worker
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                    Detail + Edit
                  </p>
                  <h2 className="text-lg font-display text-[var(--ink)]">
                    {supervisorDraft
                      ? `${supervisorDraft.first_name || 'New'} ${
                          supervisorDraft.last_name || 'Supervisor'
                        }`
                      : 'New supervisor'}
                  </h2>
                </div>
                <span className="rounded-full border border-black/10 px-3 py-1 text-xs text-[var(--ink-muted)]">
                  {supervisorDraft?.id ? `Editing ${supervisorDraft.id}` : 'New'}
                </span>
              </div>

              <div className="mt-4 grid gap-4">
                {geoLink}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-[var(--ink-muted)]">
                    First name
                    <input
                      className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                      value={supervisorDraft?.first_name ?? ''}
                      onChange={(event) =>
                        updateSupervisorDraft({ first_name: event.target.value })
                      }
                    />
                  </label>
                  <label className="text-sm text-[var(--ink-muted)]">
                    Last name
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
                    Save supervisor
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
