import { Env, airtableFindAll, airtableFindById, airtableUpdate, linkId } from "./airtable";
import { getCached, invalidateCache } from "../../src/lib/cache";
import { getReferenceData, getPlayerByEmail } from "./reference";
import { evaluatePlayerEligibility, type EvaluationContext, type VirtualSelection } from "./eligibility";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { AVAILABILITYEXCEPTIONS_FIELDS, MATCHES_FIELDS } from "../../src/generated/fieldMaps";
import { mapMatch } from "../../src/mappers/matchMapper";
import { mapPlayer } from "../../src/mappers/playerMapper";
import { mapAvailability } from "../../src/mappers/availabilityMapper";
import { mapMatchCard } from "../../src/mappers/matchCardMapper";
import type { Match, Player, MatchCard, Team } from "../../src/generated/domainTypes";

function hkfcTeamName(match: Match, rankMap: Record<string, number>): string {
  const home = match.homeTeam || "";
  const away = match.awayTeam || "";
  if (rankMap[home] !== undefined) return home;
  return away;
}

async function getAllMatches(env: Env): Promise<Match[]> {
  const { data } = await getCached<Match[]>(
    `all-matches`,
    async () => {
      const records = await airtableFindAll(env, TABLES.match);
      return records.map(mapMatch);
    },
    10 * 60 * 1000
  );
  return data;
}

async function getMatchCardsForSeason(env: Env, season: string): Promise<MatchCard[]> {
  const { data } = await getCached<MatchCard[]>(
    `match-cards:${season}`,
    async () => {
      const records = await airtableFindAll(env, TABLES.matchCard);
      return records.map(mapMatchCard);
    },
    10 * 60 * 1000
  );
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
  allPlayers: Player[]
): Promise<EvaluationContext> {
  const currentSeason = match.season || "";
  const matchDate = match.matchDate || "";

  const exceptionsRaw = await airtableFindAll(env, TABLES.availabilityException).then((r) => r.map(mapAvailability));
  const [matchCards, allMatches] = await Promise.all([
    getMatchCardsForSeason(env, currentSeason),
    getAllMatches(env),
  ]);

  const playersById = new Map<string, Player>();
  for (const p of allPlayers) playersById.set(p.id, p);

  const exceptionIndex = exceptionsRaw.map((e) => ({
    playerId: linkId(e.player) || "",
    matchId: linkId(e.match) || "",
    status: e.availabilityStatus || "Available",
  }));

  const sameDayMatches = getSameDayMatches(allMatches, matchDate);

  // Construct Virtual Selections for the eligibility engine directly from the Matches table
  const virtualSelections: VirtualSelection[] = allMatches.flatMap(m => 
    (m.selectedPlayers || []).map(pId => ({
      player: [pId],
      match: [m.id],
    }))
  );

  return {
    teamMap,
    rankMap: teamRankMap,
    sameDayMatches,
    allSelections: virtualSelections,
    allExceptions: exceptionIndex,
    matchCards,
    currentSeason,
    playersById,
  };
}

