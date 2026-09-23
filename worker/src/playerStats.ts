import type { AvailabilityException, AvailabilityRule, Match, MatchCard, Player } from "../../shared/schema/domainTypes";
import type { Env } from "./env";
import { HttpError } from "./http";
import { isFriendly, matchForCard } from "./playUp";
import { parseCardValue, yellowPointsFor } from "./suspension";
import { getReferenceData } from "./reference";
import { getSeasonContext, currentSeason } from "./seasonContext";
import { effectiveAvailability, getRulesForPlayer } from "./availabilityRules";
import { selectedDisplayTeam } from "../../shared/displayTeam";
import { linkId } from "../../shared/airtableValueUtils";
import { hkDateKey } from "../../shared/hkDateKey";

/**
 * Season statistics for one player.
 *
 * Friendlies are excluded throughout, for the same reason they are excluded
 * from eligibility counts: they are not competitive fixtures, and letting a
 * warm-up game move a participation percentage would make the number mean
 * something different from the one coaches use for selection.
 */

export type GameOutcome = "win" | "draw" | "loss";

export interface PlayerGameResult {
  matchId: string;
  date: string;
  /** HKFC side the player turned out for (may differ from their own team). */
  team: string;
  opponent: string;
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
  outcome: GameOutcome;
  /** The player's own contribution in this game. */
  goals: number;
  /** Raw Cards values, e.g. ["Y2", "R1"]. */
  cards: string[];
  cardPoints: number;
}

export interface PlayerSeasonStats {
  season: string;
  /** Team the participation figures are measured against. */
  team: string;
  gamesPlayed: number;
  /**
   * The team's games, split four ways (they sum to teamGames):
   * played for the team, available but not picked, picked but never turned
   * up (no Match Card), and unavailable.
   */
  gamesPlayedForTeam: number;
  gamesAvailableNotSelected: number;
  gamesNoShow: number;
  gamesUnavailable: number;
  teamGames: number;
  /** gamesPlayed / teamGames, 0-100. null when the team has played nothing. */
  participationPct: number | null;
  /**
   * (gamesPlayedForTeam + gamesAvailableNotSelected) / teamGames, 0-100.
   * A no-show is not availability: the player said yes and did not come.
   */
  availabilityPct: number | null;
  goals: number;
  cardPoints: number;
  /** Most recent first. */
  recentGames: PlayerGameResult[];
}

export interface PlayerStatsInput {
  player: Player;
  /** Team the participation figures are measured against (display team). */
  team: string;
  season: string;
  /** This player's Match Cards for the season. */
  cards: MatchCard[];
  matchesById: Map<string, Match>;
  /** Every availability exception in the season. */
  exceptions: Pick<AvailabilityException, "player" | "match" | "availabilityStatus">[];
  /** This player's standing availability rules. */
  rules?: AvailabilityRule[];
  /** How many recent results to return. */
  recentLimit?: number;
}

const DEFAULT_RECENT_LIMIT = 5;

/** A match counts towards season statistics once it has actually been played. */
function isCountableTeamGame(m: Match, team: string): boolean {
  if (isFriendly(m)) return false;
  if ((m.matchStatus || "") !== "Played") return false;
  return (m.homeTeam || "") === team || (m.awayTeam || "") === team;
}

function outcomeFor(goalsFor: number, goalsAgainst: number): GameOutcome {
  if (goalsFor > goalsAgainst) return "win";
  if (goalsFor < goalsAgainst) return "loss";
  return "draw";
}

function cardPointsFor(cards: string[]): number {
  return cards.reduce((sum, c) => sum + yellowPointsFor(c), 0);
}

/** Card values that parse to a real card; drops "[]" and malformed entries. */
function realCards(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((c): c is string => typeof c === "string" && parseCardValue(c) !== null);
}

/**
 * Pure season-statistics computation. Everything it needs is passed in so the
 * whole thing is testable without Airtable.
 */
