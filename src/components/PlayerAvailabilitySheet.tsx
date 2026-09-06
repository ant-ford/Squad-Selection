import { useState } from 'react';
import { safeFormat } from '@/lib/dateUtils';
import { setMyAvailability } from '@/api/setMyAvailability';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, HelpCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';
import type { MyFixture } from '@/api/getMyFixtures';
import { POS_SHORT } from '@/lib/format';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useMatchSquad } from '@/lib/queries';

const OPTIONS = [
  { value: 'Available', label: 'Going', Icon: CheckCircle2, color: 'text-green-600' },
  { value: 'Maybe', label: 'Maybe', Icon: HelpCircle, color: 'text-amber-600' },
  { value: 'Unavailable', label: 'No', Icon: XCircle, color: 'text-red-600' },
] as const;

export default function PlayerAvailabilitySheet({
  fixture, conflictHint, onClose, onSaved,
}: {
  fixture: MyFixture;
  /** Soft hint: the player is Available for their My Team fixture on this date. */
  conflictHint?: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [status, setStatus] = useState<string>(fixture.availabilityStatus);
  const [notes, setNotes] = useState(fixture.playerNotes);
  const [saving, setSaving] = useState(false);
  const { data: squadData, isError: squadFailed } = useMatchSquad(fixture.id, fixture.isHome ? 'home' : 'away');
  const squad = squadData?.players ?? (squadFailed ? [] : null);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setMyAvailability(
        fixture.id,
        status as 'Available' | 'Maybe' | 'Unavailable',
        notes
      );
      toast.success('Availability updated');
      onSaved();
    } catch {
      toast.error('Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom">
        <div className="px-4 py-6">
          <SheetHeader onClose={onClose}>
            <SheetTitle>Update Availability</SheetTitle>
          </SheetHeader>

          <div className="py-2">
            <p className="text-sm font-medium text-foreground">{fixture.homeTeam} vs {fixture.awayTeam}</p>
            <p className="text-xs text-muted-foreground">
              {safeFormat(fixture.date, 'EEE d MMM')} • {safeFormat(fixture.date, 'HH:mm')} • {fixture.venue}
            </p>
            {fixture.selectionStatus && (
              <p className="text-xs font-medium text-primary mt-1">
                You are currently: {fixture.selectionStatus}
              </p>
            )}
          </div>

          {conflictHint && status === 'Unavailable' && (
            <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                You're available for your {conflictHint} fixture but unavailable for this support
                fixture. Adding a note helps the coaches understand (optional).
              </span>
            </div>
          )}

          <div className="space-y-2 py-3">
            {OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setStatus(opt.value)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors text-left ${
                  status === opt.value ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <opt.Icon className={`h-5 w-5 ${status === opt.value ? 'text-primary' : 'text-muted-foreground'}`} />
                <div>
                  <p className="text-sm font-medium text-foreground">{opt.label}</p>
                </div>
              </button>
            ))}
          </div>

          <div className="py-2 flex flex-col">
            <label className="text-xs font-medium text-muted-foreground mb-1">Note (optional)</label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder='e.g. "Arriving late from work"'
              className="mt-0"
              rows={2}
            />
          </div>

          {/* Squad section — full list, no expand/collapse */}
          <div className="py-3 border-t border-border mt-2">
            <h3 className="text-sm font-medium text-foreground mb-2">Squad ({squad?.length || 0} Selected)</h3>
            {squad === null ? (
              <div className="space-y-1">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : squad.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Squad not yet announced</p>
            ) : (
              <div className="space-y-1">
                {squad.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-8 text-muted-foreground">{POS_SHORT[m.position] || '?'}</span>
                    <span className="flex-1 text-foreground truncate">{m.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full mt-3">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}