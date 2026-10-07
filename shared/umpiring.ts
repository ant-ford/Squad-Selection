/**
 * Umpiring duties (owner, 6 Oct 2026). HKHA gives HKFC teams umpiring
 * duties, in other clubs' games as much as our own; hkha-sync keeps them in
 * umpire_duties. The club's umpires take them in Eddy, and George Lam, the
 * Umpire Coordinator, fills any gap and sends the week's list on WhatsApp:
 * first the open slots to the umpires group, then the final list to the
 * captains group. See supabase/migrations/20261006200000_umpiring.sql.
 *
 *  - Who sees the duties: qualified umpires (an umpiring level on their
 *    volunteering), and anyone who umpired an HKFC game in the last 12
 *    months, on the match card or in Eddy.
 *  - Anyone still on their commitment umpires unpaid. Once it has ended
 *    they choose free or paid. Unpaid is confirmed at once; paid waits for
 *    the coordinator, so an unpaid umpire can still take the game first.
 *  - Paid is a flag only: no fee is recorded.
 */
import { addDays, hkDateKey } from "./hkDateKey";
import { byKickOff, isTbcKickOff } from "./kickOff";
import { canonicalKey, tidy } from "./umpires";

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
  /** No umpire needed (a walk-over), marked by the coordinator. */
  notNeeded: boolean;
  /** Offers, the confirmed umpire, no-shows; withdrawn ones are left out. */
  assignments: DutyAssignment[];
  /** The viewer's own game it clashes with ("10:45 HKFC D vs Valley B"), if any. */
  clash?: string;
  /** Coordinator only: club umpires playing at a clashing time, People api id -> kick-off ("10:45"). */
  clashes?: Record<string, string>;
}

/** One of an umpire's own games: their team's, or one they're picked for. */
export interface OwnGame {
  matchDate: string;
  venue: string | null;
  homeTeam: string;
  awayTeam: string;
}

/** Same ground: the next slot (1h45 later) is fine, anything closer overlaps. */
const SAME_GROUND_MS = 105 * 60 * 1000;
/** Another ground: a small margin for getting there (owner, 6 Oct 2026). */
const OTHER_GROUND_MS = 120 * 60 * 1000;

/** A TBC kick-off is stored as midnight HK time. */
const isTbc = isTbcKickOff;

/**
 * The umpire's game a duty clashes with: kick-offs too close for the ground,
 * or either time still TBC on the same day.
 */
export function clashingGame(duty: Pick<UmpireDuty, "matchDate" | "timeTbc" | "venue">, games: OwnGame[]): OwnGame | undefined {
  const day = hkDateKey(duty.matchDate);
  const at = new Date(duty.matchDate).getTime();
  return games.find((g) => {
    if (hkDateKey(g.matchDate) !== day) return false;
    if (duty.timeTbc || isTbc(g.matchDate)) return true;
    const gap = Math.abs(new Date(g.matchDate).getTime() - at);
    const sameGround = !!duty.venue && duty.venue === g.venue;
    return gap < (sameGround ? SAME_GROUND_MS : OTHER_GROUND_MS);
  });
}

/** "10:45", HK time. */
export function hkTime(iso: string): string {
  const p = hkParts(iso);
  return `${p.hour}:${p.minute}`;
}

/** "10:45 HKFC D vs Valley B" ("TBC" for a time not yet set). */
export function gameLabel(g: OwnGame): string {
  return `${isTbc(g.matchDate) ? "TBC" : hkTime(g.matchDate)} ${g.homeTeam} vs ${g.awayTeam}`;
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
  /** The week's WhatsApp messages: the Umpire Coordinator office only (owner, 7 Oct 2026), not the Section Captains. */
  messages: boolean;
  /** Coordinator only: the umpires' list, for putting someone down. */
  umpires?: UmpireOption[];
  /**
   * Coordinator only: outside umpires' names, A–Z, one spelling each. Those
   * put down in Eddy and those on HKFC match cards in the last 12 months.
   */
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

/** How a played duty was covered. */
export type DutyOutcome = "free" | "paid" | "outside" | "no_show" | "uncovered" | "not_needed";

/** One played duty in the season report. */
export interface ReportDuty {
  matchDate: string;
  timeTbc: boolean;
  venue: string | null;
  division: string | null;
  homeTeam: string;
  awayTeam: string;
  dutyTeam: string;
  /** People api id of a club umpire. */
  personId: string | null;
  /** Full name (club) or as entered (outside); null when uncovered. */
  umpire: string | null;
  /** First name, for the grid. */
  short: string | null;
  outcome: DutyOutcome;
}

/** Duties per HKFC team and how each was covered (George's season summary). */
export interface TeamTally {
  team: string;
  duties: number;
  free: number;
  paidMembers: number;
  outside: number;
  /** Nobody, or a no-show. */
  uncovered: number;
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
  byTeam: TeamTally[];
  /** Every played duty, in date order. */
  rows: ReportDuty[];
}

const OUTCOME_LABEL: Record<DutyOutcome, string> = {
  free: "Free",
  paid: "Paid (member)",
  outside: "Paid (outside)",
  no_show: "No-show",
  uncovered: "Uncovered",
  not_needed: "Not needed",
};

/** Every played duty as spreadsheet rows, with a header. */
export function reportCsvRows(report: Pick<UmpiringReport, "rows">): string[][] {
  const header = ["Date", "Time", "Venue", "Division", "Home", "Away", "Duty team", "Umpire", "Affiliation", "Type"];
  return [
    header,
    ...report.rows.map((r) => [
      hkDateKey(r.matchDate),
      r.timeTbc ? "TBC" : hkTime(r.matchDate),
      r.venue ?? "",
      r.division ?? "",
      r.homeTeam,
      r.awayTeam,
      r.dutyTeam,
      r.umpire ?? "",
      r.umpire ? (r.outcome === "outside" ? "Outside" : "HKFC") : "",
      OUTCOME_LABEL[r.outcome],
    ]),
  ];
}

/** A grid cell: "George", "💰Pagey", "✗Ann" for a no-show, "–" for nobody. */
export function gridCell(r: Pick<ReportDuty, "outcome" | "short">): string {
  if (r.outcome === "not_needed") return "n/a";
  if (r.outcome === "uncovered" || !r.short) return "–";
  if (r.outcome === "no_show") return `✗${r.short}`;
  return r.outcome === "free" ? r.short : `💰${r.short}`;
}

/**
 * George's grid: a row per match day, a column per duty team, who umpired
 * in each cell (two duties for one team on a day share the cell).
 */
export function reportGrid(report: Pick<UmpiringReport, "rows">): { teams: string[]; days: { day: string; cells: Record<string, string[]> }[] } {
  const teams = [...new Set(report.rows.map((r) => r.dutyTeam))].sort();
  const days = new Map<string, Record<string, string[]>>();
  for (const r of report.rows) {
    const day = hkDateKey(r.matchDate);
    const cells = days.get(day) ?? {};
    (cells[r.dutyTeam] ??= []).push(gridCell(r));
    days.set(day, cells);
  }
  return { teams, days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, cells]) => ({ day, cells })) };
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
  return addDays(monday, 6);
}

