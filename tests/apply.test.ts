import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePostgrest, SUPABASE_TEST_ENV, type PostgrestOptions } from "./helpers/postgrest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { applicationGaps, getApply, saveFamily, saveTrials, submitApplication } from "../worker/src/apply";
import { APPLICATION_VERSION, ageOn, childNeedsHkid, childSigns, requiredTicks, spouseProblem } from "../shared/application";

const env = { ...SUPABASE_TEST_ENV } as Env;
const user = { email: "a@x.com", personId: "recAPP", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] } as unknown as AuthorizedUser;

/** Supabase with this applicant in People and nothing else on file, plus `tables`. */
function fake(tables: Record<string, Record<string, unknown>[]>, opts: Omit<PostgrestOptions, "tables"> = {}) {
  const pg = fakePostgrest({
    tables: {
      people: [complete], family_members: [], relatives: [], previous_clubs: [], applicant_trials: [], applications: [], files: [],
      ...structuredClone(tables),
    },
    rpc: { submit_application: () => ({}) },
    ...opts,
  });
  return pg;
}
afterEach(() => vi.unstubAllGlobals());

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

/** A complete existing-HKFC-member applicant, as People columns. */
const complete = {
  id: "u1", api_id: "recAPP", status: "Applicant", applicant_type: "Existing HKFC Member", applicant_stage: "2. Section Captain Invitation",
  membership_no: "M123", member_type: "Main", category_type: "Sports Preferred",
  surname: "Lee", given_names: "Sam", preferred_name: "Sam", date_of_birth: "1990-01-01", gender: "Male", hkid_no: "A123456(3)", nationality: "British",
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
    expect(applicationGaps(married as any, emptyView, "existing", true, true, day)).toContain("Family: upload your marriage certificate.");
    const child = { id: "c1", surname: "Lee", givenNames: "Kim", dateOfBirth: "2005-01-01", gender: "F", files: { photo: true, hkid: false, birthCertificate: true } };
    expect(applicationGaps(complete as any, { ...emptyView, children: [child] }, "existing", true, true, day)).toEqual(["Family: upload child 1's HKID."]);
    // A new HKFC member is asked more, including the bank details.
    expect(applicationGaps({ ...complete, applicant_type: "New HKFC Member" } as any, emptyView, "new", true, true, day)[0]).toMatch(/^Your application:/);
  });

  it("saves the family, replacing what was there", async () => {
    let n = 0;
    const pg = fake({}, { defaults: { family_members: (r) => ({ id: `f${n++}`, ...r }) } });
    const calls = pg.calls;
    const spouse = { salutation: "Mrs", surname: "Lee", givenNames: "Jo", dateOfBirth: "1991-02-03", gender: "Female", hkidNo: "B234567(1)", nationality: "British", email: "jo@x.com", mobileNo: "+852 5555 2222" };
    const ids = await saveFamily(env, user, { spouse, children: [{ surname: "Lee", givenNames: "Kim", dateOfBirth: "2015-01-01", gender: "F" }], relatives: [{ name: "Pat Lee", membershipNo: "M9", relationship: "Parent" }] });
    expect(ids).toEqual({ spouseId: "f0", childIds: ["f1"] });
    const upsert = calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/family_members"))!;
    expect(upsert.url.searchParams.get("on_conflict")).toBe("person_id,relation,ordinal");
    expect(upsert.body[0]).toMatchObject({ relation: "spouse", ordinal: 1, given_names: "Jo", date_of_birth: "1991-02-03" });
    const removed = calls.find((c) => c.method === "DELETE" && c.url.pathname.endsWith("/family_members"))!;
    expect(removed.url.searchParams.get("id")).toBe("not.in.(f0,f1)");
    // What is stored now: the spouse and the child, and the relative.
    expect(pg.tables.family_members.map((r) => [r.id, r.relation])).toEqual([["f0", "spouse"], ["f1", "child"]]);
    expect(pg.tables.relatives).toMatchObject([{ person_id: "u1", name: "Pat Lee" }]);
    await expect(saveFamily(env, user, { spouse: { ...spouse, email: "" }, children: [], relatives: [] })).rejects.toThrow(/email/);
  });

  it("needs participation details when trials are given", async () => {
    fake({});
    await expect(saveTrials(env, user, { trials: [{ date: "2026-08-16", types: ["Playing"], division: "Division 2" }] })).rejects.toThrow(/participation details/);
  });

  it("is for applicants only", async () => {
    fake({ people: [{ ...complete, status: "Member" }] });
    await expect(getApply(env, user)).rejects.toMatchObject({ status: 403 });
  });

  it("submits: checks it's complete and the boxes, stores the signatures and moves it on", async () => {
    const put = vi.fn();
    const files = { put, delete: vi.fn() } as unknown as R2Bucket;
    const { calls } = fake(
      {
        files: [
          { id: "p1", kind: "photo", person_id: "u1", family_member_id: null },
          { id: "h1", kind: "hkid", person_id: "u1", family_member_id: null },
        ],
      },
      { defaults: { files: (r) => ({ id: "sig1", ...r }) } },
    );
    await expect(submitApplication({ ...env, FILES: files } as Env, user, { version: APPLICATION_VERSION, accepted: [], signatures: { applicant: PNG } })).rejects.toThrow(/Tick every box/);
    await submitApplication({ ...env, FILES: files } as Env, user, { version: APPLICATION_VERSION, accepted: ["hockey_notes"], signatures: { applicant: PNG } });
    const rpc = calls.find((c) => c.url.pathname.endsWith("/rpc/submit_application"))!;
    expect(rpc.body).toMatchObject({ p_actor: "recAPP", p: { applicationType: "Existing HKFC Member", accepted: ["hockey_notes"], required: ["hockey_notes"], signature: "sig1", spouseSignature: null } });
    expect(put).toHaveBeenCalledTimes(1);
    await expect(submitApplication({ ...env, FILES: files } as Env, user, { version: "old", accepted: ["hockey_notes"] })).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a second submission from someone whose application was already sent (in Fillout before the switch-over)", async () => {
    const files = { put: vi.fn(), delete: vi.fn() } as unknown as R2Bucket;
    const { calls } = fake({ people: [{ ...complete, applicant_stage: "6. Membership Officer (Signed)" }] });
    await expect(
      submitApplication({ ...env, FILES: files } as Env, user, { version: APPLICATION_VERSION, accepted: ["hockey_notes"], signatures: { applicant: PNG } }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already been sent/) });
    expect(calls.some((c) => c.url.pathname.endsWith("/rpc/submit_application"))).toBe(false);
  });
});
