import type { AvailabilityException, AvailabilityRule, Match, MatchCard, Player, Team } from "../../shared/schema/domainTypes";
import type { Env } from "./env";
import { isFriendly } from "./playUp";
import { getReferenceData, UNRANKED_TEAM_RANK } from "./reference";
import { getSeasonContext, currentSeason } from "./seasonContext";
import { getAllAvailabilityRules } from "./availabilityRules";
import { cardSide, computePlayerAttendance, type AttendanceStatus, type AvailabilitySource } from "./playerAttendance";
import { selectedDisplayTeam } from "../../shared/displayTeam";
import { hkDateKey } from "../../shared/hkDateKey";
import { linkId } from "../../shared/airtableValueUtils";

/**
 * Every squad's season as one grid, for the coach view: teams down the side,
 * match dates across the top, and under each team the players whose
 * Selected Team it is.
 *
 * A squad is the players who DISPLAY as that team (Selected Team EOS -> SOS
 * -> Registered), the same grouping as the ranking screen. Each player's
 * cell is exactly what their own attendance grid shows on that team's row
 * (computePlayerAttendance), so the two screens can never disagree; the
 * team's totals are counted from those cells on the client.
 */

/** One squad member's status for one of their team's fixtures. */
export interface SquadCell {
  status: AttendanceStatus;
  source: AvailabilitySource;
  elsewhereTeam?: string;
}

export interface SquadPlayer {
  id: string;
  name: string;
  position?: string;
  /** Keyed by match id: only fixtures of the player's own squad team. */
  cells: Record<string, SquadCell>;
}

export interface TeamSquad {
  team: string;
  targetSquadSize: number;
  players: SquadPlayer[];
}

export interface TeamFixture {
  team: string;
  /** YYYY-MM-DD, Hong Kong. */
  date: string;
  matchId: string;
  opponent: string;
  isHome: boolean;
  past: boolean;
  friendly: boolean;
  /** Cancelled or rescheduled. */
  off: boolean;
  /** Everyone picked for this side, squad member or not. */
  selectedCount: number;
  /** Players on this side's Match Card, from any squad. Absent when it has none. */
  cardCount?: number;
  goalsFor?: number;
  goalsAgainst?: number;
}

export interface TeamAttendance {
  season: string;
  today: string;
  /** Every date with a fixture for one of the teams, ascending. */
  dates: string[];
  /** By team rank. Only teams with both a squad and a fixture this season. */
  teams: TeamSquad[];
  fixtures: TeamFixture[];
}

export interface TeamAttendanceInput {
  players: Player[];
  teams: Team[];
  season: string;
  today: string;
  teamRankMap: Record<string, number>;
  matches: Match[];
  cardsByPlayer: Map<string, MatchCard[]>;
  cardedMatchIds: Set<string>;
  exceptions: Pick<AvailabilityException, "player" | "match" | "availabilityStatus">[];
  rules: AvailabilityRule[];
}

const OFF_STATUSES = new Set(["Cancelled", "Rescheduled"]);
const DEFAULT_SQUAD_SIZE = 16;

function groupByPlayer<T extends { player?: string[] }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    for (const id of row.player ?? []) {
      const list = out.get(id);
      if (list) list.push(row);
      else out.set(id, [row]);
    }
  }
  return out;
}

/** First name and surname, as the app shows names everywhere: squads often have two of a first name. */
function playerName(p: Player): string {
  return [p.preferredName || p.givenNames, p.surname].filter(Boolean).join(" ") || "Player";
}

