import { useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CircleHelp, RotateCcw, X } from 'lucide-react';
import { useAdminHeader, useAdminSession } from '../../../layouts/AdminLayoutContext';
import { dashboardApiRequest } from './dashboardVisibility';
import { forecastCosts, historicArea, historicCosts, type CostAssumptions } from './projectCostModel';
import './project_costs.css';

type TaskEstimate = { task_id: number; name: string; module: number; panel: string | null;
  minutes: number | null; crew: number | null; hours: number | null; samples: number; source: string };
type Model = { key: string; name: string; modules: number; floor_area: number | null;
  hours: number | null; hours_source: string; reference_houses: number;
  known_hours: number; missing_tasks: number; tasks: TaskEstimate[] };
type Mix = { key: string; houses: number; completed: number; completed_floor_area: number; missing_area: number };
type Project = { name: string; recorded_hours: number; models: Mix[] };
type Snapshot = { start: string; end: string; first_date: string | null; last_date: string;
  weekdays: number; roster: number; total_recorded_hours: number; completed_tasks: number;
  tasks_with_hours: number; fallback_shift_days: number; projects: Project[]; models: Model[] };
type Overrides = Record<string, { area?: string; hours?: string; quantity?: string }>;
type Settings = { inputs: Record<keyof CostAssumptions, string>; overrides: Record<string, Overrides> };
const defaults: Settings = { inputs: { salary: '1000000', roster: '', overhead: '0', uf: '',
  dailyHours: '8', productivePercent: '80', rate: '' }, overrides: {} };
const numeric = (value: string) => value.trim() === '' ? NaN : Number(value);
const positive = (value?: string) => value && Number.isFinite(numeric(value)) && numeric(value) > 0 ? numeric(value) : null;
const fmt = (value: number | null, digits = 1) => value !== null && Number.isFinite(value)
  ? value.toLocaleString('es-CL', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
const money = (value: number | null) => value === null ? '—' : `$${fmt(value, 0)}`;
function loadSettings(key: string): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!stored || typeof stored !== 'object') return defaults;
    const inputs = { ...defaults.inputs };
    for (const name of Object.keys(inputs) as (keyof CostAssumptions)[]) {
      if (typeof stored.inputs?.[name] === 'string') inputs[name] = stored.inputs[name];
    }
    const overrides: Settings['overrides'] = {};
    for (const [project, values] of Object.entries(stored.overrides ?? {})) {
      if (!values || typeof values !== 'object') continue;
      overrides[project] = {};
      for (const [model, fields] of Object.entries(values)) {
        if (!fields || typeof fields !== 'object') continue;
        overrides[project][model] = {};
        for (const field of ['area', 'hours', 'quantity'] as const) {
          if (typeof fields[field] === 'string') overrides[project][model][field] = fields[field];
        }
      }
    }
    return { inputs, overrides };
  } catch { return defaults; }
}

