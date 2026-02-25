from __future__ import annotations

import ipaddress
import shutil
import subprocess
import time
from collections.abc import Iterator
from functools import lru_cache
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_db
from app.core.config import settings
from app.models.admin import AdminUser
from app.models.stations import Station

router = APIRouter()

_MJPEG_BOUNDARY = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"


def _normalize_ip(value: str) -> str:
    candidate = value.strip()
    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Camera IP is required",
        )
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid camera IP",
        ) from exc


def _resolve_station_camera_ip(
    *,
    db: Session,
    station_id: int | None,
    ip: str | None,
) -> str:
    if station_id is not None:
        station = db.get(Station, station_id)
        if not station:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Station not found",
            )
        if not station.camera_feed_ip:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Station has no camera feed IP assigned",
            )
        return _normalize_ip(station.camera_feed_ip)

    if ip is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide station_id or ip",
        )

    normalized_ip = _normalize_ip(ip)
    station_exists = db.execute(
        select(Station.id).where(Station.camera_feed_ip == normalized_ip)
    ).scalar_one_or_none()
    if station_exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Unknown camera IP",
        )
    return normalized_ip


def _rtsp_url(ip: str) -> str:
    password = quote(settings.camera_rtsp_password, safe="")
    return (
        f"rtsp://{settings.camera_rtsp_username}:{password}@{ip}:{settings.camera_rtsp_port}"
        f"/cam/realmonitor?channel={settings.camera_rtsp_channel}&subtype={settings.camera_rtsp_subtype}"
    )


@lru_cache(maxsize=1)
def _ffmpeg_bin() -> str:
    candidates = [settings.camera_ffmpeg_bin]
    if settings.camera_ffmpeg_bin.lower() != "ffmpeg":
        candidates.append("ffmpeg")
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise RuntimeError(
        "ffmpeg executable not found. Install ffmpeg or set CAMERA_FFMPEG_BIN."
    )


def _start_ffmpeg_mjpeg(ip: str) -> subprocess.Popen[bytes]:
    fps = max(1, settings.camera_mjpeg_fps)
    cmd = [
        _ffmpeg_bin(),
        "-hide_banner",
        "-loglevel",
        "error",
        "-rtsp_transport",
        "tcp",
        "-i",
        _rtsp_url(ip),
        "-an",
        "-vf",
        f"fps={fps}",
        "-f",
        "mjpeg",
        "pipe:1",
    ]
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:
        raise RuntimeError(f"Failed to start ffmpeg: {exc}") from exc

    # Fail fast for auth/connectivity/URL errors so the client receives an HTTP error.
    time.sleep(0.35)
    if proc.poll() is not None:
        try:
            if proc.stderr:
                _ = proc.stderr.read()
        finally:
            raise RuntimeError(
                "Live view unavailable. Verify camera reachability and RTSP credentials."
            )
    return proc


def _mjpeg_stream(proc: subprocess.Popen[bytes]) -> Iterator[bytes]:
    if proc.stdout is None:
        proc.kill()
        raise RuntimeError("ffmpeg stdout pipe unavailable")

    buffer = b""
    try:
        while True:
            chunk = proc.stdout.read(4096)
            if not chunk:
                break
            buffer += chunk
            while True:
                start = buffer.find(b"\xff\xd8")
                end = buffer.find(b"\xff\xd9")
                if start == -1 or end == -1 or end < start:
                    break
                frame = buffer[start : end + 2]
                buffer = buffer[end + 2 :]
                yield _MJPEG_BOUNDARY + frame + b"\r\n"
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=1)
        except Exception:
            proc.kill()


@router.get("/live.mjpeg")
def live_mjpeg(
    station_id: int | None = Query(default=None),
    ip: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> StreamingResponse:
    camera_ip = _resolve_station_camera_ip(db=db, station_id=station_id, ip=ip)
    try:
        proc = _start_ffmpeg_mjpeg(camera_ip)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    return StreamingResponse(
        _mjpeg_stream(proc),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )
