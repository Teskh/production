from __future__ import annotations

import io
import struct
from fractions import Fraction
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import av
from fastapi import HTTPException, UploadFile
from sqlalchemy import JSON, MetaData, create_engine, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session
from starlette.datastructures import Headers


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.routes import qc_runtime
from app.db.base import Base
from app.models.enums import QCCheckOrigin, QCCheckStatus, QCExecutionOutcome, TaskScope
from app.models.qc import MediaAsset, QCCheckInstance, QCExecution, QCEvidence, QCEvidenceUpload, QCReworkTask
from app.schemas.qc_runtime import QCExecutionCreate
from app.services.qc_evidence import validate_video_total, video_duration_seconds


def make_video(path: Path, seconds: int, *, streaming_webm: bool = False) -> None:
    options = {"live": "1"} if streaming_webm else None
    with av.open(str(path), "w", options=options) as output:
        stream = output.add_stream("libvpx" if streaming_webm else "libx264", rate=1)
        stream.width = 16
        stream.height = 16
        stream.pix_fmt = "yuv420p"
        for index in range(seconds):
            frame = av.VideoFrame(16, 16, "yuv420p")
            for plane in frame.planes:
                plane.update(bytes(plane.buffer_size))
            frame.pts = index
            for packet in stream.encode(frame):
                output.mux(packet)
        for packet in stream.encode():
            output.mux(packet)


def file_upload(data: bytes, mime: str = "video/mp4") -> UploadFile:
    return UploadFile(
        io.BytesIO(data), filename="evidence.mp4", headers=Headers({"content-type": mime})
    )


