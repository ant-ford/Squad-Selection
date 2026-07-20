import { Env, airtableFindAll, airtableFindById, airtableUpdate, escapeFormulaValue, linkId } from "./airtable";
import { getCached, invalidateCache, invalidateCachePrefix } from "../../src/lib/cache";
import { getReferenceData, getExceptionsForSeasons } from "./reference";
import { evaluatePlayerEligibility, computeCompletedLeagueMatchCounts, type EvaluationContext, type VirtualSelection } from "./eligibility";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { AVAILABILITYEXCEPTIONS_FIELDS, MATCHCARDS_FIELDS, MATCHES_FIELDS } from "../../src/generated/fieldMaps";
import { mapMatch } from "../../src/mappers/matchMapper";
import { mapMatchCard } from "../../src/mappers/matchCardMapper";
import type { Match, Player, MatchCard, Team, AvailabilityException } from "../../src/generated/domainTypes";
import { ABILITY_RANK } from "./abilityRank";

type MatchSide = "home" | "away";

// ── Cached match-record fetch (Performance Pass #1) ─────────────────────
//
// Short-TTL isolate cache for the raw match record. Only READ endpoints use
// it (getPlayersForMatch, getSquadForMatch). Every write path reads the
// record fresh from Airtable so no merge ever operates on stale data, and
// syncSquad invalidates `match:${matchId}` immediately after each write —
// so a coach can never be served stale selections post-update.
const MATCH_RECORD_TTL_MS = 30 * 1000;

async function getMatchRecord(env: Env, matchId: string): Promise<any> {
  const { data } = await getCached<any>(`match:${matchId}`, async () => {
    const rec = await airtableFindById(env, TABLES.match, matchId);
    if (!rec) throw new HttpError("Match not found", 404);
    return rec;
  }, MATCH_RECORD_TTL_MS);
  return data;
}

// ── HKFC side resolution (unchanged) ────────────────────────────────────

function resolveHkfcSide(match: Match, rankMap: Record<string, number>, side?: MatchSide): MatchSide {
  const home = match.homeTeam || "";
  const away = match.awayTeam || "";
  if (side === "home" && rankMap[home] !== undefined) return "home";
  if (side === "away" && rankMap[away] !== undefined) return "away";
  if (rankMap[home] !== undefined && rankMap[away] === undefined) return "home";
  if (rankMap[away] !== undefined && rankMap[home] === undefined) return "away";
  if (rankMap[home] !== undefined && rankMap[away] !== undefined) return side ?? "home";
  // Fallback for derby/edge cases: trust the URL side or default home
  if (side) return side;
  return "home";
}

function hkfcTeamName(match: Match, rankMap: Record<string, number>, side?: MatchSide): string {
  return resolveHkfcSide(match, rankMap, side) === "home" ? match.homeTeam || "" : match.awayTeam || "";
}

function getSelectedPlayerIds(match: Match, rankMap: Record<string, number>, side?: MatchSide): string[] {
  return resolveHkfcSide(match, rankMap, side) === "home" ? match.selectedPlayersHome || [] : match.selectedPlayersAway || [];
}

function getSelectionFieldName(match: Match, rankMap: Record<string, number>, side?: MatchSide): string {
  return resolveHkfcSide(match, rankMap, side) === "home" ? MATCHES_FIELDS.selectedPlayersHome : MATCHES_FIELDS.selectedPlayersAway;
}

// ── Season-scoped fetches (unchanged cache keys) ────────────────────────

