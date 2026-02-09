# starting frontend
npm run preview -- --host 0.0.0.0 --port 5173
npm run dev -- --host 0.0.0.0 --port 5173

# for starting backend
PYTHONPATH=. uvicorn app.main:app --reload --host 0.0.0.0 --port 2340

# for resetting database
PYTHONPATH=backend ./venv/bin/python -m app.scripts.reset_db --yes

# migration
PYTHONPATH=. alembic upgrade head

# fix timestamps
PYTHONPATH=backend ./venv/bin/python -m app.scripts.fix_today_timestamps --dry-run

# normalize assembly line types (A/B/C -> 1/2/3)
PYTHONPATH=backend ./venv/bin/python -m app.scripts.normalize_line_types --dry-run



