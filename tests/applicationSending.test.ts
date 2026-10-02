import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { sendApplication } from "../worker/src/pdf/application";

const env = {
  DATA_BACKEND: "supabase",
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  API_ORIGIN: "https://api.eddy.global",
  RESEND_API_KEY: "re_test",
  MAIL_FROM: "Eddy <notifications@eddy.global>",
  CLUB_MEMBERSHIP_EMAIL: "HKFC Membership Department <membership_dept@hkfc.com>",
  CLUB_MEMBERSHIP_CONTACT: "Caren",
  FRONT_DESK_EMAIL: "HKFC Front Desk <frontdesk@hkfc.com>",
} as Env;

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const officer = { email: "mo@x.com", personId: "recMO", officerRoles: [{ office: "membershipOfficer" }] } as unknown as AuthorizedUser;
const member = { email: "m@x.com", personId: "recSOMEONE", officerRoles: [] } as unknown as AuthorizedUser;

const applicant = {
  id: U(1), preferred_name: "Sam", given_names: "Samuel", surname: "Lee", applicant_stage: "6. Membership Officer (Signed)",
  sponsored_by_sponsor_id: U(101), sponsored_by_chair_id: U(102),
};
const application = (over: object = {}) => ({
  id: U(500), application_type: "New HKFC Member", officer_signed_at: "2026-10-01T00:00:00Z", pdf_file_id: U(900), sent_at: null, ...over,
});

type Call = { url: URL; method: string; body: any };
function fake(opts: { app?: object; person?: object } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.host === "api.resend.com") return reply({ id: "re_1" });
    const table = url.pathname.split("/").pop()!;
    if (table === "emails_sent_today") return reply(0);
    if (method !== "GET") return reply([{}]);
    if (table === "people" && url.searchParams.get("api_id") === "eq.recMO") {
      return reply([{ id: U(13), preferred_name: "Daniel", given_names: null, surname: "X", email: "daniel@x.com" }]);
    }
    if (table === "people") return reply([{ ...applicant, ...opts.person }]);
    if (table === "applications") return reply([opts.app ?? application()]);
    if (table === "offices" && url.searchParams.get("role")) return reply([{ designation: "Membership Officer", office_email: "mensmembership@hkfchockey.com" }]);
    if (table === "offices") {
      return reply([
        { id: U(101), people: { id: U(11), preferred_name: "Chris", given_names: null, surname: "S", email: null, membership_no: null } },
        { id: U(102), people: { id: U(12), preferred_name: "Paul", given_names: null, surname: "C", email: null, membership_no: null } },
      ]);
    }
    if (table === "files") return reply([{ filename: "HKFC Membership Application - Sam Lee.pdf" }]);
    return reply([]);
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const resend = (calls: Call[]) => calls.filter((c) => c.url.host === "api.resend.com").map((c) => c.body);
const patches = (calls: Call[], table: string) => calls.filter((c) => c.method === "PATCH" && c.url.pathname.endsWith(`/${table}`)).map((c) => c.body);

describe("sending an application on", () => {
  it("is for Membership Officers, and only once the PDF is made", async () => {
    fake();
    await expect(sendApplication(env, member, "recAPPLICANT")).rejects.toThrow(/Membership Officer/);
    fake({ app: application({ pdf_file_id: null }) });
    await expect(sendApplication(env, officer, "recAPPLICANT")).rejects.toThrow(/isn't ready/);
    fake({ app: application({ officer_signed_at: null }) });
    await expect(sendApplication(env, officer, "recAPPLICANT")).rejects.toThrow(/signs it before/);
  });

  it("sends a new member's application to the Club in the officer's name, PDF attached, and records it", async () => {
    const calls = fake();
    const sent = await sendApplication(env, officer, "recAPPLICANT");
    expect(sent.sentTo).toBe("membership_dept@hkfc.com");
    const [email] = resend(calls);
    expect(email.to).toEqual(["membership_dept@hkfc.com"]);
    expect(email.from).toBe("Daniel X <mensmembership@hkfchockey.com>");
    expect(email.text).toMatch(/^Dear Caren,/);
    expect(email.text).toContain("signed by their sponsor (Chris S), the Hockey Section Chairman (Paul C)");
    expect(email.attachments).toEqual([{ filename: "HKFC Membership Application - Sam Lee.pdf", path: expect.stringContaining(`/api/files/${U(900)}?`) }]);
    expect(patches(calls, "applications")).toEqual([{ sent_at: sent.sentAt, sent_by: U(13), sent_to: "membership_dept@hkfc.com" }]);
    // A new member is accepted later, once the Club confirms their number.
    expect(patches(calls, "people")).toEqual([]);
  });

  it("won't send twice unless asked to", async () => {
    fake({ app: application({ sent_at: "2026-10-02T00:00:00Z" }) });
    await expect(sendApplication(env, officer, "recAPPLICANT")).rejects.toThrow(/sent already/);
    const calls = fake({ app: application({ sent_at: "2026-10-02T00:00:00Z" }) });
    await sendApplication(env, officer, "recAPPLICANT", true);
    expect(resend(calls)).toHaveLength(1);
    // A new member's application goes to the Club with no copies.
    expect(resend(calls)[0].cc).toBeUndefined();
  });

  it("sends an existing member's levy form to the front desk and accepts them", async () => {
    const calls = fake({
      app: application({ application_type: "Existing HKFC Member", officer_signed_at: null }),
      person: { applicant_stage: "3. Club Application (Signed)", email: "sam@x.com", guardian_email: "parent@x.com" },
    });
    await sendApplication(env, officer, "recAPPLICANT");
    const [email] = resend(calls);
    expect(email.to).toEqual(["frontdesk@hkfc.com"]);
    // Copied to the applicant and their parent or guardian; no blind copy to the officer.
    expect(email.cc).toEqual(["sam@x.com", "parent@x.com"]);
    expect(email.bcc).toBeUndefined();
    expect(email.subject).toBe("Hockey Section levy application: Sam Lee");
    expect(email.text).toMatch(/^Dear Front Desk,/);
    const accepted = patches(calls, "people");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ status: "Member", applicant_stage: "Accepted", active: true });
  });
});
