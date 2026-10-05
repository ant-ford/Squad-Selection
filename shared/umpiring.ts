/**
 * Umpiring duties (owner, 6 Oct 2026). HKHA gives HKFC teams umpiring
 * duties, in other clubs' games as much as our own; hkha-sync keeps them in
 * umpire_duties. The club's umpires take them in Eddy, and George Lam, the
 * Umpire Coordinator, fills any gap and sends the week's list on WhatsApp:
 * first the open slots to the umpires group, then the final list to the
 * captains group. See supabase/migrations/20261006120000_umpiring.sql.
 *
 *  - Who sees the duties: qualified umpires (an umpiring level on their
 *    volunteering), and anyone who umpired an HKFC game in the last 12
 *    months, on the match card or in Eddy.
 *  - Anyone still on their commitment umpires unpaid. Once it has ended
 *    they choose free or paid. Unpaid is confirmed at once; paid waits for
 *    the coordinator, so an unpaid umpire can still take the game first.
 *  - Paid is a flag only: no fee is recorded.
 */
import { hkDateKey } from "./hkDateKey";

export type DutyStatus = "scheduled" | "rescheduled" | "cancelled";
export type AssignmentStatus = "offered" | "confirmed" | "withdrawn" | "no_show";

export interface DutyAssignment {
  id: string;
  /** People api id; null for an outside umpire. */
  personId: string | null;
  /** The name to show: a club umpire's first name, or the outside umpire's name. */
  name: string;
  external: boolean;
  paid: boolean;
  status: AssignmentStatus;
  createdAt: string;
}

export interface UmpireDuty {
  id: string;
  /** ISO; for a TBC time, midnight HK time. */
  matchDate: string;
  timeTbc: boolean;
  division: string | null;
  venue: string | null;
  homeTeam: string;
  awayTeam: string;
  slot: 1 | 2;
  /** "HKFC F". */
  dutyTeam: string;
  status: DutyStatus;
  /** Offers, the confirmed umpire, no-shows; withdrawn ones are left out. */
  assignments: DutyAssignment[];
}

export type UmpiringAccess = "umpire" | "coordinator";

/** A club umpire the coordinator can put down for a game. */
export interface UmpireOption {
  personId: string;
  name: string;
  /** For telling two people with one first name apart. */
  fullName: string;
  onCommitment: boolean;
}

/** GET /api/umpiring. */
export interface UmpiringBoard {
  access: UmpiringAccess;
  /** Monday (HK) of the week shown, yyyy-mm-dd. */
  week: string;
  /** The weeks with duties, Mondays, for the week picker. */
  weeks: string[];
  duties: UmpireDuty[];
  me: {
    personId: string;
    /** Whether they appear in the umpires' list themselves. */
    isUmpire: boolean;
    onCommitment: boolean;
    commitmentEndDate: string | null;
  };
  /** Coordinator only: the umpires' list, for putting someone down. */
  umpires?: UmpireOption[];
  /** Coordinator only: names of outside umpires used before, most recent first. */
  externalNames?: string[];
  /** Where the umpires' link in the first message points. */
  link: string;
}

export interface UmpireTally {
  name: string;
  /** People api id; null for an outside umpire. */
  personId: string | null;
  external: boolean;
  free: number;
  paid: number;
  noShows: number;
}

/** GET /api/umpiring/report. Played games of one season only. */
export interface UmpiringReport {
  season: string;
  /** Duties in games already played (cancelled ones left out). */
  duties: number;
  coveredFree: number;
  coveredPaidMembers: number;
  coveredExternal: number;
  noShows: number;
  uncovered: number;
  umpires: UmpireTally[];
  /** Duties per HKFC team, and how many of them the club umpires covered for free. */
  byTeam: { team: string; duties: number; free: number }[];
}

/**
 * Still on their commitment: an end date not yet reached. No end date is
 * taken as finished (Claude's assumption, 6 Oct 2026, to confirm).
 */
export function isOnCommitment(commitmentEndDate: string | null | undefined, today: string): boolean {
  return !!commitmentEndDate && commitmentEndDate.slice(0, 10) > today;
}

/** The live umpire for a slot: the confirmed one (or a no-show). */
export function confirmedOf(duty: Pick<UmpireDuty, "assignments">): DutyAssignment | undefined {
  return duty.assignments.find((a) => a.status === "confirmed" || a.status === "no_show");
}

export function isOpen(duty: Pick<UmpireDuty, "assignments" | "status">): boolean {
  return duty.status !== "cancelled" && !confirmedOf(duty);
}

/** Monday of the HK week a date falls in, yyyy-mm-dd. */
export function weekOf(iso: string): string {
  const day = hkDateKey(iso);
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** The Sunday ending a week given by its Monday. */
export function weekEnd(monday: string): string {
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/** The season (July to June, HK) a date falls in: "2026-2027". */
export function seasonOf(iso: string): string {
  const [y, m] = hkDateKey(iso).split("-").map(Number);
  const start = m >= 7 ? y : y - 1;
  return `${start}-${start + 1}`;
}

const hkParts = (iso: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: get("day"), month: get("month"), hour: get("hour"), minute: get("minute") };
};

/**
 * One duty as George writes it: "4/10 0900 HKFC D", the date, the
 * kick-off, the venue and the duty team's letter.
 */
export function dutyLine(duty: Pick<UmpireDuty, "matchDate" | "timeTbc" | "venue" | "dutyTeam">): string {
  const p = hkParts(duty.matchDate);
  const time = duty.timeTbc ? "TBC" : `${p.hour}${p.minute}`;
  const letter = duty.dutyTeam.replace(/^HKFC\s+/, "");
  return [`${Number(p.day)}/${Number(p.month)}`, time, duty.venue || "TBC", letter].join(" ");
}

/** "✅George" for a club umpire, "💰Pagey" for a paid one. */
export function umpireMark(a: Pick<DutyAssignment, "paid" | "name">): string {
  return `${a.paid ? "💰" : "✅"}${a.name}`;
}

const HEADER = "🏑Weekly Club Duties🥳";

const inOrder = <T extends Pick<UmpireDuty, "matchDate" | "slot" | "venue">>(duties: T[]) =>
  [...duties].sort((a, b) => a.matchDate.localeCompare(b.matchDate) || (a.venue ?? "").localeCompare(b.venue ?? "") || a.slot - b.slot);

/**
 * The first message, to the umpires group: every duty of the week, the
 * ones already taken marked, and the link to put a name down.
 */
export function umpiresMessage(duties: UmpireDuty[], link: string): string {
  const lines = inOrder(duties.filter((d) => d.status !== "cancelled")).map((d) => {
    const c = confirmedOf(d);
    return c ? `${dutyLine(d)} ${umpireMark(c)}` : dutyLine(d);
  });
  return [HEADER, "", ...lines, "", `Put your name down: ${link}`].join("\n");
}

/** The second message, to the captains group: the week's umpires. */
export function captainsMessage(duties: UmpireDuty[]): string {
  const lines = inOrder(duties.filter((d) => d.status !== "cancelled")).map((d) => {
    const c = confirmedOf(d);
    return c ? `${dutyLine(d)} ${umpireMark(c)}` : `${dutyLine(d)} ❓`;
  });
  return [HEADER, "", ...lines].join("\n");
}

/** Opens WhatsApp with the message ready to send; the group is chosen there. */
export function whatsappShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
