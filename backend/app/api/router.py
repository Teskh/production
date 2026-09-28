from fastapi import APIRouter

from app.api.routes import (
    admin_auth,
    admin_dashboard_permissions,
    admin_page_permissions,
    admin_users,
    backups,
    camera_feed,
    comment_templates,
    conditions,
    geovictoria,
    house_params,
    house_types,
    line_attendance_throughput,
    labels,
    panel_definitions,
    panel_linear_meters,
    panel_task_history,
    protocols,
    reports,
    task_station_adherence,
    task_history,
    station_panels_finished,
    pause_reasons,
    pause_summary,
    production_queue,
    project_costs,
    qc_config,
    qc_complaints,
    qc_runtime,
    shift_estimates,
    stations,
    task_analysis,
    task_corrections,
    task_footage,
    task_definitions,
    task_rules,
    task_sequence,
    worker_sessions,
    worker_station,
    worker_tasks,
    workers,
)

api_router = APIRouter()
api_router.include_router(project_costs.router, prefix="/project-costs", tags=["project-costs"])

api_router.include_router(admin_auth.router, prefix="/admin", tags=["admin-auth"])
api_router.include_router(
    admin_auth.microsoft_router,
    prefix="/auth",
    tags=["microsoft-auth"],
)
api_router.include_router(
    admin_dashboard_permissions.router,
    prefix="/admin",
    tags=["admin-dashboard-permissions"],
)
api_router.include_router(
    admin_page_permissions.router,
    prefix="/admin",
    tags=["admin-page-permissions"],
)
api_router.include_router(admin_users.router, prefix="/admin", tags=["admin-users"])
api_router.include_router(backups.router, prefix="/backups", tags=["backups"])
api_router.include_router(camera_feed.router, prefix="/camera-feed", tags=["camera-feed"])
api_router.include_router(geovictoria.router, prefix="/geovictoria", tags=["geovictoria"])
api_router.include_router(
    line_attendance_throughput.router,
    prefix="/line-attendance-throughput",
    tags=["line-attendance-throughput"],
)
api_router.include_router(labels.router, prefix="/labels", tags=["labels"])
api_router.include_router(workers.router, prefix="/workers", tags=["workers"])
api_router.include_router(stations.router, prefix="/stations", tags=["stations"])
api_router.include_router(pause_reasons.router, prefix="/pause-reasons", tags=["pause-reasons"])
api_router.include_router(comment_templates.router, prefix="/comment-templates", tags=["comment-templates"])
api_router.include_router(conditions.router, prefix="/conditions", tags=["conditions"])
api_router.include_router(qc_config.router, prefix="/qc", tags=["qc-config"])
api_router.include_router(qc_complaints.router, prefix="/qc", tags=["qc-complaints"])
api_router.include_router(qc_runtime.router, prefix="/qc", tags=["qc-runtime"])
api_router.include_router(house_types.router, prefix="/house-types", tags=["house-types"])
api_router.include_router(
    panel_definitions.router, prefix="/panel-definitions", tags=["panel-definitions"]
)
api_router.include_router(
    panel_linear_meters.router,
    prefix="/panel-linear-meters",
    tags=["panel-linear-meters"],
)
api_router.include_router(
    panel_task_history.router,
    prefix="/panel-task-history",
    tags=["panel-task-history"],
)
api_router.include_router(protocols.router, prefix="/protocols", tags=["protocols"])
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
api_router.include_router(
    task_station_adherence.router,
    prefix="/task-station-adherence",
    tags=["task-station-adherence"],
)
api_router.include_router(
    task_history.router,
    prefix="/task-history",
    tags=["task-history"],
)
api_router.include_router(
    station_panels_finished.router,
    prefix="/station-panels-finished",
    tags=["station-panels-finished"],
)
api_router.include_router(
    shift_estimates.router,
    prefix="/shift-estimates",
    tags=["shift-estimates"],
)
api_router.include_router(
    house_params.router, prefix="/house-parameters", tags=["house-parameters"]
)
api_router.include_router(task_definitions.router, prefix="/task-definitions", tags=["task-definitions"])
api_router.include_router(task_rules.router, prefix="/task-rules", tags=["task-rules"])
api_router.include_router(task_analysis.router, prefix="/task-analysis", tags=["task-analysis"])
api_router.include_router(task_sequence.router, prefix="/task-sequence", tags=["task-sequence"])
api_router.include_router(task_corrections.router, prefix="/task-corrections", tags=["task-corrections"])
api_router.include_router(task_footage.router, prefix="/task-footage", tags=["task-footage"])
api_router.include_router(pause_summary.router, prefix="/pause-summary", tags=["pause-summary"])
api_router.include_router(production_queue.router, prefix="/production-queue", tags=["production-queue"])
api_router.include_router(worker_sessions.router, prefix="/worker-sessions", tags=["worker-sessions"])
api_router.include_router(worker_station.router, prefix="/worker-stations", tags=["worker-stations"])
api_router.include_router(worker_tasks.router, prefix="/worker-tasks", tags=["worker-tasks"])
