import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Search } from 'lucide-react';
import { useStatementBoard } from '@/lib/queries';
import { hkDateKey } from '@shared/hkDateKey';
import { REVIEW_NEEDS_FIXING, shortReviewStage } from '@shared/statementStages';
import KanbanColumns, { BoardColumnsSkeleton } from './KanbanColumns';
import StatementCard from './StatementCard';
import StatementSheet from './StatementSheet';

/**
 * The Statements tab: each member's yearly commitment review by Review
 * Progress. Read-only apart from Notify now on a Not Started review.
 */
export default function StatementsBoard() {
  const { data: board, isLoading, isError, refetch } = useStatementBoard();
  const [params, setParams] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  const today = hkDateKey(new Date().toISOString());

  const query = params.get('q') ?? '';
  const setQuery = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true });
  };

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board?.cards ?? []).filter(
      (c) => !q || c.name.toLowerCase().includes(q) || (c.membershipNo ?? '').includes(q),
    );
  }, [board, query]);

  const byColumn = (column: string) => cards.filter((c) => c.column === column);
  const broken = byColumn(REVIEW_NEEDS_FIXING);
  const columns = (board?.columns ?? []).filter((column) => byColumn(column).length > 0);
  const open = cards.find((c) => c.id === openId) ?? null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="relative flex-1 min-w-[12rem]">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or Membership No."
            className="w-full h-9 rounded-md border border-border bg-background pl-8 pr-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Search reviews"
          />
        </label>
      </div>

      {board && !board.hasStageDates && (
        <p className="text-xs text-muted-foreground mb-3">
          Days in stage come from the submission dates until Commitments has a "Review Progress Updated At" field.
        </p>
      )}

      {(broken.length > 0 || (board?.unlinked ?? 0) > 0) && (
        <div className="mb-3 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-1">
          <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            Commitments rows that need fixing in Airtable
          </p>
          {broken.length > 0 && (
            <p className="text-xs text-muted-foreground">
              No valid Review Progress, so the automation will never pick them up:{' '}
              {broken.map((c) => `${c.name} (${c.stage || 'blank'})`).join(', ')}
            </p>
          )}
          {(board?.unlinked ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              {board!.unlinked} {board!.unlinked === 1 ? 'row has' : 'rows have'} no member in the People link, so no
              email can go out.
            </p>
          )}
        </div>
      )}

      {isLoading ? (
        <BoardColumnsSkeleton />
      ) : isError || !board ? (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground mb-2">Could not load the commitment reviews.</p>
          <button onClick={() => refetch()} className="text-sm text-primary underline">
            Try again
          </button>
        </div>
      ) : columns.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground">{query ? 'No reviews match.' : 'No commitment reviews in progress.'}</p>
        </div>
      ) : (
        <KanbanColumns
          columns={columns}
          itemsFor={byColumn}
          chipLabel={shortReviewStage}
          renderItem={(card) => <StatementCard card={card} today={today} onOpen={() => setOpenId(card.id)} />}
        />
      )}

      {open && <StatementSheet card={open} today={today} onClose={() => setOpenId(null)} />}
    </>
  );
}
