import type { Env } from "../env";
import { db, eq } from "../data/supabase";
import type { EventDetails, Guest } from "../../../shared/events";
import { type EventRow, EVENT_COLS, RESPONSE_KEY, toDetails } from "./shared";

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
