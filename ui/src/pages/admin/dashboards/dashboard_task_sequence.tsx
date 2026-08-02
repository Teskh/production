import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { HelpCircle, Info, RefreshCcw } from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';
import { formatMinutesWithUnit } from '../../../utils/timeUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type TaskScope = 'panel' | 'module';
type StatMode = 'median' | 'mean';
type RankBy = 'start' | 'completion';
type ViewTab = 'sequence' | 'table';

type HouseType = {
  id: number;
  name: string;
  number_of_modules: number;
};

type PanelDefinition = {
  id: number;
  house_type_id: number;
  module_sequence_number: number;
  panel_sequence_number: number | null;
  group: string;
  panel_code: string;
};

type ProjectOption = {
  project_name: string;
};

type SequenceStat = {
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
};

type StationShare = {
  station_id: number;
  station_name: string | null;
  sequence_order: number | null;
  count: number;
  share: number;
};

type SequenceTaskRow = {
  task_definition_id: number;
  task_name: string;
  sample_count: number;
  instance_count: number;
  outlier_excluded_count: number;
  rank: SequenceStat;
  start_fraction: SequenceStat;
  end_fraction: SequenceStat;
  duration_minutes: SequenceStat;
  expected_minutes: number | null;
  order_consistency: number | null;
  concurrency_share: number | null;
  planned_station_sequence: number | null;
  dominant_station_name: string | null;
  stations: StationShare[];
};

type SequenceSummary = {
  unit_count: number;
  units_with_order: number;
  instance_count: number;
  outlier_excluded_count: number;
  rework_excluded_count: number;
  missing_timestamp_count: number;
};

type SequenceResponse = {
  scope: string;
  house_type_id: number;
  panel_definition_id: number | null;
  module_number: number | null;
  project_name: string | null;
  rank_by: string;
  summary: SequenceSummary;
  tasks: SequenceTaskRow[];
};

const apiRequest = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let message = 'No se pudo completar la solicitud.';
    try {
      const payload = await response.json();
      if (payload?.detail) {
        message = String(payload.detail);
      }
    } catch {
      // Keep default message.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
};

const toDateInputValue = (date: Date) => date.toISOString().slice(0, 10);

const STATION_COLORS = [
  '#2563eb',
  '#0d9488',
  '#d97706',
  '#7c3aed',
  '#dc2626',
  '#0891b2',
  '#65a30d',
  '#db2777',
  '#4f46e5',
  '#b45309',
  '#059669',
  '#9333ea',
];

const stationColor = (row: SequenceTaskRow): string => {
  const dominant = row.stations[0];
  if (!dominant) {
    return '#94a3b8';
  }
  const key =
    dominant.sequence_order != null ? dominant.sequence_order : dominant.station_id;
  return STATION_COLORS[Math.abs(key) % STATION_COLORS.length];
};

const statValue = (stat: SequenceStat, mode: StatMode): number | null =>
  mode === 'median' ? stat.median : stat.mean;

const formatPercent = (value: number | null | undefined, digits = 0): string =>
  value == null ? '-' : `${(value * 100).toFixed(digits)}%`;

const ratioTone = (ratio: number | null): string => {
  if (ratio == null) {
    return 'text-[var(--ink-muted)]';
  }
  if (ratio <= 1.1) {
    return 'text-emerald-700';
  }
  if (ratio <= 1.5) {
    return 'text-amber-700';
  }
  return 'text-red-600';
};

