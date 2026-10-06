import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";

const mocks = vi.hoisted(() => ({ requireSection: vi.fn(), invalidateShared: vi.fn() }));
vi.mock("../worker/src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/auth")>()),
  requireSection: mocks.requireSection,
}));
vi.mock("../worker/src/cache", async (importOriginal) => {
  const original = await importOriginal<typeof import("../worker/src/cache")>();
  mocks.invalidateShared.mockImplementation(original.invalidateShared);
  return { ...original, invalidateShared: mocks.invalidateShared };
});

import worker from "../worker/src/index";
import { HttpError } from "../worker/src/http";
import { OFFICER_LINKS_KEY, MEMBERSHIP_RECORDS_KEY, STATEMENT_RECORDS_KEY, WAITING_ON_KEY } from "../worker/src/reference";
import {
  OFFICE_ROLES, addOffice, createOfficeHolder, editOffice, listOffices, listTeams, parseNewOffice, parseTeamChange, saveTeam,
} from "../worker/src/admin/club";

const env = {
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
} as Env;
const captain = {
  email: "c@x.com", personId: "recCAPTAIN", role: "coach", coachTeams: [], isSectionCaptain: true,
  officerRoles: [{ office: "sectionCaptain", designation: "" }],
} as unknown as AuthorizedUser;

type Call = { path: string; method: string; body: any; url: URL };
function fake(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const path = url.pathname.replace("/rest/v1/", "");
      calls.push({ path, url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(answers[path] ?? []), { status: 200 });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  mocks.invalidateShared.mockClear();
});
const invalidatedKeys = () => mocks.invalidateShared.mock.calls.flatMap((c) => c[1] as string[]);

describe("office keys", () => {
  it("maps every app office to its database role; social secretaries stay in Events", () => {
    expect(OFFICE_ROLES).toEqual({
      sectionCaptain: "section_captain", sectionChair: "section_chair", membershipOfficer: "membership_officer",
      hockeyConvenor: "hockey_convenor", kitConvenor: "kit_convenor", assistantDirector: "assistant_director",
      umpireCoordinator: "umpire_coordinator", sponsor: "sponsor",
    });
    expect(Object.values(OFFICE_ROLES)).not.toContain("social_secretary");
  });
});

