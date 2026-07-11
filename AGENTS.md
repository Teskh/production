This project is a large-scale refactor of an earlier production application. The backend
and UI now contain substantial working behavior; do not treat current pages as placeholders.

Read `docs/ARCHITECTURE.md` for the current system map and `docs/COMMANDS.md` for verified
development, migration, test, and production commands.

Always use `uv` instead of `pip` for Python dependencies. The root `pyproject.toml` and
`uv.lock` are the dependency source of truth; `uv sync --dev` creates the root `.venv`.
