/**
 * What happened to a fixture lately (6 Oct 2026 review, item D6): moved,
 * venue changed, postponed or cancelled. Shown on the cards for 7 days
 * after the change (owner, 6 Oct 2026); null otherwise. The database keeps
 * the previous values (migration 20261007160204_fixture_changes).
 */
import type { Match } from "./schema/domainTypes";
import { hkDateKey } from "./hkDateKey";

export const FIXTURE_CHANGE_DAYS = 7;
export const CALLED_OFF = ["Rescheduled", "Cancelled", "Postponed"] as const;

export interface FixtureChange {
  kind: "postponed" | "cancelled" | "moved" | "venue";
  /** The previous kick-off (moved) or venue (venue). */
  from?: string;
  /** When it changed (ISO). */
  at: string;
}

export function fixtureChange(
  m: Pick<Match, "matchDate" | "venue" | "matchStatus" | "previousMatchDate" | "previousVenue" | "changedAt">,
  now = new Date(),
): FixtureChange | null {
  if (!m.changedAt) return null;
  const age = now.getTime() - new Date(m.changedAt).getTime();
  if (!(age >= 0 && age < FIXTURE_CHANGE_DAYS * 86_400_000)) return null;
  const at = m.changedAt;
  if (m.matchStatus === "Cancelled") return { kind: "cancelled", at };
  if ((CALLED_OFF as readonly string[]).includes(m.matchStatus)) return { kind: "postponed", at };
  if (m.previousMatchDate && m.previousMatchDate !== m.matchDate) return { kind: "moved", from: m.previousMatchDate, at };
  if (m.previousVenue && m.previousVenue !== (m.venue ?? "")) return { kind: "venue", from: m.previousVenue, at };
  return null;
}

/** Postponed or cancelled: shown for a week, but not played and nothing to answer. */
export function isCalledOff(change: FixtureChange | null | undefined): boolean {
  return change?.kind === "postponed" || change?.kind === "cancelled";
}

const HK_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hour12: false });
const HK_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", weekday: "short", day: "numeric", month: "short" });

/** The card's line: "Postponed", "Cancelled", "Moved from 09:00" (same day) or "Moved from Sat 10 Oct", "Venue changed from KP". */
export function fixtureChangeText(change: FixtureChange, matchDate: string): string {
  switch (change.kind) {
    case "postponed":
      return "Postponed";
    case "cancelled":
      return "Cancelled";
    case "venue":
      return `Venue changed from ${change.from}`;
    case "moved": {
      const from = new Date(change.from ?? "");
      if (Number.isNaN(from.getTime())) return "Moved";
      const sameDay = hkDateKey(from.toISOString()) === hkDateKey(matchDate);
      return `Moved from ${sameDay ? HK_TIME.format(from) : HK_DAY.format(from)}`;
    }
  }
}
