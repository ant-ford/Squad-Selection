import type { AvailabilityException, AvailabilityRule, Match, MatchCard, Player } from "../../shared/schema/domainTypes";
import type { Env } from "./env";
import { HttpError } from "./http";
import { isFriendly } from "./playUp";
import { getReferenceData, UNRANKED_TEAM_RANK } from "./reference";
import { getSeasonContext, currentSeason } from "./seasonContext";
import { effectiveAvailability, getRulesForPlayer, resolveRuleStatus, type ResolvedStatus } from "./availabilityRules";
import { selectedDisplayTeam } from "../../shared/displayTeam";
import { linkId } from "../../shared/airtableValueUtils";
import { hkDateKey } from "../../shared/hkDateKey";

/**
 * One player's season as a grid: the teams they can play for down the side, match dates
 * across the top, one cell per fixture.
 *
 * Past fixtures say what happened (played, available but not picked,
 * unavailable, a no-show); future ones say what is planned (selected, or the
 * player's availability). Availability is resolved per fixture exactly as the
 * selection screens resolve it - an explicit answer, then Opt-In Only, then
 * the player's standing rules - so a "no play-ups" rule shows as a refusal on
 * the higher teams' rows and nowhere else.
 *
 * Unlike season stats, friendlies are included: this is a record of where
 * the player was, not a figure selection is measured by. Each cell says
 * whether it is one.
 */

export type AttendanceStatus =
  /** On the Match Card for this fixture. */
  | "played"
  /** Picked for this fixture. Future, or past with no result recorded yet. */
  | "selected"
  /** Played, or is picked, for another HKFC fixture that day. */
  | "elsewhere"
  /** Past: available (or maybe) and not picked. */
  | "not-selected"
  /**
   * Past: picked, but not on the Match Card and not playing elsewhere. Only
   * when the match has cards - an uncarded match counts the pick as played.
   */
  | "no-show"
  /** Future: available / maybe, not (yet) picked. */
  | "available"
  | "maybe"
  | "unavailable"
  /** Cancelled or rescheduled, and the player did not play it. */
  | "off";

/** Where the availability answer came from. "default" = no answer at all. */
export type AvailabilitySource = "answer" | "rule" | "opt-in" | "default";

export interface AttendanceCell {
  team: string;
  /** YYYY-MM-DD, Hong Kong. */
  date: string;
  matchId: string;
  opponent: string;
  isHome: boolean;
  past: boolean;
  friendly: boolean;
  status: AttendanceStatus;
  availability: ResolvedStatus;
  source: AvailabilitySource;
  /** The side the player played / is picked for, when status is "elsewhere". */
  elsewhereTeam?: string;
  /** Result from this team's side, once played. */
  goalsFor?: number;
  goalsAgainst?: number;
  /** The player's goals, when they played. */
  goals?: number;
  /** Played is assumed: they were picked and the match has no Match Cards. */
  assumed?: boolean;
}

export interface PlayerAttendance {
  season: string;
  /** The player's display team - highlighted in the grid. */
  team: string;
  /** Today in Hong Kong, YYYY-MM-DD. */
  today: string;
  /** Row order: by rank - teams the player is eligible for (or has played for) with a fixture this season. */
  teams: string[];
  /** Column order: every date with a fixture on one of those rows, ascending. */
  dates: string[];
  cells: AttendanceCell[];
}

export interface PlayerAttendanceInput {
  player: Player;
  team: string;
  season: string;
  today: string;
  /** HKFC team name -> rank (1 = top). Defines which sides are ours. */
  teamRankMap: Record<string, number>;
  matches: Match[];
  /** This player's Match Cards for the season. */
  cards: MatchCard[];
  /** Matches with at least one Match Card, for anyone. */
  cardedMatchIds: Set<string>;
  exceptions: Pick<AvailabilityException, "player" | "match" | "availabilityStatus">[];
  rules?: AvailabilityRule[];
}

const OFF_STATUSES = new Set(["Cancelled", "Rescheduled"]);

/** Which HKFC side a Match Card belongs to: its Team, or the only HKFC side in the match. */
function cardSide(card: MatchCard, match: Match, isOurs: (t: string) => boolean): string {
  if (card.team && (card.team === match.homeTeam || card.team === match.awayTeam)) return card.team;
  const ours = [match.homeTeam, match.awayTeam].filter(isOurs);
  return ours.length === 1 ? ours[0] : card.team || "";
}

