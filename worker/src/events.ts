/**
 * Special events (migration 20261003120000; owner, 3 Oct 2026): trials,
 * social functions, team socials, tournaments and tours, with a poster and
 * the details people need. Members say Going, Maybe or Not going, for
 * themselves and for other players, with +1 guests; whoever signs someone
 * up pays for them.
 *
 *  - Who keeps them: a team's social secretaries (team_people role
 *    social_secretary) that team's events; the overall Social Secretary
 *    (offices role social_secretary) and the Section Captains any event.
 *  - Who's invited: a filter over the chairman's email-list groups
 *    (shared/events.ts EVENT_GROUP_KEYS), matched against the chairman's
 *    directory when read. A team's own event is always for that team.
 *  - Unanswered is not Going. An open event with no answer is a My Tasks
 *    line; Going and Maybe go into the person's calendar feed.
 *  - No emails (Resend's daily limit): social secretaries share the link on
 *    WhatsApp.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { db, eq, inList } from "./data/supabase";
import { fileLink } from "./data/supabase/files";
import { getCached, invalidateCache, invalidateCachePrefix } from "./cache";
import { eventRights, managesEvent, type EventRights } from "./eventAccess";
import { getChairmanDirectory } from "./chairman";
import { uploadBytes } from "./details";
import { readPaymentProof } from "./paymentRead";
import { groupOptions, matches, type DirectoryPerson, type Selection } from "../../shared/emailLists";
import {
  DEFAULT_AUDIENCE,
  EVENT_GROUP_KEYS,
  EVENT_TYPES,
  PAYMENT_MODES_OFFERED,
  SOCIAL_FUNCTIONS,
  answerRefusal,
  billed,
  cleanLink,
  checkInOpen,
  guestsCameOf,
  needsRegister,
  registerOpen,
  asksDietary,
  cleanAnswers,
  cleanQuestions,
  missingAnswer,
  computeCharges,
  judgeProof,
  cleanAudience,
  cleanGuests,
  effectiveAudience,
  isOpen,
  type ChargeInput,
  type CheckInView,
  type ChargeList,
  type EventDetails,
  type EventInput,
  type EventPerson,
  type EventResponseRow,
  type EventResponses,
  type EventStatus,
  type EventType,
  type Guest,
  type ManageView,
  type ManagedEvent,
  type MyEvent,
  type PaymentInfo,
  type PaymentMode,
  type ReadStatus,
  type ResponseDetails,
  type ResponseStatus,
  type SocialFunction,
} from "../../shared/events";

const text = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "");
const validId = (id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError("Event not found.", 404, "NOT_FOUND");
};
type NameParts = { preferred_name: string | null; given_names: string | null; surname: string | null };
const nameOf = (p: NameParts | null | undefined) => (p ? [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ") || "Unnamed" : "");

// ── Rows ─────────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  event_type: EventType;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  respond_by: string | null;
  member_price: number | string | null;
  guest_adult_price: number | string | null;
  guest_child_price: number | string | null;
  payment_mode: PaymentMode;
  payment_details: string | null;
  link_url: string | null;
  charges_sent_at: string | null;
  register_taken_at: string | null;
  checkin_code: string | null;
  guests_allowed: boolean;
  max_guests: number | null;
  help_needed: string | null;
  questions: unknown;
  social_function: SocialFunction | null;
  team_id: string | null;
  audience: unknown;
  status: EventStatus;
  team: { team_name: string } | null;
}
const EVENT_COLS =
  "id,event_type,title,description,location,starts_at,ends_at,respond_by,member_price,guest_adult_price,guest_child_price,payment_mode,payment_details,link_url,charges_sent_at,register_taken_at,checkin_code,guests_allowed,max_guests,help_needed,questions,social_function,team_id,audience,status,team:teams(team_name)";

interface ResponseRow {
  event_id: string;
  person_id: string;
  status: ResponseStatus;
  guests: Guest[] | null;
  can_help: boolean;
  charge_waived: boolean;
  attended: boolean;
  guests_came: number | null;
  checked_in_at: string | null;
  answers: Record<string, string> | null;
  notes: string | null;
  updated_at: string;
  signed_up_by_id: string | null;
  person: (NameParts & { api_id: string; membership_no: string | null }) | null;
  signer: (NameParts & { api_id: string; membership_no: string | null }) | null;
}
const RESPONSE_COLS =
  "event_id,person_id,status,guests,can_help,charge_waived,attended,guests_came,checked_in_at,answers,notes,updated_at,signed_up_by_id," +
  "person:people!event_responses_person_id_fkey(api_id,preferred_name,given_names,surname,membership_no)," +
  "signer:people!event_responses_signed_up_by_id_fkey(api_id,preferred_name,given_names,surname,membership_no)";
const RESPONSE_KEY = "event_id,person_id";

const money = (v: number | string | null) => (v == null ? null : Number(v));

function toDetails(r: EventRow, posterUrl: string | null): EventDetails {
  return {
    id: r.id,
    type: r.event_type,
    title: r.title,
    description: r.description,
    location: r.location,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    respondBy: r.respond_by,
    memberPrice: money(r.member_price),
    guestAdultPrice: money(r.guest_adult_price),
    guestChildPrice: money(r.guest_child_price),
    paymentMode: r.payment_mode,
    paymentDetails: r.payment_details,
    linkUrl: r.link_url,
    guestsAllowed: r.guests_allowed,
    maxGuests: r.max_guests,
    helpNeeded: r.help_needed,
    questions: cleanQuestions(r.questions),
    socialFunction: r.social_function,
    team: r.team?.team_name ?? null,
    status: r.status,
    posterUrl,
  };
}

function toResponse(r: ResponseRow): ResponseDetails {
  return {
    status: r.status,
    guests: Array.isArray(r.guests) ? r.guests : [],
    canHelp: r.can_help,
    answers: r.answers && typeof r.answers === "object" ? r.answers : {},
    notes: r.notes,
    signedUpBy: r.signed_up_by_id && r.signer ? { id: r.signer.api_id, name: nameOf(r.signer) } : null,
    waived: !!r.charge_waived,
    attended: !!r.attended,
    guestsCame: r.guests_came ?? null,
    checkedInAt: r.checked_in_at ?? null,
  };
}

/** An answer as charging needs it: the payer is whoever signed them up, otherwise themselves. */
function toChargeInput(r: ResponseRow): ChargeInput {
  const payer = r.signed_up_by_id && r.signer ? r.signer : r.person;
  return {
    name: nameOf(r.person),
    status: r.status,
    guests: Array.isArray(r.guests) ? r.guests : [],
    waived: !!r.charge_waived,
    payer: { personId: payer?.api_id ?? "", name: nameOf(payer), membershipNo: payer?.membership_no ?? null },
  };
}

