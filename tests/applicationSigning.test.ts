import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { notifySigners, signApplication, signingTasks } from "../worker/src/applicationSigning";
import { sponsorProblem } from "../shared/signing";

const env = {
  DATA_BACKEND: "supabase",
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  RESEND_API_KEY: "re_test",
  MAIL_FROM: "Eddy <notifications@eddy.global>",
  APP_ORIGIN: "https://app.eddy.global",
  REVIEW_EMAIL_FROM: "Anthony Ford <menscaptain@hkfchockey.com>",
} as Env;

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const as = (personId: string) => ({ email: "x@x.com", personId, officerRoles: [] }) as unknown as AuthorizedUser;

const applicant = {
  id: U(1), api_id: "recAPPLICANT", preferred_name: "Sam", given_names: "Samuel", surname: "Lee", status: "Applicant",
  applicant_stage: "3. Club Application (Signed)", sponsored_by_sponsor_id: U(101), sponsored_by_chair_id: U(102), sponsored_by_officer_id: U(103),
};
const office = (id: number, person: number, apiId: string, first: string) => ({
  id: U(id), people: { id: U(person), api_id: apiId, preferred_name: first, given_names: null, surname: "X", email: `${first.toLowerCase()}@x.com` },
});
const OFFICES = [office(101, 11, "recSPONSOR", "Chris"), office(102, 12, "recCHAIR", "Paul"), office(103, 13, "recMO", "Daniel")];
const application = (over: object = {}) => ({
  id: U(500), person_id: U(1), application_type: "New HKFC Member", submitted_at: "2026-10-01T00:00:00Z",
  sponsor_signed_at: null, sponsor_signature_file_id: null, chair_signed_at: null, chair_signature_file_id: null,
  officer_signed_at: null, officer_signature_file_id: null, ...over,
});

type Call = { url: URL; method: string; body: any };
function fake(opts: { app?: object; stage?: string; savedSignature?: boolean; people?: object[] } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.host === "api.resend.com") return reply({ id: "re_1" });
    const table = url.pathname.split("/").pop()!;
    if (table === "emails_sent_today") return reply(0);
    if (table === "sign_application") return reply(opts.stage ?? "4. Sponsor (Signed)");
    if (method !== "GET") return reply([]);
    if (table === "people" && url.searchParams.get("select") === "id") return reply([{ id: U(11) }]);
    if (table === "people") return reply(opts.people ?? [applicant]);
    if (table === "applications") return reply([opts.app ?? application()]);
    if (table === "offices") return reply(OFFICES);
    if (table === "files") return reply(opts.savedSignature === false ? [] : [{ id: U(900) }]);
    return reply([]);
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const resend = (calls: Call[]) => calls.filter((c) => c.url.host === "api.resend.com").map((c) => c.body);
const rpc = (calls: Call[]) => calls.find((c) => c.url.pathname.endsWith("/rpc/sign_application"));

const answers = { playingPosition: "Defender", team: "HKFC C", sportsBackground: "Played county hockey.", trainingComments: "Strong at training.", level: "Division 2" };

describe("signing a new member's application", () => {
  it("checks the sponsor's assessment", () => {
    expect(sponsorProblem(answers)).toBeNull();
    expect(sponsorProblem({ ...answers, team: "" })).toMatch(/team/);
    expect(sponsorProblem({ ...answers, sportsBackground: " " })).toMatch(/sports background/);
    expect(sponsorProblem({ ...answers, level: "Division 9" })).toMatch(/level/);
  });

  it("lets only the office holder sign, the sponsor with their assessment and saved signature", async () => {
    fake();
    await expect(signApplication(env, as("recCHAIR"), "recAPPLICANT", { role: "sponsor", answers })).rejects.toThrow(/not the Sponsor/);
    await expect(signApplication(env, as("recSPONSOR"), "recAPPLICANT", { role: "sponsor", answers: { ...answers, level: "" } })).rejects.toThrow(/level/);
    const calls = fake();
    expect(await signApplication(env, as("recSPONSOR"), "recAPPLICANT", { role: "sponsor", answers })).toEqual({ stage: "4. Sponsor (Signed)" });
    expect(rpc(calls)!.body).toEqual({ p_person: "recAPPLICANT", p_actor: "recSPONSOR", p_role: "sponsor", p: answers, p_signature: U(900) });
    expect(resend(calls)).toHaveLength(0);
  });

  it("needs a signature: a saved one, or one drawn now", async () => {
    fake({ savedSignature: false });
    await expect(signApplication(env, as("recCHAIR"), "recAPPLICANT", { role: "chair" })).rejects.toThrow(/Sign the application/);
  });

  it("tells the Membership Officer once all three have signed", async () => {
    const calls = fake({ stage: "6. Membership Officer (Signed)" });
    await signApplication(env, as("recMO"), "recAPPLICANT", { role: "officer" });
    const [mail] = resend(calls);
    expect(mail.to).toEqual(["daniel@x.com"]);
    expect(mail.subject).toBe("Sam Lee's application is signed");
    expect(mail.text).toContain("https://app.eddy.global/membership");
  });

  it("emails each of the three when a new member's application comes in, and nobody for an existing member", async () => {
    let calls = fake();
    await notifySigners(env, "recAPPLICANT");
    const mails = resend(calls);
    expect(mails.map((m) => m.to[0])).toEqual(["chris@x.com", "paul@x.com", "daniel@x.com"]);
    expect(mails[0].text).toContain("add your support");
    expect(mails[1].text).toContain("you're their Chairman");
    expect(mails[0].text).toContain("https://app.eddy.global/sign-application/recAPPLICANT");
    calls = fake({ app: application({ application_type: "Existing HKFC Member" }) });
    await notifySigners(env, "recAPPLICANT");
    expect(resend(calls)).toHaveLength(0);
  });

  it("gives a task to each signer who hasn't signed, then the Membership Officer an accept task", async () => {
    fake({ app: application({ chair_signed_at: "2026-10-01T02:00:00Z" }) });
    const tasks = await signingTasks(env);
    expect(Object.keys(tasks).sort()).toEqual(["recMO", "recSPONSOR"]);
    expect(tasks.recSPONSOR[0]).toMatchObject({ key: "application", role: "Sponsor", subject: "Sam Lee", url: "/sign-application/recAPPLICANT" });
    fake({ people: [{ ...applicant, applicant_stage: "6. Membership Officer (Signed)" }] });
    expect(await signingTasks(env)).toEqual({ recMO: [{ id: "accept:recAPPLICANT", key: "accept", subject: "Sam Lee", url: "/membership" }] });
  });
});