/** Pure grid computation. Everything is passed in so it is testable without Airtable. */
export function computePlayerAttendance(input: PlayerAttendanceInput): PlayerAttendance {
  const { player, team, season, today, teamRankMap, matches, cards, cardedMatchIds, exceptions, rules = [] } = input;
  const isOurs = (t: string) => Boolean(t) && teamRankMap[t] !== undefined;
  const playerRank = teamRankMap[player.registeredTeam || ""] ?? UNRANKED_TEAM_RANK;

  const seasonMatches = matches.filter((m) => (m.season || season) === season && hkDateKey(m.matchDate));
  const matchesById = new Map(seasonMatches.map((m) => [m.id, m]));

  // matchId:team the player has a Match Card for, and the side per date.
  const playedKeys = new Set<string>();
  const playedTeamByDate = new Map<string, string>();
  for (const card of cards) {
    if (card.season && card.season !== season) continue;
    const matchId = linkId(card.match);
    const match = matchId ? matchesById.get(matchId) : undefined;
    if (!match) continue;
    const side = cardSide(card, match, isOurs);
    playedKeys.add(`${match.id}:${side}`);
    playedTeamByDate.set(hkDateKey(match.matchDate), side);
  }
  const goalsByMatch = new Map<string, number>();
  for (const card of cards) {
    const matchId = linkId(card.match);
    if (matchId) goalsByMatch.set(matchId, (goalsByMatch.get(matchId) ?? 0) + (card.goals ?? 0));
  }

  // matchId:team the player is picked for, and the side per date.
  const selectedKeys = new Set<string>();
  const selectedTeamByDate = new Map<string, string>();
  for (const m of seasonMatches) {
    const date = hkDateKey(m.matchDate);
    if ((m.selectedPlayersHome ?? []).includes(player.id) && isOurs(m.homeTeam)) {
      selectedKeys.add(`${m.id}:${m.homeTeam}`);
      selectedTeamByDate.set(date, m.homeTeam);
    }
    if ((m.selectedPlayersAway ?? []).includes(player.id) && isOurs(m.awayTeam)) {
      selectedKeys.add(`${m.id}:${m.awayTeam}`);
      selectedTeamByDate.set(date, m.awayTeam);
    }
  }

  // A past fixture with no Match Cards at all - typically a friendly entered
  // by hand, which never gets a card - cannot show who turned up. Being
  // picked for it is taken as having played, never as a no-show.
  const assumedKeys = new Set<string>();
  for (const key of selectedKeys) {
    const cut = key.indexOf(":");
    const matchId = key.slice(0, cut);
    const side = key.slice(cut + 1);
    const m = matchesById.get(matchId)!;
    const date = hkDateKey(m.matchDate);
    const past = m.matchStatus === "Played" || date < today;
    if (!past || OFF_STATUSES.has(m.matchStatus) || cardedMatchIds.has(matchId)) continue;
    if (playedTeamByDate.has(date)) continue; // a real card that day says where they were
    assumedKeys.add(key);
    playedKeys.add(key);
    playedTeamByDate.set(date, side);
  }

  const answerByMatch = new Map<string, string>();
  for (const exc of exceptions) {
    if (linkId(exc.player) !== player.id) continue;
    const matchId = linkId(exc.match);
    if (matchId) answerByMatch.set(matchId, exc.availabilityStatus || "");
  }

  const cells: AttendanceCell[] = [];
  const teamsWithFixtures = new Set<string>();

  for (const m of seasonMatches) {
    const date = hkDateKey(m.matchDate);
    // A derby puts the same match on two rows, once per side.
    for (const side of [m.homeTeam, m.awayTeam]) {
      if (!isOurs(side)) continue;
      const isHome = side === m.homeTeam;
      teamsWithFixtures.add(side);

      const key = `${m.id}:${side}`;
      const played = m.matchStatus === "Played";
      const past = played || date < today;

      // Availability for THIS side: a play-up or support game is judged
      // against the row's team, as the selection screens do.
      const sideRank = teamRankMap[side] ?? UNRANKED_TEAM_RANK;
      const fixture = { date, isPlayUp: sideRank < playerRank, isSupport: sideRank > playerRank };
      const explicit = answerByMatch.get(m.id);
      const { status: availability } = effectiveAvailability(explicit, rules, fixture, { optInOnly: player.optInOnly });
      const source: AvailabilitySource = explicit
        ? "answer"
        : player.optInOnly
          ? "opt-in"
          : resolveRuleStatus(rules, fixture)
            ? "rule"
            : "default";

      let status: AttendanceStatus;
      let elsewhereTeam: string | undefined;
      const playedElsewhere = playedTeamByDate.get(date);
      const selectedElsewhere = selectedTeamByDate.get(date);

      if (playedKeys.has(key)) {
        status = "played";
      } else if (playedElsewhere && playedElsewhere !== side) {
        status = "elsewhere";
        elsewhereTeam = playedElsewhere;
      } else if (OFF_STATUSES.has(m.matchStatus)) {
        status = "off";
      } else if (played) {
        // Result is in and they are not on the card.
        if (selectedKeys.has(key)) status = "no-show";
        else if (selectedElsewhere && selectedElsewhere !== side) {
          // Picked for a side that has no card for them either: that side's
          // cell carries the no-show, this one just points at it.
          status = "elsewhere";
          elsewhereTeam = selectedElsewhere;
        } else if (availability === "Unavailable") status = "unavailable";
        else status = "not-selected";
      } else if (selectedKeys.has(key)) {
        // Future, or past with no result recorded yet.
        status = "selected";
      } else if (selectedElsewhere && selectedElsewhere !== side) {
        status = "elsewhere";
        elsewhereTeam = selectedElsewhere;
      } else if (availability === "Unavailable") {
        status = "unavailable";
      } else if (past) {
        status = "not-selected";
      } else {
        status = availability === "Maybe" ? "maybe" : "available";
      }

      const cell: AttendanceCell = {
        team: side,
        date,
        matchId: m.id,
        opponent: isHome ? m.awayTeam : m.homeTeam,
        isHome,
        past,
        friendly: isFriendly(m),
        status,
        availability,
        source,
      };
      if (elsewhereTeam) cell.elsewhereTeam = elsewhereTeam;
      if (played && typeof m.homeTeamScore === "number" && typeof m.awayTeamScore === "number") {
        cell.goalsFor = isHome ? m.homeTeamScore : m.awayTeamScore;
        cell.goalsAgainst = isHome ? m.awayTeamScore : m.homeTeamScore;
      }
      if (assumedKeys.has(key)) cell.assumed = true;
      else if (status === "played") cell.goals = goalsByMatch.get(m.id) ?? 0;
      cells.push(cell);
    }
  }

  // Rows are the teams the player can be picked for: their registered team
  // and every team above it (moving down needs Committee approval, §9.1).
  // A lower team they have actually played or been picked for stays - a
  // player re-registered upward mid-season keeps the games from before.
  const involved = new Set(
    cells.filter((c) => c.status === "played" || c.status === "selected" || c.status === "no-show").map((c) => c.team),
  );
  const shown = (t: string) =>
    (teamRankMap[t] ?? UNRANKED_TEAM_RANK) <= playerRank || involved.has(t) || t === team;
  const visibleCells = cells.filter((c) => shown(c.team));

  const teams = [...teamsWithFixtures].filter(shown).sort(
    (a, b) => (teamRankMap[a] ?? UNRANKED_TEAM_RANK) - (teamRankMap[b] ?? UNRANKED_TEAM_RANK) || a.localeCompare(b),
  );
  visibleCells.sort((a, b) => a.date.localeCompare(b.date));
  const visibleDates = [...new Set(visibleCells.map((c) => c.date))].sort();

  return { season, team, today, teams, dates: visibleDates, cells: visibleCells };
}

/** The grid for one player, read off the shared (cached) season context. */
export async function getPlayerAttendance(
  env: Env,
  playerId: string,
): Promise<PlayerAttendance & { playerName: string }> {
  const ref = await getReferenceData(env);
  const player = ref.players.find((p) => p.id === playerId);
  if (!player) throw new HttpError("Player record not found", 404);

  const season = currentSeason();
  const [ctx, rules] = await Promise.all([
    getSeasonContext(env, season),
    getRulesForPlayer(env, player.id),
  ]);

  const attendance = computePlayerAttendance({
    player,
    team: selectedDisplayTeam(player) || player.registeredTeam || "",
    season,
    today: hkDateKey(new Date().toISOString()),
    teamRankMap: ref.teamRankMap,
    matches: ctx.allMatches,
    cards: ctx.matchCardsByPlayer.get(player.id) ?? [],
    cardedMatchIds: ctx.matchIdsWithCards,
    exceptions: ctx.exceptionsRaw,
    rules,
  });

  return {
    ...attendance,
    playerName: player.preferredName || player.givenNames || "Player",
  };
}
