from __future__ import annotations

import hashlib
import shutil
import sqlite3
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

from app.core.config import BASE_DIR, settings

RECORDER_SQLITE_PATH = Path(
    "/mnt/d/GMB VM/APP/respaldocamarasprod/runtime/respaldos_cctv.sqlite3"
)
RECORDER_RECORDINGS_ROOT = Path("/mnt/d/GMB VM/APP/respaldocamarasprod/respaldos")
TASK_FOOTAGE_CLIPS_DIR = BASE_DIR / "runtime" / "task_footage_clips"
_MERGE_TOLERANCE_SECONDS = 1.0

FOOTAGE_STATUS_AVAILABLE = "available"
FOOTAGE_STATUS_PARTIAL = "partial"
FOOTAGE_STATUS_MISSING = "missing"
FOOTAGE_STATUS_UNMAPPED = "unmapped"
FOOTAGE_STATUS_NO_TIMEFRAME = "no_timeframe"


class RecorderIntegrationError(RuntimeError):
    pass


@dataclass(frozen=True)
class RecorderSegment:
    segment_id: int
    camera_id: int | None
    camera_name: str | None
    panel: str | None
    ip: str | None
    start_utc: datetime
    end_utc: datetime
    absolute_path: str | None
    relative_path: str | None
    metadata_path: str | None
    file_name: str | None
    resolved_path: Path


@dataclass(frozen=True)
class CoverageInterval:
    segment: RecorderSegment
    start_utc: datetime
    end_utc: datetime


@dataclass(frozen=True)
class CoverageSummary:
    status: str
    status_label: str
    camera_ip: str | None
    requested_start_utc: datetime | None
    requested_end_utc: datetime | None
    requested_duration_seconds: float | None
    available_duration_seconds: float | None
    coverage_ratio: float | None
    available_start_utc: datetime | None
    available_end_utc: datetime | None
    segments: list[RecorderSegment]
    intervals: list[CoverageInterval]
    warning: str | None = None


@dataclass(frozen=True)
class PlaybackPlan:
    coverage: CoverageSummary
    mode: str
    file_path: Path | None
    playback_start_seconds: float | None
    playback_end_seconds: float | None


def footage_status_label(status: str) -> str:
    labels = {
        FOOTAGE_STATUS_AVAILABLE: "Footage completo",
        FOOTAGE_STATUS_PARTIAL: "Footage parcial",
        FOOTAGE_STATUS_MISSING: "Sin footage",
        FOOTAGE_STATUS_UNMAPPED: "Sin camara asignada",
        FOOTAGE_STATUS_NO_TIMEFRAME: "Sin rango horario",
    }
    return labels.get(status, status)


def as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def duration_seconds(start: datetime | None, end: datetime | None) -> float | None:
    if start is None or end is None:
        return None
    value = (end - start).total_seconds()
    return round(max(value, 0.0), 3)


def _parse_sqlite_iso(value: str) -> datetime:
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    dt = datetime.fromisoformat(normalized)
    return as_utc(dt)  # type: ignore[return-value]


def _utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _sqlite_uri(path: Path) -> str:
    return f"file:{quote(str(path), safe='/:')}?mode=ro"


