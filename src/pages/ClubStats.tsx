import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { User } from 'lucide-react';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartCard, DataTable, HBars, StatTile } from '@/components/membership/charts';
import { recentSeasons, shortSeason } from '@/api/stats';
import { useAllSeasonStats, useSeasonStats } from '@/lib/queries';
import { hkDateKey } from '@shared/hkDateKey';
import { seasonStartYear } from '@shared/membershipInsights';
import {
  clubRecord,
  combineSeasons,
  games,
  leaders,
  splitsAcrossTeams,
  teamOrder,
  winPct,
  type LeaderRow,
  type PeriodStats,
  type WDL,
} from '@shared/clubStats';

/** How far back the season picker and "All time" look. */
const SEASONS_BACK = 15;

const TABS = [
  { key: 'club', label: 'Club' },
  { key: 'teams', label: 'Teams' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const pct = (r: WDL) => {
  const p = winPct(r);
  return p === null ? '–' : `${p}%`;
};
const wdl = (r: WDL) => `${r.w}-${r.d}-${r.l}`;
const perGame = (n: number, g: number) => (g ? (n / g).toFixed(1) : '–');
/** HKHA divisions arrive as "P", "1", "2"…: "Premier", "Div 1", "Div 2". */
const divisionLabel = (d?: string) => (!d ? undefined : d === 'P' ? 'Premier' : /^\d+$/.test(d) ? `Div ${d}` : d);

/**
 * Club and team statistics for every signed-in player (owner decision,
 * 2026-09-26). One season is one request; "All time" adds the seasons up
 * here. No player's cards appear on this page.
 */
export default function ClubStats() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = hkDateKey(new Date().toISOString());
  const y = seasonStartYear(today);
  const current = `${y}-${y + 1}`;
  const seasons = useMemo(() => recentSeasons(current, SEASONS_BACK), [current]);

  const period = params.get('season') === 'all' ? 'all' : seasons.includes(params.get('season') ?? '') ? params.get('season')! : current;
  const tab: Tab = params.get('tab') === 'teams' ? 'teams' : 'club';
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const one = useSeasonStats(period === 'all' ? null : period);
  const all = useAllSeasonStats(seasons, period === 'all');

  const stats: PeriodStats | null = useMemo(() => {
    if (period === 'all') return all.summaries.length ? combineSeasons(all.summaries) : null;
    return one.data ? combineSeasons([one.data]) : null;
  }, [period, one.data, all.summaries]);

  const loading = period === 'all' ? !all.done && all.summaries.length === 0 : one.isLoading;
  const failed = period === 'all' ? all.isError : one.isError;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader subtitle="Stats">
        <button onClick={() => navigate('/')} className={headerNavClass()}>
          <User className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Player View</span>
        </button>
      </AppHeader>

      <main className="flex-1 container mx-auto px-4 py-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Stats views" className="flex gap-1 border-b border-border flex-1 min-w-[10rem]">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => set({ tab: t.key === 'club' ? null : t.key })}
                className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
                  tab === t.key
                    ? 'border-primary text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            value={period}
            onChange={(e) => set({ season: e.target.value === current ? null : e.target.value })}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            aria-label="Season"
          >
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s === current ? `This season (${shortSeason(s)})` : shortSeason(s)}
              </option>
            ))}
            <option value="all">All time</option>
          </select>
        </div>

        {period === 'all' && !all.done && (
          <p className="text-xs text-muted-foreground" role="status">
            Adding up past seasons… {all.loadedCount} loaded. The first look at a season takes a few seconds; after that
            it is instant.
          </p>
        )}

        {failed ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground mb-2">Could not load the stats.</p>
            <button onClick={() => window.location.reload()} className="text-sm text-primary underline">
              Try again
            </button>
          </div>
        ) : loading || !stats ? (
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : stats.matches === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground">No games recorded for {period === 'all' ? 'any season' : shortSeason(period)} yet.</p>
          </div>
        ) : tab === 'club' ? (
          <ClubTab stats={stats} allTime={period === 'all'} summaries={all.summaries} />
        ) : (
          <TeamsTab stats={stats} team={params.get('team')} onTeam={(t) => set({ team: t })} />
        )}
      </main>
      <AppFooter />
    </div>
  );
}

