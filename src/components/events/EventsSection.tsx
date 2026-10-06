import { Suspense, lazy, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PartyPopper } from 'lucide-react';
import { getMyEvents } from '@/api/events';
import { RESPONSE_LABEL } from '@shared/events';
import { eventWhen, statusChip } from './eventText';

// Loaded when an event is opened, not with the player page.
const EventSheet = lazy(() => import('./EventSheet'));

/**
 * Special events on the player page, beside the fixtures: those they're
 * invited to or have answered, until the day after each ends. A card opens
 * the event; so does a link with ?event=<id> (the My Tasks line, or one a
 * social secretary shared on WhatsApp).
 */
export default function EventsSection({ enabled }: { enabled: boolean }) {
  const [params, setParams] = useSearchParams();
  const { data } = useQuery({ queryKey: ['myEvents'], queryFn: getMyEvents, enabled });
  const events = data?.events ?? [];
  const openId = params.get('event');
  const open = openId ? events.find((e) => e.id === openId) : undefined;
  const close = () =>
    setParams(
      (p) => {
        p.delete('event');
        return p;
      },
      { replace: true },
    );
  // A link to an event they can't see (not invited, or long past) just drops the parameter.
  useEffect(() => {
    if (openId && data && !open) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, data, open]);

  if (!events.length) return null;
  return (
    <section aria-label="Events" className="mt-3 space-y-2">
      <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
        <PartyPopper className="h-4 w-4 text-primary" /> Events
      </h2>
      {events.map((e) => {
        const answer = e.mine?.status;
        return (
          <button
            key={e.id}
            onClick={() => setParams((p) => { p.set('event', e.id); return p; })}
            className="w-full text-left bg-card border border-border rounded-xl p-3 flex items-center gap-3 hover:bg-muted/50"
          >
            <div className="h-14 w-14 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
              {e.posterUrl ? <img src={e.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <PartyPopper className="h-6 w-6 text-muted-foreground" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{e.title}</p>
              <p className="text-xs text-muted-foreground truncate">{eventWhen(e)}</p>
              {e.location && <p className="text-xs text-muted-foreground truncate">{e.location}</p>}
            </div>
            {e.status === 'cancelled' ? (
              <span className="shrink-0 text-xs font-medium px-2 py-1 rounded bg-destructive/10 text-destructive">Cancelled</span>
            ) : answer ? (
              <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded ${statusChip[answer]}`}>{RESPONSE_LABEL[answer]}</span>
            ) : e.open && e.invited ? (
              <span className="shrink-0 text-xs font-medium px-2 py-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">Answer</span>
            ) : null}
          </button>
        );
      })}
      {open && (
        <Suspense fallback={null}>
          <EventSheet event={open} onClose={close} />
        </Suspense>
      )}
    </section>
  );
}
