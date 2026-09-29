/**
 * Eddy's email, through Resend (eddy.global is verified there).
 *
 *  - Preview never mails anyone real: with MAIL_REDIRECT_TO set, every
 *    message goes there instead, subject prefixed [PREVIEW], and names its
 *    intended recipient only by record id.
 *  - Every send is logged in email_log by recipient record, not address.
 *  - Resend's free plan allows 100 a day; Eddy stops at DAILY_LIMIT so a
 *    burst cannot cost the next day's sign-in codes (they share the account).
 *  - Emails carry links, never documents (no attachments here at all).
 */
import type { Env } from "./env";
import { db } from "./data/supabase";

export const DAILY_LIMIT = 90;

export interface Email {
  /** The recipient's people.id (uuid), for the log and the preview note. */
  toPersonId: string;
  to: string;
  subject: string;
  text: string;
  /** Which kind of email, for the log (e.g. "commitment-review-request"). */
  template: string;
  stepId?: string;
  cc?: string[];
  replyTo?: string;
}

export class MailerError extends Error {}

export async function sendEmail(env: Env, email: Email): Promise<{ id: string }> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new MailerError("Email is not configured (RESEND_API_KEY / MAIL_FROM)");
  const d = db(env);
  const sentToday = await d.rpc<number>("emails_sent_today", {});
  if (sentToday >= DAILY_LIMIT) throw new MailerError(`Daily email limit (${DAILY_LIMIT}) reached; will try again tomorrow`);

  const redirect = env.MAIL_REDIRECT_TO;
  const message = redirect
    ? {
        to: [redirect],
        subject: `[PREVIEW] ${email.subject}`,
        text: `Preview: this would have gone to person ${email.toPersonId}${email.cc?.length ? ` (with ${email.cc.length} cc)` : ""}.\n\n${email.text}`,
      }
    : { to: [email.to], cc: email.cc?.length ? email.cc : undefined, subject: email.subject, text: email.text };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, reply_to: email.replyTo, ...message }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  const ok = res.ok && typeof body.id === "string";
  await d.insert("email_log", [{
    to_person_id: email.toPersonId,
    sender: env.MAIL_FROM,
    template: email.template,
    step_id: email.stepId ?? null,
    provider_message_id: body.id ?? null,
    status: ok ? "sent" : "failed",
    // Resend's error message describes the request, not the recipient.
    error: ok ? null : `${res.status} ${String(body.message ?? "").slice(0, 200)}`,
  }]).catch((err) => console.error("email_log write failed:", err instanceof Error ? err.message : err));
  if (!ok) throw new MailerError(`Resend refused the email (${res.status})`);
  return { id: body.id! };
}
