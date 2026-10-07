import type { Env } from "../env";
import type { AuthorizedUser } from "../auth";
import { HttpError } from "../http";
import { db, eq, inList } from "../data/supabase";
import { invalidateCache } from "../cache";
import { eventRights, managesEvent } from "../eventAccess";
import { getDirectoryPerson } from "../chairman";
import { matches, type DirectoryPerson } from "../../../shared/emailLists";
import {
  answerRefusal,
  billed,
  asksDietary,
  cleanAnswers,
  cleanQuestions,
  missingAnswer,
  computeCharges,
  cleanGuests,
  isOpen,
  type EventPerson,
  type MyEvent,
  type ResponseStatus,
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
  toChargeInput,
  type PaymentRow,
  PAYMENT_COLS,
  toPayment,
  audienceOf,
  directory,
  invitedFrom,
  loadEvent,
  posterLinks,
} from "./shared";

// ── The player page ──────────────────────────────────────────────────────

/** Published (or cancelled) events they're invited to or answered, until the day after each ends. */
export async function getMyEvents(env: Env, user: AuthorizedUser): Promise<{ events: MyEvent[] }> {
  const rights = await eventRights(env, user);
  const me = rights.personUuid;
  if (!me) return { events: [] };
  const d = db(env);
  const since = encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString());
  // Only their own directory entry: is each event's audience them?
  const [rows, person] = await Promise.all([
    d.select<EventRow>(
      "events",
      `select=${EVENT_COLS}&status=in.(published,cancelled)&or=(ends_at.gte.${since},and(ends_at.is.null,starts_at.gte.${since}))&order=starts_at`,
    ),
    getDirectoryPerson(env, user.personId),
  ]);
  if (!rows.length) return { events: [] };
  const ids = rows.map((r) => r.id);
  const [responses, posters, payments] = await Promise.all([
    d.select<ResponseRow>("event_responses", `select=${RESPONSE_COLS}&event_id=${inList(ids)}&or=(person_id.eq.${me},signed_up_by_id.eq.${me})`, RESPONSE_KEY),
    posterLinks(env, ids),
    d.select<PaymentRow>("event_payments", `select=${PAYMENT_COLS}&payer_id=${eq(me)}&event_id=${inList(ids)}`),
  ]);
  const now = Date.now();
  const events = await Promise.all(rows.map(async (r): Promise<MyEvent | null> => {
    const invited = !!person && matches(person, audienceOf(r));
    const mine = responses.find((x) => x.event_id === r.id && x.person_id === me);
    const signedUp = responses.filter((x) => x.event_id === r.id && x.person_id !== me && x.signed_up_by_id === me);
    if (!mine && !signedUp.length && (!invited || r.status === "cancelled")) return null;
    const details = toDetails(r, posters[r.id] ?? null);
    // Their bill: their own place unless someone else signed them up, and everyone they signed up.
    const paying = [...(mine && !mine.signed_up_by_id ? [mine] : []), ...signedUp];
    const charge = !billed(r.payment_mode) ? undefined : computeCharges(details, paying.map(toChargeInput)).find((c) => c.payerId === user.personId);
    const payment = payments.find((x) => x.event_id === r.id);
    return {
        ...details,
        invited,
        open: isOpen(details, now),
        manager: managesEvent(rights, r),
        mine: mine ? toResponse(mine) : null,
        signedUp: signedUp
          .map((x) => ({ personId: x.person?.api_id ?? "", name: nameOf(x.person), ...toResponse(x) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        bill: charge || payment ? { lines: charge?.lines ?? [], total: charge?.total ?? 0, payment: payment ? await toPayment(env, payment) : null } : null,
    };
  }));
  return { events: events.filter((e): e is MyEvent => !!e) };
}

const STATUSES: readonly ResponseStatus[] = ["going", "maybe", "not_going"];

/**
 * An answer, for themselves or someone else (body.personId). A sign-up
 * keeps whoever made it as the payer, even when the person later changes
 * the answer. A social secretary answering from the responses list
 * (asManager) does it on the person's behalf: nobody else pays.
 */
export async function respondToEvent(env: Env, user: AuthorizedUser, eventId: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const d = db(env);
  const targetApi = text(body.personId, 40) || user.personId;
  const self = targetApi === user.personId;
  // Their own and the target's directory entries, not the whole directory: are they invited?
  const [rights, ev, viewerEntry, targetEntry] = await Promise.all([
    eventRights(env, user),
    loadEvent(env, eventId),
    getDirectoryPerson(env, user.personId),
    self ? null : getDirectoryPerson(env, targetApi),
  ]);
  if (!rights.personUuid) throw new HttpError("Your People record wasn't found.", 403, "NOT_FOUND");
  if (ev.status === "draft") throw new HttpError("Event not found.", 404, "NOT_FOUND");
  if (ev.status === "cancelled") throw new HttpError("This event has been cancelled.", 409, "EVENT_CANCELLED");
  const manager = managesEvent(rights, ev);
  const details = toDetails(ev, null);
  if (!manager && !isOpen(details)) throw new HttpError("Answers for this event have closed. Ask the social secretary.", 409, "EVENT_CLOSED");

  const target = self
    ? { id: rights.personUuid, preferred_name: null, given_names: null, surname: null }
    : await d.one<NameParts & { id: string }>("people", `select=id,preferred_name,given_names,surname&api_id=${eq(targetApi)}`);
  if (!target) throw new HttpError("That person wasn't found.", 404, "NOT_FOUND");
  const targetName = self ? "You" : nameOf(target);

  const existing = await d.one<{ signed_up_by_id: string | null; signer: NameParts | null }>(
    "event_responses",
    `select=signed_up_by_id,signer:people!event_responses_signed_up_by_id_fkey(preferred_name,given_names,surname)&event_id=${eq(ev.id)}&person_id=${eq(target.id)}`,
  );
  if (!manager) {
    const audience = audienceOf(ev);
    const isInvited = (entry: DirectoryPerson | null) => !!entry && matches(entry, audience);
    if (!isInvited(viewerEntry) && !(self && existing)) throw new HttpError("This event isn't for you.", 403, "NOT_INVITED");
    if (!self && !existing && !isInvited(targetEntry)) throw new HttpError(`${targetName} isn't invited to this event.`, 403, "NOT_INVITED");
  }
  const refusal = answerRefusal({
    actorId: rights.personUuid,
    targetId: target.id,
    manager,
    existing: existing ? { signedUpById: existing.signed_up_by_id, signedUpByName: nameOf(existing.signer) || null, targetName } : null,
  });
  if (refusal) throw new HttpError(refusal, 403, "ALREADY_ANSWERED");
  const where = `event_id=${eq(ev.id)}&person_id=${eq(target.id)}`;

  if (body.remove === true) {
    if (!existing) return { ok: true };
    if (!manager && existing.signed_up_by_id !== rights.personUuid) {
      throw new HttpError("Only whoever signed them up can take them off. Answer Not going instead.", 403, "ALREADY_ANSWERED");
    }
    await d.remove("event_responses", where);
    invalidateCache(`event-tasks:${targetApi}`);
    return { ok: true };
  }

  const status = body.status as ResponseStatus;
  if (!STATUSES.includes(status)) throw new HttpError("Choose Going, Maybe or Not going.", 400, "INVALID_INPUT");
  const checked = status === "not_going" ? [] : cleanGuests(body.guests, ev.guests_allowed, ev.max_guests);
  if (typeof checked === "string") throw new HttpError(checked, 400, "INVALID_INPUT");
  const questions = cleanQuestions(ev.questions);
  const guests = asksDietary(questions) ? checked : checked.map(({ name, age }) => ({ name, age }));
  const asManager = manager && body.asManager === true;
  const answers = status === "not_going" ? {} : cleanAnswers(body.answers, questions);
  // Required questions bind members; a social secretary answering on someone's behalf may not know.
  const missing = status === "not_going" || asManager ? null : missingAnswer(questions, answers, guests);
  if (missing) throw new HttpError(missing, 400, "ANSWER_REQUIRED");
  const signedUpBy = existing ? existing.signed_up_by_id : self || asManager ? null : rights.personUuid;
  await d.upsert(
    "event_responses",
    [
      {
        event_id: ev.id,
        person_id: target.id,
        status,
        guests,
        can_help: status !== "not_going" && !!ev.help_needed && body.canHelp === true,
        answers,
        notes: text(body.notes, 300) || null,
        signed_up_by_id: signedUpBy,
      },
    ],
    "event_id,person_id",
  );
  // Their My Tasks line goes at once (in this isolate).
  invalidateCache(`event-tasks:${targetApi}`);
  return { ok: true };
}

/** Invited people matching a name, with their answer so far: for signing others up. */
export async function searchEventPeople(env: Env, user: AuthorizedUser, eventId: string, q: string): Promise<{ people: EventPerson[] }> {
  const [rights, ev, dir] = await Promise.all([eventRights(env, user), loadEvent(env, eventId), directory(env)]);
  if (ev.status !== "published") return { people: [] };
  const manager = managesEvent(rights, ev);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || q.trim().length < 2) return { people: [] };
  const pool = manager ? dir : invitedFrom(dir, ev);
  if (!manager && !pool.some((p) => p.id === user.personId)) return { people: [] };
  const found = pool
    .filter((p) => p.id !== user.personId && words.every((w) => p.name.toLowerCase().includes(w)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 15);
  if (!found.length) return { people: [] };
  const answered = await db(env).select<{ status: ResponseStatus; person: { api_id: string } | null; signer: NameParts | null }>(
    "event_responses",
    `select=status,person:people!event_responses_person_id_fkey(api_id),signer:people!event_responses_signed_up_by_id_fkey(preferred_name,given_names,surname)&event_id=${eq(ev.id)}`,
    RESPONSE_KEY,
  );
  return {
    people: found.map((p) => {
      const a = answered.find((x) => x.person?.api_id === p.id);
      return {
        personId: p.id,
        name: p.name,
        team: p.values.team?.[0] ?? null,
        answer: a ? { status: a.status, signedUpBy: a.signer ? nameOf(a.signer) : null } : null,
      };
    }),
  };
}
