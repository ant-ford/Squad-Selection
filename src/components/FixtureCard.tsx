import { safeFormat } from '@/lib/dateUtils';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

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
  const [expanded, setExpanded] = useState<'maybe' | 'unavail' | null>(null);

  const time = safeFormat(fixture.date, 'HH:mm');
  const shortfall = fixture.targetSquadSize - fixture.selectedCount;
  const isFull = shortfall <= 0;

  const openMatch = () =>
    navigate(`/coach/match/${fixture.id.replace(/-home$/, '').replace(/-away$/, '')}?side=${fixture.isHome ? 'home' : 'away'}`);

  const maybeNames = fixture.maybeNames ?? [];
  const unavailNames = fixture.unavailableNames ?? [];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openMatch}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMatch(); } }}
      className="w-full border border-border rounded-lg p-4 text-left hover:bg-muted/50 transition-colors cursor-pointer"
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
          <span className={`inline-flex items-center px-2 py-1 rounded-md text-sm font-medium ${isFull ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {fixture.selectedCount} / {fixture.targetSquadSize}
          </span>
          {shortfall > 0 && (
            <p className="text-xs text-destructive font-medium mt-1">{shortfall} short</p>
          )}
        </div>
      </div>

      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
        {maybeNames.length > 0 ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(expanded === 'maybe' ? null : 'maybe'); }}
            className="relative flex items-center gap-0.5 cursor-pointer"
          >
            {fixture.maybeCount} maybe
            {expanded === 'maybe' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded === 'maybe' && (
              <div className="absolute bottom-full left-0 mb-2 bg-card text-foreground text-xs rounded-md p-2 shadow-lg border border-border whitespace-normal min-w-[120px] max-w-[200px] z-20">
                {maybeNames.join(', ')}
              </div>
            )}
          </button>
        ) : (
          <span>{fixture.maybeCount} maybe</span>
        )}

        {unavailNames.length > 0 ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(expanded === 'unavail' ? null : 'unavail'); }}
            className="relative flex items-center gap-0.5 cursor-pointer"
          >
            {fixture.unavailableCount} unavail
            {expanded === 'unavail' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded === 'unavail' && (
              <div className="absolute bottom-full left-0 mb-2 bg-card text-foreground text-xs rounded-md p-2 shadow-lg border border-border whitespace-normal min-w-[120px] max-w-[200px] z-20">
                {unavailNames.join(', ')}
              </div>
            )}
          </button>
        ) : (
          <span>{fixture.unavailableCount} unavail</span>
        )}
      </div>
    </div>
  );
}