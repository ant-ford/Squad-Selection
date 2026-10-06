import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import ConfirmDialog from '@/components/ConfirmDialog';
import { ApiError } from '@/lib/apiClient';
import { safeFormat } from '@/lib/dateUtils';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { allocateSpare, editSetSizes, getSetHistory, moveKit, releaseSet, swapItem } from '@/api/kit';
import {
  KIT_ITEMS,
  KIT_SIZE_OPTIONS,
  describePlace,
  suggestSwaps,
  type KitBoard,
  type KitMove,
  type KitPerson,
  type KitSet,
  type KitSizes,
  type KitSwap,
} from '@shared/kit';
import { reportMove } from './HandOutSheet';
import { PersonPicker, firstName, inputClass, primaryButton, secondaryButton, sizesLine } from './kitUi';

const failed = (err: unknown) =>
  toast.error(err instanceof ApiError ? err.message : 'Not saved: the connection or the server failed. Try again.');

function moveLine(m: KitMove): string {
  switch (m.kind) {
    case 'handed':
      return `${m.from ?? 'Kit store'} → ${m.to}`;
    case 'delivered':
      return `${m.from ?? 'Kit store'} → ${m.to} (owner)`;
    case 'returned':
      return `${m.from ?? 'Someone'} → kit store`;
    case 'allocated':
      return `Given to ${m.to}${m.note ? ` (${m.note})` : ''}`;
    case 'released':
      return `Made a spare: ${m.from ?? 'the owner'} gave up the number`;
    case 'edited':
      return `Sizes corrected${m.note ? `: ${m.note}` : ''}`;
    case 'offered':
      return `${m.from ?? 'Someone'} says they gave it to ${m.to}`;
    case 'declined':
      return `${m.to} hasn't got it yet`;
  }
}

function History({ setId }: { setId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['kitHistory', setId], queryFn: () => getSetHistory(setId) });
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (!data?.length) return <p className="text-xs text-muted-foreground">Nothing yet.</p>;
  return (
    <ul className="space-y-1">
      {data.map((m, i) => (
        <li key={i} className="text-xs text-muted-foreground">
          <span className="text-foreground">{moveLine(m)}</span> · {safeFormat(m.at, 'd MMM, HH:mm')}
          {m.by && m.kind !== 'edited' ? ` · by ${m.by}` : m.by ? ` · ${m.by}` : ''}
        </li>
      ))}
    </ul>
  );
}