export function computePlayerSeasonStats(input: PlayerStatsInput): PlayerSeasonStats {
  const { player, team, season, cards, matchesById, exceptions, rules = [] } = input;
  const recentLimit = input.recentLimit ?? DEFAULT_RECENT_LIMIT;

  // ── Appearances ──────────────────────────────────────────────────────
  // A Match Card IS the appearance record, so games played is counted from
  // cards rather than from selections.
  const seasonCards = cards.filter((c) => {
    if (c.season && c.season !== season) return false;
    return !isFriendly(matchForCard(c, matchesById));
  });

  let goals = 0;
  let cardPoints = 0;
  const results: PlayerGameResult[] = [];
  const cardedMatchIds = new Set<string>();
  const cardedDates = new Set<string>();

  for (const card of seasonCards) {
    goals += card.goals ?? 0;
    const cardValues = realCards(card.cards);
    cardPoints += cardPointsFor(cardValues);

    const match = matchForCard(card, matchesById);
    const matchId = linkId(card.match);
    const playedFor = card.team || "";
    if (matchId) cardedMatchIds.add(matchId);
    if (match?.matchDate) cardedDates.add(hkDateKey(match.matchDate));

    if (!match || !matchId) continue;
    // A result needs a played match with both scores and a resolvable side.
    if ((match.matchStatus || "") !== "Played") continue;
    const home = match.homeTeam || "";
    const away = match.awayTeam || "";
    const isHome = playedFor === home;
    const isAway = playedFor === away;
    if (!isHome && !isAway) continue;
    const homeScore = match.homeTeamScore;
    const awayScore = match.awayTeamScore;
    if (typeof homeScore !== "number" || typeof awayScore !== "number") continue;

    const goalsFor = isHome ? homeScore : awayScore;
    const goalsAgainst = isHome ? awayScore : homeScore;
    results.push({
      matchId,
      date: match.matchDate || "",
      team: playedFor,
      opponent: isHome ? away : home,
      isHome,
      goalsFor,
      goalsAgainst,
      outcome: outcomeFor(goalsFor, goalsAgainst),
      goals: card.goals ?? 0,
      cards: cardValues,
      cardPoints: cardPointsFor(cardValues),
    });
  }

  // ── Availability against the team's own fixtures ─────────────────────
  const teamGameIds = new Set<string>();
  for (const [id, m] of matchesById) {
    if ((m.season || season) !== season) continue;
    if (isCountableTeamGame(m, team)) teamGameIds.add(id);
  }

  const answerByMatch = new Map<string, string>();
  for (const exc of exceptions) {
    if (linkId(exc.player) !== player.id) continue;
    const matchId = linkId(exc.match);
    if (matchId) answerByMatch.set(matchId, exc.availabilityStatus || "");
  }

  // Each team game lands in exactly one bucket, in this order.
  let gamesPlayedForTeam = 0;
  let gamesUnavailable = 0;
  let gamesNoShow = 0;
  let gamesAvailableNotSelected = 0;
  for (const matchId of teamGameIds) {
    const m = matchesById.get(matchId)!;
    // 1. On the Match Card: they played, whatever else was recorded.
    if (cardedMatchIds.has(matchId)) {
      gamesPlayedForTeam++;
      continue;
    }
    // 2. Unavailable - resolved the same way as for selection, so a standing
    //    rule or Opt-In Only counts, not just an explicit answer. "Maybe" is
    //    not a refusal, so it counts as available.
    const date = hkDateKey(m.matchDate);
    const { status } = effectiveAvailability(
      answerByMatch.get(matchId),
      rules,
      { date, isPlayUp: false, isSupport: false },
      { optInOnly: player.optInOnly },
    );
    if (status === "Unavailable") {
      gamesUnavailable++;
      continue;
    }
    // 3. Available and picked, but not on the Match Card: a no-show. Unless
    //    they turned out for another side that day - then they were moved,
    //    not missing.
    const side = m.homeTeam === team ? m.selectedPlayersHome : m.selectedPlayersAway;
    if ((side ?? []).includes(player.id) && !cardedDates.has(date)) {
      gamesNoShow++;
      continue;
    }
    // 4. Available and not picked.
    gamesAvailableNotSelected++;
  }

  const teamGames = teamGameIds.size;
  const gamesPlayed = seasonCards.length;
  const pct = (n: number) => (teamGames === 0 ? null : Math.round((n / teamGames) * 100));

  results.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    season,
    team,
    gamesPlayed,
    gamesPlayedForTeam,
    gamesAvailableNotSelected,
    gamesNoShow,
    gamesUnavailable,
    teamGames,
    // Measured against the player's own team's fixtures. Appearances for
    // other teams (play-ups and support games) are included in gamesPlayed,
    // so a busy player can exceed 100%.
    participationPct: pct(gamesPlayed),
    availabilityPct: pct(gamesPlayedForTeam + gamesAvailableNotSelected),
    goals,
    cardPoints,
    recentGames: results.slice(0, recentLimit),
  };
}

/**
 * Season statistics for one player, read off the shared (cached) season
 * context so the stats view costs no extra Airtable reads.
 *
 * Participation is measured against the player's DISPLAY team (Selected Team
 * EOS -> SOS -> Registered), matching what the rest of the app shows them.
 */
export async function getPlayerSeasonStats(
  env: Env,
  playerId: string,
): Promise<PlayerSeasonStats & { playerName: string }> {
  const ref = await getReferenceData(env);
  const player = ref.players.find((p) => p.id === playerId);
  if (!player) throw new HttpError("Player record not found", 404);

  const season = currentSeason();
  const [ctx, rules] = await Promise.all([
    getSeasonContext(env, season),
    getRulesForPlayer(env, player.id),
  ]);

  const stats = computePlayerSeasonStats({
    player,
    team: selectedDisplayTeam(player) || player.registeredTeam || "",
    season,
    cards: ctx.matchCardsByPlayer.get(player.id) ?? [],
    matchesById: ctx.matchesById,
    exceptions: ctx.exceptionsRaw,
    rules,
  });

  return {
    ...stats,
    playerName: player.preferredName || player.givenNames || "Player",
  };
}
