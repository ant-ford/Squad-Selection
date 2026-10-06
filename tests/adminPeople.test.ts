import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { sectionsFor } from "../worker/src/auth";
import { buildHistory, canFor, getPersonAdmin, getPersonHistory, isJuniorMember, searchPeople } from "../worker/src/admin/people";

const env = {
  DATA_BACKEND: "supabase",
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
} as Env;

const base = { email: "x@x.com", personId: "recME", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] } as unknown as AuthorizedUser;
const as = (...offices: string[]) => ({ ...base, officerRoles: offices.map((office) => ({ office, designation: "" })) }) as AuthorizedUser;
const officer = as("membershipOfficer");
const convenor = as("hockeyConvenor");
const captain = as("sectionCaptain");
const teamLinkedCaptain = { ...base, role: "coach", isSectionCaptain: true } as AuthorizedUser;
const adh = as("assistantDirector");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const personRow = (more: Record<string, unknown> = {}) => ({
  api_id: "recP1", preferred_name: "Sam", given_names: "Samuel", surname: "Lee", registered_team: "HKFC C", status: "Member",
  applicant_stage: null, active: true, member_type: "Main", category_type: "Sports Preferred", membership_no: "M1",
  join_date: "2024-09-01", commitment_end_date: "2027-08-31", selected_team_sos: "HKFC C", selected_team_eos: "", playing_position: "Defender",
  ...more,
});