function SizesEditor({ set, onSaved, onCancel }: { set: KitSet; onSaved: () => void; onCancel: () => void }) {
  const [sizes, setSizes] = useState<KitSizes>(set.sizes);
  const save = useMutation({ mutationFn: () => editSetSizes(set.id, sizes), onSuccess: onSaved, onError: failed });
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        For what actually arrived. The shirt is printed with the number, so only change it if the supplier sent a different size.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {KIT_ITEMS.map(({ key, label }) => (
          <label key={key} className="text-xs text-muted-foreground">
            {label}
            <select className={inputClass} value={sizes[key] ?? ''} onChange={(e) => setSizes({ ...sizes, [key]: e.target.value || null })}>
              <option value="">None</option>
              {[...new Set([...(sizes[key] ? [sizes[key]!] : []), ...KIT_SIZE_OPTIONS[key]])].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button className={primaryButton} disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save sizes'}
        </button>
        <button className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** One set: where it is, and what can be done with it. */
export default function SetSheet({ set, board, onClose, onChanged }: { set: KitSet; board: KitBoard; onClose: () => void; onChanged: () => void }) {
  const wide = useMediaQuery('(min-width: 640px)');
  const [mode, setMode] = useState<'none' | 'give' | 'allocate' | 'sizes'>('none');
  const [confirm, setConfirm] = useState<null | { title: string; message: string; label: string; run: () => void }>(null);
  const [showHistory, setShowHistory] = useState(false);

  const done = () => {
    onChanged();
    setMode('none');
  };
  const move = useMutation({
    mutationFn: (to: { id: string | null; name: string }) =>
      moveKit({ setIds: [set.id], to: to.id, expected: { [set.id]: set.holder?.id ?? null } }).then((r) => ({ r, to })),
    onSuccess: ({ r, to }) => {
      reportMove(r, to.name);
      done();
    },
    onError: failed,
  });
  const allocate = useMutation({
    mutationFn: (p: KitPerson) => allocateSpare(set.id, p.id).then(() => p),
    onSuccess: (p) => {
      toast.success(`#${set.shirtNo} is now ${p.name}'s`);
      done();
    },
    onError: failed,
  });
  const swap = useMutation({
    mutationFn: (s: KitSwap) => swapItem(set.id, s.with.id, s.item).then(() => s),
    onSuccess: (s) => {
      toast.success(`${s.label} swapped with #${s.with.shirtNo}`);
      done();
    },
    onError: failed,
  });
  const swaps = useMemo(() => suggestSwaps(set, board.sets), [set, board.sets]);
  const release = useMutation({
    mutationFn: () => releaseSet(set.id),
    onSuccess: () => {
      toast.success(`#${set.shirtNo} is now a spare`);
      done();
    },
    onError: failed,
  });

  // For a spare: people without kit in this order, those it fits first.
  const candidates = useMemo(
    () =>
      board.people
        .filter((p) => p.active && !p.hasSet)
        .sort((a, b) => Number(b.sizes.shirt === set.sizes.shirt) - Number(a.sizes.shirt === set.sizes.shirt) || a.name.localeCompare(b.name)),
    [board.people, set.sizes.shirt],
  );
  const busy = move.isPending || allocate.isPending || release.isPending || swap.isPending;
  const owner = set.owner;
  const orderedForSomeoneElse = set.orderedForName && owner && set.orderedForName.toLowerCase() !== owner.name.toLowerCase();

  const confirmAllocate = (p: KitPerson) =>
    setConfirm({
      title: `Give #${set.shirtNo} to ${p.name}?`,
      message: [
        `${p.name} takes number ${set.shirtNo}${p.shirtNo ? `, instead of ${p.shirtNo}` : ''}, and this set.`,
        set.numberHeldBy ? `${set.numberHeldBy.name} (not Active) gives up the number.` : '',
        p.sizes.shirt && p.sizes.shirt !== set.sizes.shirt ? `Their shirt size is ${p.sizes.shirt}; this shirt is ${set.sizes.shirt}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      label: 'Give it to them',
      run: () => allocate.mutate(p),
    });

  return (
    <Sheet open onOpenChange={(open) => !open && !confirm && onClose()}>
      <SheetContent side={wide ? 'right' : 'bottom'} className="p-4 pb-8 overflow-y-auto flex flex-col gap-3">
        <SheetHeader onClose={onClose}>
          <div className="min-w-0">
            <SheetTitle>
              #{set.shirtNo} · {owner?.name ?? 'Spare'}
            </SheetTitle>
            <p className="text-xs text-muted-foreground">
              {describePlace(set)}
              {set.heldSince ? `${set.place === 'with_owner' ? '' : ' since'} ${safeFormat(set.heldSince, 'd MMM, HH:mm')}` : ''}
              {owner ? ` · ${[owner.team, owner.status].filter(Boolean).join(' · ')}` : ''}
            </p>
          </div>
        </SheetHeader>

        <section className="space-y-1">
          <p className="text-sm text-foreground">{sizesLine(set.sizes) || 'No sizes'}</p>
          {orderedForSomeoneElse && <p className="text-xs text-muted-foreground">Ordered for {set.orderedForName}.</p>}
          {set.numberHeldBy && (
            <p className="text-xs text-muted-foreground">
              A spare: number {set.shirtNo} is held by {set.numberHeldBy.name} ({[set.numberHeldBy.status, 'not Active'].filter(Boolean).join(', ')}).
              It moves to whoever gets this set.
            </p>
          )}
          {set.mismatches.map((m) => (
            <p key={m} className="text-xs text-amber-700 flex gap-1 items-start">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden /> {m}
            </p>
          ))}
          {swaps.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {swaps.map((s) => (
                <button
                  key={`${s.item}-${s.with.id}`}
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      title: `Swap ${s.label.toLowerCase()} with #${s.with.shirtNo}?`,
                      message: s.mutual
                        ? `#${set.shirtNo} gets ${s.label.toLowerCase()} ${s.with.sizes[s.item]} and ${s.with.owner!.name} (#${s.with.shirtNo}) gets ${set.sizes[s.item]}, the size each wants.`
                        : `#${set.shirtNo} gets the spare's ${s.label.toLowerCase()} (${s.with.sizes[s.item]}), and spare #${s.with.shirtNo} keeps ${set.sizes[s.item] ?? 'none'} instead.`,
                      label: 'Swap',
                      run: () => swap.mutate(s),
                    })
                  }
                >
                  {s.label} {s.with.sizes[s.item]}: {s.mutual ? `swap with ${firstName(s.with.owner!.name)} #${s.with.shirtNo}` : `from spare #${s.with.shirtNo}`}
                </button>
              ))}
            </div>
          )}
        </section>

        {set.place === 'on_order' ? (
          <p className="text-xs text-muted-foreground">This order hasn't arrived yet, so the set can't be handed out.</p>
        ) : (
          mode === 'none' && (
            <div className="flex flex-wrap gap-2">
              {owner && set.place !== 'with_owner' && (
                <button className={primaryButton} disabled={busy} onClick={() => move.mutate({ id: owner.id, name: owner.name })}>
                  Give to {firstName(owner.name)}
                </button>
              )}
              <button className={secondaryButton} disabled={busy} onClick={() => setMode('give')}>
                Give to someone else
              </button>
              {set.holder && (
                <button className={secondaryButton} disabled={busy} onClick={() => move.mutate({ id: null, name: 'the kit store' })}>
                  Back to the kit store
                </button>
              )}
            </div>
          )
        )}

        {mode === 'give' && (
          <section className="space-y-1">
            <h3 className="text-xs font-semibold text-muted-foreground">Who's taking it?</h3>
            <PersonPicker people={board.people} autoFocus onPick={(p) => move.mutate({ id: p.id, name: p.name })} />
            <button className="text-xs text-primary underline" onClick={() => setMode('none')}>
              Cancel
            </button>
          </section>
        )}

        {mode === 'none' && (
          <div className="flex flex-wrap gap-2">
            {!owner && (
              <button className={secondaryButton} disabled={busy} onClick={() => setMode('allocate')}>
                Give this spare to a joiner
              </button>
            )}
            {owner && (
              <button
                className={secondaryButton}
                disabled={busy}
                onClick={() =>
                  setConfirm({
                    title: `Make #${set.shirtNo} a spare?`,
                    message: `${owner.name} (${owner.status || 'no status'}) gives up number ${set.shirtNo}, and the set is kept as a spare for someone it fits. Someone who stops being Active doesn't need this: their set is already a spare.`,
                    label: 'Make it a spare',
                    run: () => release.mutate(),
                  })
                }
              >
                Make it a spare
              </button>
            )}
            <button className={secondaryButton} disabled={busy} onClick={() => setMode('sizes')}>
              Correct the sizes
            </button>
          </div>
        )}

        {mode === 'allocate' && (
          <section className="space-y-1">
            <h3 className="text-xs font-semibold text-muted-foreground">Who gets #{set.shirtNo}?</h3>
            <PersonPicker
              people={candidates}
              autoFocus
              describe={(p) => (p.sizes.shirt ? `Shirt ${p.sizes.shirt}${p.sizes.shirt === set.sizes.shirt ? ' · fits' : ''}` : 'No sizes yet')}
              onPick={confirmAllocate}
            />
            <button className="text-xs text-primary underline" onClick={() => setMode('none')}>
              Cancel
            </button>
          </section>
        )}

        {mode === 'sizes' && <SizesEditor set={set} onSaved={() => { toast.success('Sizes saved'); done(); }} onCancel={() => setMode('none')} />}

        <section>
          <button className="text-xs text-primary underline" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? 'Hide history' : 'History'}
          </button>
          {showHistory && (
            <div className="mt-2">
              <History setId={set.id} />
            </div>
          )}
        </section>
      </SheetContent>
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.run();
            setConfirm(null);
          }}
        />
      )}
    </Sheet>
  );
}
