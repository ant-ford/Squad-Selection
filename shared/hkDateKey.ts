/**
 * Calendar-day key in Asia/Hong_Kong, never UTC. A 03:00 HKT kick-off is
 * 19:00 UTC the PREVIOUS day, so grouping fixtures or evaluating same-day
 * rules by the UTC date would put an early-morning match on the wrong day.
 * Single authoritative definition - every same-day grouping in the app
 * (worker and frontend) must go through this, not a raw `.split("T")[0]`.
 */
export function hkDateKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(d);
}
