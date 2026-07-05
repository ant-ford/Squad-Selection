import { format, parseISO } from 'date-fns';
import { Users } from 'lucide-react';
import { StatusBadge, AvailabilityChip, MetaLine } from '@/components/shared';

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
};

export default function PlayerFixtureCard({ fixture, onTap }: { fixture: Fixture; onTap: () => void }) {
  const isSelected = fixture.selectionStatus === 'Selected';
  const isUnavailable = fixture.availabilityStatus === 'Unavailable';
  const isMaybe = fixture.availabilityStatus === 'Maybe';

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
      <div className="mt-2.5">
        <MetaLine date={fixture.date} venue={fixture.venue} />
        <span className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
          <Users className="h-3 w-3" />
          {fixture.selectedCount}/{fixture.targetSquadSize}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-2.5">
        <AvailabilityChip status={fixture.availabilityStatus} />
        {fixture.playerNotes && (
          <span className="text-xs text-muted-foreground italic truncate">
            &ldquo;{fixture.playerNotes}&rdquo;
          </span>
        )}
      </div>
      {fixture.selectionNotes && (
        <p className="text-xs text-primary mt-1.5">Coach: {fixture.selectionNotes}</p>
      )}
    </button>
  );
}