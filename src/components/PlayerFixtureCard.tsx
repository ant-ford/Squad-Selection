import { format, parseISO } from 'date-fns';
import { Users } from 'lucide-react';
import { StatusBadge, MetaLine } from '@/components/shared';

type Fixture = {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  venue: string;
  division: string;
  availabilityStatus: string;
  playerNotes: string;
  selectionStatus: string;
  selectionNotes: string;
  selectedCount: number;
  targetSquadSize: number;
  availabilityExceptionId?: string;
};

interface Props {
  fixture: Fixture;
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

  // Map status to colour for active state
  const statusColorMap: Record<string, string> = {
    Available: 'bg-green-600 border-green-600 text-white',
    Maybe: 'bg-amber-500 border-amber-500 text-white',
    Unavailable: 'bg-red-600 border-red-600 text-white',
  };

  return (
    <button
      onClick={onTap}
      className={`w-full border rounded-xl p-4 text-left transition-all hover:shadow-sm ${
        isSelected
          ? 'border-primary bg-primary/5'
          : isUnavailable
          ? 'border-border bg-muted/30 opacity-60'
          : isMaybe
          ? 'border-amber-200 bg-amber-50/30'
          : 'border-border bg-card'
      }`}
    >
      {/* Top row: title + StatusBadge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-foreground">
            {fixture.isHome ? fixture.hkfcTeam : fixture.opponent}
            <span className="text-muted-foreground font-normal"> vs </span>
            {fixture.isHome ? fixture.opponent : fixture.hkfcTeam}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Division: {fixture.division}</p>
        </div>
        <StatusBadge status={fixture.selectionStatus} />
      </div>

      {/* Meta & squad size + pill */}
      <div className="mt-2.5 flex justify-between items-start">
        <div>
          <MetaLine date={fixture.date} venue={fixture.venue} />
          <span className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            <Users className="h-3 w-3" />
            {fixture.selectedCount}/{fixture.targetSquadSize}
          </span>
        </div>

        {/* Segmented control – equal width, joined pill */}
        <div className="flex border border-border rounded-full overflow-hidden shrink-0 ml-4">
          {[
            { value: 'Available', label: 'Going' },
            { value: 'Maybe', label: 'Maybe' },
            { value: 'Unavailable', label: 'No' },
          ].map(({ value, label }, idx) => {
            const active = fixture.availabilityStatus === value;
            const activeColor = statusColorMap[value] || 'bg-primary';
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
                  ${active
                    ? `${activeColor} border-${value === 'Available' ? 'green' : value === 'Maybe' ? 'amber' : 'red'}-600`
                    : 'bg-background text-muted-foreground hover:bg-muted/50'
                  }
                  ${idx > 0 ? 'border-l border-border' : ''}
                `}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes and coach notes */}
      {fixture.playerNotes && (
        <div className="mt-2.5 text-xs text-muted-foreground italic truncate">
          “{fixture.playerNotes}”
        </div>
      )}
      {fixture.selectionNotes && (
        <p className="text-xs text-primary mt-1.5">Coach: {fixture.selectionNotes}</p>
      )}
    </button>
  );
}