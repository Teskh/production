from datetime import date
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.api.routes.shift_estimates import (
    MAX_MANUAL_REQUEST_DAYS,
    compute_shift_estimates,
)
from app.schemas.shift_estimates import (
    ShiftEstimateComputeRequest,
    ShiftEstimateComputeResponse,
)


class ShiftEstimateManualComputeLimitTests(unittest.TestCase):
    def test_manual_compute_rejects_more_than_one_chunk(self) -> None:
        payload = ShiftEstimateComputeRequest(
            from_date=date(2026, 8, 1),
            to_date=date(2026, 8, 1 + MAX_MANUAL_REQUEST_DAYS),
        )

        with self.assertRaises(HTTPException) as raised:
            compute_shift_estimates(payload, db=None)  # type: ignore[arg-type]

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn(str(MAX_MANUAL_REQUEST_DAYS), str(raised.exception.detail))

    @patch("app.api.routes.shift_estimates.compute_shift_estimate_range")
    def test_manual_compute_accepts_exactly_one_chunk(self, compute_mock) -> None:
        expected = ShiftEstimateComputeResponse(
            from_date=date(2026, 8, 1),
            to_date=date(2026, 8, 14),
            processed_days=14,
            computed_count=0,
            computed_worker_rows=0,
            skipped_existing=0,
            excluded_days=0,
            worker_errors=0,
        )
        compute_mock.return_value = expected
        payload = ShiftEstimateComputeRequest(
            from_date=date(2026, 8, 1),
            to_date=date(2026, 8, 14),
        )

        result = compute_shift_estimates(payload, db=None)  # type: ignore[arg-type]

        self.assertEqual(result, expected)
        compute_mock.assert_called_once_with(None, payload.from_date, payload.to_date)


if __name__ == "__main__":
    unittest.main()
