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
import { AVAILABILITYEXCEPTIONS_FIELDS } from "../../src/generated/fieldMaps";
import { mapPlayer } from "../../src/mappers/playerMapper";
import { mapAvailability } from "../../src/mappers/availabilityMapper";
import { invalidateCache, invalidateCachePrefix } from "../../src/lib/cache";

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

  // Item 6: player-scoped fetch instead of a full-table scan — this
  // player will only ever have a handful of exception records.
  const playerExceptionRecords = await airtableFindAll(
    env,
    TABLES.availabilityException,
    `FIND("${escapeFormulaValue(input.playerId)}", {${AVAILABILITYEXCEPTIONS_FIELDS.player}}) > 0`
  );
  const playerExceptions = playerExceptionRecords.map(mapAvailability);
  const exceptionByMatch = new Map(playerExceptions.map((e) => [linkId(e.match) || "", e]));

  const toDelete: string[] = [];
  const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];
  const toCreate: Record<string, unknown>[] = [];

  for (const matchId of input.matchIds) {
    const existing = exceptionByMatch.get(matchId);
    if (input.status === "Available") {
      // No "Available" select item exists; delete the exception record.
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

  // Item 7: batched instead of one Airtable round-trip per match.
  for (const batch of chunk(toDelete)) {
    await airtableBatchDelete(env, TABLES.availabilityException, batch);
  }
  for (const batch of chunk(toUpdate)) {
    await airtableBatchUpdate(env, TABLES.availabilityException, batch);
  }
  for (const batch of chunk(toCreate)) {
    await airtableBatchCreate(env, TABLES.availabilityException, batch);
  }

  // Item 3: invalidateCache expects an exact key; the real cache keys are
  // `players-for-match:${matchId}:${side}`, so this must be a prefix wipe.
  for (const matchId of input.matchIds) {
    invalidateCachePrefix(`players-for-match:${matchId}:`);
  }
  invalidateCachePrefix("exceptions:");

  return { success: true, updated: toDelete.length + toUpdate.length + toCreate.length };
}

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
  if (input.status === "Available") {
    if (input.existingExceptionId) {
      await airtableDelete(env, TABLES.availabilityException, input.existingExceptionId);
    }
    invalidateCachePrefix(`players-for-match:${input.matchId}:`);
    invalidateCachePrefix("exceptions:");
    return { success: true };
  }
  const fields = buildExceptionFields({
    matchId: input.matchId,
    playerId: user.id,
    status: input.status,
    notes: input.notes,
    updatedById: user.id,
  });
  if (input.existingExceptionId) {
    await airtableUpdate(env, TABLES.availabilityException, input.existingExceptionId, fields);
  } else {
    await airtableCreate(env, TABLES.availabilityException, fields);
  }
  invalidateCachePrefix(`players-for-match:${input.matchId}:`);
  invalidateCachePrefix("exceptions:");
  return { success: true };
}