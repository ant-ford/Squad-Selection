/**
 * Club, team and player statistics: the per-season summary the Worker
 * builds (worker/src/clubStats.ts) and the arithmetic the Stats page does on
 * it. A summary is small and never changes once its season is over, so the
 * page fetches one season per request and adds seasons up itself for "all
 * time".
 *
 * Nothing here carries another player's cards: owner decision, 2026-09-26,
 * cards show only on a player's own career page. The summary sent to the
 * page has none; the Worker adds the signed-in player's own on request.
 */

/** Bump when the summary's shape changes: stored summaries are keyed by it. */
export const SUMMARY_VERSION = 4;

export interface WDL {
  w: number;
  d: number;
  l: number;
}

export interface TeamSeason {
  team: string;
  division?: string;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  cleanSheets: number;
  home: WDL;
  away: WDL;
  venues: Record<string, WDL>;
  opponents: Record<string, WDL & { gf: number; ga: number }>;
}

/** One player's games for one HKFC team. */
export interface PlayerTeamLine extends WDL {
  apps: number;
  goals: number;
  captain: number;
  keeper: number;
  /** Games played for this team above their own (Match Card "Play Up?"). */
  playUps: number;
}

export interface PlayerSeason {
  /** People record id, or "raw:<name>" for a card never linked to one. */
  key: string;
  name: string;
  teams: Record<string, PlayerTeamLine>;
}

export interface UmpireSeason {
  key: string;
  name: string;
  /** HKFC games they umpired. */
  games: number;
  appointed: number;
  duty: number;
  /** HKFC's results in those games; HKFC-v-HKFC derbies are left out. */
  hkfc: WDL;
  derbies: number;
  /** Cards shown to HKFC players in those games (shared by both umpires). */
  cardsToHkfc: number;
}

export interface SeasonSummary {
  version: number;
  season: string;
  generatedAt: string;
  /** HKFC games counted (a derby once). Zero for a season with no data. */
  matches: number;
  derbies: number;
  teams: TeamSeason[];
  players: PlayerSeason[];
  umpires: UmpireSeason[];
  /** HKFC results by who umpired: appointed umpires, or team (duty) umpires. */
  umpireSplits: { appointed: WDL; duty: WDL; unknown: WDL };
}

export const emptyWDL = (): WDL => ({ w: 0, d: 0, l: 0 });

export function addWDL(into: WDL, from: WDL): WDL {
  into.w += from.w;
  into.d += from.d;
  into.l += from.l;
  return into;
}

export const games = (r: WDL) => r.w + r.d + r.l;

/** Win percentage, 0-100, or null with no games. */
export const winPct = (r: WDL): number | null => (games(r) ? Math.round((r.w / games(r)) * 100) : null);

// ── Adding seasons up ────────────────────────────────────────────────────

function mergeTeam(a: TeamSeason, b: TeamSeason): TeamSeason {
  const venues = { ...structuredClone(a.venues) };
  for (const [v, r] of Object.entries(b.venues)) venues[v] = addWDL(venues[v] ?? emptyWDL(), r);
  const opponents = { ...structuredClone(a.opponents) };
  for (const [o, r] of Object.entries(b.opponents)) {
    const into = opponents[o] ?? { ...emptyWDL(), gf: 0, ga: 0 };
    addWDL(into, r);
    into.gf += r.gf;
    into.ga += r.ga;
    opponents[o] = into;
  }
  return {
    team: a.team,
    division: b.division ?? a.division,
    played: a.played + b.played,
    w: a.w + b.w,
    d: a.d + b.d,
    l: a.l + b.l,
    gf: a.gf + b.gf,
    ga: a.ga + b.ga,
    cleanSheets: a.cleanSheets + b.cleanSheets,
    home: addWDL({ ...a.home }, b.home),
    away: addWDL({ ...a.away }, b.away),
    venues,
    opponents,
  };
}

function mergeLine(a: PlayerTeamLine, b: PlayerTeamLine): PlayerTeamLine {
  return {
    apps: a.apps + b.apps,
    goals: a.goals + b.goals,
    captain: a.captain + b.captain,
    keeper: a.keeper + b.keeper,
    playUps: a.playUps + b.playUps,
    w: a.w + b.w,
    d: a.d + b.d,
    l: a.l + b.l,
  };
}

export interface PeriodStats {
  seasons: string[];
  /**
   * Seasons with results but no Match Cards, so no player figures: the base
   * has appearances only from 2021-22 (checked 2026-09-26).
   */
  seasonsWithoutPlayers: string[];
  matches: number;
  derbies: number;
  teams: TeamSeason[];
  players: PlayerSeason[];
  umpires: UmpireSeason[];
  umpireSplits: SeasonSummary["umpireSplits"];
}

