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
  escapeFormulaValue,
} from "./airtable";
import { getCached, invalidateCache } from "../../src/lib/cache";
import { getReferenceData, getPlayerByEmail } from "./reference";
import {
  evaluatePlayerEligibility,
  type EvaluationContext,
} from "./eligibility";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import {
  SQUADSELECTIONS_FIELDS,
  AVAILABILITYEXCEPTIONS_FIELDS,
  MATCHES_FIELDS,
} from "../../src/generated/fieldMaps";
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
  const norm = (d: string) => d.split("T")[0];
  const target = norm(targetDate);
  return allMatches.filter((m) => norm(m.matchDate) === target);
}

/**
 * Build a full EvaluationContext for the eligibility engine.
 * This is the heavy path; callers should wrap in getCached where appropriate.
 */
async function buildEvaluationContext(
  env: Env,
  match: Match,
  teamRankMap: Record<string, number>,
  teamMap: Map<string, Team>,
): Promise<EvaluationContext> {
  const currentSeason = match.season || "";
  const matchDate = match.matchDate || "";

  const [playerRecords, allSelectionsRaw, allExceptionsRaw, matchCardsRaw, allMatchesRaw] =
    await Promise.all([
      airtableFindAll(env, TABLES.player, "{Active}=TRUE()"),
      airtableFindAll(env, TABLES.squadSelection).then((r) => r.map(mapSelection)),
      airtableFindAll(env, TABLES.availabilityException).then((r) => r.map(mapAvailability)),
      loadMatchCardsForSeason(env, currentSeason),
      airtableFindAll(env, TABLES.match).then((r) => r.map(mapMatch)),
    ]);

  const allPlayers = playerRecords.map(mapPlayer);
  const allSelections = allSelectionsRaw as SquadSelection[];
  const matchCards = matchCardsRaw as MatchCard[];
  const allMatches = allMatchesRaw as Match[];

  const playersById = new Map<string, Player>();
  for (const p of allPlayers) playersById.set(p.id, p);

  const exceptionIndex = (allExceptionsRaw as any[]).map((e) => ({
    playerId: linkId(e.player) || "",
    matchId: linkId(e.match) || "",
    status: e.availabilityStatus || "Available",
  }));

  const sameDayMatches = getSameDayMatches(allMatches, matchDate);

  return {
    teamMap,
    rankMap: teamRankMap,
    sameDayMatches,
    allSelections,
    allExceptions: exceptionIndex,
    matchCards,
    currentSeason,
    playersById,
  };
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

  // Cached heavy fetch: includes all data needed for eligibility evaluation
  const { data: heavyData } = await getCached(
    `players-for-match:${matchId}`,
    async () => {
      const ctx = await buildEvaluationContext(env, match, teamRankMap, teamMap);

      const [playerRecords, allExceptionsRaw] = await Promise.all([
        airtableFindAll(env, TABLES.player, "{Active}=TRUE()"),
        airtableFindAll(env, TABLES.availabilityException).then((r) =>
          r.map(mapAvailability)
        ),
      ]);

      const allPlayers = playerRecords.map(mapPlayer);

      return { ctx, allPlayers, allExceptions: allExceptionsRaw as any[] };
    },
    5 * 60 * 1000, // 5 min TTL
  );

  const { ctx, allPlayers, allExceptions } = heavyData;

  // ── Index selections and exceptions for THIS match ──
  const matchSelections = ctx.allSelections.filter(
    (s) => linkId(s.match) === matchId,
  );
  const selectionMap = new Map<string, SquadSelection>();
  for (const sel of matchSelections) {
    const pId = linkId(sel.player);
    if (pId) selectionMap.set(pId, sel);
  }

  const matchExceptions = allExceptions.filter(
    (e) => linkId(e.match) === matchId,
  );
  const exceptionMap = new Map<string, any>();
  for (const exc of matchExceptions) {
    const pId = linkId(exc.player);
    if (pId) exceptionMap.set(pId, exc);
  }

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
      reasonTag: eligibility.reasonTag,
      warnings: eligibility.warnings,
      warningTags: eligibility.warningTags,
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
    return (
      (order[a.eligibilityStatus] ?? 0) - (order[b.eligibilityStatus] ?? 0)
    );
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
    selectedCount: matchSelections.filter(
      (s) => s.selectionStatus === "Selected",
    ).length,
    reserveCount: matchSelections.filter(
      (s) => s.selectionStatus === "Reserve",
    ).length,
  };

  return { match: matchInfo, players };
}