/** The season (July to June, HK) a date falls in: "2026-2027". */
export function seasonOf(iso: string): string {
  const [y, m] = hkDateKey(iso).split("-").map(Number);
  const start = m >= 7 ? y : y - 1;
  return `${start}-${start + 1}`;
}

const HK_PARTS_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Hong_Kong",
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const hkParts = (iso: string) => {
  const parts = HK_PARTS_FORMAT.formatToParts(new Date(iso));
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

/** Kick-off order (a TBC time after the day's timed games), then venue and slot. */
const inOrder =<T extends Pick<UmpireDuty, "matchDate" | "slot" | "venue">>(duties: T[]) =>
  [...duties].sort((a, b) => byKickOff(a.matchDate, b.matchDate) || (a.venue ?? "").localeCompare(b.venue ?? "") || a.slot - b.slot);

/**
 * The first message, to the umpires group: every duty of the week, the
 * ones already taken marked, and the link to put a name down.
 */
export function umpiresMessage(duties: UmpireDuty[], link: string): string {
  const lines = inOrder(duties.filter((d) => d.status !== "cancelled")).map((d) => {
    if (d.notNeeded) return `${dutyLine(d)} ${NOT_NEEDED}`;
    const c = confirmedOf(d);
    return c ? `${dutyLine(d)} ${umpireMark(c)}` : dutyLine(d);
  });
  return [HEADER, "", ...lines, "", `Put your name down: ${link}`].join("\n");
}

/** A walk-over's line ends with this in both messages. */
const NOT_NEEDED = "Not needed";

/** The second message, to the captains group: the week's umpires. */
export function captainsMessage(duties: UmpireDuty[]): string {
  const lines = inOrder(duties.filter((d) => d.status !== "cancelled")).map((d) => {
    if (d.notNeeded) return `${dutyLine(d)} ${NOT_NEEDED}`;
    const c = confirmedOf(d);
    return c ? `${dutyLine(d)} ${umpireMark(c)}` : `${dutyLine(d)} ❓`;
  });
  return [HEADER, "", ...lines].join("\n");
}

// ── Outside umpires' names ─────────────────────────────────────────────

/**
 * One name per outside umpire, however it was written (case, spacing,
 * word order): the first list's spelling wins, then A–Z.
 */
export function mergeOutsideNames(...lists: readonly string[][]): string[] {
  const byKey = new Map<string, string>();
  for (const list of lists) {
    for (const raw of list) {
      const name = tidy(raw);
      const key = canonicalKey(name);
      if (key && !byKey.has(key)) byKey.set(key, name);
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/** The known spelling of a name typed in another case, spacing or order. */
export function knownSpelling(typed: string, known: readonly string[]): string | undefined {
  const key = canonicalKey(typed);
  return key ? known.find((n) => canonicalKey(n) === key) : undefined;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

const words = (name: string) => canonicalKey(name).split(" ").filter(Boolean);
const asWritten = (name: string) => tidy(name).toLowerCase().replace(/[(),.]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Known outside umpires a new name probably means, best first (up to
 * three): a spelling a letter or two out ("Andy Chen" for Andy Chan), or
 * part of a name ("Boettger" for Philipp Boettger). None when the name is
 * already known in another case or spacing: that spelling is used anyway.
 */
export function similarOutsideNames(typed: string, known: readonly string[]): string[] {
  const key = canonicalKey(typed);
  if (key.length < 3 || knownSpelling(typed, known)) return [];
  // A slip per five letters, at most two.
  const allowed = Math.min(2, Math.floor(key.length / 5));
  const mine = words(typed);
  const scored: { name: string; score: number }[] = [];
  for (const name of known) {
    const distance = Math.min(editDistance(key, canonicalKey(name)), editDistance(asWritten(typed), asWritten(name)));
    if (distance <= allowed) {
      scored.push({ name, score: distance });
      continue;
    }
    // Fewer words, each one of theirs (a slip allowed in a longer word).
    const theirs = words(name);
    const part =
      mine.length < theirs.length &&
      mine.every((w) => w.length >= 3 && theirs.some((t) => t === w || (w.length >= 5 && editDistance(t, w) <= 1)));
    if (part) scored.push({ name, score: 3 });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((s) => s.name);
}