async function getAllMatches(env: Env, season: string): Promise<Match[]> {
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

function getSameDayMatches(allMatches: Match[], targetDate: string): Match[] {
  const norm = (d: string) => d.split("T")[0];
  const target = norm(targetDate);
  return allMatches.filter((m) => norm(m.matchDate) === target);
}

// ── Season-level evaluation context (Performance Pass #3) ───────────────
//
// Everything that depends only on the SEASON — exceptions, match cards, the
// full fixture list, play-up indexes, completed-league-match counts and the
// virtual-selection indexes — is built once per season and shared by every
// match+side opened that season. Opening 6 fixtures no longer rebuilds the
// same indexes 6 (or 12, with sides) times.
//
// Per-match work is reduced to slicing the same-day window out of these
// pre-built indexes.
//
// Cache key: `season-index:${season}` (10 minutes).
// Invalidated by: syncSquad (selections changed), setAvailability and
// setMyAvailability (exceptions changed).

interface SeasonContext {
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
}

async function getSeasonContext(env: Env, season: string): Promise<SeasonContext> {
  const { data } = await getCached<SeasonContext>(`season-index:${season}`, async () => {
    const [exceptionsRaw, matchCards, allMatches] = await Promise.all([
      getExceptionsForSeasons(env, [season]),
      getMatchCardsForSeason(env, season),
      getAllMatches(env, season),
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
    };
  }, 10 * 60 * 1000);
  return data;
}

async function buildEvaluationContext(
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

  // Same-day slice (excludes the target match) — identical semantics to the
  // previous full-list filter, now read from the shared season context.
  const sameDayMatches = getSameDayMatches(season.allMatches, matchDate).filter((m) => m.id !== match.id);

  const sameDayFixtures = sameDayMatches.flatMap((item) => {
    const fixtures: { matchId: string; teamName: string }[] = [];
    if (teamRankMap[item.homeTeam || ""] !== undefined) fixtures.push({ matchId: item.id, teamName: item.homeTeam });
    if (teamRankMap[item.awayTeam || ""] !== undefined) fixtures.push({ matchId: item.id, teamName: item.awayTeam });
    return fixtures;
  });

  // Same-day team-selection index, assembled only from the day's matches
  // using the pre-built per-match selection map.
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
    sameDayMatches,
    sameDayFixtures,
    allSelections: season.virtualSelections,
    selectionsByPlayer: season.selectionsByPlayer,
    sameDaySelectionsByTeam,
    allExceptions: season.exceptionIndex,
    unavailablePlayerMatchKeys: season.unavailablePlayerMatchKeys,
    matchCards: season.matchCards,
    matchCardsByPlayer: season.matchCardsByPlayer,
    matchesById: season.matchesById,
    currentSeason,
    playersById,
    completedLeagueMatchesByTeam: season.completedLeagueMatchesByTeam,
  };
  return { ctx, exceptionsRaw: season.exceptionsRaw };
}

// ── Public endpoints ────────────────────────────────────────────────────

export async function getPlayersForMatch(env: Env, matchId: string, side?: "home" | "away") {
  const ref = await getReferenceData(env);
  const { teamRankMap, teams } = ref;
  const teamMap = new Map<string, Team>(teams.map((t) => [t.teamName || "", t]));

  const matchRecord = await getMatchRecord(env, matchId);
  const match = mapMatch(matchRecord);

  const hkfcTeam = hkfcTeamName(match, teamRankMap, side);
  if (!hkfcTeam) throw new HttpError("Cannot determine HKFC team for this match", 422);

  const cacheKey = `players-for-match:${matchId}:${side ?? "auto"}`;
  const { data: heavyData } = await getCached(cacheKey, async () => {
    const { ctx, exceptionsRaw } = await buildEvaluationContext(env, match, teamRankMap, teamMap, ref.players, hkfcTeam);
    return { ctx, allPlayers: ref.players, allExceptions: exceptionsRaw };
  }, 5 * 60 * 1000);

  const { ctx, allPlayers, allExceptions } = heavyData;

  const matchExceptions = allExceptions.filter((e) => linkId(e.match) === matchId);
  const exceptionMap = new Map<string, any>();
  for (const exc of matchExceptions) {
    const pId = linkId(exc.player);
    if (pId) exceptionMap.set(pId, exc);
  }

  const selectedPlayerIds = new Set(getSelectedPlayerIds(match, teamRankMap, side));

  const players = allPlayers.map((p) => {
    const isSelected = selectedPlayerIds.has(p.id);
    const exc = exceptionMap.get(p.id);
    const availabilityStatus = exc?.availabilityStatus || "Available";
    const playerNotes = exc?.note || exc?.playerNotes || "";
    const eligibility = evaluatePlayerEligibility(p, match, ctx);
    const name = [p.preferredName, p.surname].filter(Boolean).join(" ") || p.givenNames || "Player";
    const blocks = eligibility.status === "blocked" && eligibility.reason ? [{ rule: "", reason: eligibility.reason }] : [];
    const conflicts: { type: string; team: string; matchId: string }[] = [];
    if (eligibility.selectedByTeam) conflicts.push({ type: "selected", team: eligibility.selectedByTeam, matchId: "" });
    if (eligibility.sameDayHigherTeam) conflicts.push({ type: "available", team: eligibility.sameDayHigherTeam, matchId: "" });
    return {
      id: p.id,
      preferredName: name,
      registeredTeam: p.registeredTeam || "",
      playingPosition: p.playingPosition || "",
      playingAbility: p.playingAbility || "",
      availabilityStatus,
      playerNotes,
      playUpCount: eligibility.playUpCount,
      eligibilityStatus: eligibility.status,
      reason: eligibility.reason,
      blocks,
      warnings: eligibility.warnings,
      conflicts,
      selectedByTeam: eligibility.selectedByTeam,
      sameDayHigherTeam: eligibility.sameDayHigherTeam,
      isU21: p.u21Eligible || false,
      isVisitingPlayer: p.isVisitingPlayer || false,
      selectionStatus: isSelected ? "Selected" : "",
      selectionId: "",
    };
  });

  players.sort((a, b) => {
    if (a.selectionStatus && !b.selectionStatus) return -1;
    if (!a.selectionStatus && b.selectionStatus) return 1;
    const order = { eligible: 0, warning: 1, blocked: 2 } as const;
    return (order[a.eligibilityStatus] ?? 0) - (order[b.eligibilityStatus] ?? 0);
  });

  const teamsByName = new Map(teams.map((t) => [t.teamName || "", t]));
  const matchInfo = {
    hkfcTeam,
    date: match.matchDate || "",
    homeTeam: match.homeTeam || "",
    awayTeam: match.awayTeam || "",
    division: match.division || "",
    competitionType: match.competitionType || "",
    venue: match.venue || "",
    targetSquadSize: teamsByName.get(hkfcTeam)?.targetSquadSize || 16,
    selectedCount: selectedPlayerIds.size,
  };

  return { match: matchInfo, players };
}

export async function syncSquad(env: Env, matchId: string, targetPlayerIds: string[], actingEmail?: string, side?: MatchSide) {
  if (!Array.isArray(targetPlayerIds)) throw new HttpError("selectedIds must be an array", 400);

  // WRITE PATH: always read the record fresh — never from the 30s cache —
  // so the derby-safety merge below operates on the current opposite side.
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);

  const ref = await getReferenceData(env);
  const fieldName = getSelectionFieldName(match, ref.teamRankMap, side);
  const cleanIds = targetPlayerIds.filter((id) => typeof id === "string" && id.startsWith("rec"));

  // Derby safety: ensure a player isn't selected for BOTH sides of the same match
  const updates: Record<string, string[]> = { [fieldName]: cleanIds };
  if (side === "home" || side === "away") {
    const oppositeField = side === "home" ? MATCHES_FIELDS.selectedPlayersAway : MATCHES_FIELDS.selectedPlayersHome;
    const oppositeCurrent = side === "home" ? match.selectedPlayersAway : match.selectedPlayersHome;
    updates[oppositeField] = (oppositeCurrent || []).filter((id) => !cleanIds.includes(id));
  }

  await airtableUpdate(env, TABLES.match, matchId, updates);

  // Invalidation fan-out (Invariant #11). Every cache that can now be stale:
  //   match:${matchId}        → the record we just wrote
  //   season-index:${season}  → virtual selections / same-day indexes
  //   all-matches:${season}   → raw season fixture list
  //   players-for-match:*     → annotated output for this match and every
  //                              same-day match (cross-team rules read it)
  //   calendar:*              → ICS feeds embed the selected squad
  const season = match.season || "";
  const allMatchesInSeason = await getAllMatches(env, season);
  const affectedMatchIds = new Set([
    matchId,
    ...getSameDayMatches(allMatchesInSeason, match.matchDate || "").map((m) => m.id),
  ]);

  invalidateCache(`match:${matchId}`);
  invalidateCachePrefix("season-index:");
  invalidateCache(`all-matches:${season}`);
  for (const id of affectedMatchIds) {
    invalidateCachePrefix(`players-for-match:${id}:`);
  }
  invalidateCachePrefix("calendar:player:");
  invalidateCachePrefix("calendar:team:");
}

