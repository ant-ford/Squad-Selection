import type { Env } from "../env";
import type { AuthorizedUser } from "../auth";
import { HttpError } from "../http";
import { db, eq, inList } from "../data/supabase";
import { getCached, invalidateCachePrefix } from "../cache";
import { eventRights } from "../eventAccess";
import {
  checkInOpen,
  guestsCameOf,
  needsRegister,
  registerOpen,
  type CheckInView,
  type Guest,
} from "../../../shared/events";
import {
  text,
  type NameParts,
  nameOf,
  type EventRow,
  EVENT_COLS,
  type ResponseRow,
  RESPONSE_COLS,
  RESPONSE_KEY,
  toDetails,
  toResponse,
  loadEvent,
  requireManages,
} from "./shared";
import type { EventTask } from "./tasks";

// ── Who came: the register and check-in ──────────────────────────────────

const appOrigin = (env: Env) => (env.APP_ORIGIN ?? "https://app.eddy.global").replace(/\/+$/, "");
export const newCheckinCode = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The event's check-in code, made the first time it's needed (events from before the register have none). */
async function checkinCodeOf(env: Env, event: EventRow): Promise<string> {
  if (event.checkin_code) return event.checkin_code;
  const code = newCheckinCode();
  const [row] = await db(env).update<{ checkin_code: string }>("events", `id=${eq(event.id)}&checkin_code=is.null`, { checkin_code: code });
  if (row) return row.checkin_code;
  // Someone else made it a moment ago.
  return (await db(env).one<{ checkin_code: string }>("events", `select=checkin_code&id=${eq(event.id)}`))!.checkin_code;
}

/** The link in the check-in QR code. */
export async function checkinLink(env: Env, user: AuthorizedUser, id: string): Promise<{ url: string }> {
  const { event } = await requireManages(env, user, id);
  return { url: `${appOrigin(env)}/checkin/${event.id}?c=${await checkinCodeOf(env, event)}` };
}

function requireRegisterOpen(event: EventRow): void {
  if (event.status !== "published") throw new HttpError("The register is for published events.", 409, "NOT_PUBLISHED");
  if (!registerOpen(toDetails(event, null))) throw new HttpError("The register opens an hour before the start.", 409, "NOT_STARTED");
}

/**
 * Ticks someone on the register (or unticks them), with how many of their
 * guests came. Someone who turned up without answering is added as Going:
 * they came, so they're charged like anyone else.
 */
export async function setAttendance(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const { event } = await requireManages(env, user, id);
  requireRegisterOpen(event);
  const d = db(env);
  const person = await d.one<{ id: string }>("people", `select=id&api_id=${eq(text(body.personId, 40))}`);
  if (!person) throw new HttpError("That person wasn't found.", 404, "NOT_FOUND");
  const attended = body.attended === true;
  const where = `event_id=${eq(event.id)}&person_id=${eq(person.id)}`;
  const existing = await d.one<{ guests: Guest[] | null }>("event_responses", `select=guests&${where}`);
  if (!existing) {
    if (!attended) return { ok: true };
    await d.insert("event_responses", [{ event_id: event.id, person_id: person.id, status: "going", attended: true }]);
    return { ok: true };
  }
  const guests = Array.isArray(existing.guests) ? existing.guests.length : 0;
  const patch: Record<string, unknown> = { attended };
  // Ticked as here means Going; unticking leaves their answer alone.
  if (attended) patch.status = "going";
  if (body.guestsCame !== undefined) patch.guests_came = attended ? guestsCameOf(body.guestsCame, guests) : null;
  else if (!attended) patch.guests_came = null;
  await d.update("event_responses", where, patch);
  return { ok: true };
}

/** Ticks everyone who said Going, with all their guests (then untick the few who didn't come). */
export async function tickEveryone(env: Env, user: AuthorizedUser, id: string): Promise<{ ticked: number }> {
  const { event } = await requireManages(env, user, id);
  requireRegisterOpen(event);
  const d = db(env);
  const rows = await d.select<{ person_id: string; guests: Guest[] | null }>("event_responses", `select=person_id,guests&event_id=${eq(event.id)}&status=eq.going&attended=is.false`, RESPONSE_KEY);
  // Grouped by how many guests, so it's one write per size rather than per person.
  const bySize = new Map<number, string[]>();
  for (const r of rows) {
    const n = Array.isArray(r.guests) ? r.guests.length : 0;
    bySize.set(n, [...(bySize.get(n) ?? []), r.person_id]);
  }
  for (const [n, ids] of bySize) {
    await d.update("event_responses", `event_id=${eq(event.id)}&person_id=${inList(ids)}`, { attended: true, guests_came: n || null });
  }
  return { ticked: rows.length };
}

/** The register is done (or reopened): the My Tasks line goes. */
export async function setRegisterTaken(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const { event } = await requireManages(env, user, id);
  requireRegisterOpen(event);
  await db(env).update("events", `id=${eq(event.id)}`, { register_taken_at: body.taken === false ? null : new Date().toISOString() });
  invalidateCachePrefix("register-tasks:");
  return { ok: true };
}

