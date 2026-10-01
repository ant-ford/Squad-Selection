import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { applicationGaps, getApply, saveFamily, saveTrials, submitApplication } from "../worker/src/apply";
import { APPLICATION_VERSION, ageOn, childNeedsHkid, childSigns, requiredTicks, spouseProblem } from "../shared/application";

const env = { DATA_BACKEND: "supabase", DATA_SUPABASE_URL: "https://proj.supabase.co", DATA_SUPABASE_SECRET_KEY: "sb_secret_test" } as Env;
const user = { email: "a@x.com", personId: "recAPP", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] } as unknown as AuthorizedUser;

type Call = { url: URL; method: string; body: any };
function fake(tables: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init.method ?? "GET", body });
    const name = url.pathname.split("/").pop()!;
    const t = tables[name];
    const reply = typeof t === "function" ? (t as (c: Call) => unknown)({ url, method: init.method ?? "GET", body }) : t;
    return new Response(JSON.stringify(reply ?? []), { status: 200 });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

/** A complete existing-HKFC-member applicant, as People columns. */
const complete = {
  id: "u1", api_id: "recAPP", status: "Applicant", applicant_type: "Existing HKFC Member", applicant_stage: "2. Section Captain Invitation",
  membership_no: "M123", member_type: "Main", category_type: "Sports Preferred",
  surname: "Lee", given_names: "Sam", preferred_name: "Sam", date_of_birth: "1990-01-01", gender: "Male", hkid_no: "A1", nationality: "British",
  marital_status: "Single", emergency_contact: "Jo", emergency_contact_no: "+852 5555 0000", mobile_no: "+852 5555 1111",
  home_flat_type: "Flat", home_unit: "A", home_street: "Conduit Road", home_district: "Mid-Levels", home_region: "Hong Kong",
  playing_position: "Forward", playing_level: ["Division 3"],
};
const emptyView = { stage: "2. Section Captain Invitation", submittedAt: null, spouse: null, children: [], relatives: [], clubs: [], trials: [], participationDetails: null, hasMarriageCertificate: false };

describe("the new joiner application", () => {
  it("asks new HKFC members for the pledge and the Sports Associate terms, existing ones for the hockey notes, and under-18s' guardians", () => {
    expect(requiredTicks("new", false)).toEqual(["commitment_pledge", "sam_terms"]);
    expect(requiredTicks("existing", true)).toEqual(["hockey_notes", "guardian_consent"]);
  });

  it("needs children's HKIDs from 18 to 26 and their signatures over 10", () => {
    expect(ageOn("2008-10-02", "2026-10-01")).toBe(17);
    expect(childNeedsHkid("2008-10-01", "2026-10-01")).toBe(true);
    expect(childNeedsHkid("2000-01-01", "2026-10-01")).toBe(true); // 26: still asked
    expect(childNeedsHkid("1999-09-30", "2026-10-01")).toBe(false);
    expect(childSigns("2015-09-30", "2026-10-01")).toBe(true);
    expect(childSigns("2016-10-01", "2026-10-01")).toBe(false);
    expect(spouseProblem({ surname: "Lee", givenNames: "Jo", dateOfBirth: "1990-01-01", gender: "Female" })).toMatch(/title/);
  });

  it("lists what's missing before it can be submitted", () => {
    const day = "2026-10-01";
    expect(applicationGaps(complete as any, emptyView, "existing", true, true, day)).toEqual([]);
    expect(applicationGaps(complete as any, emptyView, "existing", false, true, day)).toEqual(["Personal details: upload your photo."]);
    const married = { ...complete, marital_status: "Married" };
    expect(applicationGaps(married as any, emptyView, "existing", true, true, day)).toContain("Personal details: upload your marriage certificate.");
    const child = { id: "c1", surname: "Lee", givenNames: "Kim", dateOfBirth: "2005-01-01", gender: "F", files: { photo: true, hkid: false, birthCertificate: true } };
    expect(applicationGaps(complete as any, { ...emptyView, children: [child] }, "existing", true, true, day)).toEqual(["Family: upload child 1's HKID."]);
    // A new HKFC member is asked more, including the bank details.
    expect(applicationGaps({ ...complete, applicant_type: "New HKFC Member" } as any, emptyView, "new", true, true, day)[0]).toMatch(/^Your application:/);
  });

  it("saves the family, replacing what was there", async () => {
    const calls = fake({
      people: [complete],
      family_members: (c: Call) => (c.method === "POST" ? c.body.map((r: any, i: number) => ({ id: `f${i}`, ...r })) : []),
    });
    const spouse = { salutation: "Mrs", surname: "Lee", givenNames: "Jo", dateOfBirth: "1991-02-03", gender: "Female", hkidNo: "B2", nationality: "British", email: "jo@x.com", mobileNo: "+852 5555 2222" };
    const ids = await saveFamily(env, user, { spouse, children: [{ surname: "Lee", givenNames: "Kim", dateOfBirth: "2015-01-01", gender: "F" }], relatives: [{ name: "Pat Lee", membershipNo: "M9", relationship: "Parent" }] });
    expect(ids).toEqual({ spouseId: "f0", childIds: ["f1"] });
    const upsert = calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/family_members"))!;
    expect(upsert.url.searchParams.get("on_conflict")).toBe("person_id,relation,ordinal");
    expect(upsert.body[0]).toMatchObject({ relation: "spouse", ordinal: 1, given_names: "Jo", date_of_birth: "1991-02-03" });
    const removed = calls.find((c) => c.method === "DELETE" && c.url.pathname.endsWith("/family_members"))!;
    expect(removed.url.searchParams.get("id")).toBe("not.in.(f0,f1)");
    await expect(saveFamily(env, user, { spouse: { ...spouse, email: "" }, children: [], relatives: [] })).rejects.toThrow(/email/);
  });

  it("needs participation details when trials are given", async () => {
    fake({ people: [complete] });
    await expect(saveTrials(env, user, { trials: [{ date: "2026-08-16", types: ["Playing"], division: "Division 2" }] })).rejects.toThrow(/participation details/);
  });

  it("is for applicants only", async () => {
    fake({ people: [{ ...complete, status: "Member" }] });
    await expect(getApply(env, user)).rejects.toMatchObject({ status: 403 });
  });

  it("submits: checks it's complete and the boxes, stores the signatures and moves it on", async () => {
    const put = vi.fn();
    const files = { put, delete: vi.fn() } as unknown as R2Bucket;
    const calls = fake({
      people: [complete],
      files: (c: Call) => (c.method === "POST" ? [{ id: "sig1" }] : [{ id: "p1", kind: "photo" }, { id: "h1", kind: "hkid" }]),
      submit_application: {},
    });
    await expect(submitApplication({ ...env, FILES: files } as Env, user, { version: APPLICATION_VERSION, accepted: [], signatures: { applicant: PNG } })).rejects.toThrow(/Tick every box/);
    await submitApplication({ ...env, FILES: files } as Env, user, { version: APPLICATION_VERSION, accepted: ["hockey_notes"], signatures: { applicant: PNG } });
    const rpc = calls.find((c) => c.url.pathname.endsWith("/rpc/submit_application"))!;
    expect(rpc.body).toMatchObject({ p_actor: "recAPP", p: { applicationType: "Existing HKFC Member", accepted: ["hockey_notes"], required: ["hockey_notes"], signature: "sig1", spouseSignature: null } });
    expect(put).toHaveBeenCalledTimes(1);
    await expect(submitApplication({ ...env, FILES: files } as Env, user, { version: "old", accepted: ["hockey_notes"] })).rejects.toMatchObject({ status: 409 });
  });
});
