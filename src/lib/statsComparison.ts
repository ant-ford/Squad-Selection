import { emptyWDL, isHkfcTeam, outcomeFor, type MatchResult, type SeasonSummary, type WDL } from '@shared/clubStats';

export interface ComparisonRecord extends WDL {
  games: number;
  gf: number;
  ga: number;
}

export const precedingSeason = (season: string) => {
  const start = Number(season.slice(0, 4));
  return `${start - 1}-${start}`;
};

/** The same calendar date a year earlier; leap day compares with 28 February. */
function yearEarlier(day: string): string {
  const year = Number(day.slice(0, 4)) - 1;
  const lastDay = new Date(Date.UTC(year, Number(day.slice(5, 7)), 0)).getUTCDate();
  return `${year}-${day.slice(5, 7)}-${String(Math.min(Number(day.slice(8, 10)), lastDay)).padStart(2, '0')}`;
}

function record(results: MatchResult[], season: string, through: string, team?: string): ComparisonRecord {
  const total = { ...emptyWDL(), games: 0, gf: 0, ga: 0 };
  const from = `${season.slice(0, 4)}-07-01`;
  for (const r of results) {
    if (!r.date || r.date < from || r.date > through) continue;
    // A club record leaves derbies out. One team's record includes its own side.
    const side = team ?? (isHkfcTeam(r.home) && isHkfcTeam(r.away) ? undefined : isHkfcTeam(r.home) ? r.home : isHkfcTeam(r.away) ? r.away : undefined);
    if (!side) continue;
    const outcome = outcomeFor(r, side);
    if (!outcome) continue;
    total[outcome]++;
    total.games++;
    total.gf += r.home === side ? r.homeScore : r.awayScore;
    total.ga += r.home === side ? r.awayScore : r.homeScore;
  }
  return total;
}

/** Compare an ongoing season through today with the same date last season.
 * Completed seasons use both full seasons. Missing game dates mean we cannot
 * claim a matched period, even when aggregate totals happen to be available.
 */
export function compareSeasons(current: SeasonSummary, previous: SeasonSummary, today: string, team?: string) {
  if (previous.season !== precedingSeason(current.season) || !current.results || !previous.results) return null;
  if ([current, previous].some((s) => s.results!.length !== s.matches || s.results!.some((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.date)))) return null;
  const end = `${current.season.slice(5)}-06-30`;
  const toDate = today < end;
  const currentThrough = toDate ? today : end;
  const previousThrough = toDate ? yearEarlier(today) : `${previous.season.slice(5)}-06-30`;
  return {
    toDate,
    currentThrough,
    previousThrough,
    current: record(current.results, current.season, currentThrough, team),
    previous: record(previous.results, previous.season, previousThrough, team),
  };
}
