/**
 * Commitment review emails on the Supabase backend - the job of the two
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
import { MailerError, sendEmail } from "./mailer";

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

/** Starts one review and sends its email. False when it had already started. */
export async function startReview(env: Env, commitmentId: string): Promise<boolean> {
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
      cc: env.REVIEW_EMAIL_CC ? env.REVIEW_EMAIL_CC.split(",").map((x) => x.trim()).filter(Boolean) : undefined,
    });
    return true;
  } catch (err) {
    await d.rpc("undo_review_start", { p_step: s.step_id });
    throw err;
  }
}

/** The daily run: every review due its email. Counts only in the log. */
export async function sendDueReviewEmails(env: Env): Promise<{ sent: number; failed: number }> {
  const due = await db(env).select<{ id: string }>("reviews_due_v", "select=id&order=period_end");
  let sent = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      if (await startReview(env, id)) sent++;
    } catch (err) {
      failed++;
      console.error(`Review email for ${id} not sent:`, err instanceof Error ? err.message : err);
      // The daily limit applies to everything after it too.
      if (err instanceof MailerError && err.message.startsWith("Daily email limit")) break;
    }
  }
  console.log("review emails " + JSON.stringify({ due: due.length, sent, failed }));
  return { sent, failed };
}
