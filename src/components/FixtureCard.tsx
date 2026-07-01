import { format, parseISO } from 'date-fns';
import { useNavigate } from 'react-router-dom';

type Fixture = {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  division: string;
  venue: string;
  targetSquadSize: number;
  selectedCount: number;
  reserveCount: number;
  maybeCount: number;
  unavailableCount: number;
};

export default function FixtureCard({ fixture }: { fixture: Fixture }) {
  const navigate = useNavigate();
  const d = parseISO(fixture.date);
  const time = format(d, 'HH:mm');
  const shortfall = fixture.targetSquadSize - fixture.selectedCount;
  const isFull = shortfall <= 0;

  return (
    <button
      onClick={() => navigate(`/coach/match/${fixture.id}`)}
      className="w-full border border-border rounded-lg p-4 text-left hover:bg-muted/50 transition-colors"
    >
      <div className="flex justify-between items-start">
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">
            {fixture.homeTeam} vs {fixture.awayTeam}
          </p>
          <p className="text-sm text-muted-foreground">
            {fixture.division} · {fixture.venue} · {time}
          </p>
        </div>
        <div className="text-right shrink-0 ml-3">
          <span className={`inline-flex items-center px-2 py-1 rounded-md text-sm font-medium ${
            isFull ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}>
            {fixture.selectedCount} / {fixture.targetSquadSize}
          </span>
          {shortfall > 0 && (
            <p className="text-xs text-destructive font-medium mt-1">{shortfall} short</p>
          )}
        </div>
      </div>
      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
        <span>{fixture.maybeCount} maybe</span>
        <span>{fixture.unavailableCount} unavail</span>
        {fixture.reserveCount > 0 && <span>{fixture.reserveCount} reserve</span>}
      </div>
    </button>
  );
}
