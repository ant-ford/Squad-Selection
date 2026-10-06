import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import { sendEmail, DAILY_LIMIT, MailerError } from "../worker/src/mailer";
import { CALLS_PER_EMAIL, MAX_PER_RUN, SUBREQUEST_BUDGET, sendDueReviewEmails, startReview } from "../worker/src/reviewEmails";
import { commitments } from "../worker/src/data/commitments";

const base = {
  DATA_BACKEND: "supabase",
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  RESEND_API_KEY: "re_test",
  MAIL_FROM: "Eddy <notifications@eddy.global>",
  APP_ORIGIN: "https://app.eddy.global",
} as Env;

type Call = { url: URL; method: string; body: any };
/** One fake for PostgREST and Resend together. */
function fakeServices(opts: {
  sentToday?: number;
  resend?: "ok" | "fail" | "timeout" | "unverified-domain" | "unverified-domain-always";
  started?: object[];
  due?: string[];
  /** The first this-many claims have their token refused once (data/supabase.ts tries again). */
  claimTokenRejections?: number;
} = {}) {
  let resendCalls = 0;
  let rejections = 0;
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const c = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.host === "api.resend.com") {
      resendCalls++;
      if (opts.resend === "fail") return reply({ message: "invalid from" }, 422);
      if (opts.resend === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      if (opts.resend === "unverified-domain" && resendCalls === 1) return reply({ message: "The hkfchockey.com domain is not verified." }, 403);
      if (opts.resend === "unverified-domain-always" && c.body.from.includes("hkfchockey")) {
        return reply({ message: "The hkfchockey.com domain is not verified." }, 403);
      }
      return reply({ id: "re_msg_1" });
    }
    if (url.pathname.endsWith("/rpc/emails_sent_today")) return reply(opts.sentToday ?? 0);
    if (url.pathname.endsWith("/rpc/start_review")) {
      const prior = calls.filter((x) => x.url.pathname.endsWith("/rpc/start_review")).length - 1;
      if (prior === 2 * rejections && rejections < (opts.claimTokenRejections ?? 0)) {
        rejections++;
        return reply({ code: "PGRST303", message: "JWT expired" }, 401);
      }
      return reply(opts.started ?? []);
    }
    if (url.pathname.endsWith("/rpc/undo_review_start")) return reply(null);
    if (url.pathname.endsWith("/reviews_due_v")) return reply((opts.due ?? []).map((id) => ({ id })));
    return reply([]);
  }));
  return calls;
}
const resendCalls = (calls: Call[]) => calls.filter((c) => c.url.host === "api.resend.com");
const logRows = (calls: Call[]) => calls.filter((c) => c.url.pathname.endsWith("/email_log")).map((c) => c.body[0]);

afterEach(() => vi.unstubAllGlobals());

const started = { commitment_id: "c-uuid", step_id: "s-uuid", person_id: "p-uuid", email: "member@x.com", preferred_name: "Sam", year_no: 2, period: "01 Oct 2025 to 30 Sep 2026" };

