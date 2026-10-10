import { Users } from 'lucide-react';
import { StatusBadge, MetaLine } from '@/components/shared';
import { availableLabel } from '@shared/availableLabel';
import { availabilityLabel } from '@/lib/availabilityTone';
import type { MyFixture } from '@/api/getMyFixtures';
import { fixtureChangeText, isCalledOff } from '@shared/fixtureChange';

interface Props {
  fixture: MyFixture;
  onTap: () => void;
  onAvailabilityChange: (status: 'Available' | 'Maybe' | 'Unavailable') => void;
  busy?: boolean;
}

export default function PlayerFixtureCard({ fixture, onTap, onAvailabilityChange, busy = false }: Props) {
  const isSelected = fixture.selectionStatus === 'Selected';
  const isUnavailable = fixture.availabilityStatus === 'Unavailable';
  const isMaybe = fixture.availabilityStatus === 'Maybe';
  // Postponed or cancelled: shown for a week, with nothing to answer.
  const calledOff = isCalledOff(fixture.change);

  const statusColorMap: Record<string, string> = {
    Available: 'bg-green-200 text-green-800 border-green-300',
    Maybe: 'bg-amber-200 text-amber-800 border-amber-300',
    Unavailable: 'bg-red-200 text-red-800 border-red-300',
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onTap();
    }
  };

  return (
    <div
      // Answered states carry a heavier border and a solid tint: the old
      // fractional-opacity washes were close to invisible on a phone outdoors.
      // The tint stops at 100 so the active availability button below, which
      // is the 200 of the same hue, still stands off the card.
      className={`w-full border-2 rounded-xl p-3 text-left transition-all hover:shadow-sm cursor-pointer ${
        isSelected
          ? 'border-primary bg-primary/5'
          : isUnavailable
          ? 'border-red-400 bg-red-100'
          : isMaybe
          ? 'border-amber-400 bg-amber-100'
          : 'border-border bg-card'
      }`}
      role="button"
      tabIndex={0}
      onClick={onTap}
      onKeyDown={handleKeyDown}
    >
      {/* Which list it's from, in plain words: a team above (play-up) or
          below (support) the player's own. */}
      {(fixture.isPlayUp || fixture.fixtureCategory === 'support') && (
        <p className={`mb-1 text-xs font-medium uppercase tracking-wide ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}>
          {fixture.isPlayUp
            ? isSelected
              ? `Selected to play up for ${fixture.selectionTeam || fixture.hkfcTeam}`
              : `Play-up · ${fixture.selectionTeam || fixture.hkfcTeam}`
            : isSelected
            ? `Selected to support ${fixture.hkfcTeam}`
            : `Support · ${fixture.hkfcTeam}`}
        </p>
      )}

      {/* Top row: title + StatusBadge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-foreground flex items-center gap-1.5">
            <span className="truncate">
              {fixture.isHome ? fixture.hkfcTeam : fixture.opponent}
              <span className="text-muted-foreground font-normal"> vs </span>
              {fixture.isHome ? fixture.opponent : fixture.hkfcTeam}
            </span>
            {/* Which shirt to bring. Hidden until a coach has decided. */}
            {fixture.kit && (
              <span
                title={`${fixture.kit} kit`}
                aria-label={`${fixture.kit} kit`}
                className={`h-3 w-3 rounded-full border shrink-0 ${
                  fixture.kit === 'Blue'
                    ? 'bg-blue-600 border-blue-700'
                    : 'bg-white border-neutral-400'
                }`}
              />
            )}
          </p>
        </div>
        <StatusBadge status={fixture.selectionStatus} />
      </div>

      {/* Meta across the full width so it stays on one line on a phone; squad
          size and the availability segmented control share the row below. */}
      <div className="mt-1.5">
        <MetaLine date={fixture.date} venue={fixture.venue} />
      </div>
      {fixture.change && (
        <p className={`mt-1 text-xs font-medium ${calledOff ? 'text-danger-soft-foreground' : 'text-warning-soft-foreground'}`}>
          {fixtureChangeText(fixture.change, fixture.date)}
        </p>
      )}
      {!calledOff && (
        <div className="mt-1.5 flex justify-between items-center">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            {fixture.selectedCount}/{fixture.targetSquadSize}
          </span>
          <div className="flex border border-border rounded-full overflow-hidden shrink-0 ml-4">
            {[
              { value: 'Available', label: availableLabel(isSelected) },
              { value: 'Maybe', label: 'Maybe' },
              { value: 'Unavailable', label: 'No' },
            ].map(({ value, label }, idx) => {
              const active = fixture.availabilityStatus === value;
              return (
                <button
                  key={value}
                  disabled={busy}
                  aria-pressed={active}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAvailabilityChange(value as any);
                  }}
                  className={`
                    px-2 py-1 text-xs font-medium min-w-[48px] transition-colors
                    ${idx === 0 ? 'rounded-l-full' : ''}
                    ${idx === 2 ? 'rounded-r-full' : ''}
                    ${active ? statusColorMap[value] : 'bg-background text-muted-foreground hover:bg-muted/50'}
                    ${idx > 0 ? 'border-l border-border' : ''}
                  `}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Says where the status came from. A preference is a default the
          player can override just by tapping one of the buttons above; an
          answer they gave for this fixture is not overridden by anything. */}
      {fixture.availabilityFromRule && !calledOff && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {availabilityLabel(fixture.availabilityStatus)} from your availability preferences. Tap to set this
          fixture on its own.
        </p>
      )}

      {fixture.playerNotes && (
        <div className="mt-2 text-xs text-muted-foreground italic truncate">“{fixture.playerNotes}”</div>
      )}
      {fixture.selectionNotes && (
        <p className="text-xs text-primary mt-1.5">Coach: {fixture.selectionNotes}</p>
      )}
    </div>
  );
}
