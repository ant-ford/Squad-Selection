/**
 * Special events (worker/src/events.ts, migration 20261003120000; owner,
 * 3 Oct 2026): trials, social functions, team socials, tournaments and
 * tours. Friendlies stay fixtures.
 *
 * One definition for the Worker and the app: the types, who's invited, and
 * the checks on an answer.
 */
import { GROUPS, type Selection } from "./emailLists";
import { SOCIAL_FUNCTIONS } from "./commitmentReview";

export const EVENT_TYPES = ["social_function", "team_social", "tournament", "tour", "trial"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  trial: "Trial",
  social_function: "Social function",
  team_social: "Team social",
  tournament: "Tournament",
  tour: "Tour",
};

export type EventStatus = "draft" | "published" | "cancelled";
export type ResponseStatus = "going" | "maybe" | "not_going";
export const RESPONSE_LABEL: Record<ResponseStatus, string> = { going: "Going", maybe: "Maybe", not_going: "Not going" };

/** Step 1 offers free and pay on the night; the column also allows PayMe/FPS and membership account. */
export type PaymentMode = "free" | "on_the_night" | "payme_fps" | "account";
export const PAYMENT_MODES_OFFERED: readonly PaymentMode[] = ["free", "on_the_night"];
export const PAYMENT_LABEL: Record<PaymentMode, string> = {
  free: "Free",
  on_the_night: "Pay on the night",
  payme_fps: "PayMe or FPS",
  account: "Charged to your membership account",
};

export { SOCIAL_FUNCTIONS };
export type SocialFunction = (typeof SOCIAL_FUNCTIONS)[number];

/**
 * The chairman's email-list groups an event can be sent to (owner, 3 Oct
 * 2026). The rest (member type, age band, category, captaincy interest,
 * qualified coach, team roles, general volunteers) are left out.
 */
export const EVENT_GROUP_KEYS = [
  "status",
  "active",
  "team",
  "playerCoach",
  "hockeyCommittee",
  "subCommittee",
  "touringCommittee",
  "easter5s",
  "tourInterest",
  "tournamentInterest",
  "qualifiedUmpire",
] as const;
export const EVENT_GROUPS = GROUPS.filter((g) => (EVENT_GROUP_KEYS as readonly string[]).includes(g.key));

/** A new event goes to playing members unless the social secretary changes it. */
export const DEFAULT_AUDIENCE: Selection = { status: ["Member"], active: ["Active player"] };

/** Only the event groups, each a short list of short strings. */
export function cleanAudience(raw: unknown): Selection {
  const out: Selection = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of EVENT_GROUP_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(v)) continue;
    const picked = [...new Set(v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 80)))].slice(0, 40);
    if (picked.length) out[key] = picked;
  }
  return out;
}

/** A team's own event is always for that team, whatever else is ticked. */
export function effectiveAudience(audience: Selection, teamName: string | null): Selection {
  return teamName ? { ...audience, team: [teamName] } : audience;
}

export interface Guest {
  name: string;
  age: "adult" | "child";
  dietary?: string;
}

/** Their +1s, checked: a list, or the reason it can't be saved. */
export function cleanGuests(raw: unknown, allowed: boolean, max: number | null): Guest[] | string {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return "Guests weren't understood.";
  if (raw.length === 0) return [];
  if (!allowed) return "This event isn't open to guests.";
  const limit = max ?? 1;
  if (raw.length > limit) return `You can bring up to ${limit} guest${limit === 1 ? "" : "s"}.`;
  const out: Guest[] = [];
  for (const g of raw) {
    const o = (g && typeof g === "object" ? g : {}) as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 80) : "";
    if (!name) return "Give each guest's name.";
    const age = o.age === "child" ? "child" : "adult";
    const dietary = typeof o.dietary === "string" && o.dietary.trim() ? o.dietary.trim().slice(0, 120) : undefined;
    out.push(dietary ? { name, age, dietary } : { name, age });
  }
  return out;
}

/** Answers can change until the deadline, or until it starts when there's none. */
export function isOpen(e: { status: EventStatus; startsAt: string; respondBy: string | null }, now = Date.now()): boolean {
  return e.status === "published" && now < Date.parse(e.respondBy ?? e.startsAt);
}

/** Shown on the player page until the day after it ends. */
export function isCurrent(e: { startsAt: string; endsAt: string | null }, now = Date.now()): boolean {
  return Date.parse(e.endsAt ?? e.startsAt) + 86_400_000 > now;
}