describe("mailer", () => {
  it("sends through Resend from Eddy and logs by person record, not address", async () => {
    const calls = fakeServices();
    await sendEmail(base, { toPersonId: "p-uuid", to: "member@x.com", subject: "Hello", text: "Body", template: "t" });
    expect(resendCalls(calls)[0].body).toMatchObject({ from: "Eddy <notifications@eddy.global>", to: ["member@x.com"], subject: "Hello" });
    expect(logRows(calls)[0]).toMatchObject({ to_person_id: "p-uuid", template: "t", status: "sent", provider_message_id: "re_msg_1" });
    expect(JSON.stringify(logRows(calls))).not.toContain("member@x.com");
  });

  it("in preview, sends every message to the captain with [PREVIEW], naming the recipient only by record", async () => {
    const calls = fakeServices();
    await sendEmail({ ...base, MAIL_REDIRECT_TO: "menscaptain@hkfchockey.com" }, {
      toPersonId: "p-uuid", to: "member@x.com", cc: ["membership@x.com"], subject: "Hello", text: "Body", template: "t",
    });
    const sent = resendCalls(calls)[0].body;
    expect(sent.to).toEqual(["menscaptain@hkfchockey.com"]);
    expect(sent.cc).toBeUndefined();
    expect(sent.subject).toBe("[PREVIEW] Hello");
    expect(sent.text).toContain("person p-uuid");
    expect(JSON.stringify(sent)).not.toMatch(/member@x\.com|membership@x\.com/);
  });

  it("stops at the daily limit before calling Resend", async () => {
    const calls = fakeServices({ sentToday: DAILY_LIMIT });
    await expect(sendEmail(base, { toPersonId: "p", to: "a@b.c", subject: "s", text: "t", template: "t" })).rejects.toThrow(MailerError);
    expect(resendCalls(calls)).toHaveLength(0);
  });

  it("sends in the captain's name, with no blind copy back to him", async () => {
    const calls = fakeServices();
    await sendEmail(base, { toPersonId: "p", to: "member@x.com", subject: "s", text: "t", template: "t", from: "Anthony Ford <menscaptain@hkfchockey.com>" });
    const body = resendCalls(calls)[0].body;
    expect(body.from).toBe("Anthony Ford <menscaptain@hkfchockey.com>");
    expect(body.bcc).toBeUndefined();
    expect(logRows(calls)[0]).toMatchObject({ sender: "Anthony Ford <menscaptain@hkfchockey.com>", recipients: 1 });
  });

  it("counts every address against the day's limit, as Resend does", async () => {
    let calls = fakeServices();
    await sendEmail(base, { toPersonId: "p", to: "a@b.c", cc: ["c@d.e", "f@g.h"], subject: "s", text: "t", template: "t" });
    expect(logRows(calls)[0].recipients).toBe(3);
    // Two addresses left today: a message to three doesn't go.
    calls = fakeServices({ sentToday: DAILY_LIMIT - 2 });
    await expect(sendEmail(base, { toPersonId: "p", to: "a@b.c", cc: ["c@d.e", "f@g.h"], subject: "s", text: "t", template: "t" })).rejects.toThrow(/Daily email limit/);
    expect(resendCalls(calls)).toHaveLength(0);
    expect(DAILY_LIMIT).toBeLessThanOrEqual(70);
  });

  it("falls back to Eddy's address, replies to the captain, while his domain is unverified in Resend", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = fakeServices({ resend: "unverified-domain" });
    await sendEmail(base, { toPersonId: "p", to: "member@x.com", subject: "s", text: "t", template: "t", from: "Anthony Ford <menscaptain@hkfchockey.com>" });
    const [first, second] = resendCalls(calls).map((c) => c.body);
    expect(first.from).toBe("Anthony Ford <menscaptain@hkfchockey.com>");
    expect(second).toMatchObject({ from: "Eddy <notifications@eddy.global>", reply_to: "menscaptain@hkfchockey.com" });
    expect(second.bcc).toBeUndefined();
    expect(logRows(calls)[0]).toMatchObject({ status: "sent", sender: "Eddy <notifications@eddy.global>" });
  });

  it("logs a refused email as failed", async () => {
    const calls = fakeServices({ resend: "fail" });
    await expect(sendEmail(base, { toPersonId: "p", to: "a@b.c", subject: "s", text: "t", template: "t" })).rejects.toThrow(/422/);
    expect(logRows(calls)[0]).toMatchObject({ status: "failed", error: expect.stringContaining("422") });
  });
});