export default function DashboardProjectCosts() {
  const { setHeader } = useAdminHeader();
  const admin = useAdminSession();
  const storageKey = `scp.project-costs.v1.${admin.id}`;
  const [settings, setSettings] = useState(() => loadSettings(storageKey));
  const [data, setData] = useState<Snapshot | null>(null);
  const [projectName, setProjectName] = useState('');
  const [mode, setMode] = useState<'forecast' | 'history'>('forecast');
  const [dates, setDates] = useState({ start: '', end: '' });
  const [query, setQuery] = useState('');
  const [requestId, setRequestId] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { setHeader({ title: 'Gastos generales', kicker: 'Dashboards' }); }, [setHeader]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* Private browsing can disable storage. */ }
  }, [settings, storageKey]);
  useEffect(() => {
    const controller = new AbortController();
    dashboardApiRequest<Snapshot>(`/api/project-costs${query}`, { signal: controller.signal })
      .then(snapshot => {
        setData(snapshot);
        setDates({ start: snapshot.start, end: snapshot.end });
        setProjectName(previous => snapshot.projects.some(p => p.name === previous) ? previous :
          [...snapshot.projects].sort((a, b) => b.recorded_hours - a.recorded_hours)[0]?.name ?? '');
        setError(''); setLoading(false);
      }).catch(err => {
        if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : 'No se pudieron cargar los datos.'); setLoading(false); }
      });
    return () => controller.abort();
  }, [query, requestId]);

  const project = data?.projects.find(p => p.name === projectName);
  const overrides = settings.overrides[projectName] ?? {};
  const allCompleted = data?.projects.reduce((sum, p) => sum + p.models.reduce((n, m) => n + m.completed, 0), 0) ?? 0;
  const observedRate = data && data.weekdays > 0 ? allCompleted / data.weekdays : 0;
  const a = Object.fromEntries(Object.entries(settings.inputs).map(([k, v]) => [k, numeric(v)])) as unknown as CostAssumptions;
  if (settings.inputs.roster === '') a.roster = data?.roster ?? 0;
  if (settings.inputs.rate === '') a.rate = observedRate;
  const rows = project?.models.map(mix => {
    const model = data!.models.find(m => m.key === mix.key)!;
    const override = overrides[mix.key] ?? {};
    return { mix, model, override,
      area: override.area ? positive(override.area) : model.floor_area,
      hours: override.hours ? positive(override.hours) : model.hours,
      quantity: override.quantity !== undefined && override.quantity !== '' ? numeric(override.quantity) : mix.houses };
  }) ?? [];
  const forecast = forecastCosts(rows, a);
  const completed = rows.reduce((sum, r) => sum + r.mix.completed, 0);
  const historyArea = rows.some(r => r.mix.completed > 0 && r.override.area && positive(r.override.area) === null)
    ? null : historicArea(rows.map(r => ({ completed: r.mix.completed,
      recordedArea: r.mix.completed_floor_area, missingHouses: r.mix.missing_area,
      floorArea: r.model.floor_area, exactArea: positive(r.override.area) })));
  const history = historicCosts(historyArea, project?.recorded_hours ?? 0, data?.total_recorded_hours ?? 0, data?.weekdays ?? 0, a);
  const result = mode === 'forecast' ? forecast : history;
  const input = (name: keyof CostAssumptions, value: string) => setSettings(s => ({ ...s, inputs: { ...s.inputs, [name]: value } }));
  const override = (key: string, field: 'area' | 'hours' | 'quantity', value: string) => setSettings(s => ({ ...s,
    overrides: { ...s.overrides, [projectName]: { ...s.overrides[projectName], [key]: { ...s.overrides[projectName]?.[key], [field]: value } } } }));
  const field = (name: keyof CostAssumptions, label: string, options: { min?: number; max?: number; step?: string; placeholder?: string } = {}) =>
    <label className="gc-field"><span>{label}</span><input type="number" min={options.min ?? 0} max={options.max}
      step={options.step ?? 'any'} value={settings.inputs[name]} placeholder={options.placeholder}
      onChange={e => input(name, e.target.value)} /></label>;
  const invalidInputs = a.roster <= 0 || !Number.isInteger(a.roster) || !Number.isFinite(a.salary) || a.salary < 0
    || !Number.isFinite(a.overhead) || a.overhead < 0 || (mode === 'forecast' && (a.dailyHours <= 0 || a.dailyHours > 24
    || a.productivePercent <= 0 || a.productivePercent > 100 || a.rate <= 0
    || !Number.isFinite(a.dailyHours) || !Number.isFinite(a.productivePercent) || !Number.isFinite(a.rate)
    || rows.some(r => !Number.isInteger(r.quantity) || r.quantity < 0)));
  const coverage = data?.completed_tasks ? data.tasks_with_hours / data.completed_tasks : 0;

  return <div className="project-costs">
    <div className="gc-toolbar">
      <label className="gc-field gc-project"><span>Proyecto</span><select value={projectName} onChange={e => setProjectName(e.target.value)} disabled={!data}>
        {data?.projects.map(p => <option key={p.name} value={p.name}>{p.name || 'Sin nombre'}</option>)}
      </select></label>
      <form className="gc-dates" onSubmit={e => { e.preventDefault(); setLoading(true); setError('');
        setQuery(`?start=${dates.start}&end=${dates.end}`); setRequestId(n => n + 1); }}>
        <label className="gc-field"><span>Referencia desde</span><input aria-label="Referencia desde" type="date" required value={dates.start}
          max={dates.end} onChange={e => setDates(d => ({ ...d, start: e.target.value }))} /></label>
        <label className="gc-field"><span>Hasta</span><input aria-label="Referencia hasta" type="date" required value={dates.end}
          min={dates.start} max={new Date().toLocaleDateString('sv-SE')} onChange={e => setDates(d => ({ ...d, end: e.target.value }))} /></label>
        <button type="submit" disabled={loading}>Aplicar</button>
      </form>
      <button className="gc-icon" aria-label="Cómo se calcula" title="Cómo se calcula" onClick={() => dialog.current?.showModal()}><CircleHelp size={21} /></button>
    </div>
    {error && <p role="alert" className="gc-notice">{error} <button onClick={() => { setLoading(true); setRequestId(n => n + 1); }}>Reintentar</button></p>}
    {loading && <p role="status" className="gc-loading">Calculando producción y horas…</p>}
    {data && !loading && !error && <>
      <div className="gc-tabs" role="tablist" aria-label="Perspectiva">
        <button role="tab" aria-selected={mode === 'forecast'} onClick={() => setMode('forecast')}>Proyección</button>
        <button role="tab" aria-selected={mode === 'history'} onClick={() => setMode('history')}>Histórico estimado</button>
        <span>{data.start} / {data.end} · {data.weekdays} días hábiles</span>
      </div>
      <div className="gc-body">
        <main>
          <section className="gc-result" aria-label="Costo estimado">
            <div className="gc-main-number"><span>Gastos generales</span><div>{invalidInputs ? '—' : fmt(result.ufPerSqm, 3)} <small>UF/m²</small></div>
              <p>{!positive(settings.inputs.uf) ? 'Ingresa el valor de la UF' : `${money(invalidInputs ? null : result.clpPerSqm)} / m²`}</p>
            </div>
            <div className="gc-summary">
              <div><span>GG del proyecto</span><strong>{money(invalidInputs ? null : result.totalClp)}</strong></div>
              <div><span>{mode === 'forecast' ? 'Superficie' : 'Superficie terminada'}</span><strong>{fmt(mode === 'forecast' ? forecast.area : historyArea)} <small>m²</small></strong></div>
              <div><span>{mode === 'forecast' ? 'Plazo de producción' : 'Viviendas terminadas'}</span><strong>{fmt(mode === 'forecast' ? forecast.days : completed, mode === 'forecast' ? 1 : 0)} <small>{mode === 'forecast' ? 'días hábiles' : 'viviendas'}</small></strong></div>
            </div>
          </section>
          {invalidInputs && <p role="alert" className="gc-notice">Revisa la dotación, el ritmo y los valores ingresados.</p>}
          {(mode === 'forecast' ? forecast.area === null : historyArea === null) && <p className="gc-notice">Falta superficie. Ingresa los m² exactos por vivienda.</p>}
          {mode === 'forecast' ? <section className="gc-section">
            <div className="gc-section-title"><h2>Ritmo y dotación</h2><span>{fmt(forecast.quantity, 0)} viviendas</span></div>
            <div className="gc-capacity">
              <div><span>Trabajo por vivienda</span><strong>{fmt(forecast.hours !== null && forecast.quantity ? forecast.hours / forecast.quantity : null)} <small>HH</small></strong></div>
              <div><span>Dotación por carga de trabajo</span><strong>{fmt(forecast.staff !== null ? Math.ceil(forecast.staff) : null, 0)} <small>personas</small></strong></div>
              <div><span>Dotación presupuestada</span><strong>{fmt(a.roster, 0)} <small>personas</small></strong></div>
            </div>
            {forecast.staff !== null && forecast.staff > a.roster && <p className="gc-notice">La carga estimada supera la dotación disponible.</p>}
            {forecast.hours === null && <p className="gc-notice">Completa las HH por vivienda para estimar la dotación.</p>}
            <div className="gc-sensitivity" aria-label="Sensibilidad al ritmo de producción">
              {[0.8, 1, 1.2].map(factor => { const scenario = forecastCosts(rows, { ...a, rate: a.rate * factor });
                return <div key={factor} className={factor === 1 ? 'gc-selected' : ''}>
                  <span>{factor < 1 ? <ArrowDownRight size={15} /> : factor > 1 ? <ArrowUpRight size={15} /> : null}{factor === 1 ? 'Ritmo previsto' : factor < 1 ? '20% más lento' : '20% más rápido'}</span>
                  <strong>{fmt(invalidInputs ? null : scenario.ufPerSqm, 3)} <small>UF/m²</small></strong>
                  <span>{fmt(a.rate * factor, 2)} viviendas/día</span>
                </div>; })}
            </div>
          </section> : <section className="gc-section">
            <div className="gc-section-title"><h2>Producción del período</h2><span>{coverage < 0.8 ? 'Registros parciales' : ''}</span></div>
            <div className="gc-capacity">
              <div><span>Ritmo del proyecto</span><strong>{fmt(data.weekdays ? completed / data.weekdays : null, 2)} <small>viv./día</small></strong></div>
              <div><span>Horas registradas</span><strong>{fmt(project?.recorded_hours ?? null, 0)} <small>HH</small></strong></div>
              <div><span>GG asignados</span><strong>{fmt(history.share !== null ? history.share * 100 : null)} <small>% de planta</small></strong></div>
            </div>
            {!completed && <p className="gc-notice">Sin viviendas terminadas en este período.</p>}
            {history.share === null && <p className="gc-notice">Sin horas suficientes para asignar gastos al proyecto.</p>}
          </section>}
          <section className="gc-section">
            <div className="gc-section-title"><h2>Viviendas</h2><span>{mode === 'forecast' ? 'm² y HH por vivienda' : 'm² por vivienda'}</span></div>
            <div className="gc-table-wrap"><table><thead><tr><th>Modelo</th><th>{mode === 'forecast' ? 'Cantidad' : 'Terminadas'}</th><th>m² exactos</th>{mode === 'forecast' && <th>HH previstas</th>}</tr></thead><tbody>
              {rows.map(({ model, mix, override: values, quantity }) => <tr key={model.key}>
                <td><strong>{model.name}</strong><small>{model.modules} módulos · {model.hours_source === 'houses' ? `${model.reference_houses} viviendas de referencia` : model.missing_tasks ? `${model.missing_tasks} tareas sin estimar` : `${model.tasks.length} tareas`}</small></td>
                <td>{mode === 'forecast' ? <input type="number" min="0" step="1" aria-label={`Cantidad ${model.name}`} value={values.quantity ?? quantity} onChange={e => override(model.key, 'quantity', e.target.value)} /> : mix.completed}</td>
                <td><input type="number" min="0.01" step="any" aria-label={`m² exactos ${model.name}`} value={values.area ?? ''} placeholder={model.floor_area ? fmt(model.floor_area, 2) : 'Ingresar'} onChange={e => override(model.key, 'area', e.target.value)} /><small>{values.area ? 'Exactos' : 'Paneles de piso'}</small></td>
                {mode === 'forecast' && <td><input type="number" min="0.01" step="any" aria-label={`HH previstas ${model.name}`} value={values.hours ?? ''} placeholder={model.hours ? fmt(model.hours) : 'Ingresar'} onChange={e => override(model.key, 'hours', e.target.value)} /><small>{values.hours ? 'Manual' : model.hours ? 'Estimadas' : `${fmt(model.known_hours)} HH parciales`}</small></td>}
              </tr>)}
            </tbody></table></div>
          </section>
          <details className="gc-details"><summary>Estimación por tarea</summary>
            {rows.map(({ model }) => <div key={model.key}><h3>{model.name}</h3><div className="gc-table-wrap"><table><thead><tr><th>Tarea</th><th>Minutos</th><th>Personas eq.</th><th>HH</th><th>Base</th></tr></thead><tbody>
              {model.tasks.map(t => <tr key={`${t.module}:${t.panel}:${t.task_id}`}><td>{t.name}<small>M{t.module}{t.panel ? ` · ${t.panel}` : ''}</small></td><td>{fmt(t.minutes)}</td><td>{fmt(t.crew)}</td><td>{fmt(t.hours, 2)}</td><td>{t.source === 'observed' ? `${t.samples} registros` : t.source === 'configured' ? 'Configurado' : 'Sin datos'}</td></tr>)}
            </tbody></table></div></div>)}
          </details>
        </main>
        <aside className="gc-assumptions" aria-label="Variables del cálculo"><div className="gc-section-title"><h2>Variables</h2>
          <button className="gc-icon" title="Restablecer variables y ajustes de este proyecto" aria-label="Restablecer variables y ajustes de este proyecto" onClick={() => setSettings(s => ({ inputs: defaults.inputs, overrides: { ...s.overrides, [projectName]: {} } }))}><RotateCcw size={16} /></button></div>
          {field('uf', 'UF · CLP', { min: 1, placeholder: 'Ingresar valor' })}
          {field('salary', 'Costo mensual / trabajador · CLP')}
          {field('roster', 'Dotación pagada', { min: 1, step: '1', placeholder: String(data.roster) })}
          {field('overhead', 'Otros GG mensuales · CLP')}
          {mode === 'forecast' && <><hr />
          {field('rate', 'Viviendas / día', { min: 0.01, placeholder: fmt(observedRate, 2) })}
          {field('dailyHours', 'Horas / jornada', { min: 0.1, max: 24 })}
          {field('productivePercent', 'Tiempo productivo · %', { min: 1, max: 100 })}</>}
          <div className="gc-burn"><span>Costo diario de planta</span><strong>{money(forecast.dailyBurn)}</strong></div>
        </aside>
      </div>
    </>}
    <dialog ref={dialog} className="project-costs gc-dialog" aria-labelledby="gc-help-title">
      <div className="gc-section-title"><h2 id="gc-help-title">Cómo se calcula</h2><button className="gc-icon" aria-label="Cerrar ayuda" onClick={() => dialog.current?.close()}><X size={21} /></button></div>
      <h3>Gastos generales y throughput</h3>
      <p>Costo diario = [dotación × costo mensual por trabajador + otros GG mensuales] / 20,83. UF/m² = costo diario × días de producción / superficie / valor UF. El plazo es cantidad de viviendas / viviendas por día. Se presupuesta toda la dotación durante ese plazo.</p>
      <p>El costo laboral parte en $1.000.000 por mes y trabajador. Ajusta ese valor al costo empresa que quieras presupuestar. La dotación inicial corresponde a los trabajadores activos actuales, también al consultar el histórico. Los otros GG parten en cero. No se incluyen materiales, subcontratos, transporte ni montaje en obra.</p>
      <h3>Superficie</h3>
      <p>Ingresa los m² exactos por vivienda. Sin ese valor, la proyección suma los paneles de piso del catálogo vigente, por modelo y subtipo. El histórico suma los paneles asociados a las viviendas terminadas y usa el catálogo como respaldo para viviendas con registros de paneles incompletos. Si tampoco existe esa superficie, no se calcula UF/m².</p>
      <h3>Producción e histórico</h3>
      <p>Una vivienda se cuenta cuando todos sus módulos registran la tarea de salida de la última estación de ensamble. La fecha es la salida del último módulo. Se toma la primera salida por módulo para evitar duplicar retrabajos. No equivale a despacho ni liberación de calidad. Las salidas sin registro quedan fuera.</p>
      <p>El período incluye todos los lunes a viernes, aunque no haya producción; no descuenta feriados. La proyección usa 20,83 días por mes, equivalente a unos 250 días al año. El ritmo inicial es el total de viviendas de planta / días hábiles del período; ajústalo al proyecto y su mezcla de modelos.</p>
      <p>En el histórico se reparte el costo de planta según HH registradas del proyecto / HH registradas de todos los proyectos. Incluye horas de viviendas aún en proceso; sus gastos no se reparten entre las ya terminadas de otros proyectos. Por ello, es una asignación del período, no el costo final de una cohorte. Períodos cortos o registros desiguales pueden distorsionarla.</p>
      <h3>Tareas y dotación</h3>
      <p>Cuando hay al menos tres viviendas completas del mismo modelo y subtipo, se prefiere la mediana de sus HH. Deben iniciar y terminar dentro del período, tener registros de paneles y al menos tres estaciones de ensamble por módulo, y cubrir al menos el 80% del número de tareas distintas de la vivienda mejor registrada de ese modelo en todo el histórico, con un mínimo de 20 tareas. Ese filtro reduce el efecto de registros incompletos, pero no certifica todas las horas trabajadas. La tabla por tarea permite revisar el respaldo y las brechas del catálogo.</p>
      <p>Si no hay suficientes viviendas de referencia, las HH previstas suman las medianas de esfuerzo por tarea, modelo, subtipo, módulo y panel. Se usan tareas terminadas íntegramente dentro del período. Se descuentan pausas y tiempo fuera de turno. Si una persona aparece en tareas simultáneas, se divide su tiempo entre ellas. Personas equivalentes = HH × 60 / minutos de tarea.</p>
      <p>Se excluyen movimientos de avance, retrabajos, confirmaciones de menos de un minuto y tareas de más de 31 días de calendario del aprendizaje. La receta usa tareas activas del catálogo y reglas de aplicabilidad; puede incluir opciones condicionadas. Sin muestras, se usan tiempo y dotación configurados. Si falta alguno, la tarea queda sin estimar. Puedes ingresar HH totales por vivienda para completar o ajustar la receta.</p>
      <p>Dotación por carga = HH por vivienda × viviendas por día / [horas de jornada × % productivo]. El 80% inicial es editable. Es una necesidad agregada de personal, no una simulación de cuellos de botella, habilidades ni estaciones. Estas HH no se suman a la nómina: hacerlo cobraría dos veces el mismo trabajo.</p>
      <h3>Calidad y moneda</h3>
      <p>La referencia inicial son los últimos 90 días hasta el último registro disponible. Cada tarea muestra su número de muestras; pocas muestras no aseguran un estándar estable. La ausencia de registros no demuestra ahorro.</p>
      {data && <p>{data.tasks_with_hours} de {data.completed_tasks} tareas terminadas tienen horas atribuibles. En {data.fallback_shift_days} combinaciones estación/día se usó el turno de respaldo, lunes a viernes de 08:20 a 17:00, porque no había turno estimado. La cobertura no mide tareas que nunca se registraron.</p>}
      <p>Ingresa el valor CLP de la UF que quieras usar como referencia. La misma UF y los mismos costos se aplican al histórico y a la proyección para compararlos a precios constantes; no reconstruyen nóminas ni conversiones diarias pasadas. Las variables y ajustes se guardan por usuario en este navegador. No modifican la planificación ni el catálogo.</p>
    </dialog>
  </div>;
}
