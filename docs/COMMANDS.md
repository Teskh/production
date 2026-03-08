# DEV WORKFLOW
frontend: pnpm run dev -- --host 0.0.0.0 --port 5173
backend: uvicorn app.main:app --reload --host 0.0.0.0 --port 2340

# PRODUCTION
(AFTER FRONTEND: PNPM BUILD)
SIMPLY FROM BACKEND: uvicorn app.main:app --host 0.0.0.0 --port 5173


# migration
PYTHONPATH=. alembic upgrade head
PYTHONPATH=. ../venv/bin/python -m alembic -c alembic.ini upgrade head

# fix timestamps
PYTHONPATH=backend ./venv/bin/python -m app.scripts.fix_today_timestamps --dry-run

# SCRIPT normalize assembly line types (A/B/C -> 1/2/3)
PYTHONPATH=backend ./venv/bin/python -m app.scripts.normalize_line_types --dry-run

# SCRIPT for reporting panel production vs attendace
PYTHONPATH=backend venv/bin/python -m app.scripts.panel_line_attendance_correlation
