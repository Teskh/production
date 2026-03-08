import asyncio
import contextlib
import logging
from pathlib import Path
import random
import time
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import BASE_DIR, settings
from app.services import backups as backup_service
from app.services import shift_estimate_scheduler as shift_estimate_scheduler_service

app = FastAPI(title="SCP API", version="0.1.0")
MEDIA_GALLERY_DIR = BASE_DIR / "media_gallery"
UI_DIST_DIR = BASE_DIR.parent / "ui" / "dist"
MEDIA_GALLERY_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media_gallery", StaticFiles(directory=MEDIA_GALLERY_DIR), name="media_gallery")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:4173",
        "http://localhost:4174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:4173",
        "http://127.0.0.1:4174",
        "http://10.0.10.236:5173",
        "http://10.0.10.236:5174",
        "http://10.0.10.236:4173",
        "http://10.0.10.236:4174",
    ],
    allow_origin_regex=(
        r"^http://((localhost|127\.0\.0\.1)|(192\.168\.\d{1,3}\.\d{1,3})|"
        r"(10\.\d{1,3}\.\d{1,3}\.\d{1,3})):(4173|4174|5173|5174)$"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api")

logger = logging.getLogger(__name__)


def _resolve_ui_asset(path: str) -> Path | None:
    dist_root = UI_DIST_DIR.resolve()
    candidate = (dist_root / path).resolve()
    try:
        candidate.relative_to(dist_root)
    except ValueError:
        return None
    if candidate.is_file():
        return candidate
    return None


@app.middleware("http")
async def add_perf_headers(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["x-request-id"] = request_id
    response.headers["server-timing"] = f"app;dur={duration_ms:.1f}"
    if duration_ms >= 250 or random.random() < 0.02:
        logger.info(
            "perf method=%s path=%s status=%s dur_ms=%.1f req_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            request_id,
        )
    return response


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


async def _run_shift_estimate_scheduler() -> None:
    poll_seconds = max(settings.shift_estimate_scheduler_poll_seconds, 10)
    lock = asyncio.Lock()
    while True:
        try:
            scheduler_settings = shift_estimate_scheduler_service.load_settings()
            target_date = shift_estimate_scheduler_service.due_target_date(scheduler_settings)
            if target_date is not None and not lock.locked():
                async with lock:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(
                        None,
                        shift_estimate_scheduler_service.run_compute_for_date,
                        target_date,
                    )
        except Exception as exc:  # pragma: no cover - defensive against scheduler errors
            logger.warning("Shift-estimate scheduler error: %s", exc)
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


@app.on_event("startup")
async def start_shift_estimate_scheduler() -> None:
    if not settings.shift_estimate_scheduler_enabled:
        return
    # Note: each Uvicorn worker spawns its own scheduler task. Keep single-worker or
    # disable this scheduler if you scale out to avoid duplicate computations.
    if getattr(app.state, "shift_estimate_task", None):
        return
    app.state.shift_estimate_task = asyncio.create_task(_run_shift_estimate_scheduler())


@app.on_event("shutdown")
async def stop_backup_scheduler() -> None:
    task = getattr(app.state, "backup_task", None)
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


@app.on_event("shutdown")
async def stop_shift_estimate_scheduler() -> None:
    task = getattr(app.state, "shift_estimate_task", None)
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_ui(full_path: str, request: Request):
    if not UI_DIST_DIR.exists():
        raise HTTPException(
            status_code=404,
            detail="Frontend build not found. Run `pnpm build` in `ui` first.",
        )

    if full_path.startswith(("api/", "media_gallery/")):
        if not request.url.path.endswith("/"):
            query = f"?{request.url.query}" if request.url.query else ""
            return RedirectResponse(url=f"{request.url.path}/{query}", status_code=307)
        raise HTTPException(status_code=404)

    if full_path in {"health", "openapi.json"} or full_path.startswith(("docs", "redoc")):
        raise HTTPException(status_code=404)

    if full_path == "":
        full_path = "index.html"

    asset = _resolve_ui_asset(full_path)
    if asset is not None:
        return FileResponse(asset)

    if Path(full_path).suffix:
        raise HTTPException(status_code=404)

    return FileResponse(UI_DIST_DIR / "index.html")
