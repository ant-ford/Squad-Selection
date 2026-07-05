import { X } from 'lucide-react';

type FilterCategory = 'position' | 'eligibility' | 'selection' | 'availability';

export interface FilterState {
  position: Set<string>;
  eligibility: Set<string>;
  selection: Set<string>;
  availability: Set<string>;
}

export const EMPTY_FILTERS: FilterState = {
  position: new Set(),
  eligibility: new Set(),
  selection: new Set(),
  availability: new Set(),
};

/** Serialize FilterState to URL query string (compact format). */
export function filtersToParams(f: FilterState): string {
  const parts: string[] = [];
  for (const cat of ['position','eligibility','selection','availability'] as FilterCategory[]) {
    const vals = [...f[cat]];
    if (vals.length) parts.push(`${cat}=${vals.sort().join(',')}`);
  }
  return parts.join('&');
}

/** Deserialize FilterState from URL query string. */
export function paramsToFilters(search: string): FilterState {
  const params = new URLSearchParams(search);
  const f: FilterState = { position: new Set(), eligibility: new Set(), selection: new Set(), availability: new Set() };
  for (const cat of ['position','eligibility','selection','availability'] as FilterCategory[]) {
    const raw = params.get(cat);
    if (raw) f[cat] = new Set(raw.split(',').filter(Boolean));
  }
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
  {
    category: 'position',
    label: 'Position',
    options: [
      { key: 'GK', label: 'GK' },
      { key: 'DEF', label: 'DEF' },
      { key: 'MID', label: 'MID' },
      { key: 'FWD', label: 'FWD' },
    ],
  },
  {
    category: 'eligibility',
    label: 'Eligibility',
    options: [
      { key: 'eligible', label: 'Eligible' },
      { key: 'warning', label: 'Warning' },
      { key: 'blocked', label: 'Blocked' },
    ],
  },
  {
    category: 'selection',
    label: 'Selection',
    options: [
      { key: 'selected', label: 'Selected' },
      { key: 'none', label: 'None' },
    ],
  },
  {
    category: 'availability',
    label: 'Availability',
    options: [
      { key: 'Available', label: 'Available' },
      { key: 'Maybe', label: 'Maybe' },
      { key: 'Unavailable', label: 'Unavail.' },
    ],
  },
];

export interface PlayerFiltersProps {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  bulkSelectMode?: boolean;
  onToggleBulk?: () => void;
}

export default function PlayerFilters({ filters, onChange, bulkSelectMode, onToggleBulk }: PlayerFiltersProps) {
  const totalActive = [...filters.position, ...filters.eligibility, ...filters.selection, ...filters.availability].length;

  return (
    <div className="border-b border-border">
      <div className="container mx-auto px-4 py-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-muted-foreground">Filters</span>
          {totalActive > 0 && (
            <button
              onClick={() => onChange(EMPTY_FILTERS)}
              className="text-xs text-destructive flex items-center gap-0.5"
            >
              <X className="h-3 w-3" /> Clear ({totalActive})
            </button>
          )}
          <div className="flex-1" />
          {onToggleBulk && (
            <button
              onClick={onToggleBulk}
              className={`text-xs px-3 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors ${
                bulkSelectMode ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              Bulk Select
            </button>
          )}
        </div>

        {GROUPS.map(group => (
          <div key={group.category} className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className="text-xs text-muted-foreground w-16 shrink-0">{group.label}:</span>
            {group.options.map(opt => (
              <button
                key={opt.key}
                onClick={() => onChange({ ...filters, [group.category]: toggleInSet(filters[group.category], opt.key) })}
                className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 transition-colors ${
                  filters[group.category].has(opt.key)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}