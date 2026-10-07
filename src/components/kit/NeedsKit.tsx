import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Download } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { allocateSpare, downloadTopUp, giveNewNumber } from '@/api/kit';
import { suggestSpares, type KitBoard, type KitPerson, type KitSet } from '@shared/kit';
import { secondaryButton, sizesLine } from './kitUi';
import { errorMessage } from '@/lib/errorMessages';

const failed = (err: unknown) =>
  toast.error(errorMessage(err, 'save'));

function PersonRow({
  person,
  spares,
  teams,
  busy,
  onAllocate,
  onNewNumber,
}: {
  person: KitPerson;
  spares: KitSet[];
  teams: string[];
  busy: boolean;
  onAllocate: (p: KitPerson, s: KitSet) => void;
  onNewNumber: (p: KitPerson) => void;
}) {
  const fits = suggestSpares(person, spares, teams).slice(0, 3);
  return (
    <li className="px-3 py-2 space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="w-9 text-right font-mono text-sm font-semibold">{person.shirtNo ?? '–'}</span>
        <span className="flex-1 min-w-0 text-sm text-foreground truncate">
          {person.name}{' '}
          <span className="text-xs text-muted-foreground">{[person.team, person.status !== 'Member' ? person.status : ''].filter(Boolean).join(' · ')}</span>
        </span>
      </div>
      <p className="pl-11 text-xs text-muted-foreground">{sizesLine(person.sizes) || 'No sizes yet'}</p>
      <div className="pl-11 flex flex-wrap gap-1.5">
        {fits.map((s) => (
          <button key={s.id} className={`${secondaryButton} h-7 text-xs`} disabled={busy} onClick={() => onAllocate(person, s)}>
            Spare #{s.shirtNo} · {s.sizes.shirt}
          </button>
        ))}
        {person.shirtNo === null && person.team && (
          <button className={`${secondaryButton} h-7 text-xs`} disabled={busy} onClick={() => onNewNumber(person)}>
            New number
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Who has no kit in this order, and the spares. Someone without a number
 * gets a spare that fits (its number becomes theirs) or a new number for
 * the next top-up order; someone with a number but no set is on the top-up
 * list, unless a spare that fits is given to them instead.
 */
export default function NeedsKit({ board, onChanged }: { board: KitBoard; onChanged: () => void }) {
  const [confirm, setConfirm] = useState<null | { person: KitPerson; set: KitSet }>(null);
  const [exporting, setExporting] = useState(false);
  const spares = useMemo(() => board.sets.filter((s) => !s.owner), [board.sets]);
  // Those with sizes are ready to kit out; the rest are asked for sizes first.
  // Only Active players get kit.
  const active = board.people.filter((p) => p.active);
  const noNumber = active.filter((p) => p.shirtNo === null && p.sizes.shirt);
  const noSizes = active.filter((p) => p.shirtNo === null && !p.sizes.shirt);
  const topUp = active.filter((p) => p.shirtNo !== null && !p.hasSet).sort((a, b) => a.shirtNo! - b.shirtNo!);
  const bySize = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of spares) m.set(s.sizes.shirt ?? '?', (m.get(s.sizes.shirt ?? '?') ?? 0) + 1);
    return [...m.entries()];
  }, [spares]);

  const allocate = useMutation({
    mutationFn: ({ person, set }: { person: KitPerson; set: KitSet }) => allocateSpare(set.id, person.id).then(() => ({ person, set })),
    onSuccess: ({ person, set }) => {
      toast.success(`#${set.shirtNo} is now ${person.name}'s`);
      onChanged();
    },
    onError: failed,
  });
  const newNumber = useMutation({
    mutationFn: (p: KitPerson) => giveNewNumber(p.id).then((r) => ({ p, r })),
    onSuccess: ({ p, r }) => {
      toast.success(`${p.name} is #${r.shirtNo}. Their kit goes on the next top-up order.`);
      onChanged();
    },
    onError: failed,
  });
  const busy = allocate.isPending || newNumber.isPending;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const n = await downloadTopUp(board.order?.id);
      toast.success(`${n} ${n === 1 ? 'person' : 'people'} in the file`);
    } catch (err) {
      failed(err);
    } finally {
      setExporting(false);
    }
  };

  const row = (p: KitPerson) => (
    <PersonRow
      key={p.id}
      person={p}
      spares={spares}
      teams={board.teams}
      busy={busy}
      onAllocate={(person, set) => setConfirm({ person, set })}
      onNewNumber={(person) => newNumber.mutate(person)}
    />
  );

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-border bg-card p-3">
        <h2 className="text-sm font-semibold text-foreground">Spares: {spares.length}</h2>
        <p className="text-xs text-muted-foreground">
          {spares.length
            ? bySize.map(([size, n]) => `${n} × ${size}`).join(', ')
            : 'None yet. A set becomes a spare when its number’s holder isn’t Active.'}
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card">
        <h2 className="text-sm font-semibold text-foreground px-3 pt-3">No number yet: {noNumber.length}</h2>
        <p className="text-xs text-muted-foreground px-3">Give a spare that fits (lower numbers for higher teams first), or a new number from their team’s range.</p>
        <ul className="divide-y divide-border mt-2">{noNumber.map(row)}</ul>
        {noSizes.length > 0 && (
          <details className="border-t border-border">
            <summary className="px-3 py-2 text-xs text-muted-foreground cursor-pointer">
              No number and no sizes yet: {noSizes.length} (ask them for their sizes first)
            </summary>
            <ul className="divide-y divide-border">{noSizes.map(row)}</ul>
          </details>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 px-3 pt-3">
          <h2 className="flex-1 text-sm font-semibold text-foreground">Numbered, no set in this order: {topUp.length}</h2>
          <button className={`${secondaryButton} h-8 text-xs`} disabled={exporting || topUp.length === 0} onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> Top-up order
          </button>
        </div>
        <p className="text-xs text-muted-foreground px-3">They go on the next order with their own number, unless a spare fits.</p>
        <ul className="divide-y divide-border mt-2">{topUp.map(row)}</ul>
      </section>

      {confirm && (
        <ConfirmDialog
          title={`Give #${confirm.set.shirtNo} to ${confirm.person.name}?`}
          message={[
            `${confirm.person.name} takes number ${confirm.set.shirtNo}${confirm.person.shirtNo ? `, instead of ${confirm.person.shirtNo}` : ''}, and this set (${sizesLine(confirm.set.sizes)}).`,
            confirm.set.numberHeldBy ? `${confirm.set.numberHeldBy.name} (not Active) gives up the number.` : '',
          ].filter(Boolean).join(' ')}
          confirmLabel="Give it to them"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            allocate.mutate(confirm);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
