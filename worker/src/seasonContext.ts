/**
 * Season-level evaluation context (extracted from squad.ts so any module -
 * fixtures, dashboard, registration - can reuse the eligibility context
 * without circular imports).
 *
 * Everything that depends only on the SEASON - exceptions, match cards, the
 * full fixture list, play-up indexes, completed-league-match counts and the
 * virtual-selection indexes - is built once per season and shared by every
 * match+side opened that season.
 *
 * Cache key: `season-index:<season>` (10 minutes).
 * Invalidated by: syncSquad (selections changed), setAvailability and
 * setMyAvailability (exceptions changed).
 */

import { airtableFindAll, escapeFormulaValue, linkId } from "./airtable";
import type { Env } from "./env";
import { getCached } from "./cache";
import { hkDateKey } from "../../shared/hkDateKey";
import { getExceptionsForSeasons, getReferenceData } from "./reference";
import { computeSuspensionStates, type CardSuspensionState } from "./suspension";
import {
  computeCompletedLeagueMatchCounts,
  type EvaluationContext,
  type VirtualSelection,
} from "./eligibility";
import { TABLES } from "../../shared/schema/tableNames";
import {
  AVAILABILITYEXCEPTIONS_FIELDS,
  MATCHES_FIELDS,
  MATCHCARDS_FIELDS,
} from "../../shared/schema/fieldMaps";
import { mapMatch } from "../../shared/mappers/matchMapper";
import { mapMatchCard } from "../../shared/mappers/matchCardMapper";
import type {
  Match,
  MatchCard,
  Player,
  Team,
  AvailabilityException,
} from "../../shared/schema/domainTypes";

// ── Season-scoped fetches ───────────────────────────────────────────────
export async function getAllMatches(env: Env, season: string): Promise<Match[]> {
  const { data } = await getCached<Match[]>(`all-matches:${season}`, async () => {
    const formula = season ? `{${MATCHES_FIELDS.season}}="${escapeFormulaValue(season)}"` : undefined;
    const records = await airtableFindAll(env, TABLES.match, formula);
    return records.map(mapMatch);
  }, 10 * 60 * 1000);
  return data;
}

async function getMatchCardsForSeason(env: Env, season: string): Promise<MatchCard[]> {
  const { data } = await getCached<MatchCard[]>(`match-cards:${season}`, async () => {
    const formula = season ? `{${MATCHCARDS_FIELDS.season}}="${escapeFormulaValue(season)}"` : undefined;
    const records = await airtableFindAll(env, TABLES.matchCard, formula);
    return records.map(mapMatchCard);
  }, 10 * 60 * 1000);
  return data;
}

export function getSameDayMatches(allMatches: Match[], targetDate: string): Match[] {
  const target = hkDateKey(targetDate);
  return allMatches.filter((m) => hkDateKey(m.matchDate) === target);
}

function previousSeason(season: string): string | null {
  const m = season.match(/^(\d{4})-(\d{4})$/);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) ? `${y - 1}-${y}` : null;
}

/** HKHA season boundary: starts 1 July, Asia/Hong_Kong. */
export function currentSeason(d = new Date()): string {
  const [yearStr, monthStr] = hkDateKey(d.toISOString()).split("-");
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-12
  const y = month >= 7 ? year : year - 1;
  return `${y}-${y + 1}`;
}

// ── Season-level evaluation context (see file header) ───────────────────
export interface SeasonContext {
  exceptionsRaw: AvailabilityException[];
  exceptionIndex: { playerId: string; matchId: string; status: string }[];
  unavailablePlayerMatchKeys: Set<string>;
  matchCards: MatchCard[];
  allMatches: Match[];
  matchesById: Map<string, Match>;
  matchCardsByPlayer: Map<string, MatchCard[]>;
  completedLeagueMatchesByTeam: Map<string, number>;
  virtualSelections: VirtualSelection[];
  selectionsByPlayer: Map<string, Set<string>>;
  selectionsByMatch: Map<string, VirtualSelection[]>;
  previousSeason: string | null;
  previousCards: MatchCard[];
  previousMatches: Match[];
  /** Automatic card-suspension state, keyed by player id. */
  suspensionByPlayer: Map<string, CardSuspensionState>;
}

