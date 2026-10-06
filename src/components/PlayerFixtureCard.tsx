import { Users } from 'lucide-react';
import { StatusBadge, MetaLine } from '@/components/shared';
import { availabilityClasses } from '@/lib/availabilityTone';
import { preferenceTagLabel } from '@/lib/availabilityAnswers';
import AvailabilityAnswerControl from '@/components/AvailabilityAnswerControl';
import type { MyFixture } from '@/api/getMyFixtures';

interface Props {
  fixture: MyFixture;
  onTap: () => void;
  onAvailabilityChange: (status: 'Available' | 'Maybe' | 'Unavailable') => void;
}

export default function PlayerFixtureCard({ fixture, onTap, onAvailabilityChange }: Props) {
  const isSelected = fixture.selectionStatus === 'Selected';
  const isUnavailable = fixture.availabilityStatus === 'Unavailable';
  const isMaybe = fixture.availabilityStatus === 'Maybe';
  const home = fixture.isHome ? fixture.hkfcTeam : fixture.opponent;
  const away = fixture.isHome ? fixture.opponent : fixture.hkfcTeam;

  return (
    <div
      // Answered states carry a heavier border and a solid tint: the old
      // fractional-opacity washes were close to invisible on a phone outdoors.
      // The card takes the soft tint, so the chosen answer below takes the
      // solid colour to stand off it. Available stays untinted.
      className={`w-full border-2 rounded-xl p-3 ${
        isSelected
          ? 'border-primary bg-primary/5'
          : availabilityClasses(isUnavailable || isMaybe ? fixture.availabilityStatus : '', 'card')
      }`}
    >
      {/* Only the top of the card opens the fixture sheet. The answer
          control is a sibling of this button, never inside it. */}
      <button
        type="button"
        onClick={onTap}
        className="block w-full text-left rounded-lg hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* Which list it's from, in plain words: a team above (play-up) or
            below (support) the player's own. */}
        {(fixture.isPlayUp || fixture.fixtureCategory === 'support') && (
          <span className={`block mb-1 text-xs font-medium uppercase tracking-wide ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}>
            {fixture.isPlayUp
              ? isSelected
                ? `Selected to play up for ${fixture.selectionTeam || fixture.hkfcTeam}`
                : `Play-up · ${fixture.selectionTeam || fixture.hkfcTeam}`
              : isSelected
              ? `Selected to support ${fixture.hkfcTeam}`
              : `Support · ${fixture.hkfcTeam}`}
          </span>
        )}

        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 font-semibold text-sm text-foreground flex items-center gap-1.5">
            <span className="truncate">
              {home}
              <span className="text-muted-foreground font-normal"> vs </span>
              {away}
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
          </span>
          <span className="shrink-0 flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">Picked: </span>
              {fixture.selectedCount}/{fixture.targetSquadSize}
            </span>
            <StatusBadge status={fixture.selectionStatus} />
          </span>
        </span>

        <span className="mt-1.5 block">
          <MetaLine date={fixture.date} venue={fixture.venue} />
        </span>
      </button>

      <AvailabilityAnswerControl
        className="mt-2"
        value={fixture.availabilityStatus}
        isSelected={isSelected}
        onChange={onAvailabilityChange}
        label={`Your answer for ${home} vs ${away}`}
        preferenceLabel={fixture.availabilityFromRule ? preferenceTagLabel('your') : undefined}
      />

      {fixture.playerNotes && (
        <div className="mt-2 text-xs text-muted-foreground italic truncate">“{fixture.playerNotes}”</div>
      )}
      {fixture.selectionNotes && (
        <p className="text-xs text-primary mt-1.5">Coach: {fixture.selectionNotes}</p>
      )}
    </div>
  );
}
