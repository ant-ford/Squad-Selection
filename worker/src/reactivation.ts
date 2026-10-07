/**
 * Ask to be reactivated (6 Oct 2026 review, item D2). A signed-in member
 * whose record isn't Active asks from the "access not active" screen; every
 * Section Captain gets a My Tasks line, and the first to answer (Activate or
 * Not now) closes it for all. Eddy sends no email about it. The SQL is in
 * migration 20261007160304_reactivation.
 *
 *   GET  /api/reactivation          the signed-in email's open request, if any
 *   POST /api/reactivation          ask (verified email only: they have no access)
 *   GET  /api/reactivation/:id      a captain's view of one request
 *   POST /api/reactivation/:id      a captain's answer: {activate: boolean}
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { db, eq } from "./data/supabase";
import { invalidateCache } from "./cache";
import { selectedDisplayTeam } from "../../shared/displayTeam";

export interface ReactivationAsk {
  status: "asked" | "active" | "nobody" | "no-captains";
  askedAt?: string;
}

export interface ReactivationRequest {
  id: string;
  name: string;
  team: string | null;
  askedAt: string;
  inactiveSince: string | null;
  /** When someone answered; null while open. */
  doneAt: string | null;
  /** Who answered, when it's closed. */
  doneBy: string | null;
}

const NAME = "preferred_name,given_names,surname";
const nameOf = (p: { preferred_name: string | null; given_names: string | null; surname: string | null } | null) =>
  [p?.preferred_name || p?.given_names, p?.surname].filter(Boolean).join(" ") || "Someone";

export const reactivationTasksKey = (personId: string) => `reactivation-tasks:${personId}`;

export async function askToBeReactivated(env: Env, email: string): Promise<ReactivationAsk> {
  return db(env).rpc<ReactivationAsk>("request_reactivation", { p_email: email });
}

export async function reactivationStatus(env: Env, email: string): Promise<{ askedAt: string | null }> {
  return db(env).rpcRead<{ askedAt: string | null }>("reactivation_status", { p_email: email });
}

/** A Section Captain's open requests, for My Tasks. */
export async function openReactivationTasks(env: Env, me: string): Promise<{ id: string; subject: string }[]> {
  if (!me) return [];
  const rows = await db(env).select<{ id: string; who: Parameters<typeof nameOf>[0] }>(
    "steps",
    `select=id,who:people!steps_person_id_fkey(${NAME})&process=eq.reactivation&waiting_on_person_id=${eq(me)}&done_at=is.null&order=started_at`,
  );
  return rows.map((r) => ({ id: r.id, subject: nameOf(r.who) }));
}

const STEP_ID = /^[0-9a-f-]{36}$/;

export async function getReactivationRequest(env: Env, user: AuthorizedUser, stepId: string): Promise<ReactivationRequest> {
  if (!STEP_ID.test(stepId)) throw new HttpError("Request not found.", 404, "NOT_FOUND");
  const step = await db(env).one<{
    id: string;
    started_at: string;
    done_at: string | null;
    who: { preferred_name: string | null; given_names: string | null; surname: string | null; registered_team: string | null;
      selected_team_sos: string | null; selected_team_eos: string | null; inactive_since: string | null } | null;
    by: Parameters<typeof nameOf>[0];
  }>(
    "steps",
    `select=id,started_at,done_at,who:people!steps_person_id_fkey(${NAME},registered_team,selected_team_sos,selected_team_eos,inactive_since),by:people!steps_done_by_person_id_fkey(${NAME})` +
      `&id=${eq(stepId)}&process=eq.reactivation&waiting_on_person_id=${eq(user.personUuid)}`,
  );
  if (!step || !step.who) throw new HttpError("Request not found.", 404, "NOT_FOUND");
  const w = step.who;
  return {
    id: step.id,
    name: nameOf(w),
    team: selectedDisplayTeam({ registeredTeam: w.registered_team ?? undefined, selectedTeamSos: w.selected_team_sos ?? undefined, selectedTeamEos: w.selected_team_eos ?? undefined }) || null,
    askedAt: step.started_at,
    inactiveSince: w.inactive_since,
    doneAt: step.done_at,
    doneBy: step.done_at && step.by ? nameOf(step.by) : null,
  };
}

export async function answerReactivation(
  env: Env,
  user: AuthorizedUser,
  stepId: string,
  body: Record<string, unknown>,
): Promise<{ status: "activated" | "declined" | "closed" }> {
  if (!STEP_ID.test(stepId)) throw new HttpError("Request not found.", 404, "NOT_FOUND");
  if (typeof body.activate !== "boolean") throw new HttpError("Say whether to activate.", 400, "INVALID_INPUT");
  try {
    const result = await db(env).rpc<{ status: "activated" | "declined" | "closed" }>("answer_reactivation", {
      p_step: stepId,
      p_actor: user.personId,
      p_activate: body.activate,
    });
    invalidateCache(reactivationTasksKey(user.personId));
    return result;
  } catch (err) {
    if ((err as { code?: string }).code === "P0002") throw new HttpError("Request not found.", 404, "NOT_FOUND");
    throw err;
  }
}
