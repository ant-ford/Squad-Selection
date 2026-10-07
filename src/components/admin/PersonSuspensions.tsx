import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { safeFormat } from '@/lib/dateUtils';
import { closedHow, leftLabel, personSuspensions, queueLabel, queuePositions } from '@/lib/suspensions';
import { getSuspensions } from '@/api/suspensions';

const day = (d: string | null) => safeFormat(d, 'd MMM', '');

/** A row that opens the Suspensions screen. */
function Row({ chips, detail }: { chips: ReactNode; detail: string }) {
  return (
    <li>
      <Link
        to="/suspensions"
        className="flex items-center gap-2 px-3 py-2 hover:bg-muted rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">{chips}</span>
          <span className="block text-xs text-muted-foreground mt-0.5 line-clamp-2">{detail}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

/**
 * The person's open and recent suspensions on their person page: the
 * Suspensions screen's board (the same query, so either fills the other),
 * cut to them. For the Men's Convenor (the `discipline` section).
 */
export default function PersonSuspensions({ personId }: { personId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['suspensions'], queryFn: getSuspensions, staleTime: 30_000 });
  if (isLoading) return <Skeleton className="h-12 w-full" />;
  if (!data) return null;
  const { open, cleared, card, flag } = personSuspensions(data, personId);
  if (open.length + cleared.length === 0 && !card && !flag) return null;
  const queue = queuePositions(open);

  return (
    <ul className="rounded-lg border border-border divide-y divide-border" aria-label="Suspensions">
      {open.map((s) => {
        const left = leftLabel(s);
        const q = queueLabel(queue.get(s.id));
        return (
          <Row
            key={s.id}
            chips={
              <>
                <StatusChip tone={left.tone}>{left.label}</StatusChip>
                {q && <StatusChip tone="neutral">{q}</StatusChip>}
              </>
            }
            detail={`${s.servingTeam} · from ${day(s.fromDate)} · ${s.reason}`}
          />
        );
      })}
      {card && (
        <Row
          chips={
            <>
              <StatusChip tone="warning">{`${card.remainingMatches} left`}</StatusChip>
              {card.dcReferral && <StatusChip tone="danger">DC referral</StatusChip>}
            </>
          }
          detail={`Cards · ${card.servingTeam ?? 'No registered team'} · ${card.points} points`}
        />
      )}
      {flag && (
        <Row
          chips={<StatusChip tone="warning">{flag.matchesToServe ? `${flag.matchesToServe} to serve` : 'Suspended'}</StatusChip>}
          detail="Old flag"
        />
      )}
      {cleared.map((s) => {
        const how = closedHow(s);
        return (
          <Row
            key={s.id}
            chips={<StatusChip tone={how.label === 'Served' ? 'success' : 'neutral'}>{`${how.label} ${day(how.date)}`}</StatusChip>}
            detail={`${s.servingTeam} · from ${day(s.fromDate)} · ${s.reason}`}
          />
        );
      })}
    </ul>
  );
}
