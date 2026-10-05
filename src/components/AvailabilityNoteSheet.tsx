import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
            <Button onClick={onClose} className="flex-1">
              Skip
            </Button>
            <Button
              onClick={() => onSave(notes.trim())}
              disabled={busy || notes.trim() === fixture.playerNotes}
              className="flex-1 bg-primary text-primary-foreground disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2 inline" />}
              Save note
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
