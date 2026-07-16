import { Env, airtableFindAll, airtableFindById, airtableUpdate, escapeFormulaValue, linkId } from "./airtable";
import { getCached, invalidateCache, invalidateCachePrefix } from "../../src/lib/cache";
import { getReferenceData } from "./reference";
import { evaluatePlayerEligibility, type EvaluationContext, type VirtualSelection } from "./eligibility";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { AVAILABILITYEXCEPTIONS_FIELDS, MATCHCARDS_FIELDS, MATCHES_FIELDS } from "../../src/generated/fieldMaps";
import { mapMatch } from "../../src/mappers/matchMapper";
import { mapAvailability } from "../../src/mappers/availabilityMapper";
import { mapMatchCard } from "../../src/mappers/matchCardMapper";
import type { Match, Player, MatchCard, Team } from "../../src/generated/domainTypes";

type MatchSide = "home" | "away";

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

async function buildEvaluationContext(
  env: Env,
  match: Match,
  teamRankMap: Record<string, number>,
  teamMap: Map<string, Team>,
  allPlayers: Player[],
  targetTeam: string,
): Promise<{ ctx: EvaluationContext; exceptionsRaw: ReturnType<typeof mapAvailability>[] }> {
  const currentSeason = match.season || "";
  const matchDate = match.matchDate || "";
  const [exceptionsRaw, matchCards, allMatches] = await Promise.all([
    airtableFindAll(env, TABLES.availabilityException).then((records) => records.map(mapAvailability)),
    getMatchCardsForSeason(env, currentSeason),
    getAllMatches(env, currentSeason),
  ]);
  const playersById = new Map<string, Player>();
  for (const p of allPlayers) playersById.set(p.id, p);
  const exceptionIndex = exceptionsRaw.map((e) => ({ playerId: linkId(e.player) || "", matchId: linkId(e.match) || "", status: e.availabilityStatus || "Available" }));

  // #DerbyFix: exclude the current match so derby opponent doesn't self-block
  const sameDayMatches = getSameDayMatches(allMatches, matchDate).filter(m => m.id !== match.id);

  const matchesById = new Map(allMatches.map((item) => [item.id, item]));
  const matchCardsByPlayer = new Map<string, MatchCard[]>();
  for (const card of matchCards) {
    const playerId = linkId(card.player);
    if (!playerId) continue;
    const cards = matchCardsByPlayer.get(playerId) || [];
    cards.push(card);
    matchCardsByPlayer.set(playerId, cards);
  }
  const sameDayFixtures = sameDayMatches.flatMap((item) => {
    const fixtures: { matchId: string; teamName: string }[] = [];
    if (teamRankMap[item.homeTeam || ""] !== undefined) fixtures.push({ matchId: item.id, teamName: item.homeTeam });
    if (teamRankMap[item.awayTeam || ""] !== undefined) fixtures.push({ matchId: item.id, teamName: item.awayTeam });
    return fixtures;
  });
  const virtualSelections: VirtualSelection[] = allMatches.flatMap(m => {
    const selections: VirtualSelection[] = [];
    for (const pId of m.selectedPlayersHome || []) selections.push({ player: [pId], match: [m.id], team: m.homeTeam });
    for (const pId of m.selectedPlayersAway || []) selections.push({ player: [pId], match: [m.id], team: m.awayTeam });
    return selections;
  });
  const selectionsByPlayer = new Map<string, Set<string>>();
  const sameDaySelectionsByTeam = new Map<string, Set<string>>();
  const sameDayMatchIds = new Set(sameDayMatches.map((item) => item.id));
  for (const selection of virtualSelections) {
    const playerId = linkId(selection.player);
    const selectedMatchId = linkId(selection.match);
    if (!playerId || !selectedMatchId || !selection.team) continue;
    const playerSelections = selectionsByPlayer.get(playerId) || new Set<string>();
    playerSelections.add(`${selectedMatchId}:${selection.team}`);
    selectionsByPlayer.set(playerId, playerSelections);
    if (sameDayMatchIds.has(selectedMatchId)) {
      const selectedPlayers = sameDaySelectionsByTeam.get(selection.team) || new Set<string>();
      selectedPlayers.add(playerId);
      sameDaySelectionsByTeam.set(selection.team, selectedPlayers);
    }
  }
  const unavailablePlayerMatchKeys = new Set(exceptionIndex.filter((item) => item.status === "Unavailable").map((item) => `${item.playerId}:${item.matchId}`));
  return {
    ctx: {
      teamMap,
      rankMap: teamRankMap,
      targetTeam,
      sameDayMatches,
      sameDayFixtures,
      allSelections: virtualSelections,
      selectionsByPlayer,
      sameDaySelectionsByTeam,
      allExceptions: exceptionIndex,
      unavailablePlayerMatchKeys,
      matchCards,
      matchCardsByPlayer,
      matchesById,
      currentSeason,
      playersById,
    },
    exceptionsRaw,
  };
}

export async function getPlayersForMatch(env: Env, matchId: string, side?: "home" | "away") {
  const ref = await getReferenceData(env);
  const { teamRankMap, teams } = ref;
  const teamMap = new Map<string, Team>(teams.map((t) => [t.teamName || "", t]));
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
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
    const conflicts = eligibility.selectedByTeam ? [{ type: "selected", team: eligibility.selectedByTeam, matchId: "" }] : [];
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
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);
  const ref = await getReferenceData(env);
  const fieldName = getSelectionFieldName(match, ref.teamRankMap, side);

  // Ensure we only send valid strings (defensive)
  const cleanIds = targetPlayerIds.filter((id) => typeof id === "string" && id.startsWith("rec"));
  await airtableUpdate(env, TABLES.match, matchId, { [fieldName]: cleanIds });

  invalidateCache(`all-matches:${match.season || ""}`);
  invalidateCachePrefix("players-for-match:");
  invalidateCache('upcoming-fixtures');
}

export async function selectPlayer(env: Env, input: { matchId: string; playerId: string; side?: MatchSide }) {
  const { matchId, playerId, side } = input;
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
const ABILITY_RANK: Record<string, number> = {
  "A+": 24, "A": 23, "A-": 22, "B+": 21, "B": 20, "B-": 19,
  "C+": 18, "C": 17, "C-": 16, "D+": 15, "D": 14, "D-": 13,
  "E+": 12, "E": 11, "E-": 10, "F+": 9, "F": 8, "F-": 7,
  "G+": 6, "G": 5, "G-": 4, "H+": 3, "H": 2, "H-": 1,
};

export async function getSquadForMatch(env: Env, matchId: string, side?: MatchSide) {
  if (!matchId) throw new HttpError("matchId is required", 400);
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
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