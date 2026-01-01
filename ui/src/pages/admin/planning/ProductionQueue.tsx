import React, { useState } from 'react';
import { 
  Layers, GripVertical, Calendar, Edit, Trash2, 
  Plus, CheckCircle, Clock, 
  ChevronUp, ChevronDown, Search, X, 
  Settings, Filter
} from 'lucide-react';

// --- Types ---

type ProductionStatus = 'planned' | 'panels' | 'magazine' | 'assembly' | 'completed';
type LineId = 'A' | 'B' | 'C' | null;

interface QueueItem {
  id: string;
  sequence: number;
  project: string;
  house: string;
  module: string;
  type: string;
  subType?: string;
  line: LineId;
  startDate: string; 
  status: ProductionStatus;
}

// --- Mock Data ---

const INITIAL_QUEUE: QueueItem[] = [
  { id: '101', sequence: 1, project: 'Sunset-Villas', house: 'SV-01', module: 'M-01', type: 'Single Family A', line: 'A', startDate: '12/28', status: 'assembly' },
  { id: '102', sequence: 2, project: 'Sunset-Villas', house: 'SV-01', module: 'M-02', type: 'Single Family A', line: 'A', startDate: '12/28', status: 'assembly' },
  { id: '103', sequence: 3, project: 'Sunset-Villas', house: 'SV-02', module: 'M-01', type: 'Single Family B', line: 'B', startDate: '12/29', status: 'magazine' },
  { id: '104', sequence: 4, project: 'Sunset-Villas', house: 'SV-02', module: 'M-02', type: 'Single Family B', line: 'B', startDate: '12/29', status: 'panels' },
  { id: '105', sequence: 5, project: 'Maple-Grove', house: 'MG-12', module: 'M-01', type: 'Townhouse L', line: null, startDate: '01/02', status: 'planned' },
  { id: '106', sequence: 6, project: 'Maple-Grove', house: 'MG-12', module: 'M-02', type: 'Townhouse L', line: null, startDate: '01/02', status: 'planned' },
  { id: '107', sequence: 7, project: 'Maple-Grove', house: 'MG-13', module: 'M-01', type: 'Townhouse R', line: null, startDate: '01/03', status: 'planned' },
  { id: '108', sequence: 8, project: 'City-Heights', house: 'CH-05', module: 'M-01', type: 'Urban Condo', line: 'C', startDate: '12/27', status: 'completed' },
];

// --- Sub-components ---

