import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus, Search, Settings, Trash2 } from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayout';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type Skill = {
  id: number;
  name: string;
};

type Worker = {
  id: number;
  first_name: string;
  last_name: string;
  active: boolean;
};

type WorkerSkillAssignment = {
  worker_id: number;
  skill_id: number;
};

type SkillDraft = {
  id?: number;
  name: string;
  worker_ids: number[];
};

const emptySkillDraft = (): SkillDraft => ({
  name: '',
  worker_ids: [],
});

const sortSkills = (list: Skill[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

const sortWorkers = (list: Worker[]) =>
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

const Specialties: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [assignments, setAssignments] = useState<WorkerSkillAssignment[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<number | null>(null);
  const [draft, setDraft] = useState<SkillDraft>(emptySkillDraft());
  const [query, setQuery] = useState('');
  const [workerQuery, setWorkerQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setStatusMessage(null);
      try {
        const [skillData, workerData, assignmentData] = await Promise.all([
          apiRequest<Skill[]>('/api/workers/skills'),
          apiRequest<Worker[]>('/api/workers'),
          apiRequest<WorkerSkillAssignment[]>('/api/workers/skills/assignments'),
        ]);
        if (!active) {
          return;
        }
        const sortedSkills = sortSkills(skillData);
        setSkills(sortedSkills);
        setWorkers(sortWorkers(workerData));
        setAssignments(assignmentData);
        setSelectedSkillId(sortedSkills.length ? sortedSkills[0].id : null);
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error ? error.message : 'No se pudieron cargar las especialidades.';
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

  const assignmentMap = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const assignment of assignments) {
      const list = map.get(assignment.skill_id);
      if (list) {
        list.push(assignment.worker_id);
      } else {
        map.set(assignment.skill_id, [assignment.worker_id]);
      }
    }
    return map;
  }, [assignments]);

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedSkillId) ?? null,
    [selectedSkillId, skills]
  );

  useEffect(() => {
    if (!selectedSkill) {
      setDraft(emptySkillDraft());
      return;
    }
    const workerIds = assignmentMap.get(selectedSkill.id) ?? [];
    setDraft({
      id: selectedSkill.id,
      name: selectedSkill.name,
      worker_ids: workerIds,
    });
  }, [assignmentMap, selectedSkill]);

  const filteredSkills = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return skills;
    }
    return skills.filter((skill) => skill.name.toLowerCase().includes(needle));
  }, [query, skills]);

  const filteredWorkers = useMemo(() => {
    const needle = workerQuery.trim().toLowerCase();
    if (!needle) {
      return workers;
    }
    return workers.filter((worker) => {
      const name = `${worker.first_name} ${worker.last_name}`.toLowerCase();
      return name.includes(needle);
    });
  }, [workerQuery, workers]);

  const assignedWorkers = useMemo(() => {
    const workerMap = new Map(workers.map((worker) => [worker.id, worker]));
    return draft.worker_ids
      .map((workerId) => workerMap.get(workerId))
      .filter((worker): worker is Worker => Boolean(worker));
  }, [draft.worker_ids, workers]);

  const updateDraft = (patch: Partial<SkillDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const toggleWorker = (workerId: number) => {
    setDraft((prev) => {
      const selected = new Set(prev.worker_ids);
      if (selected.has(workerId)) {
        selected.delete(workerId);
      } else {
        selected.add(workerId);
      }
      return { ...prev, worker_ids: Array.from(selected) };
    });
  };

  const handleAddSkill = () => {
    setStatusMessage(null);
    setSelectedSkillId(null);
    setDraft(emptySkillDraft());
  };

  const handleSave = async () => {
    const name = draft.name.trim();
    if (!name) {
      setStatusMessage('El nombre de la especialidad es obligatorio.');
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      const savedSkill = draft.id
        ? await apiRequest<Skill>(`/api/workers/skills/${draft.id}`, {
            method: 'PUT',
            body: JSON.stringify({ name }),
          })
        : await apiRequest<Skill>('/api/workers/skills', {
            method: 'POST',
            body: JSON.stringify({ name }),
          });
      const assigned = await apiRequest<Worker[]>(
        `/api/workers/skills/${savedSkill.id}/workers`,
        {
          method: 'PUT',
          body: JSON.stringify({ worker_ids: draft.worker_ids }),
        }
      );
      setSkills((prev) => {
        const exists = prev.some((skill) => skill.id === savedSkill.id);
        const next = exists
          ? prev.map((skill) => (skill.id === savedSkill.id ? savedSkill : skill))
          : [...prev, savedSkill];
        return sortSkills(next);
      });
      setAssignments((prev) => {
        const remaining = prev.filter((item) => item.skill_id !== savedSkill.id);
        const next = assigned.map((worker) => ({
          worker_id: worker.id,
          skill_id: savedSkill.id,
        }));
        return [...remaining, ...next];
      });
      setSelectedSkillId(savedSkill.id);
      setStatusMessage('Especialidad guardada.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar la especialidad.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft.id) {
      return;
    }
    if (!window.confirm('Eliminar esta especialidad?')) {
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      await apiRequest<void>(`/api/workers/skills/${draft.id}`, {
        method: 'DELETE',
      });
      setSkills((prev) => prev.filter((skill) => skill.id !== draft.id));
      setAssignments((prev) => prev.filter((item) => item.skill_id !== draft.id));
      setSelectedSkillId(null);
      setDraft(emptySkillDraft());
      setStatusMessage('Especialidad eliminada.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo eliminar la especialidad.';
      setStatusMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const canSave = Boolean(draft.name.trim()) && !saving;

  useEffect(() => {
    setHeader({
      title: 'Editor de especialidades',
      kicker: 'Personal / Especialidades',
    });
  }, [setHeader]);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={handleAddSkill}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Nueva especialidad
        </button>
      </div>
      {statusMessage && (
        <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-2 text-sm text-[var(--ink-muted)]">
          {statusMessage}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">Inventario de habilidades</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {loading
                  ? 'Cargando especialidades...'
                  : `${skills.length} especialidades configuradas`}
              </p>
            </div>
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-gray-400" />
              <input
                type="search"
                placeholder="Buscar..."
                className="h-8 rounded-md border border-gray-200 bg-white pl-9 pr-3 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>

          <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {filteredSkills.length === 0 && !loading ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                {skills.length === 0 && !query
                  ? 'Aun no hay especialidades.'
                  : 'No hay especialidades que coincidan con tu busqueda.'}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredSkills.map((skill) => {
                  const workerCount = assignmentMap.get(skill.id)?.length ?? 0;
                  const isSelected = selectedSkillId === skill.id;
                  
                  return (
                    <button
                      key={skill.id}
                      onClick={() => {
                        setStatusMessage(null);
                        setSelectedSkillId(skill.id);
                      }}
                      className={`group flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? 'bg-blue-50/50'
                          : 'bg-white hover:bg-gray-50'
                      }`}
                    >
                      <div>
                         <p className={`text-sm font-medium ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>{skill.name}</p>
                      </div>
                      <div className="flex items-center gap-3">
                         <span className="text-xs text-gray-500">
                           {workerCount} trabajadores
                         </span>
                         <ChevronRight className={`h-4 w-4 text-gray-300 transition-colors ${isSelected ? 'text-blue-300' : 'group-hover:text-gray-400'}`} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Editar</p>
              <h2 className="text-lg font-display text-[var(--ink)]">
                {draft.name || selectedSkill?.name || 'Nueva especialidad'}
              </h2>
            </div>
            <Settings className="h-5 w-5 text-[var(--ink-muted)]" />
          </div>

          <div className="mt-4 space-y-4">
            <label className="text-sm text-[var(--ink-muted)]">
              Nombre de la especialidad
              <input
                className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
              />
            </label>

            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-[var(--ink-muted)]">
                  Trabajadores asignados ({assignedWorkers.length})
                </p>
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[var(--ink-muted)]" />
                  <input
                    type="search"
                    placeholder="Buscar trabajadores"
                    className="h-8 rounded-full border border-black/10 bg-white pl-8 pr-3 text-xs"
                    value={workerQuery}
                    onChange={(event) => setWorkerQuery(event.target.value)}
                  />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {assignedWorkers.length === 0 && (
                  <span className="text-xs text-[var(--ink-muted)]">
                    Aun no hay trabajadores asignados.
                  </span>
                )}
                {assignedWorkers.map((worker) => (
                  <span
                    key={worker.id}
                    className="rounded-full bg-[rgba(47,107,79,0.12)] px-3 py-1 text-xs text-[var(--leaf)]"
                  >
                    {worker.first_name} {worker.last_name}
                  </span>
                ))}
              </div>
              <div className="mt-3 max-h-40 overflow-auto rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.2)] p-3 text-xs">
                {filteredWorkers.length === 0 && (
                  <p className="text-[var(--ink-muted)]">No se encontraron trabajadores.</p>
                )}
                {filteredWorkers.map((worker) => {
                  const checked = draft.worker_ids.includes(worker.id);
                  return (
                    <label key={worker.id} className="flex items-center gap-2 py-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleWorker(worker.id)}
                      />
                      <span>
                        {worker.first_name} {worker.last_name}
                      </span>
                      {!worker.active && (
                        <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] text-[var(--ink-muted)]">
                          Inactivo
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void handleSave()}
                disabled={!canSave}
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Guardar especialidad
              </button>
              {draft.id && (
                <button
                  onClick={() => void handleDelete()}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)]"
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

    </div>
  );
};

export default Specialties;