export async function getSeasonContext(env: Env, season: string): Promise<SeasonContext> {
  const { data } = await getCached<SeasonContext>(`season-index:${season}`, async () => {
    const prevSeason = previousSeason(season);
    const [exceptionsRaw, matchCards, allMatches, prevMatchCards, prevMatches, ref] = await Promise.all([
      getExceptionsForSeasons(env, [season]),
      getMatchCardsForSeason(env, season),
      getAllMatches(env, season),
      prevSeason ? getMatchCardsForSeason(env, prevSeason) : Promise.resolve([] as MatchCard[]),
      prevSeason ? getAllMatches(env, prevSeason) : Promise.resolve([] as Match[]),
      getReferenceData(env),
    ]);
    const matchesById = new Map<string, Match>(allMatches.map((m) => [m.id, m]));
    const matchCardsByPlayer = new Map<string, MatchCard[]>();
    for (const card of matchCards) {
      const playerId = linkId(card.player);
      if (!playerId) continue;
      const cards = matchCardsByPlayer.get(playerId) || [];
      cards.push(card);
      matchCardsByPlayer.set(playerId, cards);
    }
    const completedLeagueMatchesByTeam = computeCompletedLeagueMatchCounts({ matchCards, matchesById });
    // Virtual selections + per-match and per-player indexes, built once.
    const virtualSelections: VirtualSelection[] = [];
    const selectionsByMatch = new Map<string, VirtualSelection[]>();
    for (const m of allMatches) {
      const forMatch: VirtualSelection[] = [];
      for (const pId of m.selectedPlayersHome || []) {
        const s: VirtualSelection = { player: [pId], match: [m.id], team: m.homeTeam };
        virtualSelections.push(s);
        forMatch.push(s);
      }
      for (const pId of m.selectedPlayersAway || []) {
        const s: VirtualSelection = { player: [pId], match: [m.id], team: m.awayTeam };
        virtualSelections.push(s);
        forMatch.push(s);
      }
      if (forMatch.length > 0) selectionsByMatch.set(m.id, forMatch);
    }
    const selectionsByPlayer = new Map<string, Set<string>>();
    for (const selection of virtualSelections) {
      const playerId = linkId(selection.player);
      const selectedMatchId = linkId(selection.match);
      if (!playerId || !selectedMatchId || !selection.team) continue;
      const playerSelections = selectionsByPlayer.get(playerId) || new Set<string>();
      playerSelections.add(`${selectedMatchId}:${selection.team}`);
      selectionsByPlayer.set(playerId, playerSelections);
    }
    const exceptionIndex = exceptionsRaw.map((e) => ({
      playerId: linkId(e.player) || "",
      matchId: linkId(e.match) || "",
      status: e.availabilityStatus || "Available",
    }));
    const unavailablePlayerMatchKeys = new Set(
      exceptionIndex.filter((item) => item.status === "Unavailable").map((item) => `${item.playerId}:${item.matchId}`)
    );

    // Automatic card-suspension state, computed once per cache lifetime
    // rather than once per candidate side (buildEvaluationContext is called
    // per fixture+team, sometimes several times for one request).
    const registeredTeamByPlayer = new Map<string, string>();
    for (const p of ref.players) if (p.registeredTeam) registeredTeamByPlayer.set(p.id, p.registeredTeam);
    const combinedMatchesById = new Map<string, Match>([...prevMatches, ...allMatches].map((m) => [m.id, m]));
    const suspensionByPlayer = computeSuspensionStates({
      currentCards: matchCards,
      previousCards: prevMatchCards,
      matchesById: combinedMatchesById,
      currentSeason: season,
      previousSeason: prevSeason,
      registeredTeamByPlayer,
    });

    return {
      exceptionsRaw,
      exceptionIndex,
      unavailablePlayerMatchKeys,
      matchCards,
      allMatches,
      matchesById,
      matchCardsByPlayer,
      completedLeagueMatchesByTeam,
      virtualSelections,
      selectionsByPlayer,
      selectionsByMatch,
      previousSeason: prevSeason,
      previousCards: prevMatchCards,
      previousMatches: prevMatches,
      suspensionByPlayer,
    };
  }, 10 * 60 * 1000);
  return data;
}

export async function buildEvaluationContext(
  env: Env,
  match: Match,
  teamRankMap: Record<string, number>,
  teamMap: Map<string, Team>,
  allPlayers: Player[],
  targetTeam: string,
): Promise<{ ctx: EvaluationContext; exceptionsRaw: AvailabilityException[] }> {
  const currentSeason = match.season || "";
  const matchDate = match.matchDate || "";
  const season = await getSeasonContext(env, currentSeason);
  const playersById = new Map<string, Player>();
  for (const p of allPlayers) playersById.set(p.id, p);

  // Same-day slice (excludes the target match).
  const sameDayMatches = getSameDayMatches(season.allMatches, matchDate).filter((m) => m.id !== match.id);
  const sameDayFixtures = sameDayMatches.flatMap((item) => {
    const fixtures: { matchId: string; teamName: string }[] = [];
    if (teamRankMap[item.homeTeam || ""] !== undefined) fixtures.push({ matchId: item.id, teamName: item.homeTeam });
    if (teamRankMap[item.awayTeam || ""] !== undefined) fixtures.push({ matchId: item.id, teamName: item.awayTeam });
    return fixtures;
  });

  // Same-day team-selection index, assembled only from the day's matches.
  const sameDaySelectionsByTeam = new Map<string, Set<string>>();
  for (const sdm of sameDayMatches) {
    const selections = season.selectionsByMatch.get(sdm.id);
    if (!selections) continue;
    for (const selection of selections) {
      const playerId = linkId(selection.player);
      if (!playerId || !selection.team) continue;
      const selectedPlayers = sameDaySelectionsByTeam.get(selection.team) || new Set<string>();
      selectedPlayers.add(playerId);
      sameDaySelectionsByTeam.set(selection.team, selectedPlayers);
    }
  }

  const ctx: EvaluationContext = {
    teamMap,
    rankMap: teamRankMap,
    targetTeam,
    sameDayFixtures,
    selectionsByPlayer: season.selectionsByPlayer,
    sameDaySelectionsByTeam,
    unavailablePlayerMatchKeys: season.unavailablePlayerMatchKeys,
    matchCards: season.matchCards,
    matchCardsByPlayer: season.matchCardsByPlayer,
    matchesById: season.matchesById,
    currentSeason,
    playersById,
    completedLeagueMatchesByTeam: season.completedLeagueMatchesByTeam,
    suspensionByPlayer: season.suspensionByPlayer,
  };
  return { ctx, exceptionsRaw: season.exceptionsRaw };
}

