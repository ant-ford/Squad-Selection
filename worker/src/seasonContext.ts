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
 * setMyAvailability (exceptions changed), the Men's Convenor's suspension
 * writes (discipline.ts), and People writes (invalidation.ts).
 */

import { linkId } from "../../shared/airtableValueUtils";
import { matches } from "./data/matches";
import { matchCards } from "./data/matchCards";
import type { Env } from "./env";
import { getCached, getShared } from "./cache";
import { hkDateKey } from "../../shared/hkDateKey";
import { getExceptionsForSeasons, getReferenceData, UNRANKED_TEAM_RANK } from "./reference";
import { effectiveAvailability, getAllAvailabilityRules, indexRulesByPlayer } from "./availabilityRules";
import {
  computeSuspensionStates,
  manualSuspensionStates,
  type CardSuspensionState,
  type ManualSuspension,
  type ManualSuspensionState,
} from "./suspension";
import { backendFor } from "./data/backend";
import { db, SupabaseError } from "./data/supabase";
import {
  computeCompletedLeagueMatchCounts,
  type EvaluationContext,
  type VirtualSelection,
} from "./eligibility";
import type {
  Match,
  MatchCard,
  Player,
  Team,
  AvailabilityException,
} from "../../shared/schema/domainTypes";

// ── Season-scoped fetches ───────────────────────────────────────────────
const SEASON_READ_TTL_MS = 10 * 60 * 1000;

