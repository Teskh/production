import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Filter,
  FlaskConical,
  RefreshCcw,
  Sliders,
  Users,
} from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';
import { formatDateTime, formatMinutesWithUnit } from '../../../utils/timeUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

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
  panel_area?: number | null;
  panel_length_m?: number | null;
  applicable_task_ids: number[] | null;
};

type TaskScope = 'panel' | 'module' | 'aux';

type TaskDefinition = {
  id: number;
  name: string;
  scope: TaskScope;
  active: boolean;
  default_station_sequence: number | null;
};

type TaskApplicabilityRule = {
  id: number;
  task_definition_id: number;
  house_type_id?: number | null;
  sub_type_id?: number | null;
  module_number?: number | null;
  panel_definition_id?: number | null;
  applies: boolean;
  station_sequence_order?: number | null;
};

type Worker = {
  id: number;
  first_name: string;
  last_name: string;
};

type Station = {
  id: number;
  name: string;
  sequence_order: number | null;
  line_type?: string | null;
  role?: 'Panels' | 'Magazine' | 'Assembly' | 'AUX' | string | null;
};

type TaskTimelineSegment = {
  segment_type?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_minutes?: number | null;
  task_definition_id?: number | null;
  task_name?: string | null;
};

type TaskBreakdownRow = {
  task_definition_id?: number | null;
  task_name?: string | null;
  duration_minutes?: number | null;
  raw_duration_minutes?: number | null;
  masked_out_minutes?: number | null;
  expected_minutes?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  worker_name?: string | null;
  pause_minutes?: number | null;
  pauses?: {
    paused_at?: string | null;
    resumed_at?: string | null;
    duration_minutes?: number | null;
    duration_seconds?: number | null;
    reason?: string | null;
  }[] | null;
  timeline_segments?: TaskTimelineSegment[] | null;
};

type DataTableSortKey = 'plan' | 'duration' | 'expected' | 'ratio' | 'completed' | 'worker';
type DataTableSortDirection = 'asc' | 'desc';
type TaskSummarySortKey =
  | 'task'
  | 'samples'
  | 'avgDuration'
  | 'avgExpected'
  | 'avgRatio'
  | 'trendScore'
  | 'minDuration'
  | 'maxDuration'
  | 'lastCompleted';

type AnalysisPoint = {
  plan_id?: number | null;
  house_identifier?: string | null;
  module_number?: number | null;
  task_definition_id?: number | null;
  task_name?: string | null;
  duration_minutes?: number | null;
  expected_minutes?: number | null;
  completed_at?: string | null;
  worker_name?: string | null;
  task_breakdown?: TaskBreakdownRow[] | null;
};

type TimelineSegmentKind = 'active' | 'paused' | 'masked_active' | 'masked_paused';

type DurationTimelineSegment = {
  kind: TimelineSegmentKind;
  started_ms: number;
  ended_ms: number;
  duration_minutes: number;
};

type DurationTimelineLane = {
  label: string;
  segments: DurationTimelineSegment[];
};

type DurationTimelinePreview = {
  key: string;
  title: string;
  started_ms: number;
  ended_ms: number;
  estimated_minutes: number;
  raw_minutes: number | null;
  masked_out_minutes: number;
  pause_minutes: number;
  lanes: DurationTimelineLane[];
  anchor_x: number;
  anchor_y: number;
};

type TaskSummaryRow = {
  key: string;
  task_definition_id: number | null;
  task_name: string;
  sample_count: number;
  expected_sample_count: number;
  ratio_sample_count: number;
  average_duration: number | null;
  average_expected: number | null;
  average_ratio: number | null;
  trend_score: number | null;
  min_duration: number | null;
  max_duration: number | null;
  last_completed_at: string | null;
};

type AnalysisStats = {
  average_duration?: number | null;
};

type AnalysisScope = 'panel' | 'module';

type TaskAnalysisResponse = {
  mode?: 'panel' | 'module' | 'task' | 'station' | string;
  data_points?: AnalysisPoint[] | null;
  expected_reference_minutes?: number | null;
  strict_excluded_count?: number | null;
  stats?: AnalysisStats | null;
};

type TaskAnalysisWorkerOption = {
  worker_id: number;
  worker_name: string;
};

type StationPanelsFinishedPanel = {
  plan_id?: number | null;
  panel_definition_id?: number | null;
  panel_code?: string | null;
  panel_area?: number | null;
  station_finished_at?: string | null;
  finished_at?: string | null;
  actual_minutes?: number | null;
};

type StationPanelsFinishedModule = {
  module_number?: number | null;
  panels?: StationPanelsFinishedPanel[] | null;
};

type StationPanelsFinishedHouse = {
  house_identifier?: string | null;
  house_type_id?: number | null;
  house_type_name?: string | null;
  modules?: StationPanelsFinishedModule[] | null;
};

type StationPanelsFinishedResponse = {
  total_panels_finished?: number | null;
  houses?: StationPanelsFinishedHouse[] | null;
};

type NormalizedMetric = 'linear' | 'area';

type NormalizedCompletionRow = {
  id: string;
  panel_definition_id: number;
  house_type_id: number | null;
  house_type_name: string;
  panel_label: string;
  panel_group: string;
  panel_area: number;
  panel_length_m: number;
  actual_minutes: number;
  normalized_minutes: number;
  finished_at: string | null;
};

type PanelGroupOption = {
  id: string;
  label: string;
  count: number;
};

type HypothesisField = 'worker' | 'date';

type HypothesisOperator = '==' | '!=' | '>' | '>=' | '<' | '<=';

type HypothesisConfig = {
  field: HypothesisField;
  operator: HypothesisOperator;
  value: string;
};

type HypothesisFieldOption = {
  value: HypothesisField;
  label: string;
  operators: { value: HypothesisOperator; label: string }[];
};

type HistogramBin = {
  index: number;
  from: number;
  to: number;
  count: number;
  items: AnalysisPoint[];
  matchCount: number;
};

type HistogramSummary = {
  bins: HistogramBin[];
  maxCount: number;
  binSize: number;
  maxDuration: number;
  totalMatches: number;
};

type NormalizedHistogramBin = {
  index: number;
  from: number;
  to: number;
  count: number;
  items: NormalizedCompletionRow[];
};

type NormalizedHistogramSummary = {
  bins: NormalizedHistogramBin[];
  maxCount: number;
  binSize: number;
  maxValue: number;
};

type RegressionSample = {
  x: number;
  y: number;
};

type RegressionConfidencePoint = {
  x: number;
  predictedY: number;
  lowerY: number;
  upperY: number;
};

type LinearRegressionResult = {
  sampleCount: number;
  slope: number;
  intercept: number;
  correlation: number | null;
  rSquared: number | null;
  adjustedRSquared: number | null;
  rmse: number;
  mae: number;
  meanX: number;
  meanY: number;
  minX: number;
  maxX: number;
  startPredictedY: number;
  endPredictedY: number;
  confidenceBand: RegressionConfidencePoint[] | null;
};

const DEFAULT_BIN_SIZE = 2;
const DEFAULT_MIN_MULTIPLIER = 0.5;
const DEFAULT_MAX_MULTIPLIER = 2;
const DEFAULT_NORMALIZED_BIN_SIZE = 0.5;
const DEFAULT_HYPOTHESIS_FORM: HypothesisConfig = { field: 'worker', operator: '==', value: '' };
const APP_TIMEZONE_OFFSET_MINUTES = -3 * 60;
const SERVER_TIMESTAMP_WITH_TZ_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i;
const SERVER_NAIVE_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?)?$/;

const HYPOTHESIS_FIELD_OPTIONS: HypothesisFieldOption[] = [
  {
    value: 'worker',
    label: 'Trabajador',
    operators: [{ value: '==', label: '=' }],
  },
  {
    value: 'date',
    label: 'Fecha',
    operators: [
      { value: '==', label: '=' },
      { value: '!=', label: '!=' },
      { value: '>', label: '>' },
      { value: '>=', label: '>=' },
      { value: '<', label: '<' },
      { value: '<=', label: '<=' },
    ],
  },
];

const getHypothesisFieldConfig = (field: HypothesisField) =>
  HYPOTHESIS_FIELD_OPTIONS.find((item) => item.value === field) || HYPOTHESIS_FIELD_OPTIONS[0];

const parseIsoDateParts = (value: string): { year: number; monthIndex: number; day: number } | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) return null;
  return { year, monthIndex, day };
};

const buildUtcMillisFromAppLocal = (
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
) =>
  Date.UTC(year, monthIndex, day, hour, minute, second, millisecond)
  - (APP_TIMEZONE_OFFSET_MINUTES * 60 * 1000);

const getAppLocalDatePartsFromUtcMillis = (utcMillis: number) => {
  const localDate = new Date(utcMillis + (APP_TIMEZONE_OFFSET_MINUTES * 60 * 1000));
  return {
    year: localDate.getUTCFullYear(),
    monthIndex: localDate.getUTCMonth(),
    day: localDate.getUTCDate(),
  };
};

const normalizeServerTimestamp = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
};

const parseServerTimestamp = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const normalized = normalizeServerTimestamp(value);
  if (!normalized) return null;
  if (SERVER_TIMESTAMP_WITH_TZ_PATTERN.test(normalized)) {
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const naiveMatch = normalized.match(SERVER_NAIVE_TIMESTAMP_PATTERN);
  if (!naiveMatch) {
    const fallbackParsed = Date.parse(normalized);
    return Number.isNaN(fallbackParsed) ? null : fallbackParsed;
  }
  const year = Number(naiveMatch[1]);
  const month = Number(naiveMatch[2]);
  const day = Number(naiveMatch[3]);
  const hour = Number(naiveMatch[4] ?? '0');
  const minute = Number(naiveMatch[5] ?? '0');
  const second = Number(naiveMatch[6] ?? '0');
  const fractionRaw = naiveMatch[7] ?? '';
  const millisecond = fractionRaw ? Number(fractionRaw.slice(0, 3).padEnd(3, '0')) : 0;
  const utcMillis = buildUtcMillisFromAppLocal(year, month - 1, day, hour, minute, second, millisecond);
  return Number.isNaN(utcMillis) ? null : utcMillis;
};

const toApiDateBoundary = (isoDate: string, boundary: 'start' | 'end'): string | null => {
  const parsed = parseIsoDateParts(isoDate);
  if (!parsed) return null;
  const { year, monthIndex, day } = parsed;
  const month = String(monthIndex + 1).padStart(2, '0');
  const dayLabel = String(day).padStart(2, '0');
  const time = boundary === 'start' ? '00:00:00' : '23:59:59';
  return `${String(year).padStart(4, '0')}-${month}-${dayLabel} ${time}`;
};

const formatUtcMillisInAppTimezone = (utcMillis: number): string => {
  const localDate = new Date(utcMillis + (APP_TIMEZONE_OFFSET_MINUTES * 60 * 1000));
  const day = String(localDate.getUTCDate()).padStart(2, '0');
  const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const year = String(localDate.getUTCFullYear()).padStart(4, '0');
  const hours = String(localDate.getUTCHours()).padStart(2, '0');
  const minutes = String(localDate.getUTCMinutes()).padStart(2, '0');
  const seconds = String(localDate.getUTCSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
};

const formatDateTimeInAppTimezone = (value: unknown): string => {
  if (typeof value !== 'string') return formatDateTime(value);
  const utcMillis = parseServerTimestamp(value);
  if (utcMillis == null) return formatDateTime(value);
  return formatUtcMillisInAppTimezone(utcMillis);
};

const parseTaskIds = (raw: unknown): number[] | null => {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return raw.map((val) => Number(val)).filter((val) => Number.isFinite(val));
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((val) => Number(val)).filter((val) => Number.isFinite(val));
      }
    } catch {
      return raw
        .split(',')
        .map((val) => Number(val))
        .filter((val) => Number.isFinite(val));
    }
  }
  return null;
};

const isDefaultTaskApplicabilityScope = (row: TaskApplicabilityRule): boolean =>
  row.house_type_id == null
  && row.sub_type_id == null
  && row.module_number == null
  && row.panel_definition_id == null;

const matchesTaskApplicability = (
  row: TaskApplicabilityRule,
  houseTypeId: number,
  subTypeId: number | null,
  moduleNumber: number,
  panelDefinitionId: number | null,
): boolean => {
  if (row.panel_definition_id != null && row.panel_definition_id !== panelDefinitionId) return false;
  if (row.house_type_id != null && row.house_type_id !== houseTypeId) return false;
  if (row.sub_type_id != null && row.sub_type_id !== subTypeId) return false;
  if (row.module_number != null && row.module_number !== moduleNumber) return false;
  return true;
};

const taskApplicabilityRank = (row: TaskApplicabilityRule): [number, number, number] => {
  let level = 4;
  if (row.panel_definition_id != null) {
    level = 0;
  } else if (row.house_type_id != null && row.module_number != null) {
    level = 1;
  } else if (row.house_type_id != null) {
    level = 2;
  }
  const subTypeRank = row.sub_type_id != null ? 0 : 1;
  return [level, subTypeRank, Number(row.id) || 0];
};

const compareTaskApplicabilityRank = (a: TaskApplicabilityRule, b: TaskApplicabilityRule): number => {
  const [aLevel, aSubtype, aId] = taskApplicabilityRank(a);
  const [bLevel, bSubtype, bId] = taskApplicabilityRank(b);
  if (aLevel !== bLevel) return aLevel - bLevel;
  if (aSubtype !== bSubtype) return aSubtype - bSubtype;
  return aId - bId;
};

const resolveTaskApplicability = (
  rows: TaskApplicabilityRule[],
  houseTypeId: number,
  subTypeId: number | null,
  moduleNumber: number,
  panelDefinitionId: number | null,
): TaskApplicabilityRule | null => {
  const matches = rows
    .filter((row) => !isDefaultTaskApplicabilityScope(row))
    .filter((row) => matchesTaskApplicability(row, houseTypeId, subTypeId, moduleNumber, panelDefinitionId));
  if (!matches.length) return null;
  return matches.sort(compareTaskApplicabilityRank)[0] ?? null;
};

const formatRatio = (ratio: number | null | undefined): string => {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '-';
  return `${ratio.toFixed(2)}x`;
};

const parseOptionalNumberInput = (rawValue: string): number | null => {
  if (!rawValue) return null;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
};

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const resolveMultiplierBounds = (minMultiplier: number, maxMultiplier: number): { lower: number; upper: number } => {
  const rawLower = Math.min(minMultiplier, maxMultiplier);
  const rawUpper = Math.max(minMultiplier, maxMultiplier);
  const lower = Number.isFinite(rawLower) && rawLower > 0 ? rawLower : DEFAULT_MIN_MULTIPLIER;
  const upperCandidate = Number.isFinite(rawUpper) && rawUpper > lower
    ? rawUpper
    : Math.max(lower * 2, 1);
  return { lower, upper: upperCandidate };
};

const ratioToBackgroundColor = (
  ratio: number | null | undefined,
  minMultiplier: number,
  maxMultiplier: number,
): string | null => {
  const value = Number(ratio);
  if (!Number.isFinite(value) || value <= 0) return null;
  const { lower, upper } = resolveMultiplierBounds(minMultiplier, maxMultiplier);
  if (value >= 1) {
    const span = Math.max(upper - 1, 0.01);
    const t = clampNumber((value - 1) / span, 0, 1);
    const alpha = 0.06 + 0.28 * t;
    return `rgba(220, 53, 69, ${alpha})`;
  }
  const span = Math.max(1 - lower, 0.01);
  const t = clampNumber((1 - value) / span, 0, 1);
  const alpha = 0.06 + 0.22 * t;
  return `rgba(40, 167, 69, ${alpha})`;
};

const getRatioBackgroundStyle = (
  ratio: number | null | undefined,
  minMultiplier: number,
  maxMultiplier: number,
): React.CSSProperties | undefined => {
  const color = ratioToBackgroundColor(ratio, minMultiplier, maxMultiplier);
  return color ? { backgroundColor: color } : undefined;
};

const formatSignedNumber = (value: number | null | undefined, digits = 2): string => {
  if (value == null || !Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
};

const getTrendStrengthLabel = (score: number | null | undefined): string => {
  if (score == null || !Number.isFinite(score)) return 'Sin senal';
  const magnitude = Math.abs(score);
  if (magnitude < 1.5) return 'Incierto';
  if (magnitude < 2.5) return 'Debil';
  if (magnitude < 4) return 'Moderado';
  return 'Fuerte';
};

const getTrendScoreStyle = (score: number | null | undefined): React.CSSProperties => {
  if (score == null || !Number.isFinite(score)) return { color: 'var(--ink-muted)' };
  const magnitude = clampNumber(Math.abs(score), 0, 4);
  if (magnitude < 0.2) return { color: 'var(--ink-muted)' };
  const intensity = magnitude / 4;
  const hue = score < 0 ? 120 : 0;
  const lightness = 44 - intensity * 12;
  return { color: `hsl(${hue} 70% ${lightness.toFixed(1)}%)` };
};

const getDefaultBinSizeFromExpected = (expectedReferenceMinutes: number | null | undefined): string => {
  const expected = Number(expectedReferenceMinutes);
  if (!Number.isFinite(expected) || expected <= 0) {
    return String(DEFAULT_BIN_SIZE);
  }
  return String(Math.max(1, Math.round(expected * 0.1)));
};

const formatMinutesPerUnit = (value: number | null | undefined, unit: string) => {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value.toFixed(3)} ${unit}`;
};

const formatMeasure = (value: number | null | undefined, unit: string, digits = 2) => {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value.toFixed(digits)} ${unit}`;
};

const formatRegressionIndicator = (value: number | null | undefined, digits = 3) => {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toFixed(digits);
};

const normalizeDateToComparable = (value: string | null | undefined): number | null => {
  return parseServerTimestamp(value);
};

const normalizePauseMinutes = (pause: {
  duration_minutes?: number | null;
  duration_seconds?: number | null;
} | null | undefined): number | null => {
  if (!pause) return null;
  const minutes = Number(pause.duration_minutes);
  if (Number.isFinite(minutes) && minutes >= 0) return minutes;
  const seconds = Number(pause.duration_seconds);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds / 60;
  return null;
};

const roundToTwo = (value: number): number => Number(value.toFixed(2));

const mergeIntervalsMs = (intervals: Array<{ start: number; end: number }>) => {
  if (!intervals.length) return [] as Array<{ start: number; end: number }>;
  const ordered = [...intervals]
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start);
  if (!ordered.length) return [] as Array<{ start: number; end: number }>;
  const merged: Array<{ start: number; end: number }> = [ordered[0]];
  ordered.slice(1).forEach((item) => {
    const last = merged[merged.length - 1];
    if (item.start <= last.end) {
      last.end = Math.max(last.end, item.end);
    } else {
      merged.push({ ...item });
    }
  });
  return merged;
};

const subtractIntervalsMs = (
  base: Array<{ start: number; end: number }>,
  covered: Array<{ start: number; end: number }>,
) => {
  const baseMerged = mergeIntervalsMs(base);
  const coveredMerged = mergeIntervalsMs(covered);
  if (!baseMerged.length) return [] as Array<{ start: number; end: number }>;
  if (!coveredMerged.length) return baseMerged;

  const result: Array<{ start: number; end: number }> = [];
  baseMerged.forEach((baseItem) => {
    let cursor = baseItem.start;
    coveredMerged.forEach((coveredItem) => {
      if (coveredItem.end <= cursor) return;
      if (coveredItem.start >= baseItem.end) return;
      const overlapStart = Math.max(cursor, coveredItem.start);
      const overlapEnd = Math.min(baseItem.end, coveredItem.end);
      if (overlapStart > cursor) {
        result.push({ start: cursor, end: overlapStart });
      }
      if (overlapEnd > cursor) {
        cursor = overlapEnd;
      }
    });
    if (cursor < baseItem.end) {
      result.push({ start: cursor, end: baseItem.end });
    }
  });
  return result;
};

