import { Suspense, lazy, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, PartyPopper } from 'lucide-react';
import { StatusChip } from '@/components/ui/status-chip';
import { getMyEvents } from '@/api/events';
import { RESPONSE_LABEL, type ResponseStatus } from '@shared/events';
import type { StatusTone } from '@/lib/statusTone';
import { useSheetParam } from '@/lib/useSheetParam';
import { eventWhen } from './eventText';

const ANSWER_TONE: Record<ResponseStatus, StatusTone> = { going: 'success', maybe: 'warning', not_going: 'neutral' };

// Loaded when an event is opened, not with the player page.
const EventSheet = lazy(() => import('./EventSheet'));

/**
 * Special events on the player page, below the fixtures: those they're
 * invited to or have answered, until the day after each ends. One row
 * ("Events (2)", with how many still need an answer) that opens the list; a
 * card opens the event, and so does a link with ?event=<id> (the My Tasks
 * line, or one a social secretary shared on WhatsApp) even while the list is
 * closed. The open event stays in the URL, so Back closes it.
 */
export default function EventsSection({ enabled }: { enabled: boolean }) {
  const sheet = useSheetParam('event');
  const [expanded, setExpanded] = useState(false);
  const { data } = useQuery({ queryKey: ['myEvents'], queryFn: getMyEvents, enabled });
  const events = data?.events ?? [];
  const openId = sheet.value;
  const open = openId ? events.find((e) => e.id === openId) : undefined;
  const close = sheet.close;
  // A link to an event they can't see (not invited, or long past) just drops the parameter.
  useEffect(() => {
    if (openId && data && !open) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, data, open]);

  if (!events.length) return null;
  const toAnswer = events.filter((e) => e.status !== 'cancelled' && !e.mine?.status && e.open && e.invited).length;
  return (
    <section aria-label="Events" className="mt-6">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full min-h-11 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PartyPopper className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-0 text-sm font-medium text-foreground">Events ({events.length})</span>
        {toAnswer > 0 && <StatusChip tone="warning">{toAnswer} to answer</StatusChip>}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {events.map((e) => {
            const answer = e.mine?.status;
            return (
              <button
                key={e.id}
                onClick={() => sheet.open(e.id)}
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
                  <StatusChip tone="danger">Cancelled</StatusChip>
                ) : answer ? (
                  <StatusChip tone={ANSWER_TONE[answer]}>{RESPONSE_LABEL[answer]}</StatusChip>
                ) : e.open && e.invited ? (
                  <StatusChip tone="warning">Answer</StatusChip>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
      {open && (
        <Suspense fallback={null}>
          <EventSheet event={open} onClose={close} />
        </Suspense>
      )}
    </section>
  );
}
