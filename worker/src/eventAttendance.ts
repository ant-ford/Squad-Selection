/**
 * The events someone attended (migrations 20261003190000 and 20261006120000;
 * owner): ticked on the register or checked in with the QR code, at a
 * published event that has started. For the commitment review, which ticks the social functions
 * from it and lists the rest. Kept apart from events.ts so reviews.ts
 * loads only this.
 */
import type { Env } from "./env";
import { backendFor } from "./data/backend";
import { db, eq } from "./data/supabase";
import type { AttendedEvent } from "../../shared/commitmentReview";

/** Events attended from `from` to `to` (dates, both included), oldest first. */
export async function attendedEvents(env: Env, personApiId: string, from: string | null, to: string | null): Promise<AttendedEvent[]> {
  if (backendFor(env, "people") !== "supabase" || !from || !to) return [];
  const d = db(env);
  const p = await d.one<{ id: string }>("people", `select=id&api_id=${eq(personApiId)}`);
  if (!p) return [];
  // The period's last day counts in full; nothing still to come counts.
  const end = Math.min(Date.parse(`${to}T23:59:59+08:00`), Date.now());
  const rows = await d.select<{ event: { id: string; event_type: string; title: string; starts_at: string; social_function: string | null } | null }>(
    "event_responses",
    `select=event:events!inner(id,event_type,title,starts_at,social_function)&person_id=${eq(p.id)}&attended=is.true` +
      `&event.status=eq.published&event.starts_at=gte.${encodeURIComponent(`${from}T00:00:00+08:00`)}&event.starts_at=lte.${encodeURIComponent(new Date(end).toISOString())}`,
    "event_id,person_id",
  );
  return rows
    .flatMap((r) => (r.event ? [{ id: r.event.id, type: r.event.event_type, title: r.event.title, startsAt: r.event.starts_at, socialFunction: r.event.social_function }] : []))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
