import { Users, Zap } from 'lucide-react';
import { StatusBadge, MetaLine } from '@/components/shared';
import type { MyFixture } from '@/api/getMyFixtures';

interface Props {
  fixture: MyFixture;
  onTap: () => void;
  onAvailabilityChange: (
    status: 'Available' | 'Maybe' | 'Unavailable',
    exceptionId?: string
  ) => void;
}

export default function PlayerFixtureCard({ fixture, onTap, onAvailabilityChange }: Props) {
  const isSelected = fixture.selectionStatus === 'Selected';
  const isUnavailable = fixture.availabilityStatus === 'Unavailable';
  const isMaybe = fixture.availabilityStatus === 'Maybe';

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
      className={`w-full border rounded-xl p-3 text-left transition-all hover:shadow-sm cursor-pointer ${
        isSelected
          ? 'border-primary bg-primary/5'
          : isUnavailable
          ? 'border-border bg-muted/30 opacity-60'
          : isMaybe
          ? 'border-amber-200 bg-amber-50/30'
          : 'border-border bg-card'
      }`}
      role="button"
      tabIndex={0}
      onClick={onTap}
      onKeyDown={handleKeyDown}
    >
      {/* Play-up callout (only for fixtures ABOVE the displayed team) */}
      {fixture.isPlayUp && (
        <div className="mb-2 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold">
          <Zap className="h-3.5 w-3.5 text-amber-700 fill-amber-600" />
          <span>
            {isSelected
              ? `Selected to play up for ${fixture.selectionTeam || fixture.hkfcTeam}`
              : `Higher team fixture — ${fixture.selectionTeam || fixture.hkfcTeam}`}
          </span>
        </div>
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

      {/* Meta & squad size + availability segmented control */}
      <div className="mt-2 flex justify-between items-start">
        <div>
          <MetaLine date={fixture.date} venue={fixture.venue} />
          <span className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            <Users className="h-3 w-3" />
            {fixture.selectedCount}/{fixture.targetSquadSize}
          </span>
        </div>
        <div className="flex border border-border rounded-full overflow-hidden shrink-0 ml-4">
          {[
            { value: 'Available', label: 'Going' },
            { value: 'Maybe', label: 'Maybe' },
            { value: 'Unavailable', label: 'No' },
          ].map(({ value, label }, idx) => {
            const active = fixture.availabilityStatus === value;
            return (
              <button
                key={value}
                onClick={(e) => {
                  e.stopPropagation();
                  onAvailabilityChange(value as any, fixture.availabilityExceptionId);
                }}
                className={`
                  px-3 py-1 text-xs font-medium min-w-[56px] transition-colors
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

      {fixture.playerNotes && (
        <div className="mt-2 text-xs text-muted-foreground italic truncate">“{fixture.playerNotes}”</div>
      )}
      {fixture.selectionNotes && (
        <p className="text-xs text-primary mt-1.5">Coach: {fixture.selectionNotes}</p>
      )}
    </div>
  );
}