const DashboardTaskSequence: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [houseTypes, setHouseTypes] = useState<HouseType[]>([]);
  const [panelDefinitions, setPanelDefinitions] = useState<PanelDefinition[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [houseTypeId, setHouseTypeId] = useState<string>('');
  const [scope, setScope] = useState<TaskScope>('panel');
  const [panelDefinitionId, setPanelDefinitionId] = useState<string>('');
  const [moduleNumber, setModuleNumber] = useState<string>('1');
  const [projectName, setProjectName] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>(() => {
    const start = new Date();
    start.setDate(start.getDate() - 90);
    return toDateInputValue(start);
  });
  const [toDate, setToDate] = useState<string>(() => toDateInputValue(new Date()));
  const [minRatio, setMinRatio] = useState<string>('0.1');
  const [maxRatio, setMaxRatio] = useState<string>('2.5');
  const [includeRework, setIncludeRework] = useState(false);
  const [rankBy, setRankBy] = useState<RankBy>('start');
  const [statMode, setStatMode] = useState<StatMode>('median');
  const [activeTab, setActiveTab] = useState<ViewTab>('sequence');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<SequenceResponse | null>(null);

  useEffect(() => {
    setHeader({
      title: 'Secuencia de tareas',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  useEffect(() => {
    let active = true;
    const loadFilters = async () => {
      try {
        const [houseTypesResponse, panelsResponse] = await Promise.all([
          apiRequest<HouseType[]>('/api/house-types'),
          apiRequest<PanelDefinition[]>('/api/panel-definitions'),
        ]);
        if (!active) {
          return;
        }
        const orderedHouseTypes = Array.isArray(houseTypesResponse)
          ? houseTypesResponse
          : [];
        setHouseTypes(orderedHouseTypes);
        setPanelDefinitions(Array.isArray(panelsResponse) ? panelsResponse : []);
        if (orderedHouseTypes.length > 0) {
          setHouseTypeId((current) => current || String(orderedHouseTypes[0].id));
        }
      } catch {
        if (!active) {
          return;
        }
        setHouseTypes([]);
        setPanelDefinitions([]);
      }
    };
    void loadFilters();
    return () => {
      active = false;
    };
  }, []);

  const selectedHouseType = useMemo(
    () => houseTypes.find((houseType) => String(houseType.id) === houseTypeId) ?? null,
    [houseTypeId, houseTypes],
  );

  const housePanels = useMemo(() => {
    if (!houseTypeId) {
      return [];
    }
    return panelDefinitions
      .filter((panel) => String(panel.house_type_id) === houseTypeId)
      .sort((a, b) => {
        if (a.module_sequence_number !== b.module_sequence_number) {
          return a.module_sequence_number - b.module_sequence_number;
        }
        return (a.panel_sequence_number ?? 0) - (b.panel_sequence_number ?? 0);
      });
  }, [houseTypeId, panelDefinitions]);

  useEffect(() => {
    if (scope !== 'panel') {
      return;
    }
    const exists = housePanels.some((panel) => String(panel.id) === panelDefinitionId);
    if (!exists) {
      setPanelDefinitionId(housePanels.length > 0 ? String(housePanels[0].id) : '');
    }
  }, [housePanels, panelDefinitionId, scope]);

  const moduleOptions = useMemo(() => {
    const count = selectedHouseType?.number_of_modules ?? 0;
    return Array.from({ length: Math.max(count, 1) }, (_, index) => index + 1);
  }, [selectedHouseType]);

  useEffect(() => {
    if (!moduleOptions.includes(Number(moduleNumber))) {
      setModuleNumber(String(moduleOptions[0] ?? 1));
    }
  }, [moduleNumber, moduleOptions]);

  useEffect(() => {
    if (!houseTypeId) {
      setProjects([]);
      return;
    }
    let active = true;
    const loadProjects = async () => {
      try {
        const response = await apiRequest<ProjectOption[]>(
          `/api/task-sequence/projects?house_type_id=${houseTypeId}`,
        );
        if (!active) {
          return;
        }
        setProjects(Array.isArray(response) ? response : []);
      } catch {
        if (active) {
          setProjects([]);
        }
      }
    };
    void loadProjects();
    return () => {
      active = false;
    };
  }, [houseTypeId]);

  useEffect(() => {
    if (projectName && !projects.some((project) => project.project_name === projectName)) {
      setProjectName('');
    }
  }, [projectName, projects]);

  const loadData = useCallback(async () => {
    if (!houseTypeId) {
      return;
    }
    if (scope === 'panel' && !panelDefinitionId) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('house_type_id', houseTypeId);
      params.set('scope', scope);
      if (scope === 'panel') {
        params.set('panel_definition_id', panelDefinitionId);
      } else {
        params.set('module_number', moduleNumber);
      }
      if (projectName) {
        params.set('project_name', projectName);
      }
      if (fromDate) {
        params.set('from_date', `${fromDate}T00:00:00`);
      }
      if (toDate) {
        params.set('to_date', `${toDate}T23:59:59`);
      }
      const minRatioValue = Number(minRatio);
      const maxRatioValue = Number(maxRatio);
      if (minRatio.trim() && Number.isFinite(minRatioValue) && minRatioValue >= 0) {
        params.set('min_ratio', String(minRatioValue));
      }
      if (maxRatio.trim() && Number.isFinite(maxRatioValue) && maxRatioValue > 0) {
        params.set('max_ratio', String(maxRatioValue));
      }
      if (includeRework) {
        params.set('include_rework', 'true');
      }
      params.set('rank_by', rankBy);
      const response = await apiRequest<SequenceResponse>(
        `/api/task-sequence?${params.toString()}`,
      );
      setData(response);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo cargar la secuencia.';
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [
    fromDate,
    houseTypeId,
    includeRework,
    maxRatio,
    minRatio,
    moduleNumber,
    panelDefinitionId,
    projectName,
    rankBy,
    scope,
    toDate,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const sortedTasks = useMemo(() => {
    const tasks = data?.tasks ?? [];
    return [...tasks].sort((a, b) => {
      const rankA = statValue(a.rank, statMode);
      const rankB = statValue(b.rank, statMode);
      if (rankA != null && rankB != null && rankA !== rankB) {
        return rankA - rankB;
      }
      if ((rankA == null) !== (rankB == null)) {
        return rankA == null ? 1 : -1;
      }
      const startA = statValue(a.start_fraction, statMode) ?? 2;
      const startB = statValue(b.start_fraction, statMode) ?? 2;
      if (startA !== startB) {
        return startA - startB;
      }
      return a.task_name.localeCompare(b.task_name);
    });
  }, [data?.tasks, statMode]);

  const stationLegend = useMemo(() => {
    const seen = new Map<number, { name: string; color: string }>();
    sortedTasks.forEach((task) => {
      const dominant = task.stations[0];
      if (!dominant || seen.has(dominant.station_id)) {
        return;
      }
      seen.set(dominant.station_id, {
        name: dominant.station_name ?? `Estacion ${dominant.station_id}`,
        color: stationColor(task),
      });
    });
    return Array.from(seen.values());
  }, [sortedTasks]);

  const summary = data?.summary ?? null;

  const renderStatToggle = (
    value: string,
    options: { key: string; label: string }[],
    onChange: (key: string) => void,
  ) => (
    <div className="flex overflow-hidden rounded-full border border-black/10">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={
            value === option.key
              ? 'bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-white'
              : 'bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]'
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Tipo de casa
            <select
              value={houseTypeId}
              onChange={(event) => setHouseTypeId(event.target.value)}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
            >
              {houseTypes.map((houseType) => (
                <option key={houseType.id} value={houseType.id}>
                  {houseType.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Alcance
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as TaskScope)}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
            >
              <option value="panel">Panel</option>
              <option value="module">Modulo</option>
            </select>
          </label>
          {scope === 'panel' ? (
            <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Panel
              <select
                value={panelDefinitionId}
                onChange={(event) => setPanelDefinitionId(event.target.value)}
                className="max-w-[240px] rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
              >
                {housePanels.map((panel) => (
                  <option key={panel.id} value={panel.id}>
                    M{panel.module_sequence_number} · {panel.panel_code}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Modulo
              <select
                value={moduleNumber}
                onChange={(event) => setModuleNumber(event.target.value)}
                className="rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
              >
                {moduleOptions.map((option) => (
                  <option key={option} value={option}>
                    Modulo {option}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Proyecto
            <select
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              className="max-w-[220px] rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
            >
              <option value="">Todos</option>
              {projects.map((project) => (
                <option key={project.project_name} value={project.project_name}>
                  {project.project_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Desde
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Hasta
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Ratio min
            <input
              type="number"
              min={0}
              step={0.05}
              value={minRatio}
              onChange={(event) => setMinRatio(event.target.value)}
              className="w-24 rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Ratio max
            <input
              type="number"
              min={0}
              step={0.1}
              value={maxRatio}
              onChange={(event) => setMaxRatio(event.target.value)}
              className="w-24 rounded-xl border border-black/10 px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]"
            />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-[var(--ink)]">
            <input
              type="checkbox"
              checked={includeRework}
              onChange={(event) => setIncludeRework(event.target.checked)}
            />
            Incluir retrabajos
          </label>
          <button
            type="button"
            onClick={() => void loadData()}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white"
            disabled={loading}
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refrescar
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Estadistica
            </span>
            {renderStatToggle(
              statMode,
              [
                { key: 'median', label: 'Mediana' },
                { key: 'mean', label: 'Promedio' },
              ],
              (key) => setStatMode(key as StatMode),
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Ordenar por
            </span>
            {renderStatToggle(
              rankBy,
              [
                { key: 'start', label: 'Inicio' },
                { key: 'completion', label: 'Termino' },
              ],
              (key) => setRankBy(key as RankBy),
            )}
          </div>
          <p className="flex min-w-0 flex-1 items-center gap-2 text-xs text-[var(--ink-muted)]">
            <Info className="h-4 w-4 shrink-0" />
            Cada unidad se normaliza de 0% (primera tarea) a 100% (ultima tarea); las
            barras muestran la posicion {statMode === 'median' ? 'mediana' : 'promedio'}
            {' '}de cada tarea. Barras que se superponen indican trabajo concurrente.
          </p>
          <div className="group relative">
            <button
              type="button"
              aria-label="Como leer este dashboard"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 text-[var(--ink-muted)] hover:bg-black/5"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
            <div className="absolute right-0 top-full z-30 hidden max-h-[75vh] w-[680px] max-w-[85vw] overflow-y-auto rounded-xl border border-black/10 bg-white p-5 text-xs leading-relaxed text-[var(--ink)] shadow-xl group-hover:block">
              <p className="mb-1 text-sm font-semibold">Como leer este dashboard</p>
              <p className="mb-3 text-[var(--ink-muted)]">
                Reconstruye, a partir de los timestamps reales de las tareas completadas,
                el flujo tipico con que se ejecuta una unidad (un panel o un modulo):
                en que orden ocurren las tareas, en que parte del proceso caen, cuanto
                trabajo real toman y que tan estable es ese patron.
              </p>

              <p className="mb-1 font-semibold">1. La normalizacion (el eje X)</p>
              <p className="mb-3 text-[var(--ink-muted)]">
                Cada unidad tiene su propio reloj: 0% es el inicio de su primera tarea y
                100% el termino de su ultima tarea. El inicio y fin de cada tarea se
                convierten a porcentaje de ese recorrido, y luego se toma la{' '}
                {statMode === 'median' ? 'mediana' : 'media'} entre todas las unidades.
                Se usa porcentaje y no minutos porque las unidades varian enormemente en
                duracion total (esperas, noches, fines de semana): en minutos absolutos,
                unas pocas unidades lentas dominarian el grafico y la posicion mediria
                principalmente tiempo de espera, no secuencia. Ojo: el porcentaje corre
                sobre tiempo calendario, asi que una noche de por medio &quot;empuja&quot;
                las tareas siguientes hacia la derecha.
              </p>

              <p className="mb-1 font-semibold">2. La barra solida</p>
              <p className="mb-3 text-[var(--ink-muted)]">
                Va desde el inicio tipico hasta el fin tipico de la tarea (en % del
                recorrido de la unidad). Representa la <b>ventana de calendario</b> en que
                la tarea estuvo abierta, no los minutos trabajados: una tarea con pausas
                largas o que quedo abierta durante la noche tiene una barra larga aunque
                el trabajo real haya sido corto. Por eso una barra puede ser chica aunque
                la tarea &quot;tome tiempo&quot; (trabajo concentrado en una unidad de
                recorrido largo) o grande aunque el trabajo sea poco (ventana abierta con
                esperas). Los minutos realmente trabajados — descontando pausas y horas
                fuera de turno — estan en la columna Duracion.
              </p>

              <p className="mb-1 font-semibold">3. La barra tenue detras</p>
              <p className="mb-3 text-[var(--ink-muted)]">
                Es la banda de variabilidad: desde el percentil 25 del inicio hasta el
                percentil 75 del fin. Ahi cae la mitad central de las observaciones.
                Banda angosta = la tarea ocurre casi siempre en el mismo punto del flujo;
                banda ancha = la tarea &quot;flota&quot; y se ejecuta en momentos muy
                distintos segun la unidad.
              </p>

              <p className="mb-1 font-semibold">4. El orden vertical (y por que puede no coincidir con las barras)</p>
              <p className="mb-3 text-[var(--ink-muted)]">
                Las filas se ordenan por <b>rank {statMode === 'median' ? 'mediano' : 'promedio'}</b>:
                en cada unidad las tareas se numeran 1, 2, 3... segun su hora de inicio
                (o termino, segun el selector), se normaliza por la cantidad de tareas y
                se agrega entre unidades. El rank mide <b>orden puro</b> — cuantas tareas
                partieron antes — e ignora las brechas de tiempo, por eso es robusto
                frente a demoras extremas. La barra, en cambio, mide <b>posicion en el
                tiempo</b>. Son estadisticas distintas y pueden discrepar: una tarea que
                tipicamente es la 15a en orden, pero que cuando se atrasa se atrasa
                muchisimo, puede tener una barra que empieza despues que la de la 16a.
                Esa discrepancia es informacion: indica una tarea que mantiene su lugar
                en la fila pero con atrasos severos cuando ocurre tarde.
              </p>

              <p className="mb-1 font-semibold">5. Consistencia</p>
              <p className="mb-3 text-[var(--ink-muted)]">
                Para cada par de tareas se cuenta en que fraccion de las unidades se
                respeto la relacion antes/despues del orden consenso. 100% = la tarea
                ocupa siempre la misma posicion relativa; cerca de 50% = su posicion es
                practicamente aleatoria respecto a las demas.
              </p>

              <p className="mb-1 font-semibold">6. Concurrencia</p>
              <p className="mb-3 text-[var(--ink-muted)]">
                Porcentaje de unidades en que la ventana de esta tarea se traslapo en el
                tiempo con la de otra tarea de la misma unidad: trabajo en paralelo.
                Visualmente, las barras que se superponen verticalmente indican etapas
                que conviven.
              </p>

              <p className="mb-1 font-semibold">7. Duracion, esperado y filtro de outliers</p>
              <p className="mb-3 text-[var(--ink-muted)]">
                Duracion = minutos activos ({statMode === 'median' ? 'mediana' : 'promedio'}{' '}
                entre unidades), descontando pausas y tiempo fuera de turno, comparados
                contra el tiempo esperado configurado (el ratio se colorea: verde ≤1.1x,
                ambar ≤1.5x, rojo mayor). Los filtros Ratio min/max excluyen del analisis
                los registros cuya duracion cae fuera de esos multiplos del esperado
                (datos mal registrados o atipicos); la cantidad excluida se muestra
                arriba. Con n bajo (pocas unidades) los resultados son poco confiables.
              </p>

              <p className="mb-1 font-semibold">Que conclusiones permite sacar</p>
              <ul className="list-disc space-y-1 pl-4 text-[var(--ink-muted)]">
                <li>
                  La &quot;escalera&quot; de barras es el flujo real de produccion; si
                  difiere del orden planificado (Sec. plan en el tooltip), hay tareas que
                  se ejecutan fuera de su posicion prevista.
                </li>
                <li>
                  Consistencia baja + banda ancha = tarea sin lugar definido en el
                  proceso: candidata a estandarizar o cuya posicion depende de otra cosa
                  (dotacion, material).
                </li>
                <li>
                  Barra larga con duracion corta = tarea que permanece abierta esperando
                  (pausas, bloqueos): candidata a investigar el motivo de espera, no la
                  velocidad de trabajo.
                </li>
                <li>
                  Ratio en rojo sostenido = tiempo esperado mal calibrado o problema real
                  de productividad en esa tarea.
                </li>
                <li>
                  Barras muy traslapadas con alta concurrencia = etapas que realmente se
                  trabajan en paralelo; utiles para validar dotaciones por estacion.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Unidades
          </p>
          <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
            {summary?.unit_count ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Con orden (≥2 tareas)
          </p>
          <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
            {summary?.units_with_order ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Instancias
          </p>
          <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
            {summary?.instance_count ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Outliers excluidos
          </p>
          <p className="mt-2 text-2xl font-semibold text-amber-700">
            {summary?.outlier_excluded_count ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Retrabajos excluidos
          </p>
          <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
            {summary?.rework_excluded_count ?? 0}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {!error ? (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {[
              { key: 'sequence' as const, label: 'Secuencia' },
              { key: 'table' as const, label: 'Tabla' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={
                  activeTab === tab.key
                    ? 'rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white'
                    : 'rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]'
                }
              >
                {tab.label}
              </button>
            ))}
            {stationLegend.length > 0 && activeTab === 'sequence' ? (
              <div className="ml-auto flex flex-wrap items-center gap-3">
                {stationLegend.map((station) => (
                  <span
                    key={station.name}
                    className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: station.color }}
                    />
                    {station.name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {!error && sortedTasks.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">
            No hay registros para los filtros seleccionados.
          </p>
        ) : null}

        {!error && activeTab === 'sequence' && sortedTasks.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <div className="flex items-center gap-3 border-b border-black/10 pb-2 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                <div className="w-56 shrink-0">Tarea</div>
                <div className="relative h-4 flex-1">
                  {[0, 25, 50, 75, 100].map((tick) => (
                    <span
                      key={tick}
                      className="absolute -translate-x-1/2 tabular-nums"
                      style={{ left: `${tick}%` }}
                    >
                      {tick}%
                    </span>
                  ))}
                </div>
                <div className="w-36 shrink-0 text-right">Duracion / Esperado</div>
                <div className="w-20 shrink-0 text-right">Consist.</div>
                <div className="w-20 shrink-0 text-right">Concurr.</div>
              </div>
              <div>
                {sortedTasks.map((task, index) => {
                  const start = statValue(task.start_fraction, statMode);
                  const end = statValue(task.end_fraction, statMode);
                  const rangeStart = task.start_fraction.p25;
                  const rangeEnd = task.end_fraction.p75;
                  const duration = statValue(task.duration_minutes, statMode);
                  const ratio =
                    duration != null &&
                    task.expected_minutes != null &&
                    task.expected_minutes > 0
                      ? duration / task.expected_minutes
                      : null;
                  const color = stationColor(task);
                  const left = start != null ? Math.min(Math.max(start, 0), 1) * 100 : null;
                  const width =
                    start != null && end != null
                      ? Math.max((Math.min(Math.max(end, 0), 1) - Math.min(Math.max(start, 0), 1)) * 100, 0.8)
                      : null;
                  return (
                    <div
                      key={task.task_definition_id}
                      className="group relative flex items-center gap-3 border-b border-black/5 py-1.5"
                    >
                      <div className="w-56 shrink-0">
                        <p className="truncate text-sm text-[var(--ink)]" title={task.task_name}>
                          <span className="mr-1.5 text-xs tabular-nums text-[var(--ink-muted)]">
                            {index + 1}.
                          </span>
                          {task.task_name}
                        </p>
                        <p className="truncate text-xs text-[var(--ink-muted)]">
                          n={task.sample_count}
                          {task.dominant_station_name ? ` · ${task.dominant_station_name}` : ''}
                        </p>
                      </div>
                      <div className="relative h-7 flex-1 rounded bg-black/[0.03]">
                        {[25, 50, 75].map((tick) => (
                          <span
                            key={tick}
                            className="absolute inset-y-0 w-px bg-black/5"
                            style={{ left: `${tick}%` }}
                          />
                        ))}
                        {rangeStart != null && rangeEnd != null && rangeEnd > rangeStart ? (
                          <span
                            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
                            style={{
                              left: `${Math.min(Math.max(rangeStart, 0), 1) * 100}%`,
                              width: `${Math.max((Math.min(Math.max(rangeEnd, 0), 1) - Math.min(Math.max(rangeStart, 0), 1)) * 100, 0.4)}%`,
                              backgroundColor: color,
                              opacity: 0.25,
                            }}
                          />
                        ) : null}
                        {left != null && width != null ? (
                          <span
                            className="absolute top-1/2 h-4 -translate-y-1/2 rounded"
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              backgroundColor: color,
                            }}
                          />
                        ) : (
                          <span className="absolute top-1/2 -translate-y-1/2 text-xs text-[var(--ink-muted)]">
                            sin posicion
                          </span>
                        )}
                      </div>
                      <div className="w-36 shrink-0 text-right text-sm tabular-nums">
                        <span className="text-[var(--ink)]">
                          {duration != null ? formatMinutesWithUnit(duration) : '-'}
                        </span>
                        <span className="text-[var(--ink-muted)]">
                          {' / '}
                          {task.expected_minutes != null
                            ? formatMinutesWithUnit(task.expected_minutes)
                            : '-'}
                        </span>
                        {ratio != null ? (
                          <span className={`ml-1 text-xs ${ratioTone(ratio)}`}>
                            {`${ratio.toFixed(2)}x`}
                          </span>
                        ) : null}
                      </div>
                      <div className="w-20 shrink-0 text-right text-sm tabular-nums text-[var(--ink)]">
                        {formatPercent(task.order_consistency)}
                      </div>
                      <div className="w-20 shrink-0 text-right text-sm tabular-nums text-[var(--ink)]">
                        {formatPercent(task.concurrency_share)}
                      </div>

                      <div className="pointer-events-none absolute left-56 top-full z-20 hidden w-80 rounded-xl border border-black/10 bg-white p-3 text-xs shadow-lg group-hover:block">
                        <p className="mb-1 font-semibold text-[var(--ink)]">{task.task_name}</p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[var(--ink-muted)]">
                          <span>Unidades</span>
                          <span className="text-right tabular-nums">{task.sample_count}</span>
                          <span>Instancias</span>
                          <span className="text-right tabular-nums">{task.instance_count}</span>
                          <span>Duracion mediana</span>
                          <span className="text-right tabular-nums">
                            {task.duration_minutes.median != null
                              ? formatMinutesWithUnit(task.duration_minutes.median)
                              : '-'}
                          </span>
                          <span>Duracion promedio</span>
                          <span className="text-right tabular-nums">
                            {task.duration_minutes.mean != null
                              ? formatMinutesWithUnit(task.duration_minutes.mean)
                              : '-'}
                          </span>
                          <span>P25 - P75</span>
                          <span className="text-right tabular-nums">
                            {task.duration_minutes.p25 != null && task.duration_minutes.p75 != null
                              ? `${formatMinutesWithUnit(task.duration_minutes.p25)} - ${formatMinutesWithUnit(task.duration_minutes.p75)}`
                              : '-'}
                          </span>
                          <span>Esperado</span>
                          <span className="text-right tabular-nums">
                            {task.expected_minutes != null
                              ? formatMinutesWithUnit(task.expected_minutes)
                              : '-'}
                          </span>
                          <span>Consistencia de orden</span>
                          <span className="text-right tabular-nums">
                            {formatPercent(task.order_consistency, 1)}
                          </span>
                          <span>Concurrencia</span>
                          <span className="text-right tabular-nums">
                            {formatPercent(task.concurrency_share, 1)}
                          </span>
                          <span>Sec. estacion plan</span>
                          <span className="text-right tabular-nums">
                            {task.planned_station_sequence ?? '-'}
                          </span>
                          <span>Outliers excluidos</span>
                          <span className="text-right tabular-nums">
                            {task.outlier_excluded_count}
                          </span>
                        </div>
                        {task.stations.length > 0 ? (
                          <div className="mt-2 border-t border-black/5 pt-1.5">
                            <p className="mb-0.5 font-semibold text-[var(--ink)]">Estaciones</p>
                            {task.stations.slice(0, 5).map((station) => (
                              <div
                                key={station.station_id}
                                className="flex justify-between text-[var(--ink-muted)]"
                              >
                                <span>
                                  {station.station_name ?? `Estacion ${station.station_id}`}
                                </span>
                                <span className="tabular-nums">
                                  {formatPercent(station.share)} ({station.count})
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {!error && activeTab === 'table' && sortedTasks.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Tarea</th>
                  <th className="px-2 py-2 text-right">Unidades</th>
                  <th className="px-2 py-2 text-right">Rank med</th>
                  <th className="px-2 py-2 text-right">Rank prom</th>
                  <th className="px-2 py-2 text-right">Inicio med</th>
                  <th className="px-2 py-2 text-right">Fin med</th>
                  <th className="px-2 py-2 text-right">Dur med</th>
                  <th className="px-2 py-2 text-right">Dur prom</th>
                  <th className="px-2 py-2 text-right">Esperado</th>
                  <th className="px-2 py-2 text-right">Consist.</th>
                  <th className="px-2 py-2 text-right">Concurr.</th>
                  <th className="px-2 py-2 text-right">Sec. plan</th>
                  <th className="px-2 py-2">Estacion dominante</th>
                  <th className="px-2 py-2 text-right">Outliers</th>
                </tr>
              </thead>
              <tbody>
                {sortedTasks.map((task, index) => (
                  <tr
                    key={task.task_definition_id}
                    className="border-b border-black/5 text-[var(--ink)]"
                  >
                    <td className="px-2 py-2 tabular-nums">{index + 1}</td>
                    <td className="px-2 py-2">{task.task_name}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{task.sample_count}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {task.rank.median != null ? task.rank.median.toFixed(2) : '-'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {task.rank.mean != null ? task.rank.mean.toFixed(2) : '-'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatPercent(task.start_fraction.median)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatPercent(task.end_fraction.median)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {task.duration_minutes.median != null
                        ? formatMinutesWithUnit(task.duration_minutes.median)
                        : '-'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {task.duration_minutes.mean != null
                        ? formatMinutesWithUnit(task.duration_minutes.mean)
                        : '-'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {task.expected_minutes != null
                        ? formatMinutesWithUnit(task.expected_minutes)
                        : '-'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatPercent(task.order_consistency, 1)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatPercent(task.concurrency_share, 1)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {task.planned_station_sequence ?? '-'}
                    </td>
                    <td className="px-2 py-2">{task.dominant_station_name ?? '-'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {task.outlier_excluded_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default DashboardTaskSequence;
