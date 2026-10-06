import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { stageTargets } from "../shared/membershipStages";
import { moveStage, parseMembershipChange, saveMembership } from "../worker/src/admin/membership";
import { canFor } from "../worker/src/admin/people";

const env = {
  DATA_BACKEND: "supabase",
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
} as Env;
const officer = {
  email: "o@x.com", personId: "recOFFICER", role: "player", coachTeams: [], isSectionCaptain: false,
  officerRoles: [{ office: "membershipOfficer", designation: "" }],
} as unknown as AuthorizedUser;

const person = (more: Record<string, unknown> = {}) => ({
  api_id: "recP1", preferred_name: "Sam", given_names: null, surname: "Lee", registered_team: "HKFC C", status: "Member",
  applicant_stage: null, active: true, member_type: "Main", category_type: "Sports Preferred", membership_no: "M1",
  join_date: "2024-09-01", commitment_end_date: "2027-08-31", selected_team_sos: null, selected_team_eos: null, playing_position: null,
  ...more,
});

type Call = { path: string; method: string; body: any; url: URL };
function fake(answers: { people?: unknown[]; holders?: unknown[]; rpc?: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const path = url.pathname.replace("/rest/v1/", "");
      calls.push({ path, url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      const body = path === "people" ? answers.people ?? [] : path === "api_people_crm" ? answers.holders ?? [] : path.startsWith("rpc/") ? answers.rpc : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const rpcCall = (calls: Call[]) => calls.find((c) => c.path === "rpc/admin_update_person");

const OPEN = ["1. Trial Application", "2. Section Captain Invitation", "3. Club Application (Signed)", "4. Sponsor (Signed)", "5. Chairman (Signed)", "6. Membership Officer (Signed)"];

describe("stageTargets", () => {
  it("offers an Applicant stages 1-6, Rejected and Temporary, minus their own; never Accepted", () => {
    expect(stageTargets("Applicant", "3. Club Application (Signed)")).toEqual([...OPEN.filter((s) => !s.startsWith("3.")), "Rejected", "Temporary"]);
    expect(stageTargets("Applicant", "Rejected")).toEqual([...OPEN, "Temporary"]);
    expect(stageTargets("Applicant", null)).toEqual([...OPEN, "Rejected", "Temporary"]);
    for (const stage of [null, "1. Trial Application", "Rejected", "Temporary", "On Hold"]) {
      expect(stageTargets("Applicant", stage)).not.toContain("Accepted");
    }
  });

  it("offers a Temporary player stages 1-6 only (not Rejected)", () => {
    expect(stageTargets("Member", "Temporary")).toEqual(OPEN);
  });

  it("offers a stage under Needs fixing everything", () => {
    expect(stageTargets("Member", "On Hold")).toEqual([...OPEN, "Rejected", "Temporary"]);
  });

  it("offers nothing for an ordinary or accepted member, or a resigned one", () => {
    expect(stageTargets("Member", null)).toEqual([]);
    expect(stageTargets("Member", "Accepted")).toEqual([]);
    expect(stageTargets("Resigned", "Accepted")).toEqual([]);
    expect(stageTargets(null, null)).toEqual([]);
  });

  it("opens the stage block on the person page only when there is somewhere to go", () => {
    expect(canFor(env, officer, person() as any).stage).toBe(false);
    expect(canFor(env, officer, person({ status: "Applicant", applicant_stage: "2. Section Captain Invitation" }) as any).stage).toBe(true);
  });
});

describe("parseMembershipChange", () => {
  const ok = { expect: { memberType: "Main", joinDate: null } };

  it("maps the body to columns, trims, and clears with null or blank", () => {
    expect(parseMembershipChange({ ...ok, memberType: "Spouse", joinDate: "" })).toEqual({
      patch: { member_type: "Spouse", join_date: null },
      expect: { member_type: "Main", join_date: null },
      sharedNumberAcknowledged: false,
    });
  });

  it.each([
    [{ memberType: "Grandparent", expect: { memberType: null } }, "member type"],
    [{ categoryType: "Gold", expect: { categoryType: null } }, "category"],
    [{ joinDate: "2026-02-30", expect: { joinDate: null } }, "date"],
    [{ membershipNo: 'A"1', expect: { membershipNo: null } }, "membership number"],
    [{ membershipNo: 5, expect: { membershipNo: null } }, "text"],
    [{ memberType: "Main" }, "Reload"],
    [{ memberType: "Main", expect: {} }, "Reload"],
    [{ expect: {} }, "Nothing"],
  ])("refuses %j", (body, words) => {
    expect(() => parseMembershipChange(body as any)).toThrow(new RegExp(words, "i"));
  });
});

describe("POST /api/admin/people/:id/membership", () => {
  it("saves through admin_update_person with the expected values", async () => {
    const calls = fake({ people: [person()], rpc: { status: "ok", changed: ["category_type"] } });
    const res = await saveMembership(env, officer, "recP1", { categoryType: "Sports Debenture", expect: { categoryType: "Sports Preferred" } });
    expect(res).toEqual({ ok: true, changed: ["category_type"] });
    expect(rpcCall(calls)!.body).toEqual({
      p_person: "recP1", p_actor: "recOFFICER", p_action: "admin-membership",
      p_patch: { category_type: "Sports Debenture" }, p_expect: { category_type: "Sports Preferred" },
    });
  });

  it("is 409 SHARED_MEMBERSHIP_NO for a number someone else has, until acknowledged", async () => {
    const holder = { id: "recOTHER", membershipNo: "M9", preferredName: "Kim", givenNames: null, surname: "Wong", status: "Member" };
    let calls = fake({ people: [person()], holders: [holder], rpc: { status: "ok", changed: ["membership_no"] } });
    await expect(saveMembership(env, officer, "recP1", { membershipNo: "M9", expect: { membershipNo: "M1" } })).rejects.toMatchObject({
      status: 409, code: "SHARED_MEMBERSHIP_NO", message: expect.stringContaining("Kim Wong (Member)"),
    });
    expect(rpcCall(calls)).toBeUndefined();
    calls = fake({ people: [person()], holders: [holder], rpc: { status: "ok", changed: ["membership_no"] } });
    await saveMembership(env, officer, "recP1", { membershipNo: "M9", expect: { membershipNo: "M1" }, sharedNumberAcknowledged: true });
    expect(rpcCall(calls)).toBeDefined();
  });

  it("doesn't count the person themselves as sharing their number", async () => {
    const self = { id: "recP1", membershipNo: "M9", preferredName: "Sam", givenNames: null, surname: "Lee", status: "Member" };
    const calls = fake({ people: [person()], holders: [self], rpc: { status: "ok", changed: ["membership_no"] } });
    await saveMembership(env, officer, "recP1", { membershipNo: "M9", expect: { membershipNo: "M1" } });
    expect(rpcCall(calls)).toBeDefined();
  });

  it("checks the commitment end against the join date that stays", async () => {
    const calls = fake({ people: [person()] });
    await expect(saveMembership(env, officer, "recP1", { commitmentEndDate: "2024-08-01", expect: { commitmentEndDate: "2027-08-31" } })).rejects.toMatchObject({
      status: 400, message: expect.stringContaining("after the join date"),
    });
    expect(rpcCall(calls)).toBeUndefined();
  });

  it("is 409 CHANGED when someone else saved first", async () => {
    fake({ people: [person()], rpc: { status: "conflict", field: "category_type" } });
    await expect(saveMembership(env, officer, "recP1", { categoryType: "Sports Debenture", expect: { categoryType: "Junior (21-27)" } })).rejects.toMatchObject({
      status: 409, code: "CHANGED",
    });
  });
});

describe("POST /api/admin/people/:id/stage", () => {
  const applicant = () => person({ status: "Applicant", applicant_stage: "3. Club Application (Signed)" });

  it("moves to a stage 1-6 and makes them an Applicant", async () => {
    const calls = fake({ people: [applicant()], rpc: { status: "ok", changed: ["applicant_stage"] } });
    await moveStage(env, officer, "recP1", { stage: "2. Section Captain Invitation", from: "3. Club Application (Signed)" });
    expect(rpcCall(calls)!.body).toMatchObject({
      p_action: "admin-stage",
      p_patch: { applicant_stage: "2. Section Captain Invitation", status: "Applicant" },
      p_expect: { applicant_stage: "3. Club Application (Signed)" },
    });
  });

  it("moves to Temporary without touching status (the trigger makes them a Member)", async () => {
    const calls = fake({ people: [applicant()], rpc: { status: "ok", changed: ["applicant_stage", "status"] } });
    expect(await moveStage(env, officer, "recP1", { stage: "Temporary", from: "3. Club Application (Signed)" })).toEqual({ ok: true, changed: ["applicant_stage", "status"] });
    expect(rpcCall(calls)!.body.p_patch).toEqual({ applicant_stage: "Temporary" });
  });

  it("is 409 STAGE_CHANGED when the stage isn't the one the screen showed", async () => {
    const calls = fake({ people: [applicant()] });
    await expect(moveStage(env, officer, "recP1", { stage: "Rejected", from: "2. Section Captain Invitation" })).rejects.toMatchObject({ status: 409, code: "STAGE_CHANGED" });
    expect(rpcCall(calls)).toBeUndefined();
  });

  it("is 409 STAGE_CHANGED when it moved between the read and the save", async () => {
    fake({ people: [applicant()], rpc: { status: "conflict", field: "applicant_stage" } });
    await expect(moveStage(env, officer, "recP1", { stage: "Rejected", from: "3. Club Application (Signed)" })).rejects.toMatchObject({ status: 409, code: "STAGE_CHANGED" });
  });

  it("refuses Accepted, and Rejected for a Temporary player", async () => {
    fake({ people: [applicant()] });
    await expect(moveStage(env, officer, "recP1", { stage: "Accepted", from: "3. Club Application (Signed)" })).rejects.toMatchObject({ status: 400 });
    fake({ people: [person({ applicant_stage: "Temporary" })] });
    await expect(moveStage(env, officer, "recP1", { stage: "Rejected", from: "Temporary" })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an ordinary member", async () => {
    fake({ people: [person()] });
    await expect(moveStage(env, officer, "recP1", { stage: "1. Trial Application", from: null })).rejects.toMatchObject({ status: 400 });
  });
});

// The routes are gated on the membership section before anything is read.
const mocks = vi.hoisted(() => ({ requireSection: vi.fn() }));
vi.mock("../worker/src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/auth")>()),
  requireSection: mocks.requireSection,
}));
import worker from "../worker/src/index";
import { HttpError } from "../worker/src/http";

const ROUTE_ENV = { ...env, ALLOWED_ORIGIN: "https://hkfc-squad-selection.test", SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "k" } as any;
const post = (path: string, body: unknown) =>
  worker.fetch(
    new Request(`https://hkfc-api.test${path}`, { method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    ROUTE_ENV,
    { waitUntil: () => {} } as any,
  );

describe("membership admin routes", () => {
  beforeEach(() => {
    mocks.requireSection.mockReset();
  });

  it.each(["/api/admin/people/recP1/membership", "/api/admin/people/recP1/stage"])("%s needs the membership section", async (path) => {
    const calls = fake({ people: [person()] });
    mocks.requireSection.mockRejectedValue(new HttpError("Officer access required.", 403, "OFFICER_ACCESS_REQUIRED"));
    const res = await post(path, { stage: "Temporary", from: null, expect: {} });
    expect(res.status).toBe(403);
    expect(mocks.requireSection.mock.calls[0][2]).toBe("membership");
    expect(calls).toHaveLength(0);
  });

  it("saves as the signed-in officer, whatever the body says", async () => {
    const calls = fake({ people: [person({ status: "Applicant", applicant_stage: "Rejected" })], rpc: { status: "ok", changed: ["applicant_stage"] } });
    mocks.requireSection.mockResolvedValue(officer);
    const res = await post("/api/admin/people/recP1/stage", { stage: "Temporary", from: "Rejected", actor: "recSOMEONE" });
    expect(res.status).toBe(200);
    expect(rpcCall(calls)!.body.p_actor).toBe("recOFFICER");
  });
});
