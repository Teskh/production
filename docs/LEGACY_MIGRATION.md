# Legacy Migration Guide (GUI)

This guide targets the web UI in `backend/app/scripts/import_legacy_sqlite_gui.py`.
It assumes you start from a freshly recreated database and want to import from two
different legacy sqlite files.

## Quick rules

- Import order matters. Some sections depend on others.
- If you import from multiple legacy DBs, decide which DB is the "source of truth"
  for overlapping config (house types, panels, task definitions). The last import
  wins when using "Allow existing rows (merge/upsert)".
- Default station sequences are stored on `TaskDefinition.default_station_sequence`; the import does not create default-scope task applicability rows.
- For a fresh database you can leave "Allow existing rows" unchecked in the first
  pass. Use it in later passes when merging data from a second DB.

## Recommended sequence (single legacy DB)

1) Check: `House Types/Subtypes/Parameters`
2) Check: `Panel Definitions`
3) Check: `Tasks`
4) Check: `Task Applicability/Durations (module + panel)`
5) Check: `Specialties/Skills`
6) Check: `Workers`
7) Check: `Module Production Plan`
8) Check: `Task Logs (module)`
9) Check: `Panel Task Logs`
9) Optional any time: `Pause Reasons`, `Comment Templates`

Notes:
- `Module Production Plan` depends on houses.
- `Panel Task Logs` depends on panels + module production + tasks + workers.
- `Task Logs (module)` depends on module production + tasks + workers.
- `Task Applicability/Durations (module + panel)` depends on tasks (and houses for module rows, panels for panel rows).

## Two-DB import plan (your case)

You mentioned:
1) DB1: panel config + lots of panel production data.
2) DB2: module config + more task applicability + workers + other config.

### Pass A (DB1: panel-heavy)

Goal: bring panel definitions and panel production.

Check these boxes:
- `House Types/Subtypes/Parameters`
- `Panel Definitions`
- `Module Production Plan`
- `Panel Task Logs`
- Optional: `Pause Reasons`, `Comment Templates` if DB1 is your source for those.

Settings:
- Leave "Allow existing rows (merge/upsert)" OFF for the first pass.

### Pass B (DB2: module/task/worker-heavy)

Goal: bring module tasks config + workers + module task logs, and enrich any
overlapping config without dropping DB1 data.

Check these boxes:
- `Tasks`
- `Task Applicability/Durations (module + panel)`
- `Specialties/Skills`
- `Workers`
- `Module Production Plan`
- `Task Logs (module)`
- Optional: `House Types/Subtypes/Parameters`, `Panel Definitions` only if DB2 is
  intended to override those configs from DB1.

Settings:
- Turn "Allow existing rows (merge/upsert)" ON so overlapping IDs are updated
  instead of rejected.

### If you need a third pass

If DB2 should overwrite DB1 panel/task config (or vice versa), re-run just those
config sections with "Allow existing rows" ON so the latest pass wins.

## Troubleshooting

- Warnings like `house_type_id X not found` mean you imported module production
  before house types. Re-run with houses first.
- Warnings like `work_unit Y not found` mean module production rows were skipped
  (usually due to missing house types), so panel production could not attach.
- Warnings about `task_length` being trimmed/padded are expected when legacy
  panel data has mismatched arrays.
