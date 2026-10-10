import { useId, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ActionButton } from '@/components/ui/action-button';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { safeFormat } from '@/lib/dateUtils';
import type { MyFixture } from '@/api/getMyFixtures';

/**
 * Collect the note before saving a player's Maybe or No answer. Closing
 * without saving leaves their previous answer in place.
 */
export default function AvailabilityNoteSheet({
  fixture, status, allDay = false, conflictHint, busy, onSave, onClose,
}: {
  fixture: MyFixture;
  status: 'Maybe' | 'Unavailable';
  /** One explanation for every HKFC fixture on this fixture's Hong Kong day. */
  allDay?: boolean;
  /** Soft hint: the player is Available for their My Team fixture on this date. */
  conflictHint?: string;
  /** Answer and note are saved together. */
  busy: boolean;
  onSave: (notes: string) => void;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(fixture.playerNotes);
  const noteId = useId();
  const close = () => { if (!busy) onClose(); };

  return (
    <Sheet open dirty={!busy && notes.trim() !== fixture.playerNotes.trim()} onOpenChange={(next) => !next && close()}>
      <SheetContent side="bottom">
        <SheetHeader onClose={close}>
          <SheetTitle>{status === 'Maybe' ? 'Maybe' : 'No'} – add a note</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <p className="py-2 text-xs text-muted-foreground">
            {allDay ? 'All HKFC fixtures' : `${fixture.homeTeam} vs ${fixture.awayTeam}`} • {safeFormat(fixture.date, 'EEE d MMM')}
          </p>

          <p className="mb-3 text-xs text-muted-foreground">Please explain what affects your availability. For Maybe, say when you expect to confirm. Your answer changes when you save.</p>

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
            <label htmlFor={noteId} className="text-xs font-medium text-muted-foreground">Note for the coaches (required)</label>
            <Textarea
              id={noteId}
              required
              disabled={busy}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={status === 'Maybe' ? 'e.g. "Depends on work, will know Thursday"' : 'e.g. "Away that weekend"'}
              className="mt-1"
              rows={2}
              autoFocus
            />
          </div>

          <div className="mt-3 flex gap-2">
            <ActionButton variant="outline" onClick={close} disabled={busy} className="flex-1">
              Cancel
            </ActionButton>
            <ActionButton
              onClick={() => { if (notes.trim() && !busy) onSave(notes.trim()); }}
              loading={busy}
              disabled={!notes.trim()}
              className="flex-1"
            >
              Save answer
            </ActionButton>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