/** Several seasons as one period. Players and umpires are matched by key; the latest name wins. */
export function combineSeasons(summaries: SeasonSummary[]): PeriodStats {
  const ordered = [...summaries].sort((a, b) => a.season.localeCompare(b.season));
  const teams = new Map<string, TeamSeason>();
  const players = new Map<string, PlayerSeason>();
  const umpires = new Map<string, UmpireSeason>();
  const splits = { appointed: emptyWDL(), duty: emptyWDL(), unknown: emptyWDL() };
  let matches = 0;
  let derbies = 0;
  for (const s of ordered) {
    matches += s.matches;
    derbies += s.derbies;
    for (const t of s.teams) teams.set(t.team, teams.has(t.team) ? mergeTeam(teams.get(t.team)!, t) : structuredClone(t));
    for (const p of s.players) {
      const have = players.get(p.key);
      if (!have) {
        players.set(p.key, structuredClone(p));
        continue;
      }
      have.name = p.name;
      for (const [team, line] of Object.entries(p.teams)) have.teams[team] = have.teams[team] ? mergeLine(have.teams[team], line) : { ...line };
    }
    for (const u of s.umpires) {
      const have = umpires.get(u.key);
      if (!have) {
        umpires.set(u.key, structuredClone(u));
        continue;
      }
      have.name = u.name;
      have.games += u.games;
      have.appointed += u.appointed;
      have.duty += u.duty;
      have.derbies += u.derbies;
      have.cardsToHkfc += u.cardsToHkfc;
      addWDL(have.hkfc, u.hkfc);
    }
    addWDL(splits.appointed, s.umpireSplits.appointed);
    addWDL(splits.duty, s.umpireSplits.duty);
    addWDL(splits.unknown, s.umpireSplits.unknown);
  }
  return {
    seasons: ordered.map((s) => s.season),
    seasonsWithoutPlayers: ordered.filter((s) => s.matches > 0 && s.players.length === 0).map((s) => s.season),
    matches,
    derbies,
    teams: [...teams.values()].sort((a, b) => a.team.localeCompare(b.team)),
    players: [...players.values()],
    umpires: [...umpires.values()],
    umpireSplits: splits,
  };
}

// ── Club-wide figures ────────────────────────────────────────────────────

/**
 * The club's record. Each team's games are its own, so an HKFC-v-HKFC derby
 * is a win for one team and a loss for the other; the club record leaves
 * derbies out so it is HKFC against everyone else.
 */
export function clubRecord(period: Pick<PeriodStats, "teams" | "derbies">): WDL & { gf: number; ga: number; games: number } {
  const r = { ...emptyWDL(), gf: 0, ga: 0, games: 0 };
  for (const t of period.teams) {
    for (const [opp, o] of Object.entries(t.opponents)) {
      if (isHkfcTeam(opp)) continue;
      addWDL(r, o);
      r.gf += o.gf;
      r.ga += o.ga;
    }
  }
  r.games = games(r);
  return r;
}

export const isHkfcTeam = (name: string) => /^HKFC\b/.test(name.trim());

/** Home, away and venue records across every team (derbies included, as each side's own game). */
export function splitsAcrossTeams(teams: TeamSeason[]): { home: WDL; away: WDL; venues: [string, WDL][] } {
  const home = emptyWDL();
  const away = emptyWDL();
  const venues = new Map<string, WDL>();
  for (const t of teams) {
    addWDL(home, t.home);
    addWDL(away, t.away);
    for (const [v, r] of Object.entries(t.venues)) venues.set(v, addWDL(venues.get(v) ?? emptyWDL(), r));
  }
  return { home, away, venues: [...venues.entries()].sort((a, b) => games(b[1]) - games(a[1])) };
}

export interface LeaderRow {
  key: string;
  name: string;
  value: number;
  /** Supporting figure, e.g. appearances next to goals. */
  apps: number;
  /** The same figure team by team, largest first: a player's games are spread across teams. */
  byTeam: [string, number][];
}

type LineField = "apps" | "goals" | "captain" | "keeper" | "playUps";

/** Top players by a figure, across every team or for one team. Ties by name. */
export function leaders(players: PlayerSeason[], field: LineField, opts: { team?: string; limit?: number } = {}): LeaderRow[] {
  const rows: LeaderRow[] = [];
  for (const p of players) {
    const lines = opts.team ? [p.teams[opts.team]].filter(Boolean) : Object.values(p.teams);
    const value = lines.reduce((n, l) => n + l[field], 0);
    const apps = lines.reduce((n, l) => n + l.apps, 0);
    const byTeam = Object.entries(opts.team ? { [opts.team]: p.teams[opts.team] } : p.teams)
      .filter(([, l]) => l && l[field] > 0)
      .map(([team, l]): [string, number] => [team, l[field]])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (value > 0) rows.push({ key: p.key, name: p.name, value, apps, byTeam });
  }
  return rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, opts.limit ?? 10);
}

/** Team names in HKFC order (A first), for pickers. */
export function teamOrder(teams: { team: string }[]): string[] {
  return teams.map((t) => t.team).sort((a, b) => a.localeCompare(b));
}
