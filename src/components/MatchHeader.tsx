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

export default function MatchHeader({ match }: { match: MatchInfo }) {
  const stats = [
    { label: 'Selected', value: match.selectedCount },
    { label: 'Target', value: match.targetSquadSize },
  ];

  const progress = match.targetSquadSize > 0 ? Math.min(match.selectedCount / match.targetSquadSize, 1) : 0;
  const isFull = match.selectedCount >= match.targetSquadSize;
  const isNearlyFull = !isFull && (match.targetSquadSize - match.selectedCount) <= 2;
  const barColor = isFull ? 'bg-green-500' : isNearlyFull ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="border-b border-border bg-card">
      <div className="container mx-auto px-4 py-2">
        <p className="text-sm font-medium text-foreground">
          <span className={match.hkfcTeam === match.homeTeam ? "font-bold" : ""}>{match.homeTeam}</span>
          {" vs "}
          <span className={match.hkfcTeam === match.awayTeam ? "font-bold" : ""}>{match.awayTeam}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {safeFormat(match.date, 'EEE d MMM')} · {safeFormat(match.date, 'HH:mm')} · {match.venue} · Division: {match.division}
        </p>
      </div>
      <div className="container mx-auto px-2 grid grid-cols-2 gap-2 text-center">
        {stats.map(s => (
          <div key={s.label} className="bg-muted rounded-md py-2">
            <p className="text-lg font-bold text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
      <div className="container mx-auto px-4 py-3">
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${barColor} transition-all duration-300`} style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="text-xs text-muted-foreground mt-1 text-right">
          {match.selectedCount} / {match.targetSquadSize}
        </p>
      </div>
    </div>
  );
}