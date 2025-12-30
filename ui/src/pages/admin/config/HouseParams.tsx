import React, { useMemo, useState } from 'react';
import { Database, Edit3, Plus, UploadCloud } from 'lucide-react';

const HouseParams: React.FC = () => {
  const [selectedParamId, setSelectedParamId] = useState(1);

  const parameters = [
    { id: 1, name: 'Floor Height', unit: 'mm' },
    { id: 2, name: 'Roof Pitch', unit: 'deg' },
    { id: 3, name: 'Wall Thickness', unit: 'mm' },
  ];

  const values = [
    { module: 1, value: 2800 },
    { module: 2, value: 2800 },
    { module: 3, value: 2950 },
    { module: 4, value: 2950 },
  ];

  const selectedParam = useMemo(
    () => parameters.find((param) => param.id === selectedParamId) ?? parameters[0],
    [selectedParamId, parameters]
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Product Definition / House Parameters
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">House Parameters</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Maintain parameter definitions and per-module values for each house type.
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" /> New parameter
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">Parameter list</h2>
              <p className="text-sm text-[var(--ink-muted)]">12 parameters in the library</p>
            </div>
            <select className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm">
              <option>Sierra Loft</option>
              <option>Solana Ridge</option>
              <option>Altura Pod</option>
            </select>
          </div>

          <div className="mt-4 space-y-3">
            {parameters.map((param, index) => (
              <button
                key={param.id}
                onClick={() => setSelectedParamId(param.id)}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
                  selectedParamId === param.id
                    ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
                    : 'border-black/5 bg-white'
                }`}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div>
                  <p className="font-semibold text-[var(--ink)]">{param.name}</p>
                  <p className="text-xs text-[var(--ink-muted)]">Unit: {param.unit ?? 'n/a'}</p>
                </div>
                <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-[var(--ink-muted)]">
                  {param.unit}
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
                <h2 className="text-lg font-display text-[var(--ink)]">{selectedParam.name}</h2>
              </div>
              <Edit3 className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>

            <div className="mt-4 space-y-4">
              <label className="text-sm text-[var(--ink-muted)]">
                Parameter name
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  defaultValue={selectedParam.name}
                />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                Unit
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  defaultValue={selectedParam.unit}
                />
              </label>

              <div>
                <p className="text-sm text-[var(--ink-muted)]">Per-module values</p>
                <div className="mt-2 overflow-hidden rounded-2xl border border-black/5">
                  <table className="w-full text-sm">
                    <thead className="bg-[rgba(201,215,245,0.4)] text-xs text-[var(--ink-muted)]">
                      <tr>
                        <th className="px-3 py-2 text-left">Module</th>
                        <th className="px-3 py-2 text-left">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {values.map((row) => (
                        <tr key={row.module} className="border-t border-black/5">
                          <td className="px-3 py-2 text-[var(--ink)]">{row.module}</td>
                          <td className="px-3 py-2">
                            <input
                              className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm"
                              defaultValue={row.value}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                Save parameter
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(47,107,79,0.12)] text-[var(--leaf)]">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[var(--ink)]">Import values</h3>
                <p className="text-xs text-[var(--ink-muted)]">House type + module matrix.</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-dashed border-black/15 bg-[rgba(201,215,245,0.25)] p-4 text-sm text-[var(--ink-muted)]">
              Upload a CSV with parameter_name, house_type, module_number, value.
            </div>
            <button className="mt-4 inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)]">
              <UploadCloud className="h-4 w-4" /> Download template
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default HouseParams;