/** "E 61 · D 21 · F 12": a figure team by team. */
const teamSplit = (byTeam: [string, number][]) => byTeam.map(([t, n]) => `${t.replace(/^HKFC /, '')} ${n}`).join(' · ');

function Leaders({
  title,
  rows,
  unit,
  caption,
  split = false,
}: {
  title: string;
  rows: LeaderRow[];
  unit: string;
  caption?: string;
  /** Show each player's figure team by team (the club-wide lists). */
  split?: boolean;
}) {
  const note = (r: LeaderRow) => {
    const apps = unit === 'appearances' ? undefined : `${r.apps} apps`;
    // Only worth saying when the games were for more than one team.
    const teams = split && r.byTeam.length > 1 ? teamSplit(r.byTeam) : undefined;
    return [apps, teams].filter(Boolean).join(' · ') || undefined;
  };
  return (
    <ChartCard title={title} caption={caption}>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">None recorded.</p>
      ) : (
        <HBars rows={rows.map((r) => ({ label: r.name, value: r.value, note: note(r) }))} unit={unit} />
      )}
    </ChartCard>
  );
}

/** Said wherever player figures are shown for a period that includes results-only seasons. */
function PlayerDataNote({ stats }: { stats: PeriodStats }) {
  if (stats.seasonsWithoutPlayers.length === 0) return null;
  const withPlayers = stats.seasons.filter((s) => !stats.seasonsWithoutPlayers.includes(s));
  if (withPlayers.length === 0) {
    return <p className="text-xs text-muted-foreground">No Match Cards were recorded this season, so there are results but no player figures.</p>;
  }
  return (
    <p className="text-xs text-muted-foreground">
      Appearances and goals are recorded from {shortSeason(withPlayers[0])}, the first season with Match Cards; earlier
      seasons have results only.
    </p>
  );
}

function ClubTab({
  stats,
  allTime,
  summaries,
}: {
  stats: PeriodStats;
  allTime: boolean;
  summaries: { season: string; teams: PeriodStats['teams']; derbies: number }[];
}) {
  const record = clubRecord(stats);
  const splits = splitsAcrossTeams(stats.teams);
  const cleanSheets = stats.teams.reduce((n, t) => n + t.cleanSheets, 0);
  const teamGames = stats.teams.reduce((n, t) => n + t.played, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatTile label="Games" value={record.games} hint={stats.derbies ? `Plus ${stats.derbies} HKFC derbies` : 'Against other clubs'} />
        <StatTile label="Win rate" value={pct(record)} hint={`W-D-L ${wdl(record)}`} />
        <StatTile label="Goals per game" value={perGame(record.gf, record.games)} hint={`Conceded ${perGame(record.ga, record.games)}`} />
        <StatTile label="Clean sheets" value={cleanSheets} hint={`In ${teamGames} team games`} />
      </div>

      <ChartCard
        title="Teams"
        table={
          <DataTable
            head={['Team', 'P', 'W', 'D', 'L', 'GF', 'GA', 'Win']}
            rows={stats.teams.map((t) => [t.team, t.played, t.w, t.d, t.l, t.gf, t.ga, pct(t)])}
          />
        }
      >
        <HBars
          rows={stats.teams.map((t) => ({ label: t.team, value: winPct(t) ?? 0, note: `${wdl(t)}${t.division ? ` · ${divisionLabel(t.division)}` : ''}` }))}
          unit="% won"
        />
      </ChartCard>

      <PlayerDataNote stats={stats} />
      <div className="grid gap-3 lg:grid-cols-3">
        <Leaders title="Most appearances" rows={leaders(stats.players, 'apps')} unit="appearances" split />
        <Leaders title="Top scorers" rows={leaders(stats.players, 'goals')} unit="goals" split />
        <Leaders title="Most games as captain" rows={leaders(stats.players, 'captain')} unit="games as captain" split />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Home and away" caption="Every team's games.">
          <DataTable
            head={['', 'Games', 'W-D-L', 'Win']}
            rows={[
              ['Home', games(splits.home), wdl(splits.home), pct(splits.home)],
              ['Away', games(splits.away), wdl(splits.away), pct(splits.away)],
            ]}
          />
        </ChartCard>
        <ChartCard title="By venue">
          <DataTable
            head={['Venue', 'Games', 'W-D-L', 'Win']}
            rows={splits.venues.map(([v, r]) => [v, games(r), wdl(r), pct(r)])}
          />
        </ChartCard>
      </div>

      {allTime && summaries.length > 1 && (
        <ChartCard title="Season by season" caption="Against other clubs; derbies left out.">
          <DataTable
            head={['Season', 'Games', 'W-D-L', 'Win', 'GF', 'GA']}
            rows={summaries.map((s) => {
              const r = clubRecord({ teams: s.teams, derbies: s.derbies });
              return [shortSeason(s.season), r.games, wdl(r), pct(r), r.gf, r.ga];
            })}
          />
        </ChartCard>
      )}
    </div>
  );
}