interface PaymentRow {
  event_id: string;
  payer_id: string;
  file_id: string | null;
  amount_due: number | string | null;
  amount_read: number | string | null;
  paid_on: string | null;
  reference: string | null;
  payee: string | null;
  read_status: ReadStatus;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  payer: { api_id: string } | null;
  confirmer: NameParts | null;
}
const PAYMENT_COLS =
  "event_id,payer_id,file_id,amount_due,amount_read,paid_on,reference,payee,read_status,confirmed_at,created_at,updated_at," +
  "payer:people!event_payments_payer_id_fkey(api_id),confirmer:people!event_payments_confirmed_by_fkey(preferred_name,given_names,surname)";

async function toPayment(env: Env, r: PaymentRow): Promise<PaymentInfo> {
  return {
    status: r.read_status,
    amountDue: money(r.amount_due),
    amountRead: money(r.amount_read),
    paidOn: r.paid_on,
    reference: r.reference,
    payee: r.payee,
    proofUrl: r.file_id ? await fileLink(env, r.file_id) : null,
    uploadedAt: r.updated_at,
    confirmedAt: r.confirmed_at,
    confirmedBy: r.confirmer ? nameOf(r.confirmer) : null,
  };
}

const audienceOf = (r: Pick<EventRow, "audience" | "team">): Selection => effectiveAudience(cleanAudience(r.audience), r.team?.team_name ?? null);

async function directory(env: Env): Promise<DirectoryPerson[]> {
  return (await getChairmanDirectory(env)).people;
}

const invitedFrom = (dir: DirectoryPerson[], r: Pick<EventRow, "audience" | "team">) => {
  const audience = audienceOf(r);
  return dir.filter((p) => matches(p, audience));
};

async function loadEvent(env: Env, id: string): Promise<EventRow> {
  validId(id);
  const r = await db(env).one<EventRow>("events", `select=${EVENT_COLS}&id=${eq(id)}`);
  if (!r) throw new HttpError("Event not found.", 404, "NOT_FOUND");
  return r;
}

/** The newest poster of each event, as a signed link. */
async function posterLinks(env: Env, eventIds: string[]): Promise<Record<string, string>> {
  if (!eventIds.length) return {};
  const rows = await db(env).select<{ id: string; event_id: string }>(
    "files",
    `select=id,event_id&event_id=${inList(eventIds)}&kind=eq.event_poster&order=created_at.desc`,
  );
  const newest: Record<string, string> = {};
  for (const f of rows) newest[f.event_id] ??= f.id;
  const out: Record<string, string> = {};
  await Promise.all(Object.entries(newest).map(async ([eventId, fileId]) => (out[eventId] = await fileLink(env, fileId))));
  return out;
}

