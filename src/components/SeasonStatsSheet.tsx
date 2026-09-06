import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import SeasonStats from '@/components/SeasonStats';

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
    <Sheet open={playerId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{playerName || 'Season stats'}</SheetTitle>
        </SheetHeader>
        {playerId && (
          <div className="pt-2">
            <SeasonStats playerId={playerId} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
