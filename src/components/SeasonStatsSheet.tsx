import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, X } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import SeasonStats from '@/components/SeasonStats';
import AttendanceGrid from '@/components/AttendanceGrid';

/**
 * Shell for a per-player drill-down (season stats, attendance).
 *
 * SheetContent applies no padding of its own, so the padding here is not
 * decoration - without it the content runs into the edges of the sheet. The
 * header is sticky because the body scrolls: on a phone the title would
 * otherwise disappear before the content did, leaving no way back out.
 */
function PlayerDrillSheet({
  open,
  title,
  closeLabel,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
        {/* Grab handle: signals the sheet is dismissable by dragging. */}
        <div className="sticky top-0 z-20 bg-background rounded-t-2xl">
          <div className="flex justify-center pt-2.5">
            <div className="h-1 w-9 rounded-full bg-muted-foreground/25" />
          </div>
          <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-3 border-b border-border">
            <SheetTitle>{title}</SheetTitle>
            <button
              onClick={onClose}
              aria-label={closeLabel}
              className="shrink-0 -mr-1.5 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* The bottom inset keeps the last row clear of the home indicator. */}
        <div className="px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Season stats as a drill-down.
 *
 * Stats are reference material, not something anyone acts on, so they stay
 * out of the way until asked for: players reach them from the dashboard
 * header, coaches from a player row. One component serves both so the two
 * views can never drift apart.
 */
export default function SeasonStatsSheet({
  playerId,
  playerName,
  onClose,
}: {
  /** Null closes the sheet; the stats fetch is keyed off this id. */
  playerId: string | null;
  playerName?: string;
  onClose: () => void;
}) {
  return (
    <PlayerDrillSheet
      open={playerId !== null}
      title={playerName || 'Season stats'}
      closeLabel="Close season stats"
      onClose={onClose}
    >
      {playerId && (
        <>
          <SeasonStats playerId={playerId} />
          {/* Every season, on the Stats page (cards there only for the player themself). */}
          <Link
            to={`/stats?tab=players&season=all&player=${encodeURIComponent(playerId)}`}
            className="mt-4 flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm text-foreground hover:bg-muted"
          >
            Whole career
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        </>
      )}
    </PlayerDrillSheet>
  );
}

/** Per-fixture attendance and availability grid, opened from a coach's player row. */
export function AttendanceSheet({
  playerId,
  playerName,
  onClose,
}: {
  /** Null closes the sheet; the fetch is keyed off this id. */
  playerId: string | null;
  playerName?: string;
  onClose: () => void;
}) {
  return (
    <PlayerDrillSheet
      open={playerId !== null}
      title={playerName ? `${playerName} · attendance` : 'Attendance'}
      closeLabel="Close attendance"
      onClose={onClose}
    >
      {playerId && <AttendanceGrid playerId={playerId} />}
    </PlayerDrillSheet>
  );
}
