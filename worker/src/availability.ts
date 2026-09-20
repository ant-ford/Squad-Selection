import {
  AirtableError,
  airtableFindById,
  airtableUpdate,
  airtableBatchCreate,
  airtableBatchUpdate,
  airtableBatchDelete,
  linkId,
} from "./airtable";
import type { Env } from "./env";
import {
  getPlayerByEmail,
  getReferenceData,
  getExceptionsForSeasons,
  invalidatePlayerByEmail,
  invalidateReferenceData,
  UNRANKED_TEAM_RANK,
} from "./reference";
import { getScheduledMatches } from "./fixtures";
import { getRulesForPlayer, needsExplicitAvailable } from "./availabilityRules";
import { HttpError } from "./http";
import { TABLES } from "../../shared/schema/tableNames";
import { AVAILABILITYEXCEPTIONS_FIELDS, MATCHES_FIELDS, PEOPLE_FIELDS } from "../../shared/schema/fieldMaps";
import { mapPlayer } from "../../shared/mappers/playerMapper";
import { hkDateKey } from "../../shared/hkDateKey";
import { invalidateCache, invalidateCachePrefix, invalidateShared } from "./cache";
import type { AvailabilityException, Player } from "../../shared/schema/domainTypes";

type ExceptionStatus = "Available" | "Maybe" | "Unavailable";
type AvailabilityStatus = ExceptionStatus;

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

  // Never cached. This is a read-modify-write: what comes back decides
  // whether an exception is updated, created, or deleted.
  //
  // Setting yourself Available deletes the exception, and the delete only
  // happens if this read can see it. The cache is per-isolate, so an
  // exception written a moment ago on another isolate is simply absent here:
  // nothing gets deleted, the call still reports success, and the player
  // stays Unavailable no matter how many times they tap. The same gap
  // creates a duplicate row when the answer changes from Maybe to
  // Unavailable, because the existing record is invisible and a second one
  // is written instead.
  //
  // Selection sync already reads fresh on its write path for exactly this
  // reason; availability was the one write that did not.
  const allExceptions = await getExceptionsForSeasons(env, seasons, { fresh: true });
  const playerExceptions = allExceptions.filter((e) => linkId(e.player) === playerId);

  return {
    exceptions: new Map(playerExceptions.map((e) => [linkId(e.match) || "", e])),
    seasons,
  };
}

/**
 * Of these fixtures, which ones would read as something other than Available
 * if the player gave no answer at all?
 *
 * Available is normally expressed by DELETING the exception, which works
 * only while "no record" and "Available" mean the same thing. They stop
 * meaning the same thing the moment something supplies a different default:
 * a coach setting the player Opt-In Only, or one of the player's own
 * standing rules. Deleting the record there would hand the fixture straight
 * back to that default, so the player taps Available, the screen does not
 * change, and nothing explains why. For those fixtures the answer has to be
 * written down.
 */
async function fixturesNeedingExplicitAvailable(
  env: Env,
  player: Player,
  matchIds: string[],
): Promise<Set<string>> {
  const rules = await getRulesForPlayer(env, player.id);
  if (!player.optInOnly && rules.length === 0) return new Set();

  const ref = await getReferenceData(env);
  const matchesById = new Map((await getScheduledMatches(env)).map((m) => [m.id, m]));
  const playerRank = ref.teamRankMap[player.registeredTeam || ""] ?? UNRANKED_TEAM_RANK;
  const needed = new Set<string>();
  for (const matchId of matchIds) {
    const match = matchesById.get(matchId);
    if (!match) continue;
    // Which HKFC side this fixture is for the player decides whether it
    // counts as a play-up or a support game, exactly as the coach screens
    // resolve it.
    const sides = [match.homeTeam, match.awayTeam].filter(
      (t): t is string => Boolean(t) && ref.teamRankMap[t] !== undefined,
    );
    const fixtureRank = sides.length
      ? Math.min(...sides.map((t) => ref.teamRankMap[t] ?? UNRANKED_TEAM_RANK))
      : UNRANKED_TEAM_RANK;
    if (
      needsExplicitAvailable(
        rules,
        {
          date: hkDateKey(match.matchDate),
          isPlayUp: fixtureRank < playerRank,
          isSupport: fixtureRank > playerRank,
        },
        { optInOnly: player.optInOnly },
      )
    ) {
      needed.add(matchId);
    }
  }
  return needed;
}

/**
 * Invalidation fan-out for availability writes.
 * Now correctly scoped to only invalidate the specific seasons involved.
 */