/**
 * Whether the person acting may answer for this person. Anyone may answer
 * for themselves; anyone may sign up someone who hasn't answered; after
 * that, only the person, whoever signed them up, or the event's managers.
 * Returns the reason when not.
 */
export function answerRefusal(input: {
  actorId: string;
  targetId: string;
  manager: boolean;
  existing: { signedUpById: string | null; signedUpByName?: string | null; targetName?: string } | null;
}): string | null {
  const { actorId, targetId, manager, existing } = input;
  if (manager || actorId === targetId || !existing) return null;
  if (existing.signedUpById === actorId) return null;
  const who = existing.targetName ?? "They";
  if (existing.signedUpById) return `${who}: already signed up by ${existing.signedUpByName ?? "someone else"}.`;
  return `${who}: already answered for themselves.`;
}

/** "HK$350", "Free", or null when there's no price. */
export function priceText(amount: number | null | undefined): string | null {
  if (amount == null) return null;
  if (amount === 0) return "Free";
  return `HK$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

// ── API shapes ───────────────────────────────────────────────────────────

/** The details everyone sees. */
export interface EventDetails {
  id: string;
  type: EventType;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  respondBy: string | null;
  memberPrice: number | null;
  guestAdultPrice: number | null;
  guestChildPrice: number | null;
  paymentMode: PaymentMode;
  guestsAllowed: boolean;
  maxGuests: number | null;
  helpNeeded: string | null;
  socialFunction: SocialFunction | null;
  /** The team's own event; null when club-wide. */
  team: string | null;
  status: EventStatus;
  posterUrl: string | null;
}

export interface ResponseDetails {
  status: ResponseStatus;
  guests: Guest[];
  canHelp: boolean;
  notes: string | null;
  /** Who signed them up (and pays), when it wasn't them. */
  signedUpBy: { id: string; name: string } | null;
}

/** GET /api/events/mine: one event on the player page. */
export interface MyEvent extends EventDetails {
  invited: boolean;
  open: boolean;
  /** Whether they keep this event (a social secretary or Section Captain). */
  manager: boolean;
  mine: ResponseDetails | null;
  /** The people they've signed up. */
  signedUp: ({ personId: string; name: string } & ResponseDetails)[];
}

/** POST /api/events/:id/respond. */
export interface RespondInput {
  /** Who it's for (a People api id); absent for themselves. */
  personId?: string;
  status?: ResponseStatus;
  /** Take back a sign-up made by mistake (signer or manager). */
  remove?: boolean;
  guests?: Guest[];
  canHelp?: boolean;
  notes?: string;
}

/** GET /api/events/:id/people: an invited person to sign up. */
export interface EventPerson {
  personId: string;
  name: string;
  team: string | null;
  /** Their answer so far, and who gave it. */
  answer: { status: ResponseStatus; signedUpBy: string | null } | null;
}

/** GET /api/events/manage: one event on the social secretaries' screen. */
export interface ManagedEvent extends EventDetails {
  audience: Selection;
  invited: number;
  counts: { going: number; maybe: number; notGoing: number; adultGuests: number; childGuests: number; canHelp: number };
}

export interface ManageView {
  events: ManagedEvent[];
  /** Section Captains and the overall Social Secretary: any event, and they name the team social secretaries. */
  club: boolean;
  /** The teams whose events they may keep (every team for club managers). */
  teams: string[];
  /** The options in each event group, from the directory. */
  groups: Record<string, string[]>;
  /** Each team's social secretaries (club managers only). */
  socialSecretaries: { team: string; teamId: string; people: { personId: string; name: string }[] }[];
}

/** POST /api/events (create, or edit with id). */
export interface EventInput {
  id?: string;
  type: EventType;
  title: string;
  description?: string;
  location?: string;
  startsAt: string;
  endsAt?: string | null;
  respondBy?: string | null;
  memberPrice?: number | null;
  guestAdultPrice?: number | null;
  guestChildPrice?: number | null;
  paymentMode?: PaymentMode;
  guestsAllowed?: boolean;
  maxGuests?: number | null;
  helpNeeded?: string | null;
  socialFunction?: SocialFunction | null;
  team?: string | null;
  audience?: Selection;
}

/** GET /api/events/:id/responses. */
export interface EventResponseRow extends ResponseDetails {
  personId: string;
  name: string;
  membershipNo: string | null;
  updatedAt: string;
}

export interface EventResponses {
  event: ManagedEvent;
  responses: EventResponseRow[];
  /** Invited, no answer yet: for chasing on WhatsApp. */
  notAnswered: { personId: string; name: string }[];
}
