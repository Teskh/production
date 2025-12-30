import React, { useMemo, useState } from 'react';
import {
  ClipboardCheck,
  Filter,
  ListChecks,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react';

const TaskDefs: React.FC = () => {
  const [selectedTaskId, setSelectedTaskId] = useState(1);

  const tasks = [
    {
      id: 1,
      name: 'Frame Assembly',
      scope: 'panel',
      active: true,
      skippable: false,
      concurrent: false,
    },
    {
      id: 2,
      name: 'Sheathing',
      scope: 'panel',
      active: true,
      skippable: true,
      concurrent: false,
    },
    {
      id: 3,
      name: 'Module Harness',
      scope: 'module',
      active: true,
      skippable: false,
      concurrent: true,
    },
  ];

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? tasks[0],
    [selectedTaskId, tasks]
  );

  const dependencies = ['Frame Assembly', 'Sheathing', 'Module Harness', 'QC Check'];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Configuration / Task Definitions
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">Task Definition Studio</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Build task templates, dependencies, and crew restrictions.
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" /> New task
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">Task catalog</h2>
              <p className="text-sm text-[var(--ink-muted)]">Grouped by scope and station.</p>
            </div>
            <div className="flex gap-2">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
                <input
                  type="search"
                  placeholder="Search tasks"
                  className="h-9 rounded-full border border-black/10 bg-white pl-9 pr-4 text-sm"
                />
              </label>
              <button className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm">
                <Filter className="h-4 w-4" /> Filters
              </button>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {tasks.map((task, index) => (
              <button
                key={task.id}
                onClick={() => setSelectedTaskId(task.id)}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
                  selectedTaskId === task.id
                    ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
                    : 'border-black/5 bg-white'
                }`}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(201,215,245,0.55)] text-[var(--ink)]">
                    <ClipboardCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--ink)]">{task.name}</p>
                    <p className="text-xs text-[var(--ink-muted)]">Scope: {task.scope}</p>
                  </div>
                </div>
                <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-[var(--ink-muted)]">
                  {task.active ? 'Active' : 'Inactive'}
                </span>
              </button>
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Edit</p>
                <h2 className="text-lg font-display text-[var(--ink)]">{selectedTask.name}</h2>
              </div>
              <ListChecks className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>

            <div className="mt-4 space-y-4">
              <label className="text-sm text-[var(--ink-muted)]">
                Task name
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  defaultValue={selectedTask.name}
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-[var(--ink-muted)]">
                  Scope
                  <select
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    defaultValue={selectedTask.scope}
                  >
                    <option value="panel">panel</option>
                    <option value="module">module</option>
                  </select>
                </label>
                <label className="text-sm text-[var(--ink-muted)]">
                  Status
                  <select
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    defaultValue={selectedTask.active ? 'Active' : 'Inactive'}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-2">
                <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                  <input type="checkbox" defaultChecked={selectedTask.skippable} /> Skippable
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                  <input type="checkbox" defaultChecked={selectedTask.concurrent} /> Concurrent allowed
                </label>
              </div>

              <div>
                <p className="text-sm text-[var(--ink-muted)]">Dependencies</p>
                <div className="mt-2 max-h-32 overflow-auto rounded-2xl border border-black/5 bg-[rgba(201,215,245,0.2)] p-3 text-xs">
                  {dependencies.map((dep) => (
                    <label key={dep} className="flex items-center gap-2">
                      <input type="checkbox" defaultChecked={dep === 'Frame Assembly'} />
                      {dep}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm text-[var(--ink-muted)]">Allowed workers</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {['Alicia', 'Mateo', 'Sofia'].map((name) => (
                    <span
                      key={name}
                      className="rounded-full border border-black/10 px-3 py-1 text-xs text-[var(--ink-muted)]"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm text-[var(--ink-muted)]">Regular crew</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {['Alicia', 'Mateo'].map((name) => (
                    <span
                      key={name}
                      className="rounded-full bg-[rgba(47,107,79,0.12)] px-3 py-1 text-xs text-[var(--leaf)]"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>

              <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                Save task
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(47,107,79,0.12)] text-[var(--leaf)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[var(--ink)]">Import tasks</h3>
                <p className="text-xs text-[var(--ink-muted)]">Load definitions in bulk.</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-dashed border-black/15 bg-[rgba(201,215,245,0.25)] p-4 text-sm text-[var(--ink-muted)]">
              Columns: task_name, scope, skippable, concurrent_allowed, dependencies.
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default TaskDefs;
