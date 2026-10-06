import { UserPlus } from 'lucide-react';
import type { InactiveRankingEntry } from '@shared/schema/domainTypes';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { POS_SHORT } from '@/lib/format';
import { nameOf, shortStage } from '@/lib/rankingModel';

/**
 * Players out of the ranking. Making one active again is for Section
 * Captains only, so without `onReactivate` the list is read-only.
 */
export function InactiveList({ entries, loading, onReactivate, draftPending, busyId }: {
  entries: InactiveRankingEntry[];
  loading: boolean;
  onReactivate?: (entry: InactiveRankingEntry) => void;
  /** An unsaved reorder exists: reactivating would throw it away. */
  draftPending: boolean;
  busyId: string | null;
}) {
  if (loading) return <Skeleton className="h-12 w-full" />;
  if (entries.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No inactive players</p>;
  return (
    <ul className="space-y-1">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center gap-2 py-1.5 px-2 bg-card border border-border rounded-lg">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{nameOf(e)}</p>
              {e.status === 'Applicant' && e.applicantStage && <StatusChip tone="warning">{shortStage(e.applicantStage)}</StatusChip>}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {e.registeredTeam ?? '–'} · {POS_SHORT[e.playingPosition ?? ''] ?? '–'}
              {typeof e.lastSectionRank === 'number' ? ` · last #${e.lastSectionRank}` : ''}
            </p>
          </div>
          {onReactivate && (
            <button
              type="button"
              onClick={() => { if (!draftPending) onReactivate(e); }}
              disabled={draftPending || busyId === e.id}
              title={draftPending ? 'Save or discard your reorder first' : undefined}
              className="flex items-center gap-1 min-h-10 text-sm px-3 rounded-md bg-primary text-primary-foreground whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <UserPlus className="h-4 w-4" />
              {e.status === 'Applicant' ? 'Add to ranking' : 'Make active'}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
