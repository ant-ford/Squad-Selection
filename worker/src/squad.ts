import {
  Env,
  airtableFindAll,
  airtableFindById,
  airtableCreate,
  airtableDelete,
  linkId,
} from "./airtable";
import { getReferenceData, getPlayerByEmail } from "./reference";
import { evaluatePlayerEligibility } from "./eligibility";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { SQUADSELECTIONS_FIELDS } from "../../src/generated/fieldMaps";
import { mapMatch } from "../../src/mappers/matchMapper";
import { mapPlayer } from "../../src/mappers/playerMapper";
import { mapSelection } from "../../src/mappers/selectionMapper";
import { mapAvailability } from "../../src/mappers/availabilityMapper";

/** Ported from src/api/getPlayersForMatch.ts. */
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

  const [playerRecords, allSelections, allExceptions] = await Promise.all([
    airtableFindAll(env, TABLES.player, "{Active}=TRUE()"),
    airtableFindAll(env, TABLES.squadSelection).then((r) => r.map(mapSelection)),
    airtableFindAll(env, TABLES.availabilityException).then((r) => r.map(mapAvailability)),
  ]);
  const allPlayers = playerRecords.map(mapPlayer);

  const matchSelections = allSelections.filter((s) => linkId(s.match) === matchId);
  const selectionMap = new Map<string, (typeof matchSelections)[number]>();
  for (const sel of matchSelections) {
    const pId = linkId(sel.player);
    if (pId) selectionMap.set(pId, sel);
  }

  const matchExceptions = allExceptions.filter((e) => linkId(e.match) === matchId);
  const exceptionMap = new Map<string, (typeof matchExceptions)[number]>();
  for (const exc of matchExceptions) {
    const pId = linkId(exc.player);
    if (pId) exceptionMap.set(pId, exc);
  }

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
      // Play-up counting requires reading Match Cards for the current
      // season and is Phase 3 work (see Implementation_Roadmap_v2.md) —
      // left as-is (0) exactly as it was before this migration.
      playUpCount: 0,
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
    // Best-effort: an unknown/blank acting email shouldn't block the selection.
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
  // NOTE: "Selected At" is a createdTime formula field in Airtable — it is
  // set automatically and must NOT be included in the write payload.

  const record = await airtableCreate(env, TABLES.squadSelection, fields);
  return { id: record.id, success: true };
}

/** Ported from src/api/removeSelection.ts. */
export async function removeSelection(env: Env, selectionId: string) {
  if (!selectionId) throw new HttpError("selectionId is required", 400);
  const record = await airtableFindById(env, TABLES.squadSelection, selectionId);
  if (!record) throw new HttpError("Selection not found", 404);
  await airtableDelete(env, TABLES.squadSelection, selectionId);
  return { success: true };
}
