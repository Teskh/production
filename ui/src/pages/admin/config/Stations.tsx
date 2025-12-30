import React, { useMemo, useState } from 'react';
import { MapPin, Plus, Search, Settings2, Waves } from 'lucide-react';

const Stations: React.FC = () => {
  const [selectedStationId, setSelectedStationId] = useState('W1');

  const stations = [
    { id: 'W1', name: 'Wall Prep', line: 'W', sequence: 1, role: 'core' },
    { id: 'W2', name: 'Panel Assembly', line: 'W', sequence: 2, role: 'core' },
    { id: 'M1', name: 'Magazine', line: 'M', sequence: 1, role: 'core' },
    { id: 'A1', name: 'Assembly Start', line: 'A', sequence: 1, role: 'core' },
    { id: 'A2', name: 'Assembly Finish', line: 'A', sequence: 2, role: 'core' },
    { id: 'AUX1', name: 'Auxiliary Repair', line: 'AUX', sequence: null, role: 'auxiliary' },
  ];

  const selectedStation = useMemo(
    () => stations.find((station) => station.id === selectedStationId) ?? stations[0],
    [selectedStationId, stations]
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Configuration / Stations
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">Station Builder</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Define line sequencing, roles, and identifiers used across production logic.
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" /> Add station
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">Active stations</h2>
              <p className="text-sm text-[var(--ink-muted)]">18 stations across 4 lines</p>
            </div>
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
              <input
                type="search"
                placeholder="Search stations"
                className="h-9 rounded-full border border-black/10 bg-white pl-9 pr-4 text-sm"
              />
            </label>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {stations.map((station, index) => (
              <button
                key={station.id}
                onClick={() => setSelectedStationId(station.id)}
                className={`flex flex-col gap-3 rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
                  selectedStationId === station.id
                    ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
                    : 'border-black/5 bg-white'
                }`}
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(201,215,245,0.6)] text-[var(--ink)]">
                      <MapPin className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-semibold text-[var(--ink)]">{station.id}</p>
                      <p className="text-xs text-[var(--ink-muted)]">{station.name}</p>
                    </div>
                  </div>
                  <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-[var(--ink-muted)]">
                    {station.line}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
                  <span>Sequence: {station.sequence ?? 'n/a'}</span>
                  <span className="capitalize">{station.role}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Detail</p>
                <h2 className="text-lg font-display text-[var(--ink)]">{selectedStation.id}</h2>
              </div>
              <Settings2 className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>

            <div className="mt-4 space-y-4">
              <label className="text-sm text-[var(--ink-muted)]">
                Station ID
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  defaultValue={selectedStation.id}
                />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                Display name
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  defaultValue={selectedStation.name}
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-[var(--ink-muted)]">
                  Line type
                  <select
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    defaultValue={selectedStation.line}
                  >
                    {['W', 'M', 'A', 'B', 'C', 'AUX'].map((line) => (
                      <option key={line} value={line}>
                        {line}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-[var(--ink-muted)]">
                  Sequence order
                  <input
                    className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                    placeholder="e.g. 1"
                    defaultValue={selectedStation.sequence ?? ''}
                  />
                </label>
              </div>
              <label className="text-sm text-[var(--ink-muted)]">
                Role
                <select
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  defaultValue={selectedStation.role}
                >
                  <option value="core">core</option>
                  <option value="auxiliary">auxiliary</option>
                </select>
              </label>

              <div className="flex flex-wrap gap-2">
                <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                  Save station
                </button>
                <button className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)]">
                  Archive
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Import</p>
                <h2 className="text-lg font-display text-[var(--ink)]">Batch station load</h2>
              </div>
              <Waves className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>
            <div className="mt-4 rounded-2xl border border-dashed border-black/15 bg-[rgba(201,215,245,0.25)] p-4 text-sm text-[var(--ink-muted)]">
              Drag in a CSV with station_id, name, line_type, sequence_order, role.
            </div>
            <button className="mt-4 inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)]">
              Download template
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default Stations;
