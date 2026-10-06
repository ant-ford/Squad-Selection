import { safeFormat, formatHkTime } from '@/lib/dateUtils';
import { Skeleton } from '@/components/ui/skeleton';
import type { MyFixture } from '@/api/getMyFixtures';
import { POS_SHORT } from '@/lib/format';
import { availableLabel } from '@shared/availableLabel';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useTeamAvailability, type TeamAvailabilityRow } from '@/lib/queries';

const STATUS_PILL: Record<string, string> = {
  Available: 'bg-green-100 text-green-800',
  Maybe: 'bg-amber-100 text-amber-800',
  Unavailable: 'bg-red-100 text-red-800',
};

function statusLabel(status: string, selected: boolean) {
  if (status === 'Available') return availableLabel(selected);
  if (status === 'Unavailable') return 'No';
  return status || '—';
}

/** "9 available · 1 maybe · 2 no", skipping the zeros; worded like the pills. */
function tally(rows: TeamAvailabilityRow[], selected: boolean) {
  const n = (s: string) => rows.filter(r => r.status === s).length;
  return ([
    [n('Available'), availableLabel(selected).toLowerCase()],
    [n('Maybe'), 'maybe'],
    [n('Unavailable'), 'no'],
  ] as const)
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}`)
    .join(' · ');
}

function PlayerList({
  rows, selected, viewerId,
}: { rows: TeamAvailabilityRow[]; selected: boolean; viewerId?: string }) {
  return (
    <div className="space-y-1">
      {rows.map(m => {
        const isYou = m.id === viewerId;
        return (
          <div key={m.id} className="flex items-center gap-2 text-xs">
            <span className="w-8 text-muted-foreground">{POS_SHORT[m.position] || '?'}</span>
            {/* Shirt number in a fixed column so the names line up
                whether or not everyone has one. */}
            <span className="w-7 text-right tabular-nums text-muted-foreground">
              {m.shirtNo ? `#${m.shirtNo}` : ''}
            </span>
            <span className={`flex-1 text-foreground truncate ${isYou ? 'font-semibold' : ''}`}>
              {m.name}{isYou && ' (you)'}
            </span>
            <span
              className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                STATUS_PILL[m.status] ?? 'bg-muted text-muted-foreground'
              }`}
            >
              {statusLabel(m.status, selected)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Section({
  title, rows, empty, selected = false, viewerId,
}: {
  title: string;
  /** null while loading. */
  rows: TeamAvailabilityRow[] | null;
  empty: string;
  selected?: boolean;
  viewerId?: string;
}) {
  return (
    <div className="py-3 border-t border-border">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {rows && rows.length > 0 && (
          <span className="text-[11px] text-muted-foreground shrink-0">{tally(rows, selected)}</span>
        )}
      </div>
      {rows === null ? (
        <div className="space-y-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{empty}</p>
      ) : (
        <PlayerList rows={rows} selected={selected} viewerId={viewerId} />
      )}
    </div>
  );
}

/**
 * Opened by tapping a fixture card. The player's own Available / Maybe / No
 * (and the note that goes with Maybe or No) is set on the card itself, so
 * this sheet is for seeing how the side is shaping up: who is selected, how
 * the rest of the team stands, and who from other teams the recommendations
 * would put forward next.
 */
export default function PlayerAvailabilitySheet({
  fixture, viewerId, onClose,
}: {
  fixture: MyFixture;
  /** The signed-in player's People id, to mark their own row. */
  viewerId?: string;
  onClose: () => void;
}) {
  const { data, isError } = useTeamAvailability(fixture.id, fixture.isHome ? 'home' : 'away');
  // A failed read falls through to the empty states, not endless skeletons.
  const lists = data ?? (isError ? { selected: [], restOfTeam: [], suggestions: [] } : null);
  const team = data?.team || fixture.hkfcTeam;

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom">
        <div className="px-4 py-6">
          <SheetHeader onClose={onClose}>
            <SheetTitle>{fixture.homeTeam} vs {fixture.awayTeam}</SheetTitle>
          </SheetHeader>

          <div className="py-2">
            <p className="text-xs text-muted-foreground">
              {safeFormat(fixture.date, 'EEE d MMM')} • {formatHkTime(fixture.date)} • {fixture.venue}
            </p>
            {fixture.selectionStatus && (
              <p className="text-xs font-medium text-primary mt-1">
                You are currently: {fixture.selectionStatus}
              </p>
            )}
          </div>

          <div className="mt-2">
            <Section
              title={`Selected (${lists?.selected.length ?? 0}/${fixture.targetSquadSize})`}
              rows={lists?.selected ?? null}
              empty="Squad not yet announced"
              selected
              viewerId={viewerId}
            />
            <Section
              title={`Rest of ${team}`}
              rows={lists?.restOfTeam ?? null}
              empty="Everyone in the team has been selected"
              viewerId={viewerId}
            />
            <Section
              title="Recommended from other teams"
              rows={lists?.suggestions ?? null}
              empty="No recommendations right now"
              viewerId={viewerId}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