const normalizeTimelineSegmentKind = (value: string | null | undefined): TimelineSegmentKind => {
  if (value === 'paused') return 'paused';
  if (value === 'masked_active') return 'masked_active';
  if (value === 'masked_paused') return 'masked_paused';
  return 'active';
};

const buildTaskFallbackTimelineSegments = (task: TaskBreakdownRow): DurationTimelineSegment[] => {
  const startMs = parseServerTimestamp(task.started_at ?? null);
  const endMs = parseServerTimestamp(task.completed_at ?? null);
  if (startMs == null || endMs == null || endMs <= startMs) return [];

  const rawPauseIntervals = (Array.isArray(task.pauses) ? task.pauses : [])
    .map((pause) => ({
      start: parseServerTimestamp(pause.paused_at ?? null),
      end: parseServerTimestamp(pause.resumed_at ?? null),
    }))
    .filter((item) => item.start != null && item.end != null)
    .map((item) => ({
      start: Math.max(item.start as number, startMs),
      end: Math.min(item.end as number, endMs),
    }))
    .filter((item) => item.end > item.start);
  const pauseIntervals = mergeIntervalsMs(rawPauseIntervals);
  const activeIntervals = subtractIntervalsMs([{ start: startMs, end: endMs }], pauseIntervals);

  const payload: DurationTimelineSegment[] = [];
  activeIntervals.forEach((item) => {
    payload.push({
      kind: 'active',
      started_ms: item.start,
      ended_ms: item.end,
      duration_minutes: roundToTwo((item.end - item.start) / 60000),
    });
  });
  pauseIntervals.forEach((item) => {
    payload.push({
      kind: 'paused',
      started_ms: item.start,
      ended_ms: item.end,
      duration_minutes: roundToTwo((item.end - item.start) / 60000),
    });
  });
  payload.sort((a, b) => a.started_ms - b.started_ms);
  return payload;
};

const parseTaskTimelineSegments = (task: TaskBreakdownRow): DurationTimelineSegment[] => {
  const rawSegments = Array.isArray(task.timeline_segments) ? task.timeline_segments : [];
  if (rawSegments.length) {
    const payload: DurationTimelineSegment[] = rawSegments
      .map((segment) => {
        const startedMs = parseServerTimestamp(segment.started_at ?? null);
        const endedMs = parseServerTimestamp(segment.ended_at ?? null);
        if (startedMs == null || endedMs == null || endedMs <= startedMs) return null;
        const rawMinutes = Number(segment.duration_minutes);
        const durationMinutes = Number.isFinite(rawMinutes) && rawMinutes >= 0
          ? rawMinutes
          : roundToTwo((endedMs - startedMs) / 60000);
        return {
          kind: normalizeTimelineSegmentKind(segment.segment_type),
          started_ms: startedMs,
          ended_ms: endedMs,
          duration_minutes: durationMinutes,
        };
      })
      .filter(Boolean) as DurationTimelineSegment[];
    if (payload.length) {
      payload.sort((a, b) => a.started_ms - b.started_ms);
      return payload;
    }
  }
  return buildTaskFallbackTimelineSegments(task);
};

const buildDurationTimelinePreview = (
  row: AnalysisPoint,
  anchorX: number,
  anchorY: number,
): DurationTimelinePreview | null => {
  const estimated = Number(row.duration_minutes);
  const estimatedMinutes = Number.isFinite(estimated) && estimated >= 0 ? estimated : 0;
  const taskRows = Array.isArray(row.task_breakdown) ? row.task_breakdown : [];

  const laneMap = new Map<string, DurationTimelineSegment[]>();
  let rawSum = 0;
  let rawCount = 0;
  let maskedOutSum = 0;
  let maskedOutCount = 0;
  let pauseSum = 0;
  let pauseCount = 0;

  taskRows.forEach((task, index) => {
    const label = typeof task.task_name === 'string' && task.task_name.trim()
      ? task.task_name.trim()
      : task.task_definition_id != null
        ? `Tarea ${task.task_definition_id}`
        : `Tarea ${index + 1}`;
    const segments = parseTaskTimelineSegments(task);
    if (segments.length) {
      laneMap.set(label, segments);
    }
    const rawDuration = Number(task.raw_duration_minutes);
    if (Number.isFinite(rawDuration) && rawDuration >= 0) {
      rawSum += rawDuration;
      rawCount += 1;
    }
    const maskedOut = Number(task.masked_out_minutes);
    if (Number.isFinite(maskedOut) && maskedOut >= 0) {
      maskedOutSum += maskedOut;
      maskedOutCount += 1;
    }
    const pauseMinutes = Number(task.pause_minutes);
    if (Number.isFinite(pauseMinutes) && pauseMinutes >= 0) {
      pauseSum += pauseMinutes;
      pauseCount += 1;
    }
  });

  if (!laneMap.size) {
    const completedMs = parseServerTimestamp(row.completed_at ?? null);
    if (completedMs != null && estimatedMinutes > 0) {
      laneMap.set(
        row.task_name || 'Muestra',
        [
          {
            kind: 'active',
            started_ms: completedMs - (estimatedMinutes * 60000),
            ended_ms: completedMs,
            duration_minutes: roundToTwo(estimatedMinutes),
          },
        ],
      );
    }
  }

  const lanes = Array.from(laneMap.entries())
    .map(([label, segments]) => ({
      label,
      segments: [...segments].sort((a, b) => a.started_ms - b.started_ms),
    }))
    .filter((lane) => lane.segments.length);
  if (!lanes.length) return null;

  const flattened = lanes.flatMap((lane) => lane.segments);
  const startedMs = Math.min(...flattened.map((segment) => segment.started_ms));
  const endedMs = Math.max(...flattened.map((segment) => segment.ended_ms));
  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs <= startedMs) {
    return null;
  }

  const fallbackPauseFromSegments = roundToTwo(
    flattened
      .filter((segment) => segment.kind === 'paused' || segment.kind === 'masked_paused')
      .reduce((sum, segment) => sum + segment.duration_minutes, 0),
  );
  const rawMinutes = rawCount ? roundToTwo(rawSum) : null;
  const maskedOutMinutes = maskedOutCount
    ? roundToTwo(maskedOutSum)
    : rawMinutes != null
      ? roundToTwo(Math.max(rawMinutes - estimatedMinutes, 0))
      : 0;
  const pauseMinutes = pauseCount ? roundToTwo(pauseSum) : fallbackPauseFromSegments;
  const moduleLabel = row.module_number != null ? ` / Modulo ${row.module_number}` : '';
  const title = `${row.house_identifier || 'Muestra'}${moduleLabel}`;
  const key = `${row.plan_id ?? 'na'}-${row.task_definition_id ?? 'all'}-${row.completed_at ?? 'na'}`;

  return {
    key,
    title,
    started_ms: startedMs,
    ended_ms: endedMs,
    estimated_minutes: roundToTwo(estimatedMinutes),
    raw_minutes: rawMinutes,
    masked_out_minutes: maskedOutMinutes,
    pause_minutes: pauseMinutes,
    lanes,
    anchor_x: anchorX,
    anchor_y: anchorY,
  };
};

const TIMELINE_SEGMENT_META: Record<TimelineSegmentKind, { label: string; color: string }> = {
  active: { label: 'Activo contabilizado', color: '#16a34a' },
  paused: { label: 'Pausa contabilizada', color: '#f59e0b' },
  masked_active: { label: 'Activo fuera de turno', color: '#ef4444' },
  masked_paused: { label: 'Pausa fuear de turno', color: '#b45309' },
};

const computeDurationTimelineModalStyle = (
  preview: DurationTimelinePreview,
): React.CSSProperties => {
  const margin = 16;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
  const width = Math.min(560, Math.max(320, viewportWidth - (margin * 2)));
  const left = clampNumber(
    preview.anchor_x - (width / 2),
    margin,
    Math.max(margin, viewportWidth - width - margin),
  );
  const estimatedHeight = Math.min(Math.max(250, 180 + (preview.lanes.length * 58)), 580);
  let top = preview.anchor_y;
  if ((top + estimatedHeight) > (viewportHeight - margin)) {
    top = Math.max(margin, preview.anchor_y - estimatedHeight - 24);
  }
  return { left, top, width };
};

const buildPanelLabel = (panel: PanelDefinition | null): string => {
  if (!panel) return '-';
  const module = panel.module_sequence_number ? `Modulo ${panel.module_sequence_number}` : 'Modulo';
  const group = panel.group || 'Grupo';
  return `${module} - ${group} - ${panel.panel_code || panel.id}`;
};

const normalizePanelGroup = (value: string | null | undefined): string => {
  if (typeof value !== 'string') return 'Sin grupo';
  const trimmed = value.trim();
  return trimmed || 'Sin grupo';
};

const normalizeStationName = (station: Station): string => {
  const trimmed = station.name.trim();
  if (!station.line_type) {
    return trimmed;
  }
  const pattern = new RegExp(`^(Linea|Line)\\s*${station.line_type}\\s*-\\s*`, 'i');
  const normalized = trimmed.replace(pattern, '').trim();
  return normalized || trimmed;
};

const normalizeText = (value: string) => value.trim().toLowerCase();

const collectPointWorkers = (point: AnalysisPoint): string[] => {
  const names: string[] = [];
  if (typeof point?.worker_name === 'string' && point.worker_name.trim()) {
    point.worker_name
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .forEach((name) => names.push(normalizeText(name)));
  }
  if (Array.isArray(point?.task_breakdown)) {
    point.task_breakdown
      .map((task) => (typeof task?.worker_name === 'string' ? task.worker_name.trim() : ''))
      .filter(Boolean)
      .forEach((name) => names.push(normalizeText(name)));
  }
  return Array.from(new Set(names)).filter(Boolean);
};

