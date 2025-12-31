import React, { useMemo, useState } from 'react';
import { Grid2X2, Layout, Plus, X } from 'lucide-react';

const HousePanels: React.FC = () => {
  const [selectedPanelId, setSelectedPanelId] = useState(1);
  const [showApplicability, setShowApplicability] = useState(false);
  const [showDurations, setShowDurations] = useState(false);

  const panels = [
    {
      id: 1,
      group: 'Paneles de Piso',
      code: 'PF-01',
      area: 12.4,
      length: 6.8,
    },
    {
      id: 2,
      group: 'Paneles de Cielo',
      code: 'PC-04',
      area: 10.1,
      length: 5.6,
    },
    {
      id: 3,
      group: 'Tabiques Interiores',
      code: 'TI-07',
      area: 8.3,
      length: 4.4,
    },
  ];

  const selectedPanel = useMemo(
    () => panels.find((panel) => panel.id === selectedPanelId) ?? panels[0],
    [selectedPanelId, panels]
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Product Definition / House Panels
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">Panel Definitions</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Define panel geometry and per-module applicability with task matrices.
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" /> Add panel
        </button>
      </header>

      <div className="flex flex-wrap gap-3">
        <select className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm">
          <option>Sierra Loft</option>
          <option>Solana Ridge</option>
        </select>
        <select className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm">
          <option>Module 1</option>
          <option>Module 2</option>
          <option>Module 3</option>
        </select>
        <select className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm">
          <option>Subtype: Base</option>
          <option>Subtype: Deluxe</option>
        </select>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2">
            {panels.map((panel, index) => (
              <button
                key={panel.id}
                onClick={() => setSelectedPanelId(panel.id)}
                className={`flex flex-col gap-3 rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
                  selectedPanelId === panel.id
                    ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
                    : 'border-black/5 bg-white'
                }`}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(201,215,245,0.6)] text-[var(--ink)]">
                    <Grid2X2 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--ink)]">{panel.code}</p>
                    <p className="text-xs text-[var(--ink-muted)]">{panel.group}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
                  <span>{panel.area} m2</span>
                  <span>{panel.length} m</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Edit</p>
                <h2 className="text-lg font-display text-[var(--ink)]">{selectedPanel.code}</h2>
              </div>
              <Layout className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>

            <div className="mt-4 space-y-4">
              <label className="text-sm text-[var(--ink-muted)]">
                Group
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  defaultValue={selectedPanel.group}
                />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                Panel code
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  defaultValue={selectedPanel.code}
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-[var(--ink-muted)]">
                  Area (m2)
                  <input
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    defaultValue={selectedPanel.area}
                  />
                </label>
                <label className="text-sm text-[var(--ink-muted)]">
                  Length (m)
                  <input
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    defaultValue={selectedPanel.length}
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)]"
                  onClick={() => setShowApplicability(true)}
                >
                  Task applicability matrix
                </button>
                <button
                  className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)]"
                  onClick={() => setShowDurations(true)}
                >
                  Task duration matrix
                </button>
              </div>

              <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                Save panel
              </button>
            </div>
          </section>

        </aside>
      </div>

      {showApplicability && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Matrix
                </p>
                <h3 className="text-lg font-display text-[var(--ink)]">Task Applicability</h3>
              </div>
              <button onClick={() => setShowApplicability(false)}>
                <X className="h-5 w-5 text-[var(--ink-muted)]" />
              </button>
            </div>
            <div className="mt-4 overflow-auto rounded-2xl border border-black/5">
              <table className="w-full text-sm">
                <thead className="bg-[rgba(201,215,245,0.4)] text-xs text-[var(--ink-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Task</th>
                    <th className="px-3 py-2 text-left">W1</th>
                    <th className="px-3 py-2 text-left">W2</th>
                    <th className="px-3 py-2 text-left">W3</th>
                  </tr>
                </thead>
                <tbody>
                  {['Frame', 'Sheathing', 'Seal'].map((task) => (
                    <tr key={task} className="border-t border-black/5">
                      <td className="px-3 py-2 text-[var(--ink)]">{task}</td>
                      {[1, 2, 3].map((cell) => (
                        <td key={cell} className="px-3 py-2">
                          <input type="checkbox" defaultChecked={cell !== 2} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-full border border-black/10 px-4 py-2 text-sm"
                onClick={() => setShowApplicability(false)}
              >
                Close
              </button>
              <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                Save matrix
              </button>
            </div>
          </div>
        </div>
      )}

      {showDurations && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                  Matrix
                </p>
                <h3 className="text-lg font-display text-[var(--ink)]">Task Durations</h3>
              </div>
              <button onClick={() => setShowDurations(false)}>
                <X className="h-5 w-5 text-[var(--ink-muted)]" />
              </button>
            </div>
            <div className="mt-4 overflow-auto rounded-2xl border border-black/5">
              <table className="w-full text-sm">
                <thead className="bg-[rgba(201,215,245,0.4)] text-xs text-[var(--ink-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Task</th>
                    <th className="px-3 py-2 text-left">Expected minutes</th>
                  </tr>
                </thead>
                <tbody>
                  {['Frame', 'Sheathing', 'Seal'].map((task) => (
                    <tr key={task} className="border-t border-black/5">
                      <td className="px-3 py-2 text-[var(--ink)]">{task}</td>
                      <td className="px-3 py-2">
                        <input
                          className="w-full rounded-lg border border-black/10 bg-white px-2 py-1"
                          defaultValue={task === 'Frame' ? 45 : 30}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-full border border-black/10 px-4 py-2 text-sm"
                onClick={() => setShowDurations(false)}
              >
                Close
              </button>
              <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                Save durations
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HousePanels;