describe("offices", () => {
  it("lists office rows with their holders, Active first within each office", async () => {
    const person = (api_id: string, preferred_name: string) => ({ api_id, preferred_name, given_names: null, surname: "X" });
    fake({
      offices: [
        { api_id: "o3", role: "sponsor", designation: null, office_email: null, status: "Active", person: person("p3", "Cy") },
        { api_id: "o2", role: "section_captain", designation: "Vice", office_email: "", status: "Retired", person: person("p2", "Bo") },
        { api_id: "o1", role: "section_captain", designation: null, office_email: "sc@hkfc.test", status: "Active", person: person("p1", "Al") },
      ],
    });
    const { offices } = await listOffices(env);
    expect(offices.map((o) => [o.id, o.office, o.status])).toEqual([
      ["o1", "sectionCaptain", "Active"], ["o2", "sectionCaptain", "Retired"], ["o3", "sponsor", "Active"],
    ]);
    expect(offices[0]).toMatchObject({ officeEmail: "sc@hkfc.test", holder: { id: "p1", name: "Al X" } });
    expect(offices[1].officeEmail).toBeNull();
  });

  it("validates a new holder: office key to role, email lowercased, replaces passed on", () => {
    expect(parseNewOffice({ office: "sponsor", personId: "recP1", designation: " Sponsor ", officeEmail: " Sponsor@HKFC.test ", replaces: "recO1" })).toEqual({
      role: "sponsor", person: "recP1", designation: "Sponsor", officeEmail: "sponsor@hkfc.test", replaces: "recO1",
    });
    expect(() => parseNewOffice({ office: "socialSecretary", personId: "recP1" })).toThrow(/office/);
    expect(() => parseNewOffice({ office: "sponsor", personId: "x,y" })).toThrow(/who holds it/);
    expect(() => parseNewOffice({ office: "sponsor", personId: "recP1", officeEmail: "not an email" })).toThrow(/email/);
  });

  it("adds through admin_save_office as the signed-in captain and drops the office caches", async () => {
    const calls = fake({ "rpc/admin_save_office": { status: "ok", id: "recNEW" } });
    expect(await addOffice(env, captain, { office: "membershipOfficer", personId: "recP1", replaces: "recOLD" })).toEqual({ ok: true, id: "recNEW" });
    expect(calls[0].body).toEqual({ p: { role: "membership_officer", person: "recP1", replaces: "recOLD" }, p_actor: "recCAPTAIN" });
    expect(invalidatedKeys()).toEqual(expect.arrayContaining([OFFICER_LINKS_KEY, MEMBERSHIP_RECORDS_KEY, STATEMENT_RECORDS_KEY, WAITING_ON_KEY]));
  });

  it("is 409 ALREADY_HOLDS when they already hold it", async () => {
    fake({ "rpc/admin_save_office": { status: "conflict", code: "ALREADY_HOLDS" } });
    await expect(addOffice(env, captain, { office: "sponsor", personId: "recP1" })).rejects.toMatchObject({
      status: 409, code: "ALREADY_HOLDS", message: "They already hold this office.",
    });
    expect(invalidatedKeys()).toEqual([]);
  });

  it("is 409 ONE_HOLDER for a second Membership Officer or Chairman without a handover", async () => {
    fake({ "rpc/admin_save_office": { status: "conflict", code: "ONE_HOLDER" } });
    await expect(addOffice(env, captain, { office: "sectionChair", personId: "recP1" })).rejects.toMatchObject({
      status: 409, code: "ONE_HOLDER", message: expect.stringContaining("one holder at a time"),
    });
  });

  it("is 409 LAST_SECTION_CAPTAIN when retiring the last one", async () => {
    const calls = fake({ "rpc/admin_save_office": { status: "conflict", code: "LAST_SECTION_CAPTAIN" } });
    await expect(editOffice(env, captain, "recO1", { status: "Retired" })).rejects.toMatchObject({ status: 409, code: "LAST_SECTION_CAPTAIN" });
    expect(calls[0].body.p).toEqual({ id: "recO1", status: "Retired" });
  });

  it("clears a designation or office email with blank, and refuses an unknown status or an empty save", async () => {
    const calls = fake({ "rpc/admin_save_office": { status: "ok", id: "recO1" } });
    await editOffice(env, captain, "recO1", { designation: "", officeEmail: null });
    expect(calls[0].body.p).toEqual({ id: "recO1", designation: "", officeEmail: "" });
    await expect(editOffice(env, captain, "recO1", { status: "Gone" })).rejects.toMatchObject({ status: 400 });
    await expect(editOffice(env, captain, "recO1", {})).rejects.toMatchObject({ status: 400 });
  });
});

