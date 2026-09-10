import { X } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import SeasonStats from '@/components/SeasonStats';

/**
 * Season stats as a drill-down.
 *
 * Stats are reference material, not something anyone acts on, so they stay
 * out of the way until asked for: players reach them from the dashboard
 * header, coaches from a player row. One component serves both so the two
 * views can never drift apart.
 *
 * SheetContent applies no padding of its own, so the padding here is not
 * decoration - without it the content runs into the edges of the sheet. The
 * header is sticky because the body scrolls: on a phone the title would
 * otherwise disappear before the stats did, leaving no way back out.
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
    <Sheet open={playerId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
        {/* Grab handle: signals the sheet is dismissable by dragging. */}
        <div className="sticky top-0 z-10 bg-background rounded-t-2xl">
          <div className="flex justify-center pt-2.5">
            <div className="h-1 w-9 rounded-full bg-muted-foreground/25" />
          </div>
          <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-3 border-b border-border">
            <SheetTitle>{playerName || 'Season stats'}</SheetTitle>
            <button
              onClick={onClose}
              aria-label="Close season stats"
              className="shrink-0 -mr-1.5 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* The bottom inset keeps the last row clear of the home indicator. */}
        <div className="px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {playerId && <SeasonStats playerId={playerId} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