const StatusBadge: React.FC<{ status: ProductionStatus }> = ({ status }) => {
  const styles = {
    planned: 'bg-black/5 text-[var(--ink-muted)] border-black/5',
    panels: 'bg-[rgba(242,98,65,0.1)] text-[var(--accent)] border-[rgba(242,98,65,0.2)]',
    magazine: 'bg-purple-50 text-purple-700 border-purple-100',
    assembly: 'bg-[rgba(201,215,245,0.3)] text-blue-700 border-blue-100',
    completed: 'bg-[rgba(47,107,79,0.12)] text-[var(--leaf)] border-[rgba(47,107,79,0.2)]',
  };

  const labels = {
    planned: 'Planned',
    panels: 'Panels',
    magazine: 'Magazine',
    assembly: 'Assembly',
    completed: 'Completed',
  };

  return (
    <span className={`px-3 py-1 rounded-full text-[10px] uppercase tracking-wider font-bold border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};

const LineSelector: React.FC<{ current: LineId, onChange: (l: LineId) => void, disabled?: boolean }> = ({ current, onChange, disabled }) => {
  return (
    <div className="flex bg-black/5 rounded-xl p-1 gap-1">
      {(['A', 'B', 'C'] as const).map(line => (
        <button
          key={line}
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); onChange(line); }}
          className={`
            w-7 h-7 flex items-center justify-center text-[11px] font-bold rounded-lg
            transition-all
            ${current === line 
              ? 'bg-white text-[var(--accent)] shadow-sm border border-black/5' 
              : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-white/50'}
            ${disabled ? 'opacity-30 cursor-not-allowed' : ''}
          `}
        >
          {line}
        </button>
      ))}
    </div>
  );
};

// --- Main Component ---

const ProductionQueue: React.FC = () => {
  const [items, setItems] = useState<QueueItem[]>(INITIAL_QUEUE);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCompleted, setShowCompleted] = useState(false);
  const [query, setQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const visibleItems = items
    .filter(i => showCompleted || i.status !== 'completed')
    .filter(i => {
      if (!query.trim()) return true;
      const needle = query.toLowerCase();
      return i.house.toLowerCase().includes(needle) || 
             i.project.toLowerCase().includes(needle) ||
             i.type.toLowerCase().includes(needle);
    });

  const handleSelection = (id: string, multi: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(multi ? prev : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = () => {
    if (window.confirm(`Remove ${selectedIds.size} items from queue?`)) {
      setItems(items.filter(i => !selectedIds.has(i.id)));
      setSelectedIds(new Set());
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Planning / Production
          </p>
          <h1 className="text-3xl font-display text-[var(--ink)]">Production Queue</h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Manage sequences, assign assembly lines, and monitor module workflow lifecycle.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" /> Add Production Batch
          </button>
        </div>
      </header>

      <section className="rounded-3xl border border-black/5 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-lg font-display text-[var(--ink)]">Active Sequence</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {visibleItems.length} items currently in workflow
              </p>
            </div>
            <div className="flex bg-black/5 rounded-full p-1 ml-4">
               <button 
                 onClick={() => setShowCompleted(false)}
                 className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${!showCompleted ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--ink-muted)]'}`}
               >
                 Active
               </button>
               <button 
                 onClick={() => setShowCompleted(true)}
                 className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${showCompleted ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--ink-muted)]'}`}
               >
                 All
               </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
              <input
                type="search"
                placeholder="Search modules..."
                className="h-9 rounded-full border border-black/10 bg-white pl-9 pr-4 text-sm focus:ring-2 focus:ring-[var(--accent)] outline-none transition-all w-64"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="h-6 w-px bg-black/10 mx-1" />
            <button 
              disabled={selectedIds.size === 0}
              onClick={handleDelete}
              className="p-2 text-[var(--ink-muted)] hover:text-red-500 disabled:opacity-30 transition-colors"
              title="Delete Selected"
            >
              <Trash2 className="h-5 w-5" />
            </button>
            <button className="p-2 text-[var(--ink-muted)] hover:text-[var(--ink)]" title="Settings">
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {visibleItems.length === 0 && (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-12 text-center text-sm text-[var(--ink-muted)]">
              No modules found in the production queue.
            </div>
          )}
          
          {visibleItems.map((item, index) => {
            const isSelected = selectedIds.has(item.id);
            const prevItem = index > 0 ? visibleItems[index - 1] : null;
            const isNewGroup = !prevItem || prevItem.project !== item.project;

            return (
              <React.Fragment key={item.id}>
                {isNewGroup && (
                  <div className="pt-4 pb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-[var(--ink-muted)]">
                        Project: {item.project}
                      </span>
                      <div className="h-px bg-black/5 flex-1" />
                    </div>
                  </div>
                )}

                <div 
                  onClick={(e) => handleSelection(item.id, e.ctrlKey || e.metaKey)}
                  className={`
                    group relative flex items-center p-4 rounded-2xl border transition-all animate-rise select-none cursor-pointer
                    ${isSelected 
                      ? 'border-[var(--accent)] bg-[rgba(242,98,65,0.05)] shadow-sm' 
                      : 'border-black/5 bg-white hover:border-black/10 hover:shadow-sm'
                    }
                    ${item.status === 'completed' ? 'opacity-60' : ''}
                  `}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center mr-6 gap-3">
                    <GripVertical className="h-4 w-4 text-black/10 group-hover:text-black/30" />
                    <span className="text-xs font-mono font-bold text-black/20 w-4">{index + 1}</span>
                  </div>

                  <div className="flex-1 grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-3">
                      <p className="font-bold text-[var(--ink)]">{item.house}</p>
                      <p className="text-[11px] text-[var(--ink-muted)]">Module: {item.module}</p>
                    </div>

                    <div className="col-span-3">
                      <p className="text-sm font-medium text-[var(--ink)] truncate">{item.type}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Calendar className="h-3 w-3 text-black/20" />
                        <span className="text-[11px] text-[var(--ink-muted)]">{item.startDate}</span>
                      </div>
                    </div>

                    <div className="col-span-3 flex justify-center">
                      <LineSelector 
                        current={item.line} 
                        onChange={(l) => {
                          setItems(items.map(i => i.id === item.id ? {...i, line: l} : i));
                        }}
                        disabled={item.status === 'completed'}
                      />
                    </div>

                    <div className="col-span-3 flex items-center justify-end gap-6">
                      <StatusBadge status={item.status} />
                      
                      <div className="flex items-center gap-1 min-w-[70px] justify-end">
                         <button className="p-2 text-[var(--ink-muted)] hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all opacity-0 group-hover:opacity-100">
                           <Edit className="h-4 w-4" />
                         </button>
                         <button className="p-2 text-[var(--ink-muted)] hover:text-[var(--leaf)] hover:bg-green-50 rounded-xl transition-all opacity-0 group-hover:opacity-100">
                           <CheckCircle className="h-4 w-4" />
                         </button>
                      </div>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </section>

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center backdrop-blur-[2px]">
          <div className="bg-white rounded-[2rem] shadow-2xl w-[480px] overflow-hidden border border-black/5 animate-rise">
            <div className="px-8 py-6 flex justify-between items-center">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Workflow</p>
                <h2 className="text-xl font-display text-[var(--ink)]">New Production Batch</h2>
              </div>
              <button onClick={() => setIsAddModalOpen(false)} className="p-2 hover:bg-black/5 rounded-full transition-colors text-[var(--ink-muted)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="px-8 pb-8 space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--ink-muted)] ml-1">Project</label>
                <select className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20">
                  <option>Sunset-Villas</option>
                  <option>Maple-Grove</option>
                  <option>City-Heights</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[var(--ink-muted)] ml-1">House Type</label>
                  <select className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20">
                     <option>Single Family A</option>
                     <option>Townhouse L</option>
                     <option>Urban Condo</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                   <label className="text-xs font-bold text-[var(--ink-muted)] ml-1">Quantity</label>
                   <input type="number" defaultValue={1} className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--ink-muted)] ml-1">Start Date</label>
                <input type="date" className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20" />
              </div>
              
              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 rounded-full border border-black/10 px-4 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-black/5 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
                >
                  Create Batch
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionQueue;