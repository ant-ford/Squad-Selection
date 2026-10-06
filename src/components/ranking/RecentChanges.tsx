import { ArrowDown, ArrowUp, Minus, Plus } from 'lucide-react';
import type { RankingChange } from '@/lib/queries';
import { Skeleton } from '@/components/ui/skeleton';
import { formatAge, formatAbsolute } from '@/lib/rankingHistory';

/** The last 30 days of ranking changes, newest first (20 shown). */
export function RecentChanges({ changes, loading }: { changes: RankingChange[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-12 w-full" />;
  if (changes.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No changes in the last 30 days</p>;
  return (
    <ul className="space-y-1">
      {changes.slice(0, 20).map((c) => {
        const moved = c.kind !== 'activate' && c.kind !== 'deactivate' && c.oldRank != null && c.newRank != null;
        const up = moved && c.newRank! < c.oldRank!;
        const Icon = moved ? (up ? ArrowUp : ArrowDown) : c.kind === 'activate' ? Plus : Minus;
        return (
          <li key={c.id} className="flex items-start gap-2 py-1.5 px-2 bg-card border border-border rounded-lg">
            <Icon
              className={`h-4 w-4 mt-0.5 shrink-0 ${moved ? (up ? 'text-success-soft-foreground' : 'text-danger-soft-foreground') : 'text-muted-foreground'}`}
              aria-label={moved ? (up ? 'Up' : 'Down') : c.kind === 'activate' ? 'Made active' : 'Made inactive'}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground">
                <span className="font-medium">{c.playerName}</span>
                {c.oldRank != null && c.newRank != null && <span className="text-muted-foreground"> · {c.oldRank} → {c.newRank}</span>}
                {c.oldRank == null && c.newRank != null && <span className="text-muted-foreground"> · active at #{c.newRank}</span>}
                {c.newRank == null && c.oldRank != null && <span className="text-muted-foreground"> · inactive from #{c.oldRank}</span>}
              </p>
              {c.note && <p className="text-xs text-muted-foreground italic">"{c.note}"</p>}
              <p className="text-xs text-muted-foreground" title={formatAbsolute(c.at)}>
                {c.actorName} · {formatAge(c.at)}
                <span className="hidden sm:inline"> · {formatAbsolute(c.at)}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
