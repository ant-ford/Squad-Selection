import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import PlayerRow from '@/components/PlayerRow';
import type { MatchPlayer } from '@/api/getPlayersForMatch';

/**
 * The squad screen's player list, in the order given, virtualized against
 * the window so it scrolls with the page.
 */
export default function SquadPlayerList({
  players: sortedPlayers,
  onToggleSelection,
  onShowStats,
  onSetAvailability,
}: {
  players: MatchPlayer[];
  onToggleSelection: (player: MatchPlayer) => void;
  onShowStats: (player: MatchPlayer) => void;
  onSetAvailability: (player: MatchPlayer) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // The list scrolls with the page (it used to be a 60vh box of its own),
  // so the virtualizer needs to know where on the page the list starts.
  const [listTop, setListTop] = useState(0);
  const measureListTop = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
    setListTop(prev => (prev === top ? prev : top));
  }, []);
  useLayoutEffect(measureListTop);
  useEffect(() => {
    // Things above the list change height without this page re-rendering
    // (the filter panel opening an ability group, a banner loading).
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureListTop);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [measureListTop]);
  /**
   * Measured row heights are cached against THIS key, so it has to be the
   * same thing React keys the row by - the player.
   *
   * Left at the default (the index), the two disagreed the moment the list
   * reordered, which it does constantly: the 30s availability poll, the
   * recommendations arriving after the players query, and every selection
   * toggle all resort it. React moves a row's existing DOM node to its new
   * position rather than remounting it, so the measuring ref never fires
   * again, and the virtualizer went on using whatever height it had cached
   * for that SLOT. A tall row landing where a short one had been was given
   * the short one's height, and the next row was positioned on top of it -
   * which is what put "Available for B" across the row beneath it.
   *
   * Keyed by id, a height belongs to the player whose chips produced it and
   * follows them wherever they sort to.
   */
  const getItemKey = useCallback(
    (index: number) => sortedPlayers[index]?.id ?? index,
    [sortedPlayers],
  );
  const virtualizer = useWindowVirtualizer({
    count: sortedPlayers.length,
    scrollMargin: listTop,
    getItemKey,
    // Only ever used for a row that has not been measured yet. A bare row is
    // about this tall; the chip rows measure themselves on mount.
    estimateSize: () => 72,
    overscan: 10,
  });

  return (
    <div ref={listRef} className="container mx-auto px-4">
      {sortedPlayers.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          No players match the filters
        </div>
      ) : (
        <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const p = sortedPlayers[virtualRow.index];
            return (
              <div
                // virtualRow.key is getItemKey(index) - the player id. It
                // must stay in step with the virtualizer's own key or row
                // heights are cached against the wrong row.
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                }}
              >
                <PlayerRow
                  player={p}
                  selected={p.selectionStatus === 'Selected'}
                  onToggleSelection={() => onToggleSelection(p)}
                  onShowStats={() => onShowStats(p)}
                  onSetAvailability={() => onSetAvailability(p)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
