import React, { useMemo, useState } from 'react';
import { ChevronRight, Layers, Plus, Search, Settings } from 'lucide-react';

const Specialties: React.FC = () => {
  const [selectedSkillId, setSelectedSkillId] = useState(1);

  const skills = [
    { id: 1, name: 'Framing', workers: 18 },
    { id: 2, name: 'Electrical', workers: 9 },
    { id: 3, name: 'Plumbing', workers: 6 },
    { id: 4, name: 'Assembly', workers: 22 },
    { id: 5, name: 'Quality', workers: 7 },
  ];

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedSkillId) ?? skills[0],
    [selectedSkillId, skills]
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Personnel / Specialties
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">Specialty Builder</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Curate skills and map them to workers for station filtering and task eligibility.
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" /> New Specialty
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">Skill Inventory</h2>
              <p className="text-sm text-[var(--ink-muted)]">12 specialties configured</p>
            </div>
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
              <input
                type="search"
                placeholder="Search skills"
                className="h-9 rounded-full border border-black/10 bg-white pl-9 pr-4 text-sm"
              />
            </label>
          </div>

          <div className="mt-6 space-y-3">
            {skills.map((skill, index) => (
              <button
                key={skill.id}
                onClick={() => setSelectedSkillId(skill.id)}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm animate-rise ${
                  selectedSkillId === skill.id
                    ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.08)]'
                    : 'border-black/5 bg-white'
                }`}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(201,215,245,0.6)] text-[var(--ink)]">
                    <Layers className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--ink)]">{skill.name}</p>
                    <p className="text-xs text-[var(--ink-muted)]">{skill.workers} workers assigned</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[var(--ink-muted)]" />
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Edit</p>
              <h2 className="text-lg font-display text-[var(--ink)]">{selectedSkill.name}</h2>
            </div>
            <Settings className="h-5 w-5 text-[var(--ink-muted)]" />
          </div>

          <div className="mt-4 space-y-4">
            <label className="text-sm text-[var(--ink-muted)]">
              Specialty name
              <input
                className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                defaultValue={selectedSkill.name}
              />
            </label>

            <label className="text-sm text-[var(--ink-muted)]">
              Notes
              <textarea
                className="mt-2 min-h-[120px] w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                placeholder="Describe how this skill is used."
              />
            </label>

            <div>
              <p className="text-sm text-[var(--ink-muted)]">Assigned workers</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {['Alicia Ramos', 'Mateo Lopez', 'Sofia Castro'].map((worker) => (
                  <span
                    key={worker}
                    className="rounded-full bg-[rgba(47,107,79,0.12)] px-3 py-1 text-xs text-[var(--leaf)]"
                  >
                    {worker}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                Save specialty
              </button>
              <button className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[var(--ink)]">
                Archive
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(201,215,245,0.6)] text-[var(--ink)]">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--ink)]">Import specialties</h3>
            <p className="text-xs text-[var(--ink-muted)]">Bulk load skill definitions.</p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-dashed border-black/15 bg-[rgba(201,215,245,0.25)] p-4 text-sm text-[var(--ink-muted)]">
          Upload CSV with specialty_name and optional notes.
        </div>
      </section>
    </div>
  );
};

export default Specialties;