describe("POST /api/admin/people (a new office holder)", () => {
  it("creates them with a lowercased email and drops the People caches", async () => {
    const calls = fake({ "rpc/admin_create_person": { status: "ok", id: "uuid-new" } });
    expect(await createOfficeHolder(env, captain, { preferredName: " Pat ", surname: "Lam", email: " Pat.Lam@Example.TEST " })).toEqual({ ok: true, id: "uuid-new" });
    expect(calls[0].body).toEqual({ p: { preferredName: "Pat", givenNames: null, surname: "Lam", email: "pat.lam@example.test" }, p_actor: "recCAPTAIN" });
    expect(mocks.invalidateShared.mock.calls[0][2]).toContain("player-by-email:");
  });

  it("is 409 EMAIL_TAKEN for an email someone already has", async () => {
    fake({ "rpc/admin_create_person": { status: "conflict", code: "EMAIL_TAKEN" } });
    await expect(createOfficeHolder(env, captain, { surname: "Lam", email: "a@b.test" })).rejects.toMatchObject({ status: 409, code: "EMAIL_TAKEN" });
  });

  it("needs a surname and an email", async () => {
    const calls = fake({});
    await expect(createOfficeHolder(env, captain, { email: "a@b.test" })).rejects.toMatchObject({ status: 400 });
    await expect(createOfficeHolder(env, captain, { surname: "Lam", email: "nope" })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });
});

describe("teams", () => {
  it("lists coaches, captains and the read-only Section Captain links in order", async () => {
    const p = (api_id: string) => ({ api_id, preferred_name: api_id, given_names: null, surname: null });
    fake({
      teams: [{
        api_id: "recT1", team_name: "HKFC A", team_rank: 1, active: true, target_squad_size: 14,
        team_people: [
          { role: "coach", ordinal: 2, person: p("c2") }, { role: "coach", ordinal: 1, person: p("c1") },
          { role: "team_captain", ordinal: 1, person: p("k1") }, { role: "section_captain", ordinal: 1, person: p("s1") },
          { role: "auto_select", ordinal: 1, person: p("a1") },
        ],
      }],
    });
    const { teams } = await listTeams(env);
    expect(teams[0]).toEqual({
      id: "recT1", name: "HKFC A", rank: 1, active: true, targetSquadSize: 14,
      coaches: [{ id: "c1", name: "c1" }, { id: "c2", name: "c2" }], captains: [{ id: "k1", name: "k1" }], sectionCaptains: [{ id: "s1", name: "s1" }],
    });
  });

  it("validates a save: ids deduplicated in order, size 1 to 40", () => {
    expect(parseTeamChange({ coachIds: ["recA1", "recB2", "recA1"], targetSquadSize: 16 })).toEqual({ coaches: ["recA1", "recB2"], targetSquadSize: 16 });
    expect(parseTeamChange({ captainIds: [] })).toEqual({ captains: [] });
    for (const bad of [0, 41, 14.5, "14", null]) expect(() => parseTeamChange({ targetSquadSize: bad })).toThrow(/1 to 40/);
    expect(() => parseTeamChange({ coachIds: ["x,y"] })).toThrow(/Coaches/);
    expect(() => parseTeamChange({ coachIds: Array.from({ length: 21 }, (_, i) => `recP${i}00`) })).toThrow(/up to 20/);
    expect(() => parseTeamChange({ sectionCaptainIds: ["recA1"] })).toThrow(/Nothing/);
  });

  it("saves through admin_save_team and drops the team caches only when something changed", async () => {
    let calls = fake({ "rpc/admin_save_team": { status: "ok", changed: ["coach"] } });
    expect(await saveTeam(env, captain, "recT1", { coachIds: ["recA1"] })).toEqual({ ok: true, changed: ["coach"] });
    expect(calls[0].body).toEqual({ p_team: "recT1", p_actor: "recCAPTAIN", p: { coaches: ["recA1"] } });
    expect(invalidatedKeys()).toEqual(expect.arrayContaining(["club-reference", "team-coach-links"]));
    mocks.invalidateShared.mockClear();
    calls = fake({ "rpc/admin_save_team": { status: "ok", changed: [] } });
    await saveTeam(env, captain, "recT1", { targetSquadSize: 14 });
    expect(invalidatedKeys()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Routes: all gated on the club section (Section Captains) before any read.
// ---------------------------------------------------------------------------

const ROUTE_ENV = { ...env, ALLOWED_ORIGIN: "https://hkfc-squad-selection.test", SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "k" } as any;
const call = (method: string, path: string, body?: unknown) =>
  worker.fetch(
    new Request(`https://hkfc-api.test${path}`, {
      method,
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ROUTE_ENV,
    { waitUntil: () => {} } as any,
  );

describe("club routes", () => {
  beforeEach(() => {
    mocks.requireSection.mockReset();
  });

  it.each([
    ["GET", "/api/admin/offices"],
    ["POST", "/api/admin/offices"],
    ["POST", "/api/admin/offices/recO1"],
    ["POST", "/api/admin/people"],
    ["GET", "/api/admin/teams"],
    ["POST", "/api/admin/teams/recT1"],
  ])("%s %s needs the club section", async (method, path) => {
    const calls = fake({});
    mocks.requireSection.mockRejectedValue(new HttpError("Officer access required.", 403, "OFFICER_ACCESS_REQUIRED"));
    const res = await call(method, path, method === "POST" ? { office: "sponsor", personId: "recP1" } : undefined);
    expect(res.status).toBe(403);
    expect(mocks.requireSection.mock.calls[0][2]).toBe("club");
    expect(calls).toHaveLength(0);
  });

  it("leaves GET /api/admin/people to the people section's search", async () => {
    fake({ people: [] });
    mocks.requireSection.mockResolvedValue(captain);
    const res = await call("GET", "/api/admin/people?q=sam");
    expect(res.status).toBe(200);
    expect(mocks.requireSection.mock.calls[0][2]).toBe("people");
  });

  it("saves a team as the signed-in captain", async () => {
    const calls = fake({ "rpc/admin_save_team": { status: "ok", changed: ["target_squad_size"] } });
    mocks.requireSection.mockResolvedValue(captain);
    const res = await call("POST", "/api/admin/teams/recT1", { targetSquadSize: 15, actor: "recSOMEONE" });
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.path === "rpc/admin_save_team")!.body.p_actor).toBe("recCAPTAIN");
  });
});
