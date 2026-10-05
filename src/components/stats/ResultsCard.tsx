import { useState } from 'react';
import { safeFormat } from '@/lib/dateUtils';
import { isHkfcTeam, leagueLabel, outcomeFor, type MatchResult } from '@shared/clubStats';

/** The form-guide colours SeasonStats uses: win and loss solid, a draw quiet. */
const OUTCOME = {
  w: { letter: 'W', label: 'Won', className: 'bg-emerald-600 text-white' },
  d: { letter: 'D', label: 'Drawn', className: 'bg-muted text-muted-foreground' },
  l: { letter: 'L', label: 'Lost', className: 'bg-rose-600 text-white' },
} as const;

/** Rows shown at first, and added by each "Show more". */
const PAGE = 15;

type Row = MatchResult & { team?: string; goals?: number };

/**
 * Game-by-game results, newest first, as the score sheet reads: "HKFC D
 * 5–4 Valley A". Each row's W/D/L is for `team` when given, else the row's
 * own team (a player's side), else the HKFC side; a derby on the club list
 * has none.
 */
export default function ResultsCard({
  results,
  team,
  title = 'Results',
  caption,
  multiSeason = false,
}: {
  /** Oldest first, as the summaries hold them. */
  results: Row[];
  team?: string;
  title?: string;
  caption?: string;
  /** Show the year: the list spans seasons. */
  multiSeason?: boolean;
}) {
  const [shown, setShown] = useState(PAGE);
  if (results.length === 0) return null;
  const rows = [...results].reverse();
  const more = rows.length - shown;

  return (
    <section className="bg-card border border-border rounded-lg p-3 sm:p-4 min-w-0" aria-label={title}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground mt-0.5">
        {caption ? `${caption} ` : ''}
        {rows.length} {rows.length === 1 ? 'game' : 'games'}, newest first.
      </p>
      <ul className="mt-2">
        {rows.slice(0, shown).map((r, i) => {
          const side = team ?? r.team ?? (isHkfcTeam(r.home) && isHkfcTeam(r.away) ? undefined : isHkfcTeam(r.home) ? r.home : r.away);
          const o = side ? outcomeFor(r, side) : null;
          const details = [
            r.division ? leagueLabel(r.division) : null,
            r.venue,
            r.goals ? `${r.goals} ${r.goals === 1 ? 'goal' : 'goals'}` : null,
          ].filter(Boolean);
          return (
            <li key={`${r.date}-${r.home}-${r.away}-${i}`} className="grid grid-cols-[3.25rem_1fr_auto] gap-2 items-center py-2 border-t border-border">
              <span className="text-[11px] leading-tight text-muted-foreground tabular-nums">
                <span className="block">{safeFormat(r.date, multiSeason ? 'd MMM' : 'EEE')}</span>
                <span className="block">{safeFormat(r.date, multiSeason ? 'yyyy' : 'd MMM')}</span>
              </span>
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
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <div className="flex gap-3 pt-2 border-t border-border">
          <button onClick={() => setShown((n) => n + PAGE * 2)} className="text-sm text-primary underline">
            Show {Math.min(more, PAGE * 2)} more
          </button>
          {more > PAGE * 2 && (
            <button onClick={() => setShown(rows.length)} className="text-sm text-muted-foreground underline">
              Show all {rows.length}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
