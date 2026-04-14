import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCcw, Users, Workflow } from 'lucide-react';
import { useAdminHeader } from '../../../layouts/AdminLayoutContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const CECO_MAPPING_STORAGE_KEY = 'lineAttendanceThroughput.cecoSupervisorMappings.v1';
const UNASSIGNED_BUCKET = 'unassigned';
const HIDDEN_CECO_MAPPING_VALUE = 'none';
type CecoMappingValue = number | typeof HIDDEN_CECO_MAPPING_VALUE;

type Coverage = {
  geovictoria_available: boolean;
  geovictoria_active_users: number;
  geovictoria_active_users_matched_locally: number;
  geovictoria_active_users_unmatched_locally: number;
  buk_available: boolean;
  buk_people_indexed: number;
  buk_people_with_cost_center: number;
  active_local_workers: number;
  active_local_geo_linked_workers: number;
  active_local_geo_linked_workers_matched_in_geovictoria: number;
  active_local_geo_linked_workers_matched_in_buk: number;
  active_local_geo_linked_workers_with_supervisor: number;
  active_local_geo_linked_workers_without_supervisor: number;
  active_local_geo_linked_workers_resolved_by_ceco: number;
  active_local_geo_linked_workers_unresolved_after_fallback: number;
  local_supervisors: number;
  local_supervisors_matched_in_geovictoria: number;
  supervisor_cost_center_mappings: number;
};

type SupervisorOption = {
  id: number;
  name: string;
};

type CostCenterSummary = {
  cost_center_code: string;
  cost_center_name: string | null;
  matched_local_worker_count: number;
  direct_supervisor_worker_count: number;
  fallback_candidate_worker_count: number;
};

type WorkerAssignment = {
  worker_id: number;
  worker_name: string;
  geovictoria_identifier: string | null;
  direct_supervisor_id: number | null;
  buk_matched: boolean;
  buk_cost_center_code: string | null;
  buk_cost_center_name: string | null;
};

type WorkerDay = {
  date: string;
  worker_id: number;
  present: boolean;
  productive: boolean;
  task_participation_count: number;
  panel_touch_ids: number[];
};

type DayRow = {
  date: string;
  eligible_local_worker_count: number;
  eligible_supervised_worker_count: number;
  present_worker_count: number;
  present_supervised_worker_count: number;
  present_unassigned_worker_count: number;
  productive_worker_count: number;
  productive_supervised_worker_count: number;
  productive_unassigned_worker_count: number;
  present_productive_overlap_count: number;
  task_participation_count: number;
  completed_task_count: number;
  completed_panel_count: number;
};

type SupervisorSummary = {
  bucket: 'supervisor' | 'unassigned';
  supervisor_id: number | null;
  supervisor_name: string;
  linked_worker_count: number;
  present_worker_days: number;
  productive_worker_days: number;
  present_productive_overlap_days: number;
  unique_present_worker_count: number;
  unique_productive_worker_count: number;
  task_participation_count: number;
  panel_touch_count: number;
};

type SupervisorDay = {
  date: string;
  bucket: 'supervisor' | 'unassigned';
  supervisor_id: number | null;
  supervisor_name: string;
  linked_worker_count: number;
  present_worker_count: number;
  productive_worker_count: number;
  present_productive_overlap_count: number;
  task_participation_count: number;
  panel_touch_count: number;
};

type ResponsePayload = {
  from_date: string;
  to_date: string;
  generated_at: string;
  ceco_mapping_enabled: boolean;
  coverage: Coverage;
  warnings: string[];
  days: DayRow[];
  supervisor_summaries: SupervisorSummary[];
  supervisor_days: SupervisorDay[];
  supervisors: SupervisorOption[];
  buk_cost_centers: CostCenterSummary[];
  worker_assignments: WorkerAssignment[];
  worker_days: WorkerDay[];
};

const WARNING_LABELS: Record<string, string> = {
  geovictoria_roster_unfiltered: 'Roster GeoVictoria global, sin filtro de piso.',
  geovictoria_roster_unavailable: 'GeoVictoria no respondio: se muestran solo datos locales.',
  buk_unavailable: 'BUK no disponible: sin fallback por CECO.',
  local_ceco_mappings_missing: 'BUK respondio, pero aun no hay mappings locales CECO -> supervisor.',
};

const loadStoredCecoMappings = (): Record<string, CecoMappingValue> => {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(CECO_MAPPING_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) =>
          typeof key === 'string' &&
          (typeof value === 'number' || value === HIDDEN_CECO_MAPPING_VALUE),
      ),
    ) as Record<string, CecoMappingValue>;
  } catch {
    return {};
  }
};

const toBucketKey = (supervisorId: number | null | undefined) =>
  supervisorId === null || supervisorId === undefined
    ? UNASSIGNED_BUCKET
    : String(supervisorId);

