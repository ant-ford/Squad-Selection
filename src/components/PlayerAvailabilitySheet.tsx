import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { setMyAvailability } from '@/api/setMyAvailability';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, HelpCircle, XCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { apiGet } from '@/lib/apiClient';

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

type SquadMember = {
  name: string;
  position: string;
};

const OPTIONS = [
  { value: 'Available', label: 'Going', Icon: CheckCircle2, color: 'text-green-600' },
  { value: 'Maybe', label: 'Maybe', Icon: HelpCircle, color: 'text-amber-600' },
  { value: 'Unavailable', label: 'No', Icon: XCircle, color: 'text-red-600' },
] as const;

const POS_SHORT: Record<string, string> = {
  Goalkeeper: 'GK', Defender: 'DEF', Midfielder: 'MID', Forward: 'FWD', 'Flexible/Varies': 'FLEX'
};

export default function PlayerAvailabilitySheet({
  fixture, onClose, onSaved,
}: {
  fixture: Fixture; onClose: () => void; onSaved: () => void;
}) {
  const [status, setStatus] = useState<string>(fixture.availabilityStatus);
  const [notes, setNotes] = useState(fixture.playerNotes);
  const [saving, setSaving] = useState(false);

  const [squad, setSquad] = useState<SquadMember[] | null>(null);
  const [squadExpanded, setSquadExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ players: SquadMember[] }>(`/api/match/${fixture.id}/squad`)
      .then(data => {
        if (!cancelled) setSquad(data.players ?? []);
      })
      .catch(() => { if (!cancelled) setSquad([]); });
    return () => { cancelled = true; };
  }, [fixture.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setMyAvailability(
        fixture.id,
        status as 'Available' | 'Maybe' | 'Unavailable',
        notes,
        fixture.availabilityExceptionId || undefined
      );
      toast.success('Availability updated');
      onSaved();
    } catch {
      toast.error('Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const d = parseISO(fixture.date);
  const displaySquad = squadExpanded ? (squad ?? []) : (squad ?? []).slice(0, 12);

  return (
    <>
      {/* Overlay – click to close */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />
      {/* Drawer panel */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-background rounded-t-2xl max-h-[85vh] overflow-y-auto shadow-lg"
        onClick={(e) => e.stopPropagation()} // prevent closing when clicking inside
      >
        <div className="px-4 py-6">
          <h2 className="text-lg font-semibold text-foreground mb-2">Update Availability</h2>

          <div className="py-2">
            <p className="text-sm font-medium text-foreground">{fixture.homeTeam} vs {fixture.awayTeam}</p>
            <p className="text-xs text-muted-foreground">
              {format(d, 'EEE d MMM')} • {format(d, 'HH:mm')} • {fixture.venue}
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

          {/* Squad section */}
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
              <>
                <div className="space-y-1">
                  {displaySquad.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="w-8 text-muted-foreground">{POS_SHORT[m.position] || '?'}</span>
                      <span className="flex-1 text-foreground truncate">{m.name}</span>
                    </div>
                  ))}
                </div>
                {squad.length > 12 && (
                  <button
                    onClick={() => setSquadExpanded(!squadExpanded)}
                    className="flex items-center gap-1 text-xs text-primary mt-2"
                  >
                    {squadExpanded ? (
                      <><ChevronUp className="h-3 w-3" /> Show less</>
                    ) : (
                      <><ChevronDown className="h-3 w-3" /> Show all ({squad.length})</>
                    )}
                  </button>
                )}
              </>
            )}
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full mt-3">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save
          </Button>
        </div>
      </div>
    </>
  );
}