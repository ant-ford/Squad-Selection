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
import { invalidateCache, invalidateCachePrefix } from "../../src/lib/cache";
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

function chunk<T>(items: T[], size = 10): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Find existing exceptions for a player across a set of matches.
 * Returns both the exceptions map AND the seasons involved for targeted cache invalidation.
 */
async function findPlayerExceptions(
  env: Env,
  playerId: string,
  matchIds: string[],
): Promise<{ exceptions: Map<string, AvailabilityException>; seasons: string[] }> {
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

  const seasons = [...matchSeasons];
  if (seasons.length === 0) return { exceptions: new Map(), seasons: [] };

  const formula =
    seasons.length === 1
      ? `{${AVAILABILITYEXCEPTIONS_FIELDS.season}}="${escapeFormulaValue(seasons[0])}"`
      : `OR(${seasons.map((s) => `{${AVAILABILITYEXCEPTIONS_FIELDS.season}}="${escapeFormulaValue(s)}"`).join(",")})`;

  const records = await airtableFindAll(env, TABLES.availabilityException, formula);
  const playerExceptions = records
    .map(mapAvailability)
    .filter((e) => linkId(e.player) === playerId);

  return {
    exceptions: new Map(playerExceptions.map((e) => [linkId(e.match) || "", e])),
    seasons,
  };
}

/**
 * Invalidation fan-out for availability writes.
 * Now correctly scoped to only invalidate the specific seasons involved.
 */
function invalidateAvailabilityCaches(matchIds: string[], seasons: string[]) {
  for (const matchId of matchIds) {
    invalidateCachePrefix(`players-for-match:${matchId}:`);
    invalidateCache(`availability:${matchId}`);
  }
  invalidateCachePrefix("exceptions:");
  for (const season of new Set(seasons)) {
    invalidateCache(`season-index:${season}`);
  }
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

  const { exceptions: exceptionByMatch, seasons } = await findPlayerExceptions(env, input.playerId, input.matchIds);

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

  for (const batch of chunk(toDelete)) await airtableBatchDelete(env, TABLES.availabilityException, batch);
  for (const batch of chunk(toUpdate)) await airtableBatchUpdate(env, TABLES.availabilityException, batch);
  for (const batch of chunk(toCreate)) await airtableBatchCreate(env, TABLES.availabilityException, batch);

  invalidateAvailabilityCaches(input.matchIds, seasons);
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

  let existingId: string | undefined;
  let seasons: string[] = [];

  if (input.existingExceptionId) {
    const rec = await airtableFindById(env, TABLES.availabilityException, input.existingExceptionId);
    if (rec) existingId = input.existingExceptionId;
  }

  if (!existingId) {
    const result = await findPlayerExceptions(env, user.id, [input.matchId]);
    existingId = result.exceptions.get(input.matchId)?.id;
    seasons = result.seasons;
  } else {
    // If we trusted the client ID, we still need the season for cache invalidation
    const matchRecord = await airtableFindById(env, TABLES.match, input.matchId);
    const season = matchRecord?.fields?.[MATCHES_FIELDS.season] || "";
    if (season) seasons = [season];
  }

  if (input.status === "Available") {
    if (existingId) {
      await airtableDelete(env, TABLES.availabilityException, existingId);
    }
    invalidateAvailabilityCaches([input.matchId], seasons);
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

  invalidateAvailabilityCaches([input.matchId], seasons);
  return { success: true, exceptionId: resultId };
}