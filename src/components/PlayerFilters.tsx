const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'eligible', label: 'Eligible' },
  { key: 'selected', label: 'Selected' },
  { key: 'DEF', label: 'Defenders' },
  { key: 'MID', label: 'Midfield' },
  { key: 'FWD', label: 'Forward' },
  { key: 'GK', label: 'GK' },
];

export default function PlayerFilters({
  active, onFilter, bulkSelectMode, onToggleBulk,
}: {
  active: string;
  onFilter: (f: string) => void;
  bulkSelectMode?: boolean;
  onToggleBulk?: () => void;
}) {
  return (
    <div className="border-b border-border overflow-x-auto">
      <div className="container mx-auto px-4 py-2 flex gap-2 items-center">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => onFilter(f.key)}
            className={`text-xs px-3 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors ${
              active === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
        {onToggleBulk && (
          <button
            onClick={onToggleBulk}
            className={`text-xs px-3 py-1 rounded-full whitespace-nowrap shrink-0 ml-auto transition-colors ${
              bulkSelectMode
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            Bulk Select
          </button>
        )}
      </div>
    </div>
  );
}
