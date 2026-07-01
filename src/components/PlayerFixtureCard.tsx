import { format, parseISO } from 'date-fns';
import { MapPin, Calendar, CheckCircle2, Clock, XCircle, HelpCircle, Users } from 'lucide-react';

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
  const d = parseISO(fixture.date);
  const isSelected = fixture.selectionStatus === 'Selected';
  const isReserve = fixture.selectionStatus === 'Reserve';
  const isUnavailable = fixture.availabilityStatus === 'Unavailable';
  const isMaybe = fixture.availabilityStatus === 'Maybe';

  return (
    <button
      onClick={onTap}
      className={`w-full border rounded-xl p-4 text-left transition-all hover:shadow-sm ${
        isSelected
          ? 'border-primary bg-primary/5'
          : isReserve
          ? 'border-accent bg-accent/30'
          : isUnavailable
          ? 'border-border bg-muted/30 opacity-60'
          : 'border-border bg-card'
      }`}
    >
      {/* Top row: teams + selection badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-foreground">
            {fixture.isHome ? fixture.hkfcTeam : fixture.opponent}
            <span className="text-muted-foreground font-normal"> vs </span>
            {fixture.isHome ? fixture.opponent : fixture.hkfcTeam}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{fixture.division}</p>
        </div>
        <SelectionBadge status={fixture.selectionStatus} />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 mt-2.5 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {format(d, 'EEE d MMM')}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {format(d, 'HH:mm')}
        </span>
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {fixture.venue}
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {fixture.selectedCount}/{fixture.targetSquadSize}
        </span>
      </div>

      {/* Availability + notes */}
      <div className="flex items-center gap-2 mt-2.5">
        <AvailabilityIndicator status={fixture.availabilityStatus} />
        {fixture.playerNotes && (
          <span className="text-xs text-muted-foreground italic truncate">
            "{fixture.playerNotes}"
          </span>
        )}
      </div>

      {fixture.selectionNotes && (
        <p className="text-xs text-primary mt-1.5">Coach: {fixture.selectionNotes}</p>
      )}
    </button>
  );
}

function SelectionBadge({ status }: { status: string }) {
  if (status === 'Selected') {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground shrink-0">
        <CheckCircle2 className="h-3 w-3" /> Selected
      </span>
    );
  }
  if (status === 'Reserve') {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground shrink-0">
        Reserve
      </span>
    );
  }
  return null;
}

function AvailabilityIndicator({ status }: { status: string }) {
  if (status === 'Unavailable') {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive">
        <XCircle className="h-3 w-3" /> Unavailable
      </span>
    );
  }
  if (status === 'Maybe') {
    return (
      <span className="flex items-center gap-1 text-xs text-secondary-foreground">
        <HelpCircle className="h-3 w-3" /> Maybe
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <CheckCircle2 className="h-3 w-3" /> Available
    </span>
  );
}
