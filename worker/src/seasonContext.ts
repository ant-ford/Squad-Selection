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
 * Cache key: `season-index:<season>@<versions>` (cache.ts getVersioned):
 * the cache versions of every table it is built from, so any write to them
 * (the Worker's or hkha-sync's) means a rebuild on the next request.
 */

import { linkId } from "../../shared/airtableValueUtils";
import { matches } from "./data/matches";
import { matchCards } from "./data/matchCards";
import type { Env } from "./env";
import { getVersioned } from "./cache";
import { hkDateKey } from "../../shared/hkDateKey";
import { getExceptionsForSeasons, getReferenceData, UNRANKED_TEAM_RANK } from "./reference";
import { effectiveAvailability, getAllAvailabilityRules, indexRulesByPlayer } from "./availabilityRules";
import { computeSuspensionStates, type CardSuspensionState } from "./suspension";
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
  AvailabilityRule,
} from "../../shared/schema/domainTypes";

// ── Season-scoped fetches ───────────────────────────────────────────────
const SEASON_READ_TTL_MS = 10 * 60 * 1000;

// These records carry squad selections, which the eligibility engine's
// same-day checks read: kept under the matches and match_selections
// versions, so a saved squad shows everywhere on the next request.
export async function getAllMatches(env: Env, season: string): Promise<Match[]> {
  return getVersioned<Match[]>(env, `all-matches:${season}`, ["matches", "match_selections"], async () => {
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
  return getVersioned<MatchCard[]>(env, key, ["match_cards", "matches"], async () => {
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
  /** `player:match` for every explicit answer, whatever it says. */
  answeredPlayerMatchKeys: Set<string>;
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
}

/**
 * Every table the season index is built from (through the reads it calls):
 * its cache versions are its key, so a write to any of them, from any
 * isolate or hkha-sync, makes the next request rebuild it.
 */
export const SEASON_INDEX_DEPS = [
  "matches", "match_selections", "match_cards", "availability_exceptions", "people", "teams", "team_people",
] as const;

export async function getSeasonContext(env: Env, season: string): Promise<SeasonContext> {
  return getVersioned<SeasonContext>(env, `season-index:${season}`, SEASON_INDEX_DEPS, async () => {
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
    const answeredPlayerMatchKeys = new Set(exceptionIndex.map((e) => `${e.playerId}:${e.matchId}`));

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
      answeredPlayerMatchKeys,
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
    };
  });
}

// ── Per-request inputs, shared across fixtures ──────────────────────────
// buildEvaluationContext runs once per candidate fixture - well over a
// hundred times for one lower-team player's /api/my-fixtures - and the
// pieces below depend only on the player list and the rules, which come
// from the cache and are the same array for every one of those calls. They
// are built once per array and kept, through WeakMaps, as long as the array.
// The length checks rebuild if an array has been grown or shrunk since;
// nothing in the worker changes these lists after reading them.

const playersByIdCache = new WeakMap<readonly Player[], { length: number; byId: Map<string, Player> }>();

function playersByIdFor(allPlayers: readonly Player[]): Map<string, Player> {
  const cached = playersByIdCache.get(allPlayers);
  if (cached && cached.length === allPlayers.length) return cached.byId;
  const byId = new Map<string, Player>();
  for (const p of allPlayers) byId.set(p.id, p);
  playersByIdCache.set(allPlayers, { length: allPlayers.length, byId });
  return byId;
}

/**
 * Everyone whose default is not simply "Available": someone with a standing
 * rule, and someone a coach has set to Opt-In Only. The latter need not have
 * a single rule to their name, so iterating the rule index alone would have
 * advertised them to every higher team playing that day - the exact opposite
 * of what the flag is for.
 */
type NonDefaultPlayers = { player: Player; rules: AvailabilityRule[] }[];

const nonDefaultCache = new WeakMap<
  readonly AvailabilityRule[],
  WeakMap<readonly Player[], { length: number; players: NonDefaultPlayers }>
>();

function nonDefaultPlayersFor(
  allRules: readonly AvailabilityRule[],
  allPlayers: readonly Player[],
  playersById: Map<string, Player>,
): NonDefaultPlayers {
  let byPlayers = nonDefaultCache.get(allRules);
  if (!byPlayers) nonDefaultCache.set(allRules, (byPlayers = new WeakMap()));
  const cached = byPlayers.get(allPlayers);
  if (cached && cached.length === allPlayers.length) return cached.players;

  const rulesByPlayer = indexRulesByPlayer(allRules as AvailabilityRule[]);
  const ids = new Set<string>([
    ...rulesByPlayer.keys(),
    ...allPlayers.filter((p) => p.optInOnly).map((p) => p.id),
  ]);
  const players: NonDefaultPlayers = [];
  for (const id of ids) {
    const player = playersById.get(id);
    if (player) players.push({ player, rules: rulesByPlayer.get(id) ?? [] });
  }
  byPlayers.set(allPlayers, { length: allPlayers.length, players });
  return players;
}

/**
 * For one HKFC side of one match: the `player:match` keys of everyone whose
 * standing preference makes them Unavailable for it and who has not answered
 * it explicitly. It does not depend on the fixture being evaluated, so every
 * candidate on the same day - and every request - reuses it.
 *
 * Kept per season context, for one rule/player list and one rank map at a
 * time (the inputs besides the fixture itself); a new one of either starts
 * the map again.
 */
const preferenceUnavailableCache = new WeakMap<
  SeasonContext,
  { players: NonDefaultPlayers; rankMap: Record<string, number>; byFixture: Map<string, string[]> }
>();

function preferenceUnavailableFor(
  season: SeasonContext,
  players: NonDefaultPlayers,
  rankMap: Record<string, number>,
  fixture: { matchId: string; teamName: string },
  day: string,
): string[] {
  let slot = preferenceUnavailableCache.get(season);
  if (!slot || slot.players !== players || slot.rankMap !== rankMap) {
    slot = { players, rankMap, byFixture: new Map() };
    preferenceUnavailableCache.set(season, slot);
  }
  const fixtureKey = `${fixture.matchId}|${fixture.teamName}`;
  let keys = slot.byFixture.get(fixtureKey);
  if (keys) return keys;
  keys = [];
  const fixtureRank = rankMap[fixture.teamName] ?? UNRANKED_TEAM_RANK;
  for (const { player, rules } of players) {
    const key = `${player.id}:${fixture.matchId}`;
    if (season.answeredPlayerMatchKeys.has(key)) continue;
    const playerRank = rankMap[player.registeredTeam || ""] ?? UNRANKED_TEAM_RANK;
    const { status } = effectiveAvailability("", rules, {
      date: day,
      isPlayUp: fixtureRank < playerRank,
      isSupport: fixtureRank > playerRank,
    }, { optInOnly: player.optInOnly });
    if (status === "Unavailable") keys.push(key);
  }
  slot.byFixture.set(fixtureKey, keys);
  return keys;
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
  const playersById = playersByIdFor(allPlayers);

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
  //
  // The season's own set is used as it is until a preference adds to it,
  // and copied only then. Nothing downstream writes to it.
  let unavailablePlayerMatchKeys = season.unavailablePlayerMatchKeys;
  const nonDefault = nonDefaultPlayersFor(await getAllAvailabilityRules(env), allPlayers, playersById);
  if (nonDefault.length > 0 && sameDayFixtures.length > 0) {
    // Every same-day fixture shares the target's Hong Kong day.
    const sameDay = hkDateKey(matchDate);
    for (const fixture of sameDayFixtures) {
      const keys = preferenceUnavailableFor(season, nonDefault, teamRankMap, fixture, sameDay);
      if (keys.length === 0) continue;
      if (unavailablePlayerMatchKeys === season.unavailablePlayerMatchKeys) {
        unavailablePlayerMatchKeys = new Set(unavailablePlayerMatchKeys);
      }
      for (const key of keys) unavailablePlayerMatchKeys.add(key);
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

