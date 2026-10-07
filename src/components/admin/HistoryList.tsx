import { useQuery } from '@tanstack/react-query';
import EddyWordmark from '@/components/brand/EddyWordmark';
import { ErrorState } from '@/components/ui/error-state';
import { formatFullDateTime } from '@/lib/dateUtils';
import { historyDetail, newestFirst } from '@/lib/peopleAdmin';
import { getMatchHistory, getPersonHistory } from '@/api/adminPeople';

export const historyKey = (id: string) => ['personHistory', id] as const;
export const matchHistoryKey = (id: string) => ['matchHistory', id] as const;

/** A person's or a fixture's change history, newest first (GET /api/history). */
export default function HistoryList({ personId, matchId }: { personId?: string; matchId?: string }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: matchId ? matchHistoryKey(matchId) : historyKey(personId ?? ''),
    queryFn: () => (matchId ? getMatchHistory(matchId) : getPersonHistory(personId ?? '')),
    staleTime: 30_000,
  });
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (error || !data) {
    return <ErrorState variant="inline" title="Could not load the history" onRetry={() => void refetch()} retrying={isFetching} />;
  }
  if (data.entries.length === 0) return <p className="text-sm text-muted-foreground">Nothing yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {newestFirst(data.entries).map((e, i) => {
        // Eddy itself as the actor: the wordmark, not the plain name.
        const byEddy = e.actorLabel === 'eddy';
        const detail = historyDetail(byEddy ? { ...e, actor: null } : e);
        return (
          <li key={`${e.at}-${i}`} className="py-2 flex gap-3">
            <span className="w-32 shrink-0 text-xs text-muted-foreground tabular-nums pt-0.5">{formatFullDateTime(e.at)}</span>
            <span className="min-w-0">
              <span className="block text-sm text-foreground">{e.summary}</span>
              {(detail || byEddy) && (
                <span className="block text-xs text-muted-foreground">
                  {detail}
                  {byEddy && <>{detail ? ' · ' : ''}<span className="whitespace-nowrap">by <EddyWordmark size={1.5} /></span></>}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
