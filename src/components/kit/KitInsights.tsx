import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import InsightsGroup from '@/components/membership/InsightsGroup';
import { ChartCard, DataTable, HBars, StatTile } from '@/components/membership/charts';
import { safeFormat } from '@/lib/dateUtils';
import { SIZE_ITEMS, kitHolders, sizeCounts, splitOrder, type KitBoard, type KitHolder } from '@shared/kit';
import { firstName, inputClass } from './kitUi';

/** The Sets tab's filters a tracking tile opens. */
type SetsFilter = 'in_store' | 'with_holder' | 'with_owner' | 'spare' | 'all';

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');

function Tile({ label, value, hint, onClick }: { label: string; value: number; hint?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary hover:opacity-90">
      <StatTile label={label} value={value} hint={hint} />
    </button>
  );
}

function HolderRow({ holder, onOpenSet }: { holder: KitHolder; onOpenSet: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
      >
        <span className="flex-1 min-w-0 text-sm text-foreground truncate">{holder.name}</span>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{holder.sets.length}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <ul className="pb-2">
          {holder.sets.map((s) => (
            <li key={s.id}>
              <button onClick={() => onOpenSet(s.id)} className="w-full flex items-baseline gap-2 pl-6 pr-3 py-1 text-left hover:bg-muted/50">
                <span className="w-9 text-right font-mono text-sm font-semibold">{s.shirtNo}</span>
                <span className="flex-1 min-w-0 text-sm text-foreground truncate">{s.owner?.name ?? 'Spare'}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {s.pendingTo
                    ? `Offered to ${firstName(s.pendingTo.name)}`
                    : s.heldSince
                    ? `Since ${safeFormat(s.heldSince, 'd MMM')}`
                    : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The kit screen's Insights tab (owner, 2026-10-06): where the kit is, who
 * holds other people's kit (tap for whose), and how sizes are spread, so a
 * re-order can be split across sizes. The size counts use each person's own
 * sizes for the order's supplier, as the Airtable "Kit Size Distributions"
 * page did.
 */
export default function KitInsights({
  board,
  onOpenSet,
  onShowSets,
}: {
  board: KitBoard;
  onOpenSet: (id: string) => void;
  onShowSets: (filter: SetsFilter) => void;
}) {
  const [group, setGroup] = useState<'active' | 'needs'>('active');
  const [orderOf, setOrderOf] = useState('');

  const sets = board.sets;
  const owned = (place: string) => sets.filter((s) => s.owner && s.place === place).length;
  const spares = sets.filter((s) => !s.owner).length;
  const onOrder = sets.filter((s) => s.place === 'on_order').length;
  const holders = useMemo(() => kitHolders(sets), [sets]);
  const heldForOthers = holders.reduce((n, h) => n + h.sets.length, 0);

  const active = board.people.filter((p) => p.active);
  const people = group === 'needs' ? active.filter((p) => !p.hasSet) : active;
  const members = people.filter((p) => p.status === 'Member').length;
  const n = Math.max(0, Math.min(999, Number.parseInt(orderOf, 10) || 0));

  return (
    <div className="space-y-6">
      <InsightsGroup id="kit-tracking" title="Where the kit is">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {onOrder > 0 ? (
            <Tile label="On order" value={onOrder} hint="Not arrived yet" onClick={() => onShowSets('all')} />
          ) : (
            <Tile label="In the kit store" value={owned('in_store')} hint="Waiting to be collected" onClick={() => onShowSets('in_store')} />
          )}
          <Tile label="With someone else" value={heldForOthers} hint={`${holders.length} ${holders.length === 1 ? 'person' : 'people'} holding`} onClick={() => onShowSets('with_holder')} />
          <Tile label="Handed out" value={owned('with_owner')} hint={pct(owned('with_owner'), sets.length - spares) + ' of players’ sets'} onClick={() => onShowSets('with_owner')} />
          <Tile label="Spares" value={spares} hint="No Active owner" onClick={() => onShowSets('spare')} />
        </div>

        <section className="rounded-lg border border-border bg-card">
          <div className="px-3 pt-3 pb-2">
            <h3 className="text-sm font-semibold text-foreground">Who's holding other people's kit</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Captains and friends collecting for others. Tap a name for whose kit they have.</p>
          </div>
          {holders.length === 0 ? (
            <p className="px-3 pb-3 text-sm text-muted-foreground">Nobody is holding anyone else's kit.</p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {holders.map((h) => (
                <HolderRow key={h.id} holder={h} onOpenSet={onOpenSet} />
              ))}
            </ul>
          )}
        </section>
      </InsightsGroup>

      <InsightsGroup id="kit-sizes" title="Sizes">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['active', `Active players ${active.length}`],
              ['needs', `Need kit ${active.filter((p) => !p.hasSet).length}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setGroup(key)}
              aria-pressed={group === key}
              className={`text-xs px-2.5 py-1 rounded-full border ${group === key ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-foreground'}`}
            >
              {label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            Split a re-order of
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={999}
              className={inputClass.replace('w-full', 'w-20')}
              value={orderOf}
              onChange={(e) => setOrderOf(e.target.value)}
              placeholder="sets"
              aria-label="Sets to order"
            />
          </label>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
          <StatTile label={group === 'needs' ? 'Need kit' : 'Active players'} value={people.length} />
          <StatTile label="Members" value={members} />
          <StatTile label="Applicants" value={people.length - members} />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {SIZE_ITEMS.map(({ key, label }) => {
            const { rows, missing } = sizeCounts(key, people, sets);
            const total = rows.reduce((t, r) => t + r.people, 0);
            // Smocks are for goalkeepers only: a re-order needs them in the
            // same share as goalkeepers in the group.
            const items = key === 'goalieSmock' ? Math.round((n * total) / Math.max(1, people.length)) : n;
            const split = splitOrder(rows.map((r) => r.people), items);
            const notes = (i: number) =>
              [n > 0 && `order ${split[i]}`, rows[i].spares > 0 && `${rows[i].spares} spare${rows[i].spares === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
            return (
              <ChartCard
                key={key}
                title={label}
                caption={
                  key === 'goalieSmock'
                    ? `${total} goalkeeper${total === 1 ? '' : 's'}`
                    : `${total} with a size${missing ? ` · ${missing} not given` : ''}`
                }
                table={
                  <DataTable
                    head={['Size', 'People', 'Share', 'Spares', ...(n > 0 ? ['Order'] : [])]}
                    rows={rows.map((r, i) => [r.size, r.people, pct(r.people, total), r.spares, ...(n > 0 ? [split[i]] : [])])}
                  />
                }
              >
                <HBars narrowLabels unit="people" rows={rows.map((r, i) => ({ label: r.size, value: r.people, note: notes(i) || undefined }))} />
              </ChartCard>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Each person's own sizes for {board.order?.supplier ?? 'this supplier'}. The exact list of who needs a set is the
          download on Needs kit.
        </p>
      </InsightsGroup>
    </div>
  );
}
