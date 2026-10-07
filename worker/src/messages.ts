/**
 * "WhatsApp these people" (6 Oct 2026 review, item D3): the message
 * templates, and a message_log row per message. The app can't send a
 * WhatsApp, so a row means the sender opened one. Templates and log were
 * imported from Airtable; the People "Send WhatsApp" Apps Script did this
 * before.
 *
 *   GET  /api/messages/templates   [{id, name, body}], newest name first
 *   POST /api/messages/log         {personId, message, templateId?}
 *
 * For whoever sees a list of people with mobiles: officers and coaches.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { db, eq } from "./data/supabase";

export interface MessageTemplate {
  id: string;
  name: string;
  body: string;
}

function requireSender(user: AuthorizedUser): void {
  if (user.role !== "coach" && user.officerRoles.length === 0) {
    throw new HttpError("For officers and coaches.", 403, "OFFICER_ACCESS_REQUIRED");
  }
}

export async function listTemplates(env: Env, user: AuthorizedUser): Promise<{ templates: MessageTemplate[] }> {
  requireSender(user);
  const rows = await db(env).select<{ id: string; name: string; body: string | null }>("message_templates", "select=id,name,body&order=name.desc");
  return { templates: rows.filter((r) => r.body).map((r) => ({ id: r.id, name: r.name, body: r.body ?? "" })) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One message opened in WhatsApp. The mobile logged is the one on record, not one the browser sends. */
export async function logMessage(env: Env, user: AuthorizedUser, body: Record<string, unknown>): Promise<{ ok: true }> {
  requireSender(user);
  const personId = typeof body.personId === "string" ? body.personId : "";
  const message = typeof body.message === "string" ? body.message.slice(0, 4000) : "";
  const templateId = typeof body.templateId === "string" && UUID.test(body.templateId) ? body.templateId : null;
  if (!/^[A-Za-z0-9-]{3,64}$/.test(personId) || !message.trim()) throw new HttpError("Choose a person and a message.", 400, "INVALID_INPUT");
  const d = db(env);
  const person = await d.one<{ id: string; mobile_no: string | null }>("people", `select=id,mobile_no&api_id=${eq(personId)}`);
  if (!person) throw new HttpError("Person not found.", 404, "NOT_FOUND");
  await d.insert("message_log", [
    { person_id: person.id, template_id: templateId, message, mobile_no: person.mobile_no, sent_at: new Date().toISOString() },
  ]);
  return { ok: true };
}
