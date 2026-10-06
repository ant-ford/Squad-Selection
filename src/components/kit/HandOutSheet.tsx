import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ApiError } from '@/lib/apiClient';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { moveKit } from '@/api/kit';
import type { KitBoard, KitPerson } from '@shared/kit';
import { reportMove } from '@/lib/kitMoves';
import { PersonPicker, PlaceBadge, firstName, inputClass, primaryButton, secondaryButton, sizesLine } from './kitUi';

/**
 * Hand a batch of kit to whoever is collecting: a captain taking their
 * team's, a friend taking a few, or a player taking their own. Pick the
 * collector, and their team's sets still in the store are ticked; untick
 * any not handed over, add others by number, and confirm once.
 */
export default function HandOutSheet({ board, onClose, onDone }: { board: KitBoard; onClose: () => void; onDone: () => void }) {
  const wide = useMediaQuery('(min-width: 640px)');
  const [collector, setCollector] = useState<KitPerson | null>(null);
  const [team, setTeam] = useState('');
  const [extra, setExtra] = useState<string[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [numberInput, setNumberInput] = useState('');

  const teamSets = useMemo(
    () => (team ? board.sets.filter((s) => s.owner?.team === team) : []),
    [board.sets, team],
  );
  const shown = useMemo(() => {
    const ids = new Set(teamSets.map((s) => s.id));
    return [...teamSets, ...board.sets.filter((s) => extra.includes(s.id) && !ids.has(s.id))].sort((a, b) => a.shirtNo - b.shirtNo);
  }, [teamSets, extra, board.sets]);

  const chooseTeam = (t: string) => {
    setTeam(t);
    setTicked(new Set([...board.sets.filter((s) => s.owner?.team === t && s.place === 'in_store').map((s) => s.id), ...extra]));
  };
  const pickCollector = (p: KitPerson) => {
    setCollector(p);
    chooseTeam(board.teams.includes(p.team) ? p.team : '');
  };
  const toggle = (id: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const addNumber = () => {
    const n = Number(numberInput.trim());
    const set = board.sets.find((s) => s.shirtNo === n);
    if (!set) {
      toast.error(`There's no #${numberInput.trim()} in this order.`);
      return;
    }
    if (set.place !== 'in_store') toast.warning(`#${n}: ${set.place === 'on_order' ? 'still on order' : 'not in the kit store'}.`);
    else setTicked((t) => new Set(t).add(set.id));
    setExtra((e) => (e.includes(set.id) ? e : [...e, set.id]));
    setNumberInput('');
  };

  const chosen = shown.filter((s) => ticked.has(s.id) && s.place === 'in_store');
  const hand = useMutation({
    mutationFn: () =>
      moveKit({
        setIds: chosen.map((s) => s.id),
        to: collector!.id,
        // All from the store: a set someone else has just handed out is reported, not moved.
        expected: Object.fromEntries(chosen.map((s) => [s.id, null])),
      }),
    onSuccess: (result) => {
      reportMove(result, collector!.name);
      onDone();
      if (result.conflicts.length === 0) onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Not handed out: the connection or the server failed. Try again.'),
  });

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side={wide ? 'right' : 'bottom'} className="p-4 pb-8 overflow-y-auto flex flex-col gap-3">
        <SheetHeader onClose={onClose}>
          <SheetTitle>Hand out kit</SheetTitle>
        </SheetHeader>

        <section className="space-y-1">
          <h3 className="text-xs font-semibold text-muted-foreground">Who's collecting?</h3>
          {collector ? (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-sm text-foreground">
                {collector.name} <span className="text-xs text-muted-foreground">{collector.team}</span>
              </span>
              <button className="text-xs text-primary underline" onClick={() => { setCollector(null); setTeam(''); setTicked(new Set()); setExtra([]); }}>
                Change
              </button>
            </div>
          ) : (
            <PersonPicker people={board.people} onPick={pickCollector} autoFocus />
          )}
        </section>

        {collector && (
          <>
            <section className="space-y-1">
              <h3 className="text-xs font-semibold text-muted-foreground">Whose kit?</h3>
              <div className="flex gap-2">
                <select className={inputClass} value={team} onChange={(e) => chooseTeam(e.target.value)} aria-label="Team">
                  <option value="">No team: add by number</option>
                  {board.teams.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  inputMode="numeric"
                  placeholder="Add a shirt number"
                  value={numberInput}
                  onChange={(e) => setNumberInput(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && numberInput && addNumber()}
                  aria-label="Add a shirt number"
                />
                <button className={secondaryButton} disabled={!numberInput} onClick={addNumber}>
                  Add
                </button>
              </div>
            </section>

            {shown.length > 0 && (
              <ul className="rounded-md border border-border divide-y divide-border">
                {shown.map((s) => {
                  const available = s.place === 'in_store';
                  return (
                    <li key={s.id}>
                      <label className={`flex items-center gap-3 px-3 py-2 ${available ? 'cursor-pointer' : 'opacity-60'}`}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[hsl(var(--primary))]"
                          checked={available && ticked.has(s.id)}
                          disabled={!available}
                          onChange={() => toggle(s.id)}
                        />
                        <span className="w-9 text-right font-mono text-sm font-semibold">{s.shirtNo}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-foreground truncate">{s.owner?.name ?? 'Spare'}</span>
                          <span className="block text-xs text-muted-foreground truncate">{sizesLine(s.sizes)}</span>
                        </span>
                        {!available && <PlaceBadge set={s} />}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {team && teamSets.length === 0 && <p className="text-xs text-muted-foreground">No kit in this order for {team}.</p>}

            <button className={`${primaryButton} w-full`} disabled={chosen.length === 0 || hand.isPending} onClick={() => hand.mutate()}>
              {hand.isPending
                ? 'Handing out…'
                : `Hand ${chosen.length} kit${chosen.length === 1 ? '' : 's'} to ${firstName(collector.name)}`}
            </button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
