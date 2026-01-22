# for resetting database

PYTHONPATH=backend ./venv/bin/python -m app.scripts.reset_db --yes

# for starting backend

PYTHONPATH=. uvicorn app.main:app --reload --host 0.0.0.0 --port 2340

# migration

PYTHONPATH=. alembic upgrade head

# fix timestamps

PYTHONPATH=. python -m app.scripts.fix_today_timestamps --dry-run

# starting frontend
npm run preview -- --host 0.0.0.0 --port 5173
npm run dev -- --host 0.0.0.0 --port 5173