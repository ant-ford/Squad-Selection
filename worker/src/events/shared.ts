/** Rows, mappers and access checks the events files share (events/index.ts says what events are). */

import type { Env } from "../env";
import type { AuthorizedUser } from "../auth";
import { HttpError } from "../http";
import { db, eq, inList } from "../data/supabase";
import { fileLink, photoLink } from "../data/supabase/files";
import { eventRights, managesEvent, type EventRights } from "../eventAccess";
import { getChairmanDirectory } from "../chairman";
import { matches, type DirectoryPerson, type Selection } from "../../../shared/emailLists";
import {
  cleanQuestions,
  cleanAudience,
  effectiveAudience,
  type ChargeInput,
  type EventDetails,
  type EventStatus,
  type EventType,
  type Guest,
  type PaymentInfo,
  type PaymentMode,
  type ReadStatus,
  type ResponseDetails,
  type ResponseStatus,
  type SocialFunction,
} from "../../../shared/events";

export const text = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "");
const validId = (id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError("Event not found.", 404, "NOT_FOUND");
};
export type NameParts = { preferred_name: string | null; given_names: string | null; surname: string | null };
export const nameOf = (p: NameParts | null | undefined) => (p ? [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ") || "Unnamed" : "");

// ── Rows ─────────────────────────────────────────────────────────────────

export interface EventRow {
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
export const EVENT_COLS =
  "id,event_type,title,description,location,starts_at,ends_at,respond_by,member_price,guest_adult_price,guest_child_price,payment_mode,payment_details,link_url,charges_sent_at,register_taken_at,checkin_code,guests_allowed,max_guests,help_needed,questions,social_function,team_id,audience,status,team:teams(team_name)";

export interface ResponseRow {
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
export const RESPONSE_COLS =
  "event_id,person_id,status,guests,can_help,charge_waived,attended,guests_came,checked_in_at,answers,notes,updated_at,signed_up_by_id," +
  "person:people!event_responses_person_id_fkey(api_id,preferred_name,given_names,surname,membership_no)," +
  "signer:people!event_responses_signed_up_by_id_fkey(api_id,preferred_name,given_names,surname,membership_no)";
export const RESPONSE_KEY = "event_id,person_id";

const money = (v: number | string | null) => (v == null ? null : Number(v));

export function toDetails(r: EventRow, posterUrl: string | null): EventDetails {
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

export function toResponse(r: ResponseRow): ResponseDetails {
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
export function toChargeInput(r: ResponseRow): ChargeInput {
  const payer = r.signed_up_by_id && r.signer ? r.signer : r.person;
  return {
    name: nameOf(r.person),
    status: r.status,
    guests: Array.isArray(r.guests) ? r.guests : [],
    waived: !!r.charge_waived,
    payer: { personId: payer?.api_id ?? "", name: nameOf(payer), membershipNo: payer?.membership_no ?? null },
  };
}

export interface PaymentRow {
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
export const PAYMENT_COLS =
  "event_id,payer_id,file_id,amount_due,amount_read,paid_on,reference,payee,read_status,confirmed_at,created_at,updated_at," +
  "payer:people!event_payments_payer_id_fkey(api_id),confirmer:people!event_payments_confirmed_by_fkey(preferred_name,given_names,surname)";

export async function toPayment(env: Env, r: PaymentRow): Promise<PaymentInfo> {
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

export const audienceOf = (r: Pick<EventRow, "audience" | "team">): Selection => effectiveAudience(cleanAudience(r.audience), r.team?.team_name ?? null);

export async function directory(env: Env): Promise<DirectoryPerson[]> {
  return (await getChairmanDirectory(env)).people;
}

export const invitedFrom = (dir: DirectoryPerson[], r: Pick<EventRow, "audience" | "team">) => {
  const audience = audienceOf(r);
  return dir.filter((p) => matches(p, audience));
};

export async function loadEvent(env: Env, id: string): Promise<EventRow> {
  validId(id);
  const r = await db(env).one<EventRow>("events", `select=${EVENT_COLS}&id=${eq(id)}`);
  if (!r) throw new HttpError("Event not found.", 404, "NOT_FOUND");
  return r;
}

/** The newest poster of each event, as a signed link. */
export async function posterLinks(env: Env, eventIds: string[]): Promise<Record<string, string>> {
  if (!eventIds.length) return {};
  const rows = await db(env).select<{ id: string; event_id: string }>(
    "files",
    `select=id,event_id&event_id=${inList(eventIds)}&kind=eq.event_poster&order=created_at.desc`,
  );
  const newest: Record<string, string> = {};
  for (const f of rows) newest[f.event_id] ??= f.id;
  const out: Record<string, string> = {};
  await Promise.all(Object.entries(newest).map(async ([eventId, fileId]) => (out[eventId] = await photoLink(env, fileId))));
  return out;
}

// ── Who keeps them (eventAccess.ts) ─────────────────────────────────────

export async function requireManager(env: Env, user: AuthorizedUser): Promise<EventRights> {
  const r = await eventRights(env, user);
  if (!r.club && !r.teams.length) throw new HttpError("Events are kept by the social secretaries and Section Captains.", 403, "OFFICER_ACCESS_REQUIRED");
  return r;
}

export async function requireManages(env: Env, user: AuthorizedUser, id: string): Promise<{ rights: EventRights; event: EventRow }> {
  const rights = await requireManager(env, user);
  const event = await loadEvent(env, id);
  if (!managesEvent(rights, event)) throw new HttpError("That event is kept by another team's social secretary.", 403, "OFFICER_ACCESS_REQUIRED");
  return { rights, event };
}
