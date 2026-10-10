import { shortSeason } from '@/api/stats';
import { formatFullDateTime, LONG_DATE, safeFormat } from '@/lib/dateUtils';
import type { SeasonSummary } from '@shared/clubStats';

/** Compilation time comes from the saved summary, never the browser's fetch time. */
export default function StatsFreshness({ summaries }: { summaries: SeasonSummary[] }) {
  if (!summaries.length) return null;
  const seasons = [...summaries].sort((a, b) => b.season.localeCompare(a.season));
  const latest = seasons[0];
  const lastGame = seasons.flatMap((s) => s.results ?? []).map((r) => r.date).filter(Boolean).sort().at(-1);
  return (
    <details className="text-xs text-muted-foreground" aria-label="Data freshness">
      <summary className="cursor-pointer leading-relaxed">
        {seasons.length > 1 ? `${shortSeason(latest.season)} stats` : 'Stats'} compiled {formatFullDateTime(latest.generatedAt)} HKT
        {lastGame && <> · Latest recorded game {safeFormat(lastGame, LONG_DATE)}</>}
      </summary>
      <div className="pt-2 space-y-1">
        <p>These times show when the figures were calculated from recorded results and match cards, rather than when you opened this page.</p>
        {seasons.length > 1 && <ul>{seasons.map((s) => <li key={s.season}>{shortSeason(s.season)}: {formatFullDateTime(s.generatedAt)} HKT</li>)}</ul>}
      </div>
    </details>
  );
}
