/**
 * Eddy's email, through Resend (eddy.global is verified there).
 *
 *  - Preview never mails anyone real: with MAIL_REDIRECT_TO set, every
 *    message goes there instead, subject prefixed [PREVIEW], and names its
 *    intended recipient only by record id.
 *  - Every send is logged in email_log by recipient record, not address.
 *  - Resend's free plan allows 100 a day; Eddy stops at DAILY_LIMIT so a
 *    burst cannot cost the next day's sign-in codes (they share the account).
 *  - Emails carry links, not documents. The one exception is a filled PDF
 *    for someone who passes it on outside Eddy (the Club's membership office,
 *    the front desk, the Hockey Convenor for HockeyHK; owner, 1 Oct 2026).
 *    Resend fetches it from a signed file link (`path`), so the Worker never
 *    base64-encodes megabytes inside its 10 ms of CPU.
 *  - An email sent in the captain's name (`from`) comes from his address
 *    with a blind copy to it, so he keeps what went out. Resend sends from
 *    hkfchockey.com only once that domain is verified there; until then it
 *    goes from MAIL_FROM with the captain as Reply-To, so replies still
 *    reach him.
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
  /** Send in someone's name, e.g. "Anthony Ford <menscaptain@hkfchockey.com>"; they get a blind copy. */
  from?: string;
  /** Filled PDFs only (see above): a filename and a signed file link Resend fetches. */
  attachments?: { filename: string; path: string }[];
}

const addressOf = (from: string) => from.match(/<([^>]+)>/)?.[1] ?? from.trim();

/** Resend's refusal of a sender domain it has not verified. */
const unverifiedSender = (status: number, message: string) =>
  (status === 403 || status === 422) && /domain|verif/i.test(message);

export class MailerError extends Error {}

export async function sendEmail(env: Env, email: Email): Promise<{ id: string }> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new MailerError("Email is not configured (RESEND_API_KEY / MAIL_FROM)");
  const d = db(env);
  const sentToday = await d.rpc<number>("emails_sent_today", {});
  if (sentToday >= DAILY_LIMIT) throw new MailerError(`Daily email limit (${DAILY_LIMIT}) reached; will try again tomorrow`);

  const redirect = env.MAIL_REDIRECT_TO;
  const bcc = email.from ? [addressOf(email.from)] : undefined;
  const attachments = email.attachments?.length ? email.attachments : undefined;
  const message = redirect
    ? {
        attachments,
        to: [redirect],
        subject: `[PREVIEW] ${email.subject}`,
        text: `Preview: this would have gone to person ${email.toPersonId}${email.cc?.length ? ` (with ${email.cc.length} cc)` : ""}${bcc ? " (and a blind copy to the sender)" : ""}.\n\n${email.text}`,
      }
    : { to: [email.to], cc: email.cc?.length ? email.cc : undefined, bcc, subject: email.subject, text: email.text, attachments };

  const post = (from: string, replyTo?: string) =>
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, reply_to: replyTo, ...message }),
    });
  let sender = email.from ?? env.MAIL_FROM;
  let res = await post(sender, email.replyTo);
  let body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok && email.from && unverifiedSender(res.status, String(body.message ?? ""))) {
    // The captain's domain is not verified in Resend yet: send as Eddy, replies to him.
    console.warn("Sender domain not verified in Resend; sending from MAIL_FROM with Reply-To");
    sender = env.MAIL_FROM;
    res = await post(sender, email.replyTo ?? addressOf(email.from));
    body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  }
  const ok = res.ok && typeof body.id === "string";
  await d.insert("email_log", [{
    to_person_id: email.toPersonId,
    sender,
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
