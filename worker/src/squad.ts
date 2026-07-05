import {
  Env,
  airtableFindAll,
  airtableFindById,
  airtableCreate,
  airtableDelete,
  airtableBatchCreate,
  airtableBatchUpdate,
  airtableBatchDelete,
  linkId,
} from "./airtable";
import { getCached, invalidateCache } from "../../src/lib/cache";
import { getReferenceData, getPlayerByEmail } from "./reference";
import { evaluatePlayerEligibility } from "./eligibility";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { SQUADSELECTIONS_FIELDS, AVAILABILITYEXCEPTIONS_FIELDS } from "../../src/generated/fieldMaps";
import { mapMatch } from "../../src/mappers/matchMapper";
import { mapPlayer } from "../../src/mappers/playerMapper";
import { mapSelection } from "../../src/mappers/selectionMapper";
import { mapAvailability } from "../../src/mappers/availabilityMapper";

export async function getPlayersForMatch(env: Env, matchId: string) {
  const ref = await getReferenceData(env);
  const teamRankMap = ref.teamRankMap;
  const teamsByName = new Map(ref.teams.map((t) => [t.teamName, t]));

  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);

  const home = match.homeTeam || "";
  const away = match.awayTeam || "";
  const hkfcTeam = teamRankMap[home] !== undefined ? home : away;
  if (!hkfcTeam) throw new HttpError("Cannot determine HKFC team for this match", 422);

  // Cached heavy fetch
  const { data: heavyData } = await getCached(`players-for-match:${matchId}`, async () => {
    const [playerRecords, allSelections, allExceptions] = await Promise.all([
      airtableFindAll(env, TABLES.player, "{Active}=TRUE()"),
      airtableFindAll(env, TABLES.squadSelection).then((r) => r.map(mapSelection)),
      airtableFindAll(env, TABLES.availabilityException).then((r) => r.map(mapAvailability)),
    ]);
    return { playerRecords, allSelections, allExceptions };
  }, 5 * 60 * 1000); // 5 min TTL

  const allPlayers = heavyData.playerRecords.map(mapPlayer);
  const matchSelections = heavyData.allSelections.filter((s) => linkId(s.match) === matchId);
  const matchExceptions = heavyData.allExceptions.filter((e) => linkId(e.match) === matchId);

  const selectionMap = new Map(matchSelections.map((s) => [linkId(s.player)!, s]));
  const exceptionMap = new Map(matchExceptions.map((e) => [linkId(e.player)!, e]));

  const players = allPlayers.map((p) => {
    const sel = selectionMap.get(p.id);
    const exc = exceptionMap.get(p.id);
    const availabilityStatus = exc?.availabilityStatus || "Available";
    const playerNotes = exc?.note || "";

    const eligibility = evaluatePlayerEligibility(p, match, teamRankMap, matchSelections);

    let eligibilityStatus: "eligible" | "warning" | "blocked" = "eligible";
    if (eligibility.blocks.length > 0) eligibilityStatus = "blocked";
    else if (eligibility.warnings.length > 0) eligibilityStatus = "warning";

    return {
      id: p.id,
      preferredName: p.preferredName || p.givenNames || "",
      registeredTeam: p.registeredTeam || "",
      playingPosition: p.playingPosition || "",
      playingAbility: p.playingAbility || "",
      availabilityStatus,
      playerNotes,
      playUpCount: 0, // Phase 3
      eligibilityStatus,
      blocks: eligibility.blocks,
      warnings: eligibility.warnings,
      conflicts: eligibility.conflicts,
      selectionStatus: sel?.selectionStatus || "",
      selectionId: sel?.id || "",
    };
  });

  players.sort((a, b) => {
    if (a.selectionStatus && !b.selectionStatus) return -1;
    if (!a.selectionStatus && b.selectionStatus) return 1;
    if (a.eligibilityStatus === "blocked" && b.eligibilityStatus !== "blocked") return 1;
    if (a.eligibilityStatus !== "blocked" && b.eligibilityStatus === "blocked") return -1;
    return 0;
  });

  const matchInfo = {
    date: match.matchDate || "",
    homeTeam: match.homeTeam || "",
    awayTeam: match.awayTeam || "",
    division: match.division || "",
    venue: match.venue || "",
    targetSquadSize: teamsByName.get(hkfcTeam)?.targetSquadSize || 16,
    selectedCount: matchSelections.filter((s) => s.selectionStatus === "Selected").length,
    reserveCount: matchSelections.filter((s) => s.selectionStatus === "Reserve").length,
  };

  return { match: matchInfo, players };
}