function TeamsTab({ stats, team, onTeam }: { stats: PeriodStats; team: string | null; onTeam: (t: string) => void }) {
  const names = teamOrder(stats.teams);
  const chosen = names.includes(team ?? '') ? team! : names[0];
  const t = stats.teams.find((x) => x.team === chosen);
  if (!t) return null;
  const opponents = Object.entries(t.opponents).sort((a, b) => games(b[1]) - games(a[1]) || a[0].localeCompare(b[0]));

  return (
    <div className="space-y-4">
      <nav className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4" aria-label="Team">
        {names.map((n) => (
          <button
            key={n}
            onClick={() => onTeam(n)}
            aria-pressed={n === chosen}
            className={`shrink-0 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
              n === chosen
                ? 'bg-secondary text-secondary-foreground border-secondary'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {n.replace(/^HKFC /, '')}
          </button>
        ))}
      </nav>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatTile label="Played" value={t.played} hint={divisionLabel(t.division)} />
        <StatTile label="Win rate" value={pct(t)} hint={`W-D-L ${wdl(t)}`} />
        <StatTile label="Goals" value={`${t.gf}-${t.ga}`} hint={`${perGame(t.gf, t.played)} per game`} />
        <StatTile label="Clean sheets" value={t.cleanSheets} />
      </div>

      <PlayerDataNote stats={stats} />
      <div className="grid gap-3 lg:grid-cols-3">
        <Leaders title="Top scorers" rows={leaders(stats.players, 'goals', { team: t.team })} unit="goals" />
        <Leaders title="Most appearances" rows={leaders(stats.players, 'apps', { team: t.team })} unit="appearances" />
        <Leaders
          title="Played up into this team"
          rows={leaders(stats.players, 'playUps', { team: t.team })}
          unit="games played up"
          caption="Games for this team by players registered lower down."
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Against each opponent">
          <DataTable
            head={['Opponent', 'P', 'W-D-L', 'GF', 'GA']}
            rows={opponents.map(([o, r]) => [o, games(r), wdl(r), r.gf, r.ga])}
          />
        </ChartCard>
        <ChartCard title="Home, away and venue">
          <DataTable
            head={['', 'Games', 'W-D-L', 'Win']}
            rows={[
              ['Home', games(t.home), wdl(t.home), pct(t.home)],
              ['Away', games(t.away), wdl(t.away), pct(t.away)],
              ...Object.entries(t.venues)
                .sort((a, b) => games(b[1]) - games(a[1]))
                .map(([v, r]) => [v, games(r), wdl(r), pct(r)]),
            ]}
          />
        </ChartCard>
      </div>
    </div>
  );
}
