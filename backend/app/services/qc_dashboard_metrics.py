from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo


QC_DASHBOARD_TIMEZONE = "America/Santiago"


@dataclass(frozen=True)
class QCMetricWindow:
    date_from: date
    date_to: date
    start_utc: datetime
    end_utc_exclusive: datetime
    timezone_name: str


def build_qc_metric_window(
    date_from: date,
    date_to: date,
    timezone_name: str = QC_DASHBOARD_TIMEZONE,
) -> QCMetricWindow:
    if date_from > date_to:
        raise ValueError("date_from must be before or equal to date_to")

    local_timezone = ZoneInfo(timezone_name)
    local_start = datetime.combine(date_from, time.min, tzinfo=local_timezone)
    local_end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=local_timezone)

    # QC timestamps use SQLAlchemy DateTime without timezone information. Store/query
    # their UTC wall-clock representation consistently.
    start_utc = local_start.astimezone(timezone.utc).replace(tzinfo=None)
    end_utc_exclusive = local_end.astimezone(timezone.utc).replace(tzinfo=None)
    return QCMetricWindow(
        date_from=date_from,
        date_to=date_to,
        start_utc=start_utc,
        end_utc_exclusive=end_utc_exclusive,
        timezone_name=timezone_name,
    )


def _enum_value(value: Any) -> str:
    return str(getattr(value, "value", value))


def _module_seed(row: Any) -> dict[str, Any]:
    return {
        "work_unit_id": row.work_unit_id,
        "module_number": row.module_number,
        "project_name": row.project_name,
        "house_identifier": row.house_identifier,
        "house_type_name": row.house_type_name,
        "triggered_checks": 0,
        "not_performed_checks": 0,
        "open_checks": 0,
        "open_observations": 0,
    }


def summarize_qc_quality_rows(
    check_rows: Iterable[Any],
    observation_rows: Iterable[Any],
    window: QCMetricWindow,
) -> dict[str, Any]:
    modules: dict[int, dict[str, Any]] = {}
    checks_total = 0
    triggered_checks = 0
    not_performed_checks = 0
    open_checks = 0
    observations_total = 0
    open_observations = 0

    for row in check_rows:
        checks_total += 1
        module = modules.setdefault(row.work_unit_id, _module_seed(row))
        is_triggered = _enum_value(row.origin) == "triggered"
        is_open = _enum_value(row.status) == "Open"
        if is_triggered:
            triggered_checks += 1
            module["triggered_checks"] += 1
            if not bool(row.performed):
                not_performed_checks += 1
                module["not_performed_checks"] += 1
        if is_open:
            open_checks += 1
            module["open_checks"] += 1

    for row in observation_rows:
        observations_total += 1
        module = modules.setdefault(row.work_unit_id, _module_seed(row))
        if _enum_value(row.status) != "Closed":
            open_observations += 1
            module["open_observations"] += 1

    module_rows = sorted(
        modules.values(),
        key=lambda row: (
            row["project_name"] or "",
            row["house_identifier"] or "",
            row["module_number"],
            row["work_unit_id"],
        ),
    )
    affected_module_count = sum(
        1
        for row in module_rows
        if row["not_performed_checks"] or row["open_checks"] or row["open_observations"]
    )

    return {
        "range": {
            "date_from": window.date_from,
            "date_to": window.date_to,
            "timezone": window.timezone_name,
        },
        "checks": {
            "total": checks_total,
            "triggered": triggered_checks,
            "not_performed": not_performed_checks,
            "open": open_checks,
        },
        "observations": {
            "total": observations_total,
            "open": open_observations,
        },
        "affected_modules": affected_module_count,
        "modules": module_rows,
    }


def _failure_group_rows(
    execution_rows: list[Any],
    id_attribute: str,
    name_attribute: str,
    fallback_name: str,
    *,
    omit_missing_id: bool = False,
) -> list[dict[str, Any]]:
    grouped: dict[tuple[int | None, str], dict[str, Any]] = {}
    for row in execution_rows:
        dimension_id = getattr(row, id_attribute)
        if omit_missing_id and dimension_id is None:
            continue
        name = str(getattr(row, name_attribute) or fallback_name).strip() or fallback_name
        key = (dimension_id, name)
        metric = grouped.setdefault(
            key,
            {
                "dimension_id": dimension_id,
                "name": name,
                "executions": 0,
                "failures": 0,
                "failure_rate": 0.0,
            },
        )
        metric["executions"] += 1
        if _enum_value(row.outcome) == "Fail":
            metric["failures"] += 1

    for metric in grouped.values():
        metric["failure_rate"] = (
            metric["failures"] / metric["executions"] if metric["executions"] else 0.0
        )

    return sorted(
        grouped.values(),
        key=lambda metric: (
            -metric["failures"],
            -metric["failure_rate"],
            -metric["executions"],
            metric["name"].casefold(),
        ),
    )


