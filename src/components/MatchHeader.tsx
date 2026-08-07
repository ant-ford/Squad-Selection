import { safeFormat } from '@/lib/dateUtils';

type MatchInfo = {
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam?: string;
  division: string;
  venue: string;
  targetSquadSize: number;
  selectedCount: number;
};

/**
 * Compact match header: one title line + one meta line + a small count chip.
 * The large stat boxes and progress bar were removed for space.
 */
export default function MatchHeader({ match }: { match: MatchInfo }) {
  return (
    <div className="border-b border-border bg-card">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            <span className={match.hkfcTeam === match.homeTeam ? 'font-bold' : ''}>{match.homeTeam}</span>
            {' vs '}
            <span className={match.hkfcTeam === match.awayTeam ? 'font-bold' : ''}>{match.awayTeam}</span>
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {safeFormat(match.date, 'EEE d MMM')} · {safeFormat(match.date, 'HH:mm')} · {match.venue} · Division: {match.division}
          </p>
        </div>
        <span
          className="inline-flex items-center px-2 py-1 rounded-md text-sm font-medium bg-muted text-muted-foreground shrink-0"
          title={`${match.selectedCount} of ${match.targetSquadSize} selected`}
        >
          {match.selectedCount}/{match.targetSquadSize}
        </span>
      </div>
    </div>
  );
}