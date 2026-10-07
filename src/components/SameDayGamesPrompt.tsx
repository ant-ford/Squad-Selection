import { AlertCircle } from 'lucide-react';
import { safeFormat, formatHkTime } from '@/lib/dateUtils';
import { availableLabel } from '@shared/availableLabel';
import { availabilityClasses } from '@/lib/availabilityTone';
import { toneClasses } from '@/lib/statusTone';
import { ActionButton } from '@/components/ui/action-button';
import type { MyFixture } from '@/api/getMyFixtures';

type AvailabilityStatus = 'Available' | 'Maybe' | 'Unavailable';

const CATEGORY_LABEL: Record<string, string> = {
  own: 'My team',
  'play-up': 'Play-up',
  support: 'Support',
};

/**
 * Shown under a My Team card the player has said "No" to while they still
 * read as Available (or Maybe) for another game that day. Availability is
 * opt-out, so without an answer those coaches keep seeing them as available -
 * and the play-up and support lists are collapsed, so the player never sees
 * that they are. Each game gets its own choice; "Out all day" uses the
 * whole-day update, which also covers HKFC games not on this screen.
 */
export default function SameDayGamesPrompt({
  fixture,
  others,
  busy,
  onSet,
  onOutAllDay,
  onClose,
}: {
  fixture: MyFixture;
  others: MyFixture[];
  busy: boolean;
  onSet: (fixtureId: string, status: AvailabilityStatus) => void;
  onOutAllDay: () => void;
  onClose: () => void;
}) {
  const allOut = others.every((f) => f.availabilityStatus === 'Unavailable');
  const day = safeFormat(fixture.date, 'EEE d MMM');

  return (
    <div className={`p-3 rounded-xl border ${toneClasses('warning', 'chip')}`}>
      <p className="text-xs font-semibold flex items-start gap-1.5">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        {allOut ? `You said No to every game on ${day}` : `Other games on ${day}`}
      </p>

      <div className="mt-2 space-y-1.5">
        {others.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-2 bg-background/70 rounded-lg px-2.5 py-1.5">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground truncate">
                {f.selectionTeam || f.hkfcTeam} vs {f.opponent}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {[CATEGORY_LABEL[f.fixtureCategory ?? ''], formatHkTime(f.date), f.venue].filter(Boolean).join(' · ')}
              </p>
            </div>
            <select
              value={f.availabilityStatus}
              onChange={(e) => onSet(f.id, e.target.value as AvailabilityStatus)}
              aria-label={`Availability for ${f.selectionTeam || f.hkfcTeam} vs ${f.opponent}`}
              className={`shrink-0 h-10 text-xs font-medium border rounded-full px-2 ${availabilityClasses(
                f.availabilityStatus === 'Unavailable' || f.availabilityStatus === 'Maybe' ? f.availabilityStatus : 'Available',
                'chip',
              )}`}
            >
              <option value="Available">{availableLabel(f.selectionStatus === 'Selected')}</option>
              <option value="Maybe">Maybe</option>
              <option value="Unavailable">No</option>
            </select>
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-3">
        {allOut ? (
          <button onClick={onClose} className="h-10 px-2 text-xs font-medium hover:underline underline-offset-2">
            Done
          </button>
        ) : (
          <>
            <button onClick={onClose} className="h-10 px-2 text-xs hover:underline underline-offset-2">
              Keep as is
            </button>
            <ActionButton variant="danger" onClick={onOutAllDay} disabled={busy} className="rounded-full text-xs">
              Out all day
            </ActionButton>
          </>
        )}
      </div>
    </div>
  );
}
