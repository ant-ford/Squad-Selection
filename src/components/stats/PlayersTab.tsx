import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { Columns, ChartCard, DataTable, HBars, StatTile, TeamStackedBars, teamColour } from '@/components/membership/charts';
import { shortSeason, type SeasonStats } from '@/api/stats';
import {
  careerOf,
  playerRows,
  winPct,
  type PeriodStats,
  type PlayerTeamLine,
  type WDL,
} from '@shared/clubStats';

const wdl = (r: WDL) => `${r.w}-${r.d}-${r.l}`;
const pct = (r: WDL) => {
  const p = winPct(r);
  return p === null ? '–' : `${p}%`;
};
const perGame = (n: number, g: number) => (g ? (n / g).toFixed(2) : '–');
const byTeamText = (teams: Record<string, PlayerTeamLine>) =>
  Object.entries(teams)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, l]) => `${t.replace(/^HKFC /, '')} ${l.apps}`)
    .join(', ');

/** How many players the list shows before a search narrows it. */
const LIST_LIMIT = 60;

/**
 * The Players tab: everyone who played in the chosen period, and any one
 * player's career across every season. Cards appear only on the signed-in
 * player's own career (owner decision, 2026-09-26); the Worker sends no
 * one else's.
 */
export default function PlayersTab({
  stats,
  allSeasons,
  allDone,
  me,
  player,
  onPlayer,
  note,
}: {
  stats: PeriodStats;
  /** Every season with games, for careers (loaded one by one). */
  allSeasons: SeasonStats[];
  allDone: boolean;
  /** The signed-in player's own key, when they have played. */
  me?: string;
  player: string | null;
  onPlayer: (key: string | null) => void;
  /** Said where player figures start (results-only seasons). */
  note?: ReactNode;
}) {
  if (player) {
    return <CareerView seasons={allSeasons} done={allDone} player={player} own={player === me} onBack={() => onPlayer(null)} note={note} />;
  }
  return <PlayerList stats={stats} me={me} onPlayer={onPlayer} note={note} />;
}

