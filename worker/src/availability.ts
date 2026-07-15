import {
  Env,
  airtableFindAll,
  airtableFindById,
  airtableCreate,
  airtableUpdate,
  airtableDelete,
  linkId,
} from "./airtable";
import { getPlayerByEmail } from "./reference";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { AVAILABILITYEXCEPTIONS_FIELDS } from "../../src/generated/fieldMaps";
import { mapPlayer } from "../../src/mappers/playerMapper";
import { mapAvailability } from "../../src/mappers/availabilityMapper";
import { invalidateCache } from "../../src/lib/cache";

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
    [AVAILABILITYEXCEPTIONS_FIELDS.availabilityStatus]: [opts.status],
    [AVAILABILITYEXCEPTIONS_FIELDS.note]: opts.notes || "",
    [AVAILABILITYEXCEPTIONS_FIELDS.updatedBy]: [opts.updatedById],
  };
}

export interface SetAvailabilityInput {
  playerId: string;
  matchIds: string[];
  status: AvailabilityStatus;
  notes?: string;
}

/** Coach-facing bulk update. */
export async function setAvailability(env: Env, input: SetAvailabilityInput) {
  if (!input.playerId || !Array.isArray(input.matchIds)) {
    throw new HttpError("playerId and matchIds[] are required", 400);
  }

  const playerRecord = await airtableFindById(env, TABLES.player, input.playerId);
  if (!playerRecord) throw new HttpError("Player not found or inactive", 404);
  const player = mapPlayer(playerRecord);
  if (!player.active) throw new HttpError("Player not found or inactive", 404);

  const allExceptions = (await airtableFindAll(env, TABLES.availabilityException)).map(
    mapAvailability
  );
  const playerExceptions = allExceptions.filter((e) => linkId(e.player) === input.playerId);
  const exceptionByMatch = new Map(playerExceptions.map((e) => [linkId(e.match) || "", e]));

  let updated = 0;

  for (const matchId of input.matchIds) {
    const existing = exceptionByMatch.get(matchId);

    if (input.status === "Available") {
      if (existing) {
        // Instead of deleting, update to "Available"
        await airtableUpdate(env, TABLES.availabilityException, existing.id, {
          [AVAILABILITYEXCEPTIONS_FIELDS.availabilityStatus]: ["Available"],
          [AVAILABILITYEXCEPTIONS_FIELDS.note]: input.notes || "",
          [AVAILABILITYEXCEPTIONS_FIELDS.updatedBy]: [input.playerId],
        });
        updated++;
      }
      // Note: we do NOT invalidate per-match cache here because we want the updated status to reflect immediately.
      // But we must ensure the cache is invalidated later.
      invalidateCache(`players-for-match:${matchId}`);
      invalidateCache('upcomingFixtures');
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
      await airtableUpdate(env, TABLES.availabilityException, existing.id, fields);
    } else {
      await airtableCreate(env, TABLES.availabilityException, fields);
    }
    updated++;
    invalidateCache(`players-for-match:${matchId}`);
  }

  invalidateCache('upcomingFixtures');
  return { success: true, updated };
}

export interface SetMyAvailabilityInput {
  email: string;
  matchId: string;
  status: AvailabilityStatus;
  notes?: string;
  existingExceptionId?: string;
}

/** Player-facing (unauthenticated) availability update. */
export async function setMyAvailability(env: Env, input: SetMyAvailabilityInput) {
  if (!input.email || !input.matchId) {
    throw new HttpError("email and matchId are required", 400);
  }

  const user = await getPlayerByEmail(env, input.email);
  if (!user) throw new HttpError("Player record not found for this email", 404);

  if (input.status === "Available") {
    if (input.existingExceptionId) {
      // Update to "Available" instead of deleting
      await airtableUpdate(env, TABLES.availabilityException, input.existingExceptionId, {
        [AVAILABILITYEXCEPTIONS_FIELDS.availabilityStatus]: ["Available"],
        [AVAILABILITYEXCEPTIONS_FIELDS.note]: input.notes || "",
        [AVAILABILITYEXCEPTIONS_FIELDS.updatedBy]: [user.id],
      });
    }
    invalidateCache(`players-for-match:${input.matchId}`);
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

  invalidateCache(`players-for-match:${input.matchId}`);
  return { success: true };
}