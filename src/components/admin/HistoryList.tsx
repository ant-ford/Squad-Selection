import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '@/components/ui/error-state';
import { formatFullDateTime } from '@/lib/dateUtils';
import { historyDetail, newestFirst } from '@/lib/peopleAdmin';
import { getPersonHistory } from '@/api/adminPeople';

export const historyKey = (id: string) => ['personHistory', id] as const;

/** A person's change history, newest first (GET /api/history). */
export default function HistoryList({ personId }: { personId: string }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: historyKey(personId),
    queryFn: () => getPersonHistory(personId),
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
        const detail = historyDetail(e);
        return (
          <li key={`${e.at}-${i}`} className="py-2 flex gap-3">
            <span className="w-32 shrink-0 text-xs text-muted-foreground tabular-nums pt-0.5">{formatFullDateTime(e.at)}</span>
            <span className="min-w-0">
              <span className="block text-sm text-foreground">{e.summary}</span>
              {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
