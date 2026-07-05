import {
  Env,
  airtableFindAll,
  airtableFindById,
  airtableCreate,
  airtableDelete,
  linkId,
  escapeFormulaValue,
} from "./airtable";
import { getReferenceData, getPlayerByEmail } from "./reference";
import {
  evaluatePlayerEligibility,
  type EvaluationContext,
} from "./eligibility";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { SQUADSELECTIONS_FIELDS, MATCHES_FIELDS } from "../../src/generated/fieldMaps";
import { mapMatch } from "../../src/mappers/matchMapper";
import { mapPlayer } from "../../src/mappers/playerMapper";
import { mapSelection } from "../../src/mappers/selectionMapper";
import { mapAvailability } from "../../src/mappers/availabilityMapper";
import { mapMatchCard } from "../../src/mappers/matchCardMapper";
import type { Match, Player, SquadSelection, MatchCard } from "../../src/generated/domainTypes";
import type { Team } from "../../src/generated/domainTypes";

// ── Helpers ─────────────────────────────────────────────────────────────

function hkfcTeamName(match: Match, rankMap: Record<string, number>): string {
  const home = match.homeTeam || "";
  const away = match.awayTeam || "";
  if (rankMap[home] !== undefined) return home;
  return away;
}

/**
 * Load Match Cards for the given season.
 * Approach: load all matches for the season first, then load all Match Cards,
 * then filter in memory by matching linked match IDs. This avoids issues with
 * Airtable formula/lookup field filterability on linked records.
 */
async function loadMatchCardsForSeason(
  env: Env,
  season: string,
): Promise<MatchCard[]> {
  // Load season matches first
  const seasonFilter = `{${MATCHES_FIELDS.season}}="${escapeFormulaValue(season)}"`;
  const seasonMatches = await airtableFindAll(env, TABLES.match, seasonFilter);
  const seasonMatchIds = new Set(seasonMatches.map((r: any) => r.id));

  if (seasonMatchIds.size === 0) return [];

  // Load all Match Cards (they have links to Matches), filter in memory
  const records = await airtableFindAll(env, TABLES.matchCard);
  const cards = records.map(mapMatchCard);

  return cards.filter((mc) => {
    const mId = linkId(mc.match);
    return mId ? seasonMatchIds.has(mId) : false;
  });
}

/** Build same-day matches list from all matches. */
function getSameDayMatches(allMatches: Match[], targetDate: string): Match[] {
  // Normalize dates for comparison (strip time if present)
  const norm = (d: string) => d.split("T")[0];
  const target = norm(targetDate);
  return allMatches.filter((m) => norm(m.matchDate) === target);
}

// ── getPlayersForMatch ──────────────────────────────────────────────────