def _local_metric_date(value: datetime, timezone_name: str) -> date:
    utc_value = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return utc_value.astimezone(ZoneInfo(timezone_name)).date()


def summarize_qc_failure_rows(
    execution_rows: Iterable[Any],
    failure_mode_rows: Iterable[Any],
    rework_rows: Iterable[Any],
    window: QCMetricWindow,
) -> dict[str, Any]:
    executions = list(execution_rows)
    failed_rows = [row for row in executions if _enum_value(row.outcome) == "Fail"]
    passes = sum(1 for row in executions if _enum_value(row.outcome) == "Pass")
    waived = sum(1 for row in executions if _enum_value(row.outcome) == "Waive")
    failure_count_by_check: dict[int, int] = {}
    affected_modules: set[int] = set()
    severity_by_check: dict[int, str] = {}
    severity_counts = {"baja": 0, "media": 0, "critica": 0, "sin_severidad": 0}

    for row in failed_rows:
        failure_count_by_check[row.check_instance_id] = (
            failure_count_by_check.get(row.check_instance_id, 0) + 1
        )
        affected_modules.add(row.work_unit_id)
        severity = _enum_value(row.severity_level) if row.severity_level is not None else ""
        severity_key = severity if severity in {"baja", "media", "critica"} else "sin_severidad"
        severity_by_check[row.check_instance_id] = severity_key

    for severity_key in severity_by_check.values():
        severity_counts[severity_key] += 1

    reworks = list(rework_rows)
    open_reworks = sum(
        1 for row in reworks if _enum_value(row.status) in {"Open", "InProgress"}
    )

    daily: dict[date, dict[str, Any]] = {}
    cursor = window.date_from
    while cursor <= window.date_to:
        daily[cursor] = {
            "date": cursor,
            "executions": 0,
            "failures": 0,
            "failure_rate": 0.0,
        }
        cursor += timedelta(days=1)
    for row in executions:
        metric_date = _local_metric_date(row.performed_at, window.timezone_name)
        metric = daily.get(metric_date)
        if metric is None:
            continue
        metric["executions"] += 1
        if _enum_value(row.outcome) == "Fail":
            metric["failures"] += 1
    for metric in daily.values():
        metric["failure_rate"] = (
            metric["failures"] / metric["executions"] if metric["executions"] else 0.0
        )

    failure_modes: dict[tuple[int | None, str], dict[str, Any]] = {}
    for row in failure_mode_rows:
        name = str(row.failure_mode_name or row.other_text or "Otro").strip() or "Otro"
        key = (row.failure_mode_definition_id, name.casefold())
        metric = failure_modes.setdefault(
            key,
            {
                "failure_mode_definition_id": row.failure_mode_definition_id,
                "name": name,
                "occurrences": 0,
            },
        )
        metric["occurrences"] += 1

    total_executions = len(executions)
    total_failures = len(failed_rows)
    return {
        "range": {
            "date_from": window.date_from,
            "date_to": window.date_to,
            "timezone": window.timezone_name,
        },
        "summary": {
            "executions": total_executions,
            "failures": total_failures,
            "passes": passes,
            "waived": waived,
            "failure_rate": total_failures / total_executions if total_executions else 0.0,
            "affected_modules": len(affected_modules),
            "repeat_failure_checks": sum(
                1 for count in failure_count_by_check.values() if count >= 2
            ),
            "open_reworks": open_reworks,
            "critical_checks": severity_counts["critica"],
        },
        "tasks": _failure_group_rows(
            executions,
            "task_definition_id",
            "task_name",
            "Tarea sin identificar",
            omit_missing_id=True,
        ),
        "stations": _failure_group_rows(
            executions,
            "station_id",
            "station_name",
            "Sin estación",
        ),
        "checks": _failure_group_rows(
            executions,
            "check_definition_id",
            "check_name",
            "Check manual",
        ),
        "failure_modes": sorted(
            failure_modes.values(),
            key=lambda metric: (-metric["occurrences"], metric["name"].casefold()),
        ),
        "severities": [
            {"severity": "critica", "failures": severity_counts["critica"]},
            {"severity": "media", "failures": severity_counts["media"]},
            {"severity": "baja", "failures": severity_counts["baja"]},
            {"severity": "sin_severidad", "failures": severity_counts["sin_severidad"]},
        ],
        "daily": list(daily.values()),
    }
