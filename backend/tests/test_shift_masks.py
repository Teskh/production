from __future__ import annotations

import sys
import unittest
from datetime import date, datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.shift_masks import ShiftMaskResolver  # noqa: E402


class ShiftMaskResolverTests(unittest.TestCase):
    def test_missing_weekday_uses_regular_shift_fallback(self) -> None:
        resolver = ShiftMaskResolver({}, {})

        minutes = resolver.masked_minutes(
            5,
            datetime(2026, 8, 18, 0, 0),
            datetime(2026, 8, 18, 23, 59),
        )

        self.assertEqual(minutes, 520.0)

    def test_missing_weekend_contributes_zero(self) -> None:
        resolver = ShiftMaskResolver({}, {})

        minutes = resolver.masked_minutes(
            5,
            datetime(2026, 8, 22, 0, 0),
            datetime(2026, 8, 22, 23, 59),
        )

        self.assertEqual(minutes, 0.0)

    def test_explicit_no_shift_row_contributes_zero(self) -> None:
        resolver = ShiftMaskResolver(
            masks_by_station_day={5: {date(2026, 8, 18): None}},
            masks_by_sequence_day={},
        )

        minutes = resolver.masked_minutes(
            5,
            datetime(2026, 8, 18, 0, 0),
            datetime(2026, 8, 18, 23, 59),
        )

        self.assertEqual(minutes, 0.0)

    def test_real_estimate_overrides_weekday_fallback(self) -> None:
        resolver = ShiftMaskResolver(
            masks_by_station_day={
                5: {
                    date(2026, 8, 18): (
                        datetime(2026, 8, 18, 9, 0),
                        datetime(2026, 8, 18, 16, 0),
                    )
                }
            },
            masks_by_sequence_day={},
        )

        minutes = resolver.masked_minutes(
            5,
            datetime(2026, 8, 18, 0, 0),
            datetime(2026, 8, 18, 23, 59),
        )

        self.assertEqual(minutes, 420.0)

    def test_each_day_uses_its_own_real_explicit_or_fallback_mask(self) -> None:
        resolver = ShiftMaskResolver(
            masks_by_station_day={
                5: {
                    date(2026, 8, 17): (
                        datetime(2026, 8, 17, 8, 20),
                        datetime(2026, 8, 17, 16, 45),
                    ),
                    date(2026, 8, 18): None,
                }
            },
            masks_by_sequence_day={},
        )

        minutes = resolver.masked_minutes(
            5,
            datetime(2026, 8, 17, 16, 30),
            datetime(2026, 8, 19, 9, 0),
        )

        self.assertEqual(minutes, 55.0)


if __name__ == "__main__":
    unittest.main()