/** Pure grid computation. Everything is passed in so it is testable without a database. */
export function computeTeamAttendance(input: TeamAttendanceInput): TeamAttendance {
  const { players, teams, season, today, teamRankMap, matches, cardsByPlayer, cardedMatchIds, exceptions, rules } = input;
  const isOurs = (t: string) => Boolean(t) && teamRankMap[t] !== undefined;
  const rankOf = (t: string) => teamRankMap[t] ?? UNRANKED_TEAM_RANK;

  const seasonMatches = matches.filter((m) => (m.season || season) === season && hkDateKey(m.matchDate));
  const matchesById = new Map(seasonMatches.map((m) => [m.id, m]));

  // Who is on each side's Match Card - play-ups and fill-ins included, so
  // the count is the side that took the field, not just the squad's share.
  const carded = new Map<string, Set<string>>();
  for (const [playerId, cards] of cardsByPlayer) {
    for (const card of cards) {
      const match = matchesById.get(linkId(card.match) ?? "");
      if (!match) continue;
      const key = `${match.id}:${cardSide(card, match, isOurs)}`;
      const players = carded.get(key) ?? new Set<string>();
      players.add(playerId);
      carded.set(key, players);
    }
  }

  const fixtures: TeamFixture[] = [];
  for (const m of seasonMatches) {
    const date = hkDateKey(m.matchDate);
    const played = m.matchStatus === "Played";
    for (const side of [m.homeTeam, m.awayTeam]) {
      if (!isOurs(side)) continue;
      const isHome = side === m.homeTeam;
      const fixture: TeamFixture = {
        team: side,
        date,
        matchId: m.id,
        opponent: isHome ? m.awayTeam : m.homeTeam,
        isHome,
        past: played || date < today,
        friendly: isFriendly(m),
        off: OFF_STATUSES.has(m.matchStatus),
        selectedCount: (isHome ? m.selectedPlayersHome : m.selectedPlayersAway)?.length ?? 0,
      };
      const cardCount = carded.get(`${m.id}:${side}`)?.size;
      if (cardCount) fixture.cardCount = cardCount;
      if (played && typeof m.homeTeamScore === "number" && typeof m.awayTeamScore === "number") {
        fixture.goalsFor = isHome ? m.homeTeamScore : m.awayTeamScore;
        fixture.goalsAgainst = isHome ? m.awayTeamScore : m.homeTeamScore;
      }
      fixtures.push(fixture);
    }
  }
  const teamsWithFixtures = new Set(fixtures.map((f) => f.team));

  // Exceptions and rules are read once for the club, then handed to each
  // player's computation already narrowed to them.
  const exceptionsByPlayer = groupByPlayer(exceptions);
  const rulesByPlayer = groupByPlayer(rules);

  const squads = new Map<string, SquadPlayer[]>();
  for (const p of players) {
    const team = selectedDisplayTeam(p);
    if (!teamsWithFixtures.has(team)) continue;
    const attendance = computePlayerAttendance({
      player: p,
      team,
      season,
      today,
      teamRankMap,
      matches: seasonMatches,
      cards: cardsByPlayer.get(p.id) ?? [],
      cardedMatchIds,
      exceptions: exceptionsByPlayer.get(p.id) ?? [],
      rules: rulesByPlayer.get(p.id) ?? [],
    });
    const cells: Record<string, SquadCell> = {};
    for (const c of attendance.cells) {
      if (c.team !== team) continue;
      const cell: SquadCell = { status: c.status, source: c.source };
      if (c.elsewhereTeam) cell.elsewhereTeam = c.elsewhereTeam;
      cells[c.matchId] = cell;
    }
    const squad = squads.get(team) ?? [];
    squad.push({ id: p.id, name: playerName(p), position: p.playingPosition || undefined, cells });
    squads.set(team, squad);
  }

  const sizeByTeam = new Map(teams.map((t) => [t.teamName || "", t.targetSquadSize || DEFAULT_SQUAD_SIZE]));
  const teamRows: TeamSquad[] = [...squads.entries()]
    .sort(([a], [b]) => rankOf(a) - rankOf(b) || a.localeCompare(b))
    .map(([team, list]) => ({
      team,
      targetSquadSize: sizeByTeam.get(team) ?? DEFAULT_SQUAD_SIZE,
      players: list.sort((a, b) => a.name.localeCompare(b.name)),
    }));

  const shownTeams = new Set(teamRows.map((t) => t.team));
  const shownFixtures = fixtures
    .filter((f) => shownTeams.has(f.team))
    .sort((a, b) => a.date.localeCompare(b.date) || rankOf(a.team) - rankOf(b.team));
  const dates = [...new Set(shownFixtures.map((f) => f.date))].sort();

  return { season, today, dates, teams: teamRows, fixtures: shownFixtures };
}

/**
 * The grid for these teams (a coach's own; every team for those who coach
 * every team), read off the shared (cached) season context. Coach only.
 */
export async function getTeamAttendance(env: Env, teams: readonly string[]): Promise<TeamAttendance> {
  const season = currentSeason();
  const [ref, ctx, rules] = await Promise.all([
    getReferenceData(env),
    getSeasonContext(env, season),
    getAllAvailabilityRules(env),
  ]);

  return onlyTeams(computeTeamAttendance({
    players: ref.players,
    teams: ref.teams,
    season,
    today: hkDateKey(new Date().toISOString()),
    teamRankMap: ref.teamRankMap,
    matches: ctx.allMatches,
    cardsByPlayer: ctx.matchCardsByPlayer,
    cardedMatchIds: ctx.matchIdsWithCards,
    exceptions: ctx.exceptionsRaw,
    rules,
  }), teams);
}

/** The grid narrowed to these teams' squads and fixtures, and their dates. */
export function onlyTeams(grid: TeamAttendance, teams: readonly string[]): TeamAttendance {
  const keep = new Set(teams);
  const fixtures = grid.fixtures.filter((f) => keep.has(f.team));
  return {
    ...grid,
    dates: [...new Set(fixtures.map((f) => f.date))].sort(),
    teams: grid.teams.filter((t) => keep.has(t.team)),
    fixtures,
  };
}