export interface SelectPlayerInput {
  matchId: string;
  playerId: string;
  selectionStatus: "Selected" | "Reserve";
  /** Email of the logged-in coach making the selection (used for "Selected By"). */
  actingEmail?: string;
}

/** Ported from src/api/selectPlayer.ts, re-running the same eligibility checks server-side. */
export async function selectPlayer(env: Env, input: SelectPlayerInput) {
  const { matchId, playerId, selectionStatus } = input;
  if (!matchId || !playerId || !selectionStatus) {
    throw new HttpError("matchId, playerId and selectionStatus are required", 400);
  }

  const playerRecord = await airtableFindById(env, TABLES.player, playerId);
  if (!playerRecord) throw new HttpError("Player not found or inactive", 404);
  const player = mapPlayer(playerRecord);
  if (!player.active) throw new HttpError("Player not found or inactive", 404);
  if (!player.registeredTeam || !player.playingPosition || !player.playingAbility) {
    throw new HttpError("Player profile is incomplete", 422);
  }
  if (player.isSuspended || (player.matchesToServe && player.matchesToServe > 0)) {
    throw new HttpError("Player is suspended", 422);
  }

  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);

  const ref = await getReferenceData(env);
  const teamRankMap = ref.teamRankMap;
  const home = match.homeTeam || "";
  const away = match.awayTeam || "";
  const hkfcTeam = teamRankMap[home] !== undefined ? home : away;
  const targetTeamRank = teamRankMap[hkfcTeam] ?? 99;
  const playerTeamRank = teamRankMap[player.registeredTeam || ""] ?? 99;
  if (playerTeamRank < targetTeamRank) {
    throw new HttpError("Higher-to-lower movement blocked (7.2a)", 422);
  }
  if (player.isVisitingPlayer && player.registeredTeam !== hkfcTeam) {
    throw new HttpError("Visiting player fixed to registered team (6.4)", 422);
  }

  const allSelections = (await airtableFindAll(env, TABLES.squadSelection)).map(mapSelection);
  const duplicate = allSelections.find(
    (s) => linkId(s.player) === playerId && linkId(s.match) === matchId
  );
  if (duplicate) throw new HttpError("Player already selected for this match", 409);

  let selectedByIds: string[] = [];
  if (input.actingEmail) {
    const acting = await getPlayerByEmail(env, input.actingEmail).catch(() => null);
    if (acting) selectedByIds = [acting.id];
  }

  const fields: Record<string, unknown> = {
    [SQUADSELECTIONS_FIELDS.match]: [matchId],
    [SQUADSELECTIONS_FIELDS.player]: [playerId],
    [SQUADSELECTIONS_FIELDS.selectionStatus]: selectionStatus,
  };
  if (selectedByIds.length) {
    fields[SQUADSELECTIONS_FIELDS.selectedBy] = selectedByIds;
  }

  const record = await airtableCreate(env, TABLES.squadSelection, fields);

  invalidateCache(`players-for-match:${matchId}`);
  invalidateCache("upcoming-fixtures");

  return { id: record.id, success: true };
}

/** Ported from src/api/removeSelection.ts. */
export async function removeSelection(env: Env, selectionId: string) {
  if (!selectionId) throw new HttpError("selectionId is required", 400);
  const record = await airtableFindById(env, TABLES.squadSelection, selectionId);
  if (!record) throw new HttpError("Selection not found", 404);
  await airtableDelete(env, TABLES.squadSelection, selectionId);
  invalidateCache("upcoming-fixtures");
  return { success: true };
}

// ---------------------------------------------------------------
// NEW ENDPOINTS BELOW
// ---------------------------------------------------------------

/** 
 * Lightweight polling endpoint. Returns ONLY availability exceptions 
 * for a specific match (1 Airtable call instead of 5).
 */
