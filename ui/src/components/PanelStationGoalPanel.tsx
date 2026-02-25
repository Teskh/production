import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Info, Target } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const PANEL_GOAL_STORAGE_KEY = 'panel_daily_goal';
const SHIFT_START = { hours: 8, minutes: 20 };
const SHIFT_END = { hours: 17, minutes: 0 };

type PanelsPassedSummary = {
  plan_id?: number | null;
  panel_definition_id?: number | null;
  panel_code?: string | null;
  panel_name?: string | null;
  house_identifier?: string | null;
  module_number?: number | null;
  satisfied_at?: string | null;
  completed_at?: string | null;
};

type StationPanelsPassedResponse = {
  panels_passed_today_count?: number | null;
  panels_passed_today_list?: PanelsPassedSummary[] | null;
  total_panels_finished?: number | null;
};

type PanelStationGoalPanelProps = {
  stationId: number;
  stationLabel: string;
};

const pad = (value: number) => String(value).padStart(2, '0');

const todayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const timeLabel = (hours: number, minutes: number) => `${pad(hours)}:${pad(minutes)}`;

const buildShiftBoundary = (dateToken: string, hours: number, minutes: number) => {
  const [year, month, day] = dateToken.split('-').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
};

const parseSatisfiedAt = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
};

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

const PanelStationGoalPanel: React.FC<PanelStationGoalPanelProps> = ({
  stationId,
  stationLabel,
}) => {
  const [todayToken] = useState(() => todayStr());
  const [goalDraft, setGoalDraft] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return localStorage.getItem(PANEL_GOAL_STORAGE_KEY) ?? '';
  });
  const [passedCount, setPassedCount] = useState(0);
  const [passedPanels, setPassedPanels] = useState<PanelsPassedSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsPinnedOpen, setDetailsPinnedOpen] = useState(false);
  const [detailsHoverOpen, setDetailsHoverOpen] = useState(false);
  const detailsPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!goalDraft.trim()) {
      localStorage.removeItem(PANEL_GOAL_STORAGE_KEY);
      return;
    }
    localStorage.setItem(PANEL_GOAL_STORAGE_KEY, goalDraft);
  }, [goalDraft]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('station_id', String(stationId));
        params.set('date', todayToken);
        const data = await apiRequest<StationPanelsPassedResponse>(
          `/api/station-panels-finished?${params.toString()}`
        );
        if (!active) return;
        const list = Array.isArray(data?.panels_passed_today_list)
          ? data.panels_passed_today_list
          : [];
        const countRaw =
          data?.panels_passed_today_count ??
          (list.length > 0 ? list.length : data?.total_panels_finished) ??
          0;
        setPassedPanels(list);
        setPassedCount(Number.isFinite(countRaw) ? Number(countRaw) : 0);
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Error cargando paneles';
        setError(message);
        setPassedPanels([]);
        setPassedCount(0);
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
  }, [stationId, todayToken]);

  useEffect(() => {
    setDetailsPinnedOpen(false);
    setDetailsHoverOpen(false);
  }, [stationId, todayToken]);

  useEffect(() => {
    if (!detailsPinnedOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!detailsPopoverRef.current) {
        return;
      }
      if (detailsPopoverRef.current.contains(event.target as Node)) {
        return;
      }
      setDetailsPinnedOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [detailsPinnedOpen]);

  const goalValue = useMemo(() => {
    const parsed = Number.parseInt(goalDraft, 10);
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
  }, [goalDraft]);
  const progress = goalValue > 0 ? Math.min(passedCount / goalValue, 1) : 0;
  const remaining = goalValue > 0 ? Math.max(goalValue - passedCount, 0) : 0;
  const overage = goalValue > 0 && passedCount > goalValue ? passedCount - goalValue : 0;
  const sortedPassedPanels = useMemo(() => {
    return [...passedPanels].sort((a, b) => {
      const timeA = a.satisfied_at ?? a.completed_at ?? '';
      const timeB = b.satisfied_at ?? b.completed_at ?? '';
      if (timeA && timeB && timeA !== timeB) {
        return timeA.localeCompare(timeB);
      }
      const codeA = (a.panel_name ?? a.panel_code ?? '').trim();
      const codeB = (b.panel_name ?? b.panel_code ?? '').trim();
      if (codeA !== codeB) {
        return codeA.localeCompare(codeB);
      }
      return Number(a.panel_definition_id ?? 0) - Number(b.panel_definition_id ?? 0);
    });
  }, [passedPanels]);
  const detailsOpen = detailsPinnedOpen || detailsHoverOpen;

  const chart = useMemo(() => {
    const width = 800;
    const height = 300;
    const paddingX = 24;
    const paddingY = 40;
    const start = buildShiftBoundary(todayToken, SHIFT_START.hours, SHIFT_START.minutes);
    const end = buildShiftBoundary(todayToken, SHIFT_END.hours, SHIFT_END.minutes);
    const startMs = start.getTime();
    const endMs = end.getTime();
    const baselineY = height - paddingY;

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return {
        width,
        height,
        paddingX,
        paddingY,
        baselineY,
        actualPath: '',
        goalPath: '',
      };
    }

    const nowMs = Date.now();
    const effectiveNowMs = Math.min(Math.max(nowMs, startMs), endMs);

    const timeline = passedPanels
      .map((panel) => parseSatisfiedAt(panel.satisfied_at))
      .filter((value): value is Date => value !== null)
      .sort((a, b) => a.getTime() - b.getTime());

    const fallbackTotal =
      timeline.length === 0 ? passedCount : Math.max(timeline.length, passedCount);
    let points: Array<{ time: number; count: number }>;

    if (timeline.length === 0) {
      points = [
        { time: startMs, count: 0 },
        { time: effectiveNowMs, count: Math.max(fallbackTotal, 0) },
      ];
    } else {
      points = [];
      let count = 0;
      let index = 0;
      while (index < timeline.length && timeline[index].getTime() < startMs) {
        count += 1;
        index += 1;
      }
      points.push({ time: startMs, count });
      while (index < timeline.length && timeline[index].getTime() <= endMs) {
        count += 1;
        points.push({ time: timeline[index].getTime(), count });
        index += 1;
      }
      
      // Extend to the current time to show a flat line from the last panel to 'now'
      const last = points[points.length - 1];
      if (last && last.time < effectiveNowMs) {
        points.push({ time: effectiveNowMs, count: fallbackTotal });
      }
    }

    const maxY = Math.max(goalValue, fallbackTotal, 1);
    const usableWidth = width - paddingX * 2;
    const usableHeight = height - paddingY * 2;
    const scaleX = (time: number) =>
      paddingX + ((time - startMs) / (endMs - startMs)) * usableWidth;
    const scaleY = (count: number) =>
      height - paddingY - (count / maxY) * usableHeight;

    let actualPath = '';
    if (points.length > 0) {
      const first = points[0];
      actualPath = `M ${scaleX(first.time)} ${scaleY(first.count)}`;
      for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1];
        const next = points[i];
        const nextX = scaleX(next.time);
        actualPath += ` L ${nextX} ${scaleY(prev.count)}`;
        actualPath += ` L ${nextX} ${scaleY(next.count)}`;
      }
    }
    
    const goalPath =
      goalValue > 0
        ? `M ${scaleX(startMs)} ${scaleY(0)} L ${scaleX(endMs)} ${scaleY(goalValue)}`
        : '';
        
    const lastPoint = points[points.length - 1];

    return {
      width,
      height,
      paddingX,
      paddingY,
      baselineY,
      actualPath,
      goalY: goalValue > 0 ? scaleY(goalValue) : undefined,
      goalPath,
      lastPoint: lastPoint
        ? { x: scaleX(lastPoint.time), y: scaleY(lastPoint.count) }
        : undefined,
    };
  }, [passedPanels, passedCount, goalValue, todayToken]);

  const handleGoalChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    if (next === '' || /^\d+$/.test(next)) {
      setGoalDraft(next);
    }
  };

  return (
    <div className="hidden lg:flex flex-1 bg-slate-800 text-white p-12 flex-col">
      <div className="mb-8">
        <h3 className="text-xl font-bold flex items-center mb-2">
          <Target className="w-6 h-6 mr-2 text-blue-400" />
          Meta diaria
        </h3>
        <p className="text-slate-400">
          {stationLabel} · Hoy {todayToken}
        </p>
      </div>

      <div className="bg-slate-700 rounded-2xl shadow-lg p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="relative" ref={detailsPopoverRef}>
            <p className="text-sm uppercase tracking-wide text-slate-300">
              Paneles terminados hoy
            </p>
            <div
              className="mt-2 flex items-center gap-3"
              onMouseEnter={() => setDetailsHoverOpen(true)}
              onMouseLeave={() => setDetailsHoverOpen(false)}
            >
              {loading ? (
                <div className="h-10 w-24 rounded-full bg-slate-600/70 animate-pulse" />
              ) : (
                <p className="text-4xl font-semibold text-white">{passedCount}</p>
              )}
              <button
                type="button"
                className="inline-flex items-center justify-center text-slate-300 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400/70 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Ver detalle de paneles producidos"
                aria-expanded={detailsOpen}
                aria-haspopup="dialog"
                onClick={() => setDetailsPinnedOpen((prev) => !prev)}
                disabled={loading}
              >
                <Info className="h-4 w-4" />
              </button>

              {detailsOpen && (
                <div className="absolute left-0 top-full z-20 mt-3 w-[28rem] max-w-[calc(100vw-10rem)] rounded-xl border border-slate-500/70 bg-slate-900/95 p-3 shadow-2xl backdrop-blur">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
                      Paneles producidos
                    </p>
                    <span className="text-xs text-slate-400">
                      {sortedPassedPanels.length > 0 ? sortedPassedPanels.length : passedCount}
                    </span>
                  </div>

                  {sortedPassedPanels.length === 0 ? (
                    <p className="text-sm text-slate-300">
                      {passedCount > 0
                        ? 'No hay detalle de paneles disponible para hoy.'
                        : 'Aun no hay paneles registrados hoy.'}
                    </p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-700/80">
                      <div className="grid grid-cols-[2.2rem_minmax(0,1fr)_7.5rem_6rem] gap-x-3 bg-slate-800/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                        <span>#</span>
                        <span>Panel</span>
                        <span>Casa</span>
                        <span>Modulo</span>
                      </div>
                      <div className="divide-y divide-slate-700/70">
                        {sortedPassedPanels.map((panel, index) => {
                          const panelLabel =
                            (panel.panel_name ?? panel.panel_code)?.trim() ||
                            (panel.panel_definition_id != null
                              ? `Panel ${panel.panel_definition_id}`
                              : 'Panel');
                          const houseLabel = panel.house_identifier?.trim() || '-';
                          const moduleLabel =
                            panel.module_number != null ? `MD${panel.module_number}` : '-';

                          return (
                            <div
                              key={`${panel.plan_id ?? 'plan'}-${panel.panel_definition_id ?? panel.panel_code ?? index}-${panel.satisfied_at ?? panel.completed_at ?? index}`}
                              className="grid grid-cols-[2.2rem_minmax(0,1fr)_7.5rem_6rem] gap-x-3 px-3 py-2 text-sm text-slate-100"
                            >
                              <span className="text-slate-400">{index + 1}</span>
                              <span className="truncate" title={panelLabel}>
                                {panelLabel}
                              </span>
                              <span className="truncate text-slate-300" title={houseLabel}>
                                {houseLabel}
                              </span>
                              <span className="truncate text-slate-300">{moduleLabel}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="text-right">
            <label
              htmlFor="panel-goal"
              className="block text-sm uppercase tracking-wide text-slate-300"
            >
              Meta diaria
            </label>
            <input
              id="panel-goal"
              type="text"
              inputMode="numeric"
              value={goalDraft}
              onChange={handleGoalChange}
              placeholder="0"
              className="mt-2 w-24 rounded-lg border border-slate-500/60 bg-slate-800 px-3 py-2 text-right text-lg font-semibold text-white placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6">
          {loading ? (
            <div className="h-2 w-full rounded-full bg-slate-600/70 animate-pulse" />
          ) : (
            <div className="h-2 w-full rounded-full bg-slate-600/60">
              <div
                className="h-2 rounded-full bg-blue-400 transition-all"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
          <div className="mt-3 flex items-center justify-between text-sm text-slate-300">
            {goalValue > 0 ? (
              <span>
                {overage > 0
                  ? `Superado por ${overage}`
                  : remaining > 0
                    ? `${remaining} restantes`
                    : 'Meta cumplida'}
              </span>
            ) : (
              <span>Define una meta para ver el avance.</span>
            )}
            <span>{goalValue > 0 && !loading ? `${Math.round(progress * 100)}%` : '--'}</span>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center text-xs uppercase tracking-wide text-slate-400 mb-2">
            <span>Evolución del día</span>
          </div>
          {loading ? (
            <div className="h-80 w-full rounded-xl bg-slate-600/70 animate-pulse" />
          ) : (
            <div className="relative">
              <svg
                viewBox={`0 0 ${chart.width} ${chart.height}`}
                className="h-80 w-full overflow-visible"
                role="img"
                aria-label="Evolución de paneles completados"
              >
                {/* Baseline */}
                <line
                  x1={chart.paddingX}
                  y1={chart.baselineY}
                  x2={chart.width - chart.paddingX}
                  y2={chart.baselineY}
                  stroke="rgba(148, 163, 184, 0.2)"
                  strokeWidth="1"
                />
                
                {chart.goalPath && (
                  <>
                    <path
                      d={chart.goalPath}
                      stroke="rgba(255, 255, 255, 0.25)"
                      strokeWidth="1.5"
                      strokeDasharray="6 6"
                      fill="none"
                    />
                    <text
                      x={chart.width - chart.paddingX}
                      y={(chart.goalY ?? 0) - 10}
                      fontSize="12"
                      fill="rgba(255, 255, 255, 0.4)"
                      textAnchor="end"
                      className="font-medium"
                    >
                      Meta: {goalValue}
                    </text>
                  </>
                )}

                {chart.actualPath && (
                  <path
                    d={chart.actualPath}
                    stroke="#60a5fa"
                    strokeWidth="3.5"
                    fill="none"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                
                {chart.lastPoint && (
                  <circle cx={chart.lastPoint.x} cy={chart.lastPoint.y} r="5" fill="#60a5fa" />
                )}

                {/* Timestamps */}
                <text
                  x={chart.paddingX}
                  y={chart.height - 10}
                  fontSize="13"
                  fill="#94a3b8"
                  textAnchor="start"
                >
                  {timeLabel(SHIFT_START.hours, SHIFT_START.minutes)}
                </text>
                <text
                  x={chart.width - chart.paddingX}
                  y={chart.height - 10}
                  fontSize="13"
                  fill="#94a3b8"
                  textAnchor="end"
                >
                  {timeLabel(SHIFT_END.hours, SHIFT_END.minutes)}
                </text>
              </svg>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-4 text-sm text-rose-200">
            {error}
          </p>
        )}
      </div>
    </div>
  );
};

export default PanelStationGoalPanel;
