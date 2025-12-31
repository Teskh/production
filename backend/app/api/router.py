from fastapi import APIRouter

from app.api.routes import (
    admin_auth,
    backups,
    geovictoria,
    house_params,
    house_types,
    panel_definitions,
    stations,
    task_definitions,
    task_rules,
    workers,
)

api_router = APIRouter()

api_router.include_router(admin_auth.router, prefix="/admin", tags=["admin-auth"])
api_router.include_router(backups.router, prefix="/backups", tags=["backups"])
api_router.include_router(geovictoria.router, prefix="/geovictoria", tags=["geovictoria"])
api_router.include_router(workers.router, prefix="/workers", tags=["workers"])
api_router.include_router(stations.router, prefix="/stations", tags=["stations"])
api_router.include_router(house_types.router, prefix="/house-types", tags=["house-types"])
api_router.include_router(
    panel_definitions.router, prefix="/panel-definitions", tags=["panel-definitions"]
)
api_router.include_router(
    house_params.router, prefix="/house-parameters", tags=["house-parameters"]
)
api_router.include_router(task_definitions.router, prefix="/task-definitions", tags=["task-definitions"])
api_router.include_router(task_rules.router, prefix="/task-rules", tags=["task-rules"])
