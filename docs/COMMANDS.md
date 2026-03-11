# DEV WORKFLOW
frontend: pnpm run dev -- --host 0.0.0.0 --port 5173
PYTHONPATH=. uvicorn app.main:app --reload --host 0.0.0.0 --port 2340

# PRODUCTION
(AFTER FRONTEND: PNPM BUILD)
PYTHONPATH=. uvicorn app.main:app --host 0.0.0.0 --port 5173


# migration
PYTHONPATH=. alembic upgrade head
PYTHONPATH=. ../venv/bin/python -m alembic -c alembic.ini upgrade head

# fix timestamps
PYTHONPATH=backend ./venv/bin/python -m app.scripts.fix_today_timestamps --dry-run
