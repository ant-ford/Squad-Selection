/**
 * POST /api/admin/registration-events/:id/resolve (Supabase backend;
 * section "dataChecks": the Men's Convenor and the Section Captains).
 *
 * An automatic re-registration that couldn't be worked out safely is left
 * at needs_review (auto_reregister). The officer either moves the player up
 * to a team they choose, as the automatic move would have, or keeps him
 * where he is. resolve_registration_event does the change and its
 * activity_log row in one transaction.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { backendFor } from "./data/backend";
import { db, SupabaseError } from "./data/supabase";
import { invalidatePeople } from "./invalidation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEAM = 40;

export type ResolveAction = { action: "keep" } | { action: "move"; team: string };

/** Validates the body; throws a 400 the screen shows as it is. */
export function parseResolve(body: Record<string, unknown>): ResolveAction {
  if (body.action === "keep") return { action: "keep" };
  if (body.action === "move") {
    const team = typeof body.team === "string" ? body.team.trim() : "";
    if (!team || team.length > MAX_TEAM) throw new HttpError("Choose the team to move the player to.", 400, "INVALID_INPUT");
    return { action: "move", team };
  }
  throw new HttpError("Choose move or keep.", 400, "INVALID_INPUT");
}

const CONFLICTS: Record<string, string> = {
  ALREADY_RESOLVED: "This re-registration has already been dealt with.",
  OLD_SEASON: "This is from an earlier season: the player can only stay on their team.",
  TEAM_CHANGED: "Their registered team has changed since. Refresh and check again.",
  NOT_A_MOVE_UP: "Choose a team above their registered team.",
};

export async function resolveRegistrationEvent(
  env: Env,
  actor: AuthorizedUser,
  eventId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; team: string }> {
  if (backendFor(env, "people") !== "supabase") {
    throw new HttpError("Re-registrations are on the Supabase backend only.", 409, "NOT_YET");
  }
  if (!UUID.test(eventId)) throw new HttpError("Re-registration not found.", 404, "NOT_FOUND");
  const change = parseResolve(body);

  let result: { status: "ok"; team: string } | { status: "conflict"; code: string };
  try {
    result = await db(env).rpc("resolve_registration_event", {
      p_event: eventId,
      p_action: change.action,
      p_team: change.action === "move" ? change.team : null,
      p_actor: actor.personId,
    });
  } catch (err) {
    if (err instanceof SupabaseError && err.code === "P0002") throw new HttpError("Re-registration not found.", 404, "NOT_FOUND");
    if (err instanceof SupabaseError && err.code === "22023") throw new HttpError("Choose one of the club's teams.", 400, "INVALID_INPUT");
    throw err;
  }
  if (result.status === "conflict") {
    throw new HttpError(CONFLICTS[result.code] ?? "This re-registration can't be changed now.", 409, result.code);
  }
  // A move changes his registered team: eligibility, ranking and the boards read it.
  if (change.action === "move") await invalidatePeople(env);
  return { ok: true, team: result.team };
}