async function invalidateAvailabilityCaches(env: Env, matchIds: string[], seasons: string[]) {
  for (const matchId of matchIds) {
    invalidateCachePrefix(`players-for-match:${matchId}:`);
    invalidateCache(`availability:${matchId}`);
  }
  for (const season of new Set(seasons)) {
    invalidateCache(`season-index:${season}`);
  }
  invalidateCachePrefix("calendar:player:");

  // Shared, so it has to be dropped everywhere: a coach on another isolate
  // was otherwise shown the answer this write replaced.
  await invalidateShared(env, [], ["exceptions:"]);
}

// ── Bulk set (admin / coach) ────────────────────────────────────────────
export interface SetAvailabilityInput {
  playerId: string;
  matchIds: string[];
  status: AvailabilityStatus;
  notes?: string;
  /**
   * Who is making the change, for the exception's Updated By link. Defaults
   * to the player: a coach answering on a player's behalf passes their own
   * id, so the record says who actually spoke.
   */
  updatedById?: string;
}

export async function setAvailability(env: Env, input: SetAvailabilityInput) {
  if (!input.playerId || !Array.isArray(input.matchIds)) {
    throw new HttpError("playerId and matchIds[] are required", 400);
  }
  if (input.matchIds.some((id) => typeof id !== "string" || !id)) {
    throw new HttpError("matchIds[] must be record ids", 400);
  }
  validateStatus(input.status);
  const playerRecord = await airtableFindById(env, TABLES.player, input.playerId);
  if (!playerRecord) throw new HttpError("Player not found or inactive", 404);
  const player = mapPlayer(playerRecord);
  if (!player.active) throw new HttpError("Player not found or inactive", 404);

  const { exceptions: exceptionByMatch, seasons } = await findPlayerExceptions(env, input.playerId, input.matchIds);

  // Says what this write actually saw and did. Setting yourself Available is
  // a delete, and a delete that finds nothing still reports success, so from
  // the outside a no-op and a real change are identical. Three separate
  // causes have now hidden behind that, and each one cost a deploy to guess
  // at. One line here settles the next one.
  console.log(
    "Availability write: " +
      JSON.stringify({
        player: input.playerId,
        matches: input.matchIds,
        status: input.status,
        seasonsResolved: seasons,
        exceptionsFoundForPlayer: [...exceptionByMatch.entries()].map(([matchId, e]) => ({
          matchId,
          exceptionId: e.id,
          status: e.availabilityStatus,
        })),
      }),
  );

  const toDelete: string[] = [];
  const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];
  const toCreate: { matchId: string; fields: Record<string, unknown> }[] = [];
  const results: { matchId: string; exceptionId: string | null }[] = [];

  // Which of these fixtures would NOT be Available if this player said
  // nothing - because a coach set them Opt-In Only, or because one of their
  // own standing rules covers it. Only those need an Available answer to be
  // written down; everywhere else the absence of a record still says it.
  const overrideNeeded =
    input.status === "Available"
      ? await fixturesNeedingExplicitAvailable(env, player, input.matchIds)
      : new Set<string>();

  for (const matchId of input.matchIds) {
    const existing = exceptionByMatch.get(matchId);
    if (input.status === "Available" && !overrideNeeded.has(matchId)) {
      // Nothing would contradict it, so absence still means Available and
      // the table stays sparse - the model the whole app is built on.
      if (existing) toDelete.push(existing.id);
      results.push({ matchId, exceptionId: null });
      continue;
    }
    const fields = buildExceptionFields({
      matchId,
      playerId: input.playerId,
      status: input.status,
      notes: input.notes,
      updatedById: input.updatedById || input.playerId,
    });
    if (existing) {
      toUpdate.push({ id: existing.id, fields });
      results.push({ matchId, exceptionId: existing.id });
    } else {
      toCreate.push({ matchId, fields });
    }
  }

  console.log(
    "Availability write outcome: " +
      JSON.stringify({ deleting: toDelete, updating: toUpdate.map((u) => u.id), creating: toCreate.length }),
  );

  for (const batch of chunk(toDelete)) await airtableBatchDelete(env, TABLES.availabilityException, batch);
  for (const batch of chunk(toUpdate)) await airtableBatchUpdate(env, TABLES.availabilityException, batch);
  const createdBatches: { matchId: string; id: string }[] = [];
  for (const batch of chunk(toCreate)) {
    const created = await airtableBatchCreate(env, TABLES.availabilityException, batch.map((x) => x.fields));
    (created?.records ?? []).forEach((rec: any, idx: number) => createdBatches.push({ matchId: batch[idx]?.matchId, id: rec.id }));
  }
  for (const c of createdBatches) results.push({ matchId: c.matchId, exceptionId: c.id });

  await invalidateAvailabilityCaches(env, input.matchIds, seasons);
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