// ── Who keeps them (eventAccess.ts) ─────────────────────────────────────

async function requireManager(env: Env, user: AuthorizedUser): Promise<EventRights> {
  const r = await eventRights(env, user);
  if (!r.club && !r.teams.length) throw new HttpError("Events are kept by the social secretaries and Section Captains.", 403, "OFFICER_ACCESS_REQUIRED");
  return r;
}

async function requireManages(env: Env, user: AuthorizedUser, id: string): Promise<{ rights: EventRights; event: EventRow }> {
  const rights = await requireManager(env, user);
  const event = await loadEvent(env, id);
  if (!managesEvent(rights, event)) throw new HttpError("That event is kept by another team's social secretary.", 403, "OFFICER_ACCESS_REQUIRED");
  return { rights, event };
}

// ── The player page ──────────────────────────────────────────────────────

/** Published (or cancelled) events they're invited to or answered, until the day after each ends. */
export async function getMyEvents(env: Env, user: AuthorizedUser): Promise<{ events: MyEvent[] }> {
  const [rights, dir] = await Promise.all([eventRights(env, user), directory(env)]);
  const me = rights.personUuid;
  if (!me) return { events: [] };
  const d = db(env);
  const since = encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString());
  const rows = await d.select<EventRow>(
    "events",
    `select=${EVENT_COLS}&status=in.(published,cancelled)&or=(ends_at.gte.${since},and(ends_at.is.null,starts_at.gte.${since}))&order=starts_at`,
  );
  if (!rows.length) return { events: [] };
  const ids = rows.map((r) => r.id);
  const [responses, posters, payments] = await Promise.all([
    d.select<ResponseRow>("event_responses", `select=${RESPONSE_COLS}&event_id=${inList(ids)}&or=(person_id.eq.${me},signed_up_by_id.eq.${me})`, RESPONSE_KEY),
    posterLinks(env, ids),
    d.select<PaymentRow>("event_payments", `select=${PAYMENT_COLS}&payer_id=${eq(me)}&event_id=${inList(ids)}`),
  ]);
  const person = dir.find((p) => p.id === user.personId);
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
  const [rights, ev, dir] = await Promise.all([eventRights(env, user), loadEvent(env, eventId), directory(env)]);
  if (!rights.personUuid) throw new HttpError("Your People record wasn't found.", 403, "NOT_FOUND");
  if (ev.status === "draft") throw new HttpError("Event not found.", 404, "NOT_FOUND");
  if (ev.status === "cancelled") throw new HttpError("This event has been cancelled.", 409, "EVENT_CANCELLED");
  const manager = managesEvent(rights, ev);
  const details = toDetails(ev, null);
  if (!manager && !isOpen(details)) throw new HttpError("Answers for this event have closed. Ask the social secretary.", 409, "EVENT_CLOSED");

  const targetApi = text(body.personId, 40) || user.personId;
  const self = targetApi === user.personId;
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
    const invited = invitedFrom(dir, ev);
    const isInvited = (apiId: string) => invited.some((p) => p.id === apiId);
    if (!isInvited(user.personId) && !(self && existing)) throw new HttpError("This event isn't for you.", 403, "NOT_INVITED");
    if (!self && !existing && !isInvited(targetApi)) throw new HttpError(`${targetName} isn't invited to this event.`, 403, "NOT_INVITED");
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

// ── My Tasks ─────────────────────────────────────────────────────────────

export interface EventTask {
  id: string;
  title: string;
  /** When answers close. */
  due: string;
}

const OPEN_EVENTS_TTL_MS = 60 * 1000;
const TASKS_TTL_MS = 60 * 1000;

/** Open events they're invited to and haven't answered (myTasks.ts). */
export async function eventTasks(env: Env, user: AuthorizedUser): Promise<EventTask[]> {
  const { data } = await getCached(
    `event-tasks:${user.personId}`,
    async (): Promise<EventTask[]> => {
      const { data: open } = await getCached(
        "events:open",
        () =>
          db(env).select<EventRow>(
            "events",
            `select=${EVENT_COLS}&status=eq.published&starts_at=gte.${encodeURIComponent(new Date().toISOString())}&order=starts_at`,
          ),
        OPEN_EVENTS_TTL_MS,
      );
      const now = Date.now();
      const live = open.filter((r) => isOpen(toDetails(r, null), now));
      if (!live.length) return [];
      const [rights, dir] = await Promise.all([eventRights(env, user), directory(env)]);
      const person = dir.find((p) => p.id === user.personId);
      if (!person || !rights.personUuid) return [];
      const mine = live.filter((r) => matches(person, audienceOf(r)));
      if (!mine.length) return [];
      const answered = await db(env).select<{ event_id: string }>(
        "event_responses",
        `select=event_id&person_id=${eq(rights.personUuid)}&event_id=${inList(mine.map((r) => r.id))}`,
        RESPONSE_KEY,
      );
      return mine
        .filter((r) => !answered.some((a) => a.event_id === r.id))
        .map((r) => ({ id: r.id, title: r.title, due: r.respond_by ?? r.starts_at }));
    },
    TASKS_TTL_MS,
  );
  return data;
}

