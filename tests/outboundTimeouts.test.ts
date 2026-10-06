import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import { MailerError, RESEND_TIMEOUT_MS, sendEmail } from "../worker/src/mailer";
import { complete, OPENROUTER_TIMEOUT_MS } from "../worker/src/reviewDrafts";
import { askAboutPicture } from "../worker/src/vision";
import { PdfError, renderPdf } from "../worker/src/pdf/render";
import type { RenderSpec } from "../supabase/functions/_shared/pdf";

const env = {
  DATA_BACKEND: "supabase",
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  RESEND_API_KEY: "re_test",
  MAIL_FROM: "Eddy <notifications@eddy.global>",
  OPENROUTER_API_KEY: "or_test",
} as Env;

const timedOut = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");

/** Every outside service times out; PostgREST answers. Returns each call's URL, signal and body. */
function servicesTimeOut(hosts: string[]) {
  const calls: { url: URL; signal?: AbortSignal | null; body?: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, signal: init.signal, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (hosts.includes(url.host) || url.pathname.includes("/functions/v1/")) throw timedOut();
    if (url.pathname.endsWith("/rpc/emails_sent_today")) return new Response("0");
    return new Response("[]");
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("outbound calls give up after a while, down their usual failure path", () => {
  it("Resend: 10 s, then logged as failed and a MailerError, like a refusal", async () => {
    expect(RESEND_TIMEOUT_MS).toBe(10_000);
    const calls = servicesTimeOut(["api.resend.com"]);
    const sending = sendEmail(env, { toPersonId: "p", to: "a@b.c", subject: "s", text: "t", template: "t" });
    await expect(sending).rejects.toThrow(MailerError);
    await expect(sending).rejects.toThrow(/no answer within 10 s/);
    const resend = calls.filter((c) => c.url.host === "api.resend.com");
    expect(resend).toHaveLength(1); // no sender-domain fallback for a timeout
    expect(resend[0].signal).toBeInstanceOf(AbortSignal);
    const log = calls.find((c) => c.url.pathname.endsWith("/email_log"))!.body[0];
    expect(log).toMatchObject({ status: "failed", error: expect.stringContaining("no answer") });
  });

  it("OpenRouter drafts: 25 s, then an error, as for a refused draft", async () => {
    expect(OPENROUTER_TIMEOUT_MS).toBe(25_000);
    const calls = servicesTimeOut(["openrouter.ai"]);
    await expect(complete(env, "system", "context")).rejects.toThrow("OpenRouter did not answer within 25 s");
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("OpenRouter pictures (ID and payment reads): 25 s, then no reading, as for a failed one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = servicesTimeOut(["openrouter.ai"]);
    const reply = await askAboutPicture(env, { system: "s", prompt: "p", image: "data:image/png;base64,AA==", maxTokens: 10, label: "ID read" });
    expect(reply).toBeNull();
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(console.error).toHaveBeenCalledWith("ID read failed: no answer within 25 s");
  });

  it("the render-pdf function: a PdfError, as for a refused render", async () => {
    const calls = servicesTimeOut([]);
    await expect(renderPdf(env, { pages: [] } as unknown as RenderSpec, {})).rejects.toThrow(PdfError);
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });
});
