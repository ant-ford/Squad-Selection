import { useState } from 'react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ActionButton } from '@/components/ui/action-button';
import { preferenceTagLabel } from '@/lib/availabilityAnswers';
import AvailabilityAnswerControl from '@/components/AvailabilityAnswerControl';
import { Textarea } from '@/components/ui/textarea';
import { useQueryClient } from '@tanstack/react-query';
import { setPlayerAvailability, type AvailabilityStatus } from '@/api/setPlayerAvailability';
import { setPlayerOptInOnly } from '@/api/setPlayerOptInOnly';

export interface CoachAvailabilityTarget {
  id: string;
  name: string;
  availabilityStatus: string;
  availabilityFromRule?: boolean;
  /** Coach has inverted this player's default to opt-in only. */
  optInOnly?: boolean;
  playerNotes: string;
}

/**
 * A coach answering for a player.
 *
 * Players who cannot get into the app still tell their coach whether they
 * can play, and until now the coach had no way to put that answer where the
 * squad list, the tiles and the calendar would see it. This writes exactly
 * what the player's own tap would, with the coach recorded as the author.
 */
export default function CoachAvailabilitySheet({
  matchId,
  player,
  onClose,
  onSaved,
}: {
  matchId: string;
  player: CoachAvailabilityTarget;
  onClose: () => void;
  onSaved: (status: AvailabilityStatus, notes: string, exceptionId: string | null) => void;
}) {
  const startStatus: AvailabilityStatus =
    (['Available', 'Maybe', 'Unavailable'] as const).find((s) => s === player.availabilityStatus) ?? 'Available';
  const [status, setStatus] = useState<AvailabilityStatus>(startStatus);
  const [notes, setNotes] = useState(player.playerNotes);
  const [saving, setSaving] = useState(false);
  const [optInOnly, setOptInOnly] = useState(player.optInOnly === true);
  const [togglingOptIn, setTogglingOptIn] = useState(false);
  const queryClient = useQueryClient();

  /**
   * Optimistic, because a coach flipping this wants to see it move. It
   * changes the default answer on every unanswered fixture, so the whole
   * squad list is refetched rather than patched.
   */
  const toggleOptInOnly = async () => {
    const next = !optInOnly;
    setOptInOnly(next);
    setTogglingOptIn(true);
    try {
      await setPlayerOptInOnly(player.id, next);
      toast.success(next ? `${player.name} is now opt-in only` : `${player.name} is back to the normal default`);
      queryClient.invalidateQueries({ queryKey: ['playersForMatch'] });
      queryClient.invalidateQueries({ queryKey: ['availabilityPoll'] });
    } catch (err: unknown) {
      setOptInOnly(!next);
      toast.error(err instanceof Error ? err.message : 'Could not change the default');
    } finally {
      setTogglingOptIn(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await setPlayerAvailability(matchId, player.id, status, notes);
      // No success toast: the sheet closes and the row shows the new answer.
      onSaved(status, notes, result.exceptionId);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not update availability');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      dirty={!saving && (status !== startStatus || notes.trim() !== (player.playerNotes ?? '').trim())}
      onOpenChange={(next) => !next && onClose()}
    >
      <SheetContent side="bottom">
        <div className="px-4 py-6">
          <SheetHeader onClose={onClose}>
            <SheetTitle>Set availability</SheetTitle>
          </SheetHeader>

          <p className="pt-2 text-sm font-medium text-foreground">{player.name}</p>

          <AvailabilityAnswerControl
            className="py-3"
            value={status}
            onChange={setStatus}
            label={`Answer for ${player.name}`}
            preferenceLabel={
              player.availabilityFromRule && status === player.availabilityStatus ? preferenceTagLabel('their') : undefined
            }
          />

          <div className="py-2 flex flex-col">
            <label className="text-xs font-medium text-muted-foreground mb-1">Note (optional)</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder='e.g. "Told me on WhatsApp - away that weekend"'
              className="mt-0"
              rows={2}
            />
          </div>

          <ActionButton variant="outline" onClick={save} loading={saving} fullWidth className="mt-3">
            Save for {player.name}
          </ActionButton>

          {/* Season-long, and about the player rather than this fixture, so
              it sits below a divider instead of among the three answers. */}
          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Opt-in only</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Counts {player.name} as Unavailable for every fixture they have not answered,
                  instead of Available. For players who are rarely around and do not update their
                  status. They can still mark themselves available for any fixture.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={optInOnly}
                aria-label={`Opt-in only for ${player.name}`}
                disabled={togglingOptIn}
                onClick={toggleOptInOnly}
                className={`relative shrink-0 mt-0.5 h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${
                  optInOnly ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}
              >
                <span
                  className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    optInOnly ? 'translate-x-[22px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            {optInOnly && (
              <p className="text-xs text-muted-foreground mt-2">
                Only a coach can turn this off.
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
