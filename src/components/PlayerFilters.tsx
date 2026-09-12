import { X, ChevronDown, ChevronRight, Search, Filter } from 'lucide-react';
import { useState } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useMediaQuery } from '@/lib/useMediaQuery';

export type FilterCategory = 'position' | 'eligibility' | 'selection' | 'availability' | 'ability';

export interface FilterState {
  position: Set<string>;
  eligibility: Set<string>;
  selection: Set<string>;
  availability: Set<string>;
  ability: Set<string>;
  name?: string;
}

export const EMPTY_FILTERS: FilterState = {
  position: new Set(),
  eligibility: new Set(),
  selection: new Set(),
  availability: new Set(),
  ability: new Set(),
  name: '',
};

/**
 * Returns a URLSearchParams, not a string: callers merge it into the page's
 * search params via URLSearchParams methods (params.set(k, v)), so a value
 * is only ever percent-encoded once. Building a string here and re-parsing
 * it with string.split('&'/'=') downstream double-encodes anything with a
 * space or an ampersand in it (e.g. a name filter).
 */
export function filtersToParams(f: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  for (const cat of ['position','eligibility','selection','availability','ability'] as FilterCategory[]) {
    const vals = [...(f[cat] ?? [])];
    if (vals.length) params.set(cat, vals.sort().join(','));
  }
  if (f.name) params.set('name', f.name);
  return params;
}

export function paramsToFilters(params: string | URLSearchParams): FilterState {
  const sp = typeof params === 'string' ? new URLSearchParams(params) : params;
  const f: FilterState = { position: new Set(), eligibility: new Set(), selection: new Set(), availability: new Set(), ability: new Set(), name: '' };
  for (const cat of ['position','eligibility','selection','availability','ability'] as FilterCategory[]) {
    const raw = sp.get(cat);
    if (raw) f[cat] = new Set(raw.split(',').filter(Boolean));
  }
  f.name = sp.get('name') || '';
  return f;
}