// ── selectPlayer ────────────────────────────────────────────────────────

export interface SelectPlayerInput {
  matchId: string;
  playerId: string;
  selectionStatus: "Selected";
  /** Email of the logged-in coach making the selection (used for "Selected By"). */
  actingEmail?: string;
}

export async function selectPlayer(env: Env, input: SelectPlayerInput) {
  const { matchId, playerId, selectionStatus } = input;
  if (!matchId || !playerId || !selectionStatus) {
    throw new HttpError(
      "matchId, playerId and selectionStatus are required",
      400,
    );
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

  // ── Build full evaluation context for server-side revalidation ──
  const ctx = await buildEvaluationContext(env, match, teamRankMap, teamMap);

  // ── Full server-side eligibility revalidation (§17) ──
  const eligibility = evaluatePlayerEligibility(player, match, ctx);

  if (eligibility.status === "blocked") {
    throw new HttpError(
      eligibility.reason || "Player is not eligible for this match",
      422,
    );
  }

  // ── Duplicate check ──
  const duplicate = ctx.allSelections.find(
    (s) => linkId(s.player) === playerId && linkId(s.match) === matchId,
  );
  if (duplicate)
    throw new HttpError("Player already selected for this match", 409);

  // ── Higher-team priority: auto-remove lower-team same-day selections (§7.3) ──
  const targetRank = teamRankMap[hkfcTeam] ?? 99;
  let autoRemovedInfo: {
    team: string;
    previousSelection: string;
    reason: string;
  } | null = null;

  for (const sel of ctx.allSelections) {
    const selPlayerId = linkId(sel.player);
    const selMatchId = linkId(sel.match);
    if (selPlayerId !== playerId) continue;
    if (!selMatchId) continue;

    const selMatch = ctx.sameDayMatches.find((m) => m.id === selMatchId);
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
    const acting = await getPlayerByEmail(env, input.actingEmail).catch(
      () => null,
    );
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

  invalidateCache(`players-for-match:${matchId}`);
  invalidateCache("upcoming-fixtures");

  return {
    id: record.id,
    success: true,
    autoRemovedLowerTeamSelection: autoRemovedInfo,
  };
}

// ── removeSelection ─────────────────────────────────────────────────────

export async function removeSelection(env: Env, selectionId: string) {
  if (!selectionId) throw new HttpError("selectionId is required", 400);
  const record = await airtableFindById(
    env,
    TABLES.squadSelection,
    selectionId,
  );
  if (!record) throw new HttpError("Selection not found", 404);
  await airtableDelete(env, TABLES.squadSelection, selectionId);
  invalidateCache("upcoming-fixtures");
  return { success: true };
}

// ── Polling & Batch endpoints (from main/cache commit) ──────────────────

/**
 * Lightweight polling endpoint. Returns ONLY availability exceptions
 * for a specific match (1 Airtable call instead of 5).
 */
export async function getAvailabilityForMatch(env: Env, matchId: string) {
  const exceptions = await airtableFindAll(
    env,
    TABLES.availabilityException,
    `{Match}="${matchId}"`,
  );

  return {
    exceptions: exceptions.map((e) => ({
      playerId:
        e.fields[AVAILABILITYEXCEPTIONS_FIELDS.player]?.[0],
      status:
        e.fields[AVAILABILITYEXCEPTIONS_FIELDS.availabilityStatus] ||
        "Available",
      notes: e.fields[AVAILABILITYEXCEPTIONS_FIELDS.note] || "",
    })),
  };
}

/**
 * Batch update endpoint. Receives all pending deltas at once,
 * runs eligibility on new selections, and writes to Airtable
 * using batch operations (max 10 records per Airtable call).
 */
export async function batchUpdateSquad(
  env: Env,
  matchId: string,
  deltas: any[],
  actingEmail?: string,
) {
  const currentSelections = await airtableFindAll(
    env,
    TABLES.squadSelection,
    `{Match}="${matchId}"`,
  );
  const currentMap = new Map(
    currentSelections.map((s) => [
      linkId(s.fields[SQUADSELECTIONS_FIELDS.player]),
      s,
    ]),
  );

  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);

  const ref = await getReferenceData(env);
  const { teamRankMap, teams } = ref;
  const teamMap = new Map<string, Team>(teams.map((t) => [t.teamName || "", t]));

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

    if (delta.action === "remove") {
      if (existing) toDelete.push(existing.id);
    } else {
      const newStatus =
        delta.action === "select" ? "Selected" : "Reserve";

      if (existing) {
        if (
          existing.fields[SQUADSELECTIONS_FIELDS.selectionStatus] !==
          newStatus
        ) {
          toUpdate.push({
            id: existing.id,
            fields: {
              [SQUADSELECTIONS_FIELDS.selectionStatus]: newStatus,
            },
          });
        }
      } else {
        // Run eligibility check before creating
        const playerRecord = await airtableFindById(
          env,
          TABLES.player,
          delta.playerId,
        );
        if (!playerRecord) {
          errors.push({
            playerId: delta.playerId,
            reason: "Player not found",
          });
          continue;
        }
        const player = mapPlayer(playerRecord);

        if (!player.active) {
          errors.push({ playerId: delta.playerId, reason: "Player inactive" });
          continue;
        }

        const eligibility = evaluatePlayerEligibility(player, match, {
          teamMap,
          rankMap: teamRankMap,
          sameDayMatches: [],
          allSelections: currentSelections as SquadSelection[],
          allExceptions: [],
          matchCards: [],
          currentSeason: match.season || "",
          playersById: new Map([[player.id, player]]),
        });

        if (eligibility.status === "blocked") {
          errors.push({
            playerId: delta.playerId,
            reason: eligibility.reason || "Eligibility blocked",
          });
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
    await airtableBatchCreate(
      env,
      TABLES.squadSelection,
      toCreate.slice(i, i + 10),
    );
  }
  for (let i = 0; i < toUpdate.length; i += 10) {
    await airtableBatchUpdate(
      env,
      TABLES.squadSelection,
      toUpdate.slice(i, i + 10),
    );
  }
  for (let i = 0; i < toDelete.length; i += 10) {
    await airtableBatchDelete(
      env,
      TABLES.squadSelection,
      toDelete.slice(i, i + 10),
    );
  }

  // Invalidate caches
  invalidateCache(`players-for-match:${matchId}`);
  invalidateCache("upcoming-fixtures");

  return {
    success: errors.length === 0,
    created: toCreate.length,
    updated: toUpdate.length,
    deleted: toDelete.length,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// -- Selected Squad (read-only for players, Issue 11) -------------------

const POSITION_ORDER: Record<string, number> = {
  Goalkeeper: 0,
  Defender: 1,
  Midfielder: 2,
  Forward: 3,
};

const ABILITY_RANK: Record<string, number> = {
  "A+": 24, "A": 23, "A-": 22,
  "B+": 21, "B": 20, "B-": 19,
  "C+": 18, "C": 17, "C-": 16,
  "D+": 15, "D": 14, "D-": 13,
  "E+": 12, "E": 11, "E-": 10,
  "F+": 9,  "F": 8,  "F-": 7,
  "G+": 6,  "G": 5,  "G-": 4,
  "H+": 3,  "H": 2,  "H-": 1,
};

export async function getSquadForMatch(env: Env, matchId: string) {
  if (!matchId) throw new HttpError("matchId is required", 400);

  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);

  const selections = await airtableFindAll(
    env,
    TABLES.squadSelection,
    `AND({${escapeFormulaValue(SQUADSELECTIONS_FIELDS.match)}}="${escapeFormulaValue(matchId)}",{${escapeFormulaValue(SQUADSELECTIONS_FIELDS.selectionStatus)}}="Selected")`
  );

  const players: Array<{
    id: string;
    preferredName: string;
    position: string;
    ability: string;
  }> = [];

  for (const sel of selections) {
    const playerId = linkId(sel.fields[SQUADSELECTIONS_FIELDS.player]);
    if (!playerId) continue;

    const playerRecord = await airtableFindById(env, TABLES.player, playerId);
    if (!playerRecord) continue;
    const player = mapPlayer(playerRecord);

    players.push({
      id: player.id,
      preferredName: player.preferredName || player.givenNames || "Unknown",
      position: player.playingPosition || "",
      ability: player.playingAbility || "",
    });
  }

  players.sort((a, b) => {
    const posA = POSITION_ORDER[a.position] ?? 99;
    const posB = POSITION_ORDER[b.position] ?? 99;
    if (posA !== posB) return posA - posB;
    const abA = ABILITY_RANK[a.ability] ?? 0;
    const abB = ABILITY_RANK[b.ability] ?? 0;
    return abB - abA;
  });

  return { matchId, players };
}

