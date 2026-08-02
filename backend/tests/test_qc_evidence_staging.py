from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.routes.qc_runtime import _validate_staged_evidence_uploads


def upload(
    upload_id: int,
    *,
    check_instance_id: int = 20,
    uploaded_by_user_id: int = 7,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=upload_id,
        check_instance_id=check_instance_id,
        uploaded_by_user_id=uploaded_by_user_id,
    )


class QCEvidenceStagingTests(unittest.TestCase):
    def test_multiple_staged_uploads_are_accepted(self) -> None:
        _validate_staged_evidence_uploads(
            [upload(1), upload(2), upload(3)],
            [1, 2, 3],
            check_instance_id=20,
            uploaded_by_user_id=7,
        )

    def test_missing_or_consumed_upload_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            _validate_staged_evidence_uploads(
                [upload(1)],
                [1, 2],
                check_instance_id=20,
                uploaded_by_user_id=7,
            )

        self.assertEqual(raised.exception.status_code, 409)

    def test_upload_from_another_check_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            _validate_staged_evidence_uploads(
                [upload(1, check_instance_id=99)],
                [1],
                check_instance_id=20,
                uploaded_by_user_id=7,
            )

        self.assertEqual(raised.exception.status_code, 409)

    def test_upload_from_another_qc_user_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            _validate_staged_evidence_uploads(
                [upload(1, uploaded_by_user_id=8)],
                [1],
                check_instance_id=20,
                uploaded_by_user_id=7,
            )

        self.assertEqual(raised.exception.status_code, 403)

    def test_duplicate_upload_ids_are_rejected(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            _validate_staged_evidence_uploads(
                [upload(1)],
                [1, 1],
                check_instance_id=20,
                uploaded_by_user_id=7,
            )

        self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