def _open_recorder_db() -> sqlite3.Connection:
    if not RECORDER_SQLITE_PATH.exists():
        raise RecorderIntegrationError(
            f"Recorder SQLite not found at {RECORDER_SQLITE_PATH}"
        )
    connection = sqlite3.connect(_sqlite_uri(RECORDER_SQLITE_PATH), uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _resolve_segment_path(row: sqlite3.Row) -> Path | None:
    absolute_path = str(row["absolute_path"] or "").strip()
    if absolute_path:
        absolute_candidate = Path(absolute_path)
        if absolute_candidate.exists():
            return absolute_candidate

    relative_path = str(row["relative_path"] or "").strip()
    if relative_path:
        relative_candidate = RECORDER_RECORDINGS_ROOT / relative_path
        if relative_candidate.exists():
            return relative_candidate

    return None


def _fetch_segments(camera_ip: str, start_utc: datetime, end_utc: datetime) -> list[RecorderSegment]:
    query = """
        SELECT
            rs.id,
            rs.camera_id,
            rs.start_utc_iso,
            rs.end_utc_iso,
            rs.absolute_path,
            rs.relative_path,
            rs.metadata_path,
            rs.file_name,
            c.name AS camera_name,
            c.panel AS panel,
            c.ip AS ip
        FROM recording_segments rs
        JOIN cameras c ON c.id = rs.camera_id
        WHERE c.ip = ?
          AND rs.end_utc_iso >= ?
          AND rs.start_utc_iso <= ?
          AND rs.status = 'completed'
        ORDER BY rs.start_utc_iso ASC
    """

    with _open_recorder_db() as connection:
        rows = list(connection.execute(query, (camera_ip, _utc_iso(start_utc), _utc_iso(end_utc))))

    segments: list[RecorderSegment] = []
    for row in rows:
        resolved_path = _resolve_segment_path(row)
        if resolved_path is None:
            continue
        segments.append(
            RecorderSegment(
                segment_id=int(row["id"]),
                camera_id=int(row["camera_id"]) if row["camera_id"] is not None else None,
                camera_name=str(row["camera_name"]) if row["camera_name"] is not None else None,
                panel=str(row["panel"]) if row["panel"] is not None else None,
                ip=str(row["ip"]) if row["ip"] is not None else None,
                start_utc=_parse_sqlite_iso(str(row["start_utc_iso"])),
                end_utc=_parse_sqlite_iso(str(row["end_utc_iso"])),
                absolute_path=str(row["absolute_path"]) if row["absolute_path"] is not None else None,
                relative_path=str(row["relative_path"]) if row["relative_path"] is not None else None,
                metadata_path=str(row["metadata_path"]) if row["metadata_path"] is not None else None,
                file_name=str(row["file_name"]) if row["file_name"] is not None else None,
                resolved_path=resolved_path,
            )
        )
    return segments


def _merge_intervals(intervals: list[CoverageInterval]) -> list[tuple[datetime, datetime]]:
    if not intervals:
        return []

    merged: list[tuple[datetime, datetime]] = []
    tolerance = timedelta(seconds=_MERGE_TOLERANCE_SECONDS)
    for interval in intervals:
        if not merged:
            merged.append((interval.start_utc, interval.end_utc))
            continue
        previous_start, previous_end = merged[-1]
        if interval.start_utc <= previous_end + tolerance:
            merged[-1] = (previous_start, max(previous_end, interval.end_utc))
            continue
        merged.append((interval.start_utc, interval.end_utc))
    return merged


def _clip_key(task_instance_id: int, intervals: list[CoverageInterval]) -> str:
    digest = hashlib.sha256()
    digest.update(str(task_instance_id).encode("utf-8"))
    for interval in intervals:
        digest.update(
            "|".join(
                [
                    str(interval.segment.segment_id),
                    str(interval.segment.resolved_path),
                    interval.start_utc.isoformat(),
                    interval.end_utc.isoformat(),
                ]
            ).encode("utf-8")
        )
    return digest.hexdigest()[:16]


def _concat_file_line(path: Path) -> str:
    escaped = str(path).replace("'", "'\\''")
    return f"file '{escaped}'\n"


@lru_cache(maxsize=1)
def _ffmpeg_bin() -> str:
    candidates = [settings.camera_ffmpeg_bin]
    if settings.camera_ffmpeg_bin.lower() != "ffmpeg":
        candidates.append("ffmpeg")
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise RecorderIntegrationError("ffmpeg executable not found.")


def _run_ffmpeg(command: list[str]) -> None:
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode == 0:
        return
    message = (completed.stderr or completed.stdout or "ffmpeg failed").strip()
    raise RecorderIntegrationError(message)


def _ensure_generated_clip(task_instance_id: int, intervals: list[CoverageInterval]) -> Path:
    if not intervals:
        raise RecorderIntegrationError("No footage intervals available to build a clip.")

    TASK_FOOTAGE_CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    clip_path = TASK_FOOTAGE_CLIPS_DIR / f"task_{task_instance_id}_{_clip_key(task_instance_id, intervals)}.mp4"
    if clip_path.exists() and clip_path.stat().st_size > 0:
        return clip_path

    ffmpeg_bin = _ffmpeg_bin()
    with tempfile.TemporaryDirectory(dir=TASK_FOOTAGE_CLIPS_DIR) as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        partial_paths: list[Path] = []

        for index, interval in enumerate(intervals):
            start_offset = max(
                (interval.start_utc - interval.segment.start_utc).total_seconds(),
                0.0,
            )
            clip_duration = max(
                (interval.end_utc - interval.start_utc).total_seconds(),
                0.0,
            )
            if clip_duration <= 0:
                continue
            partial_path = temp_dir / f"part_{index:03d}.mp4"
            partial_paths.append(partial_path)
            _run_ffmpeg(
                [
                    ffmpeg_bin,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-ss",
                    f"{start_offset:.3f}",
                    "-i",
                    str(interval.segment.resolved_path),
                    "-t",
                    f"{clip_duration:.3f}",
                    "-an",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    str(partial_path),
                ]
            )

        if not partial_paths:
            raise RecorderIntegrationError("No playable footage intervals were generated.")

        if len(partial_paths) == 1:
            shutil.move(str(partial_paths[0]), clip_path)
            return clip_path

        concat_list_path = temp_dir / "concat.txt"
        concat_list_path.write_text(
            "".join(_concat_file_line(path) for path in partial_paths),
            encoding="utf-8",
        )
        output_path = temp_dir / "output.mp4"
        _run_ffmpeg(
            [
                ffmpeg_bin,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_list_path),
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                str(output_path),
            ]
        )
        shutil.move(str(output_path), clip_path)
        return clip_path