const formatCostCenterLabel = (
  costCenterCode: string | null | undefined,
  costCenterName?: string | null,
) => {
  const normalizedCode = costCenterCode?.trim() || null;
  const normalizedName = costCenterName?.trim() || null;
  if (normalizedName && normalizedCode && normalizedName !== normalizedCode) {
    return `${normalizedName} (${normalizedCode})`;
  }
  return normalizedName ?? normalizedCode ?? 'Sin CECO detectado';
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

const pad = (value: number) => String(value).padStart(2, '0');

const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const formatNumber = (value: number | null | undefined) =>
  new Intl.NumberFormat('es-CL').format(Number(value ?? 0));

const formatDateLabel = (value: string) => {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
  });
};

const ratioPercent = (value: number, total: number) => {
  if (!Number.isFinite(total) || total <= 0) {
    return '0%';
  }
  return `${Math.round((value / total) * 100)}%`;
};

const MetricCard = ({
  label,
  value,
  tone = 'default',
  detail,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'accent' | 'warning';
  detail?: string;
}) => {
  const toneClasses =
    tone === 'accent'
      ? 'border-[var(--accent-soft)] bg-[var(--accent-soft)]/50'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50/80'
        : 'border-black/5 bg-white/85';
  return (
    <div className={`rounded-2xl border px-4 py-4 shadow-sm ${toneClasses}`}>
      <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">{label}</p>
      <div className="mt-3 text-3xl font-semibold text-[var(--ink)]">{value}</div>
      {detail ? <p className="mt-2 text-sm text-[var(--ink-muted)]">{detail}</p> : null}
    </div>
  );
};

const DashboardLineAttendanceThroughput: React.FC = () => {
  const { setHeader } = useAdminHeader();
  const [fromDate, setFromDate] = useState<string>(() => {
    const end = new Date();
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(end.getDate() - 13);
    return toDateInputValue(start);
  });
  const [toDate, setToDate] = useState<string>(() => {
    const end = new Date();
    end.setDate(end.getDate() - 1);
    return toDateInputValue(end);
  });
  const [cecoSupervisorMap, setCecoSupervisorMap] = useState<Record<string, CecoMappingValue>>(
    () => loadStoredCecoMappings(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<ResponsePayload | null>(null);

  useEffect(() => {
    setHeader({
      title: 'Asistencia y produccion',
      kicker: 'Dashboards',
    });
  }, [setHeader]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        from_date: fromDate,
        to_date: toDate,
      });
      const payload = await apiRequest<ResponsePayload>(
        `/api/line-attendance-throughput/summary?${params.toString()}`,
      );
      setData(payload);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'No se pudo cargar el dashboard.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(
      CECO_MAPPING_STORAGE_KEY,
      JSON.stringify(cecoSupervisorMap),
    );
  }, [cecoSupervisorMap]);

  const effectiveDashboard = useMemo(() => {
    if (!data) {
      return null;
    }

    const supervisorNameById = new Map(data.supervisors.map((item) => [item.id, item.name]));
    const detectedCostCenters = new Set(data.buk_cost_centers.map((item) => item.cost_center_code));
    const sanitizedMap = Object.fromEntries(
      Object.entries(cecoSupervisorMap).filter(
        ([costCenterCode, supervisorId]) =>
          detectedCostCenters.has(costCenterCode) &&
          (supervisorId === HIDDEN_CECO_MAPPING_VALUE ||
            supervisorNameById.has(supervisorId)),
      ),
    ) as Record<string, CecoMappingValue>;

    const explicitlyHiddenCostCenters = new Set(
      Object.entries(sanitizedMap)
        .filter(([, value]) => value === HIDDEN_CECO_MAPPING_VALUE)
        .map(([costCenterCode]) => costCenterCode),
    );
    const includedWorkerAssignments = data.worker_assignments.filter(
      (worker) =>
        !worker.buk_cost_center_code ||
        !explicitlyHiddenCostCenters.has(worker.buk_cost_center_code),
    );
    const includedWorkerIds = new Set(
      includedWorkerAssignments.map((worker) => worker.worker_id),
    );

    const resolvedSupervisorIdByWorkerId = new Map<number, number | null>();
    let resolvedByCeco = 0;
    let unresolvedAfterFallback = 0;

    for (const worker of includedWorkerAssignments) {
      const mappingValue = worker.buk_cost_center_code
        ? sanitizedMap[worker.buk_cost_center_code]
        : undefined;
      const fallbackSupervisorId =
        worker.direct_supervisor_id !== null
          ? worker.direct_supervisor_id
          : typeof mappingValue === 'number'
            ? mappingValue
            : null;
      const resolvedSupervisorId = fallbackSupervisorId ?? null;
      resolvedSupervisorIdByWorkerId.set(worker.worker_id, resolvedSupervisorId);
      if (worker.direct_supervisor_id === null) {
        if (resolvedSupervisorId !== null) {
          resolvedByCeco += 1;
        } else {
          unresolvedAfterFallback += 1;
        }
      }
    }

    const mappedCostCenterCount = Object.entries(sanitizedMap).filter(
      ([, supervisorId]) => typeof supervisorId === 'number',
    ).length;
    const hiddenCostCenterCount = explicitlyHiddenCostCenters.size;
    const hiddenWorkerCount =
      data.worker_assignments.length - includedWorkerAssignments.length;
    const resolvedSupervisedWorkerCount = Array.from(
      resolvedSupervisorIdByWorkerId.values(),
    ).filter((value) => value !== null).length;

    const linkedWorkerIdsByBucket = new Map<string, Set<number>>();
    for (const worker of includedWorkerAssignments) {
      const bucketKey = toBucketKey(resolvedSupervisorIdByWorkerId.get(worker.worker_id));
      const bucket = linkedWorkerIdsByBucket.get(bucketKey) ?? new Set<number>();
      bucket.add(worker.worker_id);
      linkedWorkerIdsByBucket.set(bucketKey, bucket);
    }

    const bucketAggByDate = new Map<
      string,
      Map<
        string,
        {
          presentWorkerIds: Set<number>;
          productiveWorkerIds: Set<number>;
          taskParticipationCount: number;
          panelTouchIds: Set<number>;
        }
      >
    >();

    for (const row of data.worker_days) {
      if (!includedWorkerIds.has(row.worker_id)) {
        continue;
      }
      const bucketKey = toBucketKey(resolvedSupervisorIdByWorkerId.get(row.worker_id));
      const dayBuckets = bucketAggByDate.get(row.date) ?? new Map();
      const bucket =
        dayBuckets.get(bucketKey) ?? {
          presentWorkerIds: new Set<number>(),
          productiveWorkerIds: new Set<number>(),
          taskParticipationCount: 0,
          panelTouchIds: new Set<number>(),
        };
      if (row.present) {
        bucket.presentWorkerIds.add(row.worker_id);
      }
      if (row.productive) {
        bucket.productiveWorkerIds.add(row.worker_id);
      }
      bucket.taskParticipationCount += row.task_participation_count;
      row.panel_touch_ids.forEach((panelId) => bucket.panelTouchIds.add(panelId));
      dayBuckets.set(bucketKey, bucket);
      bucketAggByDate.set(row.date, dayBuckets);
    }

    const orderedBucketKeys = data.supervisors.map((item) => String(item.id));
    const hasUnassignedBucket =
      (linkedWorkerIdsByBucket.get(UNASSIGNED_BUCKET)?.size ?? 0) > 0 ||
      Array.from(bucketAggByDate.values()).some((dayBuckets) =>
        dayBuckets.has(UNASSIGNED_BUCKET),
      );
    if (hasUnassignedBucket) {
      orderedBucketKeys.push(UNASSIGNED_BUCKET);
    }

    const effectiveDays = data.days.map((day) => {
      const dayBuckets = bucketAggByDate.get(day.date) ?? new Map();
      const dayRows = data.worker_days.filter(
        (row) => row.date === day.date && includedWorkerIds.has(row.worker_id),
      );
      const presentWorkerCount = dayRows.filter((row) => row.present).length;
      const productiveWorkerCount = dayRows.filter((row) => row.productive).length;
      const presentProductiveOverlapCount = dayRows.filter(
        (row) => row.present && row.productive,
      ).length;
      const taskParticipationCount = dayRows.reduce(
        (total, row) => total + row.task_participation_count,
        0,
      );
      const presentSupervisedWorkerCount = orderedBucketKeys
        .filter((bucketKey) => bucketKey !== UNASSIGNED_BUCKET)
        .reduce(
          (total, bucketKey) =>
            total + (dayBuckets.get(bucketKey)?.presentWorkerIds.size ?? 0),
          0,
        );
      const productiveSupervisedWorkerCount = orderedBucketKeys
        .filter((bucketKey) => bucketKey !== UNASSIGNED_BUCKET)
        .reduce(
          (total, bucketKey) =>
            total + (dayBuckets.get(bucketKey)?.productiveWorkerIds.size ?? 0),
          0,
        );
      return {
        ...day,
        eligible_local_worker_count: includedWorkerAssignments.length,
        eligible_supervised_worker_count: resolvedSupervisedWorkerCount,
        present_worker_count: presentWorkerCount,
        present_supervised_worker_count: presentSupervisedWorkerCount,
        present_unassigned_worker_count: Math.max(
          presentWorkerCount - presentSupervisedWorkerCount,
          0,
        ),
        productive_worker_count: productiveWorkerCount,
        productive_supervised_worker_count: productiveSupervisedWorkerCount,
        productive_unassigned_worker_count: Math.max(
          productiveWorkerCount - productiveSupervisedWorkerCount,
          0,
        ),
        present_productive_overlap_count: presentProductiveOverlapCount,
        task_participation_count: taskParticipationCount,
      };
    });

    const effectiveSupervisorDays: SupervisorDay[] = [];
    for (const day of effectiveDays) {
      const dayBuckets = bucketAggByDate.get(day.date) ?? new Map();
      for (const bucketKey of orderedBucketKeys) {
        const bucket = dayBuckets.get(bucketKey);
        const numericSupervisorId =
          bucketKey === UNASSIGNED_BUCKET ? null : Number(bucketKey);
        const supervisorName =
          bucketKey === UNASSIGNED_BUCKET
            ? 'Sin supervisor'
            : supervisorNameById.get(numericSupervisorId ?? 0) ??
              `Supervisor #${bucketKey}`;
        effectiveSupervisorDays.push({
          date: day.date,
          bucket: bucketKey === UNASSIGNED_BUCKET ? 'unassigned' : 'supervisor',
          supervisor_id: numericSupervisorId,
          supervisor_name: supervisorName,
          linked_worker_count:
            linkedWorkerIdsByBucket.get(bucketKey)?.size ?? 0,
          present_worker_count: bucket?.presentWorkerIds.size ?? 0,
          productive_worker_count: bucket?.productiveWorkerIds.size ?? 0,
          present_productive_overlap_count: Array.from(
            bucket?.presentWorkerIds ?? [],
          ).filter((workerId) => bucket?.productiveWorkerIds.has(workerId)).length,
          task_participation_count: bucket?.taskParticipationCount ?? 0,
          panel_touch_count: bucket?.panelTouchIds.size ?? 0,
        });
      }
    }

    const effectiveSupervisorSummaries: SupervisorSummary[] = orderedBucketKeys.map(
      (bucketKey) => {
        const numericSupervisorId =
          bucketKey === UNASSIGNED_BUCKET ? null : Number(bucketKey);
        const supervisorName =
          bucketKey === UNASSIGNED_BUCKET
            ? 'Sin supervisor'
            : supervisorNameById.get(numericSupervisorId ?? 0) ??
              `Supervisor #${bucketKey}`;
        const uniquePresentWorkerIds = new Set<number>();
        const uniqueProductiveWorkerIds = new Set<number>();
        let presentWorkerDays = 0;
        let productiveWorkerDays = 0;
        let overlapWorkerDays = 0;
        let taskParticipationCount = 0;
        const panelTouchIds = new Set<number>();

        for (const day of effectiveDays) {
          const bucket = bucketAggByDate.get(day.date)?.get(bucketKey);
          bucket?.presentWorkerIds.forEach((workerId) =>
            uniquePresentWorkerIds.add(workerId),
          );
          bucket?.productiveWorkerIds.forEach((workerId) =>
            uniqueProductiveWorkerIds.add(workerId),
          );
          presentWorkerDays += bucket?.presentWorkerIds.size ?? 0;
          productiveWorkerDays += bucket?.productiveWorkerIds.size ?? 0;
          overlapWorkerDays += Array.from(bucket?.presentWorkerIds ?? []).filter(
            (workerId) => bucket?.productiveWorkerIds.has(workerId),
          ).length;
          taskParticipationCount += bucket?.taskParticipationCount ?? 0;
          bucket?.panelTouchIds.forEach((panelId) => panelTouchIds.add(panelId));
        }

        return {
          bucket: bucketKey === UNASSIGNED_BUCKET ? 'unassigned' : 'supervisor',
          supervisor_id: numericSupervisorId,
          supervisor_name: supervisorName,
          linked_worker_count: linkedWorkerIdsByBucket.get(bucketKey)?.size ?? 0,
          present_worker_days: presentWorkerDays,
          productive_worker_days: productiveWorkerDays,
          present_productive_overlap_days: overlapWorkerDays,
          unique_present_worker_count: uniquePresentWorkerIds.size,
          unique_productive_worker_count: uniqueProductiveWorkerIds.size,
          task_participation_count: taskParticipationCount,
          panel_touch_count: panelTouchIds.size,
        };
      },
    );

    effectiveSupervisorSummaries.sort((left, right) => {
      if (left.bucket !== right.bucket) {
        return left.bucket === 'unassigned' ? 1 : -1;
      }
      if (left.productive_worker_days !== right.productive_worker_days) {
        return right.productive_worker_days - left.productive_worker_days;
      }
      return left.supervisor_name.localeCompare(right.supervisor_name);
    });

    const effectiveWarnings = [...data.warnings];
    if (
      data.coverage.buk_available &&
      data.buk_cost_centers.some(
        (item) =>
          item.fallback_candidate_worker_count > 0 &&
          !(item.cost_center_code in sanitizedMap),
      )
    ) {
      effectiveWarnings.push('local_ceco_mappings_missing');
    }

    return {
      coverage: {
        ...data.coverage,
        active_local_geo_linked_workers: includedWorkerAssignments.length,
        active_local_geo_linked_workers_matched_in_buk: includedWorkerAssignments.filter(
          (worker) => worker.buk_matched,
        ).length,
        active_local_geo_linked_workers_with_supervisor: includedWorkerAssignments.filter(
          (worker) => worker.direct_supervisor_id !== null,
        ).length,
        active_local_geo_linked_workers_without_supervisor: includedWorkerAssignments.filter(
          (worker) => worker.direct_supervisor_id === null,
        ).length,
        active_local_geo_linked_workers_resolved_by_ceco: resolvedByCeco,
        active_local_geo_linked_workers_unresolved_after_fallback:
          unresolvedAfterFallback,
        supervisor_cost_center_mappings: mappedCostCenterCount,
      },
      days: effectiveDays,
      supervisorDays: effectiveSupervisorDays,
      supervisorSummaries: effectiveSupervisorSummaries,
      warnings: effectiveWarnings,
      cecoMappingEnabled: data.coverage.buk_available && mappedCostCenterCount > 0,
      sanitizedMap,
      hiddenCostCenterCount,
      hiddenWorkerCount,
    };
  }, [cecoSupervisorMap, data]);

  const rangeSummary = useMemo(() => {
    const days = effectiveDashboard?.days ?? data?.days ?? [];
    if (!days.length) {
      return {
        avgPresent: 0,
        avgProductive: 0,
        avgOverlap: 0,
        totalParticipations: 0,
        totalTasks: 0,
        totalPanels: 0,
      };
    }
    const totalPresent = days.reduce((acc, day) => acc + day.present_worker_count, 0);
    const totalProductive = days.reduce((acc, day) => acc + day.productive_worker_count, 0);
    const totalOverlap = days.reduce((acc, day) => acc + day.present_productive_overlap_count, 0);
    return {
      avgPresent: Math.round(totalPresent / days.length),
      avgProductive: Math.round(totalProductive / days.length),
      avgOverlap: Math.round(totalOverlap / days.length),
      totalParticipations: days.reduce((acc, day) => acc + day.task_participation_count, 0),
      totalTasks: days.reduce((acc, day) => acc + day.completed_task_count, 0),
      totalPanels: days.reduce((acc, day) => acc + day.completed_panel_count, 0),
    };
  }, [data?.days, effectiveDashboard?.days]);

  const dayMaximums = useMemo(() => {
    const days = effectiveDashboard?.days ?? data?.days ?? [];
    return {
      present: Math.max(1, ...days.map((day) => day.present_worker_count)),
      productive: Math.max(1, ...days.map((day) => day.productive_worker_count)),
      tasks: Math.max(1, ...days.map((day) => day.completed_task_count)),
    };
  }, [data?.days, effectiveDashboard?.days]);

  const latestSupervisorDays = useMemo(() => {
    const days = effectiveDashboard?.supervisorDays ?? data?.supervisor_days ?? [];
    if (!days.length) {
      return [];
    }
    const latestDate = days.reduce((max, current) => (current.date > max ? current.date : max), days[0].date);
    return days
      .filter((row) => row.date === latestDate)
      .sort((left, right) => {
        if (left.bucket !== right.bucket) {
          return left.bucket === 'unassigned' ? 1 : -1;
        }
        return right.productive_worker_count - left.productive_worker_count;
      });
  }, [data?.supervisor_days, effectiveDashboard?.supervisorDays]);

  const coverage = effectiveDashboard?.coverage ?? data?.coverage ?? null;
  const effectiveDays = effectiveDashboard?.days ?? data?.days ?? [];
  const effectiveSupervisorSummaries =
    effectiveDashboard?.supervisorSummaries ?? data?.supervisor_summaries ?? [];
  const effectiveWarnings = effectiveDashboard?.warnings ?? data?.warnings ?? [];

  const bukWorkerSamples = useMemo(
    () =>
      [...(data?.worker_assignments ?? [])]
        .filter((worker) => worker.buk_matched || worker.buk_cost_center_code)
        .sort((left, right) => {
          const leftKey = left.buk_cost_center_name ?? left.buk_cost_center_code ?? 'ZZZ';
          const rightKey = right.buk_cost_center_name ?? right.buk_cost_center_code ?? 'ZZZ';
          if (leftKey !== rightKey) {
            return leftKey.localeCompare(rightKey);
          }
          return left.worker_name.localeCompare(right.worker_name);
        })
        .slice(0, 18),
    [data?.worker_assignments],
  );

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-black/5 bg-[radial-gradient(circle_at_top_left,_rgba(193,230,255,0.4),_transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,248,252,0.92))] px-6 py-6 shadow-sm">
        <div className="grid gap-5 xl:grid-cols-[1.25fr_0.95fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">
              Draft supervisor coverage
            </p>
            <h1 className="mt-3 font-display text-3xl text-[var(--ink)]">
              Cruce inicial entre asistencia y produccion
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
              Este corte usa GeoVictoria para presencia y BUK para completar CECO cuando un
              trabajador no tiene supervisor directo. La asignacion se resuelve como supervisor
              directo primero y CECO como fallback.
            </p>
          </div>
          <div className="rounded-3xl border border-black/5 bg-white/80 p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <Workflow className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                  Alcance actual
                </p>
                <p className="text-sm text-[var(--ink)]">
                  GeoVictoria para presencia, BUK para CECO y fallback de supervisor.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {(effectiveWarnings.length
                ? effectiveWarnings
                : ['geovictoria_roster_unfiltered']
              ).map(
                (warning) => (
                  <span
                    key={warning}
                    className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50/80 px-3 py-1.5 text-xs text-amber-900"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {WARNING_LABELS[warning] ?? warning}
                  </span>
                ),
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-black/5 bg-white/85 px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)]">Rango</p>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Ajusta el periodo para comparar cobertura, presencia y participacion productiva.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-[var(--ink-muted)]">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.18em]">Desde</span>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <label className="text-sm text-[var(--ink-muted)]">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.18em]">Hasta</span>
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>
        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="GeoVictoria activos"
          value={formatNumber(coverage?.geovictoria_active_users)}
          tone="accent"
          detail="Roster global activo de GeoVictoria, todavia sin filtrado de CECO."
        />
        <MetricCard
          label="BUK indexados"
          value={formatNumber(coverage?.buk_people_indexed)}
          detail={`${formatNumber(coverage?.buk_people_with_cost_center)} personas con CECO detectable.`}
        />
        <MetricCard
          label="Supervisor directo"
          value={formatNumber(coverage?.active_local_geo_linked_workers_with_supervisor)}
          detail={`${formatNumber(coverage?.active_local_geo_linked_workers)} trabajadores activos vinculados a GeoVictoria.`}
        />
        <MetricCard
          label="Resueltos por CECO"
          value={formatNumber(coverage?.active_local_geo_linked_workers_resolved_by_ceco)}
          tone="warning"
          detail={`${formatNumber(coverage?.active_local_geo_linked_workers_unresolved_after_fallback)} siguen sin supervisor; ${formatNumber(coverage?.supervisor_cost_center_mappings)} CECOs mapeados en este navegador.`}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Promedio presentes"
          value={formatNumber(rangeSummary.avgPresent)}
          detail="Trabajadores presentes por dia dentro del rango."
        />
        <MetricCard
          label="Promedio productivos"
          value={formatNumber(rangeSummary.avgProductive)}
          detail="Trabajadores con participacion en tareas completadas por dia."
        />
        <MetricCard
          label="Promedio cruce"
          value={formatNumber(rangeSummary.avgOverlap)}
          detail="Presentes y productivos el mismo dia."
        />
        <MetricCard
          label="Participaciones"
          value={formatNumber(rangeSummary.totalParticipations)}
          detail={`${formatNumber(rangeSummary.totalTasks)} tareas completadas y ${formatNumber(rangeSummary.totalPanels)} paneles tocados.`}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-3xl border border-black/5 bg-white/85 px-6 py-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)]">
                Mapping Local
              </p>
              <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">
                CECO a supervisor
              </h2>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                Este mapping vive en `localStorage` del navegador. No se guarda en la base de datos.
              </p>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
                {formatNumber(effectiveDashboard?.hiddenCostCenterCount)} CECOs ocultos y{' '}
                {formatNumber(effectiveDashboard?.hiddenWorkerCount)} trabajadores fuera del
                analisis en este navegador.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCecoSupervisorMap({})}
              className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink)]"
            >
              Limpiar mappings
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {!data?.coverage.buk_available ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
                BUK no esta disponible todavia en este entorno. Cuando responda, los CECOs detectados apareceran aqui.
              </div>
            ) : (data?.buk_cost_centers.length ?? 0) === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
                BUK respondio, pero no se detectaron CECOs para trabajadores locales vinculados.
              </div>
            ) : (
              data?.buk_cost_centers.map((item) => (
                <article
                  key={item.cost_center_code}
                  className="rounded-2xl border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(247,249,252,0.96))] px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--ink)]">
                        {item.cost_center_name ?? item.cost_center_code}
                      </div>
                      {item.cost_center_name ? (
                        <div className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                          {item.cost_center_code}
                        </div>
                      ) : null}
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
                        <span>{formatNumber(item.matched_local_worker_count)} trabajadores locales</span>
                        <span>{formatNumber(item.fallback_candidate_worker_count)} candidatos a fallback</span>
                      </div>
                    </div>
                    <label className="min-w-[220px] text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                      Supervisor local
                      <select
                        className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm text-[var(--ink)]"
                        value={
                          effectiveDashboard?.sanitizedMap[item.cost_center_code] ?? ''
                        }
                        onChange={(event) => {
                          const { value } = event.target;
                          setCecoSupervisorMap((current) => {
                            const next = { ...current };
                            if (!value) {
                              delete next[item.cost_center_code];
                              return next;
                            }
                            if (value === HIDDEN_CECO_MAPPING_VALUE) {
                              next[item.cost_center_code] = HIDDEN_CECO_MAPPING_VALUE;
                              return next;
                            }
                            next[item.cost_center_code] = Number(value);
                            return next;
                          });
                        }}
                      >
                        <option value="">Sin mapping</option>
                        <option value={HIDDEN_CECO_MAPPING_VALUE}>
                          No mostrar en este analisis
                        </option>
                        {(data?.supervisors ?? []).map((supervisor) => (
                          <option key={supervisor.id} value={supervisor.id}>
                            {supervisor.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white/85 px-6 py-5 shadow-sm">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)]">
              Muestra BUK
            </p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">
              Trabajadores y CECO detectado
            </h2>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Vista rapida para validar que el CECO que estamos leyendo desde BUK sea el correcto.
            </p>
          </div>
          <div className="mt-5 space-y-3">
            {bukWorkerSamples.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
                Todavia no hay trabajadores locales cruzados con BUK.
              </div>
            ) : (
              bukWorkerSamples.map((worker) => (
                <article
                  key={worker.worker_id}
                  className="rounded-2xl border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(247,249,252,0.96))] px-4 py-4"
                >
                  <div className="text-sm font-semibold text-[var(--ink)]">
                    {worker.worker_name}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
                    <span>RUT: {worker.geovictoria_identifier ?? 'Sin RUT'}</span>
                    <span>
                      CECO:{' '}
                      {formatCostCenterLabel(
                        worker.buk_cost_center_code,
                        worker.buk_cost_center_name,
                      )}
                    </span>
                    <span>
                      {worker.direct_supervisor_id !== null
                        ? 'Con supervisor directo'
                        : 'Sin supervisor directo'}
                    </span>
                    {worker.buk_cost_center_code &&
                    effectiveDashboard?.sanitizedMap[worker.buk_cost_center_code] ===
                      HIDDEN_CECO_MAPPING_VALUE ? (
                      <span>Oculto del analisis</span>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-black/5 bg-white/85 px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)]">
              Lectura diaria
            </p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">
              Presencia, produccion y salida completada
            </h2>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs text-[var(--ink-muted)]">
            <Users className="h-4 w-4 text-[var(--accent)]" />
            {formatNumber(effectiveDays.length)} dias en vista
          </div>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {effectiveDays.map((day) => (
            <article
              key={day.date}
              className="rounded-2xl border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(246,247,250,0.95))] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    {formatDateLabel(day.date)}
                  </div>
                  <div className="mt-2 text-lg font-semibold text-[var(--ink)]">
                    {formatNumber(day.present_worker_count)} presentes /{' '}
                    {formatNumber(day.productive_worker_count)} productivos
                  </div>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white/80 px-3 py-2 text-right">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    cruce
                  </div>
                  <div className="text-base font-semibold text-[var(--ink)]">
                    {ratioPercent(day.present_productive_overlap_count, day.present_worker_count)}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-[var(--ink-muted)]">
                    <span>Presentes</span>
                    <span>{formatNumber(day.present_worker_count)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-black/5">
                    <div
                      className="h-2 rounded-full bg-sky-500"
                      style={{
                        width: `${Math.max(
                          6,
                          (day.present_worker_count / dayMaximums.present) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-[var(--ink-muted)]">
                    <span>Productivos</span>
                    <span>{formatNumber(day.productive_worker_count)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-black/5">
                    <div
                      className="h-2 rounded-full bg-emerald-500"
                      style={{
                        width: `${Math.max(
                          6,
                          (day.productive_worker_count / dayMaximums.productive) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-[var(--ink-muted)]">
                    <span>Tareas completadas</span>
                    <span>{formatNumber(day.completed_task_count)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-black/5">
                    <div
                      className="h-2 rounded-full bg-[var(--accent)]"
                      style={{
                        width: `${Math.max(
                          6,
                          (day.completed_task_count / dayMaximums.tasks) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-2xl border border-black/5 bg-white/80 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    sin supervisor
                  </div>
                  <div className="mt-1 text-base font-semibold text-[var(--ink)]">
                    {formatNumber(day.present_unassigned_worker_count)}
                  </div>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white/80 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    participaciones
                  </div>
                  <div className="mt-1 text-base font-semibold text-[var(--ink)]">
                    {formatNumber(day.task_participation_count)}
                  </div>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white/80 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    paneles
                  </div>
                  <div className="mt-1 text-base font-semibold text-[var(--ink)]">
                    {formatNumber(day.completed_panel_count)}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-black/5 bg-white/85 px-6 py-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)]">
                Supervisores
              </p>
              <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">
                Resumen del rango
              </h2>
            </div>
            <div className="text-xs text-[var(--ink-muted)]">
              Bucket aparte para trabajadores sin supervisor.
            </div>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-2">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  <th className="px-3 py-2">Supervisor</th>
                  <th className="px-3 py-2">Dotacion</th>
                  <th className="px-3 py-2">Presentes</th>
                  <th className="px-3 py-2">Productivos</th>
                  <th className="px-3 py-2">Cruce</th>
                  <th className="px-3 py-2">Participaciones</th>
                </tr>
              </thead>
              <tbody>
                {effectiveSupervisorSummaries.map((row) => (
                  <tr
                    key={`${row.bucket}-${row.supervisor_id ?? 'none'}`}
                    className="rounded-2xl bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,247,250,0.96))] text-sm text-[var(--ink)] shadow-sm"
                  >
                    <td className="rounded-l-2xl px-3 py-3">
                      <div className="font-semibold">{row.supervisor_name}</div>
                      <div className="mt-1 text-xs text-[var(--ink-muted)]">
                        {row.bucket === 'unassigned'
                          ? 'Cobertura pendiente'
                          : `${formatNumber(row.panel_touch_count)} paneles tocados`}
                      </div>
                    </td>
                    <td className="px-3 py-3">{formatNumber(row.linked_worker_count)}</td>
                    <td className="px-3 py-3">
                      {formatNumber(row.present_worker_days)}
                      <div className="text-xs text-[var(--ink-muted)]">
                        {formatNumber(row.unique_present_worker_count)} unicos
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {formatNumber(row.productive_worker_days)}
                      <div className="text-xs text-[var(--ink-muted)]">
                        {formatNumber(row.unique_productive_worker_count)} unicos
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {formatNumber(row.present_productive_overlap_days)}
                      <div className="text-xs text-[var(--ink-muted)]">
                        {ratioPercent(row.present_productive_overlap_days, row.present_worker_days)}
                      </div>
                    </td>
                    <td className="rounded-r-2xl px-3 py-3">
                      {formatNumber(row.task_participation_count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white/85 px-6 py-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)]">
                Ultimo dia del rango
              </p>
              <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">
                Foto por supervisor
              </h2>
            </div>
            <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--ink-muted)]">
              {latestSupervisorDays[0] ? formatDateLabel(latestSupervisorDays[0].date) : 'Sin datos'}
            </span>
          </div>
          <div className="mt-5 space-y-3">
            {latestSupervisorDays.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-[var(--ink-muted)]">
                No hay actividad para el rango seleccionado.
              </div>
            ) : (
              latestSupervisorDays.map((row) => (
                <article
                  key={`${row.date}-${row.bucket}-${row.supervisor_id ?? 'none'}`}
                  className="rounded-2xl border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(247,249,252,0.96))] px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--ink)]">
                        {row.supervisor_name}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ink-muted)]">
                        {formatNumber(row.linked_worker_count)} trabajadores vinculados
                      </div>
                    </div>
                    <div className="rounded-2xl border border-black/5 bg-white/80 px-3 py-2 text-right">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                        cruce
                      </div>
                      <div className="text-sm font-semibold text-[var(--ink)]">
                        {ratioPercent(row.present_productive_overlap_count, row.present_worker_count)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-4">
                    <div className="rounded-2xl bg-white/80 px-3 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                        presentes
                      </div>
                      <div className="mt-1 text-base font-semibold text-[var(--ink)]">
                        {formatNumber(row.present_worker_count)}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white/80 px-3 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                        productivos
                      </div>
                      <div className="mt-1 text-base font-semibold text-[var(--ink)]">
                        {formatNumber(row.productive_worker_count)}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white/80 px-3 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                        participaciones
                      </div>
                      <div className="mt-1 text-base font-semibold text-[var(--ink)]">
                        {formatNumber(row.task_participation_count)}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white/80 px-3 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                        paneles
                      </div>
                      <div className="mt-1 text-base font-semibold text-[var(--ink)]">
                        {formatNumber(row.panel_touch_count)}
                      </div>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default DashboardLineAttendanceThroughput;
