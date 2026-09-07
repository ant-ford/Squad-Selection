import {
  airtableFindById,
  airtableBatchCreate,
  airtableBatchUpdate,
  airtableBatchDelete,
  linkId,
} from "./airtable";
import type { Env } from "./env";
import { getPlayerByEmail, getReferenceData, getExceptionsForSeasons } from "./reference";
import { getScheduledMatches } from "./fixtures";
import { HttpError } from "./http";
import { TABLES } from "../../shared/schema/tableNames";
import { AVAILABILITYEXCEPTIONS_FIELDS, MATCHES_FIELDS } from "../../shared/schema/fieldMaps";
import { mapPlayer } from "../../shared/mappers/playerMapper";
import { hkDateKey } from "../../shared/hkDateKey";
import { invalidateCache, invalidateCachePrefix } from "./cache";
import type { AvailabilityException } from "../../shared/schema/domainTypes";

type ExceptionStatus = "Maybe" | "Unavailable";
type AvailabilityStatus = "Available" | ExceptionStatus;

const VALID_STATUSES: AvailabilityStatus[] = ["Available", "Maybe", "Unavailable"];

/** Guard the exception model: anything outside the three statuses is rejected. */
function validateStatus(status: AvailabilityStatus): void {
  if (!VALID_STATUSES.includes(status)) {
    throw new HttpError("status must be Available, Maybe or Unavailable", 400);
  }
}

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
 *
 * Resolves each match's season from the cached Scheduled-matches list (10min
 * TTL) rather than one airtableFindById per match, and reads exceptions
 * through the cached per-season index (5min TTL) rather than a fresh scan -
 * a caller polling the same matches repeatedly costs zero Airtable calls
 * once both caches are warm.
 */
async function findPlayerExceptions(
  env: Env,
  playerId: string,
  matchIds: string[],
): Promise<{ exceptions: Map<string, AvailabilityException>; seasons: string[] }> {
  const scheduledById = new Map((await getScheduledMatches(env)).map((m) => [m.id, m]));
  const matchSeasons = new Set<string>();
  const unresolvedIds: string[] = [];
  for (const matchId of matchIds) {
    const season = scheduledById.get(matchId)?.season;
    if (season) matchSeasons.add(season);
    else unresolvedIds.push(matchId);
  }
  // A match not in the Scheduled cache (e.g. its status just changed) still
  // needs its season resolved fresh, so its exceptions are never silently skipped.
  for (const matchId of unresolvedIds) {
    const record = await airtableFindById(env, TABLES.match, matchId);
    const season = record?.fields?.[MATCHES_FIELDS.season] || "";
    if (season) matchSeasons.add(season);
  }

  const seasons = [...matchSeasons];
  if (seasons.length === 0) return { exceptions: new Map(), seasons: [] };

  const allExceptions = await getExceptionsForSeasons(env, seasons);
  const playerExceptions = allExceptions.filter((e) => linkId(e.player) === playerId);

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
  validateStatus(input.status);
  const playerRecord = await airtableFindById(env, TABLES.player, input.playerId);
  if (!playerRecord) throw new HttpError("Player not found or inactive", 404);
  const player = mapPlayer(playerRecord);
  if (!player.active) throw new HttpError("Player not found or inactive", 404);

  const { exceptions: exceptionByMatch, seasons } = await findPlayerExceptions(env, input.playerId, input.matchIds);

  const toDelete: string[] = [];
  const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];
  const toCreate: { matchId: string; fields: Record<string, unknown> }[] = [];
  const results: { matchId: string; exceptionId: string | null }[] = [];

  for (const matchId of input.matchIds) {
    const existing = exceptionByMatch.get(matchId);
    if (input.status === "Available") {
      // No exception = Available: delete rather than create an Available record.
      if (existing) toDelete.push(existing.id);
      results.push({ matchId, exceptionId: null });
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
      results.push({ matchId, exceptionId: existing.id });
    } else {
      toCreate.push({ matchId, fields });
    }
  }

  for (const batch of chunk(toDelete)) await airtableBatchDelete(env, TABLES.availabilityException, batch);
  for (const batch of chunk(toUpdate)) await airtableBatchUpdate(env, TABLES.availabilityException, batch);
  const createdBatches: { matchId: string; id: string }[] = [];
  for (const batch of chunk(toCreate)) {
    const created = await airtableBatchCreate(env, TABLES.availabilityException, batch.map((x) => x.fields));
    (created?.records ?? []).forEach((rec: any, idx: number) => createdBatches.push({ matchId: batch[idx]?.matchId, id: rec.id }));
  }
  for (const c of createdBatches) results.push({ matchId: c.matchId, exceptionId: c.id });

  invalidateAvailabilityCaches(input.matchIds, seasons);
  return { success: true, updated: results.length, results };
}

// ── Player self-service ─────────────────────────────────────────────────
export interface SetMyAvailabilityInput {
  email: string;
  matchId: string;
  status: AvailabilityStatus;
  notes?: string;
}

export async function setMyAvailability(env: Env, input: SetMyAvailabilityInput) {
  if (!input.email || !input.matchId) throw new HttpError("email and matchId are required", 400);
  validateStatus(input.status);
  const user = await getPlayerByEmail(env, input.email);
  if (!user) throw new HttpError("Player record not found for this email", 404);

  const { results } = await setAvailability(env, {
    playerId: user.id,
    matchIds: [input.matchId],
    status: input.status,
    notes: input.notes,
  });
  return { success: true, exceptionId: results[0]?.exceptionId ?? null };
}

// ---------------------------------------------------------------------
// Date-level bulk availability (special goalkeeper view UX shortcut)
// ---------------------------------------------------------------------
export interface SetMyAvailabilityForDateInput {
  email: string;
  /** Calendar date (YYYY-MM-DD, the match's local date key). */
  date: string;
  status: AvailabilityStatus;
  notes?: string;
}

/**
 * Bulk-apply availability for every HKFC fixture on one date.
 *
 * Originally a shortcut for the special goalkeeper view, now open to every
 * authorized player: "I'm away this Saturday" is the single most common
 * thing a player needs to say, and doing it one card at a time is the most
 * common complaint. The date deliberately covers EVERY HKFC fixture that
 * day, not just the player's own team - marking yourself out should also
 * take you out of the play-up and support pools without further taps.
 *
 * Underneath it performs the existing match-level updates (exceptions
 * upserted, "Available" deletes exceptions - no Available records are ever
 * created). Individual fixtures remain independently overridable afterwards.
 */
export async function setMyAvailabilityForDate(env: Env, input: SetMyAvailabilityForDateInput) {
  if (!input.email || !input.date || !input.status) {
    throw new HttpError("email, date and status are required", 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new HttpError("date must be formatted YYYY-MM-DD", 400);
  }
  validateStatus(input.status);
  const user = await getPlayerByEmail(env, input.email);
  if (!user) throw new HttpError("Player record not found for this email", 404);
  const ref = await getReferenceData(env);
  const teamNames = new Set(ref.teams.map((t) => t.teamName));
  const matchIds = (await getScheduledMatches(env))
    .filter((m) => hkDateKey(m.matchDate) === input.date)
    .filter((m) => teamNames.has(m.homeTeam || "") || teamNames.has(m.awayTeam || ""))
    .map((m) => m.id);
  if (matchIds.length === 0) {
    return { success: true, updated: 0, results: [] as { matchId: string; exceptionId: string | null }[] };
  }
  const { results } = await setAvailability(env, {
    playerId: user.id,
    matchIds,
    status: input.status,
    notes: input.notes,
  });
  return { success: true, updated: results.length, results };
}