async function loadForCheckIn(env: Env, id: string, code: unknown): Promise<EventRow> {
  const event = await loadEvent(env, id);
  if (event.status === "draft" || !event.checkin_code || typeof code !== "string" || code !== event.checkin_code) {
    throw new HttpError("This check-in code isn't right. Scan the QR code at the event again.", 404, "NOT_FOUND");
  }
  return event;
}

/** What someone sees when they scan the QR code: themselves, and anyone they signed up. */
export async function getCheckIn(env: Env, user: AuthorizedUser, id: string, code: string): Promise<CheckInView> {
  const [rights, event] = await Promise.all([eventRights(env, user), loadForCheckIn(env, id, code)]);
  const me = rights.personUuid;
  if (!me) throw new HttpError("Your People record wasn't found.", 403, "NOT_FOUND");
  const [rows, self] = await Promise.all([
    db(env).select<ResponseRow>("event_responses", `select=${RESPONSE_COLS}&event_id=${eq(event.id)}&or=(person_id.eq.${me},signed_up_by_id.eq.${me})`, RESPONSE_KEY),
    db(env).one<NameParts & { api_id: string }>("people", `select=api_id,preferred_name,given_names,surname&id=${eq(me)}`),
  ]);
  const mine = rows.find((r) => r.person_id === me);
  const others = rows.filter((r) => r.person_id !== me && r.signed_up_by_id === me && r.status !== "not_going");
  const details = toDetails(event, null);
  return {
    event: details,
    open: checkInOpen(details),
    people: [
      { personId: self?.api_id ?? user.personId, name: nameOf(self), self: true, response: mine ? toResponse(mine) : null },
      ...others.map((r) => ({ personId: r.person?.api_id ?? "", name: nameOf(r.person), self: false, response: toResponse(r) })).sort((a, b) => a.name.localeCompare(b.name)),
    ],
  };
}

/**
 * Ticks them in, with anyone they signed up who came too and how many guests.
 * Turning up counts as Going, even without an answer: they came.
 */
export async function checkIn(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true; checkedIn: number }> {
  const [rights, event] = await Promise.all([eventRights(env, user), loadForCheckIn(env, id, body.code)]);
  if (!checkInOpen(toDetails(event, null))) throw new HttpError("Check-in opens an hour before the start and closes an hour after the end.", 409, "CHECKIN_CLOSED");
  const me = rights.personUuid;
  if (!me) throw new HttpError("Your People record wasn't found.", 403, "NOT_FOUND");
  const asked = Array.isArray(body.people) ? body.people.filter((x): x is { personId: string; guestsCame?: unknown } => !!x && typeof x === "object" && typeof (x as { personId?: unknown }).personId === "string") : [];
  if (!asked.length) throw new HttpError("Tick who's here.", 400, "INVALID_INPUT");
  const d = db(env);
  const rows = await d.select<ResponseRow>("event_responses", `select=${RESPONSE_COLS}&event_id=${eq(event.id)}&or=(person_id.eq.${me},signed_up_by_id.eq.${me})`, RESPONSE_KEY);
  const now = new Date().toISOString();
  let done = 0;
  for (const a of asked) {
    const row = rows.find((r) => r.person?.api_id === a.personId);
    const self = a.personId === user.personId;
    // Only themselves, or someone they signed up.
    if (!self && (!row || row.signed_up_by_id !== me)) continue;
    const guests = Array.isArray(row?.guests) ? row!.guests!.length : 0;
    const patch = { status: "going", attended: true, checked_in_at: now, guests_came: guestsCameOf(a.guestsCame, guests) };
    if (row) await d.update("event_responses", `event_id=${eq(event.id)}&person_id=${eq(row.person_id)}`, patch);
    else await d.insert("event_responses", [{ event_id: event.id, person_id: me, ...patch }]);
    done++;
  }
  if (!done) throw new HttpError("You can check in yourself and anyone you signed up.", 403, "NOT_YOURS");
  return { ok: true, checkedIn: done };
}

const REGISTER_TASKS_TTL_MS = 5 * 60 * 1000;

/** Events over in the last month whose register isn't marked taken, for their creator and team social secretaries (myTasks.ts). */
export async function registerTasks(env: Env, user: AuthorizedUser): Promise<EventTask[]> {
  const { data } = await getCached(
    `register-tasks:${user.personId}`,
    async (): Promise<EventTask[]> => {
      const rights = await eventRights(env, user);
      if (!rights.personUuid) return [];
      const since = encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString());
      const until = encodeURIComponent(new Date().toISOString());
      const teams = rights.teams.map((t) => t.id);
      const mine = teams.length ? `or=(created_by.eq.${rights.personUuid},team_id.in.(${teams.join(",")}))` : `created_by=${eq(rights.personUuid)}`;
      const rows = await db(env).select<EventRow>(
        "events",
        `select=${EVENT_COLS}&status=eq.published&register_taken_at=is.null&starts_at=gte.${since}&starts_at=lte.${until}&${mine}&order=starts_at`,
      );
      return rows
        .filter((r) => needsRegister({ ...toDetails(r, null), registerTakenAt: r.register_taken_at }))
        .map((r) => ({ id: r.id, title: r.title, due: r.starts_at }));
    },
    REGISTER_TASKS_TTL_MS,
  );
  return data;
}