describe("commitment review emails", () => {
  it("claims the review, then emails the member in the captain's name, with no copies", async () => {
    const calls = fakeServices({ started: [started] });
    const env = { ...base, REVIEW_EMAIL_FROM: "Anthony Ford <menscaptain@hkfchockey.com>" } as Env;
    expect(await startReview(env, "recC1")).toBe(true);
    expect(calls.find((c) => c.url.pathname.endsWith("/rpc/start_review"))!.body).toEqual({ p_commitment: "recC1" });
    const email = resendCalls(calls)[0].body;
    expect(email.to).toEqual(["member@x.com"]);
    expect(email.from).toBe("Anthony Ford <menscaptain@hkfchockey.com>");
    expect(email.cc).toBeUndefined();
    expect(email.subject).toContain("Year 2");
    expect(email.text).toContain("Hi Sam,");
    expect(email.text).toContain("https://app.eddy.global");
    expect(logRows(calls)[0]).toMatchObject({ step_id: "s-uuid", template: "commitment-review-request" });
  });

  it("sends nothing when the review had already started", async () => {
    const calls = fakeServices({ started: [] });
    expect(await startReview(base, "recC1")).toBe(false);
    expect(resendCalls(calls)).toHaveLength(0);
  });

  it("undoes the claim when the email fails, so the next run tries again", async () => {
    const calls = fakeServices({ started: [started], resend: "fail" });
    await expect(startReview(base, "recC1")).rejects.toThrow();
    expect(calls.find((c) => c.url.pathname.endsWith("/rpc/undo_review_start"))!.body).toEqual({ p_step: "s-uuid" });
  });

  it("the daily run emails every due review, counting the day once and logging once", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const calls = fakeServices({ started: [started], due: ["recA", "recB", "recC"] });
    expect(await sendDueReviewEmails(base)).toEqual({ sent: 3, failed: 0, left: 0 });
    const query = calls.find((c) => c.url.pathname.endsWith("/reviews_due_v"))!.url;
    expect(query.searchParams.get("limit")).toBe(String(MAX_PER_RUN));
    expect(calls.filter((c) => c.url.pathname.endsWith("/rpc/emails_sent_today"))).toHaveLength(1);
    const logs = calls.filter((c) => c.url.pathname.endsWith("/email_log"));
    expect(logs).toHaveLength(1);
    expect(logs[0].body).toHaveLength(3);
    expect(logs[0].body[0]).toMatchObject({ status: "sent", step_id: "s-uuid", template: "commitment-review-request", sent_at: expect.any(String) });
    // A claim and a Resend call an email, plus the due list, the day's count and the log.
    expect(calls).toHaveLength(3 * 2 + 3);
  });

  it("the daily run makes no other call when nothing is due", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const calls = fakeServices({ due: [] });
    expect(await sendDueReviewEmails(base)).toEqual({ sent: 0, failed: 0, left: 0 });
    expect(calls).toHaveLength(1);
  });

  it("the daily run stops within its budget of outside calls, leaving the rest for the next run", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    // The budget leaves 10 of a free-plan run's 50 calls to spare.
    expect(SUBREQUEST_BUDGET).toBeLessThanOrEqual(40);
    expect(CALLS_PER_EMAIL).toBe(4);
    const due = Array.from({ length: MAX_PER_RUN }, (_, i) => `rec${i}`);
    let calls = fakeServices({ started: [started], due });
    // 2 (the due list, the day's count) + 2 an email; the next is claimed only
    // while its worst case (4) and the log write (1) still fit: 2 + 2*16 + 5 = 39, so 17.
    expect(await sendDueReviewEmails(base)).toEqual({ sent: 17, failed: 0, left: MAX_PER_RUN - 17 });
    expect(calls).toHaveLength(2 + 17 * 2 + 1);
    expect(calls.filter((c) => c.url.pathname.endsWith("/email_log"))[0].body).toHaveLength(17);

    // Resend twice an email (the sender-domain fallback): 2 + 3*11 + 5 = 40, so 12.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    calls = fakeServices({ started: [started], due, resend: "unverified-domain-always" });
    const env = { ...base, REVIEW_EMAIL_FROM: "Anthony Ford <menscaptain@hkfchockey.com>" } as Env;
    expect(await sendDueReviewEmails(env)).toEqual({ sent: 12, failed: 0, left: MAX_PER_RUN - 12 });
    expect(calls).toHaveLength(2 + 12 * 3 + 1);
  });

  it("the daily run counts the data client's own retries against the budget", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const due = Array.from({ length: MAX_PER_RUN }, (_, i) => `rec${i}`);
    // The first three claims have their token refused once and are tried again (data/supabase.ts).
    const calls = fakeServices({ started: [started], due, claimTokenRejections: 3 });
    // 2 + 3 retries + 2 an email: 2 + 3 + 2*15 + 5 = 40, so 16.
    expect(await sendDueReviewEmails(base)).toEqual({ sent: 16, failed: 0, left: MAX_PER_RUN - 16 });
    expect(calls).toHaveLength(2 + 3 + 16 * 2 + 1);
  });

  it("the daily run stops at the daily limit without claiming a review it cannot email", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = fakeServices({ started: [started], due: ["recA", "recB"], sentToday: DAILY_LIMIT });
    expect(await sendDueReviewEmails(base)).toEqual({ sent: 0, failed: 0, left: 2 });
    expect(calls.filter((c) => c.url.pathname.endsWith("/rpc/start_review"))).toHaveLength(0);
    expect(resendCalls(calls)).toHaveLength(0);
    // Room for one more today: one goes, the other waits.
    calls = fakeServices({ started: [started], due: ["recA", "recB"], sentToday: DAILY_LIMIT - 1 });
    expect(await sendDueReviewEmails(base)).toEqual({ sent: 1, failed: 0, left: 1 });
    expect(calls.filter((c) => c.url.pathname.endsWith("/rpc/start_review"))).toHaveLength(1);
  });

  it("releases a review when Resend does not answer in time, as when it refuses", async () => {
    const calls = fakeServices({ started: [started], resend: "timeout" });
    await expect(startReview(base, "recC1")).rejects.toThrow(MailerError);
    expect(calls.find((c) => c.url.pathname.endsWith("/rpc/undo_review_start"))!.body).toEqual({ p_step: "s-uuid" });
    expect(logRows(calls)[0]).toMatchObject({ status: "failed", error: expect.stringContaining("no answer within 10 s") });
  });

  it("the daily run releases a review whose email failed, and logs the failure with the rest", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = fakeServices({ started: [started], due: ["recA", "recB"], resend: "fail" });
    expect(await sendDueReviewEmails(base)).toEqual({ sent: 0, failed: 2, left: 0 });
    expect(calls.filter((c) => c.url.pathname.endsWith("/rpc/undo_review_start"))).toHaveLength(2);
    const logs = calls.filter((c) => c.url.pathname.endsWith("/email_log"));
    expect(logs).toHaveLength(1);
    expect(logs[0].body.map((r: { status: string }) => r.status)).toEqual(["failed", "failed"]);
  });

  it("Notify Now on Supabase starts the review, and says so when it already had", async () => {
    fakeServices({ started: [started] });
    await expect(commitments(base).setNotifyNow("recC1")).resolves.toBeUndefined();
    fakeServices({ started: [] });
    await expect(commitments(base).setNotifyNow("recC1")).rejects.toMatchObject({ status: 409, code: "ALREADY_STARTED" });
  });
});
