/**
 * Eddy's email, through Resend (eddy.global is verified there).
 *
 *  - Preview never mails anyone real: with MAIL_REDIRECT_TO set, every
 *    message goes there instead, subject prefixed [PREVIEW], and names its
 *    intended recipient only by record id.
 *  - Every send is logged in email_log by recipient record, not address,
 *    with how many addresses it went to.
 *  - Resend's free plan allows 100 a day and counts every To, CC and BCC
 *    address. Eddy adds up the addresses it has emailed today (UTC, as
 *    Resend counts) and stops at DAILY_LIMIT, leaving the rest for the
 *    sign-in codes Supabase Auth sends through the same account.
 *  - Emails carry links, not documents. The one exception is a filled PDF
 *    for someone who passes it on outside Eddy (the Club's membership office,
 *    the front desk, the Men's Convenor for HKHA; owner, 1 Oct 2026).
 *    Resend fetches it from a signed file link (`path`), so the Worker never
 *    base64-encodes megabytes inside its 10 ms of CPU.
 *  - An email sent in someone's name (`from`) comes from their address. No
 *    blind copy goes back to them (owner, 2 Oct 2026): Resend keeps what
 *    went out. If Resend refuses the sender's domain it goes from MAIL_FROM
 *    with them as Reply-To, so replies still reach them.
 */
import type { Env } from "./env";
import { db } from "./data/supabase";
import { isTimeout } from "./http";

/** Addresses a day: Resend allows 100, and about 30 are left for sign-in codes. */
export const DAILY_LIMIT = 70;

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
  /** Send in someone's name, e.g. "Anthony Ford <menscaptain@hkfchockey.com>". */
  from?: string;
  /** Filled PDFs only (see above): a filename and a signed file link Resend fetches. */
  attachments?: { filename: string; path: string }[];
}

const addressOf = (from: string) => from.match(/<([^>]+)>/)?.[1] ?? from.trim();

/** Resend's refusal of a sender domain it has not verified. */
const unverifiedSender = (status: number, message: string) =>
  (status === 403 || status === 422) && /domain|verif/i.test(message);

export class MailerError extends Error {}

/**
 * Several emails in one Worker run (the daily review emails): the day's
 * count is read once at the start and kept up to date here, and the log
 * rows are written together at the end (flushMailBatch), so each email
 * costs only its Resend call. A free-plan run may make 50 outside calls.
 */
export interface MailBatch {
  /** Addresses emailed today: the count at the start plus what this batch has sent. */
  sentToday: number;
  /** Calls made to Resend, for the run's count of outside calls. */
  resendCalls: number;
  /** email_log rows not yet written. */
  log: object[];
}

export async function openMailBatch(env: Env): Promise<MailBatch> {
  return { sentToday: await db(env).rpc<number>("emails_sent_today", {}), resendCalls: 0, log: [] };
}

/** Writes the batch's log rows in one insert. Like a single email's log, a failed write is logged, not thrown. */
export async function flushMailBatch(env: Env, batch: MailBatch): Promise<void> {
  const rows = batch.log.splice(0);
  if (!rows.length) return;
  await db(env).insert("email_log", rows).catch((err) => console.error("email_log write failed:", err instanceof Error ? err.message : err));
}

/** Room for this many more addresses today. */
export const roomToday = (batch: MailBatch, recipients: number) => batch.sentToday + recipients <= DAILY_LIMIT;

/**
 * How long Resend gets to answer. It usually answers in well under a
 * second; 10 s allows for a slow moment (or fetching a PDF attachment)
 * without leaving a request, or the daily run, hanging on it.
 */
export const RESEND_TIMEOUT_MS = 10_000;

export async function sendEmail(env: Env, email: Email, batch?: MailBatch): Promise<{ id: string }> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new MailerError("Email is not configured (RESEND_API_KEY / MAIL_FROM)");
  const d = db(env);
  const redirect = env.MAIL_REDIRECT_TO;
  // What Resend will count: the one preview address, or the To and each CC.
  const recipients = redirect ? 1 : 1 + (email.cc?.length ?? 0);
  const sentToday = batch ? batch.sentToday : await d.rpc<number>("emails_sent_today", {});
  if (sentToday + recipients > DAILY_LIMIT) throw new MailerError(`Daily email limit (${DAILY_LIMIT}) reached; will try again tomorrow`);

  const attachments = email.attachments?.length ? email.attachments : undefined;
  const message = redirect
    ? {
        attachments,
        to: [redirect],
        subject: `[PREVIEW] ${email.subject}`,
        text: `Preview: this would have gone to person ${email.toPersonId}${email.cc?.length ? ` (with ${email.cc.length} cc)` : ""}.\n\n${email.text}`,
      }
    : { to: [email.to], cc: email.cc?.length ? email.cc : undefined, subject: email.subject, text: email.text, attachments };

  /**
   * Resend's answer. No answer in time (or none at all) is status 0 and goes
   * down the same path as a refusal: logged as failed, then a MailerError.
   * Resend may still have sent it; the log says it did not answer.
   */
  const post = async (from: string, replyTo?: string): Promise<{ status: number; ok: boolean; body: { id?: string; message?: string } }> => {
    if (batch) batch.resendCalls++;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, reply_to: replyTo, ...message }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
      return { status: res.status, ok: res.ok, body: (await res.json().catch(() => ({}))) as { id?: string; message?: string } };
    } catch (err) {
      const why = isTimeout(err) ? `no answer within ${RESEND_TIMEOUT_MS / 1000} s` : `unreachable: ${err instanceof Error ? err.message : String(err)}`;
      return { status: 0, ok: false, body: { message: why } };
    }
  };
  let sender = email.from ?? env.MAIL_FROM;
  let res = await post(sender, email.replyTo);
  let body = res.body;
  if (!res.ok && email.from && unverifiedSender(res.status, String(body.message ?? ""))) {
    // The captain's domain is not verified in Resend yet: send as Eddy, replies to him.
    console.warn("Sender domain not verified in Resend; sending from MAIL_FROM with Reply-To");
    sender = env.MAIL_FROM;
    res = await post(sender, email.replyTo ?? addressOf(email.from));
    body = res.body;
  }
  const ok = res.ok && typeof body.id === "string";
  const row = {
    to_person_id: email.toPersonId,
    sender,
    template: email.template,
    step_id: email.stepId ?? null,
    provider_message_id: body.id ?? null,
    status: ok ? "sent" : "failed",
    recipients,
    // Resend's error message describes the request, not the recipient.
    error: ok ? null : `${res.status} ${String(body.message ?? "").slice(0, 200)}`,
  };
  if (batch) {
    // Written later, so it carries the time it went rather than the insert's.
    batch.log.push({ ...row, sent_at: new Date().toISOString() });
    if (ok) batch.sentToday += recipients;
  } else {
    await d.insert("email_log", [row]).catch((err) => console.error("email_log write failed:", err instanceof Error ? err.message : err));
  }
  if (!ok) throw new MailerError(res.status ? `Resend refused the email (${res.status})` : `Resend did not take the email (${body.message})`);
  return { id: body.id! };
}
