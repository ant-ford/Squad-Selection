/**
 * Special events (worker/src/events.ts, migration 20261003120000; owner,
 * 3 Oct 2026): trials, social functions, team socials, tournaments and
 * tours. Friendlies stay fixtures.
 *
 * One definition for the Worker and the app: the types, who's invited, and
 * the checks on an answer.
 */
import { ANY, GROUPS, type Selection } from "./emailLists";
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

export type PaymentMode = "free" | "on_the_night" | "payme_fps" | "account";
export const PAYMENT_MODES_OFFERED: readonly PaymentMode[] = ["free", "on_the_night", "payme_fps", "account"];
export const PAYMENT_LABEL: Record<PaymentMode, string> = {
  free: "Free",
  on_the_night: "Pay on the night",
  payme_fps: "PayMe or FPS in advance",
  account: "Charged to membership accounts",
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

/**
 * The "anyone in it" option of a group that has one (committees, interests,
 * umpires), as the form labels it. Umpires are invited as a whole, never by
 * grade (owner, 3 Oct 2026), so that group offers only this.
 */
export const ANY_LABEL: Record<string, string> = {
  hockeyCommittee: "Whole committee",
  subCommittee: "Whole committee",
  touringCommittee: "Whole committee",
  easter5s: "Whole committee",
  tourInterest: "Any tour",
  tournamentInterest: "Any tournament",
  qualifiedUmpire: "Qualified umpires",
};
export const ANY_ONLY: readonly string[] = ["qualifiedUmpire"];

/** The options the form offers in a group: its "anyone" option first, then its values. */
export function audienceOptions(key: string, values: string[]): { value: string; label: string }[] {
  const any = ANY_LABEL[key] ? [{ value: ANY, label: ANY_LABEL[key] }] : [];
  return ANY_ONLY.includes(key) ? any : [...any, ...values.map((v) => ({ value: v, label: v }))];
}

/** "Member · Active player · Tour interest: any tour", or "Everyone". */
export function describeAudience(audience: Selection, teamName: string | null): string {
  const a = effectiveAudience(audience, teamName);
  const parts = EVENT_GROUPS.flatMap((g) => {
    const picked = a[g.key];
    if (!picked?.length) return [];
    const values = picked.map((p) => (p === ANY ? ANY_LABEL[g.key] ?? "any" : p)).join(" or ");
    return [g.key === "status" || g.key === "active" || g.key === "team" ? values : `${g.label}: ${values}`];
  });
  return parts.length ? parts.join(" · ") : "Everyone";
}

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

/** A question the event asks: "dietary" (dietary requirements) or one of the social secretary's own (q1..q4). */
export interface EventQuestion {
  key: string;
  label: string;
  /** Going and Maybe can't be saved without an answer. */
  required?: boolean;
}
export const DIETARY: EventQuestion = { key: "dietary", label: "Dietary requirements" };
export const MAX_OWN_QUESTIONS = 4;
export const asksDietary = (questions: EventQuestion[]) => questions.some((q) => q.key === DIETARY.key);

/** Dietary first if asked, then up to four of their own, renumbered q1..q4; each may be required. */
export function cleanQuestions(raw: unknown): EventQuestion[] {
  if (!Array.isArray(raw)) return [];
  const items = raw.filter((q): q is Record<string, unknown> => !!q && typeof q === "object");
  const req = (q: Record<string, unknown> | undefined) => (q?.required === true ? { required: true } : {});
  const dietaryItem = items.find((q) => q.key === DIETARY.key);
  const dietary = dietaryItem ? [{ ...DIETARY, ...req(dietaryItem) }] : [];
  const own = items
    .filter((q) => q.key !== DIETARY.key)
    .map((q) => ({ label: typeof q.label === "string" ? q.label.trim().slice(0, 100) : "", q }))
    .filter((x) => x.label)
    .slice(0, MAX_OWN_QUESTIONS)
    .map((x, i) => ({ key: `q${i + 1}`, label: x.label, ...req(x.q) }));
  return [...dietary, ...own];
}

/**
 * The first required answer missing, as a message; null when all are given.
 * A required dietary question needs an answer for each guest too ("None" will do).
 */
export function missingAnswer(questions: EventQuestion[], answers: Record<string, string>, guests: Guest[]): string | null {
  for (const q of questions) {
    if (!q.required) continue;
    if (!answers[q.key]?.trim()) return q.key === DIETARY.key ? "Give your dietary requirements (write None if you have none)." : `Answer “${q.label}”.`;
    if (q.key === DIETARY.key) {
      const g = guests.find((x) => !x.dietary?.trim());
      if (g) return `Give ${g.name || "each guest"}'s dietary requirements (None if they have none).`;
    }
  }
  return null;
}

/** Only answers to the event's questions, each a short text. */
export function cleanAnswers(raw: unknown, questions: EventQuestion[]): Record<string, string> {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const q of questions) {
    const v = o[q.key];
    if (typeof v === "string" && v.trim()) out[q.key] = v.trim().slice(0, 200);
  }
  return out;
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

const HOUR = 3_600_000;
/** An event without an end time is taken to last three hours. */
export const eventEnds = (e: { startsAt: string; endsAt: string | null }) => Date.parse(e.endsAt ?? e.startsAt) + (e.endsAt ? 0 : 3 * HOUR);

/** The register opens an hour before the start and stays open for corrections. */
export const registerOpen = (e: { startsAt: string }, now = Date.now()) => now >= Date.parse(e.startsAt) - HOUR;

/** Members can check themselves in from an hour before the start until an hour after the end. */
export function checkInOpen(e: { status: EventStatus; startsAt: string; endsAt: string | null }, now = Date.now()): boolean {
  return e.status === "published" && registerOpen(e, now) && now <= eventEnds(e) + HOUR;
}

/** Over, and nobody has marked the register taken: a My Tasks line for whoever keeps it. */
export function needsRegister(e: { status: EventStatus; startsAt: string; endsAt: string | null; registerTakenAt: string | null }, now = Date.now()): boolean {
  return e.status === "published" && !e.registerTakenAt && now > eventEnds(e);
}

/** How many of a member's guests can be ticked as having come. */
export const guestsCameOf = (raw: unknown, guests: number): number | null => {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? Math.max(0, Math.min(guests, n)) : null;
};

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
  /** The PayMe link or FPS ID to pay to (PayMe / FPS events). */
  paymentDetails: string | null;
  guestsAllowed: boolean;
  maxGuests: number | null;
  helpNeeded: string | null;
  /** What it asks when people answer. */
  questions: EventQuestion[];
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
  /** Their answers to the event's questions. */
  answers: Record<string, string>;
  notes: string | null;
  /** Who signed them up (and pays), when it wasn't them. */
  signedUpBy: { id: string; name: string } | null;
  /** A social secretary let them off the charge. */
  waived: boolean;
  /** Ticked on the register, or checked themselves in: they came. */
  attended: boolean;
  /** How many of their guests came. */
  guestsCame: number | null;
  /** When they checked themselves in with the QR code. */
  checkedInAt: string | null;
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
  /** What they owe, when they're a payer on a paid event. */
  bill: { lines: ChargeLine[]; total: number; payment: PaymentInfo | null } | null;
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
  answers?: Record<string, string>;
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
  /** Whether the person looking is one of those invited. */
  includesMe: boolean;
  /** When the charge list went to the treasurer (membership account events). */
  chargesSentAt: string | null;
  /** When the register was marked taken. */
  registerTakenAt: string | null;
  counts: { going: number; maybe: number; notGoing: number; adultGuests: number; childGuests: number; canHelp: number; came: number };
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
  paymentDetails?: string | null;
  guestsAllowed?: boolean;
  maxGuests?: number | null;
  helpNeeded?: string | null;
  questions?: EventQuestion[];
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

// ── Paying (step 2) ──────────────────────────────────────────────────────

export interface ChargeLine {
  name: string;
  what: "Member" | "Adult guest" | "Child guest";
  amount: number;
}

/** One payer's bill: their own place, anyone they signed up, and the guests. */
export interface PayerCharge {
  payerId: string;
  name: string;
  membershipNo: string | null;
  lines: ChargeLine[];
  total: number;
}

/** One answer as charging needs it. */
export interface ChargeInput {
  name: string;
  status: ResponseStatus;
  guests: Guest[];
  waived: boolean;
  payer: { personId: string; name: string; membershipNo: string | null };
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Who owes what (owner, 3 Oct 2026): everyone Going is charged, no-shows
 * included, to whoever signed them up, otherwise themselves; their guests
 * go on the same bill. A waived answer costs nothing. With no guest price
 * set, an adult guest pays the member price and a child the adult guest price.
 */
export function computeCharges(prices: Pick<EventDetails, "memberPrice" | "guestAdultPrice" | "guestChildPrice">, answers: ChargeInput[]): PayerCharge[] {
  const member = prices.memberPrice ?? 0;
  const adult = prices.guestAdultPrice ?? member;
  const child = prices.guestChildPrice ?? adult;
  const bills = new Map<string, PayerCharge>();
  for (const a of answers) {
    if (a.status !== "going" || a.waived) continue;
    const bill = bills.get(a.payer.personId) ?? { payerId: a.payer.personId, name: a.payer.name, membershipNo: a.payer.membershipNo, lines: [], total: 0 };
    bill.lines.push({ name: a.name, what: "Member", amount: member });
    for (const g of a.guests) bill.lines.push({ name: g.name, what: g.age === "child" ? "Child guest" : "Adult guest", amount: g.age === "child" ? child : adult });
    bill.total = cents(bill.lines.reduce((t, l) => t + l.amount, 0));
    bills.set(a.payer.personId, bill);
  }
  return [...bills.values()].sort((x, y) => x.name.localeCompare(y.name));
}

export type ReadStatus = "matched" | "amount_differs" | "duplicate" | "unreadable";
export const READ_STATUS_LABEL: Record<ReadStatus, string> = {
  matched: "Amount matches",
  amount_differs: "Amount differs",
  duplicate: "Reference already used",
  unreadable: "Couldn't read it",
};

/** What the screenshot shows against what they owe. A reference used before outranks everything. */
export function judgeProof(read: { amount: number | null }, due: number, duplicate: boolean): ReadStatus {
  if (duplicate) return "duplicate";
  if (read.amount == null) return "unreadable";
  return Math.abs(read.amount - due) < 0.01 ? "matched" : "amount_differs";
}

/** A payer's proof and what was read from it. */
export interface PaymentInfo {
  status: ReadStatus;
  amountDue: number | null;
  amountRead: number | null;
  paidOn: string | null;
  reference: string | null;
  payee: string | null;
  proofUrl: string | null;
  uploadedAt: string;
  /** The social secretary checked it against the real PayMe or bank record. */
  confirmedAt: string | null;
  confirmedBy: string | null;
}

/** GET /api/events/:id/charges. */
export interface ChargeList {
  payers: (PayerCharge & { payment: PaymentInfo | null })[];
  total: number;
  sentAt: string | null;
  /** Answers changed after the list went to the treasurer. */
  changedSince: string[];
}

/** The treasurer's list: one line per payer, with what it's for. */
export function chargesCsv(title: string, date: string, payers: PayerCharge[]): string {
  const cell = (v: string | number | null) => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = [["Name", "Membership no.", "Amount (HK$)", "For", "Event", "Date"]];
  for (const p of payers.filter((x) => x.total > 0)) {
    const what = p.lines.map((l) => (l.what === "Member" ? l.name : `${l.name} (${l.what.toLowerCase()})`)).join("; ");
    rows.push([p.name, p.membershipNo ?? "", p.total.toFixed(2), what, title, date]);
  }
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

/** Everyone's answers, for the caterer or the organiser: one line per person, then each guest. */
export function answersCsv(event: Pick<EventDetails, "questions">, rows: { name: string; status: ResponseStatus; guests: Guest[]; answers: Record<string, string>; canHelp: boolean; notes: string | null }[]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const dietary = asksDietary(event.questions);
  const header = ["Name", "Answer", "Guest of", ...event.questions.map((q) => q.label), "Can help", "Note"];
  const out = [header];
  for (const r of rows.filter((x) => x.status !== "not_going")) {
    out.push([r.name, RESPONSE_LABEL[r.status], "", ...event.questions.map((q) => r.answers[q.key] ?? ""), r.canHelp ? "Yes" : "", r.notes ?? ""]);
    for (const g of r.guests) {
      out.push([g.name, `Guest (${g.age})`, r.name, ...event.questions.map((q) => (q.key === DIETARY.key && dietary ? g.dietary ?? "" : "")), "", ""]);
    }
  }
  return out.map((row) => row.map(cell).join(",")).join("\r\n");
}

// ── Who came (the register and check-in) ─────────────────────────────────

/** GET /api/events/:id/checkin: what someone who scanned the QR code sees. */
export interface CheckInView {
  event: EventDetails;
  open: boolean;
  /** Them, and anyone they signed up, with their answer if they gave one. */
  people: { personId: string; name: string; self: boolean; response: ResponseDetails | null }[];
}

/** POST /api/events/:id/checkin: who is here, and how many of each one's guests. */
export interface CheckInInput {
  code: string;
  people: { personId: string; guestsCame?: number }[];
}