// Always the short TTL, never hours: these records
// carry squad selections, which the eligibility engine's same-day checks
// read. See SCHEDULED_MATCHES_TTL_MS in fixtures.ts for why.
export async function getAllMatches(env: Env, season: string): Promise<Match[]> {
  return getShared<Match[]>(env, `all-matches:${season}`, async () => {
    return matches(env).listForSeason(season);
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
export async function getMatchCardsForSeason(
  env: Env,
  season: string,
  opts: { cardedOnly?: boolean } = {},
): Promise<MatchCard[]> {
  const key = opts.cardedOnly ? `match-cards:${season}:carded` : `match-cards:${season}`;
  return getShared<MatchCard[]>(env, key, async () => {
    return matchCards(env).listForSeason(season, opts);
  }, SEASON_READ_TTL_MS);
}

/**
 * Matches grouped by Hong Kong day, built on first use and kept for as long
 * as the array itself. The season context's `allMatches` lives for the
 * context's lifetime, so one index serves every candidate fixture (and every
 * request) that context answers - rather than one hkDateKey per match per
 * fixture, which was most of /api/my-fixtures' CPU with a full season loaded.
 *
 * The length check rebuilds the index if the array has been grown or shrunk
 * since; nothing in the worker mutates a season's matches after reading them.
 */
const dayIndexes = new WeakMap<readonly Match[], { length: number; byDay: Map<string, Match[]> }>();

function dayIndexFor(allMatches: readonly Match[]): Map<string, Match[]> {
  const cached = dayIndexes.get(allMatches);
  if (cached && cached.length === allMatches.length) return cached.byDay;
  const byDay = new Map<string, Match[]>();
  for (const m of allMatches) {
    const day = hkDateKey(m.matchDate);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(m);
    else byDay.set(day, [m]);
  }
  dayIndexes.set(allMatches, { length: allMatches.length, byDay });
  return byDay;
}

/** Every match on targetDate's Hong Kong day, in `allMatches` order. A fresh array each call. */
export function getSameDayMatches(allMatches: readonly Match[], targetDate: string): Match[] {
  const bucket = dayIndexFor(allMatches).get(hkDateKey(targetDate));
  return bucket ? bucket.slice() : [];
}

/** Cache key of the open manual suspensions; discipline.ts drops it on every write. */
export const MANUAL_SUSPENSIONS_KEY = "manual-suspensions";

/**
 * The Men's Convenor's open suspensions (public.suspensions, cleared_at
 * null): a handful of rows at most. Supabase backend only - on Airtable
 * the table does not exist and the old People flags are all there is.
 */
export async function getOpenManualSuspensions(env: Env): Promise<ManualSuspension[]> {
  if (backendFor(env, "people") !== "supabase") return [];
  return getShared<ManualSuspension[]>(env, MANUAL_SUSPENSIONS_KEY, async () => {
    type Row = { id: string; player: string; matches: number | null; from_date: string; serving_team: string };
    const rows = await db(env)
      .select<Row>("api_suspensions", "select=id,player,matches,from_date,serving_team&cleared_at=is.null")
      .catch((err: unknown): Row[] => {
        // Only a database without the migration yet (PGRST205: no such
        // view) reads as "none": with no table there are none. Anything
        // else fails the read, as the other reads here do - never "none".
        if (err instanceof SupabaseError && err.code === "PGRST205") {
          console.error("api_suspensions missing: apply 20261007010203_suspensions.sql");
          return [];
        }
        throw err;
      });
    return rows.map((r) => ({
      id: r.id,
      player: r.player,
      matches: r.matches,
      fromDate: r.from_date,
      servingTeam: r.serving_team,
    }));
  }, SEASON_READ_TTL_MS);
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
  /** Matches with at least one Match Card. One without (e.g. a hand-entered friendly) records no attendance. */
  matchIdsWithCards: Set<string>;
  completedLeagueMatchesByTeam: Map<string, number>;
  virtualSelections: VirtualSelection[];
  selectionsByPlayer: Map<string, Set<string>>;
  selectionsByMatch: Map<string, VirtualSelection[]>;
  previousSeason: string | null;
  previousCards: MatchCard[];
  previousMatches: Match[];
  /** Automatic card-suspension state, keyed by player id. */
  suspensionByPlayer: Map<string, CardSuspensionState>;
  /** The Men's Convenor's open suspensions, served or not, keyed by player id. */
  manualSuspensionByPlayer: Map<string, ManualSuspensionState>;
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
    const [exceptionsRaw, matchCards, allMatches, prevMatchCards, prevMatches, ref, openManual] = await Promise.all([
      getExceptionsForSeasons(env, [season]),
      getMatchCardsForSeason(env, season),
      getAllMatches(env, season),
      prevSeason ? getMatchCardsForSeason(env, prevSeason, { cardedOnly: true }) : Promise.resolve([] as MatchCard[]),
      prevSeason ? getAllMatches(env, prevSeason) : Promise.resolve([] as Match[]),
      getReferenceData(env),
      getOpenManualSuspensions(env),
    ]);
    const matchesById = new Map<string, Match>(allMatches.map((m) => [m.id, m]));
    const matchCardsByPlayer = new Map<string, MatchCard[]>();
    const matchIdsWithCards = new Set<string>();
    for (const card of matchCards) {
      const cardMatchId = linkId(card.match);
      if (cardMatchId) matchIdsWithCards.add(cardMatchId);
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
    // The Men's Convenor's suspensions, counted against both seasons' fixtures.
    const manualSuspensionByPlayer = manualSuspensionStates(openManual, combinedMatchesById.values());

    return {
      exceptionsRaw,
      exceptionIndex,
      unavailablePlayerMatchKeys,
      matchCards,
      allMatches,
      matchesById,
      matchCardsByPlayer,
      matchIdsWithCards,
      completedLeagueMatchesByTeam,
      virtualSelections,
      selectionsByPlayer,
      selectionsByMatch,
      previousSeason: prevSeason,
      previousCards: prevMatchCards,
      previousMatches: prevMatches,
      suspensionByPlayer,
      manualSuspensionByPlayer,
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
    // Every same-day fixture shares the target's Hong Kong day.
    const sameDay = hkDateKey(matchDate);
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
          date: sameDay,
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
    manualSuspensionByPlayer: season.manualSuspensionByPlayer,
  };
  return { ctx, exceptionsRaw: season.exceptionsRaw };
}

