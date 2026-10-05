import { useState } from 'react';
import { safeFormat } from '@/lib/dateUtils';
import { isHkfcTeam, leagueLabel, outcomeFor, type MatchResult } from '@shared/clubStats';

/** The form-guide colours SeasonStats uses: win and loss solid, a draw quiet. */
const OUTCOME = {
  w: { letter: 'W', label: 'Won', className: 'bg-emerald-600 text-white' },
  d: { letter: 'D', label: 'Drawn', className: 'bg-muted text-muted-foreground' },
  l: { letter: 'L', label: 'Lost', className: 'bg-rose-600 text-white' },
} as const;

/** About how many games show at first; "Show more" adds twice this. Whole days are shown, never half of one. */
const PAGE = 18;

type Row = MatchResult & { team?: string; goals?: number };

/** Newest day first, each day's games together. */
function byDay(results: Row[]): { date: string; rows: Row[] }[] {
  const days: { date: string; rows: Row[] }[] = [];
  for (const r of [...results].reverse()) {
    const last = days[days.length - 1];
    if (last && last.date === r.date) last.rows.push(r);
    else days.push({ date: r.date, rows: [r] });
  }
  return days;
}

/** How many days hold the first `games` games, rounded up to a whole day. */
function daysFor(days: { rows: Row[] }[], games: number): number {
  let n = 0;
  let count = 0;
  while (n < days.length && count < games) count += days[n++].rows.length;
  return n;
}

/**
 * Game-by-game results, newest day first, as the score sheet reads: "HKFC D
 * 5–4 Valley A". Each row's W/D/L is for `team` when given, else the row's
 * own team (a player's side), else the HKFC side; a derby on the club list
 * has none.
 */
export default function ResultsCard({
  results,
  team,
  title = 'Results',
  multiSeason = false,
}: {
  /** Oldest first, as the summaries hold them. */
  results: Row[];
  team?: string;
  title?: string;
  /** Show the year: the list spans seasons. */
  multiSeason?: boolean;
}) {
  const [games, setGames] = useState(PAGE);
  if (results.length === 0) return null;
  const days = byDay(results);
  const shownDays = daysFor(days, games);
  const shownGames = days.slice(0, shownDays).reduce((n, d) => n + d.rows.length, 0);
  const more = results.length - shownGames;

  return (
    <section className="bg-card border border-border rounded-lg p-3 sm:p-4 min-w-0" aria-label={title}>
      <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>
      {/* Columns on wide screens, read down then across: a row is short, and alone it spreads across a laptop. */}
      <div className="lg:columns-2 xl:columns-3 lg:gap-x-8">
        {days.slice(0, shownDays).map((day) => (
          <section key={day.date} className="break-inside-avoid pb-3" aria-label={safeFormat(day.date, 'EEEE d MMMM yyyy')}>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground pb-1">
              {safeFormat(day.date, multiSeason ? 'EEE d MMM yyyy' : 'EEE d MMM')}
            </h4>
            <ul>
              {day.rows.map((r, i) => {
                const side = team ?? r.team ?? (isHkfcTeam(r.home) && isHkfcTeam(r.away) ? undefined : isHkfcTeam(r.home) ? r.home : r.away);
                const o = side ? outcomeFor(r, side) : null;
                const details = [
                  r.division ? leagueLabel(r.division) : null,
                  r.venue,
                  r.goals ? `${r.goals} ${r.goals === 1 ? 'goal' : 'goals'}` : null,
                ].filter(Boolean);
                return (
                  <li key={`${r.home}-${r.away}-${i}`} className="grid grid-cols-[1.75rem_1fr] gap-2 items-center py-1.5 border-t border-border">
                    {o ? (
                      <span
                        className={`h-6 w-6 rounded text-xs font-semibold flex items-center justify-center ${OUTCOME[o].className}`}
                        title={OUTCOME[o].label}
                        aria-label={OUTCOME[o].label}
                      >
                        {OUTCOME[o].letter}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground text-center" title="HKFC derby">
                        derby
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground">
                        <span className={r.home === side ? 'font-semibold' : ''}>{r.home}</span>{' '}
                        <span className="tabular-nums whitespace-nowrap">
                          {r.homeScore}&ndash;{r.awayScore}
                        </span>{' '}
                        <span className={r.away === side ? 'font-semibold' : ''}>{r.away}</span>
                      </span>
                      {details.length > 0 && (
                        <span className="block truncate text-[11px] text-muted-foreground">{details.join(' · ')}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {more > 0 && (
        <div className="flex gap-3 pt-2 border-t border-border">
          <button onClick={() => setGames(shownGames + PAGE * 2)} className="text-sm text-primary underline">
            Show more
          </button>
          <button onClick={() => setGames(results.length)} className="text-sm text-muted-foreground underline">
            Show all {results.length}
          </button>
        </div>
      )}
    </section>
  );
}
