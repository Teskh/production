import React, { useState } from 'react';
import { CheckCircle2, Layers, Ruler, SlidersHorizontal } from 'lucide-react';

const ModuleRules: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'rules' | 'applicability' | 'durations'>('rules');

  const advanceTriggers = [
    { id: 1, task: 'Module Harness', stationSeq: 1, line: 'A', trigger: true },
    { id: 2, task: 'Seal & Inspect', stationSeq: 2, line: 'A', trigger: false },
  ];

  const applicability = [
    { id: 1, task: 'Module Harness', scope: 'module', stationSeq: 1, house: 'Sierra Loft' },
    { id: 2, task: 'Seal & Inspect', scope: 'module', stationSeq: 2, house: 'Solana Ridge' },
  ];

  const durations = [
    { id: 1, task: 'Module Harness', expected: 120, house: 'Sierra Loft' },
    { id: 2, task: 'Seal & Inspect', expected: 45, house: 'Solana Ridge' },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Product Definition / Module Rules
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">Advance Triggers & Applicability</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Configure module advance triggers, applicability scopes, and expected durations.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {[
          { key: 'rules', label: 'Advance Triggers', icon: CheckCircle2 },
          { key: 'applicability', label: 'Task Applicability', icon: Layers },
          { key: 'durations', label: 'Expected Durations', icon: Ruler },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
              activeTab === tab.key
                ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.12)] text-[var(--ink)]'
                : 'border-black/10 bg-white text-[var(--ink-muted)]'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'rules' && (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <h2 className="text-lg font-display text-[var(--ink)]">Advance trigger list</h2>
            <div className="mt-4 space-y-3">
              {advanceTriggers.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between rounded-2xl border border-black/5 bg-white px-4 py-4"
                >
                  <div>
                    <p className="font-semibold text-[var(--ink)]">{rule.task}</p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      Line {rule.line} | Station seq: {rule.stationSeq} | Advance trigger:{' '}
                      {rule.trigger ? 'Yes' : 'No'}
                    </p>
                  </div>
                  <button className="text-xs font-semibold text-[var(--accent)]">Edit</button>
                </div>
              ))}
            </div>
          </section>
          <aside className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Edit</p>
                <h2 className="text-lg font-display text-[var(--ink)]">Advance trigger</h2>
              </div>
              <SlidersHorizontal className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>
            <div className="mt-4 space-y-4">
              <label className="text-sm text-[var(--ink-muted)]">
                Task definition
                <select className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm">
                  <option>Module Harness</option>
                  <option>Seal & Inspect</option>
                </select>
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                Station sequence
                <input className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                Line type
                <select className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm">
                  <option>A</option>
                  <option>B</option>
                  <option>C</option>
                </select>
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                Advance trigger
                <select className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm">
                  <option>No</option>
                  <option>Yes</option>
                </select>
              </label>
              <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                Save trigger
              </button>
            </div>
          </aside>
        </div>
      )}

      {activeTab === 'applicability' && (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <h2 className="text-lg font-display text-[var(--ink)]">Applicability list</h2>
            <div className="mt-4 space-y-3">
              {applicability.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between rounded-2xl border border-black/5 bg-white px-4 py-4"
                >
                  <div>
                    <p className="font-semibold text-[var(--ink)]">{row.task}</p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      Scope: {row.scope} | Station seq: {row.stationSeq} | House: {row.house}
                    </p>
                  </div>
                  <button className="text-xs font-semibold text-[var(--accent)]">Edit</button>
                </div>
              ))}
            </div>
          </section>
          <aside className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Edit</p>
                <h2 className="text-lg font-display text-[var(--ink)]">Applicability</h2>
              </div>
              <SlidersHorizontal className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>
            <div className="mt-4 space-y-4">
              <label className="text-sm text-[var(--ink-muted)]">
                Task definition
                <select className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm">
                  <option>Module Harness</option>
                  <option>Seal & Inspect</option>
                </select>
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                Station sequence
                <input className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                House type
                <select className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm">
                  <option>All</option>
                  <option>Sierra Loft</option>
                  <option>Solana Ridge</option>
                </select>
              </label>
              <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                Save applicability
              </button>
            </div>
          </aside>
        </div>
      )}

      {activeTab === 'durations' && (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <h2 className="text-lg font-display text-[var(--ink)]">Duration overrides</h2>
            <div className="mt-4 space-y-3">
              {durations.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between rounded-2xl border border-black/5 bg-white px-4 py-4"
                >
                  <div>
                    <p className="font-semibold text-[var(--ink)]">{row.task}</p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {row.expected} minutes | {row.house}
                    </p>
                  </div>
                  <button className="text-xs font-semibold text-[var(--accent)]">Edit</button>
                </div>
              ))}
            </div>
          </section>
          <aside className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Edit</p>
                <h2 className="text-lg font-display text-[var(--ink)]">Expected duration</h2>
              </div>
              <SlidersHorizontal className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>
            <div className="mt-4 space-y-4">
              <label className="text-sm text-[var(--ink-muted)]">
                Task
                <select className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm">
                  <option>Module Harness</option>
                  <option>Seal & Inspect</option>
                </select>
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                Expected minutes
                <input className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                House type
                <select className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm">
                  <option>All</option>
                  <option>Sierra Loft</option>
                  <option>Solana Ridge</option>
                </select>
              </label>
              <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                Save duration
              </button>
            </div>
          </aside>
        </div>
      )}

      <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(201,215,245,0.6)] text-[var(--ink)]">
            <Ruler className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--ink)]">
              Import {activeTab === 'rules' ? 'advance rules' : activeTab === 'applicability' ? 'applicability' : 'durations'}
            </h3>
            <p className="text-xs text-[var(--ink-muted)]">
              Upload CSV to update configuration in bulk.
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-dashed border-black/15 bg-[rgba(201,215,245,0.25)] p-4 text-sm text-[var(--ink-muted)]">
          Columns: task_definition_id, station_sequence_order, scope, house_type_id, sub_type_id.
        </div>
      </section>
    </div>
  );
};

export default ModuleRules;