def resolve_task_footage(
    *,
    camera_ip: str | None,
    started_at: datetime | None,
    completed_at: datetime | None,
) -> CoverageSummary:
    normalized_camera_ip = camera_ip.strip() if camera_ip else None
    start_utc = as_utc(started_at)
    end_utc = as_utc(completed_at)
    requested_duration = duration_seconds(start_utc, end_utc)

    if start_utc is None or end_utc is None or requested_duration is None or end_utc < start_utc:
        return CoverageSummary(
            status=FOOTAGE_STATUS_NO_TIMEFRAME,
            status_label=footage_status_label(FOOTAGE_STATUS_NO_TIMEFRAME),
            camera_ip=normalized_camera_ip,
            requested_start_utc=start_utc,
            requested_end_utc=end_utc,
            requested_duration_seconds=requested_duration,
            available_duration_seconds=None,
            coverage_ratio=None,
            available_start_utc=None,
            available_end_utc=None,
            segments=[],
            intervals=[],
        )

    if not normalized_camera_ip:
        return CoverageSummary(
            status=FOOTAGE_STATUS_UNMAPPED,
            status_label=footage_status_label(FOOTAGE_STATUS_UNMAPPED),
            camera_ip=None,
            requested_start_utc=start_utc,
            requested_end_utc=end_utc,
            requested_duration_seconds=requested_duration,
            available_duration_seconds=0.0,
            coverage_ratio=0.0,
            available_start_utc=None,
            available_end_utc=None,
            segments=[],
            intervals=[],
        )

    segments = _fetch_segments(normalized_camera_ip, start_utc, end_utc)
    intervals: list[CoverageInterval] = []
    for segment in segments:
        overlap_start = max(start_utc, segment.start_utc)
        overlap_end = min(end_utc, segment.end_utc)
        if overlap_end <= overlap_start:
            continue
        intervals.append(
            CoverageInterval(
                segment=segment,
                start_utc=overlap_start,
                end_utc=overlap_end,
            )
        )

    merged = _merge_intervals(intervals)
    available_duration = round(
        sum(max((end - start).total_seconds(), 0.0) for start, end in merged),
        3,
    )
    available_start = merged[0][0] if merged else None
    available_end = merged[-1][1] if merged else None
    coverage_ratio = (
        round(min(available_duration / requested_duration, 1.0), 4)
        if requested_duration and requested_duration > 0
        else None
    )

    is_full = (
        len(merged) == 1
        and merged[0][0] <= start_utc
        and merged[0][1] >= end_utc
    )
    if is_full:
        status = FOOTAGE_STATUS_AVAILABLE
    elif merged:
        status = FOOTAGE_STATUS_PARTIAL
    else:
        status = FOOTAGE_STATUS_MISSING

    warning = None
    if status == FOOTAGE_STATUS_PARTIAL:
        warning = "El rango solicitado solo tiene footage parcial."
    elif status == FOOTAGE_STATUS_MISSING:
        warning = "No se encontraron segmentos de video para este rango."

    return CoverageSummary(
        status=status,
        status_label=footage_status_label(status),
        camera_ip=normalized_camera_ip,
        requested_start_utc=start_utc,
        requested_end_utc=end_utc,
        requested_duration_seconds=requested_duration,
        available_duration_seconds=available_duration,
        coverage_ratio=coverage_ratio,
        available_start_utc=available_start,
        available_end_utc=available_end,
        segments=segments,
        intervals=intervals,
        warning=warning,
    )


def build_playback_plan(
    *,
    task_instance_id: int,
    camera_ip: str | None,
    started_at: datetime | None,
    completed_at: datetime | None,
) -> PlaybackPlan:
    coverage = resolve_task_footage(
        camera_ip=camera_ip,
        started_at=started_at,
        completed_at=completed_at,
    )
    if not coverage.intervals:
        return PlaybackPlan(
            coverage=coverage,
            mode="unavailable",
            file_path=None,
            playback_start_seconds=None,
            playback_end_seconds=None,
        )

    if len(coverage.intervals) == 1:
        interval = coverage.intervals[0]
        start_offset = round(
            max((interval.start_utc - interval.segment.start_utc).total_seconds(), 0.0),
            3,
        )
        end_offset = round(
            max((interval.end_utc - interval.segment.start_utc).total_seconds(), 0.0),
            3,
        )
        return PlaybackPlan(
            coverage=coverage,
            mode="source",
            file_path=interval.segment.resolved_path,
            playback_start_seconds=start_offset,
            playback_end_seconds=end_offset,
        )

    clip_path = _ensure_generated_clip(task_instance_id, coverage.intervals)
    return PlaybackPlan(
        coverage=coverage,
        mode="generated",
        file_path=clip_path,
        playback_start_seconds=0.0,
        playback_end_seconds=coverage.available_duration_seconds,
    )