export async function getPlayersForMatch(env: Env, matchId: string) {
  const ref = await getReferenceData(env);
  const { teamRankMap, teams } = ref;
  const teamMap = new Map<string, Team>(teams.map((t) => [t.teamName || "", t]));

  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);

  const hkfcTeam = hkfcTeamName(match, teamRankMap);
  if (!hkfcTeam) throw new HttpError("Cannot determine HKFC team for this match", 422);

  const { data: heavyData } = await getCached(
    `players-for-match:${matchId}`,
    async () => {
      const ctx = await buildEvaluationContext(env, match, teamRankMap, teamMap, ref.players);
      const allExceptionsRaw = await airtableFindAll(env, TABLES.availabilityException).then((r) => r.map(mapAvailability));
      return { ctx, allPlayers: ref.players, allExceptions: allExceptionsRaw as any[] };
    },
    5 * 60 * 1000
  );

  const { ctx, allPlayers, allExceptions } = heavyData;

  const matchExceptions = allExceptions.filter((e) => linkId(e.match) === matchId);
  const exceptionMap = new Map<string, any>();
  for (const exc of matchExceptions) {
    const pId = linkId(exc.player);
    if (pId) exceptionMap.set(pId, exc);
  }

  const selectedPlayerIds = new Set(match.selectedPlayers || []);

  const players = allPlayers.map((p) => {
    const isSelected = selectedPlayerIds.has(p.id);
    const exc = exceptionMap.get(p.id);
    const availabilityStatus = exc?.availabilityStatus || "Available";
    const playerNotes = exc?.note || exc?.playerNotes || "";

    const eligibility = evaluatePlayerEligibility(p, match, ctx);
    const name = [p.preferredName, p.surname].filter(Boolean).join(" ");

    return {
      id: p.id,
      preferredName: name || p.preferredName || "",
      registeredTeam: p.registeredTeam || "",
      playingPosition: p.playingPosition || "",
      playingAbility: p.playingAbility || "",
      availabilityStatus,
      playerNotes,
      playUpCount: eligibility.playUpCount,
      eligibilityStatus: eligibility.status,
      reason: eligibility.reason,
      reasonTag: eligibility.reasonTag,
      warnings: eligibility.warnings,
      warningTags: eligibility.warningTags,
      selectedByTeam: eligibility.selectedByTeam,
      sameDayHigherTeam: eligibility.sameDayHigherTeam,
      isU21: p.u21Eligible || false,
      isSuspended: p.isSuspended || false,
      isVisitingPlayer: p.isVisitingPlayer || false,
      selectionStatus: isSelected ? "Selected" : "",
      selectionId: "", 
    };
  });

  players.sort((a, b) => {
    if (a.selectionStatus && !b.selectionStatus) return -1;
    if (!a.selectionStatus && b.selectionStatus) return 1;
    const order = { eligible: 0, warning: 1, blocked: 2 } as const;
    return ((order[a.eligibilityStatus] ?? 0) - (order[b.eligibilityStatus] ?? 0));
  });

  const teamsByName = new Map(teams.map((t) => [t.teamName || "", t]));
  const matchInfo = {
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

// Replaces individual/batch creation & deletion with a single atomic array update!
export async function syncSquad(env: Env, matchId: string, targetPlayerIds: string[], actingEmail?: string) {
  // 1. Update the Match record with the new array of IDs
  await airtableUpdate(env, TABLES.match, matchId, {
    [MATCHES_FIELDS.selectedPlayers]: targetPlayerIds
  });

  // 2. Invalidate all relevant caches
  invalidateCache('all-matches');
  invalidateCache(`players-for-match:${matchId}`);
  invalidateCache('upcoming-fixtures');
}

// Maintained for backward compatibility if the UI still uses single selections
export async function selectPlayer(env: Env, input: { matchId: string; playerId: string }) {
  const { matchId, playerId } = input;
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);
  
  const currentSelected = match.selectedPlayers || [];
  if (!currentSelected.includes(playerId)) {
    const newSelected = [...currentSelected, playerId];
    await syncSquad(env, matchId, newSelected);
  }
  return { success: true };
}

// Deprecated in frontend but safely maintained here
export async function removeSelection(env: Env, input: { matchId: string; playerId: string }) {
  const { matchId, playerId } = input;
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);

  const currentSelected = match.selectedPlayers || [];
  const newSelected = currentSelected.filter(id => id !== playerId);
  await syncSquad(env, matchId, newSelected);
  return { success: true };
}

export async function getAvailabilityForMatch(env: Env, matchId: string) {
  const exceptions = await airtableFindAll(env, TABLES.availabilityException, `{Match}="${matchId}"`);
  return {
    exceptions: exceptions.map((e) => ({
      playerId: e.fields[AVAILABILITYEXCEPTIONS_FIELDS.player]?.[0],
      status: e.fields[AVAILABILITYEXCEPTIONS_FIELDS.availabilityStatus] || "Available",
      notes: e.fields[AVAILABILITYEXCEPTIONS_FIELDS.note] || "",
    })),
  };
}

const POSITION_ORDER: Record<string, number> = { Goalkeeper: 0, Defender: 1, Midfielder: 2, Forward: 3 };
const ABILITY_RANK: Record<string, number> = { "A+": 24, "A": 23, "A-": 22, "B+": 21, "B": 20, "B-": 19, "C+": 18, "C": 17, "C-": 16, "D+": 15, "D": 14, "D-": 13, "E+": 12, "E": 11, "E-": 10, "F+": 9,  "F": 8,  "F-": 7, "G+": 6,  "G": 5,  "G-": 4, "H+": 3,  "H": 2,  "H-": 1 };

export async function getSquadForMatch(env: Env, matchId: string) {
  if (!matchId) throw new HttpError("matchId is required", 400);
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  
  const match = mapMatch(matchRecord);
  const selectedIds = match.selectedPlayers || [];
  
  const players = [];
  for (const playerId of selectedIds) {
    const playerRecord = await airtableFindById(env, TABLES.player, playerId);
    if (!playerRecord) continue;
    const player = mapPlayer(playerRecord);
    const name = [player.preferredName, player.surname].filter(Boolean).join(" ");
    players.push({
      id: player.id,
      name: name || player.preferredName || "Unknown",
      position: player.playingPosition || "",
      ability: player.playingAbility || "",
    });
  }

  players.sort((a, b) => {
    const posA = POSITION_ORDER[a.position] ?? 99;
    const posB = POSITION_ORDER[b.position] ?? 99;
    if (posA !== posB) return posA - posB;
    return (ABILITY_RANK[b.ability] ?? 0) - (ABILITY_RANK[a.ability] ?? 0);
  });

  return { matchId, players };
}