export async function getPlayersForMatch(env: Env, matchId: string) {
  const ref = await getReferenceData(env);
  const { teamRankMap, teams } = ref;
  const teamMap = new Map<string, Team>(teams.map((t) => [t.teamName || "", t]));

  // Load the target match
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);

  const hkfcTeam = hkfcTeamName(match, teamRankMap);
  if (!hkfcTeam) throw new HttpError("Cannot determine HKFC team for this match", 422);

  const currentSeason = match.season || "";
  const matchDate = match.matchDate || "";

  // ── Load all data in parallel ──
  const [
    playerRecords,
    allSelectionsRaw,
    allExceptionsRaw,
    matchCardsRaw,
    // Load all matches for same-day conflict detection
    allMatchesRaw,
  ] = await Promise.all([
    airtableFindAll(env, TABLES.player, "{Active}=TRUE()"),
    airtableFindAll(env, TABLES.squadSelection).then((r) => r.map(mapSelection)),
    airtableFindAll(env, TABLES.availabilityException).then((r) => r.map(mapAvailability)),
    loadMatchCardsForSeason(env, currentSeason),
    airtableFindAll(env, TABLES.match).then((r) => r.map(mapMatch)),
  ]);

  const allPlayers = playerRecords.map(mapPlayer);
  const allSelections = allSelectionsRaw as SquadSelection[];
  const allExceptions = allExceptionsRaw as any[];
  const matchCards = matchCardsRaw as MatchCard[];
  const allMatches = allMatchesRaw as Match[];

  // ── Index selections for this match ──
  const matchSelections = allSelections.filter((s) => linkId(s.match) === matchId);
  const selectionMap = new Map<string, SquadSelection>();
  for (const sel of matchSelections) {
    const pId = linkId(sel.player);
    if (pId) selectionMap.set(pId, sel);
  }

  // ── Index exceptions for this match ──
  const matchExceptions = allExceptions.filter((e) => linkId(e.match) === matchId);
  const exceptionMap = new Map<string, any>();
  for (const exc of matchExceptions) {
    const pId = linkId(exc.player);
    if (pId) exceptionMap.set(pId, exc);
  }

  // ── Build players-by-id map ──
  const playersById = new Map<string, Player>();
  for (const p of allPlayers) playersById.set(p.id, p);

  // ── Build exception index for same-day checks ──
  const exceptionIndex = allExceptions.map((e) => ({
    playerId: linkId(e.player) || "",
    matchId: linkId(e.match) || "",
    status: e.availabilityStatus || "Available",
  }));

  // ── Same-day matches ──
  const sameDayMatches = getSameDayMatches(allMatches, matchDate);

  // ── Build evaluation context ──
  const ctx: EvaluationContext = {
    teamMap,
    rankMap: teamRankMap,
    sameDayMatches,
    allSelections,
    allExceptions: exceptionIndex,
    matchCards,
    currentSeason,
    playersById,
  };

  // ── Evaluate every active player ──
  const players = allPlayers.map((p) => {
    const sel = selectionMap.get(p.id);
    const exc = exceptionMap.get(p.id);
    const availabilityStatus = exc?.availabilityStatus || "Available";
    const playerNotes = exc?.note || exc?.playerNotes || "";

    const eligibility = evaluatePlayerEligibility(p, match, ctx);

    return {
      id: p.id,
      preferredName: p.preferredName || p.givenNames || "",
      registeredTeam: p.registeredTeam || "",
      playingPosition: p.playingPosition || "",
      playingAbility: p.playingAbility || "",
      availabilityStatus,
      playerNotes,
      playUpCount: eligibility.playUpCount,
      eligibilityStatus: eligibility.status,
      reason: eligibility.reason,
      warnings: eligibility.warnings,
      selectedByTeam: eligibility.selectedByTeam,
      sameDayHigherTeam: eligibility.sameDayHigherTeam,
      isU21: p.u21Eligible || false,
      isSuspended: p.isSuspended || false,
      isVisitingPlayer: p.isVisitingPlayer || false,
      selectionStatus: sel?.selectionStatus || "",
      selectionId: sel?.id || "",
    };
  });

  // Sort: selected first, then eligible, then warnings, blocked last
  players.sort((a, b) => {
    if (a.selectionStatus && !b.selectionStatus) return -1;
    if (!a.selectionStatus && b.selectionStatus) return 1;
    const order = { eligible: 0, warning: 1, blocked: 2 } as const;
    return (order[a.eligibilityStatus] ?? 0) - (order[b.eligibilityStatus] ?? 0);
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
    selectedCount: matchSelections.filter((s) => s.selectionStatus === "Selected").length,
    reserveCount: matchSelections.filter((s) => s.selectionStatus === "Reserve").length,
  };

  return { match: matchInfo, players };
}

// ── selectPlayer ────────────────────────────────────────────────────────

export interface SelectPlayerInput {
  matchId: string;
  playerId: string;
  selectionStatus: "Selected" | "Reserve";
  /** Email of the logged-in coach making the selection (used for "Selected By"). */
  actingEmail?: string;
}