// ── The calendar feed ────────────────────────────────────────────────────

export interface CalendarEvent extends EventDetails {
  answer: "going" | "maybe";
  guests: number;
}

/** Events they're Going or Maybe to (calendar.ts adds them to their feed). */
export async function calendarEventsFor(env: Env, personApiId: string): Promise<CalendarEvent[]> {
  const d = db(env);
  const p = await d.one<{ id: string }>("people", `select=id&api_id=${eq(personApiId)}`);
  if (!p) return [];
  const since = encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString());
  const rows = await d.select<{ status: "going" | "maybe"; guests: Guest[] | null; event: EventRow | null }>(
    "event_responses",
    `select=status,guests,event:events!inner(${EVENT_COLS})&person_id=${eq(p.id)}&status=in.(going,maybe)&event.status=in.(published,cancelled)&event.starts_at=gte.${since}`,
    RESPONSE_KEY,
  );
  return rows.flatMap((r) => (r.event ? [{ ...toDetails(r.event, null), answer: r.status, guests: Array.isArray(r.guests) ? r.guests.length : 0 }] : []));
}

// ── Social secretaries and Section Captains ──────────────────────────────

const pick = <K extends string>(keys: readonly K[]) => (o: Record<string, string[]>) =>
  Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]])) as Record<string, string[]>;

function counts(rs: { status: ResponseStatus; guests: Guest[] | null; can_help: boolean; attended?: boolean }[]): ManagedEvent["counts"] {
  const c = { going: 0, maybe: 0, notGoing: 0, adultGuests: 0, childGuests: 0, canHelp: 0, came: 0 };
  for (const r of rs) {
    if (r.status === "going") c.going++;
    else if (r.status === "maybe") c.maybe++;
    else c.notGoing++;
    if (r.status === "going") {
      for (const g of r.guests ?? []) {
        if (g.age === "child") c.childGuests++;
        else c.adultGuests++;
      }
    }
    if (r.can_help) c.canHelp++;
    if (r.attended) c.came++;
  }
  return c;
}

function toManaged(r: EventRow & { event_responses?: ResponseRow[] }, poster: string | null, dir: DirectoryPerson[], viewer: string): ManagedEvent {
  const invited = invitedFrom(dir, r);
  return {
    ...toDetails(r, poster),
    audience: cleanAudience(r.audience),
    invited: invited.length,
    includesMe: invited.some((p) => p.id === viewer),
    chargesSentAt: r.charges_sent_at,
    registerTakenAt: r.register_taken_at,
    counts: counts(r.event_responses ?? []),
  };
}

async function activeTeams(env: Env): Promise<{ id: string; api_id: string; team_name: string }[]> {
  return db(env).select("teams", "select=id,api_id,team_name&active=eq.true&order=team_rank");
}

/** The Events screen: their events from the last two months on, and what the form needs. */
export async function getManageView(env: Env, user: AuthorizedUser): Promise<ManageView> {
  const rights = await requireManager(env, user);
  const d = db(env);
  const since = encodeURIComponent(new Date(Date.now() - 60 * 86_400_000).toISOString());
  const scope = rights.club ? "" : `&team_id=${inList(rights.teams.map((t) => t.id))}`;
  const [rows, dir, teams] = await Promise.all([
    d.select<EventRow & { event_responses: ResponseRow[] }>(
      "events",
      `select=${EVENT_COLS},event_responses(status,guests,can_help,attended)&starts_at=gte.${since}${scope}&order=starts_at`,
    ),
    directory(env),
    rights.club ? activeTeams(env) : Promise.resolve([]),
  ]);
  const posters = await posterLinks(env, rows.map((r) => r.id));
  let socialSecretaries: ManageView["socialSecretaries"] = [];
  if (rights.club) {
    const held = await d.select<{ team_id: string; people: (NameParts & { api_id: string }) | null }>(
      "team_people",
      "select=team_id,people(api_id,preferred_name,given_names,surname)&role=eq.social_secretary",
      "team_id,role,person_id",
    );
    socialSecretaries = teams.map((t) => ({
      team: t.team_name,
      teamId: t.id,
      people: held.filter((h) => h.team_id === t.id && h.people).map((h) => ({ personId: h.people!.api_id, name: nameOf(h.people) })),
    }));
  }
  return {
    events: rows.map((r) => toManaged(r, posters[r.id] ?? null, dir, user.personId)),
    club: rights.club,
    teams: rights.club ? teams.map((t) => t.team_name) : rights.teams.map((t) => t.name),
    groups: pick(EVENT_GROUP_KEYS)(groupOptions(dir)),
    socialSecretaries,
  };
}

