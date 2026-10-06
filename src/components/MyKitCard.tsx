import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Shirt } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { safeFormat } from '@/lib/dateUtils';
import { confirmKit, getMyKit, moveKit } from '@/api/kit';
import { reportMove } from '@/lib/kitMoves';
import type { MyKit } from '@shared/kit';
import { errorMessage } from '@/lib/errorMessages';

/** A captain holding a team's kit sees the first few; the rest are a tap away. */
const SHOWN = 5;

const button =
  'shrink-0 inline-flex items-center text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50';
const quiet =
  'shrink-0 inline-flex items-center text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-background text-foreground hover:bg-muted disabled:opacity-50';

const failed = (err: unknown) => toast.error(errorMessage(err, 'save'));
const first = (name?: string) => (name ?? '').split(' ')[0] || 'them';

function mineLine(mine: NonNullable<MyKit['mine']>, convenors: string[]): string {
  switch (mine.place) {
    case 'on_order':
      return `Your ${mine.supplier} kit (#${mine.shirtNo}) is on order.${mine.expectedOn ? ` Delivery is expected ${safeFormat(mine.expectedOn, 'do MMMM')}.` : ''}`;
    case 'in_store':
      return `Your kit (#${mine.shirtNo}) is ready to collect${convenors.length ? ` from ${convenors.join(' or ')}` : ' from the Kit Convenor'}.`;
    case 'with_holder':
      return `${mine.holder?.name ?? 'Someone'} has your kit (#${mine.shirtNo})${mine.heldSince ? ` since ${safeFormat(mine.heldSince, 'd MMM')}` : ''}.`;
    case 'with_owner':
      return '';
  }
}

interface Confirm {
  title: string;
  message: string;
  label: string;
  run: () => void;
}

/**
 * On the player page: where the player's own kit is until they have it, kit
 * someone says they've given them (to confirm), and kit they're holding for
 * others. Passing a set on is an offer the receiver confirms (owner,
 * 2026-10-01); "I've got it" asks first. Nothing once it's all delivered.
 */
export default function MyKitCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['myKit'], queryFn: getMyKit, staleTime: 30_000 });
  const [showAll, setShowAll] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['myKit'] });
    void queryClient.invalidateQueries({ queryKey: ['kitBoard'] });
  };
  const move = useMutation({
    mutationFn: (v: { setId: string; to: string; name: string; from: string | null }) =>
      moveKit({ setIds: [v.setId], to: v.to, expected: { [v.setId]: v.from } }).then((r) => ({ r, name: v.name })),
    onSuccess: ({ r, name }) => {
      reportMove(r, name);
      refresh();
    },
    onError: failed,
  });
  const answer = useMutation({
    mutationFn: (v: { setId: string; accept: boolean }) => confirmKit(v.setId, v.accept).then(() => v.accept),
    onSuccess: (accepted) => {
      toast.success(accepted ? "Thanks, that's recorded" : "OK, it's still shown with them");
      refresh();
    },
    onError: failed,
  });

  const incoming = data?.incoming ?? [];
  const mine = data?.mine && data.mine.place !== 'with_owner' && !incoming.some((i) => i.id === data.mine!.id) ? data.mine : null;
  const holding = data?.holding ?? [];
  if (!mine && holding.length === 0 && incoming.length === 0) return null;
  const busy = move.isPending || answer.isPending;

  return (
    <section aria-label="Kit" className="mb-3 rounded-xl border border-border bg-card divide-y divide-border">
      {incoming.map((i) => (
        <div key={i.id} className="flex items-center gap-3 p-3">
          <Shirt className="h-5 w-5 text-primary shrink-0" aria-hidden />
          <p className="flex-1 min-w-0 text-sm text-foreground">
            {i.holder?.name ?? 'Someone'} says they've given you {i.mine ? 'your kit' : `${i.owner?.name ?? 'a'}'s kit`} (#{i.shirtNo}). Have you got it?
          </p>
          <div className="flex gap-1.5">
            <button className={button} disabled={busy} onClick={() => answer.mutate({ setId: i.id, accept: true })}>
              Yes
            </button>
            <button className={quiet} disabled={busy} onClick={() => answer.mutate({ setId: i.id, accept: false })}>
              Not yet
            </button>
          </div>
        </div>
      ))}
      {mine && (
        <div className="flex items-center gap-3 p-3">
          <Shirt className="h-5 w-5 text-primary shrink-0" aria-hidden />
          <p className="flex-1 min-w-0 text-sm text-foreground">{mineLine(mine, data?.convenors ?? [])}</p>
          {(mine.place === 'with_holder' || mine.place === 'in_store') && (
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                setConfirm({
                  title: `Have you got your kit (#${mine.shirtNo})?`,
                  message: 'Only confirm once it’s in your hands. It will show as handed out to you.',
                  label: "Yes, I've got it",
                  run: () => move.mutate({ setId: mine.id, to: data!.personId, name: 'you', from: mine.holder?.id ?? null }),
                })
              }
            >
              I've got it
            </button>
          )}
        </div>
      )}
      {holding.length > 0 && (
        <div className="p-3 space-y-2">
          <p className="text-sm font-semibold text-foreground">Kit you're holding for others ({holding.length})</p>
          <p className="text-xs text-muted-foreground">Tap Given as you hand each one over. They'll be asked to confirm they've got it.</p>
          <ul className="divide-y divide-border">
            {(showAll ? holding : holding.slice(0, SHOWN)).map((h) => (
              <li key={h.id} className="flex items-center gap-3 py-1.5">
                <span className="w-9 text-right font-mono text-sm font-semibold">{h.shirtNo}</span>
                <span className="flex-1 min-w-0 text-sm text-foreground truncate">{h.owner?.name ?? 'Spare'}</span>
                {h.pendingTo ? (
                  <span className="shrink-0 text-xs text-muted-foreground">Waiting for {first(h.pendingTo.name)} to confirm</span>
                ) : (
                  h.owner && (
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          title: `Given #${h.shirtNo} to ${h.owner!.name}?`,
                          message: `${first(h.owner!.name)} will be asked to confirm they've got it. Until then it stays with you.`,
                          label: 'Yes, given',
                          run: () => move.mutate({ setId: h.id, to: h.owner!.id, name: h.owner!.name, from: data!.personId }),
                        })
                      }
                    >
                      Given
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
          {holding.length > SHOWN && (
            <button className="text-xs text-primary underline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${holding.length}`}
            </button>
          )}
        </div>
      )}
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
    </section>
  );
}