function PlayerList({
  stats,
  me,
  onPlayer,
  note,
}: {
  stats: PeriodStats;
  me?: string;
  onPlayer: (key: string) => void;
  note?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => playerRows(stats.players), [stats.players]);
  const q = query.trim().toLowerCase();
  const shown = (q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows).slice(0, LIST_LIMIT);
  const mine = me ? rows.find((r) => r.key === me) : undefined;

  return (
    <div className="space-y-3">
      {note}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[12rem]">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players"
            className="w-full h-9 rounded-md border border-border bg-background pl-8 pr-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Search players"
          />
        </label>
        {me && (
          <button
            onClick={() => onPlayer(me)}
            className="h-9 px-3 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/85"
          >
            My career
          </button>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr_repeat(3,3.25rem)] sm:grid-cols-[1fr_repeat(4,4rem)] gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
          <span>Player</span>
          <span className="text-right">Apps</span>
          <span className="text-right">Goals</span>
          <span className="text-right hidden sm:block">W-D-L</span>
          <span className="text-right">Win</span>
        </div>
        {shown.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">No players match.</p>
        ) : (
          <ul>
            {shown.map((r) => (
              <li key={r.key} className="border-b border-border last:border-0">
                <button
                  onClick={() => onPlayer(r.key)}
                  className={`w-full grid grid-cols-[1fr_repeat(3,3.25rem)] sm:grid-cols-[1fr_repeat(4,4rem)] gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus:outline-none focus-visible:bg-muted ${
                    r.key === mine?.key ? 'font-medium' : ''
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-foreground">{r.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {r.byTeam.map(([t, n]) => `${t.replace(/^HKFC /, '')} ${n}`).join(' · ')}
                    </span>
                  </span>
                  <span className="text-right tabular-nums text-foreground">{r.apps}</span>
                  <span className="text-right tabular-nums text-foreground">{r.goals}</span>
                  <span className="text-right tabular-nums text-muted-foreground hidden sm:block">{wdl(r)}</span>
                  <span className="text-right tabular-nums text-foreground">{pct(r)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!q && rows.length > LIST_LIMIT && (
        <p className="text-xs text-muted-foreground">
          Showing the {LIST_LIMIT} with most appearances of {rows.length}. Search to find anyone else.
        </p>
      )}
    </div>
  );
}

function CareerView({
  seasons,
  done,
  player,
  own,
  onBack,
  note,
}: {
  seasons: SeasonStats[];
  done: boolean;
  player: string;
  own: boolean;
  onBack: () => void;
  note?: ReactNode;
}) {
  const career = useMemo(() => careerOf(seasons, player), [seasons, player]);
  // The signed-in player's own cards, season by season; nobody else's reach the page.
  const cards = useMemo(() => {
    if (!own) return null;
    const bySeason = new Map(seasons.map((s) => [s.season, s.myCards ?? { yellow: 0, red: 0 }]));
    const total = [...bySeason.values()].reduce((t, c) => ({ yellow: t.yellow + c.yellow, red: t.red + c.red }), { yellow: 0, red: 0 });
    return { bySeason, total };
  }, [own, seasons]);

  const back = (
    <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> All players
    </button>
  );

  if (!career) {
    return (
      <div className="space-y-3">
        {back}
        <p className="text-sm text-muted-foreground">
          {done ? 'No games recorded for this player.' : 'Adding up their seasons…'}
        </p>
      </div>
    );
  }

  const t = career.total;
  const seasonsTable = (
    <DataTable
      head={['Season', 'Apps', 'Goals', 'W-D-L', 'By team', ...(cards ? ['Cards'] : [])]}
      rows={[...career.seasons].reverse().map((s) => {
        const c = cards?.bySeason.get(s.season);
        return [
          shortSeason(s.season),
          s.total.apps,
          s.total.goals,
          wdl(s.total),
          byTeamText(s.teams),
          ...(cards ? [c ? `${c.yellow} yellow · ${c.red} red` : '–'] : []),
        ];
      })}
    />
  );
  const teams = Object.entries(career.teams).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="space-y-4">
      {back}
      <div>
        <h2 className="text-lg font-semibold text-foreground">{career.name}</h2>
        <p className="text-xs text-muted-foreground">
          Career: {career.seasons.length} {career.seasons.length === 1 ? 'season' : 'seasons'}
          {!done && ' so far (still adding up seasons)'}
        </p>
      </div>
      {note}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatTile label="Appearances" value={t.apps} hint={t.playUps ? `${t.playUps} played up` : undefined} />
        <StatTile label="Goals" value={t.goals} hint={`${perGame(t.goals, t.apps)} per game`} />
        <StatTile label="Win rate" value={pct(t)} hint={`W-D-L ${wdl(t)}`} />
        <StatTile label="Captain" value={t.captain} hint={t.captain === 1 ? 'game as captain' : 'games as captain'} />
        {t.keeper > 0 && <StatTile label="In goal" value={t.keeper} hint={t.keeper === 1 ? 'game' : 'games'} />}
        {cards && (
          <StatTile
            label="My cards"
            value={cards.total.yellow + cards.total.red}
            hint={`${cards.total.yellow} yellow · ${cards.total.red} red. Only you see this.`}
          />
        )}
      </div>

      <ChartCard title="Season by season" caption="Appearances each season, by team." table={seasonsTable}>
        <TeamStackedBars
          rows={career.seasons.map((s) => ({
            label: shortSeason(s.season),
            total: s.total.apps,
            parts: Object.entries(s.teams).map(([team, l]): [string, number] => [team, l.apps]),
            note: s.total.goals ? `${s.total.goals} ${s.total.goals === 1 ? 'goal' : 'goals'}` : undefined,
          }))}
          unit="appearances"
          narrowLabels
        />
      </ChartCard>

      <div className="grid gap-3 lg:grid-cols-2">
        {t.goals > 0 && career.seasons.length > 1 && (
          <ChartCard title="Goals by season">
            <Columns
              rows={career.seasons.map((s) => ({
                key: s.season,
                label: shortSeason(s.season).slice(2),
                value: s.total.goals,
                detail: `${s.total.apps} games`,
              }))}
              unit="goals"
            />
          </ChartCard>
        )}
        <ChartCard
          title="For each team"
          table={
            <DataTable
              head={['Team', 'Apps', 'Goals', 'W-D-L', 'Win']}
              rows={teams.map(([team, l]) => [team, l.apps, l.goals, wdl(l), pct(l)])}
            />
          }
        >
          <HBars
            rows={teams.map(([team, l]) => ({ label: team, value: l.apps, note: `${wdl(l)} · ${pct(l)} won` }))}
            unit="appearances"
            narrowLabels
            colourOf={teamColour}
          />
        </ChartCard>
      </div>
    </div>
  );
}