type Call = { url: URL; method: string };
function fake(tables: Record<string, unknown[] | ((url: URL) => unknown[])>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      calls.push({ url, method: init.method ?? "GET" });
      const t = tables[url.pathname.split("/").pop()!];
      return new Response(JSON.stringify(typeof t === "function" ? t(url) : t ?? []), { status: 200 });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("the people section", () => {
  it("opens to the Membership Officer, the Men's Convenor and Section Captains, on Supabase only", () => {
    expect(sectionsFor(officer, env)).toContain("people");
    expect(sectionsFor(convenor, env)).toContain("people");
    expect(sectionsFor(captain, env)).toContain("people");
    expect(sectionsFor(adh, env)).not.toContain("people");
    expect(sectionsFor(teamLinkedCaptain, env)).not.toContain("people");
    expect(sectionsFor(captain, { ...env, DATA_BACKEND: "airtable" })).not.toContain("people");
  });

  it("opens the club section to Section Captains only", () => {
    expect(sectionsFor(captain, env)).toContain("club");
    for (const u of [officer, convenor, adh, teamLinkedCaptain]) expect(sectionsFor(u, env)).not.toContain("club");
  });
});

describe("what each officer may do to a person", () => {
  // An applicant, so there is a stage to move to.
  const p = personRow({ status: "Applicant", applicant_stage: "2. Section Captain Invitation" }) as any;
  it("the Membership Officer: membership, stage; not squad, suspensions or active", () => {
    expect(canFor(env, officer, p)).toEqual({
      membership: true, stage: true, squad: false, registeredTeam: false, suspend: false, activate: false, juniorRoute: false,
    });
  });
  it("the Men's Convenor: the registered team and suspensions; not membership or active", () => {
    expect(canFor(env, convenor, p)).toEqual({
      membership: false, stage: false, squad: true, registeredTeam: true, suspend: true, activate: false, juniorRoute: false,
    });
  });
  it("a Section Captain: membership, stage, selected teams and active; not the registered team or suspensions", () => {
    expect(canFor(env, captain, p)).toEqual({
      membership: true, stage: true, squad: true, registeredTeam: false, suspend: false, activate: true, juniorRoute: false,
    });
  });
  it("a Teams-linked Section Captain may make people active or inactive", () => {
    expect(canFor(env, teamLinkedCaptain, p).activate).toBe(true);
  });
  it("offers the junior route for a junior member only", () => {
    expect(canFor(env, officer, personRow({ member_type: "Child" }) as any).juniorRoute).toBe(true);
    expect(canFor(env, captain, personRow({ category_type: "Junior (under 21)" }) as any).juniorRoute).toBe(true);
    expect(canFor(env, convenor, personRow({ member_type: "Child" }) as any).juniorRoute).toBe(false);
    expect(isJuniorMember({ status: "Applicant", applicant_stage: "2. Section Captain Invitation", member_type: "Child", category_type: null })).toBe(false);
    expect(isJuniorMember({ status: "Member", applicant_stage: "3. Club Application (Signed)", member_type: "Child", category_type: null })).toBe(false);
    expect(isJuniorMember({ status: "Member", applicant_stage: "Accepted", member_type: "Child", category_type: null })).toBe(true);
  });
});

describe("GET /api/admin/people/:id", () => {
  it("leaves out the membership block without the membership section", async () => {
    fake({ people: [personRow()], teams: [{ team_name: "HKFC A" }, { team_name: "HKFC B" }] });
    const view = await getPersonAdmin(env, convenor, "recP1");
    expect(view).toMatchObject({ id: "recP1", name: "Sam Lee", status: "Member", stage: null, active: true, team: "HKFC C" });
    expect(view.membership).toBeUndefined();
    expect(view.squad).toEqual({ registeredTeam: "HKFC C", selectedTeamSos: "HKFC C", selectedTeamEos: null, playingPosition: "Defender" });
    expect(view.teamOptions).toEqual(["HKFC A", "HKFC B"]);
  });

  it("gives the Membership Officer the membership block and no squad block (one read)", async () => {
    const calls = fake({ people: [personRow()] });
    const view = await getPersonAdmin(env, officer, "recP1");
    expect(view.membership).toEqual({
      memberType: "Main", categoryType: "Sports Preferred", membershipNo: "M1", joinDate: "2024-09-01", commitmentEndDate: "2027-08-31",
    });
    expect(view.squad).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].url.searchParams.get("select")).not.toMatch(/hkid|passport|email|mobile|date_of_birth/);
  });

  it("is a 404 for an unknown person", async () => {
    fake({ people: [] });
    await expect(getPersonAdmin(env, officer, "recNOPE")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("is 409 NOT_YET on the Airtable backend", async () => {
    await expect(getPersonAdmin({ ...env, DATA_BACKEND: "airtable" } as Env, officer, "recP1")).rejects.toMatchObject({ status: 409, code: "NOT_YET" });
  });
});

describe("GET /api/admin/people?q=", () => {
  it("asks for every word in any name, at most 20", async () => {
    const calls = fake({ people: [personRow({ applicant_stage: "" })] });
    const rows = await searchPeople(env, "  sam o'neil ");
    expect(rows).toEqual([{ id: "recP1", name: "Sam Lee", team: "HKFC C", status: "Member", stage: null, active: true }]);
    const q = calls[0].url.searchParams;
    expect(q.get("and")).toBe(
      `(or(preferred_name.ilike."*sam*",given_names.ilike."*sam*",surname.ilike."*sam*"),or(preferred_name.ilike."*o'neil*",given_names.ilike."*o'neil*",surname.ilike."*o'neil*"))`,
    );
    expect(q.get("limit")).toBe("20");
  });

  it("refuses wildcards and PostgREST syntax", async () => {
    const calls = fake({});
    for (const q of ["a*", "a%", "x,y", "a(b)", 'a"b', "a_b", "a:b"]) {
      await expect(searchPeople(env, q)).rejects.toMatchObject({ status: 400, code: "INVALID_INPUT" });
    }
    expect(calls).toHaveLength(0);
  });

  it("answers nothing for an empty search, without a read", async () => {
    const calls = fake({});
    expect(await searchPeople(env, "   ")).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("history", () => {
  const name = (preferred_name: string, surname: string) => ({ preferred_name, given_names: null, surname });

  it("merges the activity log and active/inactive ranking events, newest first, with labels", () => {
    const entries = buildHistory(
      [
        { occurred_at: "2026-10-05T02:00:00+00:00", action: "admin-membership", fields: ["member_type", "join_date"], actor: name("Ann", "Officer") },
        { occurred_at: "2026-10-01T02:00:00+00:00", action: "admin-team-role", fields: ["coach:HKFC A"], actor: null },
      ],
      [{ occurred_at: "2026-10-03T02:00:00+00:00", kind: "deactivate", actor: name("Cap", "Tain") }],
    );
    expect(entries).toEqual([
      { at: "2026-10-05T02:00:00.000Z", actor: "Ann Officer", action: "admin-membership", summary: "Membership details changed", fields: ["Member type", "Join date"] },
      { at: "2026-10-03T02:00:00.000Z", actor: "Cap Tain", action: "deactivate", summary: "Made inactive", fields: [] },
      { at: "2026-10-01T02:00:00.000Z", actor: null, action: "admin-team-role", summary: "Team role changed", fields: ["Coach, HKFC A"] },
    ]);
  });

  it("keeps at most 50", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ occurred_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), action: "x", fields: [], actor: null }));
    const ranks = Array.from({ length: 40 }, (_, i) => ({ occurred_at: new Date(Date.UTC(2026, 0, 2, 0, i)).toISOString(), kind: "activate", actor: null }));
    const out = buildHistory(many, ranks);
    expect(out).toHaveLength(50);
    expect(out[0].action).toBe("activate");
  });

  it("reads the person, then their log rows and active/inactive events", async () => {
    const calls = fake({
      people: [{ id: U(7) }],
      activity_log: [{ occurred_at: "2026-10-05T02:00:00Z", action: "admin-stage", fields: ["applicant_stage"], actor: null }],
      ranking_events: [],
    });
    const { entries } = await getPersonHistory(env, "recP1");
    expect(entries).toHaveLength(1);
    expect(calls).toHaveLength(3);
    const log = calls.find((c) => c.url.pathname.endsWith("/activity_log"))!.url.searchParams;
    expect(log.get("entity")).toBe("eq.people");
    expect(log.get("entity_id")).toBe(`eq.${U(7)}`);
    expect(log.get("limit")).toBe("50");
    const ranks = calls.find((c) => c.url.pathname.endsWith("/ranking_events"))!.url.searchParams;
    expect(ranks.get("kind")).toBe("in.(activate,deactivate)");
    expect(ranks.get("person_id")).toBe(`eq.${U(7)}`);
  });

  it("is 404 for an unknown person and 400 for a malformed id", async () => {
    fake({ people: [] });
    await expect(getPersonHistory(env, "recNOPE")).rejects.toMatchObject({ status: 404 });
    await expect(getPersonHistory(env, "x,y")).rejects.toMatchObject({ status: 400 });
  });
});

// ---------------------------------------------------------------------------
// The routes: each is gated on the people section before anything is read.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({ requireSection: vi.fn() }));
vi.mock("../worker/src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/auth")>()),
  requireSection: mocks.requireSection,
}));

