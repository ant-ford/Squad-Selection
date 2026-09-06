import { useState } from 'react';
import { safeFormat } from '@/lib/dateUtils';
import { Skeleton } from '@/components/ui/skeleton';
import type { PlayerGameResult } from '@/api/getPlayerStats';
import { usePlayerStats } from '@/lib/queries';

/** Win green, draw white, loss red — per the form-guide convention. */
const OUTCOME_TILE: Record<PlayerGameResult['outcome'], string> = {
  win: 'bg-green-600 text-white border-green-700',
  draw: 'bg-white text-neutral-700 border-neutral-300',
  loss: 'bg-red-600 text-white border-red-700',
};

const OUTCOME_LETTER: Record<PlayerGameResult['outcome'], string> = {
  win: 'W',
  draw: 'D',
  loss: 'L',
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-2">
      <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
      <p className="text-base font-semibold text-foreground leading-tight">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground leading-tight">{hint}</p>}
    </div>
  );
}

/** Expanded detail for one game: what the player actually did in it. */
function GameDetail({ game }: { game: PlayerGameResult }) {
  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
      <p className="font-medium text-foreground">
        {game.team} {game.goalsFor}–{game.goalsAgainst} {game.opponent}
      </p>
      <p className="text-muted-foreground">
        {safeFormat(game.date, 'EEE d MMM')} · {game.isHome ? 'Home' : 'Away'}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">
          {game.goals === 0 ? 'No goals' : `${game.goals} goal${game.goals === 1 ? '' : 's'}`}
        </span>
        {game.cards.length === 0 ? (
          <span className="text-muted-foreground">· No cards</span>
        ) : (
          <>
            <span className="text-muted-foreground">·</span>
            {game.cards.map((c, i) => (
              <span
                key={`${c}-${i}`}
                className={`px-1.5 py-0.5 rounded font-medium ${
                  c.toUpperCase().startsWith('R')
                    ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {c}
              </span>
            ))}
            {game.cardPoints > 0 && (
              <span className="text-muted-foreground">
                ({game.cardPoints} pt{game.cardPoints === 1 ? '' : 's'})
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Season statistics panel.
 *
 * Always rendered inside a drill-down (SeasonStatsSheet) rather than inline:
 * stats are reference material, and on a phone an inline panel pushed the
 * fixtures - the thing players actually action - below the fold. It takes a
 * playerId rather than assuming the current user, because coaches open the
 * same panel for someone else.
 */
export default function SeasonStats({ playerId }: { playerId: string }) {
  const { data: stats, isLoading: loading, isError: failed } = usePlayerStats(playerId);
  const [openGame, setOpenGame] = useState<string | null>(null);

  if (loading) return <Skeleton className="h-32 w-full rounded-xl" />;
  // Stats are a nice-to-have next to fixtures; a failure should never take
  // the dashboard down with it.
  if (failed || !stats) return null;

  const participation =
    stats.participationPct === null
      ? '—'
      : `${stats.participationPct}%${
          stats.availabilityPct === null ? '' : ` (${stats.availabilityPct}%)`
        }`;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold text-foreground">Season {stats.season}</h2>
        <span className="text-[11px] text-muted-foreground truncate">{stats.team}</span>
      </div>

      {/* Recent form. Tap a tile for what happened in that game. */}
      {stats.recentGames.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] text-muted-foreground mb-1">Last {stats.recentGames.length} (latest first)</p>
          <div className="flex gap-1.5">
            {stats.recentGames.map((g) => (
              <button
                key={g.matchId}
                onClick={() => setOpenGame(openGame === g.matchId ? null : g.matchId)}
                aria-expanded={openGame === g.matchId}
                title={`${g.team} ${g.goalsFor}–${g.goalsAgainst} ${g.opponent}`}
                className={`h-8 w-8 rounded-md border text-xs font-bold transition-shadow ${
                  OUTCOME_TILE[g.outcome]
                } ${openGame === g.matchId ? 'ring-2 ring-primary ring-offset-1' : ''}`}
              >
                {OUTCOME_LETTER[g.outcome]}
              </button>
            ))}
          </div>
          {openGame && stats.recentGames.some((g) => g.matchId === openGame) && (
            <GameDetail game={stats.recentGames.find((g) => g.matchId === openGame)!} />
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Played" value={String(stats.gamesPlayed)} />
        <Stat label="Available" value={String(stats.gamesAvailableNotSelected)} hint="not selected" />
        <Stat label="Unavailable" value={String(stats.gamesUnavailable)} />
        <Stat label="Team games" value={String(stats.teamGames)} />
        <Stat label="Goals" value={String(stats.goals)} />
        <Stat label="Card points" value={String(stats.cardPoints)} />
      </div>

      <div className="mt-1.5">
        <Stat
          label="Participation"
          value={participation}
          hint="played / team games (incl. available in brackets)"
        />
      </div>
    </section>
  );
}