// ── Coach on a player's behalf ──────────────────────────────────────────
export interface SetPlayerAvailabilityInput {
  /** The coach's People record id, from the verified session. */
  coachPersonId: string;
  playerId: string;
  matchId: string;
  status: AvailabilityStatus;
  notes?: string;
}

/**
 * A coach answers for a player who cannot get into the app - a message on
 * the pitch, a phone call, a player without a login yet. Same write as the
 * player's own tap, so every downstream view (the coach's list, the tiles,
 * the calendar) moves together; the only difference is that Updated By
 * records the coach.
 *
 * Note the exception model's one blind spot, which this inherits: Available
 * is a deletion, so it cannot override a standing rule of the player's that
 * says otherwise. That needs an Available choice on the Airtable field.
 */
export async function setPlayerAvailability(env: Env, input: SetPlayerAvailabilityInput) {
  if (!input.coachPersonId) throw new HttpError("Coach identity is required", 400);
  if (!input.playerId || !input.matchId) throw new HttpError("playerId and matchId are required", 400);
  validateStatus(input.status);
  const { results } = await setAvailability(env, {
    playerId: input.playerId,
    matchIds: [input.matchId],
    status: input.status,
    notes: input.notes,
    updatedById: input.coachPersonId,
  });
  console.log(
    `[Availability Audit] coach=${input.coachPersonId} player=${input.playerId} match=${input.matchId} status=${input.status}`,
  );
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
// ---------------------------------------------------------------------
// Opt-In Only (coach-controlled default inversion)
// ---------------------------------------------------------------------

/**
 * Flip one player between the club default (available unless they say
 * otherwise) and opt-in only (unavailable unless they say otherwise).
 *
 * The club runs on opt-out because nobody fills in forms for thirty
 * fixtures. That breaks down for the player who is out most of the season
 * and never touches the app: they show Available on every coach sheet,
 * which is worse than silence, because it reads as an answer. This inverts
 * the default for that player alone.
 *
 * Deliberately a People field a coach controls rather than one of the
 * player's own standing rules. The players it exists for are the ones not
 * keeping their status current, so it must not be something they can
 * quietly switch off - and a standing rule is self-service by design.
 * Answering an actual fixture still wins over it, because that is the
 * opting in the whole thing is named for.
 */
export async function setPlayerOptInOnly(
  env: Env,
  input: { coachEmail: string; playerId: string; optInOnly: boolean },
) {
  if (!input.playerId) throw new HttpError("playerId is required", 400);
  if (typeof input.optInOnly !== "boolean") {
    throw new HttpError("optInOnly must be a boolean", 400);
  }
  const record = await airtableFindById(env, TABLES.player, input.playerId);
  if (!record) throw new HttpError("Player not found", 404);

  try {
    await airtableUpdate(env, TABLES.player, input.playerId, {
      [PEOPLE_FIELDS.optInOnly]: input.optInOnly,
    });
  } catch (err) {
    // The field is added by hand in Airtable (see README). Until it exists
    // every write here fails, and "422" tells a coach nothing - so say what
    // is actually missing.
    if (err instanceof AirtableError && (err.status === 422 || err.status === 404)) {
      console.error(`People."${PEOPLE_FIELDS.optInOnly}" missing or not a checkbox:`, err.message);
      throw new HttpError(
        `This needs the "${PEOPLE_FIELDS.optInOnly}" checkbox on the People table in Airtable.`,
        501,
        "OPT_IN_ONLY_NOT_CONFIGURED",
      );
    }
    throw err;
  }

  console.log(
    `[Availability Audit] optInOnly=${input.optInOnly} player=${input.playerId} coach=${input.coachEmail}`,
  );

  // The flag changes the default answer on every unanswered fixture, so
  // every derived view of this player has to be rebuilt: the roster it is
  // read from, the coach sheets, the season index and the calendar feeds.
  const email = record.fields?.[PEOPLE_FIELDS.email];
  if (typeof email === "string") invalidatePlayerByEmail(email, env);
  invalidateCachePrefix("players-for-match:");
  invalidateCachePrefix("season-index:");
  invalidateCachePrefix("calendar:");
  await invalidateReferenceData(env);

  return { success: true, playerId: input.playerId, optInOnly: input.optInOnly };
}
