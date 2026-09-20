import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, HelpCircle, XCircle, Loader2, Info } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useQueryClient } from '@tanstack/react-query';
import { setPlayerAvailability, type AvailabilityStatus } from '@/api/setPlayerAvailability';
import { setPlayerOptInOnly } from '@/api/setPlayerOptInOnly';

const OPTIONS: { value: AvailabilityStatus; label: string; Icon: typeof CheckCircle2 }[] = [
  { value: 'Available', label: 'Available', Icon: CheckCircle2 },
  { value: 'Maybe', label: 'Maybe', Icon: HelpCircle },
  { value: 'Unavailable', label: 'Unavailable', Icon: XCircle },
];

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
  const [status, setStatus] = useState<AvailabilityStatus>(
    (['Available', 'Maybe', 'Unavailable'] as const).find((s) => s === player.availabilityStatus) ?? 'Available',
  );
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
      toast.success(`${player.name}: ${status}`);
      onSaved(status, notes, result.exceptionId);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not update availability');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom">
        <div className="px-4 py-6">
          <SheetHeader onClose={onClose}>
            <SheetTitle>Set availability</SheetTitle>
          </SheetHeader>

          <div className="py-2">
            <p className="text-sm font-medium text-foreground">{player.name}</p>
            <p className="text-xs text-muted-foreground">
              Currently {player.availabilityStatus || 'Available'}
              {player.availabilityFromRule ? ' from their availability preferences' : ''}
            </p>
          </div>

          <div className="space-y-2 py-3">
            {OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatus(opt.value)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors text-left ${
                  status === opt.value ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <opt.Icon className={`h-5 w-5 ${status === opt.value ? 'text-primary' : 'text-muted-foreground'}`} />
                <p className="text-sm font-medium text-foreground">{opt.label}</p>
              </button>
            ))}
          </div>

          {/* Available used to be stored as "no answer", so it could not beat
              a standing preference and the coach was warned it would do
              nothing. It is now recorded explicitly whenever something would
              otherwise contradict it, so the note says the opposite. */}
          {status === 'Available' && player.availabilityFromRule && (
            <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                {player.optInOnly
                  ? `${player.name} is opt-in only, so they count as Unavailable until they answer.`
                  : `Their preferences make them ${player.availabilityStatus} for this fixture.`}{' '}
                Saving Available records an answer for this fixture only, which overrides that.
              </span>
            </div>
          )}

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

          <Button onClick={save} disabled={saving} className="w-full mt-3">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save for {player.name}
          </Button>

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
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
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
