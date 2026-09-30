import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Shirt } from 'lucide-react';
import { ApiError } from '@/lib/apiClient';
import { safeFormat } from '@/lib/dateUtils';
import { getMyKit, moveKit } from '@/api/kit';
import { reportMove } from '@/components/kit/HandOutSheet';
import type { MyKit } from '@shared/kit';

/** A captain holding a team's kit sees the first few; the rest are a tap away. */
const SHOWN = 5;

const button =
  'shrink-0 inline-flex items-center text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50';

function mineLine(mine: NonNullable<MyKit['mine']>, convenors: string[]): string {
  switch (mine.place) {
    case 'on_order':
      return `Your ${mine.supplier} kit (#${mine.shirtNo}) is on order.`;
    case 'in_store':
      return `Your kit (#${mine.shirtNo}) is ready to collect${convenors.length ? ` from ${convenors.join(' or ')}` : ' from the Kit Convenor'}.`;
    case 'with_holder':
      return `${mine.holder?.name ?? 'Someone'} has your kit (#${mine.shirtNo})${mine.heldSince ? ` since ${safeFormat(mine.heldSince, 'd MMM')}` : ''}.`;
    case 'with_owner':
      return '';
  }
}

/**
 * On the player page: where the player's own kit is until they have it, and
 * the kit they're holding for others (a captain who collected the team's),
 * each ticked off as it's handed over. Nothing once it's all delivered.
 */
export default function MyKitCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['myKit'], queryFn: getMyKit, staleTime: 30_000 });
  const [showAll, setShowAll] = useState(false);
  const move = useMutation({
    mutationFn: (v: { setId: string; to: string; name: string; from: string | null }) =>
      moveKit({ setIds: [v.setId], to: v.to, expected: { [v.setId]: v.from } }).then((r) => ({ r, name: v.name })),
    onSuccess: ({ r, name }) => {
      reportMove(r, name);
      void queryClient.invalidateQueries({ queryKey: ['myKit'] });
      void queryClient.invalidateQueries({ queryKey: ['kitBoard'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Not saved: the connection or the server failed. Try again.'),
  });

  const mine = data?.mine && data.mine.place !== 'with_owner' ? data.mine : null;
  const holding = data?.holding ?? [];
  if (!mine && holding.length === 0) return null;

  return (
    <section aria-label="Kit" className="mb-3 rounded-xl border border-border bg-card divide-y divide-border">
      {mine && (
        <div className="flex items-center gap-3 p-3">
          <Shirt className="h-5 w-5 text-primary shrink-0" aria-hidden />
          <p className="flex-1 min-w-0 text-sm text-foreground">{mineLine(mine, data?.convenors ?? [])}</p>
          {(mine.place === 'with_holder' || mine.place === 'in_store') && (
            <button
              className={button}
              disabled={move.isPending}
              onClick={() => move.mutate({ setId: mine.id, to: data!.personId, name: 'you', from: mine.holder?.id ?? null })}
            >
              I've got it
            </button>
          )}
        </div>
      )}
      {holding.length > 0 && (
        <div className="p-3 space-y-2">
          <p className="text-sm font-semibold text-foreground">
            Kit you're holding for others ({holding.length})
          </p>
          <p className="text-xs text-muted-foreground">Tap as you hand each one over. They can also confirm it themselves.</p>
          <ul className="divide-y divide-border">
            {(showAll ? holding : holding.slice(0, SHOWN)).map((h) => (
              <li key={h.id} className="flex items-center gap-3 py-1.5">
                <span className="w-9 text-right font-mono text-sm font-semibold">{h.shirtNo}</span>
                <span className="flex-1 min-w-0 text-sm text-foreground truncate">{h.owner?.name ?? 'Spare'}</span>
                {h.owner && (
                  <button
                    className={button}
                    disabled={move.isPending}
                    onClick={() => move.mutate({ setId: h.id, to: h.owner!.id, name: h.owner!.name, from: data!.personId })}
                  >
                    Given
                  </button>
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
    </section>
  );
}
