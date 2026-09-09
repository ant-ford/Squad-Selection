import { useState } from 'react';
import { safeFormat } from '@/lib/dateUtils';
import { Skeleton } from '@/components/ui/skeleton';
import type { PlayerGameResult } from '@/api/getPlayerStats';
import { usePlayerStats } from '@/lib/queries';

/**
 * Form-guide colours. Win and loss carry the meaning, so they are solid; a
 * draw is deliberately quiet rather than a third competing colour.
 */
const OUTCOME_TILE: Record<PlayerGameResult['outcome'], string> = {
  win: 'bg-emerald-600 text-white',
  draw: 'bg-muted text-muted-foreground',
  loss: 'bg-rose-600 text-white',
};

const OUTCOME_LETTER: Record<PlayerGameResult['outcome'], string> = {
  win: 'W',
  draw: 'D',
  loss: 'L',
};

/** One of the three headline numbers. No box: the divider does the separating. */
function Headline({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 px-3 first:pl-0 last:pr-0">
      <p className="text-2xl font-semibold tabular-nums leading-none text-foreground">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

/** A secondary figure: label left, number right. Reads as a list, not a grid. */
function DetailRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="text-sm text-muted-foreground">
        {label}
        {hint && <span className="ml-1.5 text-[11px] text-muted-foreground/70">{hint}</span>}
      </span>
      <span className="text-sm font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/** Expanded detail for one game: what the player actually did in it. */
function GameDetail({ game }: { game: PlayerGameResult }) {
  return (
    <div className="mt-2.5 rounded-lg bg-muted/50 px-3 py-2.5 text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium text-foreground">
          {game.team} {game.goalsFor}&ndash;{game.goalsAgainst} {game.opponent}
        </p>
        <p className="shrink-0 text-muted-foreground">{game.isHome ? 'Home' : 'Away'}</p>
      </div>
      <p className="mt-0.5 text-muted-foreground">{safeFormat(game.date, 'EEE d MMM')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">
          {game.goals === 0 ? 'No goals' : `${game.goals} goal${game.goals === 1 ? '' : 's'}`}
        </span>
        {game.cards.length === 0 ? (
          <span className="text-muted-foreground">&middot; no cards</span>
        ) : (
          <>
            <span className="text-muted-foreground">&middot;</span>
            {game.cards.map((c, i) => (
              <span
                key={`${c}-${i}`}
                className={`rounded px-1.5 py-0.5 font-medium ${
                  c.toUpperCase().startsWith('R')
                    ? 'bg-rose-100 text-rose-700'
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
 *
 * Layout is three tiers, in the order someone actually reads them: the form
 * guide, the three numbers worth leading on, then the rest as a quiet list.
 * An earlier version gave all seven figures an identical bordered box, which
 * made the important ones impossible to find.
 */
export default function SeasonStats({ playerId }: { playerId: string }) {
  const { data: stats, isLoading: loading, isError: failed } = usePlayerStats(playerId);
  const [openGame, setOpenGame] = useState<string | null>(null);

  if (loading) return <Skeleton className="h-32 w-full rounded-xl" />;
  // Stats are a nice-to-have next to fixtures; a failure should never take
  // the dashboard down with it.
  if (failed || !stats) return null;

  const openDetail = stats.recentGames.find((g) => g.matchId === openGame);

  return (
    <section>
      {/* Which season and side these figures describe. A caption rather than a
          heading: the sheet title already says whose stats these are. */}
      <p className="mb-4 text-xs text-muted-foreground">
        {stats.team} &middot; season {stats.season}
      </p>

      {/* Form guide. Tap a tile for what happened in that game. */}
      {stats.recentGames.length > 0 && (
        <div className="mb-5">
          <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            Recent form
          </p>
          <div className="flex gap-1.5">
            {stats.recentGames.map((g) => (
              <button
                key={g.matchId}
                onClick={() => setOpenGame(openGame === g.matchId ? null : g.matchId)}
                aria-expanded={openGame === g.matchId}
                aria-label={`${g.team} ${g.goalsFor}-${g.goalsAgainst} ${g.opponent}`}
                title={`${g.team} ${g.goalsFor}–${g.goalsAgainst} ${g.opponent}`}
                className={`h-9 w-9 rounded-lg text-sm font-semibold transition-transform active:scale-95 ${
                  OUTCOME_TILE[g.outcome]
                } ${openGame === g.matchId ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
              >
                {OUTCOME_LETTER[g.outcome]}
              </button>
            ))}
          </div>
          {openDetail && <GameDetail game={openDetail} />}
        </div>
      )}

      {/* The three numbers worth leading on. */}
      <div className="flex divide-x divide-border border-y border-border py-3">
        <Headline value={String(stats.gamesPlayed)} label="Played" />
        <Headline value={String(stats.goals)} label="Goals" />
        <Headline
          value={stats.participationPct === null ? '—' : `${stats.participationPct}%`}
          label="Turnout"
        />
      </div>

      {/* Turnout in plain words, since a bare percentage hides the shape of it. */}
      {stats.participationPct !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          Played {stats.gamesPlayed} of {stats.teamGames} team games
          {stats.availabilityPct !== null && (
            <>
              {' '}&middot; available for {stats.availabilityPct}%
            </>
          )}
        </p>
      )}

      <div className="mt-3 divide-y divide-border">
        <DetailRow label="Team games" value={String(stats.teamGames)} />
        <DetailRow
          label="Available"
          hint="not selected"
          value={String(stats.gamesAvailableNotSelected)}
        />
        <DetailRow label="Unavailable" value={String(stats.gamesUnavailable)} />
        <DetailRow label="Card points" value={String(stats.cardPoints)} />
      </div>
    </section>
  );
}
