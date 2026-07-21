import {
  Env,
  airtableFindAll,
  airtableFindById,
  airtableCreate,
  airtableUpdate,
  airtableDelete,
  airtableBatchCreate,
  airtableBatchUpdate,
  airtableBatchDelete,
  escapeFormulaValue,
  linkId,
} from "./airtable";
import { getPlayerByEmail } from "./reference";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { AVAILABILITYEXCEPTIONS_FIELDS, MATCHES_FIELDS } from "../../src/generated/fieldMaps";
import { mapPlayer } from "../../src/mappers/playerMapper";
import { mapAvailability } from "../../src/mappers/availabilityMapper";
import { invalidateCachePrefix } from "../../src/lib/cache";
import type { AvailabilityException } from "../../src/generated/domainTypes";

type ExceptionStatus = "Maybe" | "Unavailable";
type AvailabilityStatus = "Available" | ExceptionStatus;

function buildExceptionFields(opts: {
  matchId: string;
  playerId: string;
  status: ExceptionStatus;
  notes?: string;
  updatedById: string;
}): Record<string, unknown> {
  return {
    [AVAILABILITYEXCEPTIONS_FIELDS.match]: [opts.matchId],
    [AVAILABILITYEXCEPTIONS_FIELDS.player]: [opts.playerId],
    [AVAILABILITYEXCEPTIONS_FIELDS.availabilityStatus]: opts.status,
    [AVAILABILITYEXCEPTIONS_FIELDS.note]: opts.notes || "",
    [AVAILABILITYEXCEPTIONS_FIELDS.updatedBy]: [opts.updatedById],
  };
}

/** Airtable batch endpoints accept at most 10 records per request. */
function chunk<T>(items: T[], size = 10): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Find existing exceptions for a player across a set of matches.
 *
 * Queries by the Season (Matches) LOOKUP field — which returns plain text
 * and is reliable in filterByFormula — then filters by player + match in
 * code.  The old approach used FIND("recId", {Player}) which silently
 * fails because Airtable resolves linked-record fields to their primary
 * field value (the player's name), not the record ID.
 */
async function findPlayerExceptions(
  env: Env,
  playerId: string,
  matchIds: string[],
): Promise<Map<string, AvailabilityException>> {
  // Collect the seasons that cover the requested matches (parallel fetch)
  const matchSeasons = new Set<string>();
  const matchRecords = await Promise.all(
    matchIds.map((matchId) => airtableFindById(env, TABLES.match, matchId)),
  );
  for (const matchRecord of matchRecords) {
    if (matchRecord) {
      const season = matchRecord.fields?.[MATCHES_FIELDS.season] || "";
      if (season) matchSeasons.add(season);
    }
  }

  if (matchSeasons.size === 0) return new Map();

  const seasons = [...matchSeasons];
  const formula =
    seasons.length === 1
      ? `{${AVAILABILITYEXCEPTIONS_FIELDS.season}}="${escapeFormulaValue(seasons[0])}"`
      : `OR(${seasons.map((s) => `{${AVAILABILITYEXCEPTIONS_FIELDS.season}}="${escapeFormulaValue(s)}"`).join(",")})`;

  const records = await airtableFindAll(env, TABLES.availabilityException, formula);
  const playerExceptions = records
    .map(mapAvailability)
    .filter((e) => linkId(e.player) === playerId);

  return new Map(playerExceptions.map((e) => [linkId(e.match) || "", e]));
}

/**
 * Invalidation fan-out for availability writes (Invariant #11):
 *   players-for-match:${matchId}:  → annotated eligibility output
 *   exceptions:                    → season exception cache in reference.ts
 *   season-index:                  → unavailablePlayerMatchKeys drives the
 *                                    same-day higher-team lockout
 *   calendar:player:               → player ICS feeds embed availability
 */
function invalidateAvailabilityCaches(matchIds: string[]) {
  for (const matchId of matchIds) {
    invalidateCachePrefix(`players-for-match:${matchId}:`);
  }
  invalidateCachePrefix("exceptions:");
  invalidateCachePrefix("season-index:");
  invalidateCachePrefix("calendar:player:");
}

// ── Bulk set (admin / coach) ────────────────────────────────────────────

export interface SetAvailabilityInput {
  playerId: string;
  matchIds: string[];
  status: AvailabilityStatus;
  notes?: string;
}

export async function setAvailability(env: Env, input: SetAvailabilityInput) {
  if (!input.playerId || !Array.isArray(input.matchIds)) {
    throw new HttpError("playerId and matchIds[] are required", 400);
  }

  const playerRecord = await airtableFindById(env, TABLES.player, input.playerId);
  if (!playerRecord) throw new HttpError("Player not found or inactive", 404);
  const player = mapPlayer(playerRecord);
  if (!player.active) throw new HttpError("Player not found or inactive", 404);

  const exceptionByMatch = await findPlayerExceptions(env, input.playerId, input.matchIds);

  const toDelete: string[] = [];
  const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];
  const toCreate: Record<string, unknown>[] = [];

  for (const matchId of input.matchIds) {
    const existing = exceptionByMatch.get(matchId);
    if (input.status === "Available") {
      if (existing) toDelete.push(existing.id);
      continue;
    }
    const fields = buildExceptionFields({
      matchId,
      playerId: input.playerId,
      status: input.status,
      notes: input.notes,
      updatedById: input.playerId,
    });
    if (existing) {
      toUpdate.push({ id: existing.id, fields });
    } else {
      toCreate.push(fields);
    }
  }

  for (const batch of chunk(toDelete)) {
    await airtableBatchDelete(env, TABLES.availabilityException, batch);
  }
  for (const batch of chunk(toUpdate)) {
    await airtableBatchUpdate(env, TABLES.availabilityException, batch);
  }
  for (const batch of chunk(toCreate)) {
    await airtableBatchCreate(env, TABLES.availabilityException, batch);
  }

  invalidateAvailabilityCaches(input.matchIds);
  return { success: true, updated: toDelete.length + toUpdate.length + toCreate.length };
}

