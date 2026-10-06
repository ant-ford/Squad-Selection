import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
      <SheetContent side="bottom">
        <SheetHeader onClose={onClose} closeLabel={closeLabel}>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <SheetBody>{children}</SheetBody>
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