const toIso = (v: unknown, label: string, required: boolean): string | null => {
  const s = text(v, 40);
  if (!s) {
    if (required) throw new HttpError(`Give the ${label}.`, 400, "INVALID_INPUT");
    return null;
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new HttpError(`The ${label} wasn't understood.`, 400, "INVALID_INPUT");
  return new Date(t).toISOString();
};

const toPrice = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 99_999) throw new HttpError("Prices are in Hong Kong dollars, 0 or more.", 400, "INVALID_INPUT");
  return Math.round(n * 100) / 100;
};

/** The columns an EventInput sets, checked. */
export function eventColumns(body: Partial<EventInput>): Record<string, unknown> {
  const type = body.type as EventType;
  if (!EVENT_TYPES.includes(type)) throw new HttpError("Choose the type of event.", 400, "INVALID_INPUT");
  const title = text(body.title, 120);
  if (!title) throw new HttpError("Give the event a title.", 400, "INVALID_INPUT");
  const startsAt = toIso(body.startsAt, "start date and time", true)!;
  const endsAt = toIso(body.endsAt, "end date and time", false);
  if (endsAt && endsAt < startsAt) throw new HttpError("It can't end before it starts.", 400, "INVALID_INPUT");
  const respondBy = toIso(body.respondBy, "deadline", false);
  if (respondBy && respondBy > (endsAt ?? startsAt)) throw new HttpError("The deadline must be before the event ends.", 400, "INVALID_INPUT");
  const paymentMode = (body.paymentMode ?? "free") as PaymentMode;
  if (!PAYMENT_MODES_OFFERED.includes(paymentMode)) throw new HttpError("Choose how it's paid for.", 400, "INVALID_INPUT");
  const guestsAllowed = body.guestsAllowed === true;
  const max = guestsAllowed ? Number(body.maxGuests ?? 1) : null;
  if (max !== null && (!Number.isInteger(max) || max < 1 || max > 10)) throw new HttpError("Guests per person: 1 to 10.", 400, "INVALID_INPUT");
  const socialFunction = type === "social_function" && body.socialFunction ? body.socialFunction : null;
  if (socialFunction && !(SOCIAL_FUNCTIONS as readonly string[]).includes(socialFunction)) throw new HttpError("Choose the social function from the list.", 400, "INVALID_INPUT");
  // Free and self-funded bill nobody; self-funded may show an estimated cost per person.
  const free = !billed(paymentMode);
  const link = cleanLink(body.linkUrl);
  if (link && typeof link === "object") throw new HttpError(link.error, 400, "INVALID_INPUT");
  const paymentDetails = paymentMode === "payme_fps" ? text(body.paymentDetails, 300) : "";
  if (paymentMode === "payme_fps" && !paymentDetails) throw new HttpError("Give the PayMe link or FPS ID people should pay to.", 400, "INVALID_INPUT");
  return {
    event_type: type,
    title,
    description: text(body.description, 2000) || null,
    location: text(body.location, 200) || null,
    starts_at: startsAt,
    ends_at: endsAt,
    respond_by: respondBy,
    member_price: paymentMode === "free" ? null : toPrice(body.memberPrice),
    guest_adult_price: free || !guestsAllowed ? null : toPrice(body.guestAdultPrice),
    guest_child_price: free || !guestsAllowed ? null : toPrice(body.guestChildPrice),
    payment_mode: paymentMode,
    payment_details: paymentDetails || null,
    link_url: link,
    guests_allowed: guestsAllowed,
    max_guests: max,
    help_needed: text(body.helpNeeded, 200) || null,
    questions: cleanQuestions(body.questions),
    social_function: socialFunction,
    audience: body.audience === undefined ? DEFAULT_AUDIENCE : cleanAudience(body.audience),
  };
}