// ── Player self-service ─────────────────────────────────────────────────

export interface SetMyAvailabilityInput {
  email: string;
  matchId: string;
  status: AvailabilityStatus;
  notes?: string;
  existingExceptionId?: string;
}

export async function setMyAvailability(env: Env, input: SetMyAvailabilityInput) {
  if (!input.email || !input.matchId) throw new HttpError("email and matchId are required", 400);

  const user = await getPlayerByEmail(env, input.email);
  if (!user) throw new HttpError("Player record not found for this email", 404);

  // --- Locate any existing exception for this player + match ---
  let existingId: string | undefined;

  // Strategy 1: trust the client-provided ID (fastest path)
  if (input.existingExceptionId) {
    const rec = await airtableFindById(env, TABLES.availabilityException, input.existingExceptionId);
    if (rec) existingId = input.existingExceptionId;
  }

  // Strategy 2: look up by season (reliable lookup field) + filter in code
  if (!existingId) {
    const byMatch = await findPlayerExceptions(env, user.id, [input.matchId]);
    existingId = byMatch.get(input.matchId)?.id;
  }

  // --- Apply the change ---
  if (input.status === "Available") {
    // "Available" = no exception record (exception-only model, Invariant #10)
    if (existingId) {
      await airtableDelete(env, TABLES.availabilityException, existingId);
    }
    invalidateAvailabilityCaches([input.matchId]);
    return { success: true, exceptionId: null };
  }

  const fields = buildExceptionFields({
    matchId: input.matchId,
    playerId: user.id,
    status: input.status,
    notes: input.notes,
    updatedById: user.id,
  });

  let resultId: string;
  if (existingId) {
    await airtableUpdate(env, TABLES.availabilityException, existingId, fields);
    resultId = existingId;
  } else {
    const created = await airtableCreate(env, TABLES.availabilityException, fields);
    resultId = created.id;
  }

  invalidateAvailabilityCaches([input.matchId]);
  return { success: true, exceptionId: resultId };
}