export async function selectPlayer(env: Env, input: { matchId: string; playerId: string; side?: MatchSide }) {
  const { matchId, playerId, side } = input;
  // WRITE PATH: fresh read (see syncSquad note).
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);
  const ref = await getReferenceData(env);
  const currentSelected = getSelectedPlayerIds(match, ref.teamRankMap, side);
  if (!currentSelected.includes(playerId)) {
    await syncSquad(env, matchId, [...currentSelected, playerId], undefined, side);
  }
  return { success: true };
}

export async function removeSelection(env: Env, input: { matchId: string; playerId: string; side?: MatchSide }) {
  const { matchId, playerId, side } = input;
  // WRITE PATH: fresh read (see syncSquad note).
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);
  const ref = await getReferenceData(env);
  const currentSelected = getSelectedPlayerIds(match, ref.teamRankMap, side);
  const newSelected = currentSelected.filter((id) => id !== playerId);
  await syncSquad(env, matchId, newSelected, undefined, side);
  return { success: true };
}

export async function getAvailabilityForMatch(env: Env, matchId: string) {
  // Linked-record safe filter: {Match} is an array of IDs
  const formula = `FIND("${matchId}", {Match}) > 0`;
  try {
    const exceptions = await airtableFindAll(env, TABLES.availabilityException, formula);
    return {
      exceptions: exceptions.map((e) => ({
        playerId: e.fields?.[AVAILABILITYEXCEPTIONS_FIELDS.player]?.[0] || "",
        status: e.fields?.[AVAILABILITYEXCEPTIONS_FIELDS.availabilityStatus] || "Available",
        notes: e.fields?.[AVAILABILITYEXCEPTIONS_FIELDS.note] || "",
      })),
    };
  } catch (err) {
    // Never let the poll crash the app
    console.error("getAvailabilityForMatch error:", err);
    return { exceptions: [] };
  }
}

