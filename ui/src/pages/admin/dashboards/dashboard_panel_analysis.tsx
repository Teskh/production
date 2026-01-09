import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, RefreshCcw } from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';
import {
  formatDateTime,
  formatDateTimeShort,
  formatGapDuration,
  formatMinutesDetailed,
  formatMinutesShort,
  toFiniteNumber,
  toTs,
} from '../../../utils/timeUtils';
import { collectTaskNotes, flattenPanelsFinishedResponse } from '../../../utils/panelsFinishedUtils';
import type {
  PanelsFinishedPause,
  PanelsFinishedResponse,
  PanelsFinishedTask,
} from '../../../utils/panelsFinishedUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type Station = {
  id: number;
  name: string;
  role: string;
  line_type: string | null;
  sequence_order: number | null;
};

type PanelsFinishedPanelSummary = {
  plan_id?: number | null;
  panel_definition_id?: number | null;
  panel_code?: string | null;
  house_identifier?: string | null;
  module_number?: number | null;
  panel_area?: number | null;
  satisfied_at?: string | null;
  completed_at?: string | null;
};

type PanelsFinishedApiResponse = PanelsFinishedResponse & {
  total_panels_finished?: number | null;
  panels_passed_today_count?: number | null;
  panels_passed_today_list?: PanelsFinishedPanelSummary[] | null;
  panels_passed_today_area_sum?: number | null;
};

const DATE_KEY = 'stationPanelsFinishedSelectedDate';
const STATION_KEY = 'stationPanelsFinishedSelectedStation';

const GAP_COLOR = '#d32f2f';
const PAUSE_COLOR = '#f57c00';
const LUNCH_BREAK_MINUTES = 35;

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

