import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { safeFormat } from '@/lib/dateUtils';
import { Skeleton } from '@/components/ui/skeleton';
import { getPlayerStats, type PlayerGameResult, type PlayerSeasonStats } from '@/api/getPlayerStats';

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

const OPEN_STORAGE_KEY = 'seasonStats:open';

function readStoredOpen(fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(OPEN_STORAGE_KEY);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback; // private mode / blocked storage
  }
}

/**
 * Season statistics panel.
 *
 * Used on the player's own dashboard and by coaches drilling into a player,
 * so it takes a playerId rather than assuming the current user.
 *
 * Collapsed by default on the player dashboard: it sits above the fixture
 * list, which is what players actually come here to action, and on a phone
 * the full panel pushed the fixtures below the fold. The coach drill-in
 * passes defaultOpen because opening the stats *was* the intent there.
 * Whichever way a player leaves it is remembered.
 */
export default function SeasonStats({
  playerId,
  defaultOpen = true,
}: {
  playerId: string;
  defaultOpen?: boolean;
}) {
  const [stats, setStats] = useState<PlayerSeasonStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [openGame, setOpenGame] = useState<string | null>(null);
  const [open, setOpen] = useState(() => readStoredOpen(defaultOpen));

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(OPEN_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Preference is a convenience; never break the panel over it.
      }
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    getPlayerStats(playerId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

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
    <section className="border border-border rounded-xl bg-card p-3">
      {/* The header is the toggle: one tappable row that stays put whether
          the panel is open or closed. */}
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground shrink-0">
            Season {stats.season}
          </span>
          <span className="text-[11px] text-muted-foreground truncate">{stats.team}</span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {!open && (
            // Enough to be worth glancing at without opening.
            <span className="text-[11px] text-muted-foreground">
              {stats.gamesPlayed} played
              {stats.participationPct !== null && ` · ${stats.participationPct}%`}
            </span>
          )}
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
      </button>

      {!open ? null : (
      <div className="mt-2">

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
                // Explicit radius: the theme's --radius makes `rounded-md`
                // fully circular at this size, and these should read as tiles.
                className={`h-8 w-8 rounded-[5px] border text-xs font-bold transition-shadow ${
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
      </div>
      )}
    </section>
  );
}
