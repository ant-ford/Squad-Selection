import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { describePlace, type KitPerson, type KitPlace, type KitSet, type KitSizes } from '@shared/kit';

export const inputClass =
  'w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';

export const primaryButton =
  'inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50';
export const secondaryButton =
  'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-border bg-background text-sm text-foreground hover:bg-muted disabled:opacity-50';

/** "Shirt L · Shorts M · Socks Large · Smock XL, Long Sleeve". */
export function sizesLine(s: KitSizes): string {
  return [
    s.shirt && `Shirt ${s.shirt}`,
    s.shorts && `Shorts ${s.shorts}`,
    s.socks && `Socks ${s.socks}`,
    s.goalieSmock && `Smock ${s.goalieSmock}${s.goalieSmockStyle ? `, ${s.goalieSmockStyle}` : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

const PLACE_TONE: Record<KitPlace, string> = {
  on_order: 'bg-muted text-muted-foreground',
  in_store: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  with_holder: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  with_owner: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
};

export function PlaceBadge({ set }: { set: Pick<KitSet, 'place' | 'holder'> }) {
  return (
    <span className={`shrink-0 max-w-[9rem] truncate text-[11px] font-medium px-2 py-0.5 rounded-full ${PLACE_TONE[set.place]}`}>
      {describePlace(set)}
    </span>
  );
}

export const firstName = (name: string) => name.split(' ')[0] || name;

/**
 * Search-as-you-type over people: a name, or a shirt number. Shows the best
 * few matches; `rank` puts some people first (e.g. those a spare fits).
 */
export function PersonPicker({
  people,
  onPick,
  placeholder = 'Name or shirt number',
  describe,
  autoFocus,
}: {
  people: KitPerson[];
  onPick: (p: KitPerson) => void;
  placeholder?: string;
  describe?: (p: KitPerson) => string | null;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const byNo = /^\d+$/.test(t);
    return people
      .filter((p) => (byNo ? String(p.shirtNo ?? '') === t : p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(t)) || p.name.toLowerCase().includes(t)))
      .slice(0, 8);
  }, [people, q]);

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <input
          className={`${inputClass} pl-8`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-label={placeholder}
        />
      </div>
      {matches.length > 0 && (
        <ul className="rounded-md border border-border divide-y divide-border">
          {matches.map((p) => (
            <li key={p.id}>
              <button className="w-full text-left px-3 py-2 hover:bg-muted" onClick={() => { onPick(p); setQ(''); }}>
                <span className="text-sm text-foreground">{p.name}</span>
                <span className="text-xs text-muted-foreground">
                  {' '}
                  {[p.team, p.status !== 'Member' ? p.status : '', p.shirtNo ? `#${p.shirtNo}` : ''].filter(Boolean).join(' · ')}
                </span>
                {describe?.(p) && <span className="block text-xs text-muted-foreground">{describe(p)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim() && matches.length === 0 && <p className="text-xs text-muted-foreground px-1">Nobody matches.</p>}
    </div>
  );
}