const escapeCsv = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const DashboardPanelAnalysis: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [stations, setStations] = useState<Station[]>([]);
  const [stationsError, setStationsError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    const saved = localStorage.getItem(DATE_KEY);
    return saved || todayStr();
  });
  const [selectedStationId, setSelectedStationId] = useState(() => {
    const saved = localStorage.getItem(STATION_KEY);
    return saved || '';
  });
  const [data, setData] = useState<PanelsFinishedApiResponse>({ houses: [] });
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setHeader({
      title: 'Paneles finalizados por estacion',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  useEffect(() => {
    let active = true;
    apiRequest<Station[]>('/api/stations')
      .then((result) => {
        if (!active) return;
        setStations(Array.isArray(result) ? result : []);
      })
      .catch((err) => {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Error cargando estaciones';
        setStationsError(message);
      });
    return () => {
      active = false;
    };
  }, []);

  const panelStations = useMemo(
    () => (stations || []).filter((station) => station.role === 'Panels'),
    [stations]
  );

  useEffect(() => {
    if (!panelStations.length) return;
    const exists = panelStations.some((station) => String(station.id) === selectedStationId);
    if (!exists) {
      const fallback = String(panelStations[0].id);
      setSelectedStationId(fallback);
      localStorage.setItem(STATION_KEY, fallback);
    }
  }, [panelStations, selectedStationId]);

  const fetchData = async (stationId = selectedStationId, date = selectedDate) => {
    if (!stationId) return;
    setLoading(true);
    setError('');
    setExportError('');
    try {
      const params = new URLSearchParams();
      params.set('station_id', stationId);
      if (date) params.set('date', date);
      const result = await apiRequest<PanelsFinishedApiResponse>(
        `/api/station-panels-finished?${params.toString()}`
      );
      setData(result || { houses: [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error cargando datos';
      setError(message);
      setData({ houses: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedStationId) return;
    fetchData(selectedStationId, selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStationId]);

  const changeDay = (delta: number) => {
    const [y, m, d] = selectedDate.split('-').map((value) => Number.parseInt(value, 10));
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    const next = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    setSelectedDate(next);
    localStorage.setItem(DATE_KEY, next);
    fetchData(selectedStationId, next);
  };

  const onDateChange = (value: string) => {
    setSelectedDate(value);
    localStorage.setItem(DATE_KEY, value);
    fetchData(selectedStationId, value);
  };

  const onStationChange = (value: string) => {
    setSelectedStationId(value);
    localStorage.setItem(STATION_KEY, value);
  };

  const flatPanels = useMemo(() => flattenPanelsFinishedResponse(data), [data]);

  const handleExport = async () => {
    if (!flatPanels.length) {
      setExportError('No hay datos para exportar.');
      return;
    }
    setExportError('');
    setExporting(true);
    try {
      const rows = [
        [
          'Panel',
          'Casa',
          'Modulo',
          'Disponible',
          'Inicio',
          'Fin',
          'Esperado (min)',
          'Trabajo (min)',
          'Pausa (min)',
          'Tareas',
          'Notas',
        ],
      ];

      flatPanels.forEach((panel) => {
        const start = panel.station_started_at || null;
        const end = panel.station_finished_at || panel.finished_at || null;
        const tasks = Array.isArray(panel.tasks) ? panel.tasks : [];
        const taskNames = tasks
          .map((task) => task.task_name || `Tarea ${task.task_definition_id ?? ''}`)
          .filter(Boolean)
          .join(' | ');
        const notes = collectTaskNotes(tasks).join(' | ');
        rows.push([
          panel.panel_code || '-',
          panel.house_identifier || '-',
          panel.module_number != null ? String(panel.module_number) : '-',
          panel.available_at ? formatDateTime(panel.available_at) : '-',
          start ? formatDateTime(start) : '-',
          end ? formatDateTime(end) : '-',
          panel.expected_minutes != null ? String(panel.expected_minutes) : '-',
          panel.actual_minutes != null ? String(panel.actual_minutes) : '-',
          panel.paused_minutes != null ? String(panel.paused_minutes) : '-',
          taskNames || '-',
          notes || '-',
        ]);
      });

      const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `paneles-estacion-${selectedStationId}-${selectedDate}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error generando exportacion';
      setExportError(message);
    } finally {
      setExporting(false);
    }
  };

  const dayStartTs = useMemo(() => {
    try {
      return new Date(`${selectedDate}T08:20:00`).getTime();
    } catch {
      return null;
    }
  }, [selectedDate]);

  const dayEndTs = useMemo(() => {
    try {
      return new Date(`${selectedDate}T23:59:59.999`).getTime();
    } catch {
      return null;
    }
  }, [selectedDate]);

  const panelDetails = useMemo(() => {
    const dailyStartBound = dayStartTs ?? Number.NEGATIVE_INFINITY;
    const dailyEndBound = dayEndTs ?? Number.POSITIVE_INFINITY;

    return flatPanels.map((rawPanel) => {
      const availableTs = toTs(rawPanel.available_at ?? null);
      const startedTs = toTs(rawPanel.station_started_at ?? null);
      const finishedTs = toTs(rawPanel.station_finished_at ?? rawPanel.finished_at ?? null);

      const pauses = Array.isArray(rawPanel.pauses) ? rawPanel.pauses : [];
      type PauseSegment = {
        start: number;
        end: number;
        reason: string | null;
        rawStart: string | null;
        rawEnd: string | null;
      };

      const pauseSegments: PauseSegment[] = [];
      const workSegments: Array<{ start: number; end: number }> = [];

      if (startedTs != null && finishedTs != null && finishedTs >= startedTs) {
        const normalizedPauses = pauses
          .map((pause) => {
            const rawStart = pause?.paused_at ? String(pause.paused_at) : null;
            const rawEnd = pause?.resumed_at ? String(pause.resumed_at) : null;
            const start = toTs(rawStart);
            const endCandidate = toTs(rawEnd);
            const endResolved = endCandidate != null ? endCandidate : finishedTs;
            if (start == null || endResolved == null || endResolved <= start) {
              return null;
            }
            return {
              start,
              end: endResolved,
              reason: pause?.reason ?? null,
              rawStart,
              rawEnd: rawEnd ?? null,
            };
          })
          .filter((pause): pause is PauseSegment => pause != null)
          .sort((a, b) => a.start - b.start);

        let cursor = startedTs;
        normalizedPauses.forEach((pause) => {
          const pauseStart = Math.max(startedTs, Math.min(pause.start, finishedTs));
          const pauseEnd = Math.max(startedTs, Math.min(pause.end, finishedTs));
          if (pauseEnd <= pauseStart) {
            return;
          }
          if (pauseStart > cursor) {
            workSegments.push({ start: cursor, end: pauseStart });
          }
          pauseSegments.push({
            start: pauseStart,
            end: pauseEnd,
            reason: pause.reason,
            rawStart: pause.rawStart,
            rawEnd: pause.rawEnd,
          });
          cursor = pauseEnd;
        });

        if (cursor < finishedTs) {
          workSegments.push({ start: cursor, end: finishedTs });
        }
      }

      const workTotalMs = workSegments.reduce((acc, seg) => acc + Math.max(0, seg.end - seg.start), 0);
      const pauseTotalMs = pauseSegments.reduce((acc, seg) => acc + Math.max(0, seg.end - seg.start), 0);

      const expectedMinutes = toFiniteNumber(rawPanel.expected_minutes);
      const expectedMs = expectedMinutes != null ? expectedMinutes * 60000 : null;

      const includeInDailySummary =
        startedTs != null && finishedTs != null && startedTs >= dailyStartBound && finishedTs <= dailyEndBound;

      const clampSegmentToDay = (seg: { start: number; end: number } | null) => {
        if (!seg) return null;
        const start = Math.max(seg.start, dailyStartBound);
        const end = Math.min(seg.end, dailyEndBound);
        if (end <= start) return null;
        return { ...seg, start, end };
      };

      const dailyWorkSegments = includeInDailySummary
        ? workSegments
            .map(clampSegmentToDay)
            .filter((seg): seg is { start: number; end: number } => Boolean(seg))
        : [];

      const dailyPauseSegments = includeInDailySummary
        ? pauseSegments
            .map((seg) => {
              if (seg.start < dailyStartBound || seg.end > dailyEndBound) {
                return null;
              }
              return clampSegmentToDay(seg);
            })
            .filter((seg): seg is { start: number; end: number } => Boolean(seg))
        : [];

      const dailyWorkTotalMs = dailyWorkSegments.reduce(
        (acc, seg) => acc + Math.max(0, seg.end - seg.start),
        0
      );
      const dailyPauseTotalMs = dailyPauseSegments.reduce(
        (acc, seg) => acc + Math.max(0, seg.end - seg.start),
        0
      );

      const dailyPausedMinutes = includeInDailySummary
        ? dailyPauseTotalMs > 0
          ? dailyPauseTotalMs / 60000
          : 0
        : null;

      const actualWorkMinutes = includeInDailySummary
        ? dailyWorkTotalMs > 0
          ? dailyWorkTotalMs / 60000
          : Number.isFinite(rawPanel.actual_minutes)
            ? rawPanel.actual_minutes
            : null
        : null;

      const totalWorkMinutes = workTotalMs > 0
        ? workTotalMs / 60000
        : Number.isFinite(rawPanel.actual_minutes)
          ? rawPanel.actual_minutes
          : null;

      const totalPausedMinutes = pauseTotalMs > 0
        ? pauseTotalMs / 60000
        : Number.isFinite(rawPanel.paused_minutes)
          ? rawPanel.paused_minutes
          : 0;

      let overtimeMs = 0;
      let savedMs = 0;
      let overtimeStartTs: number | null = null;
      let expectedFinishTs: number | null = finishedTs ?? null;

      if (expectedMs != null && startedTs != null && workSegments.length > 0) {
        const workDurationsMs = workSegments.map((seg) => Math.max(0, seg.end - seg.start));
        const workCumulative = workDurationsMs.reduce((acc, val) => acc + val, 0);

        if (workCumulative > expectedMs) {
          overtimeMs = workCumulative - expectedMs;
        } else if (workCumulative < expectedMs) {
          savedMs = expectedMs - workCumulative;
        }

        let consumed = 0;
        let thresholdFound = false;
        for (let i = 0; i < workSegments.length; i += 1) {
          const seg = workSegments[i];
          const segDuration = workDurationsMs[i];
          if (segDuration <= 0) {
            continue;
          }
          if (!thresholdFound && consumed + segDuration >= expectedMs) {
            const offset = expectedMs - consumed;
            expectedFinishTs = seg.start + offset;
            overtimeStartTs = expectedFinishTs < seg.end ? expectedFinishTs : seg.end;
            thresholdFound = true;
            break;
          }
          consumed += segDuration;
        }

        if (!thresholdFound) {
          if (finishedTs != null) {
            expectedFinishTs = finishedTs + (expectedMs - workCumulative);
            overtimeStartTs = null;
          }
        }
      } else if (expectedMs != null && startedTs != null && finishedTs != null) {
        const elapsedMs = Math.max(0, finishedTs - startedTs);
        if (elapsedMs > expectedMs) {
          overtimeMs = elapsedMs - expectedMs;
          overtimeStartTs = startedTs + expectedMs;
          expectedFinishTs = startedTs + expectedMs;
        } else {
          savedMs = expectedMs - elapsedMs;
          expectedFinishTs = finishedTs + savedMs;
        }
      }

      if (expectedFinishTs == null && finishedTs != null) {
        expectedFinishTs = finishedTs;
      }

      const dailyAvailableTs = includeInDailySummary && availableTs != null
        ? Math.max(availableTs, dailyStartBound)
        : null;

      const dailyStartedTs = includeInDailySummary && startedTs != null
        ? Math.max(startedTs, dailyStartBound)
        : null;

      const dailyFinishedTs = includeInDailySummary && finishedTs != null
        ? Math.min(finishedTs, dailyEndBound)
        : null;

      return {
        ...rawPanel,
        available_ts: availableTs,
        started_ts: startedTs,
        finished_ts: finishedTs,
        workSegments,
        pauseSegments,
        workTotalMs,
        pausedMinutes: Number.isFinite(dailyPausedMinutes) ? dailyPausedMinutes : null,
        total_paused_minutes: Number.isFinite(totalPausedMinutes) ? totalPausedMinutes : null,
        total_work_minutes: Number.isFinite(totalWorkMinutes) ? totalWorkMinutes : null,
        expectedMs,
        actual_work_minutes: Number.isFinite(actualWorkMinutes) ? actualWorkMinutes : null,
        overtimeMs,
        savedMs,
        overtimeStartTs,
        expectedFinishTs,
        tasks: Array.isArray(rawPanel.tasks) ? rawPanel.tasks : [],
        includeInDailySummary,
        daily_available_ts: dailyAvailableTs,
        daily_started_ts: dailyStartedTs,
        daily_finished_ts: dailyFinishedTs,
        daily_work_segments: dailyWorkSegments,
        daily_pause_segments: dailyPauseSegments,
        daily_work_total_ms: includeInDailySummary ? dailyWorkTotalMs : null,
        daily_paused_minutes: Number.isFinite(dailyPausedMinutes) ? dailyPausedMinutes : null,
        daily_actual_work_minutes: Number.isFinite(actualWorkMinutes) ? actualWorkMinutes : null,
      };
    });
  }, [flatPanels, dayStartTs, dayEndTs]);

  const panelTaskRows = useMemo(() => {
    return flatPanels.flatMap((panel) => {
      const base = {
        plan_id: panel.plan_id,
        panel_definition_id: panel.panel_definition_id,
        panel_code: panel.panel_code,
        house_identifier: panel.house_identifier,
        module_number: panel.module_number,
        panel_area: panel.panel_area,
      };
      const panelTasks = Array.isArray(panel.tasks) ? panel.tasks : [];
      if (!panelTasks.length) {
        const finishedAt = panel.station_finished_at || panel.finished_at;
        if (!finishedAt) {
          return [];
        }
        return [
          {
            ...base,
            satisfied_at: finishedAt,
          },
        ];
      }
      return panelTasks.map((task) => {
        const mergedArea = toFiniteNumber(task?.panel_area);
        return {
          ...base,
          ...task,
          plan_id: task?.plan_id != null ? task.plan_id : base.plan_id,
          panel_definition_id:
            task?.panel_definition_id != null ? task.panel_definition_id : base.panel_definition_id,
          panel_code: task?.panel_code != null ? task.panel_code : base.panel_code,
          house_identifier: task?.house_identifier != null ? task.house_identifier : base.house_identifier,
          module_number: task?.module_number != null ? task.module_number : base.module_number,
          panel_area: mergedArea != null ? mergedArea : base.panel_area,
        };
      });
    });
  }, [flatPanels]);

  const panelsPassedAggregate = useMemo(() => {
    const seen = new Set<string>();
    const list: PanelsFinishedPanelSummary[] = [];

    const pushIfNew = (panel: PanelsFinishedPanelSummary) => {
      const key = `${panel?.plan_id ?? ''}-${panel?.panel_definition_id ?? ''}`;
      if (!key || seen.has(key)) return;
      seen.add(key);
      list.push(panel);
    };

    const backendList = Array.isArray(data?.panels_passed_today_list)
      ? data.panels_passed_today_list
      : [];
    if (backendList.length > 0) {
      backendList.forEach(pushIfNew);
    } else {
      panelTaskRows.forEach((panel) => {
        const finish = panel.satisfied_at;
        if (!finish) return;
        pushIfNew({
          plan_id: panel.plan_id,
          panel_definition_id: panel.panel_definition_id,
          panel_code: panel.panel_code,
          house_identifier: panel.house_identifier,
          module_number: panel.module_number,
          panel_area: panel.panel_area,
          satisfied_at: finish,
        });
      });
    }

    const areaTotal = list.reduce((acc, item) => {
      const area = toFiniteNumber(item?.panel_area);
      if (area == null) return acc;
      return acc + area;
    }, 0);

    return {
      count: seen.size,
      list,
      areaTotal,
    };
  }, [data?.panels_passed_today_list, panelTaskRows]);

  const panelsPassedCount = panelsPassedAggregate.count > 0
    ? panelsPassedAggregate.count
    : Number.isFinite(data?.total_panels_finished)
      ? Number(data?.total_panels_finished)
      : 0;

  const panelsPassedArea = (() => {
    const aggregatedArea = toFiniteNumber(panelsPassedAggregate?.areaTotal);
    if (aggregatedArea !== null) return aggregatedArea;
    const backendArea = toFiniteNumber(data?.panels_passed_today_area_sum);
    if (backendArea !== null) return backendArea;
    return 0;
  })();
  const panelsPassedAreaDisplay = Number.isFinite(panelsPassedArea) ? panelsPassedArea.toFixed(1) : '0.0';

  const panelsPassedTooltip = useMemo(() => {
    const sourceList = Array.isArray(panelsPassedAggregate?.list) ? panelsPassedAggregate.list : [];
    if (!sourceList.length) return '';
    const sorted = [...sourceList].sort((a, b) => {
      const aTs = a?.satisfied_at;
      const bTs = b?.satisfied_at;
      if (aTs && bTs && aTs !== bTs) return String(aTs).localeCompare(String(bTs));
      const codeA = a?.panel_code ? String(a.panel_code) : '';
      const codeB = b?.panel_code ? String(b.panel_code) : '';
      return codeA.localeCompare(codeB);
    });
    const width = String(sorted.length).length;
    const lines = sorted.map((panel, idx) => {
      const num = String(idx + 1).padStart(width, '0');
      const moduleLabel = panel?.module_number != null ? `Mod ${panel.module_number}` : '';
      const houseLabel = panel?.house_identifier ? `Casa ${panel.house_identifier}` : '';
      const details = [houseLabel, moduleLabel].filter(Boolean).join(' / ');
      const areaVal = toFiniteNumber(panel?.panel_area);
      const areaText = areaVal != null && areaVal > 0 ? `${areaVal.toFixed(1)} m2` : '';
      const base = panel?.panel_code ? String(panel.panel_code) : `Panel ${panel?.panel_definition_id ?? ''}`;
      const suffixParts = [];
      if (details) suffixParts.push(details);
      if (areaText) suffixParts.push(areaText);
      const suffix = suffixParts.length ? ` - ${suffixParts.join(' / ')}` : '';
      return `${num}. ${base}${suffix}`;
    });
    return lines.join('\n');
  }, [panelsPassedAggregate?.list]);

  useEffect(() => {
    setActivePanelId(null);
    setTooltipPosition({ x: 0, y: 0 });
  }, [panelDetails]);

  useEffect(() => {
    const handleMouseUp = () => {
      setActivePanelId(null);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const scoreSummary = useMemo(() => {
    if (!Array.isArray(panelDetails) || panelDetails.length === 0) {
      return {
        idleMinutes: 0,
        overtimeMinutes: 0,
        savedMinutes: 0,
        pausedMinutes: 0,
        scoreMinutes: 0,
        hasData: false,
      };
    }

    const sorted = [...panelDetails].sort((a, b) => {
      const sa = a.daily_started_ts ?? Number.POSITIVE_INFINITY;
      const sb = b.daily_started_ts ?? Number.POSITIVE_INFINITY;
      if (sa === sb) {
        const codeA = a.panel_code ? String(a.panel_code) : '';
        const codeB = b.panel_code ? String(b.panel_code) : '';
        return codeA.localeCompare(codeB);
      }
      return sa - sb;
    });

    let prevFinishTs: number | null = null;
    let idleMinutes = 0;
    let overtimeMinutes = 0;
    let savedMinutes = 0;
    let pausedMinutesTotal = 0;
    let hasTimingData = false;

    sorted.forEach((panel) => {
      if (!panel.includeInDailySummary) {
        return;
      }

      const startTs = panel.daily_started_ts;
      const finishTs = panel.daily_finished_ts;
      if (startTs == null || finishTs == null) {
        return;
      }

      const availableTs = panel.daily_available_ts != null ? panel.daily_available_ts : startTs;

      const paused = toFiniteNumber(panel.daily_paused_minutes) ?? 0;
      if (paused > 0) {
        pausedMinutesTotal += paused;
        hasTimingData = true;
      }

      const expectedMinutes = panel.expectedMs != null
        ? panel.expectedMs / 60000
        : Number.isFinite(panel.expected_minutes)
          ? panel.expected_minutes
          : null;
      const actualWorkMinutes = (() => {
        const dailyActual = toFiniteNumber(panel.daily_actual_work_minutes);
        if (dailyActual != null) return dailyActual;
        if (panel.daily_work_total_ms != null && panel.daily_work_total_ms > 0) {
          return panel.daily_work_total_ms / 60000;
        }
        return null;
      })();

      if (expectedMinutes != null && actualWorkMinutes != null) {
        hasTimingData = true;
        if (actualWorkMinutes > expectedMinutes) {
          overtimeMinutes += actualWorkMinutes - expectedMinutes;
        } else if (expectedMinutes > actualWorkMinutes) {
          savedMinutes += expectedMinutes - actualWorkMinutes;
        }
      }

      if (prevFinishTs != null) {
        const idleStart = availableTs != null ? Math.max(prevFinishTs, availableTs) : prevFinishTs;
        if (startTs > idleStart) {
          idleMinutes += (startTs - idleStart) / 60000;
          hasTimingData = true;
        }
      }

      prevFinishTs = prevFinishTs == null ? finishTs : Math.max(prevFinishTs, finishTs);
    });

    const scoreMinutes = overtimeMinutes + idleMinutes + pausedMinutesTotal - savedMinutes;
    const lunchBreakMinutes = hasTimingData ? LUNCH_BREAK_MINUTES : 0;
    const adjustedScore = scoreMinutes - lunchBreakMinutes;
    const round2 = (val: number) => Math.round(val * 100) / 100;
    return {
      idleMinutes: round2(idleMinutes),
      overtimeMinutes: round2(overtimeMinutes),
      savedMinutes: round2(savedMinutes),
      pausedMinutes: round2(pausedMinutesTotal),
      lunchBreakMinutes: round2(lunchBreakMinutes),
      scoreMinutes: round2(adjustedScore),
      hasData: hasTimingData,
    };
  }, [panelDetails]);

  const displaySummary = useMemo(() => {
    return {
      ...scoreSummary,
      pausedMinutes: Number.isFinite(scoreSummary.pausedMinutes) ? scoreSummary.pausedMinutes : 0,
    };
  }, [scoreSummary]);

  const timelineBounds = useMemo(() => {
    let minT: number | null = null;
    let maxT: number | null = null;
    panelDetails.forEach((panel) => {
      const avail = panel.available_ts ?? panel.started_ts;
      const finish = panel.finished_ts;
      if (avail != null) {
        minT = minT == null ? avail : Math.min(minT, avail);
      }
      if (finish != null) {
        maxT = maxT == null ? finish : Math.max(maxT, finish);
      }
      if (panel.expectedFinishTs != null) {
        maxT = maxT == null ? panel.expectedFinishTs : Math.max(maxT, panel.expectedFinishTs);
      }
    });
    if (dayStartTs != null) {
      if (minT == null || minT < dayStartTs) {
        minT = dayStartTs;
      }
    }
    if (minT != null && maxT != null && maxT <= minT) {
      maxT = minT + 60 * 1000;
    }
    return { minT, maxT };
  }, [panelDetails, dayStartTs]);

  const percent = (t: number | null) => {
    const { minT, maxT } = timelineBounds;
    if (t == null || minT == null || maxT == null) return 0;
    const value = (t - minT) / (maxT - minT);
    return Math.max(0, Math.min(1, value)) * 100;
  };

  const epsilon = 0.05;
  const hasScoreData = displaySummary.hasData;
  const netMinutes = displaySummary.scoreMinutes;
  const isPositive = hasScoreData && netMinutes > epsilon;
  const isNegative = hasScoreData && netMinutes < -epsilon;
  let scoreColor = '#555';
  let scoreBackground = '#f2f2f2';
  let scoreBorder = '#d5d5d5';
  if (isPositive) {
    scoreColor = '#d32f2f';
    scoreBackground = 'rgba(211,47,47,0.08)';
    scoreBorder = 'rgba(211,47,47,0.3)';
  } else if (isNegative) {
    scoreColor = '#1b5e20';
    scoreBackground = 'rgba(56,142,60,0.12)';
    scoreBorder = 'rgba(56,142,60,0.3)';
  }

  const scoreDescriptor = !hasScoreData
    ? 'Tiempo neto'
    : isPositive
      ? 'Tiempo neto perdido'
      : isNegative
        ? 'Tiempo neto ahorrado'
        : 'Tiempo neto sin variacion';
  const scoreValueLabel = hasScoreData ? formatMinutesShort(netMinutes, true) : '-';
  const scoreTooltip = hasScoreData
    ? [
        'Detalle de tiempo:',
        `- Tiempo ocioso: ${formatMinutesDetailed(displaySummary.idleMinutes)}`,
        `- Minutos extra (trabajo): ${formatMinutesDetailed(displaySummary.overtimeMinutes)}`,
        `- Tiempo en pausa: ${formatMinutesDetailed(displaySummary.pausedMinutes)}`,
        `- Minutos ahorrados (resta): ${formatMinutesDetailed(displaySummary.savedMinutes)}`,
        `- Almuerzo (resta fija): ${formatMinutesDetailed(
          displaySummary.lunchBreakMinutes ?? LUNCH_BREAK_MINUTES
        )}`,
        `- Neto: ${formatMinutesDetailed(netMinutes)}`,
      ].join('\n')
    : 'Sin datos de tiempo';

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-black/5 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Dashboards</p>
            <h1 className="font-display text-xl text-[var(--ink)]">Paneles finalizados por estacion</h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Revisa paneles terminados, pausas y duraciones por estacion y fecha.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)]"
              onClick={() => fetchData(selectedStationId, selectedDate)}
              disabled={loading}
            >
              <RefreshCcw className="h-4 w-4" />
              Actualizar
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white"
              onClick={handleExport}
              disabled={loading || exporting}
            >
              <Download className="h-4 w-4" />
              {exporting ? 'Generando...' : 'Exportar CSV'}
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Estacion
            <select
              value={selectedStationId}
              onChange={(event) => onStationChange(event.target.value)}
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
            >
              {panelStations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Dia
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink)]"
                onClick={() => changeDay(-1)}
                disabled={loading}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input
                className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                type="date"
                value={selectedDate}
                onChange={(event) => onDateChange(event.target.value)}
              />
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-[var(--ink)]"
                onClick={() => changeDay(1)}
                disabled={loading}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </label>
        </div>

        {(stationsError || error || exportError) && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {stationsError || error || exportError}
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Paneles diarios</p>
          <p
            className="mt-2 text-2xl font-semibold text-[var(--ink)]"
            title={panelsPassedTooltip || undefined}
          >
            {panelsPassedCount}
          </p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Superficie producida</p>
          <p
            className="mt-2 text-2xl font-semibold text-[var(--ink)]"
            title={panelsPassedTooltip || undefined}
          >
            {panelsPassedAreaDisplay} m2
          </p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">{scoreDescriptor}</p>
          <p
            className="mt-2 text-2xl font-semibold"
            title={scoreTooltip}
            style={{ color: scoreColor }}
          >
            {scoreValueLabel}
          </p>
          <div
            className="mt-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]"
            style={{ color: scoreColor, background: scoreBackground, borderColor: scoreBorder }}
          >
            Balance diario
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--ink-muted)]">
          <span className="flex items-center gap-2">
            <span className="h-2 w-5 border border-black/20 bg-[#bbb]" />
            Tiempo disponible pre ejecucion
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2 w-5 border border-black/20 bg-[#4a90e2]" />
            Tiempo de ejecucion
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2 w-5 border border-black/20" style={{ background: PAUSE_COLOR }} />
            Tiempo en pausa
          </span>
          <span className="flex items-center gap-2">
            <span className="relative inline-block h-3 w-4">
              <span className="absolute left-0 right-0 top-0 h-0.5" style={{ background: GAP_COLOR }} />
              <span className="absolute bottom-0 left-1/2 top-0 w-0.5" style={{ background: GAP_COLOR }} />
            </span>
            Tiempo ocioso entre paneles
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2 w-5 border border-black/20 bg-[#ff0000]" />
            Minutos extra vs esperado
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2 w-5 border border-black/20 bg-[#52c41a]" />
            Minutos ahorrados vs esperado
          </span>
        </div>
      </section>

      {(() => {
        const sorted = [...panelDetails].sort((a, b) => {
          const sa = a.started_ts ?? Number.POSITIVE_INFINITY;
          const sb = b.started_ts ?? Number.POSITIVE_INFINITY;
          if (sa === sb) {
            const codeA = a.panel_code ? String(a.panel_code) : '';
            const codeB = b.panel_code ? String(b.panel_code) : '';
            return codeA.localeCompare(codeB);
          }
          return sa - sb;
        });
        const axisMin = timelineBounds.minT;
        const axisMax = timelineBounds.maxT;
        const axis = axisMin != null && axisMax != null;
        const clampToStart = (ts: number | null) => {
          if (ts == null) return null;
          if (dayStartTs == null) return ts;
          return Math.max(ts, dayStartTs);
        };
        const formatTsLabel = (ts: number | null, raw: string | null) => {
          if (raw) return formatDateTime(raw);
          if (ts == null) return '-';
          try {
            const d = new Date(ts);
            if (Number.isNaN(d.getTime())) return '-';
            const iso = d.toISOString();
            return formatDateTime(`${iso.slice(0, 10)} ${iso.slice(11, 19)}`);
          } catch {
            return '-';
          }
        };

        return (
          <section className="rounded-2xl border border-black/5 bg-white/90 shadow-sm">
            <div
              className="grid items-center border-b border-black/10 bg-white/70 px-4 py-2 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]"
              style={{ gridTemplateColumns: '300px 260px 1fr' }}
            >
              <div>Panel</div>
              <div>Duracion (vs esperado)</div>
              <div className="text-[11px] text-[var(--ink-muted)]">
                {axis && (
                  <div className="flex items-center justify-between">
                    <span>
                      {new Date(axisMin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span>
                      {new Date(axisMax).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div>
              {sorted.map((panel, idx) => {
                const availableRawTs = panel.available_ts != null ? panel.available_ts : panel.started_ts;
                const startTsRaw = panel.started_ts;
                const finishTsRaw = panel.finished_ts;
                const availableTs = clampToStart(availableRawTs);
                const startTs = clampToStart(startTsRaw);
                const waitLeft = percent(availableTs);
                const waitRight = percent(startTs);
                const waitWidth = Math.max(0, waitRight - waitLeft);

                const prev = idx > 0 ? sorted[idx - 1] : null;
                const prevFinishRaw = prev && prev.finished_ts != null ? prev.finished_ts : null;
                const startPct = percent(startTsRaw);
                const prevFinishPct = percent(prevFinishRaw);
                const gapMs = prevFinishRaw != null && startTsRaw != null ? startTsRaw - prevFinishRaw : null;
                const gapElement = (() => {
                  if (gapMs == null) return null;
                  const labelDuration = formatGapDuration(Math.abs(gapMs));
                  const titleText =
                    gapMs >= 0
                      ? `Tiempo entre fin anterior e inicio: ${labelDuration}`
                      : `Este panel empezo ${labelDuration} antes de terminar el anterior`;
                  const spanLeft = Math.min(startPct, prevFinishPct);
                  const spanWidth = Math.abs(startPct - prevFinishPct);
                  const extendsLeft = startPct >= prevFinishPct;
                  const clampedLeft = Math.max(0, Math.min(100, spanLeft));
                  const inlineWidth = Math.max(0, Math.min(100, spanWidth));
                  const verticalSide = extendsLeft ? 'right' : 'left';
                  return (
                    <div
                      title={titleText}
                      style={{
                        position: 'absolute',
                        left: `${clampedLeft}%`,
                        width: `${inlineWidth}%`,
                        top: 2,
                        bottom: 2,
                        pointerEvents: 'auto',
                        zIndex: 3,
                      }}
                    >
                      {inlineWidth > 0 && (
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: '50%',
                            height: 2,
                            marginTop: -1,
                            background: GAP_COLOR,
                          }}
                        />
                      )}
                      <div
                        style={{
                          position: 'absolute',
                          [verticalSide]: inlineWidth > 0 ? 0 : -1,
                          top: 4,
                          bottom: 4,
                          width: 2,
                          background: GAP_COLOR,
                        }}
                      />
                    </div>
                  );
                })();

                const workElements = panel.workSegments
                  .map((seg, segIdx) => {
                    const segStart = clampToStart(seg.start);
                    const segEnd = clampToStart(seg.end);
                    if (segStart == null || segEnd == null || segEnd <= segStart) return null;
                    const left = percent(segStart);
                    const right = percent(segEnd);
                    const width = Math.max(0, right - left);
                    if (width <= 0) return null;
                    const workTitle = `Trabajo: ${formatTsLabel(seg.start, null)} -> ${formatTsLabel(seg.end, null)}`;
                    return (
                      <div
                        key={`work-${segIdx}`}
                        style={{
                          position: 'absolute',
                          left: `${left}%`,
                          width: `${width}%`,
                          top: 4,
                          bottom: 4,
                          background: '#4a90e2',
                          borderRadius: 0,
                          zIndex: 2,
                        }}
                        title={workTitle}
                      />
                    );
                  })
                  .filter(Boolean);

                const pauseElements = panel.pauseSegments
                  .map((seg, pauseIdx) => {
                    const segStart = clampToStart(seg.start);
                    const segEnd = clampToStart(seg.end);
                    if (segStart == null || segEnd == null || segEnd <= segStart) return null;
                    const left = percent(segStart);
                    const right = percent(segEnd);
                    const width = Math.max(0, right - left);
                    if (width <= 0) return null;
                    const durationMs = seg.end - seg.start;
                    const reason = seg.reason ? `Motivo: ${seg.reason}` : 'Sin motivo';
                    const titleText = `${reason}\n${formatTsLabel(seg.start, seg.rawStart ?? null)} -> ${formatTsLabel(
                      seg.end,
                      seg.rawEnd ?? null
                    )}\nDuracion: ${formatGapDuration(durationMs)}`;
                    return (
                      <div
                        key={`pause-${pauseIdx}`}
                        title={titleText}
                        style={{
                          position: 'absolute',
                          left: `${left}%`,
                          width: `${width}%`,
                          top: 6,
                          bottom: 6,
                          background: PAUSE_COLOR,
                          opacity: 0.8,
                          borderRadius: 0,
                          zIndex: 4,
                        }}
                      />
                    );
                  })
                  .filter(Boolean);

                const overtimeElements = (() => {
                  if (!(panel.overtimeMs > 0 && panel.overtimeStartTs != null)) return null;
                  const elems: React.ReactElement[] = [];
                  panel.workSegments.forEach((seg, segIdx) => {
                    const segmentStart = Math.max(seg.start, panel.overtimeStartTs ?? 0);
                    const segmentEnd = seg.end;
                    if (segmentEnd <= segmentStart) return;
                    const left = percent(clampToStart(segmentStart));
                    const right = percent(clampToStart(segmentEnd));
                    const width = Math.max(0, right - left);
                    if (width <= 0) return;
                    elems.push(
                      <div
                        key={`overtime-${segIdx}`}
                        style={{
                          position: 'absolute',
                          left: `${left}%`,
                          width: `${width}%`,
                          top: 4,
                          bottom: 4,
                          background: '#ff0000',
                          opacity: 0.6,
                          borderRadius: 0,
                          zIndex: 5,
                        }}
                        title={`Extra: ${formatMinutesDetailed((panel.overtimeMs || 0) / 60000)}`}
                      />
                    );
                  });
                  return elems.length ? elems : null;
                })();

                const savedElement = (() => {
                  if (!(panel.savedMs > 0 && panel.expectedFinishTs != null && finishTsRaw != null)) return null;
                  const startPctSaved = percent(clampToStart(finishTsRaw));
                  const endPctSaved = percent(clampToStart(panel.expectedFinishTs));
                  const widthSaved = Math.max(0, endPctSaved - startPctSaved);
                  if (widthSaved <= 0) return null;
                  return (
                    <div
                      style={{
                        position: 'absolute',
                        left: `${startPctSaved}%`,
                        width: `${widthSaved}%`,
                        top: 4,
                        bottom: 4,
                        background: '#52c41a',
                        opacity: 0.4,
                        borderRadius: 0,
                        zIndex: 3,
                      }}
                      title={`Ahorrado: ${formatMinutesDetailed((panel.savedMs || 0) / 60000)}`}
                    />
                  );
                })();

                const isActive = activePanelId === panel.id;
                const taskDetails = Array.isArray(panel.tasks) ? panel.tasks : [];
                const startTsNum = Number.isFinite(panel.started_ts) ? panel.started_ts : null;
                const finishTsNum = Number.isFinite(panel.finished_ts) ? panel.finished_ts : null;
                const durationMs =
                  startTsNum != null && finishTsNum != null && finishTsNum > startTsNum
                    ? finishTsNum - startTsNum
                    : null;
                const spanMinutes = durationMs != null ? durationMs / 60000 : null;
                const durationLabel = Number.isFinite(spanMinutes) ? formatMinutesShort(spanMinutes) : '-';
                const durationDetailedLabel = durationMs != null ? formatGapDuration(durationMs) : '-';
                const expectedMinutes = (() => {
                  const byMinutes = toFiniteNumber(panel.expected_minutes);
                  if (byMinutes != null) return byMinutes;
                  const expectedMs = toFiniteNumber(panel.expectedMs);
                  return expectedMs != null ? expectedMs / 60000 : null;
                })();
                const hasExpected = expectedMinutes != null;
                const workedMinutes = (() => {
                  const dailyActual = toFiniteNumber(panel.daily_actual_work_minutes);
                  if (dailyActual != null) return dailyActual;
                  const totalWork = toFiniteNumber(panel.total_work_minutes);
                  if (totalWork != null) return totalWork;
                  return toFiniteNumber(panel.actual_minutes);
                })();
                const diffMinutes =
                  workedMinutes != null && expectedMinutes != null ? workedMinutes - expectedMinutes : null;
                const diffLabel = diffMinutes != null ? formatMinutesShort(diffMinutes, true) : '-';
                const diffColor =
                  diffMinutes != null
                    ? diffMinutes > 0
                      ? '#d32f2f'
                      : diffMinutes < 0
                        ? '#388e3c'
                        : '#555'
                    : '#999';
                const pausedMinutes = (() => {
                  const daily = toFiniteNumber(panel.daily_paused_minutes);
                  if (daily !== null) return daily;
                  const total = toFiniteNumber(panel.total_paused_minutes);
                  if (total !== null) return total;
                  return toFiniteNumber(panel.paused_minutes);
                })();
                const pausedLabel = pausedMinutes != null ? formatMinutesShort(pausedMinutes) : '-';
                const pausedDetailedLabel =
                  pausedMinutes != null ? formatMinutesDetailed(pausedMinutes) : '-';
                const hasPaused = pausedMinutes != null && pausedMinutes > 0;
                const expectedLabel = hasExpected ? formatMinutesShort(expectedMinutes) : '-';
                const durationTitleLines = [
                  `Disponible: ${panel.available_at ? formatDateTime(panel.available_at) : '-'}`,
                  `Inicio: ${panel.station_started_at ? formatDateTime(panel.station_started_at) : '-'}`,
                  `Fin: ${panel.station_finished_at ? formatDateTime(panel.station_finished_at) : '-'}`,
                ];
                if (durationDetailedLabel !== '-') {
                  durationTitleLines.push(`Duracion: ${durationDetailedLabel}`);
                }
                if (Number.isFinite(workedMinutes)) {
                  durationTitleLines.push(`Trabajo efectivo: ${formatMinutesDetailed(workedMinutes)}`);
                }
                if (hasExpected) {
                  durationTitleLines.push(`Esperado: ${formatMinutesDetailed(expectedMinutes)}`);
                }
                if (diffMinutes != null) {
                  durationTitleLines.push(`Diferencia: ${diffLabel}`);
                }
                if (hasPaused && pausedDetailedLabel !== '-') {
                  durationTitleLines.push(`Pausas: ${pausedDetailedLabel}`);
                }
                const durationTitle = durationTitleLines.join('\n');

                return (
                  <div
                    key={panel.id}
                    style={{ position: 'relative' }}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      setActivePanelId(panel.id);
                      setTooltipPosition({ x: event.clientX, y: event.clientY });
                    }}
                    onMouseMove={(event) => {
                      if (activePanelId === panel.id) {
                        setTooltipPosition({ x: event.clientX, y: event.clientY });
                      }
                    }}
                    onMouseLeave={() => {
                      if (activePanelId === panel.id) {
                        setActivePanelId(null);
                      }
                    }}
                  >
                    <div
                      className="grid items-center gap-2 border-b border-black/5 px-4 py-2 text-sm text-[var(--ink)]"
                      style={{ gridTemplateColumns: '300px 260px 1fr' }}
                    >
                      <div
                        className="truncate"
                        title={`${panel.panel_code} - ${
                          panel.house_identifier ? `#${panel.house_identifier}` : '-'
                        } ${panel.module_number != null ? `MD${panel.module_number}` : ''}`}
                      >
                        {`${panel.panel_code} - ${
                          panel.house_identifier ? `#${panel.house_identifier}` : '-'
                        } ${panel.module_number != null ? `MD${panel.module_number}` : ''}`}
                      </div>
                      <div className="truncate" title={durationTitle}>
                        {durationLabel}
                        {' ('}
                        <span style={{ color: diffColor }}>{diffLabel}</span>
                        {hasPaused && (
                          <>
                            {' / '}
                            <span style={{ color: PAUSE_COLOR }}>Pausa {pausedLabel}</span>
                          </>
                        )}
                        {')'}
                      </div>
                      <div
                        style={{
                          position: 'relative',
                          height: 22,
                          background: '#fafafa',
                          border: '1px dashed #eee',
                          borderRadius: 0,
                        }}
                      >
                        {availableTs != null && startTsRaw != null && waitWidth > 0 && (
                          <div
                            style={{
                              position: 'absolute',
                              left: `${waitLeft}%`,
                              width: `${waitWidth}%`,
                              top: 4,
                              bottom: 4,
                              background: '#bbb',
                              borderRadius: 0,
                            }}
                            title={`Espera: ${formatTsLabel(availableRawTs ?? null, panel.available_at ?? null)} -> ${formatTsLabel(
                              startTsRaw ?? null,
                              panel.station_started_at ?? null
                            )}`}
                          />
                        )}
                        {workElements}
                        {pauseElements}
                        {savedElement}
                        {overtimeElements}
                        {gapElement}
                      </div>
                    </div>

                    {isActive && (
                      <div
                        style={{
                          position: 'fixed',
                          top: Math.max(tooltipPosition.y - 12, 24),
                          left: tooltipPosition.x,
                          background: '#fff',
                          border: '1px solid #ddd',
                          borderRadius: 4,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                          padding: 12,
                          width: 380,
                          maxWidth: '90vw',
                          zIndex: 20,
                          pointerEvents: 'none',
                          transform: 'translate(-50%, -100%)',
                        }}
                      >
                        <div className="mb-2 text-xs text-[var(--ink)]">
                          <div>Inicio: {panel.station_started_at ? formatDateTimeShort(panel.station_started_at) : '-'}</div>
                          <div>Fin: {panel.station_finished_at ? formatDateTimeShort(panel.station_finished_at) : '-'}</div>
                          <div>
                            Duracion: {durationLabel}
                            {' ('}
                            <span style={{ color: diffColor }}>{diffLabel}</span>
                            {hasPaused && (
                              <>
                                {' / '}
                                <span style={{ color: PAUSE_COLOR }}>Pausa {pausedLabel}</span>
                              </>
                            )}
                            {')'}
                            {' - Esperado: '}
                            {expectedLabel}
                          </div>
                        </div>
                        <div className="mb-2 text-sm font-semibold text-[var(--ink)]">Detalle de tareas</div>
                        {taskDetails.length === 0 && (
                          <div className="text-xs text-[var(--ink-muted)]">Sin tareas registradas.</div>
                        )}
                        {taskDetails.map((task: PanelsFinishedTask, taskIdx: number) => {
                          const workerEntries = Array.isArray(task.worker_entries) ? task.worker_entries : [];
                          const workerNames = workerEntries
                            .map((entry) => {
                              if (entry && entry.worker_name) return entry.worker_name;
                              if (entry && entry.worker_id != null) return `ID ${entry.worker_id}`;
                              return null;
                            })
                            .filter((name) => Boolean(name));
                          const uniqueWorkerNames = [...new Set(workerNames)];
                          const notesList = workerEntries
                            .map((entry) => {
                              if (!entry || typeof entry.notes !== 'string') return null;
                              const trimmed = entry.notes.trim();
                              if (!trimmed) return null;
                              const label = entry.worker_name || (entry.worker_id != null ? `ID ${entry.worker_id}` : null);
                              return { worker: label, note: trimmed };
                            })
                            .filter(Boolean) as Array<{ worker: string | null; note: string }>;
                          const pauseList = workerEntries.flatMap((entry) => {
                            const label = entry && (entry.worker_name || (entry.worker_id != null ? `ID ${entry.worker_id}` : null));
                            if (!entry || !Array.isArray(entry.pauses)) return [];
                            return entry.pauses.map((pause: PanelsFinishedPause) => ({
                              worker: label,
                              paused_at: pause?.paused_at,
                              resumed_at: pause?.resumed_at,
                              reason: pause?.reason,
                              duration_seconds: pause?.duration_seconds,
                            }));
                          });
                          const earliestStart = workerEntries.reduce(
                            (acc: { ts: number; raw: string } | null, entry) => {
                              const raw = entry && entry.started_at ? String(entry.started_at) : null;
                              if (!raw) return acc;
                              const ts = toTs(raw);
                              if (ts == null) return acc;
                              if (!acc || ts < acc.ts) {
                                return { ts, raw };
                              }
                              return acc;
                            },
                            null
                          );
                          const latestEndFromEntries = workerEntries.reduce(
                            (acc: { ts: number; raw: string } | null, entry) => {
                              const rawCandidate = entry && entry.completed_at ? String(entry.completed_at) : null;
                              if (!rawCandidate) return acc;
                              const ts = toTs(rawCandidate);
                              if (ts == null) return acc;
                              if (!acc || ts > acc.ts) {
                                return { ts, raw: rawCandidate };
                              }
                              return acc;
                            },
                            null
                          );
                          let latestEnd = latestEndFromEntries;
                          if (!latestEnd) {
                            const fallbackRaw = task && task.satisfied_at ? String(task.satisfied_at) : null;
                            const fallbackTs = fallbackRaw ? toTs(fallbackRaw) : null;
                            if (fallbackRaw && fallbackTs != null) {
                              latestEnd = { ts: fallbackTs, raw: fallbackRaw };
                            }
                          }
                          const taskStartTs = earliestStart ? earliestStart.ts : null;
                          const taskEndTs = latestEnd ? latestEnd.ts : null;
                          const taskDurationMs =
                            taskStartTs != null && taskEndTs != null && taskEndTs > taskStartTs
                              ? taskEndTs - taskStartTs
                              : null;
                          const taskDurationMinutes = taskDurationMs != null ? taskDurationMs / 60000 : null;
                          const taskDurationLabel =
                            Number.isFinite(taskDurationMinutes) ? formatMinutesShort(taskDurationMinutes) : '-';
                          const taskDurationDetailedLabel =
                            taskDurationMs != null ? formatGapDuration(taskDurationMs) : '-';
                          const baseExpectedCandidates = [
                            task && task.expected_minutes,
                            (task as PanelsFinishedTask & { expectedMinutes?: number }).expectedMinutes,
                            (task as PanelsFinishedTask & { expected_duration_minutes?: number }).expected_duration_minutes,
                            (task as PanelsFinishedTask & { expectedDurationMinutes?: number }).expectedDurationMinutes,
                          ];
                          const dynamicExpectedCandidates = Object.entries(task || {})
                            .filter(([key]) => {
                              if (!key) return false;
                              const lower = String(key).toLowerCase();
                              return lower.includes('expected') && (lower.includes('minute') || lower.includes('duration'));
                            })
                            .map(([, value]) => value);
                          const taskExpectedCandidates = [...baseExpectedCandidates, ...dynamicExpectedCandidates];
                          let taskExpectedMinutes: number | null = null;
                          for (const candidate of taskExpectedCandidates) {
                            const parsed = toFiniteNumber(candidate);
                            if (parsed !== null) {
                              taskExpectedMinutes = parsed;
                              break;
                            }
                          }
                          const taskHasExpected = taskExpectedMinutes != null;
                          const taskDiffMinutes =
                            taskDurationMinutes != null && taskExpectedMinutes != null
                              ? taskDurationMinutes - taskExpectedMinutes
                              : null;
                          const taskDiffLabel = taskDiffMinutes != null ? formatMinutesShort(taskDiffMinutes, true) : '-';
                          const taskDiffColor =
                            taskDiffMinutes != null
                              ? taskDiffMinutes > 0
                                ? '#d32f2f'
                                : taskDiffMinutes < 0
                                  ? '#388e3c'
                                  : '#555'
                              : '#999';
                          const taskExpectedLabel = taskHasExpected ? formatMinutesShort(taskExpectedMinutes) : '-';
                          const taskStartLabel = earliestStart ? formatDateTimeShort(earliestStart.raw) : '-';
                          const taskEndLabel = latestEnd ? formatDateTimeShort(latestEnd.raw) : '-';
                          const taskTimeTitle = `Inicio: ${earliestStart ? formatDateTime(earliestStart.raw) : '-'}\nFin: ${
                            latestEnd ? formatDateTime(latestEnd.raw) : '-'
                          }`;
                          const taskDurationTitleParts = [`Duracion exacta: ${taskDurationDetailedLabel}`];
                          if (taskHasExpected) {
                            taskDurationTitleParts.push(`Esperado: ${formatMinutesDetailed(taskExpectedMinutes)}`);
                          }
                          if (taskDiffMinutes != null) {
                            taskDurationTitleParts.push(`Diferencia: ${taskDiffLabel}`);
                          }
                          const taskDurationTitle = taskDurationTitleParts.join('\n');

                          return (
                            <div
                              key={`task-${task.task_definition_id || taskIdx}`}
                              style={{ marginBottom: taskIdx === taskDetails.length - 1 ? 0 : 10 }}
                            >
                              <div className="text-sm font-semibold text-[var(--ink)]">
                                {task.task_name || `Tarea ${task.task_definition_id}`}
                              </div>
                              <div className="mt-1 text-xs text-[var(--ink)]" title={taskTimeTitle}>
                                Tiempo: {taskStartLabel} {'->'} {taskEndLabel}
                              </div>
                              <div className="mt-1 text-xs text-[var(--ink)]" title={taskDurationTitle}>
                                Duracion: {taskDurationLabel}
                                {' ('}
                                <span style={{ color: taskHasExpected ? taskDiffColor : '#999' }}>
                                  {taskHasExpected ? taskDiffLabel : '-'}
                                </span>
                                {')'}
                                {' - Esperado: '}
                                {taskExpectedLabel}
                              </div>
                              <div className="mt-2 text-xs text-[var(--ink)]">
                                Trabajadores: {uniqueWorkerNames.length > 0 ? uniqueWorkerNames.join(', ') : '-'}
                              </div>
                              <div className="mt-2 text-xs text-[var(--ink)]">
                                Notas: {notesList.length > 0 ? '' : 'Sin notas'}
                              </div>
                              {notesList.length > 0 &&
                                notesList.map((note, noteIdx) => (
                                  <div
                                    key={`note-${task.task_definition_id || taskIdx}-${noteIdx}`}
                                    className="mt-1 text-xs text-[var(--ink)]"
                                    style={{ paddingLeft: 10 }}
                                  >
                                    {note.worker ? `${note.worker}: ` : ''}
                                    {note.note}
                                  </div>
                                ))}
                              <div className="mt-2 text-xs text-[var(--ink)]">
                                Pausas: {pauseList.length > 0 ? '' : 'Sin pausas'}
                              </div>
                              {pauseList.length > 0 &&
                                pauseList.map((pause, pauseIdx) => {
                                  const pausedAtLabel = pause.paused_at
                                    ? formatDateTimeShort(pause.paused_at)
                                    : '-';
                                  const resumedAtLabel = pause.resumed_at
                                    ? formatDateTimeShort(pause.resumed_at)
                                    : '-';
                                  const durationSeconds = toFiniteNumber(pause.duration_seconds);
                                  const durationMs = durationSeconds != null ? durationSeconds * 1000 : null;
                                  const durationLabel = durationMs != null ? formatGapDuration(durationMs) : '-';
                                  return (
                                    <div
                                      key={`pause-${task.task_definition_id || taskIdx}-${pauseIdx}`}
                                      className="mt-1 text-xs text-[var(--ink)]"
                                      style={{ paddingLeft: 10 }}
                                    >
                                      {pause.worker ? `${pause.worker}: ` : ''}
                                      {pausedAtLabel} {'->'} {resumedAtLabel} - {durationLabel}
                                      {pause.reason ? ` (${pause.reason})` : ''}
                                    </div>
                                  );
                                })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {sorted.length === 0 && (
                <div className="px-4 py-6 text-sm text-[var(--ink-muted)]">Sin datos</div>
              )}
            </div>
          </section>
        );
      })()}
    </div>
  );
};

export default DashboardPanelAnalysis;
