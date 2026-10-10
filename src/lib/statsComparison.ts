import { emptyWDL, isHkfcTeam, outcomeFor, type MatchResult, type SeasonSummary, type WDL } from '@shared/clubStats';

export interface ComparisonRecord extends WDL {
  games: number;
  gf: number;
  ga: number;
  cleanSheets: number;
  /** Games with match cards for the chosen HKFC side. */
  cardedGames: number;
  yellow: number;
  red: number;
}

export const precedingSeason = (season: string, yearsAgo = 1) => {
  const start = Number(season.slice(0, 4));
  return `${start - yearsAgo}-${start - yearsAgo + 1}`;
};

/** The equivalent calendar date; clamp leap day when the earlier year isn't a leap year. */
function yearEarlier(day: string, yearsAgo: number): string {
  const year = Number(day.slice(0, 4)) - yearsAgo;
  const lastDay = new Date(Date.UTC(year, Number(day.slice(5, 7)), 0)).getUTCDate();
  return `${year}-${day.slice(5, 7)}-${String(Math.min(Number(day.slice(8, 10)), lastDay)).padStart(2, '0')}`;
}

function record(results: MatchResult[], season: string, through: string, team?: string): ComparisonRecord {
  const total = { ...emptyWDL(), games: 0, gf: 0, ga: 0, cleanSheets: 0, cardedGames: 0, yellow: 0, red: 0 };
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
    if ((r.home === side ? r.awayScore : r.homeScore) === 0) total.cleanSheets++;
    const cards = r.matchCards?.[r.home === side ? 'home' : 'away'];
    if (cards) {
      total.cardedGames++;
      total.yellow += cards.yellow;
      total.red += cards.red;
    }
  }
  return total;
}

export function comparisonPeriod(season: string, today: string, yearsAgo = 0) {
  const end = `${season.slice(5)}-06-30`;
  const toDate = today < end;
  return { toDate, through: yearEarlier(toDate ? today : end, yearsAgo) };
}

export function seasonComparisonRecord(summary: SeasonSummary, through: string, team?: string): ComparisonRecord | null {
  if (!summary.results || summary.results.length !== summary.matches || summary.results.some((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.date))) return null;
  return record(summary.results, summary.season, through, team);
}

/** Compare an ongoing season through today with the same date in a past season.
 * Completed seasons use full seasons. Missing game dates mean we cannot
 * claim a matched period, even when aggregate totals happen to be available.
 */
export function compareSeasons(current: SeasonSummary, previous: SeasonSummary, today: string, team?: string) {
  const yearsAgo = Number(current.season.slice(0, 4)) - Number(previous.season.slice(0, 4));
  if (yearsAgo < 1 || previous.season !== precedingSeason(current.season, yearsAgo)) return null;
  const { toDate, through: currentThrough } = comparisonPeriod(current.season, today);
  const { through: previousThrough } = comparisonPeriod(current.season, today, yearsAgo);
  const a = seasonComparisonRecord(current, currentThrough, team);
  const b = seasonComparisonRecord(previous, previousThrough, team);
  if (!a || !b) return null;
  return {
    toDate,
    currentThrough,
    previousThrough,
    current: a,
    previous: b,
  };
}
