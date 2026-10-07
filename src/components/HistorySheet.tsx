import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import HistoryList from '@/components/admin/HistoryList';

/** Who changed what: a player's or a fixture's history, for its coaches and officers. */
export default function HistorySheet({
  title,
  personId,
  matchId,
  onClose,
}: {
  title: string;
  personId?: string;
  matchId?: string;
  onClose: () => void;
}) {
  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="p-4 sm:max-w-lg sm:mx-auto sm:left-0 sm:right-0">
        <SheetHeader onClose={onClose}>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <HistoryList personId={personId} matchId={matchId} />
      </SheetContent>
    </Sheet>
  );
}
