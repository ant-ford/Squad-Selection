import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, HelpCircle, XCircle, Loader2, Info } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { setPlayerAvailability, type AvailabilityStatus } from '@/api/setPlayerAvailability';

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

          {/* Available is stored as "no answer", so it cannot beat a standing
              preference of the player's. Say so before the coach saves and
              wonders why nothing changed. */}
          {status === 'Available' && player.availabilityFromRule && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                This player's preferences make them {player.availabilityStatus} for this fixture.
                Available clears any answer for the fixture, but the preference will still apply.
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