/** Creates an event (a draft) or saves changes to one. */
export async function saveEvent(env: Env, user: AuthorizedUser, body: Record<string, unknown>): Promise<{ id: string }> {
  const rights = await requireManager(env, user);
  const d = db(env);
  const cols = eventColumns(body as Partial<EventInput>);
  const teamName = text(body.team, 60);
  let teamId: string | null = null;
  if (teamName) {
    const t = await d.one<{ id: string }>("teams", `select=id&team_name=${eq(teamName)}`);
    if (!t) throw new HttpError("Choose the team from the list.", 400, "INVALID_INPUT");
    teamId = t.id;
  }
  if (!managesEvent(rights, { team_id: teamId })) {
    throw new HttpError(teamId ? "You can only add events for your own team." : "Choose your team: club-wide events are added by the Social Secretary or a Section Captain.", 403, "OFFICER_ACCESS_REQUIRED");
  }
  const id = text(body.id, 40);
  if (id) {
    const { event } = await requireManages(env, user, id);
    await d.update("events", `id=${eq(event.id)}`, { ...cols, team_id: teamId });
    invalidateCachePrefix("event-tasks:");
    invalidateCache("events:open");
    return { id: event.id };
  }
  if (Date.parse(cols.starts_at as string) < Date.now()) throw new HttpError("That's in the past.", 400, "INVALID_INPUT");
  const [row] = await d.insert<{ id: string }>("events", [{ ...cols, team_id: teamId, status: "draft", created_by: rights.personUuid || null, checkin_code: newCheckinCode() }]);
  return { id: row.id };
}

/** Publish, cancel, or back to draft (only while nobody has answered). */
export async function setEventStatus(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const { event } = await requireManages(env, user, id);
  const status = body.status as EventStatus;
  if (!["draft", "published", "cancelled"].includes(status)) throw new HttpError("Unknown status.", 400, "INVALID_INPUT");
  const d = db(env);
  if (status === "draft") {
    const any = await d.one<{ event_id: string }>("event_responses", `select=event_id&event_id=${eq(event.id)}&limit=1`);
    if (any) throw new HttpError("People have already answered: cancel it instead.", 409, "HAS_RESPONSES");
  }
  await d.update("events", `id=${eq(event.id)}`, { status });
  invalidateCachePrefix("event-tasks:");
  invalidateCache("events:open");
  return { ok: true };
}

/** Only a draft can be deleted, poster and all. */
export async function deleteEvent(env: Env, user: AuthorizedUser, id: string): Promise<{ ok: true }> {
  const { event } = await requireManages(env, user, id);
  if (event.status !== "draft") throw new HttpError("Only a draft can be deleted: cancel it instead.", 409, "NOT_DRAFT");
  const d = db(env);
  const files = await d.select<{ id: string; r2_key: string }>("files", `select=id,r2_key&event_id=${eq(event.id)}`);
  await d.remove("events", `id=${eq(event.id)}`);
  if (env.FILES) await Promise.all(files.map((f) => env.FILES!.delete(f.r2_key)));
  return { ok: true };
}

/** Replaces the poster: the new picture is stored and the old one removed. */
export async function uploadPoster(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ url: string }> {
  const { event } = await requireManages(env, user, id);
  if (!env.FILES) throw new HttpError("File storage is not configured.", 500, "SERVER_MISCONFIGURED");
  const { bytes, type } = uploadBytes("photo", body.dataUrl);
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const d = db(env);
  const old = await d.select<{ id: string; r2_key: string }>("files", `select=id,r2_key&event_id=${eq(event.id)}&kind=eq.event_poster`);
  const key = `events/${event.id}/poster/${crypto.randomUUID()}.${ext}`;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { sha256 } });
  const [file] = await d.insert<{ id: string }>("files", [
    { r2_key: key, kind: "event_poster", event_id: event.id, filename: `poster.${ext}`, content_type: type, bytes: bytes.length, sha256 },
  ]);
  if (old.length) {
    await d.remove("files", `id=${inList(old.map((o) => o.id))}`);
    await Promise.all(old.map((o) => env.FILES!.delete(o.r2_key)));
  }
  return { url: await fileLink(env, file.id) };
}

