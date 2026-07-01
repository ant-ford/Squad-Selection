import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { setMyAvailability } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, HelpCircle, XCircle, Loader2 } from 'lucide-react';

type Fixture = {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  venue: string;
  availabilityStatus: string;
  playerNotes: string;
  availabilityExceptionId: string;
  selectionStatus: string;
};

const OPTIONS = [
  { value: 'Available', label: 'Available', desc: 'I can play', Icon: CheckCircle2 },
  { value: 'Maybe', label: 'Maybe', desc: 'Uncertain — coach will see this', Icon: HelpCircle },
  { value: 'Unavailable', label: 'Unavailable', desc: 'Cannot play this match', Icon: XCircle },
] as const;

export default function PlayerAvailabilitySheet({
  fixture, onClose, onSaved,
}: {
  fixture: Fixture; onClose: () => void; onSaved: () => void;
}) {
  const [status, setStatus] = useState<string>(fixture.availabilityStatus);
  const [notes, setNotes] = useState(fixture.playerNotes);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setMyAvailability({
        matchId: fixture.id,
        status: status as 'Available' | 'Maybe' | 'Unavailable',
        notes,
        existingExceptionId: fixture.availabilityExceptionId || undefined,
      });
      toast.success('Availability updated');
      onSaved();
    } catch {
      toast.error('Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const d = parseISO(fixture.date);

  return (
    <Sheet open onOpenChange={() => onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Update Availability</SheetTitle>
        </SheetHeader>
        <div className="py-2">
          <p className="text-sm font-medium text-foreground">{fixture.homeTeam} vs {fixture.awayTeam}</p>
          <p className="text-xs text-muted-foreground">
            {format(d, 'EEE d MMM')} · {format(d, 'HH:mm')} · {fixture.venue}
          </p>
          {fixture.selectionStatus && (
            <p className="text-xs font-medium text-primary mt-1">
              You are currently: {fixture.selectionStatus}
            </p>
          )}
        </div>

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
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="py-2">
          <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder='e.g. "Arriving late from work"'
            className="mt-1"
            rows={2}
          />
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full mt-3">
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Save
        </Button>
      </SheetContent>
    </Sheet>
  );
}
