import { shortSeason } from '@/api/stats';
import { useComparisonSeasons } from '@/lib/queries';
import { comparisonPeriod, precedingSeason, seasonComparisonRecord, type ComparisonRecord } from '@/lib/statsComparison';
import { LONG_DATE, safeFormat } from '@/lib/dateUtils';
import type { SeasonSummary } from '@shared/clubStats';

const perGame = (n: number, games: number) => games ? (n / games).toFixed(1) : '—';
const cardFigure = (r: ComparisonRecord, value: string) => r.cardedGames ? `${value}${r.cardedGames < r.games ? '*' : ''}` : '—';
const measures: [string, (r: ComparisonRecord) => string | number][] = [
  ['Games', (r) => r.games],
  ['Win rate', (r) => r.games ? `${Math.round(100 * r.w / r.games)}%` : '—'],
  ['Goals per game', (r) => perGame(r.gf, r.games)],
  ['Goals conceded per game', (r) => perGame(r.ga, r.games)],
  ['Clean sheets', (r) => r.games ? r.cleanSheets : '—'],
  ['Yellow (red) cards', (r) => cardFigure(r, `${r.yellow} (${r.red})`)],
];

export default function SeasonComparison({ summary, today, team }: { summary: SeasonSummary; today: string; team?: string }) {
  const seasons = [1, 2, 3].map((n) => precedingSeason(summary.season, n));
  const queries = useComparisonSeasons(seasons);
  const period = comparisonPeriod(summary.season, today);
  const current = seasonComparisonRecord(summary, period.through, team);
  const columns = [
    { season: summary.season, through: period.through, record: current, state: current ? '' : 'Dated results missing.', retry: undefined as (() => void) | undefined },
    ...queries.map((query, i) => {
      const through = comparisonPeriod(summary.season, today, i + 1).through;
      const record = query.data?.season === seasons[i] ? seasonComparisonRecord(query.data, through, team) : null;
      return {
        season: seasons[i], through, record,
        state: record ? '' : query.isError ? 'Could not load.' : query.data ? 'Dated results missing.' : 'Loading…',
        retry: query.isError ? () => { void query.refetch(); } : undefined,
      };
    }),
  ];
  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-2 min-w-0" aria-label="Previous season comparison">
      <h3 className="text-sm font-medium">Season comparison</h3>
      <p className="text-xs text-muted-foreground">
        {period.toDate ? `Same point in each season: through ${safeFormat(period.through, LONG_DATE)}, and the equivalent date in each past season.` : 'Full seasons.'}{' '}
        {team ? `${team}'s games, including derbies.` : 'Against other clubs; HKFC derbies excluded.'}
      </p>
      <div className="overflow-x-auto" role="region" aria-label="Season comparison table" tabIndex={0}>
        <table className="w-full min-w-[330px] table-fixed text-xs tabular-nums">
          <thead className="text-muted-foreground"><tr>
            <th className="w-[35%] text-left py-1 pr-2 font-normal sticky left-0 bg-card" scope="col">Measure</th>
            {columns.map((c, i) => <th key={c.season} className={`text-right py-1 pl-1 whitespace-nowrap ${i === 0 ? 'font-medium text-foreground' : 'font-normal'}`} scope="col">{shortSeason(c.season)}</th>)}
          </tr></thead>
          <tbody>{measures.map(([label, value]) => <tr key={label} className="border-t border-border">
            <th className="text-left py-1.5 pr-2 font-normal sticky left-0 bg-card" scope="row">{label}</th>
            {columns.map((c, i) => <td key={c.season} className={`text-right pl-1 whitespace-nowrap ${i === 0 ? 'font-medium' : 'text-muted-foreground'}`}>{c.record ? value(c.record) : '—'}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground hidden max-[380px]:block">Swipe the table to see all seasons.</p>
      {columns.some((c) => c.state || !c.record?.games || c.record.cardedGames < c.record.games) && <ul className="text-xs text-muted-foreground space-y-1" aria-label="Comparison data coverage">
        {columns.map((c) => {
          const note = c.state || (!c.record?.games ? 'No recorded games in this period.' : c.record.cardedGames < c.record.games ? `${c.record.cardedGames} of ${c.record.games} games have match cards. ${c.record.cardedGames ? '* Card counts use those games only.' : 'Card counts unavailable.'}` : '');
          return note ? <li key={c.season}>{shortSeason(c.season)}: {note} {c.retry && <button className="underline" onClick={c.retry}>Try again</button>}</li> : null;
        })}
      </ul>}
      <p className="text-xs text-muted-foreground">Cards are counts, with red cards in brackets. Recorded games may differ between seasons.</p>
    </section>
  );
}