/** Everyone's answers, and who hasn't answered yet. */
export async function getEventResponses(env: Env, user: AuthorizedUser, id: string): Promise<EventResponses> {
  const { event } = await requireManages(env, user, id);
  const [rows, dir, posters] = await Promise.all([
    db(env).select<ResponseRow>("event_responses", `select=${RESPONSE_COLS}&event_id=${eq(event.id)}`, RESPONSE_KEY),
    directory(env),
    posterLinks(env, [event.id]),
  ]);
  const responses: EventResponseRow[] = rows
    .map((r) => ({ personId: r.person?.api_id ?? "", name: nameOf(r.person), membershipNo: r.person?.membership_no ?? null, updatedAt: r.updated_at, ...toResponse(r) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const answered = new Set(responses.map((r) => r.personId));
  const notAnswered = event.status === "draft" ? [] : invitedFrom(dir, event).filter((p) => !answered.has(p.id)).map((p) => ({ personId: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
  return { event: toManaged({ ...event, event_responses: rows }, posters[event.id] ?? null, dir, user.personId), responses, notAnswered };
}

/** How many a set of groups invites, as the form changes. */
export async function countAudience(env: Env, user: AuthorizedUser, body: Record<string, unknown>): Promise<{ count: number }> {
  await requireManager(env, user);
  const teamName = text(body.team, 60) || null;
  const audience = effectiveAudience(cleanAudience(body.audience), teamName);
  return { count: (await directory(env)).filter((p) => matches(p, audience)).length };
}

/** Anyone in the directory by name (club managers, to name social secretaries). */
export async function findPeople(env: Env, user: AuthorizedUser, q: string): Promise<{ people: { personId: string; name: string; team: string | null }[] }> {
  const rights = await requireManager(env, user);
  if (!rights.club) throw new HttpError("This is for the Social Secretary and Section Captains.", 403, "OFFICER_ACCESS_REQUIRED");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (q.trim().length < 2) return { people: [] };
  const found = (await directory(env))
    .filter((p) => words.every((w) => p.name.toLowerCase().includes(w)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 15);
  return { people: found.map((p) => ({ personId: p.id, name: p.name, team: p.values.team?.[0] ?? null })) };
}

/** A team's social secretaries, replacing the list (club managers). */
export async function setSocialSecretaries(env: Env, user: AuthorizedUser, body: Record<string, unknown>): Promise<{ ok: true }> {
  const rights = await requireManager(env, user);
  if (!rights.club) throw new HttpError("This is for the Social Secretary and Section Captains.", 403, "OFFICER_ACCESS_REQUIRED");
  const d = db(env);
  const team = await d.one<{ api_id: string }>("teams", `select=api_id&team_name=${eq(text(body.team, 60))}`);
  if (!team) throw new HttpError("Choose the team from the list.", 400, "INVALID_INPUT");
  const ids = Array.isArray(body.personIds) ? [...new Set(body.personIds.filter((x): x is string => typeof x === "string"))] : [];
  if (ids.length > 5) throw new HttpError("Up to 5 social secretaries a team.", 400, "INVALID_INPUT");
  const dir = await directory(env);
  if (ids.some((id) => !dir.some((p) => p.id === id))) throw new HttpError("Choose people from the search.", 400, "INVALID_INPUT");
  await d.rpc("set_team_people", { p_team: team.api_id, p_role: "social_secretary", p_people: ids });
  invalidateCachePrefix("event-rights:");
  return { ok: true };
}

// ── Paying (step 2) ──────────────────────────────────────────────────────

/**
 * A payer's PayMe / FPS screenshot: stored (replacing any earlier one), read
 * by Qwen, and compared with what they owe. A reference already used on
 * another payment is flagged. The social secretary still confirms it.
 */
export async function uploadPaymentProof(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<PaymentInfo> {
  if (!env.FILES) throw new HttpError("File storage is not configured.", 500, "SERVER_MISCONFIGURED");
  const [rights, ev] = await Promise.all([eventRights(env, user), loadEvent(env, id)]);
  if (ev.payment_mode !== "payme_fps" || ev.status !== "published") throw new HttpError("This event isn't paid by PayMe or FPS.", 409, "NOT_PAYME");
  const me = rights.personUuid;
  const d = db(env);
  const rows = await d.select<ResponseRow>(
    "event_responses",
    `select=${RESPONSE_COLS}&event_id=${eq(ev.id)}&or=(and(person_id.eq.${me},signed_up_by_id.is.null),signed_up_by_id.eq.${me})`,
    RESPONSE_KEY,
  );
  const due = computeCharges(toDetails(ev, null), rows.map(toChargeInput)).find((c) => c.payerId === user.personId)?.total ?? 0;
  if (due <= 0) throw new HttpError("You've nothing to pay for this event.", 409, "NOTHING_DUE");
  const { bytes, type } = uploadBytes("photo", body.dataUrl);
  const read = await readPaymentProof(env, body.dataUrl as string);
  const used = read.reference
    ? await d.select<{ event_id: string; payer_id: string }>("event_payments", `select=event_id,payer_id&reference=${eq(read.reference)}`)
    : [];
  const duplicate = used.some((u) => !(u.event_id === ev.id && u.payer_id === me));
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const key = `events/${ev.id}/payments/${crypto.randomUUID()}.${ext}`;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { sha256 } });
  const [file] = await d.insert<{ id: string }>("files", [
    { r2_key: key, kind: "payment_proof", event_id: ev.id, person_id: me, filename: `payment.${ext}`, content_type: type, bytes: bytes.length, sha256 },
  ]);
  const old = await d.one<{ file_id: string | null }>("event_payments", `select=file_id&event_id=${eq(ev.id)}&payer_id=${eq(me)}`);
  await d.upsert(
    "event_payments",
    [
      {
        event_id: ev.id,
        payer_id: me,
        file_id: file.id,
        amount_due: due,
        amount_read: read.amount,
        paid_on: read.paidOn,
        reference: read.reference,
        payee: read.payee,
        read_status: judgeProof(read, due, duplicate),
        // A new screenshot needs checking again.
        confirmed_by: null,
        confirmed_at: null,
      },
    ],
    "event_id,payer_id",
  );
  if (old?.file_id) {
    const f = await d.one<{ r2_key: string }>("files", `select=r2_key&id=${eq(old.file_id)}`);
    await d.remove("files", `id=${eq(old.file_id)}`);
    if (f) await env.FILES.delete(f.r2_key);
  }
  const saved = await d.one<PaymentRow>("event_payments", `select=${PAYMENT_COLS}&event_id=${eq(ev.id)}&payer_id=${eq(me)}`);
  return toPayment(env, saved!);
}

/** Who owes what, with each payer's proof; and, once sent to the treasurer, what changed since. */
export async function getCharges(env: Env, user: AuthorizedUser, id: string): Promise<ChargeList> {
  const { event } = await requireManages(env, user, id);
  const d = db(env);
  const [rows, payments] = await Promise.all([
    d.select<ResponseRow>("event_responses", `select=${RESPONSE_COLS}&event_id=${eq(event.id)}`, RESPONSE_KEY),
    d.select<PaymentRow>("event_payments", `select=${PAYMENT_COLS}&event_id=${eq(event.id)}`),
  ]);
  const charges = computeCharges(toDetails(event, null), rows.map(toChargeInput));
  const payers = await Promise.all(
    charges.map(async (c) => {
      const p = payments.find((x) => x.payer?.api_id === c.payerId);
      return { ...c, payment: p ? await toPayment(env, p) : null };
    }),
  );
  const sent = event.charges_sent_at;
  return {
    payers,
    total: Math.round(charges.reduce((t, c) => t + c.total, 0) * 100) / 100,
    sentAt: sent,
    changedSince: sent ? rows.filter((r) => Date.parse(r.updated_at) > Date.parse(sent)).map((r) => nameOf(r.person)).sort() : [],
  };
}

/** The charge list has gone to the treasurer (membership account events). */
export async function markChargesSent(env: Env, user: AuthorizedUser, id: string): Promise<{ ok: true }> {
  const { event } = await requireManages(env, user, id);
  if (event.payment_mode !== "account") throw new HttpError("Only membership account events go to the treasurer.", 409, "NOT_ACCOUNT");
  await db(env).update("events", `id=${eq(event.id)}`, { charges_sent_at: new Date().toISOString() });
  return { ok: true };
}

/** The social secretary checked a payer's proof against the real PayMe or bank record (or takes that back). */
export async function confirmPayment(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const { rights, event } = await requireManages(env, user, id);
  const d = db(env);
  const payer = await d.one<{ id: string }>("people", `select=id&api_id=${eq(text(body.personId, 40))}`);
  if (!payer) throw new HttpError("That person wasn't found.", 404, "NOT_FOUND");
  const confirmed = body.confirmed === true;
  const done = await d.update<{ event_id: string }>("event_payments", `event_id=${eq(event.id)}&payer_id=${eq(payer.id)}`, {
    confirmed_by: confirmed ? rights.personUuid || null : null,
    confirmed_at: confirmed ? new Date().toISOString() : null,
  });
  if (!done.length) throw new HttpError("They haven't uploaded a payment yet.", 404, "NOT_FOUND");
  return { ok: true };
}

/** Lets someone off the charge, guests included (or charges them again). */
export async function waiveCharge(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const { event } = await requireManages(env, user, id);
  const d = db(env);
  const person = await d.one<{ id: string }>("people", `select=id&api_id=${eq(text(body.personId, 40))}`);
  if (!person) throw new HttpError("That person wasn't found.", 404, "NOT_FOUND");
  const done = await d.update<{ event_id: string }>("event_responses", `event_id=${eq(event.id)}&person_id=${eq(person.id)}`, { charge_waived: body.waived === true });
  if (!done.length) throw new HttpError("They haven't answered.", 404, "NOT_FOUND");
  return { ok: true };
}

// ── Who came: the register and check-in ──────────────────────────────────

const appOrigin = (env: Env) => (env.APP_ORIGIN ?? "https://app.eddy.global").replace(/\/+$/, "");
const newCheckinCode = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");

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