import worker from "../worker/src/index";
import { HttpError } from "../worker/src/http";

const ROUTE_ENV = { ...env, ALLOWED_ORIGIN: "https://hkfc-squad-selection.test", SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "k" } as any;
const get = (path: string) =>
  worker.fetch(new Request(`https://hkfc-api.test${path}`, { headers: { Authorization: "Bearer valid.jwt.token" } }), ROUTE_ENV, { waitUntil: () => {} } as any);

describe("admin people routes", () => {
  beforeEach(() => {
    mocks.requireSection.mockReset();
  });

  it.each(["/api/history?person=recP1", "/api/admin/people?q=sam", "/api/admin/people/recP1"])("%s is refused without the people section, before any read", async (path) => {
    const calls = fake({ people: [personRow()] });
    mocks.requireSection.mockImplementation(async () => {
      throw new HttpError("Officer access required.", 403, "OFFICER_ACCESS_REQUIRED");
    });
    const res = await get(path);
    expect(res.status).toBe(403);
    expect(mocks.requireSection.mock.calls[0][2]).toBe("people");
    expect(calls).toHaveLength(0);
  });

  it("answers the search for an officer", async () => {
    fake({ people: [personRow()] });
    mocks.requireSection.mockResolvedValue(officer);
    const res = await get("/api/admin/people?q=sam");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ people: [{ id: "recP1", name: "Sam Lee", team: "HKFC C", status: "Member", stage: null, active: true }] });
  });
});
