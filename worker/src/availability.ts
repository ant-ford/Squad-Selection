import { people } from "./data/people";
import { availabilityExceptions, type AvailabilityOutcome } from "./data/availabilityExceptions";
import { SupabaseError } from "./data/supabase";
import type { Env } from "./env";
import { getPlayerByEmail } from "./reference";
import { HttpError } from "./http";
import { notYourTeam } from "./auth";
import type { Player } from "../../shared/schema/domainTypes";

type ExceptionStatus = "Available" | "Maybe" | "Unavailable";
type AvailabilityStatus = ExceptionStatus;

const VALID_STATUSES: AvailabilityStatus[] = ["Available", "Maybe", "Unavailable"];

/** Guard the exception model: anything outside the three statuses is rejected. */
function validateStatus(status: AvailabilityStatus): void {
  if (!VALID_STATUSES.includes(status)) {
    throw new HttpError("status must be Available, Maybe or Unavailable", 400);
  }
}

/**
 * set_availability's "not found" errors (P0002) as the 404s the screens
 * show. Anything else is a database error and goes up as one.
 */
function notFound(err: unknown): unknown {
  if (!(err instanceof SupabaseError) || err.code !== "P0002") return err;
  if (/No match/.test(err.message)) return new HttpError("Match not found", 404);
  if (/No person/.test(err.message)) return new HttpError("Person not found", 404);
  return new HttpError("Player not found or inactive", 404);
}

// Nothing is cleared after a write. Every read built on availability is
// kept under the cache versions (cache.ts getVersioned), and the database
// moves the availability_exceptions version in the same transaction as the
// answer, so every isolate's next request reads afresh; this request forgets
// its versions on the write (requestContext.ts noteRequestWrite).

/**
 * Says what this write actually saw and did. Setting yourself Available is
 * usually a delete, and a delete that finds nothing still reports success,
 * so from the outside a no-op and a real change are identical. Three
 * separate causes have hidden behind that, and each one cost a deploy to
 * guess at. One line here settles the next one.
 */
function logWrite(input: { playerId: string; matchIds: string[]; status: string }, outcome: AvailabilityOutcome) {
  console.log(
    "Availability write: " +
      JSON.stringify({
        player: input.playerId,
        matches: input.matchIds,
        status: input.status,
        exceptionsFoundForPlayer: outcome.before,
        results: outcome.results,
      }),
  );
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

/**
 * One answer for some matches, as ONE database call (set_availability).
 *
 * The read-modify-write happens inside the database, in one transaction,
 * under a per-player lock. It used to be about six round trips from here -
 * the player, the Scheduled matches, every answer of the season read fresh
 * (~177 KB), the rules and the reference data (~150 KB), then the write -
 * and two taps on different isolates could each act on the same old state:
 * deletes that never happened, and duplicate rows.
 *
 * The rules are the model's (availabilityRules.ts, memory note
 * availability-model-limits): Maybe/Unavailable are stored; Available is
 * stored only where it overrides something - the coach's Opt-In Only or one
 * of the player's own standing rules, on a Scheduled match - and otherwise
 * the player's row is deleted, because no row already means Available.
 */
export async function setAvailability(env: Env, input: SetAvailabilityInput) {
  if (!input.playerId || !Array.isArray(input.matchIds)) {
    throw new HttpError("playerId and matchIds[] are required", 400);
  }
  if (input.matchIds.some((id) => typeof id !== "string" || !id)) {
    throw new HttpError("matchIds[] must be record ids", 400);
  }
  validateStatus(input.status);

  let outcome: AvailabilityOutcome;
  try {
    outcome = await availabilityExceptions(env).set({
      playerId: input.playerId,
      matchIds: input.matchIds,
      status: input.status,
      notes: input.notes,
      updatedById: input.updatedById || input.playerId,
    });
  } catch (err) {
    throw notFound(err);
  }
  logWrite(input, outcome);
  return { success: true, updated: outcome.updated, results: outcome.results };
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
 * One database call (set_availability_for_date): it picks the Scheduled
 * matches on that Hong Kong day with an Active HKFC side and answers them
 * with set_availability's rules. Individual fixtures remain independently
 * overridable afterwards.
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

  let outcome: AvailabilityOutcome;
  try {
    outcome = await availabilityExceptions(env).setForDate({
      playerId: user.id,
      date: input.date,
      status: input.status,
      notes: input.notes,
    });
  } catch (err) {
    throw notFound(err);
  }
  const matchIds = outcome.results.map((r) => r.matchId);
  if (matchIds.length > 0) logWrite({ playerId: user.id, matchIds, status: input.status }, outcome);
  return { success: true, updated: outcome.results.length, results: outcome.results };
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
  input: {
    coachEmail: string;
    playerId: string;
    optInOnly: boolean;
    /**
     * Whether this coach may change this player's default; absent for those
     * who coach every team. 403 NOT_YOUR_TEAM otherwise (auth.ts
     * coachesPlayer: the player's shown or registered team is theirs).
     */
    mayChange?: (player: Player) => boolean;
  },
) {
  if (!input.playerId) throw new HttpError("playerId is required", 400);
  if (typeof input.optInOnly !== "boolean") {
    throw new HttpError("optInOnly must be a boolean", 400);
  }
  const player = await people(env).getById(input.playerId);
  if (!player) throw new HttpError("Player not found", 404);
  if (input.mayChange && !input.mayChange(player)) throw notYourTeam();

  await people(env).update(input.playerId, { optInOnly: input.optInOnly });

  console.log(
    `[Availability Audit] optInOnly=${input.optInOnly} player=${input.playerId} coach=${input.coachEmail}`,
  );

  // The flag changes the default answer on every unanswered fixture. Every
  // view built on it (the roster, the coach sheets, the season index, the
  // calendar feeds) is kept under the people version, which this update
  // moves: nothing to clear.

  return { success: true, playerId: input.playerId, optInOnly: input.optInOnly };
}
