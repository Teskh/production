from __future__ import annotations

import math
from pathlib import Path

import av
from fastapi import HTTPException


MAX_QC_VIDEO_SECONDS = 150
QC_VIDEO_LIMIT_MESSAGE = "Los videos de esta ejecucion no pueden sumar mas de 2:30."


def validate_video_total(durations: list[float]) -> None:
    if any(not math.isfinite(value) or value <= 0 for value in durations):
        raise HTTPException(400, "No se pudo determinar la duracion del video.")
    # Ignore floating-point arithmetic noise, without rounding individual clips.
    if math.fsum(durations) > MAX_QC_VIDEO_SECONDS + 1e-6:
        raise HTTPException(400, QC_VIDEO_LIMIT_MESSAGE)


def video_duration_seconds(path: Path) -> float:
    """Read playback time, including WebM recordings without a duration header."""
    try:
        with av.open(str(path)) as container:
            if not container.streams.video:
                raise ValueError("No video stream")
            durations: list[float] = []
            if container.duration is not None:
                durations.append(float(container.duration / av.time_base))
            # Demux all playback streams so trailing audio also counts. Packet
            # timestamps work for MediaRecorder's WebM files with no duration header.
            timelines: dict[int, tuple[float, float]] = {}
            last_video_times: dict[int, tuple[float, float | None, float]] = {}
            for packet in container.demux():
                stream = packet.stream
                if stream.type not in {"video", "audio"} or not packet.size:
                    continue
                timestamp = packet.pts if packet.pts is not None else packet.dts
                if timestamp is None or packet.time_base is None:
                    continue
                start = float(timestamp * packet.time_base)
                length = float((packet.duration or 0) * packet.time_base)
                if length <= 0 and stream.type == "video" and stream.average_rate:
                    length = float(1 / stream.average_rate)
                if stream.type == "video":
                    latest = last_video_times.get(stream.index)
                    if latest is None:
                        last_video_times[stream.index] = (start, None, length)
                    elif start > latest[0]:
                        last_video_times[stream.index] = (start, latest[0], length)
                    elif start < latest[0] and (latest[1] is None or start > latest[1]):
                        last_video_times[stream.index] = (latest[0], start, latest[2])
                first, last = timelines.get(stream.index, (start, start))
                timelines[stream.index] = (min(first, start), max(last, start + length))
            for index, (latest, previous, length) in last_video_times.items():
                if length <= 0 and previous is not None:
                    first, last = timelines[index]
                    # Some WebM files also omit frame durations and frame rate.
                    # Include the final frame using the last timestamp interval.
                    timelines[index] = (first, max(last, latest + latest - previous))
            if not any(stream.index in timelines for stream in container.streams.video):
                raise ValueError("No video timestamps")
            first = (
                float(container.start_time / av.time_base)
                if container.start_time is not None
                else min(start for start, _ in timelines.values())
            )
            durations.append(max(end for _, end in timelines.values()) - first)
            duration = max(durations, default=0)
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError("Invalid video duration")
            return duration
    except (av.FFmpegError, OSError, ValueError, OverflowError) as exc:
        raise HTTPException(
            400, "No se pudo determinar la duracion del video. Seleccione otro archivo."
        ) from exc
