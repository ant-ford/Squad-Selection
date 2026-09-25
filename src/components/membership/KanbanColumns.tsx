import { useRef, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The membership section's board layout, shared by Process and Statements:
 * stage chips above swipeable, snapping columns. Callers pass only the
 * columns to show (empty stages are hidden, owner request 2026-09-25).
 */
export default function KanbanColumns<T extends { id: string }>({
  columns,
  itemsFor,
  renderItem,
  chipLabel = (column) => column,
}: {
  columns: readonly string[];
  itemsFor: (column: string) => T[];
  renderItem: (item: T) => ReactNode;
  chipLabel?: (column: string) => string;
}) {
  const boardRef = useRef<HTMLDivElement>(null);

  // On a phone only one column is on screen, so the chips jump to a column.
  // They scroll the board itself, to the column's left edge less the
  // gutter: scrollIntoView is unreliable inside a snapping container and can
  // move the whole page as well.
  const jumpTo = (column: string) => {
    const board = boardRef.current;
    const target = board?.querySelector<HTMLElement>(`[data-column="${CSS.escape(column)}"]`);
    if (!board || !target) return;
    const gutter = parseFloat(getComputedStyle(board).paddingLeft) || 0;
    const left = board.scrollLeft + target.getBoundingClientRect().left - board.getBoundingClientRect().left - gutter;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    board.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <>
      <nav className="flex gap-1.5 overflow-x-auto pb-2 mb-1 -mx-4 px-4" aria-label="Jump to stage">
        {columns.map((column) => (
          <button
            key={column}
            onClick={() => jumpTo(column)}
            className="shrink-0 text-[11px] px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            {chipLabel(column)} · {itemsFor(column).length}
          </button>
        ))}
      </nav>
      {/* scroll-px keeps the page gutter when a column snaps into place. */}
      <div ref={boardRef} className="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 pb-3 -mx-4 px-4">
        {columns.map((column) => {
          const list = itemsFor(column);
          return (
            <section
              key={column}
              data-column={column}
              className="snap-start shrink-0 w-[85%] sm:w-72 flex flex-col"
              aria-label={column}
            >
              <header className="flex items-center justify-between gap-2 mb-2 px-1">
                <h2 className="text-xs font-semibold text-foreground truncate">{column}</h2>
                <span className="text-xs text-muted-foreground shrink-0">{list.length}</span>
              </header>
              <div className="space-y-2 bg-muted/40 rounded-lg p-2">
                {list.map((item) => (
                  <div key={item.id}>{renderItem(item)}</div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

export function BoardColumnsSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div key={i} className="shrink-0 w-[85%] sm:w-72 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
