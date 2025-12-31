import React, { useMemo, useState } from 'react';
import { Home, Plus, Sparkles } from 'lucide-react';

const HouseTypes: React.FC = () => {
  const [selectedTypeId, setSelectedTypeId] = useState(1);

  const houseTypes = [
    {
      id: 1,
      name: 'Sierra Loft',
      modules: 4,
      subtypes: ['Base', 'Deluxe', 'Eco'],
    },
    {
      id: 2,
      name: 'Solana Ridge',
      modules: 6,
      subtypes: ['Standard', 'Premium'],
    },
    {
      id: 3,
      name: 'Altura Pod',
      modules: 3,
      subtypes: [],
    },
  ];

  const selectedType = useMemo(
    () => houseTypes.find((type) => type.id === selectedTypeId) ?? houseTypes[0],
    [selectedTypeId, houseTypes]
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Product Definition / House Types
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">House Type Library</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Define core product families and map module counts with subtype variations.
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" /> New house type
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2">
            {houseTypes.map((type, index) => (
              <button
                key={type.id}
                onClick={() => setSelectedTypeId(type.id)}
                className={`flex h-full flex-col justify-between rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
                  selectedTypeId === type.id
                    ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
                    : 'border-black/5 bg-white'
                }`}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(201,215,245,0.55)] text-[var(--ink)]">
                    <Home className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-[var(--ink)]">{type.name}</p>
                    <p className="text-xs text-[var(--ink-muted)]">{type.modules} modules</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {type.subtypes.length > 0 ? (
                    type.subtypes.map((subtype) => (
                      <span
                        key={subtype}
                        className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-[var(--ink-muted)]"
                      >
                        {subtype}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-[var(--ink-muted)]">No subtypes</span>
                  )}
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
                <h2 className="text-lg font-display text-[var(--ink)]">{selectedType.name}</h2>
              </div>
              <Sparkles className="h-5 w-5 text-[var(--ink-muted)]" />
            </div>

            <div className="mt-4 space-y-4">
              <label className="text-sm text-[var(--ink-muted)]">
                House type name
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  defaultValue={selectedType.name}
                />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                Number of modules
                <input
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  defaultValue={selectedType.modules}
                />
              </label>
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-[var(--ink-muted)]">Subtypes</p>
                  <button className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]">
                    <Plus className="h-3 w-3" /> Add subtype
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {selectedType.subtypes.map((subtype) => (
                    <div
                      key={subtype}
                      className="flex items-center justify-between rounded-2xl border border-black/5 bg-white px-3 py-2"
                    >
                      <span className="text-sm text-[var(--ink)]">{subtype}</span>
                      <button className="text-xs text-[var(--ink-muted)]">Edit</button>
                    </div>
                  ))}
                  {selectedType.subtypes.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-black/10 px-3 py-2 text-xs text-[var(--ink-muted)]">
                      No subtypes configured.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                  Save house type
                </button>
                <button className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)]">
                  Archive
                </button>
              </div>
            </div>
          </section>

        </aside>
      </div>
    </div>
  );
};

export default HouseTypes;
