from __future__ import annotations

import sys
import unittest
from datetime import timedelta
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.routes.worker_sessions import _IDLE_TIMEOUT_SECONDS
from app.core.security import DEFAULT_SESSION_EXPIRY_HOURS, session_expiry, utc_now


class SessionLifetimeTests(unittest.TestCase):
    def test_default_session_lifetime_is_two_days(self) -> None:
        before = utc_now()
        expires_at = session_expiry()
        after = utc_now()

        self.assertEqual(DEFAULT_SESSION_EXPIRY_HOURS, 48)
        self.assertGreaterEqual(expires_at - before, timedelta(hours=48))
        self.assertLessEqual(expires_at - after, timedelta(hours=48))

    def test_worker_idle_logout_matches_session_lifetime(self) -> None:
        self.assertEqual(_IDLE_TIMEOUT_SECONDS, 48 * 60 * 60)


if __name__ == "__main__":
    unittest.main()
