import React, { useEffect, useMemo, useState } from 'react';
import { Target } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const PANEL_GOAL_STORAGE_KEY = 'panel_daily_goal';

type PanelsPassedSummary = {
  plan_id?: number | null;
  panel_definition_id?: number | null;
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
  const [goalDraft, setGoalDraft] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return localStorage.getItem(PANEL_GOAL_STORAGE_KEY) ?? '';
  });
  const [passedCount, setPassedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        params.set('date', todayStr());
        const data = await apiRequest<StationPanelsPassedResponse>(
          `/api/station-panels-finished?${params.toString()}`
        );
        if (!active) return;
        const countRaw =
          data?.panels_passed_today_count ??
          (Array.isArray(data?.panels_passed_today_list)
            ? data.panels_passed_today_list.length
            : data?.total_panels_finished) ??
          0;
        setPassedCount(Number.isFinite(countRaw) ? Number(countRaw) : 0);
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Error cargando paneles';
        setError(message);
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
  }, [stationId]);

  const goalValue = useMemo(() => {
    const parsed = Number.parseInt(goalDraft, 10);
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
  }, [goalDraft]);
  const progress = goalValue > 0 ? Math.min(passedCount / goalValue, 1) : 0;
  const remaining = goalValue > 0 ? Math.max(goalValue - passedCount, 0) : 0;
  const overage = goalValue > 0 && passedCount > goalValue ? passedCount - goalValue : 0;

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
          Meta diaria de paneles
        </h3>
        <p className="text-slate-400">
          {stationLabel} · Hoy {todayStr()}
        </p>
      </div>

      <div className="bg-slate-700 rounded-2xl shadow-lg p-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-300">
              Paneles pasados hoy
            </p>
            {loading ? (
              <div className="mt-3 h-10 w-24 rounded-full bg-slate-600/70 animate-pulse" />
            ) : (
              <p className="mt-2 text-4xl font-semibold text-white">{passedCount}</p>
            )}
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
