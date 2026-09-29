import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import { people } from "../worker/src/data/people";
import { commitments } from "../worker/src/data/commitments";
import { membershipEvents } from "../worker/src/data/membershipEvents";

const env = {
  DATA_BACKEND: "supabase",
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  API_ORIGIN: "https://api.test",
} as Env;

type Call = { url: URL; method: string; body: any };
function postgrest(respond: (c: Call) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const c = { url: new URL(input), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    return new Response(JSON.stringify(respond(c) ?? []), { status: 200 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("officer-section reads on Supabase", () => {
  it("selects exactly the field map's keys, and signs attachments", async () => {
    const calls = postgrest(() => [{
      id: "recA", applicantStage: "6. Membership Officer (Signed)", photo: [{ fileId: "11111111-2222-3333-4444-555555555555", filename: "a.jpg" }],
      applicationForm: [], sponsorName: ["Sam"],
    }]);
    const [row] = await people(env).listMembershipBoard();
    const select = calls[0].url.searchParams.get("select")!.split(",");
    expect(calls[0].url.pathname).toBe("/rest/v1/api_people_crm");
    expect(select[0]).toBe("id");
    expect(select).toContain("stageUpdatedAt");
    expect(select).toContain("sponsoredBySponsor");
    expect(calls[0].url.searchParams.get("and")).toBe("(applicantStage.not.is.null,or(status.is.null,status.neq.Resigned))");
    expect(row.photo).toEqual([{ url: expect.stringMatching(/^https:\/\/api\.test\/api\/files\/11111111-2222-3333-4444-555555555555\?exp=\d+&sig=/), filename: "a.jpg" }]);
    expect(row.sponsorName).toEqual(["Sam"]);
  });

  it("renames a key the view calls something else", async () => {
    const calls = postgrest(() => []);
    await people(env).listApplicantsAtStages(["3. Club Application (Signed)"]);
    expect(calls[0].url.searchParams.get("select")).toContain("stage:applicantStage");
    expect(calls[0].url.searchParams.get("applicantStage")).toBe('in.("3. Club Application (Signed)")');
  });

  it("only looks up contacts by record id, as the Airtable read does", async () => {
    const calls = postgrest(() => []);
    expect(await people(env).listContactsByIds(["not-an-id", ""])).toEqual([]);
    expect(calls).toHaveLength(0);
    await people(env).listContactsByIds(["recAAAAAAAAAAAAAA"]);
    expect(calls[0].url.searchParams.get("id")).toBe('in.("recAAAAAAAAAAAAAA")');
  });

  it("reads the Statements board from api_commitments_crm with the same date window", async () => {
    const calls = postgrest(() => []);
    await commitments(env).listReviewBoard();
    expect(calls[0].url.pathname).toBe("/rest/v1/api_commitments_crm");
    expect(calls[0].url.searchParams.get("periodEnd")).toBe("gt.2026-06-29");
    expect(calls[0].url.searchParams.get("periodStart")).toMatch(/^lt\.\d{4}-\d{2}-\d{2}$/);
  });

  it("records a membership action in the activity log with field names only", async () => {
    const calls = postgrest(() => null);
    await membershipEvents(env).record({
      eventType: "Approved", personId: "recP", actorId: "recO", actorEmail: "o@x.com", membershipNo: "A123",
      joinDate: "2026-10-01", notes: "Shares Membership No. with Someone", timestamp: "2026-09-29T00:00:00.000Z",
    });
    expect(calls[0].url.pathname).toBe("/rest/v1/rpc/log_activity");
    expect(calls[0].body).toEqual({ p: {
      occurredAt: "2026-09-29T00:00:00.000Z", actorId: "recO", action: "approved", entity: "people", entityId: "recP",
      fields: ["status", "applicant_stage", "join_date", "commitment_end_date", "membership_no"],
    } });
    expect(JSON.stringify(calls[0].body)).not.toMatch(/A123|Someone|o@x\.com/);
  });
});
