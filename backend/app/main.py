import asyncio
import contextlib
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.services import backups as backup_service

app = FastAPI(title="SCP API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api")

logger = logging.getLogger(__name__)


async def _run_backup_scheduler() -> None:
    poll_seconds = max(settings.backup_scheduler_poll_seconds, 10)
    lock = asyncio.Lock()
    while True:
        try:
            settings_data = backup_service.load_backup_settings()
            if backup_service.is_backup_due(settings_data) and not lock.locked():
                async with lock:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(None, backup_service.create_backup)
        except Exception as exc:  # pragma: no cover - defensive against backup errors
            logger.warning("Backup scheduler error: %s", exc)
        await asyncio.sleep(poll_seconds)


@app.on_event("startup")
async def start_backup_scheduler() -> None:
    if not settings.backup_scheduler_enabled:
        return
    # Note: each Uvicorn worker spawns its own scheduler task. Keep single-worker or
    # disable this scheduler if you scale out to avoid duplicate backups.
    if getattr(app.state, "backup_task", None):
        return
    app.state.backup_task = asyncio.create_task(_run_backup_scheduler())


@app.on_event("shutdown")
async def stop_backup_scheduler() -> None:
    task = getattr(app.state, "backup_task", None)
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
