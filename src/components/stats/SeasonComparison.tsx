import { shortSeason } from '@/api/stats';
import { useSeasonStats } from '@/lib/queries';
import { compareSeasons, precedingSeason, type ComparisonRecord } from '@/lib/statsComparison';
import { LONG_DATE, safeFormat } from '@/lib/dateUtils';
import type { SeasonSummary } from '@shared/clubStats';

const signed = (n: number, digits = 0) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;
const winRate = (r: ComparisonRecord) => r.games ? `${Math.round(100 * r.w / r.games)}%` : '—';
const goalsPerGame = (r: ComparisonRecord) => r.games ? (r.gf / r.games).toFixed(1) : '—';

export default function SeasonComparison({ summary, today, team }: { summary: SeasonSummary; today: string; team?: string }) {
  const previousSeason = precedingSeason(summary.season);
  const previous = useSeasonStats(previousSeason);
  if (!previous.data) return (
    <p className="text-xs text-muted-foreground" role="status">
      {previous.isError ? <>Previous season comparison unavailable. <button className="underline" onClick={() => void previous.refetch()}>Try again</button></> : 'Comparing with the previous season…'}
    </p>
  );
  const comparison = compareSeasons(summary, previous.data, today, team);
  if (!comparison) return <p className="text-xs text-muted-foreground">Previous season comparison unavailable: dated results are missing.</p>;
  const { current: a, previous: b } = comparison;
  if (!a.games || !b.games) return (
    <p className="text-xs text-muted-foreground">
      No recorded games {a.games ? `in ${shortSeason(previousSeason)}` : `for ${shortSeason(summary.season)}`}{team ? ` for ${team}` : ' against other clubs'} {comparison.toDate ? `through ${safeFormat(a.games ? comparison.previousThrough : comparison.currentThrough, LONG_DATE)}` : 'in the full season'} to compare.
    </p>
  );
  const rows = [
    ['Games', a.games, b.games, signed(a.games - b.games)],
    ['Win rate', winRate(a), winRate(b), `${signed(Math.round(100 * a.w / a.games) - Math.round(100 * b.w / b.games))} pp`],
    ['Goals per game', goalsPerGame(a), goalsPerGame(b), signed(Number(goalsPerGame(a)) - Number(goalsPerGame(b)), 1)],
  ];
  return (
    <section className="rounded-lg border border-border p-3 space-y-2" aria-label="Previous season comparison">
      <h3 className="text-xs font-medium">Compared with {shortSeason(previousSeason)}</h3>
      <p className="text-xs text-muted-foreground">
        {comparison.toDate ? `Same point in the season: through ${safeFormat(comparison.currentThrough, LONG_DATE)} and ${safeFormat(comparison.previousThrough, LONG_DATE)}.` : 'Both full seasons.'}{' '}
        {team ? `${team}'s games, including derbies.` : 'Against other clubs; HKFC derbies excluded.'}
      </p>
      <table className="w-full text-xs tabular-nums">
        <thead className="text-muted-foreground"><tr>
          <th className="text-left py-1 font-normal" scope="col">Measure</th>
          <th className="text-right py-1 font-normal" scope="col">{shortSeason(summary.season)}</th>
          <th className="text-right py-1 font-normal" scope="col">{shortSeason(previousSeason)}</th>
          <th className="text-right py-1 font-normal" scope="col">Change</th>
        </tr></thead>
        <tbody>{rows.map(([label, current, prior, delta]) => <tr key={label} className="border-t border-border">
          <th className="text-left py-1.5 font-normal" scope="row">{label}</th>
          <td className="text-right">{current}</td><td className="text-right text-muted-foreground">{prior}</td><td className="text-right">{delta}</td>
        </tr>)}</tbody>
      </table>
      <p className="text-xs text-muted-foreground">pp = percentage points. Recorded games may differ between seasons.</p>
    </section>
  );
}
