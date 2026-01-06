import React from 'react';
import { useSearchParams } from 'react-router-dom';

import NoteDefs from './NoteDefs';
import PauseDefs from './PauseDefs';

type PauseNoteTab = 'pausas' | 'comentarios';

const normalizeTab = (value: string | null): PauseNoteTab =>
  value === 'comentarios' ? 'comentarios' : 'pausas';

const PauseNoteDefs: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = normalizeTab(searchParams.get('tab'));

  const handleTabChange = (tab: PauseNoteTab) => {
    if (tab === activeTab) return;
    setSearchParams({ tab }, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-full border border-black/10 bg-white/70 p-1 text-xs font-semibold text-[var(--ink-muted)]">
        <button
          type="button"
          onClick={() => handleTabChange('pausas')}
          className={`rounded-full px-4 py-2 transition-none ${
            activeTab === 'pausas' ? 'bg-black/5 text-[var(--ink)]' : ''
          }`}
        >
          Pausas
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('comentarios')}
          className={`rounded-full px-4 py-2 transition-none ${
            activeTab === 'comentarios' ? 'bg-black/5 text-[var(--ink)]' : ''
          }`}
        >
          Comentarios
        </button>
      </div>

      <div className="min-h-[600px]">{activeTab === 'pausas' ? <PauseDefs /> : <NoteDefs />}</div>
    </div>
  );
};

export default PauseNoteDefs;

