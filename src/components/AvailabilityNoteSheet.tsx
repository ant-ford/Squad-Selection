import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ActionButton } from '@/components/ui/action-button';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { safeFormat } from '@/lib/dateUtils';
import type { MyFixture } from '@/api/getMyFixtures';

/**
 * Asked straight after a player taps Maybe or No on a fixture card. The
 * answer is already saved by then; this only adds the optional note, so
 * closing it loses nothing but the note.
 */
export default function AvailabilityNoteSheet({
  fixture, status, conflictHint, busy, onSave, onClose,
}: {
  fixture: MyFixture;
  status: 'Maybe' | 'Unavailable';
  /** Soft hint: the player is Available for their My Team fixture on this date. */
  conflictHint?: string;
  /** The tap's own write is still in flight; saving now would race it. */
  busy: boolean;
  onSave: (notes: string) => void;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(fixture.playerNotes);

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom">
        <div className="px-4 py-6">
          <SheetHeader onClose={onClose}>
            <SheetTitle>{status === 'Maybe' ? 'Maybe' : 'Not available'} – add a note?</SheetTitle>
          </SheetHeader>

          <p className="py-2 text-xs text-muted-foreground">
            {fixture.homeTeam} vs {fixture.awayTeam} • {safeFormat(fixture.date, 'EEE d MMM')}
          </p>

          {conflictHint && status === 'Unavailable' && (
            <div className="mt-1 mb-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                You're available for your {conflictHint} fixture but unavailable for this support
                fixture. A note helps the coaches understand.
              </span>
            </div>
          )}

          <div className="flex flex-col">
            <label className="text-xs font-medium text-muted-foreground">Note for the coaches (optional)</label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={status === 'Maybe' ? 'e.g. "Depends on work, will know Thursday"' : 'e.g. "Away that weekend"'}
              className="mt-1"
              rows={2}
              autoFocus
            />
          </div>

          <div className="mt-3 flex gap-2">
            <ActionButton variant="outline" onClick={onClose} className="flex-1">
              Skip
            </ActionButton>
            <ActionButton
              onClick={() => onSave(notes.trim())}
              loading={busy}
              disabled={notes.trim() === fixture.playerNotes}
              className="flex-1"
            >
              Save note
            </ActionButton>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
