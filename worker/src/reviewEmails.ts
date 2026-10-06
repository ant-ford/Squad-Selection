/**
 * Commitment review emails - the job of the two former
 * Airtable "Email Commitment Form" automations:
 *
 *  - daily (the Worker's cron): every review whose period ends within 60
 *    days and has not started gets its request email;
 *  - Notify Now (the Statements board): one review, straight away.
 *
 * Starting a review is claimed in the database first (start_review), which
 * also opens the member's My Tasks step, so a review is never emailed twice.
 * If the email then fails, the claim is undone and the next run retries.
 * One email when the step starts; no reminders (owner decision).
 */
import type { Env } from "./env";
import { db } from "./data/supabase";
import { DAILY_LIMIT, flushMailBatch, MailerError, openMailBatch, roomToday, sendEmail, type MailBatch } from "./mailer";
import { currentRequestContext, newRequestStats, runWithRequestContext } from "./requestContext";

interface Started {
  commitment_id: string; step_id: string; person_id: string; email: string | null;
  preferred_name: string | null; year_no: number | null; period: string | null;
}

function requestEmail(env: Env, s: Started) {
  const app = (env.APP_ORIGIN ?? "https://app.eddy.global").replace(/\/+$/, "");
  const year = s.year_no ? `Year ${s.year_no} ` : "";
  return {
    subject: `Your HKFC Hockey commitment review${s.year_no ? ` (Year ${s.year_no})` : ""}`,
    text: [
      `Hi ${s.preferred_name || "there"},`,
      "",
      `Your ${year}commitment period${s.period ? ` (${s.period})` : ""} is coming to an end, so it is time for your annual commitment review.`,
      "",
      `Please sign in to Eddy and complete your Player Statement. You will find it under My Tasks:`,
      app,
      "",
      "Once you have submitted it, your sponsor and then the Membership Officer add their review.",
      "",
      "HKFC Hockey Section",
    ].join("\n"),
  };
}

/**
 * Starts one review and sends its email. False when it had already started.
 * `batch` is the daily run's (sendDueReviewEmails); Notify Now sends alone.
 */
export async function startReview(env: Env, commitmentId: string, batch?: MailBatch): Promise<boolean> {
  const d = db(env);
  const [s] = (await d.rpc<Started[]>("start_review", { p_commitment: commitmentId })) ?? [];
  if (!s) return false;
  try {
    if (!s.email) throw new MailerError("The member has no email address");
    const { subject, text } = requestEmail(env, s);
    await sendEmail(env, {
      toPersonId: s.person_id,
      to: s.email,
      subject,
      text,
      template: "commitment-review-request",
      stepId: s.step_id,
      // Sent in the captain's name (owner decision, 2026-09-29).
      from: env.REVIEW_EMAIL_FROM || undefined,
    }, batch);
    return true;
  } catch (err) {
    await d.rpc("undo_review_start", { p_step: s.step_id });
    throw err;
  }
}

/**
 * Outside calls the daily run allows itself. A free-plan Worker run may make
 * 50; once over, every further call fails, so a review could be claimed and
 * then neither emailed nor released. The 10 to spare cover the retries the
 * data client makes on its own (data/supabase.ts) during the last email,
 * and the cron's other work.
 */
export const SUBREQUEST_BUDGET = 40;
/** The most one more email can take: the claim, Resend twice (the sender-domain fallback), and undoing the claim. */
export const CALLS_PER_EMAIL = 4;
/** The log rows, written in one insert at the end. */
const LOG_WRITE = 1;
/** Due reviews read a run, soonest period end first. The budget normally stops the run first (at 17); the rest wait for the next day. */
export const MAX_PER_RUN = 20;
/** A review email goes to one address (no copies; in preview, the one preview address). */
const REVIEW_RECIPIENTS = 1;

/**
 * The daily run: the reviews due their email, while the run's outside calls
 * and the day's email allowance last. Counts only in the log.
 *
 * Outside calls are counted as they happen (the data client counts its own,
 * retries included, in the request context; the batch counts Resend's), and
 * a review is claimed only when its whole email - claim, send, and the undo
 * if the send fails - still fits. So a review is never left "Notified
 * Member" for want of a call to email it or release it.
 */
export async function sendDueReviewEmails(env: Env): Promise<{ sent: number; failed: number; left: number }> {
  // The scheduled handler has no request context; give the run one to count in.
  const context = currentRequestContext();
  if (!context) return runWithRequestContext({ stats: newRequestStats() }, () => sendDueReviewEmails(env));
  const { stats } = context;

  const due = await db(env).select<{ id: string }>("reviews_due_v", `select=id&order=period_end&limit=${MAX_PER_RUN}`);
  let sent = 0;
  let failed = 0;
  let left = 0;
  let resendCalls = 0;
  if (due.length) {
    const batch = await openMailBatch(env);
    const used = () => stats.dbCalls + batch.resendCalls;
    try {
      for (const [i, { id }] of due.entries()) {
        if (used() + CALLS_PER_EMAIL + LOG_WRITE > SUBREQUEST_BUDGET) {
          left = due.length - i;
          break;
        }
        // Checked before claiming, so a full day costs no claim and undo.
        if (!roomToday(batch, REVIEW_RECIPIENTS)) {
          left = due.length - i;
          console.warn(`Review emails: daily email limit (${DAILY_LIMIT}) reached; the rest go tomorrow`);
          break;
        }
        try {
          if (await startReview(env, id, batch)) sent++;
        } catch (err) {
          failed++;
          console.error(`Review email for ${id} not sent:`, err instanceof Error ? err.message : err);
          // The daily limit applies to everything after it too.
          if (err instanceof MailerError && err.message.startsWith("Daily email limit")) {
            left = due.length - i - 1;
            break;
          }
        }
      }
    } finally {
      await flushMailBatch(env, batch);
      resendCalls = batch.resendCalls;
    }
  }
  console.log("review emails " + JSON.stringify({ due: due.length, sent, failed, left, calls: stats.dbCalls + resendCalls }));
  return { sent, failed, left };
}