export async function getAvailabilityForMatch(env: Env, matchId: string) {
  const exceptions = await airtableFindAll(
    env, 
    TABLES.availabilityException, 
    `{Match}="${matchId}"`
  );

  return {
    exceptions: exceptions.map(e => ({
      playerId: e.fields[AVAILABILITYEXCEPTIONS_FIELDS.player]?.[0],
      status: e.fields[AVAILABILITYEXCEPTIONS_FIELDS.availabilityStatus] || "Available",
      notes: e.fields[AVAILABILITYEXCEPTIONS_FIELDS.note] || "",
    }))
  };
}

/** 
 * Batch update endpoint. Receives all pending deltas at once, 
 * runs eligibility on new selections, and writes to Airtable 
 * using batch operations (max 10 records per Airtable call).
 */
export async function batchUpdateSquad(env: Env, matchId: string, deltas: any[], actingEmail?: string) {
  const currentSelections = await airtableFindAll(
    env, 
    TABLES.squadSelection, 
    `{Match}="${matchId}"`
  );
  const currentMap = new Map(currentSelections.map(s => [linkId(s.fields[SQUADSELECTIONS_FIELDS.player]), s]));

  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);

  const ref = await getReferenceData(env);
  const teamRankMap = ref.teamRankMap;

  const toCreate: Record<string, unknown>[] = [];
  const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];
  const toDelete: string[] = [];
  const errors: { playerId: string; reason: string }[] = [];

  let selectedByIds: string[] = [];
  if (actingEmail) {
    const acting = await getPlayerByEmail(env, actingEmail).catch(() => null);
    if (acting) selectedByIds = [acting.id];
  }

  for (const delta of deltas) {
    const existing = currentMap.get(delta.playerId);

    if (delta.action === 'remove') {
      if (existing) toDelete.push(existing.id);
    } else {
      const newStatus = delta.action === 'select' ? 'Selected' : 'Reserve';

      if (existing) {
        if (existing.fields[SQUADSELECTIONS_FIELDS.selectionStatus] !== newStatus) {
          toUpdate.push({ 
            id: existing.id, 
            fields: { [SQUADSELECTIONS_FIELDS.selectionStatus]: newStatus } 
          });
        }
      } else {
        // Run eligibility check before creating
        const playerRecord = await airtableFindById(env, TABLES.player, delta.playerId);
        if (!playerRecord) {
          errors.push({ playerId: delta.playerId, reason: "Player not found" });
          continue;
        }
        const player = mapPlayer(playerRecord);
        
        if (!player.active) {
          errors.push({ playerId: delta.playerId, reason: "Player inactive" });
          continue;
        }

        const eligibility = evaluatePlayerEligibility(player, match, teamRankMap, currentSelections);
        if (eligibility.blocks.length > 0) {
          errors.push({ playerId: delta.playerId, reason: eligibility.blocks[0].reason });
          continue;
        }

        const fields: Record<string, unknown> = {
          [SQUADSELECTIONS_FIELDS.match]: [matchId],
          [SQUADSELECTIONS_FIELDS.player]: [delta.playerId],
          [SQUADSELECTIONS_FIELDS.selectionStatus]: newStatus,
        };
        
        if (selectedByIds.length) {
          fields[SQUADSELECTIONS_FIELDS.selectedBy] = selectedByIds;
        }

        toCreate.push(fields);
      }
    }
  }

  // Execute batched operations (Airtable allows max 10 per request)
  for (let i = 0; i < toCreate.length; i += 10) {
    await airtableBatchCreate(env, TABLES.squadSelection, toCreate.slice(i, i + 10));
  }
  for (let i = 0; i < toUpdate.length; i += 10) {
    await airtableBatchUpdate(env, TABLES.squadSelection, toUpdate.slice(i, i + 10));
  }
  for (let i = 0; i < toDelete.length; i += 10) {
    await airtableBatchDelete(env, TABLES.squadSelection, toDelete.slice(i, i + 10));
  }

  // Invalidate caches
  invalidateCache(`players-for-match:${matchId}`);
  invalidateCache("upcoming-fixtures");

  return {
    success: errors.length === 0,
    created: toCreate.length,
    updated: toUpdate.length,
    deleted: toDelete.length,
    errors: errors.length > 0 ? errors : undefined
  };
}