/**
 * Pure helpers for the ranking-history UI: proposed direction and the
 * non-blocking "reversal advisory" shown when a coach re-moves a player who
 * was recently moved by someone else.
 */

import type { RankingChange } from "./queries";

/** Direction of a proposed rank change (lower number = higher rank). */
export function proposedDirection(
  from: number | null | undefined,
  to: number | null | undefined,
): "up" | "down" | null {
  if (typeof from !== "number" || typeof to !== "number" || from === to) return null;
  return to < from ? "up" : "down";
}

/**
 * Most recent ranking event for a player (excluding deactivations), used to
 * surface a one-line advisory in the Move-to-rank sheet. Purely
 * informational - the coach is always free to proceed. Matching is by the
 * stable Airtable player id, not the display name (names are not unique);
 * when multiple events match, the newest timestamp wins regardless of array
 * order.
 */
export function getReversalAdvisory(
  changes: RankingChange[],
  playerId: string,
): RankingChange | null {
  let latest: RankingChange | null = null;
  for (const c of changes) {
    if (c.kind === "deactivate") continue;
    if (c.playerId !== playerId) continue;
    if (!latest || c.at > latest.at) latest = c;
  }
  return latest;
}

/**
 * Relative age for the "recent changes" list, e.g. "3 days ago".
 * Falls back to the raw date when the timestamp is unparseable.
 */
export function formatAge(at: string, now: Date = new Date()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at || "";
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/** Absolute date for hover/accessibility, e.g. "12 Aug 2026, 14:30" (UTC - server timestamps are ISO UTC). */
export function formatAbsolute(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at || "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