const buildLocalDayRange = (year: number, monthIndex: number, day: number) => {
  const startOfDay = buildUtcMillisFromAppLocal(year, monthIndex, day, 0, 0, 0, 0);
  const endOfDay = buildUtcMillisFromAppLocal(year, monthIndex, day, 23, 59, 59, 999);
  if (Number.isNaN(startOfDay) || Number.isNaN(endOfDay)) return null;
  const roundTrip = getAppLocalDatePartsFromUtcMillis(startOfDay);
  if (roundTrip.year !== year || roundTrip.monthIndex !== monthIndex || roundTrip.day !== day) {
    return null;
  }
  const isoDate = `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { isoDate, startOfDay, endOfDay };
};

const parseDateOperand = (rawValue: string): { isoDate: string; startOfDay: number; endOfDay: number } | null => {
  if (!rawValue) return null;
  const isoDateParts = parseIsoDateParts(rawValue);
  if (isoDateParts) {
    const { year, monthIndex, day } = isoDateParts;
    return buildLocalDayRange(year, monthIndex, day);
  }
  const parsed = parseServerTimestamp(rawValue);
  if (parsed == null) return null;
  const appLocalDate = getAppLocalDatePartsFromUtcMillis(parsed);
  return buildLocalDayRange(appLocalDate.year, appLocalDate.monthIndex, appLocalDate.day);
};

const buildHypothesisFromConfig = (config: HypothesisConfig | null) => {
  if (!config) {
    return { predicate: null, error: '', description: '' };
  }
  const { field, operator, value } = config;
  if (field === 'worker') {
    if (operator !== '==') {
      return {
        predicate: null,
        error: 'Para trabajador solo se permite el operador =.',
        description: '',
      };
    }
    if (!value) {
      return {
        predicate: null,
        error: 'Debe seleccionar un trabajador.',
        description: '',
      };
    }
    const target = normalizeText(value);
    const predicate = (point: AnalysisPoint) => {
      const participants = collectPointWorkers(point);
      if (!participants.length) return false;
      return participants.some((name) => name.includes(target));
    };
    return { predicate, error: '', description: `Trabajador = ${value}` };
  }
  if (field === 'date') {
    if (!['==', '!=', '>', '>=', '<', '<='].includes(operator)) {
      return { predicate: null, error: 'Operador no soportado para fecha.', description: '' };
    }
    if (!value) {
      return { predicate: null, error: 'Debe seleccionar una fecha.', description: '' };
    }
    const operand = parseDateOperand(value);
    if (!operand) {
      return { predicate: null, error: 'No se pudo interpretar la fecha seleccionada.', description: '' };
    }
    const predicate = (point: AnalysisPoint) => {
      if (!point?.completed_at) return false;
      const pointTimestamp = parseServerTimestamp(point.completed_at);
      if (pointTimestamp == null) return false;
      switch (operator) {
        case '==':
          return pointTimestamp >= operand.startOfDay && pointTimestamp <= operand.endOfDay;
        case '!=':
          return pointTimestamp < operand.startOfDay || pointTimestamp > operand.endOfDay;
        case '>':
          return pointTimestamp > operand.endOfDay;
        case '>=':
          return pointTimestamp >= operand.startOfDay;
        case '<':
          return pointTimestamp < operand.startOfDay;
        case '<=':
          return pointTimestamp <= operand.endOfDay;
        default:
          return false;
      }
    };
    const operatorLabel = operator === '==' ? '=' : operator;
    return { predicate, error: '', description: `Fecha ${operatorLabel} ${operand.isoDate}` };
  }
  return {
    predicate: null,
    error: 'Campo de hipotesis no soportado.',
    description: '',
  };
};

const buildHistogramData = (
  points: AnalysisPoint[],
  rawBinSize: number,
  predicate?: ((point: AnalysisPoint) => boolean) | null,
): HistogramSummary => {
  const step = Number(rawBinSize) > 0 ? Number(rawBinSize) : DEFAULT_BIN_SIZE;
  if (!points.length) {
    return { bins: [], maxCount: 0, binSize: step, maxDuration: 0, totalMatches: 0 };
  }
  const maxDuration = Math.max(...points.map((p) => p.duration_minutes || 0));
  if (!(maxDuration > 0)) {
    return { bins: [], maxCount: 0, binSize: step, maxDuration: 0, totalMatches: 0 };
  }
  const binCount = Math.max(1, Math.ceil(maxDuration / step));
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, index) => ({
    index,
    from: index * step,
    to: (index + 1) * step,
    count: 0,
    items: [],
    matchCount: 0,
  }));
  points.forEach((point) => {
    const value = point.duration_minutes || 0;
    const idx = Math.min(Math.floor(value / step), binCount - 1);
    bins[idx].count += 1;
    bins[idx].items.push(point);
    if (typeof predicate === 'function' && predicate(point)) {
      bins[idx].matchCount += 1;
    }
  });
  const maxCount = Math.max(...bins.map((bin) => bin.count));
  const totalMatches = typeof predicate === 'function'
    ? bins.reduce((sum, bin) => sum + bin.matchCount, 0)
    : 0;
  return { bins, maxCount, binSize: step, maxDuration: binCount * step, totalMatches };
};

const buildNormalizedHistogramData = (
  rows: NormalizedCompletionRow[],
  rawBinSize: number,
): NormalizedHistogramSummary => {
  const step = Number(rawBinSize) > 0 ? Number(rawBinSize) : DEFAULT_NORMALIZED_BIN_SIZE;
  if (!rows.length) {
    return { bins: [], maxCount: 0, binSize: step, maxValue: 0 };
  }
  const values = rows
    .map((row) => row.normalized_minutes)
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (!values.length) {
    return { bins: [], maxCount: 0, binSize: step, maxValue: 0 };
  }
  const maxValue = Math.max(...values);
  if (!(maxValue > 0)) {
    return { bins: [], maxCount: 0, binSize: step, maxValue: 0 };
  }
  const binCount = Math.max(1, Math.ceil(maxValue / step));
  const bins: NormalizedHistogramBin[] = Array.from({ length: binCount }, (_, index) => ({
    index,
    from: index * step,
    to: (index + 1) * step,
    count: 0,
    items: [],
  }));
  rows.forEach((row) => {
    const value = row.normalized_minutes;
    if (!Number.isFinite(value) || value < 0) return;
    const idx = Math.min(Math.floor(value / step), binCount - 1);
    bins[idx].count += 1;
    bins[idx].items.push(row);
  });
  const maxCount = Math.max(...bins.map((bin) => bin.count));
  return { bins, maxCount, binSize: step, maxValue: binCount * step };
};

const getTwoTailedCritical95 = (degreesOfFreedom: number): number => {
  if (degreesOfFreedom <= 0) return 1.96;
  const lookup = [
    0,
    12.706,
    4.303,
    3.182,
    2.776,
    2.571,
    2.447,
    2.365,
    2.306,
    2.262,
    2.228,
    2.201,
    2.179,
    2.160,
    2.145,
    2.131,
    2.120,
    2.110,
    2.101,
    2.093,
    2.086,
    2.080,
    2.074,
    2.069,
    2.064,
    2.060,
    2.056,
    2.052,
    2.048,
    2.045,
    2.042,
  ];
  if (degreesOfFreedom < lookup.length) return lookup[degreesOfFreedom];
  if (degreesOfFreedom <= 60) return 2;
  if (degreesOfFreedom <= 120) return 1.98;
  return 1.96;
};

const calculateLinearRegression = (samples: RegressionSample[]): LinearRegressionResult | null => {
  const regressionSamples = samples.filter((sample) =>
    Number.isFinite(sample.x) && Number.isFinite(sample.y) && sample.x > 0 && sample.y > 0
  );
  if (regressionSamples.length < 2) {
    return null;
  }

  const sampleCount = regressionSamples.length;
  const sumX = regressionSamples.reduce((sum, item) => sum + item.x, 0);
  const sumY = regressionSamples.reduce((sum, item) => sum + item.y, 0);
  const meanX = sumX / sampleCount;
  const meanY = sumY / sampleCount;

  let sumSquaredXDeviation = 0;
  let sumCrossDeviation = 0;
  let totalYDeviationSquared = 0;

  regressionSamples.forEach((item) => {
    const xDeviation = item.x - meanX;
    const yDeviation = item.y - meanY;
    sumSquaredXDeviation += xDeviation * xDeviation;
    sumCrossDeviation += xDeviation * yDeviation;
    totalYDeviationSquared += yDeviation * yDeviation;
  });

  if (!(sumSquaredXDeviation > 0)) {
    return null;
  }

  const slope = sumCrossDeviation / sumSquaredXDeviation;
  const intercept = meanY - slope * meanX;

  let sumSquaredError = 0;
  let sumAbsoluteError = 0;
  regressionSamples.forEach((item) => {
    const predictedY = intercept + slope * item.x;
    const residual = item.y - predictedY;
    sumSquaredError += residual * residual;
    sumAbsoluteError += Math.abs(residual);
  });

  const rmse = Math.sqrt(sumSquaredError / sampleCount);
  const mae = sumAbsoluteError / sampleCount;

  const correlation = totalYDeviationSquared > 0
    ? sumCrossDeviation / Math.sqrt(sumSquaredXDeviation * totalYDeviationSquared)
    : null;
  const rSquared = totalYDeviationSquared > 0
    ? 1 - sumSquaredError / totalYDeviationSquared
    : null;
  const adjustedRSquared = rSquared != null && sampleCount > 2
    ? 1 - (1 - rSquared) * ((sampleCount - 1) / (sampleCount - 2))
    : null;

  const minX = Math.min(...regressionSamples.map((item) => item.x));
  const maxX = Math.max(...regressionSamples.map((item) => item.x));
  const startPredictedY = intercept + slope * minX;
  const endPredictedY = intercept + slope * maxX;

  let confidenceBand: RegressionConfidencePoint[] | null = null;
  if (sampleCount > 2) {
    const residualStdError = Math.sqrt(sumSquaredError / (sampleCount - 2));
    const tCritical = getTwoTailedCritical95(sampleCount - 2);
    if (Number.isFinite(residualStdError) && Number.isFinite(tCritical)) {
      const pointsCount = Math.max(24, Math.min(60, sampleCount * 2));
      confidenceBand = Array.from({ length: pointsCount }, (_, index) => {
        const ratio = pointsCount > 1 ? index / (pointsCount - 1) : 0;
        const x = minX + (maxX - minX) * ratio;
        const predictedY = intercept + slope * x;
        const standardErrorMean =
          residualStdError * Math.sqrt((1 / sampleCount) + ((x - meanX) ** 2) / sumSquaredXDeviation);
        const margin = tCritical * standardErrorMean;
        return {
          x,
          predictedY,
          lowerY: predictedY - margin,
          upperY: predictedY + margin,
        };
      });
    }
  }

  return {
    sampleCount,
    slope,
    intercept,
    correlation,
    rSquared,
    adjustedRSquared,
    rmse,
    mae,
    meanX,
    meanY,
    minX,
    maxX,
    startPredictedY,
    endPredictedY,
    confidenceBand,
  };
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

const DashboardTasks: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [houseTypes, setHouseTypes] = useState<HouseType[]>([]);
  const [panelDefinitions, setPanelDefinitions] = useState<PanelDefinition[]>([]);
  const [taskDefinitions, setTaskDefinitions] = useState<TaskDefinition[]>([]);
  const [taskApplicabilityRules, setTaskApplicabilityRules] = useState<TaskApplicabilityRule[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [stations, setStations] = useState<Station[]>([]);

  const [selectedHouseTypeId, setSelectedHouseTypeId] = useState('');
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>('panel');
  const [selectedPanelId, setSelectedPanelId] = useState('');
  const [selectedModuleNumber, setSelectedModuleNumber] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedStationId, setSelectedStationId] = useState('');
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [workersForSelection, setWorkersForSelection] = useState<TaskAnalysisWorkerOption[]>([]);
  const [workersForSelectionLoading, setWorkersForSelectionLoading] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [hypothesisForm, setHypothesisForm] = useState<HypothesisConfig>({ ...DEFAULT_HYPOTHESIS_FORM });
  const [activeHypothesisConfig, setActiveHypothesisConfig] = useState<HypothesisConfig | null>(null);
  const [hypothesisEditorOpen, setHypothesisEditorOpen] = useState(false);
  const [hypothesisError, setHypothesisError] = useState('');

  const [binSize, setBinSize] = useState(String(DEFAULT_BIN_SIZE));
  const [minMultiplier, setMinMultiplier] = useState(String(DEFAULT_MIN_MULTIPLIER));
  const [maxMultiplier, setMaxMultiplier] = useState(String(DEFAULT_MAX_MULTIPLIER));
  const [includeWithoutExpected, setIncludeWithoutExpected] = useState(true);
  const [includeCrossStationExecutions, setIncludeCrossStationExecutions] = useState(false);

  const [activeTab, setActiveTab] = useState<'panel' | 'task-summary' | 'normalized'>('panel');
  const [normalizedStationId, setNormalizedStationId] = useState('');
  const [normalizedMetric, setNormalizedMetric] = useState<NormalizedMetric>('linear');
  const [normalizedHouseTypeIds, setNormalizedHouseTypeIds] = useState<number[]>([]);
  const [normalizedPanelGroups, setNormalizedPanelGroups] = useState<string[]>([]);
  const [normalizedFromDate, setNormalizedFromDate] = useState('');
  const [normalizedToDate, setNormalizedToDate] = useState('');
  const [normalizedMinMinutes, setNormalizedMinMinutes] = useState('');
  const [normalizedMaxMinutes, setNormalizedMaxMinutes] = useState('');
  const [normalizedBinSize, setNormalizedBinSize] = useState(String(DEFAULT_NORMALIZED_BIN_SIZE));
  const [normalizedView, setNormalizedView] = useState<'histogram' | 'scatter'>('histogram');
  const [normalizedScatterDisplay, setNormalizedScatterDisplay] = useState<'all' | 'averages'>('all');
  const [showNormalizedRegression, setShowNormalizedRegression] = useState(false);
  const [normalizedData, setNormalizedData] = useState<StationPanelsFinishedResponse | null>(null);
  const [normalizedLoading, setNormalizedLoading] = useState(false);
  const [normalizedError, setNormalizedError] = useState('');
  const [houseTypeDropdownOpen, setHouseTypeDropdownOpen] = useState(false);
  const [panelTypeDropdownOpen, setPanelTypeDropdownOpen] = useState(false);
  const houseTypeDropdownRef = useRef<HTMLDivElement | null>(null);
  const panelTypeDropdownRef = useRef<HTMLDivElement | null>(null);

  const [analysisData, setAnalysisData] = useState<TaskAnalysisResponse | null>(null);
  const [showHistogramMethodologyModal, setShowHistogramMethodologyModal] = useState(false);
  const [durationTimelinePreview, setDurationTimelinePreview] = useState<DurationTimelinePreview | null>(null);
  const durationTimelineHideTimeoutRef = useRef<number | null>(null);
  const [dataTableSort, setDataTableSort] = useState<{ key: DataTableSortKey; direction: DataTableSortDirection }>({
    key: 'duration',
    direction: 'desc',
  });
  const [taskSummarySort, setTaskSummarySort] = useState<{
    key: TaskSummarySortKey;
    direction: DataTableSortDirection;
  }>({
    key: 'avgDuration',
    direction: 'desc',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [panelsError, setPanelsError] = useState('');
  const [panelsLoading, setPanelsLoading] = useState(true);
  const [stationsError, setStationsError] = useState('');
  const [stationsLoading, setStationsLoading] = useState(true);
  const lastAppliedBinSizeViewKeyRef = useRef('');

  useEffect(() => {
    setHeader({
      title: 'Analisis de tiempos de tareas',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  useEffect(() => () => {
    if (durationTimelineHideTimeoutRef.current != null) {
      window.clearTimeout(durationTimelineHideTimeoutRef.current);
      durationTimelineHideTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<HouseType[]>('/api/house-types')
      .then((data) => {
        if (!active) return;
        setHouseTypes(Array.isArray(data) ? data : []);
      })
      .catch((err: Error) => {
        if (!active) return;
        setHouseTypes([]);
        setError(err.message || 'Error cargando tipos de casa');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadPanels = async () => {
      try {
        const data = await apiRequest<PanelDefinition[]>('/api/panel-definitions');
        if (!active) return;
        setPanelDefinitions(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Error cargando paneles';
        setPanelDefinitions([]);
        setPanelsError(message);
      } finally {
        if (active) setPanelsLoading(false);
      }
    };
    void loadPanels();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<TaskDefinition[]>('/api/task-definitions')
      .then((data) => {
        if (!active) return;
        setTaskDefinitions(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!active) return;
        setTaskDefinitions([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<TaskApplicabilityRule[]>('/api/task-rules/applicability')
      .then((data) => {
        if (!active) return;
        setTaskApplicabilityRules(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!active) return;
        setTaskApplicabilityRules([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<Worker[]>('/api/workers')
      .then((data) => {
        if (!active) return;
        setWorkers(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!active) return;
        setWorkers([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadStations = async () => {
      try {
        const data = await apiRequest<Station[]>('/api/stations');
        if (!active) return;
        setStations(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Error cargando estaciones';
        setStations([]);
        setStationsError(message);
      } finally {
        if (active) setStationsLoading(false);
      }
    };
    void loadStations();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!houseTypeDropdownOpen) {
      return undefined;
    }
    const handleClick = (event: MouseEvent) => {
      if (!houseTypeDropdownRef.current) return;
      if (!houseTypeDropdownRef.current.contains(event.target as Node)) {
        setHouseTypeDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHouseTypeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [houseTypeDropdownOpen]);

  useEffect(() => {
    if (!panelTypeDropdownOpen) {
      return undefined;
    }
    const handleClick = (event: MouseEvent) => {
      if (!panelTypeDropdownRef.current) return;
      if (!panelTypeDropdownRef.current.contains(event.target as Node)) {
        setPanelTypeDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPanelTypeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [panelTypeDropdownOpen]);

  useEffect(() => {
    if (activeTab === 'normalized') return;
    setHouseTypeDropdownOpen(false);
    setPanelTypeDropdownOpen(false);
  }, [activeTab]);

  useEffect(() => {
    if (!showHistogramMethodologyModal) {
      return undefined;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowHistogramMethodologyModal(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showHistogramMethodologyModal]);

  const selectedHouseType = useMemo(
    () => houseTypes.find((item) => String(item.id) === String(selectedHouseTypeId)) || null,
    [houseTypes, selectedHouseTypeId],
  );

  const panelsForHouse = useMemo(() => {
    if (!selectedHouseType) return [] as PanelDefinition[];
    return panelDefinitions
      .filter((panel) => panel.house_type_id === selectedHouseType.id)
      .sort((a, b) => {
        const moduleDiff = (a.module_sequence_number || 0) - (b.module_sequence_number || 0);
        if (moduleDiff !== 0) return moduleDiff;
        if (a.panel_sequence_number != null && b.panel_sequence_number != null) {
          return a.panel_sequence_number - b.panel_sequence_number;
        }
        if (a.panel_sequence_number != null) return -1;
        if (b.panel_sequence_number != null) return 1;
        return (a.panel_code || '').localeCompare(b.panel_code || '');
      });
  }, [panelDefinitions, selectedHouseType]);

  const effectiveSelectedPanelId = useMemo(() => {
    if (!selectedHouseTypeId || !panelsForHouse.length) {
      return '';
    }
    const exists = panelsForHouse.some((panel) => String(panel.id) === String(selectedPanelId));
    return exists ? selectedPanelId : String(panelsForHouse[0]?.id ?? '');
  }, [panelsForHouse, selectedHouseTypeId, selectedPanelId]);

  const selectedPanel = useMemo(
    () => panelsForHouse.find((panel) => String(panel.id) === String(effectiveSelectedPanelId)) || null,
    [panelsForHouse, effectiveSelectedPanelId],
  );

  const modulesForHouse = useMemo(() => {
    if (!selectedHouseType) return [] as number[];
    return Array.from({ length: Math.max(0, selectedHouseType.number_of_modules || 0) }, (_, index) => index + 1);
  }, [selectedHouseType]);

  const effectiveSelectedModuleNumber = useMemo(() => {
    if (!selectedHouseTypeId || !modulesForHouse.length) {
      return '';
    }
    const selected = Number(selectedModuleNumber);
    if (Number.isFinite(selected) && modulesForHouse.includes(selected)) {
      return String(selected);
    }
    return String(modulesForHouse[0] ?? '');
  }, [modulesForHouse, selectedHouseTypeId, selectedModuleNumber]);

  const houseTypeNameById = useMemo(() => {
    const map = new Map<number, string>();
    houseTypes.forEach((houseType) => {
      map.set(houseType.id, houseType.name || `Tipo ${houseType.id}`);
    });
    return map;
  }, [houseTypes]);

  const panelDefinitionById = useMemo(() => {
    const map = new Map<number, PanelDefinition>();
    panelDefinitions.forEach((panel) => {
      map.set(panel.id, panel);
    });
    return map;
  }, [panelDefinitions]);

  const sequenceByStationId = useMemo(() => {
    const map = new Map<string, number>();
    stations.forEach((station) => {
      if (station && station.id != null && station.sequence_order != null) {
        map.set(String(station.id), Number(station.sequence_order));
      }
    });
    return map;
  }, [stations]);

  const stationsForScope = useMemo(() => {
    if (analysisScope === 'module') {
      return stations.filter((station) => station.line_type != null);
    }
    return stations.filter((station) =>
      station.role ? station.role === 'Panels' : station.line_type == null
    );
  }, [analysisScope, stations]);

  const moduleStationOptions = useMemo(() => {
    if (analysisScope !== 'module') return [] as { stationId: number; label: string }[];
    const entries = new Map<number, { stationId: number; names: Set<string> }>();
    stationsForScope.forEach((station) => {
      const sequence = Number(station.sequence_order);
      if (!Number.isFinite(sequence)) return;
      const normalizedName = normalizeStationName(station);
      const existing = entries.get(sequence);
      if (existing) {
        existing.names.add(normalizedName);
        if (station.id < existing.stationId) {
          existing.stationId = station.id;
        }
      } else {
        entries.set(sequence, {
          stationId: station.id,
          names: new Set<string>([normalizedName]),
        });
      }
    });
    return Array.from(entries.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([sequence, entry]) => ({
        stationId: entry.stationId,
        label: entry.names.size
          ? `Secuencia ${sequence} - ${Array.from(entry.names).join(' / ')}`
          : `Secuencia ${sequence}`,
      }));
  }, [analysisScope, stationsForScope]);

  useEffect(() => {
    if (!selectedStationId) return;
    const exists = stationsForScope.some(
      (station) => String(station.id) === String(selectedStationId),
    );
    if (exists) return;
    setSelectedStationId('');
    setSelectedTaskId('');
    setSelectedWorkerId('');
    setAnalysisData(null);
  }, [selectedStationId, stationsForScope]);

  const selectedNormalizedStation = useMemo(
    () => stations.find((station) => String(station.id) === String(normalizedStationId)) || null,
    [stations, normalizedStationId],
  );

  const normalizedDateRange = useMemo(() => {
    if (normalizedFromDate && normalizedToDate && normalizedFromDate > normalizedToDate) {
      return { from: normalizedToDate, to: normalizedFromDate };
    }
    return { from: normalizedFromDate, to: normalizedToDate };
  }, [normalizedFromDate, normalizedToDate]);

  const panelGroupOptions = useMemo(() => {
    const houseTypeSet = new Set(normalizedHouseTypeIds);
    const groupMap = new Map<string, PanelGroupOption>();
    panelDefinitions.forEach((panel) => {
      if (houseTypeSet.size && !houseTypeSet.has(panel.house_type_id)) return;
      const groupLabel = normalizePanelGroup(panel.group);
      const current = groupMap.get(groupLabel);
      if (current) {
        current.count += 1;
      } else {
        groupMap.set(groupLabel, { id: groupLabel, label: groupLabel, count: 1 });
      }
    });
    return Array.from(groupMap.values()).sort((a, b) =>
      a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }),
    );
  }, [panelDefinitions, normalizedHouseTypeIds]);

  const normalizedHouseTypeLabel = useMemo(() => {
    if (!normalizedHouseTypeIds.length) return 'Todos los tipos de casa';
    if (normalizedHouseTypeIds.length === 1) {
      const id = normalizedHouseTypeIds[0];
      return houseTypeNameById.get(id) ?? `Tipo ${id}`;
    }
    return `${normalizedHouseTypeIds.length} tipos seleccionados`;
  }, [normalizedHouseTypeIds, houseTypeNameById]);

  const normalizedPanelTypeLabel = useMemo(() => {
    if (!normalizedPanelGroups.length) return 'Todos los grupos';
    if (normalizedPanelGroups.length === 1) {
      return normalizedPanelGroups[0];
    }
    return `${normalizedPanelGroups.length} grupos seleccionados`;
  }, [normalizedPanelGroups]);

  useEffect(() => {
    const availableGroups = new Set(panelGroupOptions.map((option) => option.id));
    setNormalizedPanelGroups((prev) => {
      if (!prev.length) return prev;
      const next = prev.filter((group) => availableGroups.has(group));
      return next.length === prev.length ? prev : next;
    });
  }, [panelGroupOptions]);

  const taskApplicabilityByTaskId = useMemo(() => {
    const map = new Map<number, TaskApplicabilityRule[]>();
    taskApplicabilityRules.forEach((row) => {
      const taskId = Number(row.task_definition_id);
      if (!Number.isFinite(taskId)) return;
      const current = map.get(taskId);
      if (current) {
        current.push(row);
      } else {
        map.set(taskId, [row]);
      }
    });
    return map;
  }, [taskApplicabilityRules]);

  const candidatePanelTasks = useMemo(() => {
    if (!selectedHouseType) return [] as TaskDefinition[];
    return taskDefinitions
      .filter((task) => task.scope === 'panel' && task.active)
      .sort((a, b) => {
        const seqA = a.default_station_sequence ?? 0;
        const seqB = b.default_station_sequence ?? 0;
        if (seqA !== seqB) return seqA - seqB;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }, [selectedHouseType, taskDefinitions]);

  const candidateModuleTasks = useMemo(() => {
    if (!selectedHouseType) return [] as TaskDefinition[];
    const moduleNumber = Number(effectiveSelectedModuleNumber);
    if (!Number.isFinite(moduleNumber) || moduleNumber < 1) return [] as TaskDefinition[];
    return taskDefinitions
      .filter((task) => task.scope === 'module' && task.active)
      .filter((task) => {
        const taskRows = taskApplicabilityByTaskId.get(Number(task.id)) ?? [];
        const resolved = resolveTaskApplicability(
          taskRows,
          selectedHouseType.id,
          null,
          moduleNumber,
          null,
        );
        if (!resolved) return true;
        return Boolean(resolved.applies);
      })
      .sort((a, b) => {
        const seqA = a.default_station_sequence ?? 0;
        const seqB = b.default_station_sequence ?? 0;
        if (seqA !== seqB) return seqA - seqB;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }, [selectedHouseType, effectiveSelectedModuleNumber, taskDefinitions, taskApplicabilityByTaskId]);

  const tasksForPanel = useMemo(() => {
    if (!selectedPanel) return candidatePanelTasks;
    const ids = parseTaskIds(selectedPanel.applicable_task_ids);
    if (!ids) return candidatePanelTasks;
    const idSet = new Set(ids.map((id) => Number(id)));
    return candidatePanelTasks.filter((task) => idSet.has(Number(task.id)));
  }, [candidatePanelTasks, selectedPanel]);

  const tasksForScope = useMemo(
    () => (analysisScope === 'panel' ? tasksForPanel : candidateModuleTasks),
    [analysisScope, tasksForPanel, candidateModuleTasks],
  );

  const filteredTasksForSelection = useMemo(() => {
    if (analysisScope === 'panel' && !selectedPanel) return tasksForScope;
    if (analysisScope === 'module' && !effectiveSelectedModuleNumber) return tasksForScope;
    if (!selectedStationId) return tasksForScope;
    const seq = sequenceByStationId.get(String(selectedStationId));
    if (typeof seq !== 'number') return tasksForScope;
    return tasksForScope.filter((task) => Number(task.default_station_sequence ?? NaN) === seq);
  }, [analysisScope, tasksForScope, selectedPanel, effectiveSelectedModuleNumber, selectedStationId, sequenceByStationId]);

  const effectiveSelectedTaskId = useMemo(() => {
    if (!selectedTaskId) return '';
    const exists = filteredTasksForSelection.some((task) => String(task.id) === String(selectedTaskId));
    return exists ? selectedTaskId : '';
  }, [filteredTasksForSelection, selectedTaskId]);
  const shouldIncludeCrossStationExecutions = includeCrossStationExecutions && Boolean(effectiveSelectedTaskId);

  const selectionErrorMessage = useMemo(() => {
    if (!selectedHouseTypeId) {
      return '';
    }
    if (analysisScope === 'panel' && !effectiveSelectedPanelId) {
      return '';
    }
    if (analysisScope === 'module' && !effectiveSelectedModuleNumber) {
      return '';
    }
    if (!selectedStationId) {
      return 'Debe seleccionar una estacion para ver el analisis.';
    }
    return '';
  }, [analysisScope, selectedHouseTypeId, effectiveSelectedPanelId, effectiveSelectedModuleNumber, selectedStationId]);

  const panelSelectionReady = Boolean(
    selectedHouseTypeId
    && selectedStationId
    && (analysisScope === 'panel' ? effectiveSelectedPanelId : effectiveSelectedModuleNumber),
  );
  const panelViewKey = useMemo(() => {
    if (!selectedHouseTypeId) return '';
    const target = analysisScope === 'panel' ? effectiveSelectedPanelId : effectiveSelectedModuleNumber;
    return [
      analysisScope,
      selectedHouseTypeId,
      target,
      selectedStationId || '',
      effectiveSelectedTaskId || '',
      shouldIncludeCrossStationExecutions ? 'cross-station' : 'selected-station',
    ].join('|');
  }, [
    analysisScope,
    selectedHouseTypeId,
    effectiveSelectedPanelId,
    effectiveSelectedModuleNumber,
    selectedStationId,
    effectiveSelectedTaskId,
    shouldIncludeCrossStationExecutions,
  ]);
  const usesStationTaskAnalysis = activeTab === 'panel' || activeTab === 'task-summary';
  const displayAnalysisData = usesStationTaskAnalysis && panelSelectionReady ? analysisData : null;
  const strictCompletenessExcludedCount = Math.max(0, Number(displayAnalysisData?.strict_excluded_count) || 0);
  const displayError = usesStationTaskAnalysis
    ? selectionErrorMessage || (panelSelectionReady ? error : '')
    : '';
  const displayLoading = usesStationTaskAnalysis && panelSelectionReady && loading;

  const panelLabel = (panel: PanelDefinition | null): string => buildPanelLabel(panel);

  const workerLabel = (worker: Worker): string =>
    `${worker.first_name || ''} ${worker.last_name || ''}`.trim() || `Trabajador ${worker.id}`;

  const stationLabel = (station: Station): string => {
    const code = station.id ? String(station.id) : '';
    const name = station.name || '';
    if (!code && !name) return '-';
    return name ? `${code} - ${name}` : code;
  };

  const normalizedMetricLabel = normalizedMetric === 'area' ? 'Minutos / m2' : 'Minutos / m';
  const normalizedMetricUnit = normalizedMetric === 'area' ? 'min/m2' : 'min/m';

  const toggleNormalizedHouseType = (houseTypeId: number) => {
    setNormalizedHouseTypeIds((prev) => {
      if (!prev.length) return [houseTypeId];
      if (prev.includes(houseTypeId)) {
        return prev.filter((id) => id !== houseTypeId);
      }
      return [...prev, houseTypeId];
    });
  };

  const toggleNormalizedPanelGroup = (groupLabel: string) => {
    setNormalizedPanelGroups((prev) => {
      if (!prev.length) return [groupLabel];
      if (prev.includes(groupLabel)) {
        return prev.filter((id) => id !== groupLabel);
      }
      return [...prev, groupLabel];
    });
  };

  const effectiveBinSize = Number(binSize) > 0 ? Number(binSize) : DEFAULT_BIN_SIZE;
  const effectiveMinMultiplier = Number(minMultiplier) || 0;
  const effectiveMaxMultiplier = Number(maxMultiplier) || Number.POSITIVE_INFINITY;
  const normalizedMinValue = parseOptionalNumberInput(normalizedMinMinutes);
  const normalizedMaxValue = parseOptionalNumberInput(normalizedMaxMinutes);
  const normalizedBinValue = parseOptionalNumberInput(normalizedBinSize);
  const effectiveNormalizedMin =
    normalizedMinValue != null && normalizedMaxValue != null
      ? Math.min(normalizedMinValue, normalizedMaxValue)
      : normalizedMinValue;
  const effectiveNormalizedMax =
    normalizedMinValue != null && normalizedMaxValue != null
      ? Math.max(normalizedMinValue, normalizedMaxValue)
      : normalizedMaxValue;
  const effectiveNormalizedBinSize =
    normalizedBinValue != null && normalizedBinValue > 0 ? normalizedBinValue : DEFAULT_NORMALIZED_BIN_SIZE;

  const hypothesis = useMemo(
    () => buildHypothesisFromConfig(activeHypothesisConfig),
    [activeHypothesisConfig],
  );

  const analysisSummary = useMemo(() => {
    const predicate = hypothesis.predicate;
    const points = Array.isArray(displayAnalysisData?.data_points)
      ? displayAnalysisData?.data_points ?? []
      : [];
    if (!points.length) {
      return {
        included: [] as AnalysisPoint[],
        excluded: [] as AnalysisPoint[],
        histogram: buildHistogramData([], effectiveBinSize, predicate),
        average: null as number | null,
        expectedReference: displayAnalysisData?.expected_reference_minutes ?? null,
        hypothesisMatches: predicate ? 0 : null,
        hypothesisMatchAverage: null as number | null,
      };
    }
    const minVal = Math.min(effectiveMinMultiplier, effectiveMaxMultiplier);
    const maxVal = Math.max(effectiveMinMultiplier, effectiveMaxMultiplier);
    const included: AnalysisPoint[] = [];
    const excluded: AnalysisPoint[] = [];
    const hypothesisDurations: number[] | null = predicate ? [] : null;
    points.forEach((point) => {
      const duration = Number(point.duration_minutes) || 0;
      const expected = Number(point.expected_minutes);
      const hasExpected = Number.isFinite(expected) && expected > 0;
      const ratio = hasExpected ? duration / expected : null;
      const pointWithRatio = { ...point, duration_minutes: duration, ratio } as AnalysisPoint & {
        ratio: number | null;
      };
      const taskRows = Array.isArray(point.task_breakdown) ? point.task_breakdown : [];
      if (taskRows.length) {
        let hasTaskWithExpected = false;
        let hasTaskWithoutExpected = false;
        let isOutsideRange = false;
        taskRows.forEach((taskRow) => {
          if (isOutsideRange) return;
          const taskExpected = Number(taskRow.expected_minutes);
          const taskHasExpected = Number.isFinite(taskExpected) && taskExpected > 0;
          if (!taskHasExpected) {
            hasTaskWithoutExpected = true;
            return;
          }
          hasTaskWithExpected = true;
          const taskDuration = Number(taskRow.duration_minutes);
          if (!Number.isFinite(taskDuration) || taskDuration < 0) {
            isOutsideRange = true;
            return;
          }
          const taskRatio = taskDuration / taskExpected;
          if (taskRatio < minVal || taskRatio > maxVal) {
            isOutsideRange = true;
          }
        });
        const isMissingExpectedRejected = hasTaskWithoutExpected && !includeWithoutExpected;
        const hasNoEvaluableExpected = !hasTaskWithExpected;
        if (isOutsideRange || isMissingExpectedRejected || (hasNoEvaluableExpected && !includeWithoutExpected)) {
          excluded.push(pointWithRatio);
        } else {
          included.push(pointWithRatio);
          if (hypothesisDurations && predicate && predicate(pointWithRatio)) {
            hypothesisDurations.push(duration);
          }
        }
        return;
      }
      if (!hasExpected) {
        if (includeWithoutExpected) {
          included.push(pointWithRatio);
        } else {
          excluded.push(pointWithRatio);
        }
        return;
      }
      if (ratio !== null && (ratio < minVal || ratio > maxVal)) {
        excluded.push(pointWithRatio);
      } else {
        included.push(pointWithRatio);
        if (hypothesisDurations && predicate && predicate(pointWithRatio)) {
          hypothesisDurations.push(duration);
        }
      }
    });
    const histogram = buildHistogramData(included, effectiveBinSize, predicate);
    const average = included.length
      ? Number((included.reduce((sum, item) => sum + (item.duration_minutes || 0), 0) / included.length).toFixed(2))
      : null;
    const hypothesisMatchAverage = hypothesisDurations && hypothesisDurations.length
      ? Number(
          (
            hypothesisDurations.reduce((sum, duration) => sum + duration, 0) / hypothesisDurations.length
          ).toFixed(2),
        )
      : null;
    return {
      included,
      excluded,
      histogram,
      average,
      expectedReference: displayAnalysisData?.expected_reference_minutes ?? null,
      hypothesisMatches: predicate ? histogram.totalMatches : null,
      hypothesisMatchAverage: predicate ? hypothesisMatchAverage : null,
    };
  }, [
    displayAnalysisData,
    effectiveBinSize,
    effectiveMaxMultiplier,
    effectiveMinMultiplier,
    includeWithoutExpected,
    hypothesis.predicate,
  ]);

  const expectedReferenceTooltip = useMemo(() => {
    const expectedReference = analysisSummary.expectedReference;
    if (expectedReference == null) {
      return 'Sin valor esperado de referencia.';
    }
    const points = Array.isArray(displayAnalysisData?.data_points)
      ? displayAnalysisData.data_points
      : [];
    const referencePoint = points.find((point) => Array.isArray(point.task_breakdown) && point.task_breakdown.length);
    const baseLines = [
      `Esperado por muestra: ${formatMinutesWithUnit(expectedReference)}.`,
    ];
    if (!referencePoint || !Array.isArray(referencePoint.task_breakdown)) {
      return baseLines.join('\n');
    }

    const expectedByTask = new Map<string, { label: string; expected: number }>();
    referencePoint.task_breakdown.forEach((taskRow) => {
      const expected = Number(taskRow.expected_minutes);
      if (!Number.isFinite(expected) || expected <= 0) return;
      const numericTaskId = Number(taskRow.task_definition_id);
      const taskLabel = taskRow.task_name || String(taskRow.task_definition_id || 'Tarea');
      const key = Number.isFinite(numericTaskId) ? `id:${numericTaskId}` : `name:${normalizeText(taskLabel)}`;
      if (!expectedByTask.has(key)) {
        expectedByTask.set(key, { label: taskLabel, expected });
      }
    });
    const tasks = Array.from(expectedByTask.values())
      .sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
    if (!tasks.length) {
      return baseLines.join('\n');
    }
    const sum = tasks.reduce((total, task) => total + task.expected, 0);
    return [
      ...baseLines,
      'Tareas relevantes:',
      ...tasks.map((task) => `- ${task.label}: ${formatMinutesWithUnit(task.expected)}`),
      `Suma: ${formatMinutesWithUnit(sum)}.`,
    ].join('\n');
  }, [analysisSummary.expectedReference, displayAnalysisData]);

  const taskSummaryRows = useMemo(() => {
    const points = Array.isArray(displayAnalysisData?.data_points)
      ? displayAnalysisData.data_points ?? []
      : [];
    if (!points.length) {
      return [] as TaskSummaryRow[];
    }

    const minVal = Math.min(effectiveMinMultiplier, effectiveMaxMultiplier);
    const maxVal = Math.max(effectiveMinMultiplier, effectiveMaxMultiplier);

    type TaskSummaryAccumulator = {
      key: string;
      task_definition_id: number | null;
      task_name: string;
      sample_count: number;
      duration_sum: number;
      expected_sum: number;
      expected_count: number;
      ratio_sum: number;
      ratio_count: number;
      log_ratio_sum: number;
      log_ratio_sum_squares: number;
      min_duration: number | null;
      max_duration: number | null;
      last_completed_ms: number | null;
      last_completed_at: string | null;
    };

    const aggregateMap = new Map<string, TaskSummaryAccumulator>();

    const pushSample = (
      taskDefinitionId: number | null | undefined,
      taskName: string | null | undefined,
      durationMinutes: number | null | undefined,
      expectedMinutes: number | null | undefined,
      completedAt: string | null | undefined,
    ) => {
      const duration = Number(durationMinutes);
      if (!Number.isFinite(duration) || duration < 0) return;

      const expected = Number(expectedMinutes);
      const hasExpected = Number.isFinite(expected) && expected > 0;
      const ratio = hasExpected ? duration / expected : null;
      if (!hasExpected && !includeWithoutExpected) return;
      if (ratio != null && (ratio < minVal || ratio > maxVal)) return;

      const numericTaskId = Number(taskDefinitionId);
      const safeTaskId = Number.isFinite(numericTaskId) ? numericTaskId : null;
      const taskLabel = typeof taskName === 'string' && taskName.trim()
        ? taskName.trim()
        : safeTaskId != null
          ? `Tarea ${safeTaskId}`
          : 'Tarea sin nombre';
      const key = safeTaskId != null ? `id:${safeTaskId}` : `name:${normalizeText(taskLabel)}`;

      const completedMs = normalizeDateToComparable(completedAt);
      const existing = aggregateMap.get(key);
      if (existing) {
        existing.sample_count += 1;
        existing.duration_sum += duration;
        if (existing.min_duration == null || duration < existing.min_duration) {
          existing.min_duration = duration;
        }
        if (existing.max_duration == null || duration > existing.max_duration) {
          existing.max_duration = duration;
        }
        if (hasExpected) {
          existing.expected_sum += expected;
          existing.expected_count += 1;
          if (ratio != null) {
            existing.ratio_sum += ratio;
            existing.ratio_count += 1;
            const logRatio = Math.log(ratio);
            existing.log_ratio_sum += logRatio;
            existing.log_ratio_sum_squares += logRatio * logRatio;
          }
        }
        if (completedMs != null && (existing.last_completed_ms == null || completedMs > existing.last_completed_ms)) {
          existing.last_completed_ms = completedMs;
          existing.last_completed_at = completedAt ?? null;
        }
        return;
      }

      aggregateMap.set(key, {
        key,
        task_definition_id: safeTaskId,
        task_name: taskLabel,
        sample_count: 1,
        duration_sum: duration,
        expected_sum: hasExpected ? expected : 0,
        expected_count: hasExpected ? 1 : 0,
        ratio_sum: ratio != null ? ratio : 0,
        ratio_count: ratio != null ? 1 : 0,
        log_ratio_sum: ratio != null ? Math.log(ratio) : 0,
        log_ratio_sum_squares: ratio != null ? Math.log(ratio) * Math.log(ratio) : 0,
        min_duration: duration,
        max_duration: duration,
        last_completed_ms: completedMs,
        last_completed_at: completedAt ?? null,
      });
    };

    points.forEach((point) => {
      if (Array.isArray(point.task_breakdown) && point.task_breakdown.length) {
        point.task_breakdown.forEach((taskRow) => {
          pushSample(
            taskRow.task_definition_id,
            taskRow.task_name,
            taskRow.duration_minutes,
            taskRow.expected_minutes,
            taskRow.completed_at ?? point.completed_at,
          );
        });
        return;
      }
      pushSample(
        point.task_definition_id,
        point.task_name,
        point.duration_minutes,
        point.expected_minutes,
        point.completed_at,
      );
    });

    return Array.from(aggregateMap.values()).map((row) => {
      let trendScore: number | null = null;
      if (row.ratio_count >= 3) {
        const meanLogRatio = row.log_ratio_sum / row.ratio_count;
        const varianceNumerator = row.log_ratio_sum_squares - ((row.log_ratio_sum ** 2) / row.ratio_count);
        const sampleVariance = row.ratio_count > 1
          ? Math.max(0, varianceNumerator / (row.ratio_count - 1))
          : 0;
        const standardDeviation = Math.sqrt(sampleVariance);
        const standardError = Math.max(standardDeviation / Math.sqrt(row.ratio_count), 1e-6);
        trendScore = Number(clampNumber(meanLogRatio / standardError, -9.99, 9.99).toFixed(2));
      }

      return {
        key: row.key,
        task_definition_id: row.task_definition_id,
        task_name: row.task_name,
        sample_count: row.sample_count,
        expected_sample_count: row.expected_count,
        ratio_sample_count: row.ratio_count,
        average_duration: Number((row.duration_sum / row.sample_count).toFixed(2)),
        average_expected: row.expected_count ? Number((row.expected_sum / row.expected_count).toFixed(2)) : null,
        average_ratio: row.ratio_count ? Number((row.ratio_sum / row.ratio_count).toFixed(3)) : null,
        trend_score: trendScore,
        min_duration: row.min_duration != null ? Number(row.min_duration.toFixed(2)) : null,
        max_duration: row.max_duration != null ? Number(row.max_duration.toFixed(2)) : null,
        last_completed_at: row.last_completed_at,
      };
    });
  }, [
    displayAnalysisData,
    effectiveMaxMultiplier,
    effectiveMinMultiplier,
    includeWithoutExpected,
  ]);

  const taskSummaryStats = useMemo(() => {
    if (!taskSummaryRows.length) {
      return {
        taskCount: 0,
        sampleCount: 0,
        averageDuration: null as number | null,
        averageExpected: null as number | null,
        averageRatio: null as number | null,
      };
    }
    const sampleCount = taskSummaryRows.reduce((sum, row) => sum + row.sample_count, 0);
    const durationWeightedSum = taskSummaryRows.reduce(
      (sum, row) => sum + (row.average_duration ?? 0) * row.sample_count,
      0,
    );
    const expectedWeightedSum = taskSummaryRows.reduce(
      (sum, row) => sum + (row.average_expected ?? 0) * row.expected_sample_count,
      0,
    );
    const expectedSamples = taskSummaryRows.reduce(
      (sum, row) => sum + row.expected_sample_count,
      0,
    );
    const ratioWeightedSum = taskSummaryRows.reduce(
      (sum, row) => sum + (row.average_ratio ?? 0) * row.ratio_sample_count,
      0,
    );
    const ratioSamples = taskSummaryRows.reduce(
      (sum, row) => sum + row.ratio_sample_count,
      0,
    );
    return {
      taskCount: taskSummaryRows.length,
      sampleCount,
      averageDuration: sampleCount ? Number((durationWeightedSum / sampleCount).toFixed(2)) : null,
      averageExpected: expectedSamples ? Number((expectedWeightedSum / expectedSamples).toFixed(2)) : null,
      averageRatio: ratioSamples ? Number((ratioWeightedSum / ratioSamples).toFixed(3)) : null,
    };
  }, [taskSummaryRows]);

  const taskSummaryAverageShadeStyle = useMemo(
    () => getRatioBackgroundStyle(taskSummaryStats.averageRatio, effectiveMinMultiplier, effectiveMaxMultiplier),
    [taskSummaryStats.averageRatio, effectiveMinMultiplier, effectiveMaxMultiplier],
  );

  const normalizedReport = useMemo(() => {
    const emptySummary = {
      totalMatching: 0,
      included: 0,
      missingMetric: 0,
      missingTime: 0,
      averageMinutes: null as number | null,
      sampleCount: 0,
      bestRow: null as NormalizedCompletionRow | null,
      worstRow: null as NormalizedCompletionRow | null,
    };
    if (!normalizedData?.houses || !normalizedStationId) {
      return { rows: [] as NormalizedCompletionRow[], summary: emptySummary };
    }
    const houseTypeSet = new Set(normalizedHouseTypeIds);
    const groupSet = new Set(normalizedPanelGroups);
    const rows: NormalizedCompletionRow[] = [];
    let totalMatching = 0;
    let missingMetric = 0;
    let missingTime = 0;
    let bestRow: NormalizedCompletionRow | null = null;
    let worstRow: NormalizedCompletionRow | null = null;

    normalizedData.houses.forEach((house, houseIndex) => {
      const houseTypeId = house.house_type_id != null ? Number(house.house_type_id) : null;
      if (houseTypeSet.size) {
        if (!houseTypeId || !houseTypeSet.has(houseTypeId)) return;
      }
      const houseName = house.house_type_name || (houseTypeId != null ? `Tipo ${houseTypeId}` : 'Tipo');
      const modules = Array.isArray(house.modules) ? house.modules : [];
      modules.forEach((moduleItem, moduleIndex) => {
        const panels = Array.isArray(moduleItem?.panels) ? moduleItem.panels : [];
        panels.forEach((panel, panelIndex) => {
          const panelDefinitionId =
            panel.panel_definition_id != null ? Number(panel.panel_definition_id) : NaN;
          if (!Number.isFinite(panelDefinitionId)) return;
          const panelMeta = panelDefinitionById.get(panelDefinitionId);
          const groupLabel = normalizePanelGroup(panelMeta?.group);
          if (groupSet.size && !groupSet.has(groupLabel)) return;
          totalMatching += 1;

          const actualMinutes = Number(panel.actual_minutes);
          if (!Number.isFinite(actualMinutes) || actualMinutes <= 0) {
            missingTime += 1;
            return;
          }

          const panelArea = panel.panel_area ?? panelMeta?.panel_area ?? null;
          const panelLength = panelMeta?.panel_length_m ?? null;
          const hasArea = panelArea != null && Number(panelArea) > 0;
          const hasLength = panelLength != null && Number(panelLength) > 0;
          const hasSelectedMeasure = normalizedMetric === 'area' ? hasArea : hasLength;
          if (!hasSelectedMeasure) {
            missingMetric += 1;
            return;
          }
          const measure = normalizedMetric === 'area' ? Number(panelArea) : Number(panelLength);
          if (!(measure > 0)) {
            missingMetric += 1;
            return;
          }
          const normalizedMinutes = actualMinutes / measure;
          if (effectiveNormalizedMin != null && normalizedMinutes < effectiveNormalizedMin) {
            return;
          }
          if (effectiveNormalizedMax != null && normalizedMinutes > effectiveNormalizedMax) {
            return;
          }
          const panelLabelText = panelMeta
            ? buildPanelLabel(panelMeta)
            : panel.panel_code
              ? `Panel ${panel.panel_code}`
              : `Panel ${panelDefinitionId}`;
          const entry: NormalizedCompletionRow = {
            id: `${panelDefinitionId}-${panel.plan_id ?? houseIndex}-${panel.finished_at ?? panel.station_finished_at ?? `${moduleIndex}-${panelIndex}`}`,
            panel_definition_id: panelDefinitionId,
            house_type_id: houseTypeId ?? panelMeta?.house_type_id ?? null,
            house_type_name: houseName,
            panel_label: panelLabelText,
            panel_group: groupLabel,
            panel_area: Number(panelArea),
            panel_length_m: Number(panelLength),
            actual_minutes: actualMinutes,
            normalized_minutes: normalizedMinutes,
            finished_at: panel.finished_at ?? panel.station_finished_at ?? null,
          };
          rows.push(entry);
          if (!bestRow || entry.normalized_minutes < bestRow.normalized_minutes) {
            bestRow = entry;
          }
          if (!worstRow || entry.normalized_minutes > worstRow.normalized_minutes) {
            worstRow = entry;
          }
        });
      });
    });

    rows.sort((a, b) => b.normalized_minutes - a.normalized_minutes);

    const averageMinutes = rows.length
      ? Number((rows.reduce((sum, item) => sum + item.normalized_minutes, 0) / rows.length).toFixed(3))
      : null;
    const sampleCount = rows.length;
    return {
      rows,
      summary: {
        totalMatching,
        included: rows.length,
        missingMetric,
        missingTime,
        averageMinutes,
        sampleCount,
        bestRow,
        worstRow,
      },
    };
  }, [
    normalizedData,
    normalizedStationId,
    normalizedHouseTypeIds,
    normalizedPanelGroups,
    normalizedMetric,
    effectiveNormalizedMin,
    effectiveNormalizedMax,
    panelDefinitionById,
  ]);

  const normalizedHistogram = useMemo(
    () => buildNormalizedHistogramData(normalizedReport.rows, effectiveNormalizedBinSize),
    [normalizedReport.rows, effectiveNormalizedBinSize],
  );

  const workerNamesFromAnalysis = useMemo(() => {
    if (!displayAnalysisData || !Array.isArray(displayAnalysisData.data_points)) return [] as string[];
    const names = new Set<string>();
    displayAnalysisData.data_points.forEach((point) => {
      if (typeof point?.worker_name === 'string' && point.worker_name.trim()) {
        point.worker_name
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
          .forEach((name) => names.add(name));
      }
      if (Array.isArray(point?.task_breakdown)) {
        point.task_breakdown
          .map((task) => (typeof task?.worker_name === 'string' ? task.worker_name.trim() : ''))
          .filter(Boolean)
          .forEach((name) => names.add(name));
      }
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [displayAnalysisData]);

  const workerOptionsForHypothesis = useMemo(() => {
    if (workerNamesFromAnalysis.length) return workerNamesFromAnalysis;
    const labels = new Set<string>();
    workers.forEach((worker) => {
      const label = workerLabel(worker);
      if (label) labels.add(label);
    });
    return Array.from(labels).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [workerNamesFromAnalysis, workers]);

  const openHypothesisEditor = () => {
    setHypothesisEditorOpen(true);
    setHypothesisError('');
    setHypothesisForm(activeHypothesisConfig ? { ...activeHypothesisConfig } : { ...DEFAULT_HYPOTHESIS_FORM });
  };

  const handleHypothesisFieldChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newField = event.target.value as HypothesisField;
    const fieldConfig = getHypothesisFieldConfig(newField);
    const nextOperator = fieldConfig.operators.some((item) => item.value === hypothesisForm.operator)
      ? hypothesisForm.operator
      : fieldConfig.operators[0]?.value || '==';
    setHypothesisForm({
      field: newField,
      operator: nextOperator,
      value: '',
    });
    setHypothesisError('');
  };

  const handleHypothesisOperatorChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newOperator = event.target.value as HypothesisOperator;
    setHypothesisForm((prev) => ({
      ...prev,
      operator: newOperator,
    }));
    setHypothesisError('');
  };

  const handleHypothesisValueChange = (value: string) => {
    setHypothesisForm((prev) => ({
      ...prev,
      value,
    }));
    setHypothesisError('');
  };

  const handleApplyHypothesis = () => {
    if (hypothesisForm.field === 'worker' && !workerOptionsForHypothesis.length) {
      setHypothesisError('No hay trabajadores disponibles para aplicar la hipotesis.');
      return;
    }
    const result = buildHypothesisFromConfig(hypothesisForm);
    if (result.error) {
      setHypothesisError(result.error);
      return;
    }
    setActiveHypothesisConfig({ ...hypothesisForm });
    setHypothesisEditorOpen(false);
    setHypothesisError('');
  };

  const handleCancelHypothesis = () => {
    setHypothesisError('');
    setHypothesisEditorOpen(false);
    setHypothesisForm(activeHypothesisConfig ? { ...activeHypothesisConfig } : { ...DEFAULT_HYPOTHESIS_FORM });
  };

  const handleRemoveHypothesis = () => {
    setActiveHypothesisConfig(null);
    setHypothesisForm({ ...DEFAULT_HYPOTHESIS_FORM });
    setHypothesisError('');
    setHypothesisEditorOpen(false);
  };

  useEffect(() => {
    if (!usesStationTaskAnalysis) {
      return undefined;
    }
    const hasTarget = analysisScope === 'panel' ? Boolean(effectiveSelectedPanelId) : Boolean(effectiveSelectedModuleNumber);
    if (!selectedHouseTypeId || !hasTarget || !selectedStationId) {
      setWorkersForSelection([]);
      setWorkersForSelectionLoading(false);
      return undefined;
    }
    let cancelled = false;
    const loadWorkers = async () => {
      setWorkersForSelectionLoading(true);
      const params = new URLSearchParams();
      params.append('house_type_id', String(selectedHouseTypeId));
      params.append('scope', analysisScope);
      if (analysisScope === 'panel') {
        params.append('panel_definition_id', String(effectiveSelectedPanelId));
      } else {
        params.append('module_number', String(effectiveSelectedModuleNumber));
      }
      params.append('station_id', String(selectedStationId));
      if (effectiveSelectedTaskId) params.append('task_definition_id', String(effectiveSelectedTaskId));
      if (shouldIncludeCrossStationExecutions) params.append('include_cross_station', 'true');
      const fromDateBoundary = toApiDateBoundary(fromDate, 'start');
      const toDateBoundary = toApiDateBoundary(toDate, 'end');
      if (fromDateBoundary) params.append('from_date', fromDateBoundary);
      if (toDateBoundary) params.append('to_date', toDateBoundary);

      apiRequest<TaskAnalysisWorkerOption[]>(`/api/task-analysis/workers?${params.toString()}`)
        .then((result) => {
          if (!cancelled) {
            setWorkersForSelection(Array.isArray(result) ? result : []);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setWorkersForSelection([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setWorkersForSelectionLoading(false);
          }
        });
    };

    void loadWorkers();

    return () => {
      cancelled = true;
    };
  }, [
    usesStationTaskAnalysis,
    analysisScope,
    selectedHouseTypeId,
    effectiveSelectedPanelId,
    effectiveSelectedModuleNumber,
    selectedStationId,
    effectiveSelectedTaskId,
    shouldIncludeCrossStationExecutions,
    fromDate,
    toDate,
  ]);

  useEffect(() => {
    if (!selectedWorkerId || workersForSelectionLoading) return;
    const exists = workersForSelection.some(
      (worker) => String(worker.worker_id) === String(selectedWorkerId),
    );
    if (!exists) {
      setSelectedWorkerId('');
      setAnalysisData(null);
    }
  }, [selectedWorkerId, workersForSelectionLoading, workersForSelection]);

  useEffect(() => {
    if (!usesStationTaskAnalysis) {
      return undefined;
    }
    const hasTarget = analysisScope === 'panel' ? Boolean(effectiveSelectedPanelId) : Boolean(effectiveSelectedModuleNumber);
    if (!selectedHouseTypeId || !hasTarget || !selectedStationId) {
      return undefined;
    }
    let cancelled = false;
    const loadAnalysis = async () => {
      setLoading(true);
      setError('');

      const params = new URLSearchParams();
      params.append('house_type_id', String(selectedHouseTypeId));
      params.append('scope', analysisScope);
      if (analysisScope === 'panel') {
        params.append('panel_definition_id', String(effectiveSelectedPanelId));
      } else {
        params.append('module_number', String(effectiveSelectedModuleNumber));
      }
      if (effectiveSelectedTaskId) params.append('task_definition_id', String(effectiveSelectedTaskId));
      if (selectedStationId) params.append('station_id', String(selectedStationId));
      if (shouldIncludeCrossStationExecutions) params.append('include_cross_station', 'true');
      if (selectedWorkerId) params.append('worker_id', String(selectedWorkerId));
      const fromDateBoundary = toApiDateBoundary(fromDate, 'start');
      const toDateBoundary = toApiDateBoundary(toDate, 'end');
      if (fromDateBoundary) params.append('from_date', fromDateBoundary);
      if (toDateBoundary) params.append('to_date', toDateBoundary);

      apiRequest<TaskAnalysisResponse>(`/api/task-analysis?${params.toString()}`)
        .then((result) => {
          if (!cancelled) {
            setAnalysisData(result);
            if (panelViewKey && panelViewKey !== lastAppliedBinSizeViewKeyRef.current) {
              setBinSize(getDefaultBinSizeFromExpected(result?.expected_reference_minutes ?? null));
              lastAppliedBinSizeViewKeyRef.current = panelViewKey;
            }
          }
        })
        .catch((err: Error) => {
          if (!cancelled) {
            setAnalysisData(null);
            setError(err.message || 'Error obteniendo analisis');
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    };

    void loadAnalysis();

    return () => {
      cancelled = true;
    };
  }, [
    usesStationTaskAnalysis,
    analysisScope,
    selectedHouseTypeId,
    effectiveSelectedPanelId,
    effectiveSelectedModuleNumber,
    effectiveSelectedTaskId,
    shouldIncludeCrossStationExecutions,
    selectedStationId,
    selectedWorkerId,
    fromDate,
    toDate,
    panelViewKey,
  ]);

  useEffect(() => {
    if (activeTab !== 'normalized') {
      return undefined;
    }
    if (!normalizedStationId) {
      setNormalizedData(null);
      setNormalizedError('');
      setNormalizedLoading(false);
      return undefined;
    }
    let cancelled = false;
    const loadNormalized = async () => {
      setNormalizedLoading(true);
      setNormalizedError('');
      const params = new URLSearchParams();
      params.append('station_id', String(normalizedStationId));
      const normalizedFromBoundary = toApiDateBoundary(normalizedDateRange.from, 'start');
      const normalizedToBoundary = toApiDateBoundary(normalizedDateRange.to, 'end');
      if (normalizedFromBoundary) params.append('from_date', normalizedFromBoundary);
      if (normalizedToBoundary) params.append('to_date', normalizedToBoundary);
      try {
        const result = await apiRequest<StationPanelsFinishedResponse>(
          `/api/station-panels-finished?${params.toString()}`,
        );
        if (!cancelled) {
          setNormalizedData(result);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Error obteniendo analisis';
          setNormalizedData(null);
          setNormalizedError(message);
        }
      } finally {
        if (!cancelled) {
          setNormalizedLoading(false);
        }
      }
    };

    void loadNormalized();

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    normalizedStationId,
    normalizedDateRange.from,
    normalizedDateRange.to,
  ]);

  const resetFilters = () => {
    setAnalysisScope('panel');
    setSelectedTaskId('');
    setSelectedModuleNumber('');
    setSelectedStationId('');
    setSelectedWorkerId('');
    setWorkersForSelection([]);
    setWorkersForSelectionLoading(false);
    setFromDate('');
    setToDate('');
    setHypothesisForm({ ...DEFAULT_HYPOTHESIS_FORM });
    setActiveHypothesisConfig(null);
    setHypothesisEditorOpen(false);
    setHypothesisError('');
    setBinSize(String(DEFAULT_BIN_SIZE));
    setMinMultiplier(String(DEFAULT_MIN_MULTIPLIER));
    setMaxMultiplier(String(DEFAULT_MAX_MULTIPLIER));
    setIncludeWithoutExpected(true);
    setIncludeCrossStationExecutions(false);
    setTaskSummarySort({
      key: 'avgDuration',
      direction: 'desc',
    });
    setAnalysisData(null);
    setError('');
    lastAppliedBinSizeViewKeyRef.current = '';
  };

  const resetNormalizedFilters = () => {
    setNormalizedStationId('');
    setNormalizedMetric('linear');
    setNormalizedHouseTypeIds([]);
    setNormalizedPanelGroups([]);
    setHouseTypeDropdownOpen(false);
    setPanelTypeDropdownOpen(false);
    setNormalizedFromDate('');
    setNormalizedToDate('');
    setNormalizedMinMinutes('');
    setNormalizedMaxMinutes('');
    setNormalizedBinSize(String(DEFAULT_NORMALIZED_BIN_SIZE));
    setNormalizedView('histogram');
    setNormalizedScatterDisplay('all');
    setShowNormalizedRegression(false);
    setNormalizedData(null);
    setNormalizedError('');
  };

  const buildDataPointSummary = (row: AnalysisPoint): string => {
    const house = row.house_identifier || '-';
    const date = formatDateTimeInAppTimezone(row.completed_at);
    const duration = formatMinutesWithUnit(row.duration_minutes);
    let workersSummary = row.worker_name || '';
    if (Array.isArray(row.task_breakdown) && row.task_breakdown.length) {
      const workerNames = Array.from(
        new Set(row.task_breakdown.map((task) => task.worker_name).filter(Boolean) as string[]),
      );
      if (workerNames.length) {
        workersSummary = workerNames.join(', ');
      }
    }
    const workersLabel = workersSummary || '-';
    return `Casa ${house} - Fecha ${date} - Duracion ${duration} - Trabajador(es) ${workersLabel}`;
  };

  const buildTaskBreakdownTooltip = (task: TaskBreakdownRow): string => {
    const taskLabel = task.task_name || String(task.task_definition_id || 'Tarea');
    const durationLabel = formatMinutesWithUnit(task.duration_minutes);
    const expectedLabel = formatMinutesWithUnit(task.expected_minutes);
    const startedLabel = formatDateTimeInAppTimezone(task.started_at);
    const completedLabel = formatDateTimeInAppTimezone(task.completed_at);
    const workersLabel = task.worker_name || '-';
    const totalPauseLabel = formatMinutesWithUnit(task.pause_minutes);
    const pauseLines = Array.isArray(task.pauses)
      ? task.pauses.map((pause, index) => {
          const pausedAt = formatDateTimeInAppTimezone(pause.paused_at);
          const resumedAt = formatDateTimeInAppTimezone(pause.resumed_at);
          const pauseMinutes = normalizePauseMinutes(pause);
          const duration = pauseMinutes != null ? formatMinutesWithUnit(pauseMinutes) : '-';
          const reason = pause.reason ? ` / Motivo: ${pause.reason}` : '';
          return `Pausa ${index + 1}: ${pausedAt} -> ${resumedAt} / Duracion ${duration}${reason}`;
        })
      : [];
    const pausesSummary = pauseLines.length ? pauseLines.join('\n') : 'Pausas: Sin pausas';
    return [
      `Tarea: ${taskLabel}`,
      `Inicio: ${startedLabel}`,
      `Fin: ${completedLabel}`,
      `Duracion activa: ${durationLabel}`,
      `Esperado: ${expectedLabel}`,
      `Trabajador(es): ${workersLabel}`,
      `Pausas totales: ${totalPauseLabel}`,
      pausesSummary,
    ].join('\n');
  };

  const clearDurationTimelineHideTimeout = () => {
    if (durationTimelineHideTimeoutRef.current != null) {
      window.clearTimeout(durationTimelineHideTimeoutRef.current);
      durationTimelineHideTimeoutRef.current = null;
    }
  };

  const scheduleDurationTimelineHide = () => {
    clearDurationTimelineHideTimeout();
    durationTimelineHideTimeoutRef.current = window.setTimeout(() => {
      setDurationTimelinePreview(null);
      durationTimelineHideTimeoutRef.current = null;
    }, 120);
  };

  const openDurationTimelinePreview = (
    row: AnalysisPoint,
    event: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>,
  ) => {
    clearDurationTimelineHideTimeout();
    const rect = event.currentTarget.getBoundingClientRect();
    const preview = buildDurationTimelinePreview(
      row,
      rect.left + (rect.width / 2),
      rect.bottom + 8,
    );
    setDurationTimelinePreview(preview);
  };

  const compareRowsBySort = (a: AnalysisPoint, b: AnalysisPoint, key: DataTableSortKey): number => {
    const ratioA = (a as AnalysisPoint & { ratio?: number | null }).ratio ?? null;
    const ratioB = (b as AnalysisPoint & { ratio?: number | null }).ratio ?? null;
    switch (key) {
      case 'plan': {
        const planA = `${a.house_identifier || ''}-${a.module_number || ''}`;
        const planB = `${b.house_identifier || ''}-${b.module_number || ''}`;
        return planA.localeCompare(planB, 'es', { sensitivity: 'base' });
      }
      case 'duration':
        return (Number(a.duration_minutes) || 0) - (Number(b.duration_minutes) || 0);
      case 'expected':
        return (Number(a.expected_minutes) || 0) - (Number(b.expected_minutes) || 0);
      case 'ratio':
        return (ratioA ?? Number.NEGATIVE_INFINITY) - (ratioB ?? Number.NEGATIVE_INFINITY);
      case 'completed':
        return (normalizeDateToComparable(a.completed_at) ?? Number.NEGATIVE_INFINITY)
          - (normalizeDateToComparable(b.completed_at) ?? Number.NEGATIVE_INFINITY);
      case 'worker':
        return (a.worker_name || '').localeCompare(b.worker_name || '', 'es', { sensitivity: 'base' });
      default:
        return 0;
    }
  };

  const handleDataTableSort = (key: DataTableSortKey) => {
    setDataTableSort((prev) => {
      if (prev.key === key) {
        return {
          key,
          direction: prev.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        key,
        direction: key === 'plan' || key === 'worker' ? 'asc' : 'desc',
      };
    });
  };

  const compareTaskSummaryBySort = (
    a: TaskSummaryRow,
    b: TaskSummaryRow,
    key: TaskSummarySortKey,
  ): number => {
    switch (key) {
      case 'task':
        return a.task_name.localeCompare(b.task_name, 'es', { sensitivity: 'base' });
      case 'samples':
        return a.sample_count - b.sample_count;
      case 'avgDuration':
        return (a.average_duration ?? Number.NEGATIVE_INFINITY) - (b.average_duration ?? Number.NEGATIVE_INFINITY);
      case 'avgExpected':
        return (a.average_expected ?? Number.NEGATIVE_INFINITY) - (b.average_expected ?? Number.NEGATIVE_INFINITY);
      case 'avgRatio':
        return (a.average_ratio ?? Number.NEGATIVE_INFINITY) - (b.average_ratio ?? Number.NEGATIVE_INFINITY);
      case 'trendScore':
        return (a.trend_score ?? Number.NEGATIVE_INFINITY) - (b.trend_score ?? Number.NEGATIVE_INFINITY);
      case 'minDuration':
        return (a.min_duration ?? Number.NEGATIVE_INFINITY) - (b.min_duration ?? Number.NEGATIVE_INFINITY);
      case 'maxDuration':
        return (a.max_duration ?? Number.NEGATIVE_INFINITY) - (b.max_duration ?? Number.NEGATIVE_INFINITY);
      case 'lastCompleted':
        return (normalizeDateToComparable(a.last_completed_at) ?? Number.NEGATIVE_INFINITY)
          - (normalizeDateToComparable(b.last_completed_at) ?? Number.NEGATIVE_INFINITY);
      default:
        return 0;
    }
  };

  const handleTaskSummarySort = (key: TaskSummarySortKey) => {
    setTaskSummarySort((prev) => {
      if (prev.key === key) {
        return {
          key,
          direction: prev.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        key,
        direction: key === 'task' ? 'asc' : 'desc',
      };
    });
  };

  const renderHistogram = () => {
    const { bins, maxCount, binSize: size, maxDuration } = analysisSummary.histogram;
    if (!bins.length || !maxCount) {
      return <div className="text-sm text-[var(--ink-muted)]">No hay datos suficientes para el histograma.</div>;
    }
    const chartHeight = 260;
    const averageGuideOvershoot = 12;
    const expectedGuideOvershoot = 24;
    const hypothesisGuideOvershoot = 36;
    const showHypothesis = Boolean(hypothesis.predicate);
    const topGuideOvershoot = showHypothesis
      ? Math.max(expectedGuideOvershoot, averageGuideOvershoot, hypothesisGuideOvershoot)
      : Math.max(expectedGuideOvershoot, averageGuideOvershoot);
    const margin = { top: 16 + topGuideOvershoot, right: 16, bottom: 60, left: 56 };
    const chartWidth = Math.max(bins.length, 1) * 60;
    const svgWidth = chartWidth + margin.left + margin.right;
    const svgHeight = chartHeight + margin.top + margin.bottom;
    const minutesPerPixel = maxDuration > 0 ? maxDuration / chartWidth : 1;
    const barFullWidth = size / minutesPerPixel;
    const barWidth = barFullWidth * 0.72;
    const gap = (barFullWidth - barWidth) / 2;
    const expectedX = analysisSummary.expectedReference != null
      ? Math.min(chartWidth, Math.max(0, analysisSummary.expectedReference / minutesPerPixel))
      : null;
    const averageX = analysisSummary.average != null
      ? Math.min(chartWidth, Math.max(0, analysisSummary.average / minutesPerPixel))
      : null;
    const hypothesisAverageX = showHypothesis && analysisSummary.hypothesisMatchAverage != null
      ? Math.min(chartWidth, Math.max(0, analysisSummary.hypothesisMatchAverage / minutesPerPixel))
      : null;
    const axisBaseY = margin.top + chartHeight;

    return (
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <svg width={svgWidth} height={svgHeight} role="img" aria-label="Histograma de tiempos">
            <line
              x1={margin.left}
              y1={axisBaseY}
              x2={margin.left + chartWidth}
              y2={axisBaseY}
              stroke="#374151"
              strokeWidth={1}
            />
            <line x1={margin.left} y1={margin.top} x2={margin.left} y2={axisBaseY} stroke="#374151" />
            {bins.map((bin) => {
              const totalCount = bin.count;
              const matchCount = showHypothesis ? bin.matchCount : 0;
              const nonMatchCount = showHypothesis ? Math.max(0, totalCount - matchCount) : 0;
              const barHeight = (totalCount / maxCount) * chartHeight;
              const matchHeight = showHypothesis ? (matchCount / maxCount) * chartHeight : 0;
              const nonMatchHeight = showHypothesis ? (nonMatchCount / maxCount) * chartHeight : 0;
              const x = margin.left + bin.index * barFullWidth + gap;
              const barTopY = axisBaseY - barHeight;
              const tooltipLines: string[] = [];
              if (showHypothesis) {
                tooltipLines.push(`Coinciden: ${matchCount}`);
                tooltipLines.push(`No coinciden: ${nonMatchCount}`);
              }
              if (bin.items && bin.items.length) {
                tooltipLines.push(...bin.items.map((point) => buildDataPointSummary(point)));
              } else {
                tooltipLines.push('Sin muestras en este rango');
              }
              const tooltip = tooltipLines.join('\n');
              const renderFallbackRect = showHypothesis && matchHeight <= 0 && nonMatchHeight <= 0;
              return (
                <g key={bin.index}>
                  <title>{tooltip}</title>
                  {showHypothesis ? (
                    <>
                      {matchHeight > 0 && (
                        <rect
                          x={x}
                          y={axisBaseY - matchHeight}
                          width={barWidth}
                          height={matchHeight}
                          fill="var(--accent)"
                          aria-label={tooltip}
                        />
                      )}
                      {nonMatchHeight > 0 && (
                        <rect
                          x={x}
                          y={axisBaseY - matchHeight - nonMatchHeight}
                          width={barWidth}
                          height={nonMatchHeight}
                          fill="#3b82f6"
                          aria-label={tooltip}
                        />
                      )}
                      {renderFallbackRect && (
                        <rect
                          x={x}
                          y={axisBaseY - 1}
                          width={barWidth}
                          height={1}
                          fill="transparent"
                          aria-label={tooltip}
                        />
                      )}
                    </>
                  ) : (
                    <rect
                      x={x}
                      y={barTopY}
                      width={barWidth}
                      height={barHeight}
                      fill="#3b82f6"
                      aria-label={tooltip}
                    />
                  )}
                  <text x={x + barWidth / 2} y={axisBaseY + 16} textAnchor="middle" fontSize="10" fill="#4b5563">
                    {`${bin.from.toFixed(0)}-${bin.to.toFixed(0)}`}
                  </text>
                  <text x={x + barWidth / 2} y={barTopY - 6} textAnchor="middle" fontSize="11" fill="#111827">
                    {bin.count}
                  </text>
                </g>
              );
            })}
            {expectedX !== null && (
              <g className="cursor-help">
                <title>{expectedReferenceTooltip}</title>
                <line
                  x1={margin.left + expectedX}
                  y1={margin.top - expectedGuideOvershoot}
                  x2={margin.left + expectedX}
                  y2={axisBaseY}
                  stroke="var(--accent)"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                />
                <text
                  x={margin.left + expectedX}
                  y={margin.top - expectedGuideOvershoot - 4}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--accent)"
                >
                  {`Esperado ${formatMinutesWithUnit(analysisSummary.expectedReference)}`}
                </text>
              </g>
            )}
            {averageX !== null && (
              <g>
                <line
                  x1={margin.left + averageX}
                  y1={margin.top - averageGuideOvershoot}
                  x2={margin.left + averageX}
                  y2={axisBaseY}
                  stroke="var(--leaf)"
                  strokeDasharray="6 3"
                  strokeWidth={2}
                />
                <text
                  x={margin.left + averageX}
                  y={margin.top - averageGuideOvershoot - 4}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--leaf)"
                >
                  {`Promedio filtrado ${formatMinutesWithUnit(analysisSummary.average)}`}
                </text>
              </g>
            )}
            {hypothesisAverageX !== null && (
              <g>
                <line
                  x1={margin.left + hypothesisAverageX}
                  y1={margin.top - hypothesisGuideOvershoot}
                  x2={margin.left + hypothesisAverageX}
                  y2={axisBaseY}
                  stroke="#f59e0b"
                  strokeDasharray="3 3"
                  strokeWidth={2}
                />
                <text
                  x={margin.left + hypothesisAverageX}
                  y={margin.top - hypothesisGuideOvershoot - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#f59e0b"
                >
                  {`Promedio hipotesis ${formatMinutesWithUnit(analysisSummary.hypothesisMatchAverage)}`}
                </text>
              </g>
            )}
          </svg>
        </div>
        {showHypothesis && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--ink-muted)]">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-[var(--accent)]" />
              <span>Coincide con la hipotesis</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-blue-500" />
              <span>No coincide</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderDataTable = (rows: AnalysisPoint[], emptyLabel: string) => {
    if (!rows.length) {
      return <div className="text-sm text-[var(--ink-muted)]">{emptyLabel}</div>;
    }
    const sortedRows = [...rows].sort((a, b) => {
      const comparison = compareRowsBySort(a, b, dataTableSort.key);
      return dataTableSort.direction === 'asc' ? comparison : -comparison;
    });
    const renderSortableHeader = (label: string, key: DataTableSortKey) => {
      const isActive = dataTableSort.key === key;
      const indicator = isActive ? (dataTableSort.direction === 'asc' ? '▲' : '▼') : '↕';
      return (
        <button
          type="button"
          onClick={() => handleDataTableSort(key)}
          className="inline-flex items-center gap-1 text-left hover:text-[var(--ink)]"
          title={`Ordenar por ${label.toLowerCase()}`}
        >
          <span>{label}</span>
          <span aria-hidden="true" className="text-[10px]">{indicator}</span>
        </button>
      );
    };
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              <th className="px-3 py-2">{renderSortableHeader('Plan', 'plan')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Duracion', 'duration')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Esperado', 'expected')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Ratio', 'ratio')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Completado', 'completed')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Trabajador', 'worker')}</th>
              <th className="px-3 py-2">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={`${row.plan_id}-${row.task_definition_id || 'panel'}-${row.completed_at || row.worker_name || ''}`}
                className="border-b border-black/5 text-[var(--ink)]"
              >
                <td className="px-3 py-2">
                  {row.house_identifier || '-'}
                  {row.module_number ? ` / Modulo ${row.module_number}` : ''}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="inline-flex cursor-help items-center rounded-sm border-b border-dotted border-black/30 text-left hover:border-black/60 focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.3)]"
                    onMouseEnter={(event) => openDurationTimelinePreview(row, event)}
                    onMouseLeave={scheduleDurationTimelineHide}
                    onFocus={(event) => openDurationTimelinePreview(row, event)}
                    onBlur={scheduleDurationTimelineHide}
                    title="Ver linea de tiempo de la duracion"
                  >
                    {formatMinutesWithUnit(row.duration_minutes)}
                  </button>
                </td>
                <td className="px-3 py-2">{formatMinutesWithUnit(row.expected_minutes)}</td>
                <td className="px-3 py-2">{formatRatio((row as AnalysisPoint & { ratio?: number | null }).ratio ?? null)}</td>
                <td className="px-3 py-2">{formatDateTimeInAppTimezone(row.completed_at)}</td>
                <td className="px-3 py-2">{row.worker_name || '-'}</td>
                <td className="px-3 py-2">
                  {displayAnalysisData?.mode === 'panel' || displayAnalysisData?.mode === 'module' ? (
                    row.task_breakdown && row.task_breakdown.length ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-[var(--ink-muted)]">Ver tareas</summary>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-[var(--ink)]">
                          {row.task_breakdown.map((task) => (
                            <li
                              key={`${row.plan_id}-${task.task_definition_id ?? task.task_name}-${task.completed_at ?? ''}`}
                              title={buildTaskBreakdownTooltip(task)}
                              className="cursor-help"
                            >
                              <strong>{task.task_name || task.task_definition_id}</strong>
                              {` - ${formatMinutesWithUnit(task.duration_minutes)}`}
                              {task.expected_minutes !== null && task.expected_minutes !== undefined
                                ? ` / Esperado ${formatMinutesWithUnit(task.expected_minutes)}`
                                : ''}
                              {task.worker_name ? ` - ${task.worker_name}` : ''}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      '-'
                    )
                  ) : (
                    row.task_name || '-'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderTaskSummaryTable = () => {
    if (!taskSummaryRows.length) {
      return (
        <div className="text-sm text-[var(--ink-muted)]">
          No se encontraron tareas para la estacion y filtros actuales.
        </div>
      );
    }

    const sortedRows = [...taskSummaryRows].sort((a, b) => {
      const comparison = compareTaskSummaryBySort(a, b, taskSummarySort.key);
      return taskSummarySort.direction === 'asc' ? comparison : -comparison;
    });

    const renderSortableHeader = (label: string, key: TaskSummarySortKey, tooltip?: string) => {
      const isActive = taskSummarySort.key === key;
      const indicator = isActive ? (taskSummarySort.direction === 'asc' ? '▲' : '▼') : '↕';
      const titleText = tooltip
        ? `${tooltip}\nClick para ordenar por ${label.toLowerCase()}.`
        : `Ordenar por ${label.toLowerCase()}`;
      return (
        <button
          type="button"
          onClick={() => handleTaskSummarySort(key)}
          className="inline-flex items-center gap-1 text-left hover:text-[var(--ink)]"
          title={titleText}
        >
          <span>{label}</span>
          <span aria-hidden="true" className="text-[10px]">{indicator}</span>
        </button>
      );
    };

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              <th className="px-3 py-2">{renderSortableHeader('Tarea', 'task')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Muestras', 'samples')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Prom. real', 'avgDuration')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Prom. esperado', 'avgExpected')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Prom. ratio', 'avgRatio')}</th>
              <th className="px-3 py-2">
                {renderSortableHeader(
                  'Trend score',
                  'trendScore',
                  'Score de tendencia: media(log(real/esperado)) dividida por su error estandar. Negativo=mas rapido, positivo=mas lento. Magnitud alta=senal mas consistente. N<3: N/A.',
                )}
              </th>
              <th className="px-3 py-2">{renderSortableHeader('Min', 'minDuration')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Max', 'maxDuration')}</th>
              <th className="px-3 py-2">{renderSortableHeader('Ultimo registro', 'lastCompleted')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const ratioShadeStyle = getRatioBackgroundStyle(
                row.average_ratio,
                effectiveMinMultiplier,
                effectiveMaxMultiplier,
              );
              const trendStyle = getTrendScoreStyle(row.trend_score);
              const trendLabel = row.ratio_sample_count >= 3
                ? `${getTrendStrengthLabel(row.trend_score)} · n=${row.ratio_sample_count}`
                : `n=${row.ratio_sample_count}`;
              return (
                <tr key={row.key} className="border-b border-black/5 text-[var(--ink)]">
                  <td className="px-3 py-2">
                    {row.task_name}
                    {row.task_definition_id != null ? (
                      <span className="ml-2 text-xs text-[var(--ink-muted)]">{`#${row.task_definition_id}`}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{row.sample_count}</td>
                  <td className="px-3 py-2" style={ratioShadeStyle}>{formatMinutesWithUnit(row.average_duration)}</td>
                  <td className="px-3 py-2">{formatMinutesWithUnit(row.average_expected)}</td>
                  <td className="px-3 py-2 font-semibold" style={ratioShadeStyle}>{formatRatio(row.average_ratio)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span style={trendStyle}>{row.trend_score == null ? 'N/A' : formatSignedNumber(row.trend_score, 2)}</span>
                      <span className="text-[10px] text-[var(--ink-muted)]">{trendLabel}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">{formatMinutesWithUnit(row.min_duration)}</td>
                  <td className="px-3 py-2">{formatMinutesWithUnit(row.max_duration)}</td>
                  <td className="px-3 py-2">{formatDateTimeInAppTimezone(row.last_completed_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderNormalizedHistogram = () => {
    const { bins, maxCount, binSize: size, maxValue } = normalizedHistogram;
    if (!bins.length || !maxCount) {
      return (
        <div className="text-sm text-[var(--ink-muted)]">
          No hay datos suficientes para la distribucion.
        </div>
      );
    }
    const chartHeight = 240;
    const margin = { top: 16, right: 16, bottom: 56, left: 56 };
    const chartWidth = Math.max(bins.length, 1) * 56;
    const svgWidth = chartWidth + margin.left + margin.right;
    const svgHeight = chartHeight + margin.top + margin.bottom;
    const valuePerPixel = maxValue > 0 ? maxValue / chartWidth : 1;
    const barFullWidth = size / valuePerPixel;
    const barWidth = barFullWidth * 0.72;
    const gap = (barFullWidth - barWidth) / 2;
    const axisBaseY = margin.top + chartHeight;
    const labelDigits = size < 1 ? 2 : size < 10 ? 1 : 0;

    return (
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <svg width={svgWidth} height={svgHeight} role="img" aria-label="Distribucion de tiempos normalizados">
            <line
              x1={margin.left}
              y1={axisBaseY}
              x2={margin.left + chartWidth}
              y2={axisBaseY}
              stroke="#374151"
              strokeWidth={1}
            />
            <line x1={margin.left} y1={margin.top} x2={margin.left} y2={axisBaseY} stroke="#374151" />
            {bins.map((bin) => {
              const barHeight = (bin.count / maxCount) * chartHeight;
              const x = margin.left + bin.index * barFullWidth + gap;
              const barTopY = axisBaseY - barHeight;
              const previewItems = bin.items.slice(0, 6);
              const tooltipLines = [
                `Rango: ${bin.from.toFixed(labelDigits)}-${bin.to.toFixed(labelDigits)} ${normalizedMetricUnit}`,
                `Muestras: ${bin.count}`,
                ...previewItems.map(
                  (item) => {
                    const measureValue = normalizedMetric === 'area' ? item.panel_area : item.panel_length_m;
                    const measureUnit = normalizedMetric === 'area' ? 'm2' : 'm';
                    return `${item.panel_label} / ${item.house_type_name} - ${formatMinutesWithUnit(
                      item.actual_minutes,
                    )} - ${formatMeasure(measureValue, measureUnit)} - ${formatMinutesPerUnit(
                      item.normalized_minutes,
                      normalizedMetricUnit,
                    )}`;
                  },
                ),
              ];
              if (bin.items.length > previewItems.length) {
                tooltipLines.push(`+${bin.items.length - previewItems.length} mas`);
              }
              const tooltip = tooltipLines.join('\n');
              return (
                <g key={bin.index}>
                  <title>{tooltip}</title>
                  <rect
                    x={x}
                    y={barTopY}
                    width={barWidth}
                    height={barHeight}
                    fill="#3b82f6"
                    aria-label={tooltip}
                  />
                  <text x={x + barWidth / 2} y={axisBaseY + 16} textAnchor="middle" fontSize="10" fill="#4b5563">
                    {`${bin.from.toFixed(labelDigits)}-${bin.to.toFixed(labelDigits)}`}
                  </text>
                  <text x={x + barWidth / 2} y={barTopY - 6} textAnchor="middle" fontSize="11" fill="#111827">
                    {bin.count}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <p className="text-xs text-[var(--ink-muted)]">
          Distribucion de {normalizedMetricLabel.toLowerCase()} por panel completado.
        </p>
      </div>
    );
  };

  const renderNormalizedScatter = () => {
    if (!normalizedReport.rows.length) {
      return <div className="text-sm text-[var(--ink-muted)]">No hay paneles para comparar con los filtros actuales.</div>;
    }
    const points = normalizedReport.rows
      .map((row) => {
        const measure = normalizedMetric === 'area' ? row.panel_area : row.panel_length_m;
        return { row, measure };
      })
      .filter((item) => Number.isFinite(item.measure) && item.measure > 0 && item.row.actual_minutes > 0);
    if (!points.length) {
      return (
        <div className="text-sm text-[var(--ink-muted)]">
          No hay datos suficientes para la dispersion.
        </div>
      );
    }
    const maxMeasure = Math.max(...points.map((item) => item.measure));
    const maxActualMinutesBase = Math.max(...points.map((item) => item.row.actual_minutes));
    if (!(maxMeasure > 0) || !(maxActualMinutesBase > 0)) {
      return (
        <div className="text-sm text-[var(--ink-muted)]">
          No hay datos suficientes para la dispersion.
        </div>
      );
    }
    const chartHeight = 280;
    const chartWidth = 720;
    const margin = { top: 16, right: 24, bottom: 64, left: 64 };
    const svgWidth = chartWidth + margin.left + margin.right;
    const svgHeight = chartHeight + margin.top + margin.bottom;
    const axisBaseY = margin.top + chartHeight;
    const measureUnit = normalizedMetric === 'area' ? 'm2' : 'm';
    const measureLabel = normalizedMetric === 'area' ? 'Area' : 'Largo';
    const regressionSamples: RegressionSample[] = points.map((item) => ({
      x: item.measure,
      y: item.row.actual_minutes,
    }));
    const showRegression = showNormalizedRegression;
    const regressionResult = showRegression ? calculateLinearRegression(regressionSamples) : null;
    const maxRegressionMinutes = regressionResult
      ? Math.max(
          regressionResult.startPredictedY,
          regressionResult.endPredictedY,
          ...(regressionResult.confidenceBand || []).map((point) => point.upperY),
        )
      : 0;
    const maxMinutesForAxis = Math.max(maxActualMinutesBase, maxRegressionMinutes);
    if (!(maxMinutesForAxis > 0)) {
      return (
        <div className="text-sm text-[var(--ink-muted)]">
          No hay datos suficientes para la dispersion.
        </div>
      );
    }
    const toXPosition = (measureValue: number) => margin.left + (measureValue / maxMeasure) * chartWidth;
    const toYPosition = (minutesValue: number) =>
      margin.top + chartHeight - (minutesValue / maxMinutesForAxis) * chartHeight;
    const clampToChartArea = (coordinate: number) =>
      Math.min(axisBaseY, Math.max(margin.top, Number.isFinite(coordinate) ? coordinate : axisBaseY));
    const averageByMeasure = Array.from(
      points
        .reduce((accumulator, item) => {
          const key = item.measure.toFixed(3);
          const current = accumulator.get(key);
          if (current) {
            current.totalMinutes += item.row.actual_minutes;
            current.count += 1;
          } else {
            accumulator.set(key, {
              measure: item.measure,
              totalMinutes: item.row.actual_minutes,
              count: 1,
            });
          }
          return accumulator;
        }, new Map<string, { measure: number; totalMinutes: number; count: number }>())
        .values(),
    )
      .map((entry) => ({
        measure: entry.measure,
        count: entry.count,
        averageMinutes: entry.totalMinutes / entry.count,
      }))
      .sort((a, b) => a.measure - b.measure);
    const showRawPoints = normalizedScatterDisplay === 'all';
    const regressionLine = regressionResult && regressionResult.maxX > regressionResult.minX
      ? {
          startX: toXPosition(regressionResult.minX),
          endX: toXPosition(regressionResult.maxX),
          startY: clampToChartArea(toYPosition(regressionResult.startPredictedY)),
          endY: clampToChartArea(toYPosition(regressionResult.endPredictedY)),
        }
      : null;
    const regressionBandPath = regressionResult?.confidenceBand && regressionResult.confidenceBand.length > 1
      ? (() => {
          const upper = regressionResult.confidenceBand.map((point) =>
            `${toXPosition(point.x)},${clampToChartArea(toYPosition(point.upperY))}`
          );
          const lower = [...regressionResult.confidenceBand]
            .reverse()
            .map((point) => `${toXPosition(point.x)},${clampToChartArea(toYPosition(point.lowerY))}`);
          return `M ${upper.join(' L ')} L ${lower.join(' L ')} Z`;
        })()
      : null;

    return (
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <svg width={svgWidth} height={svgHeight} role="img" aria-label="Dispersion tiempo vs medida">
            <line
              x1={margin.left}
              y1={axisBaseY}
              x2={margin.left + chartWidth}
              y2={axisBaseY}
              stroke="#374151"
              strokeWidth={1}
            />
            <line x1={margin.left} y1={margin.top} x2={margin.left} y2={axisBaseY} stroke="#374151" />
            {showRegression && regressionBandPath && (
              <path d={regressionBandPath} fill="rgba(185, 28, 28, 0.14)" stroke="none">
                <title>Banda de confianza al 95% para la media estimada.</title>
              </path>
            )}
            {showRawPoints && points.map((item, index) => {
              const xPosition = toXPosition(item.measure);
              const yPosition = toYPosition(item.row.actual_minutes);
              const tooltip = [
                `${item.row.panel_label} / ${item.row.house_type_name}`,
                `Grupo: ${item.row.panel_group}`,
                `Medida: ${formatMeasure(item.measure, measureUnit)}`,
                `Tiempo: ${formatMinutesWithUnit(item.row.actual_minutes)}`,
                `Normalizado: ${formatMinutesPerUnit(item.row.normalized_minutes, normalizedMetricUnit)}`,
              ].join('\n');
              return (
                <circle
                  key={`${item.row.id}-${index}`}
                  cx={xPosition}
                  cy={yPosition}
                  r={3}
                  fill="rgba(59,130,246,0.45)"
                >
                  <title>{tooltip}</title>
                </circle>
              );
            })}
            {averageByMeasure.map((entry, index) => {
              const xPosition = toXPosition(entry.measure);
              const yPosition = toYPosition(entry.averageMinutes);
              const tooltip = [
                `Promedio por medida: ${formatMeasure(entry.measure, measureUnit)}`,
                `Muestras: ${entry.count}`,
                `Tiempo promedio: ${formatMinutesWithUnit(entry.averageMinutes)}`,
              ].join('\n');
              return (
                <g key={`avg-${entry.measure}-${index}`}>
                  <title>{tooltip}</title>
                  <line
                    x1={xPosition - 5}
                    y1={yPosition - 5}
                    x2={xPosition + 5}
                    y2={yPosition + 5}
                    stroke="rgba(220, 38, 38, 0.55)"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                  <line
                    x1={xPosition - 5}
                    y1={yPosition + 5}
                    x2={xPosition + 5}
                    y2={yPosition - 5}
                    stroke="rgba(220, 38, 38, 0.55)"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
            {showRegression && regressionLine && regressionResult && (
              <line
                x1={regressionLine.startX}
                y1={regressionLine.startY}
                x2={regressionLine.endX}
                y2={regressionLine.endY}
                stroke="rgba(185, 28, 28, 0.82)"
                strokeWidth={2}
                strokeDasharray="6 5"
              >
                <title>
                  {`Regresion lineal - pendiente: ${formatRegressionIndicator(regressionResult.slope)} min/${measureUnit}, intercepto: ${formatRegressionIndicator(regressionResult.intercept)} min, R2: ${formatRegressionIndicator(regressionResult.rSquared, 4)}`}
                </title>
              </line>
            )}
            <text x={margin.left} y={svgHeight - 18} fontSize="11" fill="#4b5563">
              {`Medida (${measureUnit})`}
            </text>
            <text
              x={16}
              y={margin.top}
              fontSize="11"
              fill="#4b5563"
              transform={`rotate(-90 16 ${margin.top})`}
            >
              Tiempo (min)
            </text>
          </svg>
        </div>
        <p className="text-xs text-[var(--ink-muted)]">
          Eje X: {measureUnit}. Eje Y: tiempo de estacion (min).
        </p>
        {!showRawPoints && (
          <p className="text-xs text-[var(--ink-muted)]">Mostrando solo promedios por medida.</p>
        )}
        <p className="text-xs text-[var(--ink-muted)]">Cruces rojas: promedio de tiempo por cada medida unica.</p>
        {showRegression && regressionBandPath && (
          <p className="text-xs text-[var(--ink-muted)]">Franja roja: banda de confianza del 95%.</p>
        )}
        {showRegression && (
          <div className="rounded-xl border border-black/10 bg-white/80 px-4 py-3 text-sm text-[var(--ink)]">
            {!regressionResult ? (
              <p className="text-xs text-[var(--ink-muted)]">
                Se necesitan al menos dos paneles con medida y tiempo validos para calcular la regresion.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  {`Regresion tiempo vs ${measureLabel.toLowerCase()}`}
                </p>
                <p className="text-xs text-[var(--ink)]">
                  {`Tiempo (min) = ${formatRegressionIndicator(regressionResult.slope)} * ${measureLabel} (${measureUnit}) + ${formatRegressionIndicator(regressionResult.intercept)}`}
                </p>
                <div className="grid gap-2 text-xs text-[var(--ink-muted)] md:grid-cols-2 xl:grid-cols-4">
                  <span>
                    <strong>Muestras:</strong> {regressionResult.sampleCount}
                  </span>
                  <span>
                    <strong>R2:</strong> {formatRegressionIndicator(regressionResult.rSquared, 4)}
                  </span>
                  <span>
                    <strong>R2 ajustado:</strong> {formatRegressionIndicator(regressionResult.adjustedRSquared, 4)}
                  </span>
                  <span>
                    <strong>Correlacion (r):</strong> {formatRegressionIndicator(regressionResult.correlation, 4)}
                  </span>
                  <span>
                    <strong>RMSE:</strong> {formatRegressionIndicator(regressionResult.rmse)} min
                  </span>
                  <span>
                    <strong>MAE:</strong> {formatRegressionIndicator(regressionResult.mae)} min
                  </span>
                  <span>
                    <strong>Promedio medida:</strong> {formatRegressionIndicator(regressionResult.meanX)} {measureUnit}
                  </span>
                  <span>
                    <strong>Promedio tiempo:</strong> {formatRegressionIndicator(regressionResult.meanY)} min
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-black/5 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Filtro principal</p>
            <h1 className="font-display text-xl text-[var(--ink)]">Analisis de tiempos de tareas</h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              {activeTab === 'normalized'
                ? 'Compara tiempos normalizados por area o largo entre paneles dentro de una misma estacion.'
                : activeTab === 'task-summary'
                  ? 'Resume tareas por estacion con promedios de tiempo real, esperado y ratio para comparar desempeno.'
                  : analysisScope === 'panel'
                    ? 'Combina tipo de casa, panel y estacion para comparar duraciones reales contra lo esperado.'
                    : 'Combina tipo de casa, modulo y estacion para comparar duraciones reales contra lo esperado.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)]"
              onClick={activeTab === 'normalized' ? resetNormalizedFilters : resetFilters}
            >
              <RefreshCcw className="h-4 w-4" />
              Restablecer filtros
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {[
            { key: 'panel', label: 'Tiempo Especifico' },
            { key: 'task-summary', label: 'Tareas por estacion' },
            { key: 'normalized', label: 'Tiempo normalizado' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key as 'panel' | 'task-summary' | 'normalized')}
              className={
                activeTab === tab.key
                  ? 'rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white'
                  : 'rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]'
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {(activeTab === 'panel' || activeTab === 'task-summary') && (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Tipo de casa
            <select
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              value={selectedHouseTypeId}
              onChange={(event) => {
                const value = event.target.value;
                setSelectedHouseTypeId(value);
                setSelectedPanelId('');
                setSelectedModuleNumber('');
                setSelectedTaskId('');
                setSelectedStationId('');
                setSelectedWorkerId('');
                setAnalysisData(null);
              }}
            >
              <option value="">Seleccione...</option>
              {houseTypes.map((houseType) => (
                <option key={houseType.id} value={houseType.id}>
                  {houseType.name || `Tipo ${houseType.id}`}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Alcance
            <select
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              value={analysisScope}
              onChange={(event) => {
                setAnalysisScope(event.target.value as AnalysisScope);
                setSelectedTaskId('');
                setSelectedStationId('');
                setSelectedWorkerId('');
                setAnalysisData(null);
              }}
            >
              <option value="panel">Panel</option>
              <option value="module">Modulo</option>
            </select>
          </label>

          {analysisScope === 'panel' ? (
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Panel
              <select
                className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                value={effectiveSelectedPanelId}
                onChange={(event) => {
                  setSelectedPanelId(event.target.value);
                  setSelectedTaskId('');
                  setSelectedWorkerId('');
                  setAnalysisData(null);
                }}
                disabled={!selectedHouseTypeId || panelsLoading}
              >
                <option value="">Seleccione...</option>
                {panelsForHouse.map((panel) => (
                  <option key={panel.id} value={panel.id}>
                    {panelLabel(panel)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Modulo
              <select
                className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                value={effectiveSelectedModuleNumber}
                onChange={(event) => {
                  setSelectedModuleNumber(event.target.value);
                  setSelectedTaskId('');
                  setSelectedWorkerId('');
                  setAnalysisData(null);
                }}
                disabled={!selectedHouseTypeId || !modulesForHouse.length}
              >
                <option value="">Seleccione...</option>
                {modulesForHouse.map((moduleNumber) => (
                  <option key={moduleNumber} value={moduleNumber}>
                    {`Modulo ${moduleNumber}`}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Estacion
            <select
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              value={selectedStationId}
              onChange={(event) => {
                const value = event.target.value;
                setSelectedStationId(value);
                setSelectedTaskId('');
                setSelectedWorkerId('');
                setAnalysisData(null);
              }}
            >
              <option value="">
                {stationsLoading
                  ? 'Cargando...'
                  : analysisScope === 'module'
                    ? 'Seleccione secuencia...'
                    : 'Seleccione...'}
              </option>
              {analysisScope === 'module'
                ? moduleStationOptions.map((option) => (
                    <option key={option.stationId} value={option.stationId}>
                      {option.label}
                    </option>
                  ))
                : stationsForScope.map((station) => (
                    <option key={station.id} value={station.id}>
                      {stationLabel(station)}
                    </option>
                  ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Tarea (opcional)
            <select
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              value={effectiveSelectedTaskId}
              onChange={(event) => {
                setSelectedTaskId(event.target.value);
                setAnalysisData(null);
              }}
              disabled={analysisScope === 'panel' ? !effectiveSelectedPanelId : !effectiveSelectedModuleNumber}
            >
              <option value="">
                {analysisScope === 'panel' ? 'Todas las tareas del panel' : 'Todas las tareas del modulo'}
              </option>
              {filteredTasksForSelection.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Trabajador (opcional)
            <select
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              value={selectedWorkerId}
              onChange={(event) => {
                setSelectedWorkerId(event.target.value);
                setAnalysisData(null);
              }}
              disabled={!panelSelectionReady || workersForSelectionLoading}
            >
              <option value="">
                {workersForSelectionLoading ? 'Cargando...' : 'Todos'}
              </option>
              {workersForSelection.map((worker) => (
                <option key={worker.worker_id} value={worker.worker_id}>
                  {worker.worker_name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Desde (opcional)
            <input
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              type="date"
              value={fromDate}
              onChange={(event) => {
                setFromDate(event.target.value);
                setAnalysisData(null);
              }}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Hasta (opcional)
            <input
              className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
              type="date"
              value={toDate}
              onChange={(event) => {
                setToDate(event.target.value);
                setAnalysisData(null);
              }}
            />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            <Sliders className="h-4 w-4" />
            {activeTab === 'panel' ? 'Ajustes del histograma' : 'Filtro por esperado'}
          </div>
          <div className={`grid flex-1 gap-4 ${activeTab === 'panel' ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
            {activeTab === 'panel' && (
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Tamano de barra (min)
                <input
                  className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                  type="number"
                  min="1"
                  step="1"
                  value={binSize}
                  onChange={(event) => setBinSize(event.target.value)}
                />
              </label>
            )}

            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Min. multiplicador
              <input
                className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                type="number"
                step="0.1"
                value={minMultiplier}
                onChange={(event) => setMinMultiplier(event.target.value)}
              />
            </label>

            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              Max. multiplicador
              <input
                className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                type="number"
                step="0.1"
                value={maxMultiplier}
                onChange={(event) => setMaxMultiplier(event.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-[var(--ink)]">
            <input
              type="checkbox"
              checked={includeWithoutExpected}
              onChange={(event) => setIncludeWithoutExpected(event.target.checked)}
            />
            <span>Incluir muestras sin tiempo esperado</span>
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-[var(--ink)]">
            <input
              type="checkbox"
              checked={includeCrossStationExecutions}
              onChange={(event) => {
                setIncludeCrossStationExecutions(event.target.checked);
                setSelectedWorkerId('');
                setAnalysisData(null);
              }}
              disabled={!effectiveSelectedTaskId}
            />
            <span>Incluir ejecuciones en otras estaciones (con tarea seleccionada)</span>
          </label>
        </div>

        {activeTab === 'panel' && (
          <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/60 p-4">
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              <FlaskConical className="h-4 w-4" />
              Hipotesis de filtrado
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-4">
              {hypothesisEditorOpen ? (
                <>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    Campo
                    <select
                      className="mt-2 w-full min-w-[160px] rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm"
                      value={hypothesisForm.field}
                      onChange={handleHypothesisFieldChange}
                    >
                      {HYPOTHESIS_FIELD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    Condicion
                    <select
                      className="mt-2 w-full min-w-[120px] rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm"
                      value={hypothesisForm.operator}
                      onChange={handleHypothesisOperatorChange}
                    >
                      {getHypothesisFieldConfig(hypothesisForm.field).operators.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {hypothesisForm.field === 'date' ? (
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                      Fecha
                      <input
                        className="mt-2 w-full min-w-[180px] rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm"
                        type="date"
                        value={hypothesisForm.value}
                        onChange={(event) => handleHypothesisValueChange(event.target.value)}
                      />
                    </label>
                  ) : (
                    <div className="min-w-[220px]">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                        Trabajador
                        <select
                          className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm"
                          value={hypothesisForm.value}
                          onChange={(event) => handleHypothesisValueChange(event.target.value)}
                          disabled={!workerOptionsForHypothesis.length}
                        >
                          <option value="">Seleccione...</option>
                          {workerOptionsForHypothesis.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!workerOptionsForHypothesis.length && (
                        <p className="mt-2 text-xs text-[var(--ink-muted)]">
                          No hay trabajadores registrados con los filtros actuales.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white"
                      onClick={handleApplyHypothesis}
                      disabled={
                        (hypothesisForm.field === 'worker' && !hypothesisForm.value) ||
                        (hypothesisForm.field === 'worker' && !workerOptionsForHypothesis.length) ||
                        (hypothesisForm.field === 'date' && !hypothesisForm.value)
                      }
                    >
                      Aplicar
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]"
                      onClick={handleCancelHypothesis}
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              ) : activeHypothesisConfig ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-sm text-[var(--ink)]">
                    <strong>Hipotesis activa:</strong> {hypothesis.description || '-'}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)]"
                      onClick={openHypothesisEditor}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full bg-red-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-red-600"
                      onClick={handleRemoveHypothesis}
                    >
                      Quitar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink)]"
                  onClick={openHypothesisEditor}
                >
                  Agregar hipotesis
                </button>
              )}
            </div>
            {hypothesisError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {hypothesisError}
              </div>
            )}
          </div>
        )}

        {panelsLoading && <p className="mt-4 text-sm text-[var(--ink-muted)]">Cargando paneles...</p>}
        {stationsLoading && <p className="mt-2 text-sm text-[var(--ink-muted)]">Cargando estaciones...</p>}
        {panelsError && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4" />
            {panelsError}
          </div>
        )}
            {!panelsError && stationsError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                <AlertTriangle className="h-4 w-4" />
                {stationsError}
              </div>
            )}
          </>
        )}

        {activeTab === 'normalized' && (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Tipo de casa
                <div className="relative mt-2" ref={houseTypeDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setHouseTypeDropdownOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-left text-sm text-[var(--ink)] shadow-sm"
                  >
                    <span className="truncate">{normalizedHouseTypeLabel}</span>
                    <ChevronDown
                      className={`h-4 w-4 text-[var(--ink-muted)] transition ${
                        houseTypeDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {houseTypeDropdownOpen && (
                    <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-lg">
                      <div className="border-b border-black/5 px-4 py-2 text-sm">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!normalizedHouseTypeIds.length}
                            onChange={() => setNormalizedHouseTypeIds([])}
                          />
                          <span className="text-[var(--ink)]">Todos los tipos de casa</span>
                        </label>
                      </div>
                      {houseTypes.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-[var(--ink-muted)]">
                          No hay tipos de casa disponibles.
                        </div>
                      ) : (
                        <div className="max-h-56 overflow-auto p-3 text-sm">
                          <div className="flex flex-col gap-2">
                            {houseTypes.map((houseType) => (
                              <label key={houseType.id} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={normalizedHouseTypeIds.includes(houseType.id)}
                                  onChange={() => toggleNormalizedHouseType(houseType.id)}
                                />
                                <span className="text-[var(--ink)]">
                                  {houseType.name || `Tipo ${houseType.id}`}
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

              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Grupo de panel
                <div className="relative mt-2" ref={panelTypeDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setPanelTypeDropdownOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-left text-sm text-[var(--ink)] shadow-sm"
                  >
                    <span className="truncate">{normalizedPanelTypeLabel}</span>
                    <ChevronDown
                      className={`h-4 w-4 text-[var(--ink-muted)] transition ${
                        panelTypeDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {panelTypeDropdownOpen && (
                    <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-lg">
                      <div className="border-b border-black/5 px-4 py-2 text-sm">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!normalizedPanelGroups.length}
                            onChange={() => setNormalizedPanelGroups([])}
                          />
                          <span className="text-[var(--ink)]">Todos los grupos</span>
                        </label>
                      </div>
                      {panelGroupOptions.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-[var(--ink-muted)]">
                          No hay grupos disponibles.
                        </div>
                      ) : (
                        <div className="max-h-56 overflow-auto p-3 text-sm">
                          <div className="flex flex-col gap-2">
                            {panelGroupOptions.map((panel) => (
                              <label key={panel.id} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={normalizedPanelGroups.includes(panel.id)}
                                  onChange={() => toggleNormalizedPanelGroup(panel.id)}
                                />
                                <span className="text-[var(--ink)]">
                                  {panel.label}
                                  <span className="text-[var(--ink-muted)]"> ({panel.count})</span>
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

              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Estacion
                <select
                  className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                  value={normalizedStationId}
                  onChange={(event) => setNormalizedStationId(event.target.value)}
                >
                  <option value="">{stationsLoading ? 'Cargando...' : 'Seleccione...'}</option>
                  {stations.map((station) => (
                    <option key={station.id} value={station.id}>
                      {stationLabel(station)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Metrica
                <select
                  className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                  value={normalizedMetric}
                  onChange={(event) => setNormalizedMetric(event.target.value as NormalizedMetric)}
                >
                  <option value="linear">Tiempo por metro lineal</option>
                  <option value="area">Tiempo por area</option>
                </select>
              </label>

              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Desde (opcional)
                <input
                  className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                  type="date"
                  value={normalizedFromDate}
                  onChange={(event) => setNormalizedFromDate(event.target.value)}
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Hasta (opcional)
                <input
                  className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                  type="date"
                  value={normalizedToDate}
                  onChange={(event) => setNormalizedToDate(event.target.value)}
                />
              </label>
            </div>

            <div className="mt-6 flex flex-wrap gap-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                <Sliders className="h-4 w-4" />
                Rango de tiempo normalizado
              </div>
              <div className="grid flex-1 gap-4 md:grid-cols-3">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Min. tiempo ({normalizedMetricUnit})
                  <input
                    className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="5"
                    value={normalizedMinMinutes}
                    onChange={(event) => setNormalizedMinMinutes(event.target.value)}
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Max. tiempo ({normalizedMetricUnit})
                  <input
                    className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="20"
                    value={normalizedMaxMinutes}
                    onChange={(event) => setNormalizedMaxMinutes(event.target.value)}
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  Tamano de bin ({normalizedMetricUnit})
                  <input
                    className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgba(242,98,65,0.2)]"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder={String(DEFAULT_NORMALIZED_BIN_SIZE)}
                    value={normalizedBinSize}
                    onChange={(event) => setNormalizedBinSize(event.target.value)}
                  />
                </label>
              </div>
            </div>

            <p className="mt-3 text-xs text-[var(--ink-muted)]">
              Solo se consideran paneles con area y largo definidos (mayores a 0). El rango filtra por{' '}
              {normalizedMetricUnit}. El bin aplica solo al histograma.
            </p>

            {panelsLoading && <p className="mt-4 text-sm text-[var(--ink-muted)]">Cargando paneles...</p>}
            {stationsLoading && <p className="mt-2 text-sm text-[var(--ink-muted)]">Cargando estaciones...</p>}
            {panelsError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                <AlertTriangle className="h-4 w-4" />
                {panelsError}
              </div>
            )}
            {!panelsError && stationsError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                <AlertTriangle className="h-4 w-4" />
                {stationsError}
              </div>
            )}
          </>
        )}
      </section>

      {(activeTab === 'panel' || activeTab === 'task-summary') && (
        <>
          {displayError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {displayError}
            </div>
          )}

          {displayLoading && !displayError && (
            <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm text-[var(--ink-muted)]">
              Actualizando analisis...
            </div>
          )}

          {displayAnalysisData && (
            activeTab === 'panel' ? (
              <section className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Total</p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                      {displayAnalysisData.data_points?.length || 0}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Incluidas</p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{analysisSummary.included.length}</p>
                  </div>
                  <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Excluidas (ratio)</p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{analysisSummary.excluded.length}</p>
                  </div>
                  <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                      Excluidas (completitud)
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{strictCompletenessExcludedCount}</p>
                  </div>
                  <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Promedio bruto</p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                      {formatMinutesWithUnit(displayAnalysisData.stats?.average_duration)}
                    </p>
                  </div>
                </div>

                {hypothesis.description && (
                  <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm text-[var(--ink)]">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-2 rounded-full bg-black/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                        <Users className="h-3 w-3" />
                        Hipotesis
                      </span>
                      <span className="font-semibold">{hypothesis.description}</span>
                      {analysisSummary.hypothesisMatches !== null && (
                        <span className="text-sm text-[var(--ink-muted)]">
                          Coinciden: {analysisSummary.hypothesisMatches}
                        </span>
                      )}
                      {analysisSummary.hypothesisMatches !== null && (
                        <span className="text-sm text-[var(--ink-muted)]">
                          No coinciden: {Math.max(analysisSummary.included.length - analysisSummary.hypothesisMatches, 0)}
                        </span>
                      )}
                      {analysisSummary.hypothesisMatchAverage !== null && (
                        <span className="text-sm text-[var(--ink-muted)]">
                          Promedio hipotesis: {formatMinutesWithUnit(analysisSummary.hypothesisMatchAverage)}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    <Filter className="h-4 w-4" />
                    Histograma
                    <button
                      type="button"
                      onClick={() => setShowHistogramMethodologyModal(true)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-black/20 bg-white text-[10px] font-bold normal-case tracking-normal text-[var(--ink-muted)] transition hover:border-black/40 hover:text-[var(--ink)]"
                      title="Como se calcula la duracion"
                      aria-label="Como se calcula la duracion"
                    >
                      i
                    </button>
                  </div>
                  <div className="mt-4">{renderHistogram()}</div>
                </div>

                <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                    Muestras incluidas
                  </h2>
                  <div className="mt-4">
                    {renderDataTable(analysisSummary.included, 'No se encontraron muestras dentro del rango seleccionado.')}
                  </div>
                </div>

                <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                    Muestras excluidas
                  </h2>
                  <div className="mt-4">
                    {renderDataTable(
                      analysisSummary.excluded,
                      'No se excluyeron muestras con los multiplicadores actuales.',
                    )}
                  </div>
                </div>
              </section>
            ) : (
              <section className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Tareas</p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                      {taskSummaryStats.taskCount}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Muestras</p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                      {taskSummaryStats.sampleCount}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm" style={taskSummaryAverageShadeStyle}>
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Promedio real</p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                      {formatMinutesWithUnit(taskSummaryStats.averageDuration)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm" style={taskSummaryAverageShadeStyle}>
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Promedio ratio</p>
                    <span className="mt-2 inline-flex items-center px-1 py-1 text-xl font-semibold text-[var(--ink)]">
                      {formatRatio(taskSummaryStats.averageRatio)}
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                    Resumen por tarea
                  </h2>
                  <div className="mt-4">{renderTaskSummaryTable()}</div>
                  <p className="mt-3 text-xs text-[var(--ink-muted)]">
                    Trend score = media(log(real/esperado)) / (desv_estandar(log(real/esperado)) / sqrt(n)).
                    Valores negativos (verde) tienden a mas rapido que esperado; positivos (rojo), mas lento.
                  </p>
                </div>
              </section>
            )
          )}

          {!displayAnalysisData && !displayLoading && !displayError && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              {analysisScope === 'panel'
                ? 'Seleccione tipo de casa, panel y estacion para ver el analisis.'
                : 'Seleccione tipo de casa, modulo y estacion para ver el analisis.'}
            </div>
          )}
        </>
      )}

      {activeTab === 'normalized' && (
        <>
          {normalizedError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {normalizedError}
            </div>
          )}

          {normalizedLoading && !normalizedError && (
            <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm text-[var(--ink-muted)]">
              Actualizando analisis...
            </div>
          )}

          {!normalizedStationId && !normalizedLoading && !normalizedError && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
              Seleccione una estacion para comparar paneles por {normalizedMetricLabel.toLowerCase()}.
            </div>
          )}

          {normalizedStationId && !normalizedLoading && !normalizedError && (
            <section className="space-y-6">
              <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-3 text-sm text-[var(--ink)]">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full bg-black/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    Estacion
                  </span>
                  <span className="font-semibold">
                    {selectedNormalizedStation ? stationLabel(selectedNormalizedStation) : normalizedStationId}
                  </span>
                  <span className="text-xs text-[var(--ink-muted)]">Metrica: {normalizedMetricLabel}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    Vista
                  </span>
                  {[
                    { key: 'histogram', label: 'Histograma' },
                    { key: 'scatter', label: 'Dispersion' },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setNormalizedView(option.key as 'histogram' | 'scatter')}
                      className={
                        normalizedView === option.key
                          ? 'rounded-full bg-[var(--ink)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white'
                          : 'rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]'
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {normalizedView === 'scatter' && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-xs text-[var(--ink)]">
                      <input
                        type="checkbox"
                        checked={normalizedScatterDisplay === 'all'}
                        onChange={(event) =>
                          setNormalizedScatterDisplay(event.target.checked ? 'all' : 'averages')
                        }
                      />
                      <span>Mostrar puntos individuales</span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-[var(--ink)]">
                      <input
                        type="checkbox"
                        checked={showNormalizedRegression}
                        onChange={(event) => setShowNormalizedRegression(event.target.checked)}
                      />
                      <span>Mostrar regresion lineal + banda 95%</span>
                    </label>
                  </div>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    Candidatos (tipo/grupo)
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                    {normalizedReport.summary.totalMatching}
                  </p>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Incluidos</p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{normalizedReport.summary.included}</p>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Promedio</p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                    {formatMinutesPerUnit(normalizedReport.summary.averageMinutes, normalizedMetricUnit)}
                  </p>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">Muestras</p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                    {normalizedReport.summary.sampleCount}
                  </p>
                </div>
              </div>

              {(normalizedReport.summary.missingMetric > 0 || normalizedReport.summary.missingTime > 0) && (
                <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm text-[var(--ink-muted)]">
                  {normalizedReport.summary.missingMetric > 0 && (
                    <span>Sin area/largo valido: {normalizedReport.summary.missingMetric}. </span>
                  )}
                  {normalizedReport.summary.missingTime > 0 && (
                    <span>Sin tiempo registrado: {normalizedReport.summary.missingTime}.</span>
                  )}
                </div>
              )}

              {(normalizedReport.summary.bestRow || normalizedReport.summary.worstRow) && (
                <div className="rounded-2xl border border-black/5 bg-white/90 px-4 py-3 text-sm text-[var(--ink)]">
                  <div className="flex flex-wrap items-center gap-3">
                    {normalizedReport.summary.bestRow && (
                      <span>
                        <strong>Mas rapido:</strong> {normalizedReport.summary.bestRow.panel_label} (
                        {formatMinutesPerUnit(
                          normalizedReport.summary.bestRow.normalized_minutes,
                          normalizedMetricUnit,
                        )}
                        )
                      </span>
                    )}
                    {normalizedReport.summary.worstRow && (
                      <span>
                        <strong>Mas lento:</strong> {normalizedReport.summary.worstRow.panel_label} (
                        {formatMinutesPerUnit(
                          normalizedReport.summary.worstRow.normalized_minutes,
                          normalizedMetricUnit,
                        )}
                        )
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-sm">
                <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  {normalizedView === 'histogram' ? 'Distribucion' : 'Dispersion'} por panel
                </h2>
                <div className="mt-4">
                  {normalizedView === 'histogram' ? renderNormalizedHistogram() : renderNormalizedScatter()}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {durationTimelinePreview && (
        <div
          className="fixed z-50"
          style={computeDurationTimelineModalStyle(durationTimelinePreview)}
          onMouseEnter={clearDurationTimelineHideTimeout}
          onMouseLeave={scheduleDurationTimelineHide}
        >
          <div className="max-h-[78vh] overflow-auto rounded-2xl border border-black/10 bg-white p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--ink)]">Timeline de duracion</h3>
                <p className="text-xs text-[var(--ink-muted)]">{durationTimelinePreview.title}</p>
              </div>
              <button
                type="button"
                className="rounded-full border border-black/10 px-2 py-1 text-[11px] font-semibold text-[var(--ink-muted)] hover:text-[var(--ink)]"
                onClick={() => setDurationTimelinePreview(null)}
              >
                Cerrar
              </button>
            </div>

            <div className="mt-3 grid gap-2 text-xs text-[var(--ink)] md:grid-cols-2">
              <p><strong>Inicio:</strong> {formatUtcMillisInAppTimezone(durationTimelinePreview.started_ms)}</p>
              <p><strong>Fin:</strong> {formatUtcMillisInAppTimezone(durationTimelinePreview.ended_ms)}</p>
              <p><strong>Duracion estimada:</strong> {formatMinutesWithUnit(durationTimelinePreview.estimated_minutes)}</p>
              <p><strong>Fuera de turno:</strong> {formatMinutesWithUnit(durationTimelinePreview.masked_out_minutes)}</p>
              <p><strong>Pausas contabilizadas:</strong> {formatMinutesWithUnit(durationTimelinePreview.pause_minutes)}</p>
              <p><strong>Duracion cruda:</strong> {formatMinutesWithUnit(durationTimelinePreview.raw_minutes)}</p>
            </div>

            <div className="mt-4 space-y-3">
              {durationTimelinePreview.lanes.map((lane) => {
                const spanMs = Math.max(durationTimelinePreview.ended_ms - durationTimelinePreview.started_ms, 1);
                const laneMinutes = lane.segments.reduce((sum, item) => sum + item.duration_minutes, 0);
                return (
                  <div key={`${durationTimelinePreview.key}-${lane.label}`} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-[var(--ink-muted)]">
                      <span className="font-semibold text-[var(--ink)]">{lane.label}</span>
                      <span>{formatMinutesWithUnit(roundToTwo(laneMinutes))}</span>
                    </div>
                    <div className="relative h-7 overflow-hidden rounded-md border border-black/10 bg-slate-50">
                      {lane.segments.map((segment, index) => {
                        const left = ((segment.started_ms - durationTimelinePreview.started_ms) / spanMs) * 100;
                        const width = Math.max(((segment.ended_ms - segment.started_ms) / spanMs) * 100, 0.6);
                        const meta = TIMELINE_SEGMENT_META[segment.kind];
                        const tooltip = [
                          meta.label,
                          `${formatUtcMillisInAppTimezone(segment.started_ms)} -> ${formatUtcMillisInAppTimezone(segment.ended_ms)}`,
                          `Duracion: ${formatMinutesWithUnit(segment.duration_minutes)}`,
                        ].join('\n');
                        return (
                          <div
                            key={`${lane.label}-${segment.kind}-${segment.started_ms}-${index}`}
                            className="absolute top-0 h-full"
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              backgroundColor: meta.color,
                              opacity: segment.kind.startsWith('masked_') ? 0.75 : 0.95,
                            }}
                            title={tooltip}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between text-[11px] text-[var(--ink-muted)]">
                <span>{formatUtcMillisInAppTimezone(durationTimelinePreview.started_ms)}</span>
                <span>{formatUtcMillisInAppTimezone(durationTimelinePreview.ended_ms)}</span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-[var(--ink-muted)]">
              {(Object.keys(TIMELINE_SEGMENT_META) as TimelineSegmentKind[]).map((kind) => (
                <span key={kind} className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: TIMELINE_SEGMENT_META[kind].color }}
                  />
                  {TIMELINE_SEGMENT_META[kind].label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {showHistogramMethodologyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="Metodologia de calculo de duraciones"
          onClick={() => setShowHistogramMethodologyModal(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-black/10 bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                Como se calculan las duraciones
              </h3>
              <button
                type="button"
                onClick={() => setShowHistogramMethodologyModal(false)}
                className="rounded-full border border-black/10 px-2 py-1 text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm text-[var(--ink)]">
              <p>
                <strong>Unidad base:</strong> minutos.
              </p>
              <p>
                <strong>Modo panel (sin tarea seleccionada):</strong> cada muestra es un panel terminado. La duracion
                del panel se calcula uniendo los intervalos de tiempo de sus tareas y restando pausas.
              </p>
              <p>
                <strong>Modo modulo (sin tarea seleccionada):</strong> cada muestra es un modulo en una casa. La
                duracion del modulo se calcula uniendo los intervalos de tiempo de sus tareas y restando pausas.
              </p>
              <p>
                <strong>Modo tarea (con tarea seleccionada):</strong> cada muestra es una ejecucion de esa tarea.
                No se suman otras tareas.
              </p>
              <p>
                <strong>Pausas:</strong> se descuentan del tiempo activo. El tooltip de "Ver tareas" muestra inicio,
                fin, pausa total y detalle por pausa.
              </p>
              <p>
                <strong>Solapamientos entre tareas:</strong> no se duplican minutos. Se usa tiempo de pared (union de
                intervalos), no suma ciega de duraciones.
              </p>
              <p className="rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2 text-[13px]">
                Ejemplo: Tarea A dura 10 min (00:00-00:10). Tarea B dura 10 min y empieza al minuto 5
                (00:05-00:15). El total del panel es <strong>15 min</strong>, no 20 min, porque hay 5 min de
                traslape.
              </p>
              <p>
                <strong>Incluidas vs excluidas:</strong> el histograma usa solo "Muestras incluidas", definidas por el
                rango [esperado x min multiplicador, esperado x max multiplicador]. En panel/modulo, cada tarea del
                desglose debe quedar dentro del rango para que la muestra entre como incluida. Las demas aparecen en
                "Muestras excluidas".
              </p>
              <p>
                <strong>Comparabilidad estricta:</strong> en panel/modulo solo se consideran muestras que tengan el set
                completo esperado de tareas para la estacion (sin faltantes ni tareas extra).
              </p>
              <p>
                <strong>Sin esperado:</strong> si una muestra no tiene tiempo esperado valido, se incluye o excluye
                segun el switch "Incluir muestras sin tiempo esperado".
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardTasks;