export async function selectPlayer(env: Env, input: SelectPlayerInput) {
  const { matchId, playerId, selectionStatus } = input;
  if (!matchId || !playerId || !selectionStatus) {
    throw new HttpError("matchId, playerId and selectionStatus are required", 400);
  }

  // ── Load player ──
  const playerRecord = await airtableFindById(env, TABLES.player, playerId);
  if (!playerRecord) throw new HttpError("Player not found or inactive", 404);
  const player = mapPlayer(playerRecord);
  if (!player.active) throw new HttpError("Player not found or inactive", 404);

  // ── Load match ──
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);

  // ── Load reference data ──
  const ref = await getReferenceData(env);
  const { teamRankMap, teams } = ref;
  const teamMap = new Map<string, Team>(teams.map((t) => [t.teamName || "", t]));
  const hkfcTeam = hkfcTeamName(match, teamRankMap);

  const currentSeason = match.season || "";

  // ── Load selections and match cards for full eligibility revalidation ──
  const [allSelectionsRaw, allExceptionsRaw, matchCardsRaw, allMatchesRaw] = await Promise.all([
    airtableFindAll(env, TABLES.squadSelection).then((r) => r.map(mapSelection)),
    airtableFindAll(env, TABLES.availabilityException).then((r) => r.map(mapAvailability)),
    loadMatchCardsForSeason(env, currentSeason),
    airtableFindAll(env, TABLES.match).then((r) => r.map(mapMatch)),
  ]);

  const allSelections = allSelectionsRaw as SquadSelection[];
  const allExceptions = allExceptionsRaw as any[];
  const matchCards = matchCardsRaw as MatchCard[];
  const allMatches = allMatchesRaw as Match[];

  // Build players-by-id map (single player for validation)
  const playersById = new Map<string, Player>();
  playersById.set(player.id, player);

  const exceptionIndex = allExceptions.map((e) => ({
    playerId: linkId(e.player) || "",
    matchId: linkId(e.match) || "",
    status: e.availabilityStatus || "Available",
  }));

  const sameDayMatches = getSameDayMatches(allMatches, match.matchDate || "");

  const ctx: EvaluationContext = {
    teamMap,
    rankMap: teamRankMap,
    sameDayMatches,
    allSelections,
    allExceptions: exceptionIndex,
    matchCards,
    currentSeason,
    playersById,
  };

  // ── Full server-side eligibility revalidation (§17) ──
  const eligibility = evaluatePlayerEligibility(player, match, ctx);

  if (eligibility.status === "blocked") {
    throw new HttpError(eligibility.reason || "Player is not eligible for this match", 422);
  }

  // ── Duplicate check ──
  const duplicate = allSelections.find(
    (s) => linkId(s.player) === playerId && linkId(s.match) === matchId
  );
  if (duplicate) throw new HttpError("Player already selected for this match", 409);

  // ── Higher-team priority: auto-remove lower-team same-day selections (§7.3) ──
  const targetRank = teamRankMap[hkfcTeam] ?? 99;
  let autoRemovedInfo: { team: string; previousSelection: string; reason: string } | null = null;

  for (const sel of allSelections) {
    const selPlayerId = linkId(sel.player);
    const selMatchId = linkId(sel.match);
    if (selPlayerId !== playerId) continue;
    if (!selMatchId) continue;

    const selMatch = allMatches.find((m) => m.id === selMatchId);
    if (!selMatch) continue;
    const selHkfcTeam = hkfcTeamName(selMatch, teamRankMap);
    const selRank = teamRankMap[selHkfcTeam] ?? 99;

    // If player is selected for a LOWER-ranked team on same day, remove it
    if (selRank > targetRank && selMatch.matchDate === match.matchDate) {
      await airtableDelete(env, TABLES.squadSelection, sel.id);
      autoRemovedInfo = {
        team: selHkfcTeam,
        previousSelection: sel.id,
        reason: `Higher-team priority: ${hkfcTeam} selection overrides ${selHkfcTeam}`,
      };
    }
  }

  // ── Resolve acting coach ──
  let selectedByIds: string[] = [];
  if (input.actingEmail) {
    const acting = await getPlayerByEmail(env, input.actingEmail).catch(() => null);
    if (acting) selectedByIds = [acting.id];
  }

  // ── Create Squad Selection ──
  const fields: Record<string, unknown> = {
    [SQUADSELECTIONS_FIELDS.match]: [matchId],
    [SQUADSELECTIONS_FIELDS.player]: [playerId],
    [SQUADSELECTIONS_FIELDS.selectionStatus]: selectionStatus,
  };
  if (selectedByIds.length) {
    fields[SQUADSELECTIONS_FIELDS.selectedBy] = selectedByIds;
  }

  const record = await airtableCreate(env, TABLES.squadSelection, fields);

  return {
    id: record.id,
    success: true,
    autoRemovedLowerTeamSelection: autoRemovedInfo,
  };
}

// ── removeSelection ─────────────────────────────────────────────────────

export async function removeSelection(env: Env, selectionId: string) {
  if (!selectionId) throw new HttpError("selectionId is required", 400);
  const record = await airtableFindById(env, TABLES.squadSelection, selectionId);
  if (!record) throw new HttpError("Selection not found", 404);
  await airtableDelete(env, TABLES.squadSelection, selectionId);
  return { success: true };
}