function toggleInSet(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

interface ChipGroup {
  category: FilterCategory;
  label: string;
  options: { key: string; label: string }[];
}

const GROUPS: ChipGroup[] = [
  { category: 'position', label: 'Position', options: [
    { key: 'GK', label: 'GK' }, { key: 'DEF', label: 'DEF' }, { key: 'MID', label: 'MID' }, { key: 'FWD', label: 'FWD' }, { key: 'FLEX', label: 'FLEX' },
  ]},
  { category: 'eligibility', label: 'Eligibility', options: [
    { key: 'eligible', label: 'Eligible' }, { key: 'warning', label: 'Warning' }, { key: 'blocked', label: 'Blocked' },
  ]},
  { category: 'selection', label: 'Selection', options: [
    { key: 'selected', label: 'Selected' }, { key: 'none', label: 'None' },
  ]},
  { category: 'availability', label: 'Availability', options: [
    { key: 'Available', label: 'Available' }, { key: 'Maybe', label: 'Maybe' }, { key: 'Unavailable', label: 'Unavailable' },
  ]},
];

const ABILITY_GROUPS: { group: string; values: string[] }[] = [
  { group: 'A', values: ['A+', 'A', 'A-'] },
  { group: 'B', values: ['B+', 'B', 'B-'] },
  { group: 'C', values: ['C+', 'C', 'C-'] },
  { group: 'D', values: ['D+', 'D', 'D-'] },
  { group: 'E', values: ['E+', 'E', 'E-'] },
  { group: 'F', values: ['F+', 'F', 'F-'] },
  { group: 'G', values: ['G+', 'G', 'G-'] },
  { group: 'H', values: ['H+', 'H', 'H-'] },
];

// One width for every row label, so the chips line up down the whole panel.
// Narrower on a phone, where "Position:" and its five chips only just fit.
const LABEL_CLASS = 'text-xs text-muted-foreground w-16 sm:w-20 shrink-0';
const CHIP_CLASS = 'text-xs px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors';

export interface PlayerFiltersProps {
  filters: FilterState;
  onChange: (f: FilterState) => void;
}

export default function PlayerFilters({ filters, onChange }: PlayerFiltersProps) {
  const [expandedAbility, setExpandedAbility] = useState<string | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 639px)');

  const totalActive =
    [...filters.position, ...filters.eligibility, ...filters.selection, ...filters.availability, ...filters.ability].length +
    (filters.name ? 1 : 0);

  const filterContent = (
    <div className="space-y-2">
      {/* Name search */}
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          type="text"
          placeholder="Search by name..."
          value={filters.name ?? ''}
          onChange={(e) => onChange({ ...filters, name: e.target.value })}
          className="flex-1 text-sm border border-border rounded px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* The sheet has its own "Filters" title, so the caption would only
          repeat it there. */}
      {(!isMobile || totalActive > 0) && (
        <div className="flex items-center gap-2">
          {!isMobile && <span className="text-xs font-medium text-muted-foreground">Filters</span>}
          {totalActive > 0 && (
            <button onClick={() => onChange(EMPTY_FILTERS)} className="text-xs text-destructive flex items-center gap-0.5">
              <X className="h-3 w-3" /> Clear ({totalActive})
            </button>
          )}
        </div>
      )}

      {GROUPS.map(group => (
        <div key={group.category} className="flex items-center gap-x-1.5 gap-y-1.5 flex-wrap">
          <span className={LABEL_CLASS}>{group.label}:</span>
          {group.options.map(opt => (
            <button key={opt.key} onClick={() => onChange({ ...filters, [group.category]: toggleInSet(filters[group.category], opt.key) })}
              className={`${CHIP_CLASS} ${filters[group.category].has(opt.key) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      ))}

      {/* Ability: parent toggles all sub-grades, caret expands granular */}
      <div className="flex items-center gap-x-1.5 gap-y-1.5 flex-wrap">
        <span className={LABEL_CLASS}>Ability:</span>
        {ABILITY_GROUPS.map(g => {
          const allSelected = g.values.every(v => filters.ability.has(v));
          const someSelected = g.values.some(v => filters.ability.has(v));
          const isExpanded = expandedAbility === g.group;
          const toggleGroup = () => {
            const next = new Set(filters.ability);
            if (allSelected) g.values.forEach(v => next.delete(v));
            else g.values.forEach(v => next.add(v));
            onChange({ ...filters, ability: next });
          };
          return (
            <div key={g.group} className="flex items-center gap-1">
              <button onClick={toggleGroup}
                className={`${CHIP_CLASS} ${allSelected ? 'bg-primary text-primary-foreground' : someSelected ? 'bg-primary/40 text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                {g.group}
              </button>
              <button onClick={() => setExpandedAbility(isExpanded ? null : g.group)}
                className="text-muted-foreground hover:text-foreground p-0.5">
                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              {isExpanded && (
                <div className="flex items-center gap-1 ml-1">
                  {g.values.map(v => (
                    <button key={v} onClick={() => onChange({ ...filters, ability: toggleInSet(filters.ability, v) })}
                      className={`${CHIP_CLASS} ${filters.ability.has(v) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      {v}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <div className="border-b border-border">
          <div className="container mx-auto px-4 py-3">
            <button
              onClick={() => setIsSheetOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
            >
              <Filter className="h-4 w-4" />
              Filters {totalActive > 0 && `(${totalActive})`}
            </button>
          </div>
        </div>
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
            {/* SheetContent carries no padding of its own, so the padding here
                is not decoration - without it the chips run into the edges of
                the screen. The header is sticky because the body scrolls. */}
            <div className="sticky top-0 z-10 bg-background rounded-t-2xl">
              <div className="flex justify-center pt-2.5">
                <div className="h-1 w-9 rounded-full bg-muted-foreground/25" />
              </div>
              <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-3 border-b border-border">
                <SheetTitle>Filters</SheetTitle>
                <button
                  onClick={() => setIsSheetOpen(false)}
                  aria-label="Close filters"
                  className="shrink-0 -mr-1.5 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* The bottom inset keeps the last row clear of the home indicator. */}
            <div className="px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              {filterContent}
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <div className="border-b border-border">
      <div className="container mx-auto px-4 py-3">
        {filterContent}
      </div>
    </div>
  );
}