import { safeFormat } from '@/lib/dateUtils';
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
  maybeCount: number;
  unavailableCount: number;
  maybeNames?: string[];
  unavailableNames?: string[];
};

export default function FixtureCard({ fixture }: { fixture: Fixture }) {
  const navigate = useNavigate();
  const time = safeFormat(fixture.date, 'HH:mm');
  const shortfall = fixture.targetSquadSize - fixture.selectedCount;
  const isFull = shortfall <= 0;

  return (
    <button
      onClick={() => navigate(`/coach/match/${fixture.id.replace(/-home$/,"").replace(/-away$/,"")}?side=${fixture.isHome ? "home" : "away"}`)}
      className="w-full border border-border rounded-lg p-4 text-left hover:bg-muted/50 transition-colors"
    >
      <div className="flex justify-between items-start">
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">
            {fixture.hkfcTeam === fixture.homeTeam
              ? <><span className="font-bold">{fixture.homeTeam}</span> vs {fixture.awayTeam}</>
              : <>{fixture.homeTeam} vs <span className="font-bold">{fixture.awayTeam}</span></>
            }
          </p>
          <p className="text-sm text-muted-foreground">
            Division: {fixture.division} · {fixture.venue} · {time}
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
        <span 
          className="group relative cursor-default"
          title={fixture.maybeNames?.join(', ')}
        >
          {fixture.maybeCount} maybe
          {fixture.maybeNames && fixture.maybeNames.length > 0 && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-card text-foreground text-xs rounded-md p-2 shadow-lg border border-border whitespace-normal min-w-[120px] max-w-[200px] z-20 pointer-events-none">
              {fixture.maybeNames.join(', ')}
            </div>
          )}
        </span>
        
        <span 
          className="group relative cursor-default"
          title={fixture.unavailableNames?.join(', ')}
        >
          {fixture.unavailableCount} unavail
          {fixture.unavailableNames && fixture.unavailableNames.length > 0 && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-card text-foreground text-xs rounded-md p-2 shadow-lg border border-border whitespace-normal min-w-[120px] max-w-[200px] z-20 pointer-events-none">
              {fixture.unavailableNames.join(', ')}
            </div>
          )}
        </span>
      </div>
    </button>
  );
}
