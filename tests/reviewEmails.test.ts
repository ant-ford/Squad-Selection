import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import { sendEmail, DAILY_LIMIT, MailerError } from "../worker/src/mailer";
import { sendDueReviewEmails, startReview } from "../worker/src/reviewEmails";
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
function fakeServices(opts: { sentToday?: number; resend?: "ok" | "fail"; started?: object[]; due?: string[] } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const c = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.host === "api.resend.com") return opts.resend === "fail" ? reply({ message: "invalid from" }, 422) : reply({ id: "re_msg_1" });
    if (url.pathname.endsWith("/rpc/emails_sent_today")) return reply(opts.sentToday ?? 0);
    if (url.pathname.endsWith("/rpc/start_review")) return reply(opts.started ?? []);
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

  it("logs a refused email as failed", async () => {
    const calls = fakeServices({ resend: "fail" });
    await expect(sendEmail(base, { toPersonId: "p", to: "a@b.c", subject: "s", text: "t", template: "t" })).rejects.toThrow(/422/);
    expect(logRows(calls)[0]).toMatchObject({ status: "failed", error: expect.stringContaining("422") });
  });
});

describe("commitment review emails", () => {
  it("claims the review, then emails the member with a link to Eddy", async () => {
    const calls = fakeServices({ started: [started] });
    expect(await startReview(base, "recC1")).toBe(true);
    expect(calls.find((c) => c.url.pathname.endsWith("/rpc/start_review"))!.body).toEqual({ p_commitment: "recC1" });
    const email = resendCalls(calls)[0].body;
    expect(email.to).toEqual(["member@x.com"]);
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

  it("the daily run emails every due review and stops at the daily limit", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeServices({ started: [started], due: ["recA", "recB"] });
    expect(await sendDueReviewEmails(base)).toEqual({ sent: 2, failed: 0 });
    const calls = fakeServices({ started: [started], due: ["recA", "recB"], sentToday: DAILY_LIMIT });
    expect(await sendDueReviewEmails(base)).toEqual({ sent: 0, failed: 1 });
    expect(calls.filter((c) => c.url.pathname.endsWith("/rpc/start_review"))).toHaveLength(1);
  });

  it("Notify Now on Supabase starts the review, and says so when it already had", async () => {
    fakeServices({ started: [started] });
    await expect(commitments(base).setNotifyNow("recC1")).resolves.toBeUndefined();
    fakeServices({ started: [] });
    await expect(commitments(base).setNotifyNow("recC1")).rejects.toMatchObject({ status: 409, code: "ALREADY_STARTED" });
  });
});
