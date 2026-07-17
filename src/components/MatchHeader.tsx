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
      <div className="container mx-auto px-4 pb-3 grid grid-cols-2 gap-2 text-center">
        {stats.map(s => (
          <div key={s.label} className="bg-muted rounded-md py-2">
            <p className="text-lg font-bold text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}