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
 * Cache key: `season-index:<season>` (one minute, in this isolate; the raw
 * reads underneath it are shared through KV and live much longer).
 * Invalidated by: syncSquad (selections changed), setAvailability and
 * setMyAvailability (exceptions changed), and the Airtable webhook.
 */

import { airtableFindAll, escapeFormulaValue, linkId } from "./airtable";
import type { Env } from "./env";
import { getCached, getShared, rawReadTtl } from "./cache";
import { hkDateKey } from "../../shared/hkDateKey";
import { getExceptionsForSeasons, getReferenceData, UNRANKED_TEAM_RANK } from "./reference";
import { effectiveAvailability, getAllAvailabilityRules, indexRulesByPlayer } from "./availabilityRules";
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
const SEASON_READ_TTL_MS = 10 * 60 * 1000;

// Always the short TTL, never the webhook-backed six hours: these records
// carry squad selections, which the eligibility engine's same-day checks
// read. See SCHEDULED_MATCHES_TTL_MS in fixtures.ts for why.
export async function getAllMatches(env: Env, season: string): Promise<Match[]> {
  return getShared<Match[]>(env, `all-matches:${season}`, async () => {
    const formula = season ? `{${MATCHES_FIELDS.season}}="${escapeFormulaValue(season)}"` : undefined;
    const records = await airtableFindAll(env, TABLES.match, formula);
    return records.map(mapMatch);
  }, SEASON_READ_TTL_MS);
}

/**
 * A season's Match Cards. A Match Card is an appearance record, not just a
 * disciplinary one, so a full season is two-thousand-odd rows - twenty-plus
 * sequential pages under Airtable's rate limit, and the single largest cost
 * of a cold season index.
 *
 * `cardedOnly` narrows that to appearances that actually carry a card. The
 * previous season is only ever read to carry an outstanding suspension
 * forward (suspension.ts), and an appearance with no card contributes
 * nothing to that - so last season shrinks from twenty pages to one.
 */
async function getMatchCardsForSeason(
  env: Env,
  season: string,
  opts: { cardedOnly?: boolean } = {},
): Promise<MatchCard[]> {
  const key = opts.cardedOnly ? `match-cards:${season}:carded` : `match-cards:${season}`;
  return getShared<MatchCard[]>(env, key, async () => {
    const clauses: string[] = [];
    if (season) clauses.push(`{${MATCHCARDS_FIELDS.season}}="${escapeFormulaValue(season)}"`);
    if (opts.cardedOnly) clauses.push(`{${MATCHCARDS_FIELDS.cards}}!=""`);
    const formula = clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : `AND(${clauses.join(",")})`;
    const records = await airtableFindAll(env, TABLES.matchCard, formula);
    return records.map(mapMatchCard);
  }, rawReadTtl(env, SEASON_READ_TTL_MS));
}

export function getSameDayMatches(allMatches: Match[], targetDate: string): Match[] {
  const target = hkDateKey(targetDate);
  return allMatches.filter((m) => hkDateKey(m.matchDate) === target);
}

export function previousSeason(season: string): string | null {
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

/**
 * The derived indexes live in this isolate only (Maps and Sets do not
 * survive KV's JSON round trip), so their lifetime is short: every input is
 * a shared raw read, and rebuilding from KV costs a few parallel gets plus
 * some CPU. A longer lifetime here is what let one isolate keep showing
 * selections another isolate's write had already replaced.
 */
const SEASON_INDEX_TTL_MS = 60 * 1000;

export async function getSeasonContext(env: Env, season: string): Promise<SeasonContext> {
  const { data } = await getCached<SeasonContext>(`season-index:${season}`, async () => {
    const prevSeason = previousSeason(season);
    const [exceptionsRaw, matchCards, allMatches, prevMatchCards, prevMatches, ref] = await Promise.all([
      getExceptionsForSeasons(env, [season]),
      getMatchCardsForSeason(env, season),
      getAllMatches(env, season),
      prevSeason ? getMatchCardsForSeason(env, prevSeason, { cardedOnly: true }) : Promise.resolve([] as MatchCard[]),
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
  }, SEASON_INDEX_TTL_MS);
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

  // Who has said no to the day's other fixtures. The season index carries
  // the explicit Unavailable answers; standing preferences are added here,
  // because they depend on how each fixture relates to the player (a
  // play-up, a support game, a midweek date) and the season index does not
  // know that. Without them a goalkeeper whose preference says "no
  // play-ups" was advertised to every higher team playing that day.
  //
  // An explicit answer of any kind wins over a preference, exactly as it
  // does everywhere else the two meet.
  const unavailablePlayerMatchKeys = new Set(season.unavailablePlayerMatchKeys);
  const rulesByPlayer = indexRulesByPlayer(await getAllAvailabilityRules(env));
  // Everyone whose default is not simply "Available": someone with a standing
  // rule, and someone a coach has set to Opt-In Only. The latter need not have
  // a single rule to their name, so iterating the rule index alone would have
  // advertised them to every higher team playing that day - the exact opposite
  // of what the flag is for.
  const nonDefaultPlayerIds = new Set<string>([
    ...rulesByPlayer.keys(),
    ...allPlayers.filter((p) => p.optInOnly).map((p) => p.id),
  ]);
  if (nonDefaultPlayerIds.size > 0 && sameDayFixtures.length > 0) {
    const answered = new Set(season.exceptionIndex.map((e) => `${e.playerId}:${e.matchId}`));
    const dateByMatch = new Map(sameDayMatches.map((m) => [m.id, hkDateKey(m.matchDate)]));
    for (const playerId of nonDefaultPlayerIds) {
      const player = playersById.get(playerId);
      if (!player) continue;
      const rules = rulesByPlayer.get(playerId) ?? [];
      const playerRank = teamRankMap[player.registeredTeam || ""] ?? UNRANKED_TEAM_RANK;
      for (const fixture of sameDayFixtures) {
        const key = `${playerId}:${fixture.matchId}`;
        if (answered.has(key)) continue;
        const fixtureRank = teamRankMap[fixture.teamName] ?? UNRANKED_TEAM_RANK;
        const { status } = effectiveAvailability("", rules, {
          date: dateByMatch.get(fixture.matchId) || "",
          isPlayUp: fixtureRank < playerRank,
          isSupport: fixtureRank > playerRank,
        }, { optInOnly: player.optInOnly });
        if (status === "Unavailable") unavailablePlayerMatchKeys.add(key);
      }
    }
  }

  const ctx: EvaluationContext = {
    teamMap,
    rankMap: teamRankMap,
    targetTeam,
    sameDayFixtures,
    selectionsByPlayer: season.selectionsByPlayer,
    sameDaySelectionsByTeam,
    unavailablePlayerMatchKeys,
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

