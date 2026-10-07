/**
 * An umpire's own duties (6 Oct 2026 review, item D1): in their calendar
 * feed (calendar.ts), as a "Your duty" line on the player page
 * (fixtures.ts), and as a My Tasks line when one they hold moves or is
 * called off (myTasks.ts) until they open the umpiring board, which marks
 * it seen. Read through my_duties (migration 20261007160404).
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { db } from "./data/supabase";
import { getCached, invalidateCache } from "./cache";

export interface MyDuty {
  assignmentId: string;
  dutyId: string;
  matchDate: string;
  timeTbc: boolean;
  venue: string | null;
  homeTeam: string;
  awayTeam: string;
  slot: 1 | 2;
  dutyTeam: string;
  status: "scheduled" | "rescheduled" | "cancelled";
  previousMatchDate: string | null;
  changedAt: string | null;
  /** Changed since they took it, or since they last looked. */
  unseenChange: boolean;
  /** For a duty called off: the same slot's new date, once HKHA lists it. */
  movedTo: string | null;
}

interface DutyRow {
  assignment_id: string; duty_id: string; match_date: string; time_tbc: boolean; venue: string | null;
  home_team: string; away_team: string; slot: number; duty_team: string; status: MyDuty["status"];
  previous_match_date: string | null; changed_at: string | null; unseen_change: boolean; moved_to: string | null;
}

export const myDutiesKey = (personId: string) => `my-duties:${personId}`;

export async function getMyDuties(env: Env, personApiId: string): Promise<MyDuty[]> {
  const rows = await db(env).rpcRead<DutyRow[]>("my_duties", { p_person: personApiId });
  return (rows ?? []).map((r) => ({
    assignmentId: r.assignment_id,
    dutyId: r.duty_id,
    matchDate: r.match_date,
    timeTbc: r.time_tbc,
    venue: r.venue,
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    slot: r.slot === 2 ? 2 : 1,
    dutyTeam: r.duty_team,
    status: r.status,
    previousMatchDate: r.previous_match_date,
    changedAt: r.changed_at,
    unseenChange: r.unseen_change,
    movedTo: r.moved_to,
  }));
}

const HK_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", weekday: "short", day: "numeric", month: "short" });
const HK_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hour12: false });
const day = (iso: string) => HK_DAY.format(new Date(iso));
const time = (iso: string, tbc = false) => (tbc ? "time TBC" : HK_TIME.format(new Date(iso)));

/** "Sat 4 Oct, 09:00": when a duty is. */
export function dutyWhen(d: Pick<MyDuty, "matchDate" | "timeTbc">): string {
  return `${day(d.matchDate)}, ${time(d.matchDate, d.timeTbc)}`;
}

/** The My Tasks wording for a duty that changed, or null when it hasn't. */
export function dutyChangeText(d: MyDuty): string | null {
  if (!d.unseenChange) return null;
  const game = `${d.homeTeam} vs ${d.awayTeam}`;
  if (d.status !== "scheduled") {
    const off = d.status === "cancelled" ? "is off" : "is postponed";
    const now = d.movedTo ? `: now ${day(d.movedTo)}, take it again on the board` : "";
    return `Your duty on ${day(d.matchDate)} (${game}) ${off}${now}`;
  }
  if (d.previousMatchDate) {
    const sameDay = day(d.previousMatchDate) === day(d.matchDate);
    const from = sameDay ? time(d.previousMatchDate) : dutyWhen({ matchDate: d.previousMatchDate, timeTbc: false });
    return `Your duty moved: ${game}, ${from} → ${sameDay ? time(d.matchDate, d.timeTbc) : dutyWhen(d)}`;
  }
  return null;
}

/** The next duty still on, within two weeks: the player page's "Your duty" line. */
export function nextDuty(duties: MyDuty[], now = new Date()): MyDuty | null {
  const horizon = now.getTime() + 14 * 86_400_000;
  return (
    duties.find((d) => d.status === "scheduled" && new Date(d.matchDate).getTime() >= now.getTime() - 2 * 3_600_000 && new Date(d.matchDate).getTime() <= horizon) ?? null
  );
}

/** They've opened the board from the task: every change shown so far is seen, and the My Tasks lines go. */
export async function ackDutyChanges(env: Env, user: AuthorizedUser): Promise<{ seen: number }> {
  const unseen = (await getMyDuties(env, user.personId)).filter((d) => d.unseenChange);
  for (const d of unseen) await db(env).rpc<boolean | null>("ack_duty_change", { p_assignment: d.assignmentId, p_person: user.personId });
  invalidateCache(myDutiesKey(user.personId));
  return { seen: unseen.length };
}

export interface DutyLine {
  /** "Sat 4 Oct, 09:00" */
  when: string;
  game: string;
  venue: string | null;
  slot: 1 | 2;
}

/** The player page's "Your duty" line: the next duty within two weeks, or null. */
export async function nextDutyLine(env: Env, personApiId: string): Promise<DutyLine | null> {
  const { data } = await getCached(myDutiesKey(personApiId), () => getMyDuties(env, personApiId), 60_000);
  const d = nextDuty(data);
  return d ? { when: dutyWhen(d), game: `${d.homeTeam} vs ${d.awayTeam}`, venue: d.venue, slot: d.slot } : null;
}