const POSITION_ORDER: Record<string, number> = { Goalkeeper: 0, Defender: 1, Midfielder: 2, Forward: 3 };

export async function getSquadForMatch(env: Env, matchId: string, side?: MatchSide) {
  if (!matchId) throw new HttpError("matchId is required", 400);
  const matchRecord = await getMatchRecord(env, matchId);
  const match = mapMatch(matchRecord);
  const ref = await getReferenceData(env);
  const selectedIds = getSelectedPlayerIds(match, ref.teamRankMap, side);
  const players = [] as { id: string; name: string; position: string; ability: string }[];
  const playersById = new Map(ref.players.map((player) => [player.id, player]));
  for (const playerId of selectedIds) {
    const player = playersById.get(playerId);
    if (!player) continue;
    const name = [player.preferredName, player.surname].filter(Boolean).join(" ") || player.givenNames || "Unknown";
    players.push({ id: player.id, name, position: player.playingPosition || "", ability: player.playingAbility || "" });
  }
  players.sort((a, b) => {
    const posA = POSITION_ORDER[a.position] ?? 99;
    const posB = POSITION_ORDER[b.position] ?? 99;
    if (posA !== posB) return posA - posB;
    return (ABILITY_RANK[b.ability] ?? 0) - (ABILITY_RANK[a.ability] ?? 0);
  });
  return { matchId, players };
}