class QCVideoDurationTests(unittest.TestCase):
    def test_exact_limit_is_allowed_without_rounding_clips(self) -> None:
        validate_video_total([31, 27])
        validate_video_total([75, 75])
        validate_video_total([0.1] * 1500)
        validate_video_total([])

    def test_combined_or_individual_duration_over_limit_is_rejected(self) -> None:
        for durations in ([75, 75.001], [151], [60, 60, 31]):
            with self.subTest(durations=durations), self.assertRaises(HTTPException) as raised:
                validate_video_total(durations)
            self.assertEqual(raised.exception.status_code, 400)

    def test_unknown_or_invalid_duration_is_rejected(self) -> None:
        for duration in (float("nan"), float("inf"), 0, -1):
            with self.subTest(duration=duration), self.assertRaises(HTTPException):
                validate_video_total([duration])

    def test_real_mp4_uses_playback_timestamps(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.mp4"
            make_video(path, 31)
            self.assertAlmostEqual(video_duration_seconds(path), 31, places=3)

    def test_webm_without_duration_metadata_is_measured(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.webm"
            make_video(path, 27, streaming_webm=True)
            with av.open(str(path)) as container:
                self.assertIsNone(container.duration)
            self.assertAlmostEqual(video_duration_seconds(path), 27, places=3)

    def test_invalid_video_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.mp4"
            path.write_bytes(b"not a video")
            with self.assertRaises(HTTPException):
                video_duration_seconds(path)

    def test_webm_without_frame_duration_counts_the_final_frame(self) -> None:
        stream = SimpleNamespace(index=0, type="video", average_rate=None)
        packets = [SimpleNamespace(
            stream=stream, size=1, pts=timestamp, dts=timestamp,
            time_base=Fraction(1, 1000), duration=0,
        ) for timestamp in (60000, 61000, 62000)]
        container = SimpleNamespace(
            streams=SimpleNamespace(video=[stream]), duration=None, start_time=None,
            demux=lambda: iter(packets),
        )
        with patch("app.services.qc_evidence.av.open") as opened:
            opened.return_value.__enter__.return_value = container
            self.assertEqual(video_duration_seconds(Path("recording.webm")), 3)

    def test_upload_writer_accepts_more_than_previous_50_mib(self) -> None:
        class LargeFile:
            remaining = 51

            def read(self, count: int) -> bytes:
                if self.remaining == 0:
                    return b""
                self.remaining -= 1
                return bytes(count)

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "large.mp4"
            size = qc_runtime._store_qc_evidence_upload(SimpleNamespace(file=LargeFile()), path)
            self.assertEqual(size, 51 * 1024 * 1024)
            self.assertEqual(path.stat().st_size, size)


class QCVideoUploadTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.media_patch = patch.object(qc_runtime, "MEDIA_GALLERY_DIR", self.root)
        self.evidence_patch = patch.object(qc_runtime, "QC_EVIDENCE_DIR", self.root / "qc_evidence")
        self.media_patch.start()
        self.evidence_patch.start()
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        metadata = MetaData()
        for table in Base.metadata.tables.values():
            table.to_metadata(metadata)
        # Use SQLite for transaction behavior; only JSONB needs a portable type.
        for model in (MediaAsset, QCExecution, QCEvidence, QCCheckInstance, QCEvidenceUpload, QCReworkTask):
            table = metadata.tables[model.__tablename__]
            for column in table.columns:
                if isinstance(column.type, JSONB):
                    column.type = JSON()
            table.create(self.engine)
        self.db = Session(self.engine)
        self.admin = SimpleNamespace(role="QC", id=7)
        self.db.add(QCCheckInstance(
            id=20, origin=QCCheckOrigin.MANUAL, scope=TaskScope.MODULE,
            work_unit_id=1, status=QCCheckStatus.OPEN, opened_at=datetime.now(),
        ))
        self.db.add(QCExecution(
            id=1, check_instance_id=20, outcome=QCExecutionOutcome.PASS,
            performed_by_user_id=7, performed_at=datetime.now(),
        ))
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()
        self.media_patch.stop()
        self.evidence_patch.stop()
        self.directory.cleanup()

    def existing_video(self, duration: float | None, storage_key: str = "old.mp4") -> MediaAsset:
        media = MediaAsset(
            storage_key=storage_key, mime_type="video/mp4", size_bytes=1,
            duration_seconds=duration, created_at=datetime.now(),
        )
        self.db.add(media)
        self.db.flush()
        self.db.add(QCEvidence(execution_id=1, media_asset_id=media.id, captured_at=datetime.now()))
        self.db.commit()
        return media

    def upload(self, seconds: int):
        path = self.root / "source.mp4"
        make_video(path, seconds)
        return qc_runtime.upload_execution_evidence(1, file_upload(path.read_bytes()), self.admin, self.db)

    def test_gallery_additions_count_existing_videos_at_exact_limit(self) -> None:
        self.existing_video(120)
        result = self.upload(30)
        self.assertAlmostEqual(result.duration_seconds, 30)
        self.assertEqual(len(list(self.db.scalars(select(QCEvidence)))), 2)

    def test_gallery_rejection_rolls_back_and_removes_new_file(self) -> None:
        self.existing_video(121)
        with self.assertRaises(HTTPException):
            self.upload(30)
        self.assertEqual(len(list(self.db.scalars(select(QCEvidence)))), 1)
        self.assertEqual(list((self.root / "qc_evidence").iterdir()), [])

    def test_large_short_video_is_accepted_without_size_cap(self) -> None:
        path = self.root / "large.mp4"
        make_video(path, 1)
        # A valid MP4 free box increases file size without changing playback time.
        padding_size = 51 * 1024 * 1024
        with path.open("ab") as output:
            output.write(struct.pack(">I4s", padding_size, b"free"))
            output.write(bytes(padding_size - 8))
        result = qc_runtime.upload_execution_evidence(
            1, file_upload(path.read_bytes()), self.admin, self.db
        )
        self.assertAlmostEqual(result.duration_seconds, 1)
        media = self.db.get(MediaAsset, result.media_asset_id)
        self.assertGreater(media.size_bytes, 50 * 1024 * 1024)

    def test_individual_overlong_video_is_removed_before_staging(self) -> None:
        path = self.root / "overlong.mp4"
        make_video(path, 151)
        with self.assertRaises(HTTPException):
            qc_runtime.stage_execution_evidence(
                20, "client-too-long", file_upload(path.read_bytes()), self.admin, self.db
            )
        self.assertEqual(list((self.root / "qc_evidence").iterdir()), [])
        self.assertEqual(list(self.db.scalars(select(QCEvidenceUpload))), [])

    def test_legacy_video_without_saved_duration_counts_towards_limit(self) -> None:
        make_video(self.root / "old.mp4", 121)
        self.existing_video(None)
        with self.assertRaises(HTTPException):
            self.upload(30)

    def test_photos_do_not_use_video_budget(self) -> None:
        self.existing_video(150)
        result = qc_runtime.upload_execution_evidence(
            1, file_upload(b"photo", "image/jpeg"), self.admin, self.db
        )
        self.assertIsNone(result.duration_seconds)

    def test_staged_evidence_cannot_bypass_combined_limit_at_execution(self) -> None:
        for index in range(2):
            media = MediaAsset(
                storage_key=f"staged-{index}.mp4", mime_type="video/mp4", size_bytes=1,
                duration_seconds=76, created_at=datetime.now(),
            )
            self.db.add(media)
            self.db.flush()
            self.db.add(QCEvidenceUpload(
                id=index + 1, check_instance_id=20, media_asset_id=media.id,
                uploaded_by_user_id=7, client_upload_id=f"client-{index}", created_at=datetime.now(),
            ))
        self.db.commit()
        with self.assertRaises(HTTPException) as raised:
            qc_runtime.execute_qc_check(
                20, QCExecutionCreate(outcome="Pass", evidence_upload_ids=[1, 2]), self.admin, self.db
            )
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(len(list(self.db.scalars(select(QCExecution)))), 1)
        self.assertEqual(len(list(self.db.scalars(select(QCEvidenceUpload)))), 2)


if __name__ == "__main__":
    unittest.main()
